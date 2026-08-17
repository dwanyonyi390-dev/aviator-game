const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

const app = express();
const server = http.createServer(app);

// ============================================
// MIDDLEWARE
// ============================================
app.use(cors({ 
    origin: '*', 
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname)));

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-key-change-this-in-production';

// ============================================
// DATABASE (In-memory for demo)
// ============================================
const users = [];
const sessions = new Map();

// ============================================
// AUTH ROUTES
// ============================================

// Register
app.post('/api/register', async (req, res) => {
    try {
        const { email, password, username } = req.body;
        
        // Validation
        if (!email || !password || !username) {
            return res.status(400).json({ error: 'All fields are required' });
        }
        
        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }
        
        // Check if user exists
        if (users.find(u => u.email === email)) {
            return res.status(400).json({ error: 'Email already registered' });
        }
        
        if (users.find(u => u.username === username)) {
            return res.status(400).json({ error: 'Username already taken' });
        }
        
        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Create user
        const user = {
            id: Date.now().toString(),
            email,
            username,
            password: hashedPassword,
            balance: 1000,
            createdAt: new Date()
        };
        
        users.push(user);
        
        // Generate JWT
        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
        
        // Set cookie
        res.cookie('token', token, {
            httpOnly: true,
            maxAge: 7 * 24 * 60 * 60 * 1000,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax'
        });
        
        res.status(201).json({
            success: true,
            user: {
                id: user.id,
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

// Login
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }
        
        // Find user
        const user = users.find(u => u.email === email);
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        // Check password
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        // Generate JWT
        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
        
        // Set cookie
        res.cookie('token', token, {
            httpOnly: true,
            maxAge: 7 * 24 * 60 * 60 * 1000,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax'
        });
        
        res.json({
            success: true,
            user: {
                id: user.id,
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

// Logout
app.post('/api/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ success: true, message: 'Logged out' });
});

// Get current user
app.get('/api/me', (req, res) => {
    try {
        const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
        
        if (!token) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = users.find(u => u.id === decoded.id);
        
        if (!user) {
            return res.status(401).json({ error: 'User not found' });
        }
        
        res.json({
            user: {
                id: user.id,
                email: user.email,
                username: user.username,
                balance: user.balance
            }
        });
        
    } catch (error) {
        res.status(401).json({ error: 'Invalid token' });
    }
});

// ============================================
// SERVE PAGES
// ============================================

// Root route - redirect to game if logged in, otherwise login
app.get('/', (req, res) => {
    const token = req.cookies.token;
    if (token) {
        try {
            jwt.verify(token, JWT_SECRET);
            return res.redirect('/game');
        } catch (error) {
            // Token invalid, show login
        }
    }
    res.sendFile(path.join(__dirname, 'login.html'));
});

// Login page
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

// Register page
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

// Protected game route
app.get('/game', (req, res) => {
    const token = req.cookies.token;
    if (!token) {
        return res.redirect('/login');
    }
    
    try {
        jwt.verify(token, JWT_SECRET);
        res.sendFile(path.join(__dirname, 'index.html'));
    } catch (error) {
        res.redirect('/login');
    }
});

// Redirect index.html to game
app.get('/index.html', (req, res) => {
    res.redirect('/game');
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(), 
        users: users.length,
        gameStatus: gameState.status
    });
});

// ============================================
// SOCKET.IO SETUP
// ============================================

const io = socketIo(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    },
    transports: ['websocket', 'polling'],
    allowEIO3: true,
    pingTimeout: 60000,
    pingInterval: 25000
});

// Auth middleware for socket
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
        return next(new Error('Authentication required'));
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = users.find(u => u.id === decoded.id);
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
const gameState = {
    status: 'WAITING',
    roundId: 0,
    multiplier: 1.00,
    crashPoint: 0,
    countdown: 5,
    history: [],
    isCrashed: false
};

const playerBets = [];
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
        name: bet.username || bet.socketId.substring(0, 6),
        betAmount: bet.amount,
        cashedOut: bet.cashedOut || false
    }));
    io.emit('player:list', activePlayers);
}

let gameInterval = null;
let countdownInterval = null;

