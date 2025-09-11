const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// 대기 중인 플레이어 목록
const waitingPlayers = [];

io.on('connection', (socket) => {
    console.log('새로운 유저가 접속했습니다:', socket.id);

    // 1. 대기 중인 플레이어가 있는지 확인
    if (waitingPlayers.length > 0) {
        // 대기 중인 플레이어가 있다면, 이미 생성된 방에 두 번째 플레이어 조인
        const player1 = waitingPlayers.pop();
        const player2 = socket;

        // player1이 이미 생성해둔 방 이름 가져오기
        const roomName = player1.roomName; // 'roomName' 속성을 사용하여 방 이름 가져오기

        // 두 번째 플레이어를 방에 조인
        player2.join(roomName);

        socket.emit('second', { room: roomName });

        // 두 플레이어에게 게임 시작 메시지 전송
        io.to(roomName).emit('gameStart', {
            room: roomName,
            player1: player1.id,
            player2: player2.id
        });

        console.log(`[게임 시작] 방: ${roomName}, 플레이어: ${player1.id}, ${player2.id}`);

    } else {
        // 대기 중인 플레이어가 없다면, 첫 번째 플레이어가 방을 만들고 대기
        const roomName = `room-${socket.id}`;
        socket.join(roomName); // 플레이어를 방에 조인시킴

        // 방 이름 정보를 소켓에 저장
        socket.roomName = roomName;

        // 대기 목록에 추가
        waitingPlayers.push(socket);
        socket.emit('waitingForPlayer', { room: roomName });
        console.log(`[방 생성 및 대기] 유저 ${socket.id}가 방 ${roomName}을 만들고 다른 플레이어를 기다립니다.`);
    }

    // 2. 클라이언트가 'placeStone' 이벤트를 보낼 때
    socket.on('placeStone', (data) => {
        const { room, x, y } = data; // 방 이름, x, y 좌표 받기
        console.log(`방 ${room}에서 플레이어 ${socket.id}가 (${x}, ${y})에 돌을 놓았습니다.`);

        // 해당 방의 모든 클라이언트에게 돌이 놓인 위치를 브로드캐스트
        io.to(room).emit('stonePlaced', {
            x,
            y,
            player: socket.id
        });
    });

    // 3. 클라이언트와 연결이 끊어지면 실행될 이벤트
    socket.on('disconnect', () => {
        console.log('유저 연결이 끊어졌습니다:', socket.id);

        // 만약 대기 중인 플레이어였다면, 목록에서 제거
        const index = waitingPlayers.indexOf(socket);
        if (index !== -1) {
            waitingPlayers.splice(index, 1);
        }
    });
});

server.listen(PORT, () => {
    console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
});