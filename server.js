const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));

let rooms = {};
let connectedUsers = {};

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);
    connectedUsers[socket.id] = { nickname: 'Anonymous' };
    io.emit('update-user-list', Object.values(connectedUsers));

    socket.on('set-nickname', (nickname) => {
        if (connectedUsers[socket.id]) {
            connectedUsers[socket.id].nickname = nickname;
            io.emit('update-user-list', Object.values(connectedUsers));
            socket.emit('nickname-set');
        }
    });

    socket.on('create-room', (roomCode) => {
        if (rooms[roomCode]) {
            socket.emit('error-message', '이미 존재하는 방 코드입니다.');
            return;
        }
        socket.join(roomCode);
        rooms[roomCode] = {
            players: [{ id: socket.id, nickname: connectedUsers[socket.id].nickname }],
            host: socket.id,
            gameState: null // 게임 시작 전
        };
        socket.emit('room-created', roomCode);
        io.to(roomCode).emit('update-lobby', rooms[roomCode]);
    });

    socket.on('join-room', (roomCode) => {
        if (!rooms[roomCode]) {
            socket.emit('error-message', '존재하지 않는 방 코드입니다.');
            return;
        }
        if (rooms[roomCode].players.length >= 4) {
            socket.emit('error-message', '방이 가득 찼습니다.');
            return;
        }
        socket.join(roomCode);
        rooms[roomCode].players.push({ id: socket.id, nickname: connectedUsers[socket.id].nickname });
        io.to(roomCode).emit('update-lobby', rooms[roomCode]);
        socket.emit('joined-room', roomCode);
    });
    
    socket.on('start-game', (roomCode) => {
        if (rooms[roomCode] && rooms[roomCode].host === socket.id) {
            const room = rooms[roomCode];
            if (room.players.length < 2) {
                socket.emit('error-message', '게임를 시작하려면 최소 2명이 필요합니다.');
                return;
            }
            
            // 게임 상태 초기화
            const wallCount = room.players.length < 4 ? 10 : 5;
            const playerPositions = [
                { row: 0, col: 4 },
                { row: 8, col: 4 },
                { row: 4, col: 0 },
                { row: 4, col: 8 }
            ];
            const destinationRows = [8, 0, 8, 0]; // 각 플레이어의 목표 도착 라인

            room.gameState = {
                board: Array(9).fill(null).map(() => Array(9).fill(null)),
                walls: [], // { row, col, orientation }
                players: room.players.map((p, i) => ({
                    id: p.id,
                    nickname: p.nickname,
                    ...playerPositions[i],
                    wallsLeft: wallCount,
                    destination: destinationRows[i]
                })),
                turnIndex: Math.floor(Math.random() * room.players.length)
            };

            io.to(roomCode).emit('game-started', room.gameState);
        }
    });

    // --- Helper functions for game logic validation ---

    // Checks if a direct move from (r1, c1) to (r2, c2) is blocked by a wall
    function isMoveBlockedByWall(r1, c1, r2, c2, walls) {
        if (r1 === r2) { // Horizontal move
            const wallCol = Math.min(c1, c2);
            for (const wall of walls) {
                // A vertical wall at (r, wallCol) can block.
                // It blocks if its row `wall.row` is `r1` or `r1-1`.
                if (wall.orientation === 'vertical' && wall.col === wallCol && (wall.row === r1 || wall.row === r1 - 1)) {
                    return true;
                }
            }
        } else { // Vertical move
            const wallRow = Math.min(r1, r2);
            for (const wall of walls) {
                // A horizontal wall at (wallRow, c) can block.
                // It blocks if its col `wall.col` is `c1` or `c1-1`.
                if (wall.orientation === 'horizontal' && wall.row === wallRow && (wall.col === c1 || wall.col === c1 - 1)) {
                    return true;
                }
            }
        }
        return false;
    }

    // BFS to check if a path exists for a single player
    function pathExistsForPlayer(player, walls) {
        const queue = [{ row: player.row, col: player.col }];
        const visited = new Set([`${player.row},${player.col}`]);
        const boardSize = 9;

        while (queue.length > 0) {
            const { row, col } = queue.shift();

            // Check if destination is reached
            if (row === player.destination) {
                return true;
            }

            // Possible moves: up, down, left, right
            const moves = [[-1, 0], [1, 0], [0, -1], [0, 1]];
            for (const [dr, dc] of moves) {
                const newRow = row + dr;
                const newCol = col + dc;

                if (newRow >= 0 && newRow < boardSize && newCol >= 0 && newCol < boardSize) {
                    const key = `${newRow},${newCol}`;
                    if (!visited.has(key) && !isMoveBlockedByWall(row, col, newRow, newCol, walls)) {
                        visited.add(key);
                        queue.push({ row: newRow, col: newCol });
                    }
                }
            }
        }
        return false; // No path found
    }

    // Checks if a wall placement is valid
    function isValidWallPlacement(newWall, gameState) {
        const { players, walls } = gameState;

        // 1. Check for out of bounds (walls are placed between cells, so 8x8 grid for origins)
        if (newWall.row < 0 || newWall.row > 7 || newWall.col < 0 || newWall.col > 7) {
            return false;
        }

        // 2. Check for collision with existing walls
        for (const wall of walls) {
            // Exact same spot
            if (wall.row === newWall.row && wall.col === newWall.col && wall.orientation === newWall.orientation) {
                return false;
            }
            // Crossing walls at the same intersection
            if (wall.row === newWall.row && wall.col === newWall.col && wall.orientation !== newWall.orientation) {
                return false;
            }
            // Overlapping parallel walls
            if (wall.orientation === newWall.orientation) {
                if (wall.orientation === 'horizontal' && wall.row === newWall.row && Math.abs(wall.col - newWall.col) < 2) {
                    return false;
                }
                if (wall.orientation === 'vertical' && wall.col === newWall.col && Math.abs(wall.row - newWall.row) < 2) {
                    return false;
                }
            }
        }

        // 3. Check if it blocks any player's path
        const tempWalls = [...walls, newWall];
        for (const p of players) {
            if (!pathExistsForPlayer(p, tempWalls)) {
                return false; // This placement blocks a player
            }
        }

        return true;
    }

    function getValidMoves(player, gameState) {
        const { players, walls } = gameState;
        const { row, col } = player;
        const validMoves = new Set(); // Use a Set to avoid duplicate moves
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
        return Array.from(validMoves).map(s => { const [r, c] = s.split(','); return { row: parseInt(r), col: parseInt(c) }; });
    }

    socket.on('game-action', (roomCode, action) => {
        const room = rooms[roomCode];
        if (!room || !room.gameState) return;

        const player = room.gameState.players[room.gameState.turnIndex];
        if (player.id !== socket.id) {
            socket.emit('error-message', '당신의 턴이 아닙니다.');
            return;
        }

        if (action.type === 'move') {
            const validMoves = getValidMoves(player, room.gameState);
            const isMoveValid = validMoves.some(move => move.row === action.payload.row && move.col === action.payload.col);

            if (!isMoveValid) {
                socket.emit('error-message', '유효하지 않은 움직임입니다.');
                return;
            }

            room.gameState.players[room.gameState.turnIndex].row = action.payload.row;
            room.gameState.players[room.gameState.turnIndex].col = action.payload.col;
            
            // 승리 조건 확인
            if (action.payload.row === player.destination) {
                 io.to(roomCode).emit('game-over', player.nickname);
                 setTimeout(() => {
                    if (rooms[roomCode]) delete rooms[roomCode];
                 }, 10000);
                 return;
            }

        } else if (action.type === 'place-wall') {
            if (player.wallsLeft <= 0) {
                socket.emit('error-message', '남은 장애물이 없습니다.');
                return;
            }

            if (isValidWallPlacement(action.payload, room.gameState)) {
                room.gameState.walls.push(action.payload);
                room.gameState.players[room.gameState.turnIndex].wallsLeft--;
            } else {
                socket.emit('error-message', '유효하지 않은 장애물 위치입니다.');
                return; // Don't proceed to next turn
            }
        }

        // 다음 턴으로
        room.gameState.turnIndex = (room.gameState.turnIndex + 1) % room.gameState.players.length;
        io.to(roomCode).emit('update-game-state', room.gameState);
    });

    socket.on('send-chat-message', (message) => {
        const user = connectedUsers[socket.id];
        io.emit('chat-message', { nickname: user.nickname, text: message });
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        // 방에서 플레이어 제거 로직
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            const playerIndex = room.players.findIndex(p => p.id === socket.id);
            if (playerIndex > -1) {
                room.players.splice(playerIndex, 1);
                if (room.players.length === 0) {
                    delete rooms[roomCode]; // 방이 비면 삭제
                } else {
                    // 호스트가 나가면 다음 사람에게 호스트 위임
                    if (room.host === socket.id) {
                        room.host = room.players[0].id;
                    }
                    io.to(roomCode).emit('update-lobby', room);
                }
                break;
            }
        }
        delete connectedUsers[socket.id];
        io.emit('update-user-list', Object.values(connectedUsers));
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
