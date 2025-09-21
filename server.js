const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { MongoClient } = require('mongodb'); // MongoDB 라이브러리 추가
const bcrypt = require('bcrypt'); // bcrypt 라이브러리 추가
const { log } = require('console');

// express 애플리케이션 생성
const app = express();
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// MongoDB 연결 URI
// const uri = 'mongodb://localhost:27017'; // 로컬 MongoDB 주소
const uri = 'mongodb+srv://jong:omok14@cluster0.fkvfgft.mongodb.net/'; // MongoDB 주소
const client = new MongoClient(uri);

// 데이터베이스와 컬렉션 이름 설정
const dbName = 'omokgame';
const usersCollectionName = 'users';

// MongoDB 연결 함수
async function connectToMongo() {
    try {
        await client.connect();
        console.log('MongoDB에 성공적으로 연결되었습니다.');
    } catch (err) {
        console.error('MongoDB 연결 오류:', err);
    }
}

// 서버 시작 시 MongoDB 연결
connectToMongo();

// 회원가입시 아이디 중복 체크
app.post('/api/check-username', async (req, res) => {
    const { username } = req.body;
    const db = client.db(dbName);
    const users = db.collection(usersCollectionName);
    const existingUser = await users.findOne({ username });

    if (existingUser) {
        // 아이디가 이미 존재함
        return res.status(409).json({ success: false, message: '이미 존재하는 아이디입니다.' });
    } else {
        // 아이디 사용 가능
        return res.status(200).json({ success: true, message: '사용 가능한 아이디입니다.' });
    }
})

// 회원가입 API 엔드포인트
app.post('/api/signup', async (req, res) => {
    const { username, password, nickname } = req.body;
    const db = client.db(dbName);
    const users = db.collection(usersCollectionName);

    // 아이디 중복 확인
    const existingUser = await users.findOne({ username });
    if (existingUser) {
        return res.status(409).json({ success: false, message: '이미 존재하는 아이디입니다.', result: "id" });
    }

    // 비밀번호를 해시(암호화)
    const saltRounds = 10; // 해시 강도 설정
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // 새 사용자 정보 저장 (닉네임, 암호화된 비밀번호 포함)
    await users.insertOne({ username, password: hashedPassword, nickname });
    res.status(201).json({ success: true, message: '회원가입이 완료되었습니다.' });
});

// 로그인 API 엔드포인트
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const db = client.db(dbName);
    const users = db.collection(usersCollectionName);

    const user = await users.findOne({ username });
    if (!user) {
        return res.status(401).json({ success: false, message: '아이디가 존재하지 않습니다.', result: "id" });
    }

    // 입력된 비밀번호와 저장된 해시 비밀번호를 비교
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
        return res.status(401).json({ success: false, message: '비밀번호가 일치하지 않습니다.', result: "password" });
    }

    res.status(200).json({ success: true, message: '로그인 성공!', nickname: user.nickname });
});


// 대기 중인 플레이어 목록
const waitingRooms = {};

io.on('connection', (socket) => {
    console.log('새로운 유저가 접속했습니다:', socket.id);

    socket.on('registerNickname', (data) => {
        const { nickname } = data;
        socket.nickname = nickname;
    })

    socket.on('getRooms', () => {
        // 현재 대기 중인 방들의 목록을 배열로 만들어서 전송
        const roomsList = Object.keys(waitingRooms).map(roomName => ({
            roomName: roomName,
            mode: waitingRooms[roomName].mode
        }));
        socket.emit('roomsList', { rooms: roomsList });
        console.log(`[방 목록 제공] 유저에게 방 목록을 전송했습니다.`);
    });

    socket.on('joinRoomCheck', (data) => {
        const { roomName, mode } = data;
        // 해당 방이 존재하는지, 그리고 플레이어가 조인할 수 있는지 확인
        if (waitingRooms[roomName]) {
            socket.emit('joinRoomSuccess', { roomName, mode });
        } else {
            // 방이 존재하지 않거나, 이미 게임이 시작된 경우
            socket.emit('joinRoomFailed');
        }
    });

    socket.on('joinRoom', (data) => {
        const { roomName } = data;

        const player1 = waitingRooms[roomName];
        const player2 = socket;

        // 두 번째 플레이어를 방에 조인
        player2.join(roomName);
        socket.emit('joinRoom', { room: roomName });

        delete player1.createdRoomName;

        // waitingRooms에서 해당 방 제거 (게임 시작했으므로)
        delete waitingRooms[roomName];

        io.to(roomName).emit('gameStart', {
            room: roomName,
            player1: player1.nickname,
            player2: player2.nickname
        });

        console.log(`[게임 시작] 방: ${roomName}, 플레이어: ${player1.nickname}, ${player2.nickname}`);
    });

    socket.on('createRoomCheck', (data) => {
        const { roomName, mode } = data;
        if (waitingRooms[roomName])
            socket.emit('createRoomFailed')
        else
            socket.emit('createRoomSuccess', { roomName, mode })
    });

    // 3. 클라이언트가 새로운 방을 만들 때
    socket.on('createRoom', (data) => {
        const { roomName, mode } = data;
        const roomInfo = {
            creator: socket,
            mode: mode
        };
        waitingRooms[roomName] = roomInfo;
        socket.join(roomName);
        socket.createdRoomName = roomName;
        socket.emit('createRoom', { room: roomName });
        console.log(`방 생성`);
    });

    // 2. 클라이언트가 'placeStone' 이벤트를 보낼 때
    socket.on('doPlayer', (data) => {
        const { room, x, y } = data; // 방 이름, x, y 좌표 받기
        console.log(`방 ${room}에서 플레이어 ${socket.nickname}가 (${x}, ${y})에 돌을 놓았습니다.`);

        // 해당 방의 모든 클라이언트에게 돌이 놓인 위치를 브로드캐스트
        io.to(room).emit('doOpponent', {
            x,
            y,
            player: socket.nickname
        });
    });

    // 이모티콘 보내기
    socket.on('playerEmoji', (data) => {
        const { room, emoji } = data;
        // io.to(room).emit('opponentEmoji', { emoji: emoji });
        socket.broadcast.to(room).emit('opponentEmoji', { emoji: emoji });
    });

    // 기권
    socket.on('surrender', (data) => {
        const { room } = data;
        socket.broadcast.to(room).emit('escapeOpponent');
    });

    // 아케이드 득점
    socket.on('arcadeSuccess', (data) => {
        const { room, player } = data;
        socket.broadcast.to(room).emit('arcadeOpponent', { player: player });
    });

    // 3. 클라이언트와 연결이 끊어지면 실행될 이벤트
    socket.on('disconnect', () => {
        console.log('유저 연결이 끊어졌습니다:');

        const createdRoomName = socket.createdRoomName;
        if (createdRoomName) {
            // 해당 방이 waitingRooms 객체에 존재하는지 확인
            if (waitingRooms[createdRoomName]) {
                // 방 삭제
                delete waitingRooms[createdRoomName];
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
});