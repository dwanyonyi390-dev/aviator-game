require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: process.env.CLIENT_URL,
        credentials: true
    }
});

// =======================
// CONFIG
// =======================
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;

// =======================
// MIDDLEWARE
// =======================
app.use(express.json());
app.use(cors({
    origin: process.env.CLIENT_URL,
    credentials: true
}));
app.use(cookieParser());
app.use(express.static('public'));

// =======================
// FAKE DATABASE (TEMP)
// =======================
const users = [];

// =======================
// AUTH ROUTES
// =======================

// REGISTER
app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body;

    const existing = users.find(u => u.email === email);
    if (existing) {
        return res.status(400).json({ error: "User already exists" });
    }

    const hashed = await bcrypt.hash(password, 10);

    const user = {
        id: Date.now(),
        username,
        email,
        password: hashed,
        balance: 1000
    };

    users.push(user);

    const token = jwt.sign({ id: user.id }, JWT_SECRET);

    res.cookie('token', token, {
        httpOnly: false,
        maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.json({ success: true });
});

// LOGIN
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    const user = users.find(u => u.email === email);
    if (!user) return res.status(400).json({ error: "User not found" });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ error: "Wrong password" });

    const token = jwt.sign({ id: user.id }, JWT_SECRET);

    res.cookie('token', token, {
        httpOnly: false,
        maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.json({ success: true });
});

// =======================
// SOCKET AUTH
// =======================
io.use((socket, next) => {
    const token = socket.handshake.auth?.token;

    if (!token) return next(new Error("Authentication required"));

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = users.find(u => u.id === decoded.id);

        if (!user) return next(new Error("User not found"));

        socket.user = user;
        next();
    } catch (err) {
        next(new Error("Invalid token"));
    }
});

// =======================
// GAME STATE
// =======================
let multiplier = 1;
let crashPoint = 2;
let running = false;
let gameInterval = null;

// =======================
// GAME LOGIC
// =======================
function generateCrashPoint() {
    const r = Math.random();

    if (r < 0.5) return 1 + Math.random();       // low
    if (r < 0.8) return 2 + Math.random() * 2;   // mid
    return 4 + Math.random() * 2;                // high
}

function startGame() {
    multiplier = 1;
    crashPoint = generateCrashPoint();
    running = true;

    io.emit('game:start');

    gameInterval = setInterval(() => {
        multiplier += parseFloat(process.env.GAME_GROWTH_RATE || 0.01);

        io.emit('game:update', { multiplier });

        if (multiplier >= crashPoint) {
            crashGame();
        }

    }, parseInt(process.env.GAME_TICK_RATE || 100));
}

function crashGame() {
    running = false;

    io.emit('game:crash', { multiplier });

    clearInterval(gameInterval);

    // Reset bets
    io.sockets.sockets.forEach(socket => {
        if (socket.hasBet) {
            socket.emit('bet:lost', {
                balance: socket.user.balance
            });
        }
        socket.hasBet = false;
    });

    setTimeout(startGame, 3000);
}

// =======================
// SOCKET EVENTS
// =======================
io.on('connection', (socket) => {
    console.log('Connected:', socket.user.username);

    socket.emit('player:data', {
        balance: socket.user.balance
    });

    socket.hasBet = false;
    socket.betAmount = 0;

    // PLACE BET
    socket.on('bet:place', ({ amount }) => {
        amount = parseFloat(amount);

        if (!running) {
            return socket.emit('bet:error', { error: "Game not running" });
        }

        if (socket.hasBet) {
            return socket.emit('bet:error', { error: "Already bet" });
        }

        if (amount <= 0 || isNaN(amount)) {
            return socket.emit('bet:error', { error: "Invalid amount" });
        }

        if (amount > socket.user.balance) {
            return socket.emit('bet:error', { error: "Insufficient balance" });
        }

        socket.user.balance -= amount;
        socket.betAmount = amount;
        socket.hasBet = true;

        socket.emit('bet:confirmed', {
            balance: socket.user.balance
        });
    });

    // CASHOUT
    socket.on('bet:cashout', () => {
        if (!running || !socket.hasBet) return;

        const payout = socket.betAmount * multiplier;

        socket.user.balance += payout;

        socket.hasBet = false;

        socket.emit('bet:cashout:confirmed', {
            balance: socket.user.balance,
            multiplier
        });
    });

    socket.on('disconnect', () => {
        console.log('Disconnected:', socket.user.username);
    });
});

// =======================
// START SERVER
// =======================
server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    startGame();
});
