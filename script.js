import { initializeApp } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-app.js";
import { getDatabase, ref, set, update, onValue, get } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-database.js";

// ==========================================
// [필독] 여기에 본인의 파이어베이스 설정을 붙여넣으세요.
// ==========================================
const firebaseConfig = {
  apiKey: "AIzaSyAzDc8nErqYcYYy-itp2Tk9WZExy3PBlIU",
  authDomain: "battleship-f08f8.firebaseapp.com",
  databaseURL: "https://battleship-f08f8-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "battleship-f08f8",
  storageBucket: "battleship-f08f8.firebasestorage.app",
  messagingSenderId: "1146329001",
  appId: "1:1146329001:web:f2d698e5661582ee1f96b8"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// 로컬 상태 변수 구성
let roomId = "";
let myUid = "UID_" + Math.floor(Math.random() * 100000);
let myName = "";
let myMines = [];
let gameState = {};

// 2~4인용 고유 컬러 설정 테이블
const playerColors = ["#ff4d4d", "#1e90ff", "#2ed573", "#ffa500"];

// 사각형 격자(9x9) 기준 인원별 대칭 사각 꼭짓점 반환 함수 (2인: 마주보기, 3인: 삼각, 4인: 네 모퉁이)
function getSpawnPositions(totalPlayers) {
    const positions = [
        { r: 0, c: 0 }, // P1: 좌상단 고정
        { r: 8, c: 8 }  // P2: 우하단 고정 (마주보기 구성)
    ];
    if (totalPlayers >= 3) {
        positions.push({ r: 0, c: 8 }); // P3: 우상단 추가
    }
    if (totalPlayers >= 4) {
        positions.push({ r: 8, c: 0 }); // P4: 좌하단 추가
    }
    return positions;
}

// 돔 객체 캐싱
const authScreen = document.getElementById("auth-screen");
const gameScreen = document.getElementById("game-screen");
const boardEl = document.getElementById("board");

// 규칙 모달 및 어드민 리셋용 돔 객체 추가 캐싱
const btnRules = document.getElementById("btn-rules");
const btnCloseRules = document.getElementById("btn-close-rules");
const rulesModal = document.getElementById("rules-modal");
const btnResetAll = document.getElementById("btn-reset-all");
const adminPasswordInput = document.getElementById("admin-password");

// --- 규칙 보기 모달 팝업 제어 이벤트 바인딩 ---
if (btnRules && rulesModal && btnCloseRules) {
    btnRules.addEventListener("click", () => {
        rulesModal.style.display = "flex";
    });

    btnCloseRules.addEventListener("click", () => {
        rulesModal.style.display = "none";
    });

    rulesModal.addEventListener("click", (e) => {
        if (e.target === rulesModal) {
            rulesModal.style.display = "none";
        }
    });
}

// --- 어드민 전체 방 리셋 및 폭파 제어 이벤트 바인딩 ---
if (btnResetAll && adminPasswordInput) {
    btnResetAll.addEventListener("click", async () => {
        const password = adminPasswordInput.value.trim();
        
        if (password !== "reset") {
            alert("비밀번호가 일치하지 않습니다.");
            adminPasswordInput.value = "";
            return;
        }

        if (confirm("🔥 정말로 진행 중인 모든 게임 방을 폭파하고 초기화하시겠습니까?\n현재 접속 중인 모든 학생들이 로비로 강제 튕겨 나갑니다.")) {
            try {
                // mine_jewel_rooms 하위의 모든 실시간 데이터 세트 일괄 삭제 연산
                await set(ref(db, "mine_jewel_rooms"), null);
                alert("시스템 초기화가 완료되었습니다. 모든 방이 정상적으로 파괴되었습니다.");
                adminPasswordInput.value = "";
            } catch (error) {
                alert("리셋 연산 중 오류가 발생했습니다: " + error.message);
            }
        }
    });
}

document.getElementById("btn-create-room").addEventListener("click", async () => {
    myName = document.getElementById("user-name").value.trim();
    if (!myName) return alert("닉네임을 먼저 입력해 주세요!");

    let uniqueIdFound = false;
    let generatedCode = "";

    // 1000 ~ 9999 사이 중복되지 않는 방 코드가 나올 때까지 DB 검증 수행 (배틀쉽과의 격리를 위해 전용 경로 mine_jewel_rooms 사용)
    while (!uniqueIdFound) {
        generatedCode = Math.floor(1000 + Math.random() * 9000).toString();
        const roomRef = ref(db, `mine_jewel_rooms/${generatedCode}`);
        const snapshot = await get(roomRef);
        if (!snapshot.exists()) {
            uniqueIdFound = true;
        }
    }

    roomId = generatedCode;
    
    const roomData = {
        status: "waiting",
        host: myUid,
        players: {
            [myUid]: {
                name: myName,
                color: playerColors[0],
                isReady: false
            }
        }
    };

    await set(ref(db, `mine_jewel_rooms/${roomId}`), roomData);
    
    alert(`방이 개설되었습니다! 방 코드 [ ${roomId} ]를 팀원들에게 공유하세요.`);
    enterGameScreen();
});

// --- 1-2. 대기실 액션 핸들러: 기존 방 코드로 참여하기 ---
document.getElementById("btn-join-room").addEventListener("click", async () => {
    roomId = document.getElementById("room-id").value.trim();
    myName = document.getElementById("user-name").value.trim();

    if (!roomId || !myName) return alert("닉네임과 4자리 방 코드를 모두 입력해 주세요!");

    const roomRef = ref(db, `mine_jewel_rooms/${roomId}`);
    const snapshot = await get(roomRef);
    
    if (!snapshot.exists()) return alert("존재하지 않는 방 코드입니다. 코드를 다시 확인하세요.");
    
    const roomData = snapshot.val();
    if (roomData.status !== "waiting") return alert("이미 게임이 진행 중이거나 종료된 방입니다.");

    const currentPlayers = roomData.players ? Object.keys(roomData.players) : [];
    if (currentPlayers.length >= 4) return alert("방 정원(4명)이 초과되어 입장할 수 없습니다.");

    // 순서대로 고유 컬러 배정
    const colorIdx = currentPlayers.length;
    const playerInfo = {
        name: myName,
        color: playerColors[colorIdx],
        isReady: false
    };

    await update(ref(db, `mine_jewel_rooms/${roomId}/players/${myUid}`), playerInfo);
    enterGameScreen();
});

// 화면 전환 및 동기화 활성화 공통 함수 (대기실 방 코드 상시 노출 처리 연계)
function enterGameScreen() {
    const lobbyDisplay = document.getElementById("lobby-room-display");
    const lobbyCodeText = document.getElementById("current-lobby-code");
    if (lobbyDisplay && lobbyCodeText) {
        lobbyCodeText.innerText = roomId;
        lobbyDisplay.style.display = "block";
    }

    authScreen.style.display = "none";
    gameScreen.style.display = "flex";
    initRealtimeSync();
}

// --- 2. 실시간 파이어베이스 연동 리스너 활성화 (전용 경로인 mine_jewel_rooms 구독) ---
function initRealtimeSync() {
    onValue(ref(db, `mine_jewel_rooms/${roomId}`), (snapshot) => {
        // 호스트에 의해 방이 파괴(remove)되었을 경우 모든 클라이언트 초기화 및 새로고침
        if (!snapshot.exists()) {
            alert("방이 종료되어 로비로 리다이렉트됩니다.");
            window.location.reload();
            return;
        }
        gameState = snapshot.val();

        renderHexBoard();
        renderStatusPanel();
        renderGameLogs();

        // 호스트 권한 스타트 버튼 제어 (최대 4인 변경 반영)
        if (gameState.status === "waiting") {
            if (gameState.host === myUid) {
                document.getElementById("btn-start-game").style.display = "block";
            }
            document.getElementById("turn-display").innerText = `팀 대기 중 (${Object.keys(gameState.players).length}/4명)...`;
        } else {
            document.getElementById("btn-start-game").style.display = "none";
        }

        // 지뢰 설치 셋업 단계 전환 핸들링 (인원수 기반 지뢰 레이블 동적 치환 버그 수정)
        if (gameState.status === "setup") {
            const me = gameState.players[myUid];
            const totalCount = gameState.turnOrder ? gameState.turnOrder.length : 2;
            const maxMineMap = { 2: 12, 3: 9, 4: 7 };
            const requiredMines = maxMineMap[totalCount] || 7;

            if (me && !me.isReady) {
                document.getElementById("setup-controls").style.display = "flex";
                document.getElementById("mine-count").innerText = `지뢰 설치 필요: ${requiredMines - myMines.length}개`;
                document.getElementById("turn-display").innerText = `출발점을 제외하고 지뢰 ${requiredMines}개를 배치하세요.`;
            } else {
                document.getElementById("setup-controls").style.display = "none";
                document.getElementById("turn-display").innerText = "다른 팀이 지뢰를 배치하고 있습니다...";
            }

            const allReady = Object.values(gameState.players).every(p => p.isReady);
            if (allReady && gameState.host === myUid) {
                update(ref(db, `mine_jewel_rooms/${roomId}`), { status: "playing" });
            }
        }

        // 실시간 턴 배정 보드 모드 처리 (사각 그리드 이동 가이드 연결)
        if (gameState.status === "playing") {
            document.getElementById("setup-controls").style.display = "none";
            const currentTurnUid = gameState.turnOrder[gameState.currentTurnIdx];
            
            if (currentTurnUid === myUid) {
                document.getElementById("turn-display").innerText = "★ 당신의 턴입니다! 인접한 사각 격자 칸으로 전진하세요.";
                // 정의된 함수명과 정확히 일치하도록 싱크 수정
                highlightMovableHexagons();
            } else {
                const activeName = gameState.players[currentTurnUid]?.name || "상대방";
                document.getElementById("turn-display").innerText = `현재 차례: [ ${activeName} ] 이동 중...`;
            }
        }

        // 결과 노출 후 5초 뒤 자동 방 파괴(remove) 시퀀스 작동
        if (gameState.status === "finished") {
            document.getElementById("turn-display").innerText = "🚨 게임 종료! 승리팀이 결정되었습니다.";
            
            const logBox = document.getElementById("log-box");
            if (logBox && logBox.innerHTML.indexOf("5초 후 방이 폭파") === -1) {
                logBox.innerHTML += `<div style="color:#ff4d4d; font-weight:bold;">[시스템] 5초 후 방이 자동으로 폭파되며 로비로 복귀합니다.</div>`;
                logBox.scrollTop = logBox.scrollHeight;
            }

            if (gameState.host === myUid) {
                setTimeout(() => {
                    set(ref(db, `mine_jewel_rooms/${roomId}`), null);
                }, 5000);
            }
        }
    });
}

// --- 3. 사각형 9x9 그리드 기반 동적 보드 렌더링 ---
function renderHexBoard() {
    boardEl.innerHTML = "";
    const totalCount = gameState.turnOrder ? gameState.turnOrder.length : 2;
    const activeSpawns = getSpawnPositions(totalCount);

    boardEl.style.display = "grid";
    boardEl.style.gridTemplateColumns = "repeat(9, 1fr)";
    boardEl.style.gridTemplateRows = "repeat(9, 1fr)";
    boardEl.style.gap = "4px";

    for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
            const cell = document.createElement("div");
            cell.classList.add("cell");
            cell.dataset.r = r;
            cell.dataset.c = c;

            cell.style.position = "relative";
            cell.style.left = "0px";
            cell.style.top = "0px";
            cell.style.width = "100%";
            cell.style.height = "100%";
            cell.style.aspectRatio = "1";
            cell.style.clipPath = "none"; 

            if (r === 4 && c === 4) {
                cell.classList.add("center-gem");
                cell.innerText = "💎";
            }

            activeSpawns.forEach(spawn => {
                if (spawn.r === r && spawn.c === c) cell.classList.add("corner-start");
            });

            if (myMines.includes(`${r},${c}`)) cell.classList.add("my-mine");

            // 클릭 핸들러 명칭을 실제 존재하는 handleHexClick으로 유지
            cell.addEventListener("click", () => handleHexClick(r, c));
            boardEl.appendChild(cell);
        }
    }

    injectTokensAndHints();
}