function startCountdown() {
    let count = CONFIG.COUNTDOWN_START;
    gameState.status = 'WAITING';
    gameState.countdown = count;
    gameState.isCrashed = false;
    playerBets.length = 0;

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

function startRound() {
    gameState.roundId++;
    gameState.status = 'RUNNING';
    gameState.multiplier = 1.00;
    gameState.crashPoint = generateCrashPoint();
    gameState.isCrashed = false;

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

        io.emit('game:update', { 
            multiplier: gameState.multiplier, 
            roundId: gameState.roundId 
        });

    }, 50);
}

function crash() {
    gameState.status = 'CRASHED';
    gameState.isCrashed = true;

    // Process bets
    playerBets.forEach(bet => {
        if (!bet.cashedOut) {
            // Find user and deduct balance
            const user = users.find(u => u.id === bet.userId);
            if (user) {
                user.balance = Math.max(0, user.balance - bet.amount);
                io.to(bet.socketId).emit('bet:lost', { 
                    amount: bet.amount, 
                    balance: user.balance 
                });
            }
        }
    });

    // Add to history
    gameState.history.push({
        roundId: gameState.roundId,
        crashPoint: gameState.crashPoint,
        timestamp: Date.now()
    });

    if (gameState.history.length > CONFIG.MAX_HISTORY) {
        gameState.history.shift();
    }

    io.emit('game:crash', { 
        roundId: gameState.roundId, 
        multiplier: gameState.crashPoint 
    });

    if (gameInterval) {
        clearInterval(gameInterval);
        gameInterval = null;
    }

    playerBets.length = 0;

    setTimeout(() => startCountdown(), 3000);
}

// ============================================
// SOCKET EVENTS
// ============================================

io.on('connection', (socket) => {
    console.log('🟢 Player connected:', socket.user.username);

    // Send current game state
    socket.emit('game:state', {
        status: gameState.status,
        roundId: gameState.roundId,
        multiplier: gameState.multiplier,
        crashPoint: gameState.crashPoint,
        countdown: gameState.countdown
    });

    socket.emit('player:data', { balance: socket.user.balance });
    socket.emit('game:history:data', { history: gameState.history });

    // Place Bet
    socket.on('bet:place', (data) => {
        console.log('📝 Bet placed by:', socket.user.username, data);
        
        if (gameState.status !== 'WAITING') {
            socket.emit('bet:error', { error: 'Bets are closed for this round' });
            return;
        }

        // Check if user already has a bet
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

        socket.user.balance -= amount;

        playerBets.push({
            socketId: socket.id,
            userId: socket.user.id,
            username: socket.user.username,
            amount: amount,
            cashedOut: false
        });

        socket.emit('bet:confirmed', { 
            amount: amount, 
            balance: socket.user.balance 
        });

        broadcastPlayerList();
        console.log(`✅ ${socket.user.username} bet $${amount}`);
    });

    // Cash Out
    socket.on('bet:cashout', () => {
        console.log('💰 Cashout requested by:', socket.user.username);
        
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
        const user = users.find(u => u.id === bet.userId);
        if (user) {
            user.balance += payout;
            bet.cashedOut = true;
            
            socket.emit('bet:cashout:confirmed', {
                multiplier: gameState.multiplier,
                payout: payout,
                balance: user.balance
            });
            
            console.log(`💰 ${socket.user.username} cashed out at ${gameState.multiplier.toFixed(2)}x for $${payout.toFixed(2)}`);
        }

        broadcastPlayerList();
    });

    // History request
    socket.on('game:history', () => {
        socket.emit('game:history:data', { history: gameState.history });
    });

    // Disconnect
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
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Aviator Game Server running on port ${PORT}`);
    console.log(`📍 http://localhost:${PORT}`);
    console.log(`👤 Users registered: ${users.length}`);
    console.log(`🎮 Game status: ${gameState.status}`);
    console.log(`\n✅ Server is ready!\n`);
    startCountdown();
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down server...');
    if (gameInterval) clearInterval(gameInterval);
    if (countdownInterval) clearInterval(countdownInterval);
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});
