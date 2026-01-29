document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    // 화면 요소
    const screens = {
        nickname: document.getElementById('nickname-screen'),
        lobbySelect: document.getElementById('lobby-select-screen'),
        lobby: document.getElementById('lobby-screen'),
        game: document.getElementById('game-screen'),
        gameOver: document.getElementById('game-over-screen'),
    };

    // 입력 및 버튼 요소
    const nicknameInput = document.getElementById('nickname-input');
    const nicknameSubmitBtn = document.getElementById('nickname-submit');
    const userNicknameSpan = document.getElementById('user-nickname');
    
    const createRoomInput = document.getElementById('create-room-code-input');
    const createRoomBtn = document.getElementById('create-room-btn');
    const joinRoomInput = document.getElementById('room-code-input');
    const joinRoomBtn = document.getElementById('join-room-btn');
    
    const lobbyRoomCodeSpan = document.getElementById('lobby-room-code');
    const playerListUl = document.getElementById('player-list');
    const startGameBtn = document.getElementById('start-game-btn');

    const gameBoard = document.getElementById('game-board');
    const movePawnBtn = document.getElementById('move-pawn-btn');
    const placeWallBtn = document.getElementById('place-wall-btn');
    const rotateWallBtn = document.getElementById('rotate-wall-btn');
    const cancelActionBtn = document.getElementById('cancel-action-btn');
    const wallPreview = document.getElementById('wall-preview');

    const chatInput = document.getElementById('chat-input');
    const chatSendBtn = document.getElementById('chat-send-btn');
    const chatMessagesUl = document.getElementById('chat-messages');
    const onlineUserListUl = document.getElementById('online-user-list');

    let currentRoomCode = null;
    let myNickname = '';
    let currentGameState = null;
    let currentAction = null; // 'move' or 'wall'
    let wallOrientation = 'horizontal';


    // --- 유틸리티 함수 ---
    function showScreen(screenName) {
        Object.values(screens).forEach(screen => screen.classList.add('hidden'));
        screens[screenName].classList.remove('hidden');
    }

    function addChatMessage(nickname, text) {
        const li = document.createElement('li');
        li.textContent = `${nickname}: ${text}`;
        chatMessagesUl.appendChild(li);
        chatMessagesUl.scrollTop = chatMessagesUl.scrollHeight;
    }

    // --- 이벤트 핸들러 ---
    nicknameSubmitBtn.addEventListener('click', () => {
        const nickname = nicknameInput.value.trim();
        if (nickname) {
            myNickname = nickname;
            socket.emit('set-nickname', nickname);
        }
    });

    createRoomBtn.addEventListener('click', () => {
        const roomCode = createRoomInput.value.trim();
        if (roomCode) {
            socket.emit('create-room', roomCode);
        }
    });

    joinRoomBtn.addEventListener('click', () => {
        const roomCode = joinRoomInput.value.trim();
        if (roomCode) {
            socket.emit('join-room', roomCode);
        }
    });
    
    startGameBtn.addEventListener('click', () => {
        socket.emit('start-game', currentRoomCode);
    });

    chatSendBtn.addEventListener('click', () => {
        const message = chatInput.value.trim();
        if (message) {
            socket.emit('send-chat-message', message);
            chatInput.value = '';
        }
    });
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            chatSendBtn.click();
        }
    });

    // --- 게임 액션 버튼 ---
    movePawnBtn.addEventListener('click', () => {
        currentAction = 'move';
        cancelActionBtn.classList.remove('hidden');
        highlightPossibleMoves();
    });

    placeWallBtn.addEventListener('click', () => {
        currentAction = 'wall';
        cancelActionBtn.classList.remove('hidden');
        rotateWallBtn.classList.remove('hidden');
        wallPreview.classList.remove('hidden');
    });
    
    rotateWallBtn.addEventListener('click', () => {
        wallOrientation = (wallOrientation === 'horizontal') ? 'vertical' : 'horizontal';
        wallPreview.className = `wall hidden ${wallOrientation}`;
    });

    cancelActionBtn.addEventListener('click', () => {
        currentAction = null;
        cancelActionBtn.classList.add('hidden');
        rotateWallBtn.classList.add('hidden');
        wallPreview.classList.add('hidden');
        clearHighlights();
    });

    // --- 소켓 이벤트 리스너 ---
    socket.on('nickname-set', () => {
        userNicknameSpan.textContent = myNickname;
        showScreen('lobbySelect');
    });

    socket.on('update-user-list', (users) => {
        onlineUserListUl.innerHTML = '';
        users.forEach(user => {
            const li = document.createElement('li');
            li.textContent = user.nickname;
            onlineUserListUl.appendChild(li);
        });
    });

    socket.on('room-created', (roomCode) => {
        currentRoomCode = roomCode;
        lobbyRoomCodeSpan.textContent = roomCode;
        showScreen('lobby');
    });
    
    socket.on('joined-room', (roomCode) => {
        currentRoomCode = roomCode;
        lobbyRoomCodeSpan.textContent = roomCode;
        showScreen('lobby');
    });

    socket.on('update-lobby', (room) => {
        playerListUl.innerHTML = '';
        room.players.forEach((player, index) => {
            const li = document.createElement('li');
            li.textContent = `${player.nickname} ${player.id === room.host ? '(방장)' : ''}`;
            playerListUl.appendChild(li);
        });
        if (room.host === socket.id) {
            startGameBtn.classList.remove('hidden');
        } else {
            startGameBtn.classList.add('hidden');
        }
    });

    socket.on('game-started', (gameState) => {
        currentGameState = gameState;
        drawBoard();
        updateGameUI();
        showScreen('game');
    });
    
    socket.on('update-game-state', (gameState) => {
        currentGameState = gameState;
        drawBoard();
        updateGameUI();
        cancelActionBtn.click(); // 액션 초기화
    });

    socket.on('game-over', (winnerNickname) => {
        document.getElementById('winner-announcement').textContent = `${winnerNickname}님이 승리했습니다!`;
        showScreen('gameOver');
        setTimeout(() => {
            // 로비 선택 화면으로 돌아가기
            currentRoomCode = null;
            currentGameState = null;
            showScreen('lobbySelect');
        }, 10000);
    });

    socket.on('error-message', (message) => {
        alert(message);
    });

    socket.on('chat-message', (data) => {
        addChatMessage(data.nickname, data.text);
    });

    // --- Client-side Game Logic Helpers ---

    // Checks if a direct move from (r1, c1) to (r2, c2) is blocked by a wall
    function isMoveBlockedByWall(r1, c1, r2, c2, walls) {
        if (r1 === r2) { // Horizontal move
            const wallCol = Math.min(c1, c2);
            for (const wall of walls) {
                if (wall.orientation === 'vertical' && wall.col === wallCol && (wall.row === r1 || wall.row === r1 - 1)) {
                    return true;
                }
            }
        } else { // Vertical move
            const wallRow = Math.min(r1, r2);
            for (const wall of walls) {
                if (wall.orientation === 'horizontal' && wall.row === wallRow && (wall.col === c1 || wall.col === c1 - 1)) {
                    return true;
                }
            }
        }
        return false;
    }

    // --- 게임 로직 및 렌더링 ---
    function drawBoard() {
        gameBoard.innerHTML = '';
        // 9x9 칸 생성
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                const square = document.createElement('div');
                square.className = 'square';
                square.dataset.row = r;
                square.dataset.col = c;
                gameBoard.appendChild(square);
            }
        }

        // 플레이어 말 렌더링
        currentGameState.players.forEach((player, index) => {
            const square = gameBoard.querySelector(`[data-row='${player.row}'][data-col='${player.col}']`);
            if (square) {
                const pawn = document.createElement('div');
                pawn.className = `pawn pawn-${index}`;
                square.appendChild(pawn);
            }
        });
        
        const boardContainer = document.getElementById('board-container');
        // Remove old walls before drawing new ones
        boardContainer.querySelectorAll('.wall:not(#wall-preview)').forEach(w => w.remove());

        // 벽 렌더링
        currentGameState.walls.forEach(wall => {
            const wallDiv = document.createElement('div');
            wallDiv.classList.add('wall', wall.orientation);
            
            const squarePercentage = 100 / 9;

            if (wall.orientation === 'horizontal') {
                wallDiv.style.top = `${(wall.row + 1) * squarePercentage}%`;
                wallDiv.style.left = `${wall.col * squarePercentage}%`;
            } else { // vertical
                wallDiv.style.top = `${wall.row * squarePercentage}%`;
                wallDiv.style.left = `${(wall.col + 1) * squarePercentage}%`;
            }
            
            boardContainer.appendChild(wallDiv);
        });
    }
    
    function updateGameUI() {
        const myPlayer = currentGameState.players.find(p => p.id === socket.id);
        const currentPlayer = currentGameState.players[currentGameState.turnIndex];

        document.getElementById('current-turn-player').textContent = currentPlayer.nickname;
        document.getElementById('walls-left').textContent = myPlayer.wallsLeft;

        if (currentPlayer.id === socket.id) {
            movePawnBtn.disabled = false;
            placeWallBtn.disabled = myPlayer.wallsLeft <= 0;
        } else {
            movePawnBtn.disabled = true;
            placeWallBtn.disabled = true;
        }
    }

    function clearHighlights() {
        document.querySelectorAll('.highlight').forEach(el => el.classList.remove('highlight'));
    }

    function highlightPossibleMoves() {
        clearHighlights();
        if (!currentGameState) return;

        const myPawn = currentGameState.players.find(p => p.id === socket.id);
        const { players, walls } = currentGameState;
        const { row, col } = myPawn;
        const validMoves = new Set();
        const boardSize = 9;

        const directions = [ { dr: -1, dc: 0 }, { dr: 1, dc: 0 }, { dr: 0, dc: -1 }, { dr: 0, dc: 1 } ];

        for (const { dr, dc } of directions) {
            const nextRow = row + dr;
            const nextCol = col + dc;

            if (nextRow < 0 || nextRow >= boardSize || nextCol < 0 || nextCol >= boardSize) continue;
            if (isMoveBlockedByWall(row, col, nextRow, nextCol, walls)) continue;

            const opponent = players.find(p => p.row === nextRow && p.col === nextCol);

            if (opponent) {
                const jumpRow = nextRow + dr;
                const jumpCol = nextCol + dc;
                const jumpBlocked = jumpRow < 0 || jumpRow >= boardSize || jumpCol < 0 || jumpCol >= boardSize || isMoveBlockedByWall(nextRow, nextCol, jumpRow, jumpCol, walls);

                if (!jumpBlocked) {
                    validMoves.add(`${jumpRow},${jumpCol}`);
                } else {
                    if (dc === 0) { // Vertical move attempt -> check left/right
                        if (nextCol - 1 >= 0 && !isMoveBlockedByWall(nextRow, nextCol, nextRow, nextCol - 1, walls)) validMoves.add(`${nextRow},${nextCol - 1}`);
                        if (nextCol + 1 < boardSize && !isMoveBlockedByWall(nextRow, nextCol, nextRow, nextCol + 1, walls)) validMoves.add(`${nextRow},${nextCol + 1}`);
                    } else { // Horizontal move attempt -> check up/down
                        if (nextRow - 1 >= 0 && !isMoveBlockedByWall(nextRow, nextCol, nextRow - 1, nextCol, walls)) validMoves.add(`${nextRow - 1},${nextCol}`);
                        if (nextRow + 1 < boardSize && !isMoveBlockedByWall(nextRow, nextCol, nextRow + 1, nextCol, walls)) validMoves.add(`${nextRow + 1},${nextCol}`);
                    }
                }
            } else {
                validMoves.add(`${nextRow},${nextCol}`);
            }
        }

        validMoves.forEach(move => {
            const [r, c] = move.split(',');
            const square = gameBoard.querySelector(`[data-row='${r}'][data-col='${c}']`);
            if (square) {
                square.classList.add('highlight');
            }
        });
    }

    // 보드 클릭/마우스 이벤트
    gameBoard.addEventListener('click', (e) => {
        if (currentAction === 'move' && e.target.classList.contains('highlight')) {
            const row = parseInt(e.target.dataset.row);
            const col = parseInt(e.target.dataset.col);
            socket.emit('game-action', currentRoomCode, {
                type: 'move',
                payload: { row, col }
            });
        } else if (currentAction === 'wall') {
            const row = parseInt(wallPreview.dataset.row);
            const col = parseInt(wallPreview.dataset.col);

            if (row >= 0 && col >= 0) {
                socket.emit('game-action', currentRoomCode, {
                    type: 'place-wall',
                    payload: { row, col, orientation: wallOrientation }
                });
            }
        }
    });

    // 벽 미리보기 로직
    gameBoard.addEventListener('mousemove', (e) => {
        if (currentAction !== 'wall') return;
        
        const boardRect = gameBoard.getBoundingClientRect();
        const x = e.clientX - boardRect.left;
        const y = e.clientY - boardRect.top;

        const squareSize = boardRect.width / 9;
        const squarePercentage = 100 / 9;

        let snapRow, snapCol;

        if (wallOrientation === 'horizontal') {
            snapRow = Math.round(y / squareSize) - 1;
            snapCol = Math.floor(x / squareSize);
            snapCol = Math.max(0, Math.min(7, snapCol));
            snapRow = Math.max(0, Math.min(7, snapRow));
            wallPreview.style.top = `${(snapRow + 1) * squarePercentage}%`;
            wallPreview.style.left = `${snapCol * squarePercentage}%`;
        } else { // vertical
            snapCol = Math.round(x / squareSize) - 1;
            snapRow = Math.floor(y / squareSize);
            snapRow = Math.max(0, Math.min(7, snapRow));
            snapCol = Math.max(0, Math.min(7, snapCol));
            wallPreview.style.top = `${snapRow * squarePercentage}%`;
            wallPreview.style.left = `${(snapCol + 1) * squarePercentage}%`;
        }
        wallPreview.dataset.row = snapRow;
        wallPreview.dataset.col = snapCol;
    });

    // 초기 화면 표시
    showScreen('nickname');
});