// --- 4. 사각형 그리드 대각선 포함 인접 8칸 정밀 수리 알고리즘 ---
function getNeighbors(r, c) {
    const neighbors = [];
    for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= 0 && nr < 9 && nc >= 0 && nc < 9) {
                neighbors.push({ r: nr, c: nc });
            }
        }
    }
    return neighbors;
}

// --- 5. 사각형 타일 클릭 이벤트 제어 및 UI 연동 ---
function handleHexClick(r, c) {
    const coord = `${r},${c}`;
    const totalCount = gameState.turnOrder ? gameState.turnOrder.length : 2;
    const activeSpawns = getSpawnPositions(totalCount);
    
    // 2~4인용 사각 맞춤형 지뢰 맵 규칙 적용 및 버그 수정
    const maxMineMap = { 2: 12, 3: 9, 4: 7 };
    const requiredMines = maxMineMap[totalCount] || 7;

    if (gameState.status === "setup") {
        if (r === 4 && c === 4) return alert("보석 칸에는 지뢰 매설이 금지됩니다!");
        
        // 사각형 직교 격자 반경 1칸(대각선 포함) 수학적 충돌 계산 적용
        let isNearStart = false;
        activeSpawns.forEach(spawn => {
            if (Math.abs(spawn.r - r) <= 1 && Math.abs(spawn.c - c) <= 1) isNearStart = true;
        });
        if (isNearStart) return alert("플레이어들의 대칭 출발점 반경 1칸 안에는 지뢰를 깔 수 없습니다!");

        const idx = myMines.indexOf(coord);
        if (idx > -1) {
            myMines.splice(idx, 1);
        } else {
            if (myMines.length >= requiredMines) return alert(`현재 인원 모드에서 지뢰는 최대 ${requiredMines}개까지만 깔 수 있습니다.`);
            myMines.push(coord);
        }
        renderHexBoard();
        document.getElementById("mine-count").innerText = `지뢰 설치 필요: ${requiredMines - myMines.length}개`;
        document.getElementById("btn-submit-mine").disabled = myMines.length !== requiredMines;
    } 
    
    else if (gameState.status === "playing") {
        if (gameState.turnOrder[gameState.currentTurnIdx] !== myUid) return;

        const myPos = gameState.positions[myUid];
        const validMoves = getNeighbors(myPos.r, myPos.c);
        const isMoveValid = validMoves.some(v => v.r === r && v.c === c);

        if (!isMoveValid) return;

        const isOccupied = Object.values(gameState.positions).some(p => p.r === r && p.c === c);
        if (isOccupied) return alert("다른 팀이 서 있는 칸으로는 진입할 수 없습니다.");

        executeHexMove(r, c);
    }
}

