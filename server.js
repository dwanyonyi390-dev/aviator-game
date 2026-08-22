// ============================================
// LOAD .env file
// ============================================
require('dotenv').config();

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');

// Import Models
const User = require('./models/User');
const GameHistory = require('./models/GameHistory');
const Bet = require('./models/Bet');

const app = express();
const server = http.createServer(app);

// ============================================
// Environment Variables
// ============================================
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-key-change-this-in-production';
const CLIENT_URL = process.env.CLIENT_URL || '*';
const NODE_ENV = process.env.NODE_ENV || 'development';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/aviator';

// ============================================
// MongoDB Connection
// ============================================
mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log('✅ MongoDB connected'))
.catch(err => console.error('❌ MongoDB connection error:', err));

// ============================================
// Middleware
// ============================================
app.use(cors({ 
    origin: CLIENT_URL || '*', 
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname)));

// ============================================
// Auth Middleware
// ============================================
const authMiddleware = async (req, res, next) => {
    try {
        const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
        
        if (!token) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.id);
        
        if (!user) {
            return res.status(401).json({ error: 'User not found' });
        }
        
        req.user = user;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Invalid token' });
    }
};

// ============================================
// AUTH ROUTES
// ============================================

app.post('/api/register', async (req, res) => {
    try {
        const { email, password, username } = req.body;
        
        if (!email || !password || !username) {
            return res.status(400).json({ error: 'All fields are required' });
        }
        
        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }
        
        // Check if user exists
        const existingUser = await User.findOne({ $or: [{ email }, { username }] });
        if (existingUser) {
            if (existingUser.email === email) {
                return res.status(400).json({ error: 'Email already registered' });
            }
            return res.status(400).json({ error: 'Username already taken' });
        }
        
        // Create user
        const user = new User({
            email,
            username,
            password,
            balance: 1000
        });
        
        await user.save();
        
        const token = jwt.sign({ id: user._id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
        
        res.cookie('token', token, {
            httpOnly: true,
            maxAge: 7 * 24 * 60 * 60 * 1000,
            secure: NODE_ENV === 'production',
            sameSite: 'lax'
        });
        
        res.status(201).json({
            success: true,
            user: {
                id: user._id,
                email: user.email,
                username: user.username,
                balance: user.balance
            },
            token
        });
        
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }
        
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const validPassword = await user.comparePassword(password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const token = jwt.sign({ id: user._id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
        
        res.cookie('token', token, {
            httpOnly: true,
            maxAge: 7 * 24 * 60 * 60 * 1000,
            secure: NODE_ENV === 'production',
            sameSite: 'lax'
        });
        
        res.json({
            success: true,
            user: {
                id: user._id,
                email: user.email,
                username: user.username,
                balance: user.balance
            },
            token
        });
        
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ success: true });
});

app.get('/api/me', authMiddleware, (req, res) => {
    res.json({
        user: {
            id: req.user._id,
            email: req.user.email,
            username: req.user.username,
            balance: req.user.balance
        }
    });
});

app.post('/api/balance', authMiddleware, async (req, res) => {
    try {
        const { balance } = req.body;
        if (balance === undefined) {
            return res.status(400).json({ error: 'Balance required' });
        }
        
        req.user.balance = balance;
        await req.user.save();
        
        res.json({ success: true, balance: req.user.balance });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ============================================
// SERVE PAGES
// ============================================

app.get('/', (req, res) => {
    const token = req.cookies.token;
    if (token) {
        try {
            jwt.verify(token, JWT_SECRET);
            return res.redirect('/game');
        } catch (error) {}
    }
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/login', (req, res) => {
    const token = req.cookies.token;
    if (token) {
        try {
            jwt.verify(token, JWT_SECRET);
            return res.redirect('/game');
        } catch (error) {}
    }
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/register', (req, res) => {
    const token = req.cookies.token;
    if (token) {
        try {
            jwt.verify(token, JWT_SECRET);
            return res.redirect('/game');
        } catch (error) {}
    }
    res.sendFile(path.join(__dirname, 'register.html'));
});

app.get('/game', authMiddleware, (req, res) => {
    res.sendFile(path.join(__dirname, 'game.html'));
});

app.get('/index.html', (req, res) => {
    res.redirect('/game');
});

// Health check
app.get('/health', async (req, res) => {
    const userCount = await User.countDocuments();
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(), 
        users: userCount,
        mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
    });
});

// ============================================
// SOCKET.IO WITH AUTH
// ============================================

const io = socketIo(server, {
    cors: {
        origin: CLIENT_URL || '*',
        methods: ['GET', 'POST']
    },
    transports: ['websocket', 'polling'],
    allowEIO3: true
});

// Socket auth middleware
io.use(async (socket, next) => {
    try {
        const token = socket.handshake.auth.token;
        if (!token) {
            return next(new Error('Authentication required'));
        }
        
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.id);
        
        if (!user) {
            return next(new Error('User not found'));
        }
        
        socket.user = user;
        next();
    } catch (error) {
        next(new Error('Invalid token'));
    }
});

// ============================================
// GAME STATE
// ============================================
let gameState = {
    status: 'WAITING',
    roundId: 0,
    multiplier: 1.00,
    crashPoint: 0,
    countdown: 5,
    isCrashed: false
};

let playerBets = []; // In-memory for active bets
const CONFIG = {
    MAX_HISTORY: 20,
    COUNTDOWN_START: 5
};

function generateCrashPoint() {
    const r = Math.random();
    if (r < 0.20) return 1.0 + Math.random() * 0.5;
    if (r < 0.50) return 1.5 + Math.random() * 1.0;
    if (r < 0.75) return 2.5 + Math.random() * 2.0;
    return 4.5 + Math.random() * 5.5;
}

function broadcastPlayerList() {
    const activePlayers = playerBets.map(bet => ({
        name: bet.username,
        betAmount: bet.amount,
        cashedOut: bet.cashedOut || false
    }));
    io.emit('player:list', activePlayers);
}

let gameInterval = null;
let countdownInterval = null;

async function startCountdown() {
    let count = CONFIG.COUNTDOWN_START;
    gameState.status = 'WAITING';
    gameState.countdown = count;
    gameState.isCrashed = false;
    playerBets = [];

    io.emit('game:countdown', { roundId: gameState.roundId, countdown: count });

    if (countdownInterval) clearInterval(countdownInterval);

    countdownInterval = setInterval(() => {
        count--;
        gameState.countdown = count;
        io.emit('game:countdown', { roundId: gameState.roundId, countdown: count });

        if (count <= 0) {
            clearInterval(countdownInterval);
            startRound();
        }
    }, 1000);
}

async function startRound() {
    gameState.roundId++;
    gameState.status = 'RUNNING';
    gameState.multiplier = 1.00;
    gameState.crashPoint = generateCrashPoint();
    gameState.isCrashed = false;

    // Reset bet statuses
    playerBets.forEach(bet => { bet.cashedOut = false; });

    io.emit('game:start', { roundId: gameState.roundId, crashPoint: gameState.crashPoint });

    if (gameInterval) clearInterval(gameInterval);

    let lastUpdate = Date.now();
    gameInterval = setInterval(() => {
        if (gameState.status !== 'RUNNING') return;

        const now = Date.now();
        const delta = (now - lastUpdate) / 1000;
        lastUpdate = now;

        const speed = 0.01 + (gameState.multiplier * 0.002);
        gameState.multiplier += speed * delta * 10;

        if (gameState.multiplier >= gameState.crashPoint) {
            gameState.multiplier = gameState.crashPoint;
            crash();
            return;
        }

        io.emit('game:update', { multiplier: gameState.multiplier, roundId: gameState.roundId });
    }, 50);
}

async function crash() {
    gameState.status = 'CRASHED';
    gameState.isCrashed = true;

    // Process all active bets - deduct balance for those who didn't cash out
    for (const bet of playerBets) {
        if (!bet.cashedOut) {
            const user = await User.findById(bet.userId);
            if (user) {
                user.balance = Math.max(0, user.balance - bet.amount);
                await user.save();
                
                // Save bet to database
                await Bet.create({
                    roundId: gameState.roundId,
                    userId: bet.userId,
                    username: bet.username,
                    amount: bet.amount,
                    cashedOut: false,
                    status: 'lost'
                });
                
                io.to(bet.socketId).emit('bet:lost', { 
                    amount: bet.amount, 
                    balance: user.balance 
                });
            }
        } else {
            // Save cashed out bet to database
            await Bet.create({
                roundId: gameState.roundId,
                userId: bet.userId,
                username: bet.username,
                amount: bet.amount,
                cashedOut: true,
                cashoutMultiplier: bet.cashoutMultiplier || gameState.crashPoint,
                payout: bet.payout || (bet.amount * (bet.cashoutMultiplier || gameState.crashPoint)),
                status: 'cashed'
            });
        }
    }

    // Save game history
    await GameHistory.create({
        roundId: gameState.roundId,
        crashPoint: gameState.crashPoint,
        timestamp: new Date()
    });

    // Keep only last 20 history entries
    const historyCount = await GameHistory.countDocuments();
    if (historyCount > CONFIG.MAX_HISTORY) {
        const oldest = await GameHistory.find()
            .sort({ roundId: 1 })
            .limit(historyCount - CONFIG.MAX_HISTORY);
        if (oldest.length > 0) {
            await GameHistory.deleteMany({ 
                roundId: { $lte: oldest[oldest.length - 1].roundId } 
            });
        }
    }

    io.emit('game:crash', { roundId: gameState.roundId, multiplier: gameState.crashPoint });

    if (gameInterval) {
        clearInterval(gameInterval);
        gameInterval = null;
    }

    playerBets = [];

    setTimeout(() => startCountdown(), 3000);
}

// ============================================
// SOCKET EVENTS
// ============================================

io.on('connection', (socket) => {
    console.log('🟢 Player connected:', socket.user.username);

    socket.emit('game:state', {
        status: gameState.status,
        roundId: gameState.roundId,
        multiplier: gameState.multiplier,
        crashPoint: gameState.crashPoint,
        countdown: gameState.countdown
    });

    socket.emit('player:data', { balance: socket.user.balance });

    // Send history
    GameHistory.find()
        .sort({ roundId: -1 })
        .limit(CONFIG.MAX_HISTORY)
        .then(history => {
            socket.emit('game:history:data', { history });
        });

    socket.on('bet:place', async (data) => {
        if (gameState.status !== 'WAITING') {
            socket.emit('bet:error', { error: 'Bets are closed for this round' });
            return;
        }

        if (playerBets.find(b => b.socketId === socket.id)) {
            socket.emit('bet:error', { error: 'You already have a bet this round' });
            return;
        }

        const amount = parseFloat(data.amount);
        if (isNaN(amount) || amount <= 0) {
            socket.emit('bet:error', { error: 'Invalid bet amount' });
            return;
        }

        if (amount > socket.user.balance) {
            socket.emit('bet:error', { error: 'Insufficient balance' });
            return;
        }

        // Deduct balance
        socket.user.balance -= amount;
        await socket.user.save();

        playerBets.push({
            socketId: socket.id,
            userId: socket.user._id,
            username: socket.user.username,
            amount: amount,
            cashedOut: false
        });

        socket.emit('bet:confirmed', { 
            amount: amount, 
            balance: socket.user.balance 
        });

        broadcastPlayerList();
    });

    socket.on('bet:cashout', async () => {
        const bet = playerBets.find(b => b.socketId === socket.id);
        
        if (!bet) {
            socket.emit('bet:error', { error: 'No bet placed' });
            return;
        }

        if (gameState.status !== 'RUNNING') {
            socket.emit('bet:error', { error: 'Round is not running' });
            return;
        }

        if (bet.cashedOut) {
            socket.emit('bet:error', { error: 'Already cashed out' });
            return;
        }

        const payout = bet.amount * gameState.multiplier;
        const user = await User.findById(bet.userId);
        
        if (user) {
            user.balance += payout;
            await user.save();
            
            bet.cashedOut = true;
            bet.cashoutMultiplier = gameState.multiplier;
            bet.payout = payout;
            
            socket.emit('bet:cashout:confirmed', {
                multiplier: gameState.multiplier,
                payout: payout,
                balance: user.balance
            });
        }

        broadcastPlayerList();
    });

    socket.on('game:history', async () => {
        const history = await GameHistory.find()
            .sort({ roundId: -1 })
            .limit(CONFIG.MAX_HISTORY);
        socket.emit('game:history:data', { history });
    });

    socket.on('disconnect', () => {
        console.log('🔴 Player disconnected:', socket.user.username);
        const index = playerBets.findIndex(bet => bet.socketId === socket.id);
        if (index !== -1) {
            playerBets.splice(index, 1);
        }
        broadcastPlayerList();
    });
});

// ============================================
// START SERVER
// ============================================
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📍 http://localhost:${PORT}`);
    console.log(`📊 MongoDB: ${MONGODB_URI}`);
    startCountdown();
});

process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down...');
    if (gameInterval) clearInterval(gameInterval);
    if (countdownInterval) clearInterval(countdownInterval);
    await mongoose.disconnect();
    server.close(() => { console.log('✅ Closed'); process.exit(0); });
});
