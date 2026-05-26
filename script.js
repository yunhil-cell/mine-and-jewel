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

// 6인용 고유 컬러 설정 테이블
const playerColors = ["#ff4d4d", "#1e90ff", "#2ed573", "#ffa500", "#e056fd", "#1dd1a1"];

// 육각 격자(9x9) 상에서의 외곽 6개 마스터 꼭짓점 정의
const hexVertices = [
    { r: 0, c: 4 }, // 0: 북쪽 꼭짓점
    { r: 2, c: 8 }, // 1: 북동쪽 꼭짓점
    { r: 6, c: 8 }, // 2: 남동쪽 꼭짓점
    { r: 8, c: 4 }, // 3: 남쪽 꼭짓점
    { r: 6, c: 0 }, // 4: 남서쪽 꼭짓점
    { r: 2, c: 0 }  // 5: 북서쪽 꼭짓점
];

// 기획 사양에 맞춘 인원별 수학적 대칭 시작점 테이블 반환 함수
function getSpawnPositions(totalPlayers) {
    const positions = [];
    if (totalPlayers === 2) {
        // 2명: 완벽한 정반대편 마주보기 (북 vs 남)
        positions.push(hexVertices[0]);
        positions.push(hexVertices[3]);
    } else if (totalPlayers === 3) {
        // 3명: 삼각형 배치 (북, 남동, 남서)
        positions.push(hexVertices[0]);
        positions.push(hexVertices[2]);
        positions.push(hexVertices[4]);
    } else if (totalPlayers === 4) {
        // 4명: 사각형 배치 (북동, 남동, 남서, 북서)
        positions.push(hexVertices[1]);
        positions.push(hexVertices[2]);
        positions.push(hexVertices[4]);
        positions.push(hexVertices[5]);
    } else if (totalPlayers === 5) {
        // 5명: 6인 위치에서 한 자리(북서쪽 5번 인덱스)만 비우고 시계방향 배치
        for (let i = 0; i < 5; i++) {
            positions.push(hexVertices[i]);
        }
    } else if (totalPlayers === 6) {
        // 6명: 모든 6개 꼭짓점 풀 배치
        for (let i = 0; i < 6; i++) {
            positions.push(hexVertices[i]);
        }
    }
    return positions;
}

// 돔 객체 캐싱
const authScreen = document.getElementById("auth-screen");
const gameScreen = document.getElementById("game-screen");
const boardEl = document.getElementById("board");