// 지뢰 랜덤 자동 배치 기능
document.getElementById("btn-random-mine").addEventListener("click", () => {
    myMines = [];
    const totalCount = gameState.turnOrder ? gameState.turnOrder.length : 2;
    const activeSpawns = getSpawnPositions(totalCount);
    
    const maxMineMap = { 2: 12, 3: 9, 4: 7 };
    const requiredMines = maxMineMap[totalCount] || 7;

    while (myMines.length < requiredMines) {
        const r = Math.floor(Math.random() * 9);
        const c = Math.floor(Math.random() * 9);
        
        if (r === 4 && c === 4) continue;
        let isNearStart = false;
        activeSpawns.forEach(spawn => {
            if (Math.abs(spawn.r - r) <= 1 && Math.abs(spawn.c - c) <= 1) isNearStart = true;
        });
        
        if (!isNearStart && !myMines.includes(`${r},${c}`)) {
            myMines.push(`${r},${c}`);
        }
    }
    renderHexBoard();
    document.getElementById("mine-count").innerText = "지뢰 설치 필요: 0개";
    document.getElementById("btn-submit-mine").disabled = false;
});

// 지뢰 제출하기 최종 확정 (mine_jewel_rooms 대응)
document.getElementById("btn-submit-mine").addEventListener("click", () => {
    const totalCount = gameState.turnOrder ? gameState.turnOrder.length : 2;
    const maxMineMap = { 2: 12, 3: 9, 4: 7 };
    const requiredMines = maxMineMap[totalCount] || 7;

    if (myMines.length !== requiredMines) return alert(`지뢰를 정확히 ${requiredMines}개 배치해야 합니다.`);

    myMines.forEach(coord => {
        update(ref(db, `mine_jewel_rooms/${roomId}/mines/${coord}`), { [myUid]: true });
    });
    update(ref(db, `mine_jewel_rooms/${roomId}/players/${myUid}`), { isReady: true });
    document.getElementById("setup-controls").style.display = "none";
});