document.getElementById("btn-create-room").addEventListener("click", async () => {
    myName = document.getElementById("user-name").value.trim();
    if (!myName) return alert("닉네임을 먼저 입력해 주세요!");

    let uniqueIdFound = false;
    let generatedCode = "";

    // 1000 ~ 9999 사이 중복되지 않는 방 코드가 나올 때까지 DB 검증 수행
    while (!uniqueIdFound) {
        generatedCode = Math.floor(1000 + Math.random() * 9000).toString();
        const roomRef = ref(db, `rooms/${generatedCode}`);
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

    await set(ref(db, `rooms/${roomId}`), roomData);
    
    alert(`방이 개설되었습니다! 방 코드 [ ${roomId} ]를 팀원들에게 공유하세요.`);
    enterGameScreen();
});

// --- 1-2. 대기실 액션 핸들러: 기존 방 코드로 참여하기 ---
document.getElementById("btn-join-room").addEventListener("click", async () => {
    roomId = document.getElementById("room-id").value.trim();
    myName = document.getElementById("user-name").value.trim();

    if (!roomId || !myName) return alert("닉네임과 4자리 방 코드를 모두 입력해 주세요!");

    const roomRef = ref(db, `rooms/${roomId}`);
    const snapshot = await get(roomRef);
    
    if (!snapshot.exists()) return alert("존재하지 않는 방 코드입니다. 코드를 다시 확인하세요.");
    
    const roomData = snapshot.val();
    if (roomData.status !== "waiting") return alert("이미 게임이 진행 중이거나 종료된 방입니다.");

    const currentPlayers = roomData.players ? Object.keys(roomData.players) : [];
    if (currentPlayers.length >= 6) return alert("방 정원(6명)이 초과되어 입장할 수 없습니다.");

    // 순서대로 고유 컬러 배정
    const colorIdx = currentPlayers.length;
    const playerInfo = {
        name: myName,
        color: playerColors[colorIdx],
        isReady: false
    };

    await update(ref(db, `rooms/${roomId}/players/${myUid}`), playerInfo);
    enterGameScreen();
});

// 화면 전환 및 동기화 활성화 공통 함수
function enterGameScreen() {
    authScreen.style.display = "none";
    gameScreen.style.display = "flex";
    initRealtimeSync();
}

// --- 2. 실시간 파이어베이스 연동 리스너 활성화 ---
function initRealtimeSync() {
    onValue(ref(db, `rooms/${roomId}`), (snapshot) => {
        if (!snapshot.exists()) return;
        gameState = snapshot.val();

        renderHexBoard();
        renderStatusPanel();
        renderGameLogs();

        // 호스트 권한 스타트 버튼 제어 (최대 6명 가능)
        if (gameState.status === "waiting") {
            if (gameState.host === myUid) {
                document.getElementById("btn-start-game").style.display = "block";
            }
            document.getElementById("turn-display").innerText = `팀 대기 중 (${Object.keys(gameState.players).length}/6명)...`;
        } else {
            document.getElementById("btn-start-game").style.display = "none";
        }

        // 지뢰 설치 셋업 단계 전환 핸들링
        if (gameState.status === "setup") {
            const me = gameState.players[myUid];
            if (me && !me.isReady) {
                document.getElementById("setup-controls").style.display = "flex";
                document.getElementById("turn-display").innerText = "출발점을 제외하고 지뢰 5개를 배치하세요.";
            } else {
                document.getElementById("setup-controls").style.display = "none";
                document.getElementById("turn-display").innerText = "다른 팀이 지뢰를 배치하고 있습니다...";
            }

            const allReady = Object.values(gameState.players).every(p => p.isReady);
            if (allReady && gameState.host === myUid) {
                update(ref(db, `rooms/${roomId}`), { status: "playing" });
            }
        }

        // 실시간 턴 배정 보드 모드 처리
        if (gameState.status === "playing") {
            document.getElementById("setup-controls").style.display = "none";
            const currentTurnUid = gameState.turnOrder[gameState.currentTurnIdx];
            
            if (currentTurnUid === myUid) {
                document.getElementById("turn-display").innerText = "★ 당신의 턴입니다! 인접한 육각 칸으로 전진하세요.";
                highlightMovableHexagons();
            } else {
                const activeName = gameState.players[currentTurnUid]?.name || "상대방";
                document.getElementById("turn-display").innerText = `현재 차례: [ ${activeName} ] 이동 중...`;
            }
        }

        if (gameState.status === "finished") {
            document.getElementById("turn-display").innerText = "🚨 게임 종료! 승리팀이 결정되었습니다.";
        }
    });
}

// --- 3. 육각형 맵 연산 구조 기반 동적 렌더링 ---
function renderHexBoard() {
    boardEl.innerHTML = "";
    const totalCount = gameState.turnOrder ? gameState.turnOrder.length : 2;
    const activeSpawns = getSpawnPositions(totalCount);

    for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
            const cell = document.createElement("div");
            cell.classList.add("cell");
            cell.dataset.r = r;
            cell.dataset.c = c;

            // 홀수 행은 우측으로 가로 폭의 반(28px)만큼 오프셋 이동 마진을 줌
            const xOffset = r % 2 === 1 ? 28 : 0;
            const leftPos = c * 58 + xOffset;
            const topPos = r * 46; 

            cell.style.left = `${leftPos}px`;
            cell.style.top = `${topPos}px`;

            // 중앙 보석 조건 처리
            if (r === 4 && c === 4) {
                cell.classList.add("center-gem");
                cell.innerText = "💎";
            }

            // 이번 매치 인원수 기획 기준 활성화된 리스폰 시작점 타일 강조
            activeSpawns.forEach(spawn => {
                if (spawn.r === r && spawn.c === c) cell.classList.add("corner-start");
            });

            // 내가 직접 설치 진행 중인 지뢰 하이라이트
            if (myMines.includes(`${r},${c}`)) cell.classList.add("my-mine");

            cell.addEventListener("click", () => handleHexClick(r, c));
            boardEl.appendChild(cell);
        }
    }

    injectTokensAndHints();
}

// --- 4. 정육각형(Hex) Offset 기준 인접 6칸 연산 알고리즘 ---
function getNeighbors(r, c) {
    const neighbors = [];
    const offsets = (r % 2 === 1) ? 
        [ {dr:-1, dc:0}, {dr:-1, dc:1}, {dr:0, dc:-1}, {dr:0, dc:1}, {dr:1, dc:0}, {dr:1, dc:1} ] : 
        [ {dr:-1, dc:-1}, {dr:-1, dc:0}, {dr:0, dc:-1}, {dr:0, dc:1}, {dr:1, dc:-1}, {dr:1, dc:0} ]; 

    offsets.forEach(off => {
        const nr = r + off.dr;
        const nc = c + off.dc;
        if (nr >= 0 && nr < 9 && nc >= 0 && nc < 9) {
            neighbors.push({ r: nr, c: nc });
        }
    });
    return neighbors;
}

// --- 5. 육각 타일 클릭 이벤트 제어 ---
function handleHexClick(r, c) {
    const coord = `${r},${c}`;
    const totalCount = gameState.turnOrder ? gameState.turnOrder.length : 2;
    const activeSpawns = getSpawnPositions(totalCount);

    if (gameState.status === "setup") {
        if (r === 4 && c === 4) return alert("보석 칸에는 지뢰 매설이 금지됩니다!");
        
        // 현재 인원 구성상 배정된 모든 유저의 출발역 주변 배치 보호막 작동
        let isNearStart = false;
        activeSpawns.forEach(spawn => {
            if (Math.abs(spawn.r - r) <= 1 && Math.abs(spawn.c - c) <= 1) isNearStart = true;
        });
        if (isNearStart) return alert("플레이어들의 대칭 출발점 반경 1칸 안에는 지뢰를 깔 수 없습니다!");

        const idx = myMines.indexOf(coord);
        if (idx > -1) {
            myMines.splice(idx, 1);
        } else {
            if (myMines.length >= 5) return alert("지뢰는 최대 5개까지만 깔 수 있습니다.");
            myMines.push(coord);
        }
        renderHexBoard();
        document.getElementById("mine-count").innerText = `지뢰 설치 필요: ${5 - myMines.length}개`;
        document.getElementById("btn-submit-mine").disabled = myMines.length !== 5;
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

    while (myMines.length < 5) {
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
    document.getElementById("mine-count").innerText = `지뢰 설치 필요: 0개`;
    document.getElementById("btn-submit-mine").disabled = false;
});

// 지뢰 제출하기 최종 확정
document.getElementById("btn-submit-mine").addEventListener("click", () => {
    myMines.forEach(coord => {
        update(ref(db, `rooms/${roomId}/mines/${coord}`), { [myUid]: true });
    });
    update(ref(db, `rooms/${roomId}/players/${myUid}`), { isReady: true });
    document.getElementById("setup-controls").style.display = "none";
});

// --- 6. 호스트의 게임 셔플 스타트 액션 (인원수 맞춤 스타트) ---
document.getElementById("btn-start-game").addEventListener("click", async () => {
    const roomRef = ref(db, `rooms/${roomId}`);
    const snapshot = await get(roomRef);
    if (!snapshot.exists()) return;

    const uids = Object.keys(snapshot.val().players);
    if (uids.length < 2) return alert("최소 2명 이상 입장해야 시작할 수 있습니다.");

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

// --- 7. 서버 경유 동기화 기반 이동 프로세서 ---
async function executeHexMove(tr, tc) {
    const roomRef = ref(db, `rooms/${roomId}`);
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

    const mineSnap = await get(ref(db, `rooms/${roomId}/mines/${coord}`));
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