// --- 6. 호스트의 게임 셔플 스타트 액션 (mine_jewel_rooms 대응) ---
document.getElementById("btn-start-game").addEventListener("click", async () => {
    const roomRef = ref(db, `mine_jewel_rooms/${roomId}`);
    const snapshot = await get(roomRef);
    if (!snapshot.exists()) return;

    const uids = Object.keys(snapshot.val().players);
    if (uids.length < 2) return alert("최소 2명 이상 입장해야 시작할 수 있습니다.");
    if (uids.length > 4) return alert("최대 인원(4명)을 초과했습니다.");

    // 무작위 순서 셔플
    for (let i = uids.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [uids[i], uids[j]] = [uids[j], uids[i]];
    }

    // 설정된 플레이어 인원수에 따른 대칭 좌표값 세트 호출
    const spawns = getSpawnPositions(uids.length);
    const initPos = {};
    uids.forEach((uid, idx) => {
        initPos[uid] = { r: spawns[idx].r, c: spawns[idx].c };
    });

    update(roomRef, {
        status: "setup",
        turnOrder: uids,
        currentTurnIdx: 0,
        positions: initPos
    });
});

// --- 7. 서버 경유 동기화 기반 이동 프로세서 (mine_jewel_rooms 대응) ---
async function executeHexMove(tr, tc) {
    const roomRef = ref(db, `mine_jewel_rooms/${roomId}`);
    const coord = `${tr},${tc}`;

    if (tr === 4 && tc === 4) {
        update(roomRef, {
            status: "finished",
            [`positions/${myUid}`]: { r: tr, c: tc },
            "lastAction": {
                type: "win",
                message: `🎉 [${myName}] 팀이 정중앙의 보석을 차지하여 게임에서 승리했습니다!`
            }
        });
        return;
    }

    const mineSnap = await get(ref(db, `mine_jewel_rooms/${roomId}/mines/${coord}`));
    const isExploded = gameState.explodedMines && gameState.explodedMines[coord];

    if (mineSnap.exists() && !isExploded) {
        const myTurnIdx = gameState.turnOrder.indexOf(myUid);
        const spawns = getSpawnPositions(gameState.turnOrder.length);
        const spawn = spawns[myTurnIdx]; // 고유 대칭 원점 기지로 부활 리스폰

        update(roomRef, {
            [`positions/${myUid}`]: { r: spawn.r, c: spawn.c },
            [`explodedMines/${coord}`]: true,
            "currentTurnIdx": (gameState.currentTurnIdx + 1) % gameState.turnOrder.length,
            "lastAction": {
                type: "explode",
                message: `💥 [${myName}] 지뢰 폭발! 폭격을 맞고 전용 시작점으로 강제 소환되었습니다!`
            }
        });
    } else {
        update(roomRef, {
            [`positions/${myUid}`]: { r: tr, c: tc },
            "currentTurnIdx": (gameState.currentTurnIdx + 1) % gameState.turnOrder.length,
            "lastAction": {
                type: "move",
                message: `[${myName}] 팀이 안전하게 육각 칸으로 전진했습니다.`
            }
        });
    }
}

// --- 8. 보조 컴포넌트 이펙트 및 하이라이트 인젝션 ---
function injectTokensAndHints() {
    if (!gameState.positions) return;

    Object.entries(gameState.positions).forEach(([uid, pos]) => {
        const idx = gameState.turnOrder ? gameState.turnOrder.indexOf(uid) : 0;
        const token = document.createElement("div");
        token.classList.add("token");
        token.style.backgroundColor = gameState.players[uid]?.color || "#fff";
        // 사각형 격자 정중앙에 토큰 배치되도록 위치 보정 스타일 부여
        token.style.position = "absolute";
        token.style.top = "50%";
        token.style.left = "50%";
        token.style.transform = "translate(-50%, -50%)";

        const cell = document.querySelector(`.cell[data-r='${pos.r}'][data-c='${pos.c}']`);
        if (cell) cell.appendChild(token);
    });

    if (gameState.status === "playing" && gameState.positions[myUid]) {
        const myPos = gameState.positions[myUid];
        const myCell = document.querySelector(`.cell[data-r='${myPos.r}'][data-c='${myPos.c}']`);
        
        if (myCell && !(myPos.r === 4 && myPos.c === 4)) {
            const neighbors = getNeighbors(myPos.r, myPos.c);
            let count = 0;
            
            neighbors.forEach(n => {
                const coord = `${n.r},${n.c}`;
                if (gameState.mines && gameState.mines[coord]) {
                    if (!gameState.explodedMines || !gameState.explodedMines[coord]) {
                        count += Object.keys(gameState.mines[coord]).length;
                    }
                }
            });
            myCell.innerText = count;
            myCell.style.color = "#00ffcc";
        }
    }
}

function highlightMovableHexagons() {
    const myPos = gameState.positions[myUid];
    if (!myPos) return;

    const neighbors = getNeighbors(myPos.r, myPos.c);
    neighbors.forEach(n => {
        const isOccupied = Object.values(gameState.positions).some(p => p.r === n.r && p.c === n.c);
        if (!isOccupied) {
            const cell = document.querySelector(`.cell[data-r='${n.r}'][data-c='${n.c}']`);
            if (cell) cell.classList.add("movable");
        }
    });
}

function renderStatusPanel() {
    const listEl = document.getElementById("player-list");
    listEl.innerHTML = "";

    if (!gameState.players) return;
    Object.entries(gameState.players).forEach(([uid, p]) => {
        const badge = document.createElement("div");
        badge.classList.add("player-badge");
        badge.style.borderLeft = `5px solid ${p.color}`;
        
        const readyText = p.isReady ? "준비완료" : "배치중..";
        badge.innerHTML = `<span>${p.name}</span> <span style="font-size:0.8rem; color:#aaa;">${readyText}</span>`;
        listEl.appendChild(badge);
    });
}

function renderGameLogs() {
    if (!gameState.lastAction) return;
    const logBox = document.getElementById("log-box");
    
    const checkMsg = gameState.lastAction.message;
    if (logBox.innerHTML.indexOf(checkMsg) === -1) {
        logBox.innerHTML += `<div>${checkMsg}</div>`;
        logBox.scrollTop = logBox.scrollHeight;

        if (gameState.lastAction.type === "explode") {
            document.body.classList.add("shake");
            if (navigator.vibrate) navigator.vibrate(400);
            setTimeout(() => document.body.classList.remove("shake"), 400);
        }
    }
}