const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Enable CORS for all routes
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST']
}));

// Serve static files
app.use(express.static(path.join(__dirname)));

// Serve the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const io = socketIo(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    },
    transports: ['websocket', 'polling']
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

const players = new Map();
const playerBets = [];
const CONFIG = {
    MAX_HISTORY: 20,
    COUNTDOWN_START: 5,
    INITIAL_BALANCE: 1000
};

// ============================================
// HELPER FUNCTIONS
// ============================================
function generateCrashPoint() {
    const random = Math.random();
    if (random < 0.20) return 1.0 + Math.random() * 0.5;
    if (random < 0.50) return 1.5 + Math.random() * 1.0;
    if (random < 0.75) return 2.5 + Math.random() * 2.0;
    return 4.5 + Math.random() * 5.5;
}

function getPlayer(socketId) {
    if (!players.has(socketId)) {
        players.set(socketId, {
            balance: CONFIG.INITIAL_BALANCE,
            betAmount: 0,
            hasBet: false,
            cashedOut: false
        });
    }
    return players.get(socketId);
}

// ============================================
// GAME LOOP
// ============================================
let gameInterval = null;
let countdownInterval = null;

function startCountdown() {
    let count = CONFIG.COUNTDOWN_START;
    gameState.status = 'WAITING';
    gameState.countdown = count;
    gameState.isCrashed = false;
    playerBets.length = 0;

    io.emit('game:countdown', {
        roundId: gameState.roundId,
        countdown: count
    });

    if (countdownInterval) clearInterval(countdownInterval);

    countdownInterval = setInterval(() => {
        count--;
        gameState.countdown = count;

        io.emit('game:countdown', {
            roundId: gameState.roundId,
            countdown: count
        });

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

    // Reset player cashout status
    players.forEach((player) => {
        player.cashedOut = false;
    });

    io.emit('game:start', {
        roundId: gameState.roundId,
        crashPoint: gameState.crashPoint
    });

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

    // Process all players who haven't cashed out
    players.forEach((player, socketId) => {
        if (player.hasBet && !player.cashedOut) {
            // Player loses their bet
            player.balance = Math.max(0, player.balance - player.betAmount);
            player.hasBet = false;
            io.to(socketId).emit('bet:lost', {
                amount: player.betAmount,
                balance: player.balance
            });
        }
        player.hasBet = false;
        player.betAmount = 0;
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

    // Send updated balances
    players.forEach((player, socketId) => {
        io.to(socketId).emit('player:data', {
            balance: player.balance
        });
    });

    if (gameInterval) {
        clearInterval(gameInterval);
        gameInterval = null;
    }

    // Clear player bets
    playerBets.length = 0;

    setTimeout(() => {
        startCountdown();
    }, 3000);
}

// ============================================
// SOCKET EVENTS
// ============================================
io.on('connection', (socket) => {
    console.log('🟢 Player connected:', socket.id);

    const player = getPlayer(socket.id);

    // Send current game state
    socket.emit('game:state', {
        status: gameState.status,
        roundId: gameState.roundId,
        multiplier: gameState.multiplier,
        crashPoint: gameState.crashPoint,
        countdown: gameState.countdown
    });

    socket.emit('player:data', {
        balance: player.balance
    });

    socket.emit('game:history:data', {
        history: gameState.history
    });

    // Handle bet placement
    socket.on('bet:place', (data) => {
        const player = getPlayer(socket.id);

        if (gameState.status !== 'WAITING') {
            socket.emit('bet:error', { error: 'Bets are closed for this round' });
            return;
        }

        if (player.hasBet) {
            socket.emit('bet:error', { error: 'You already have a bet this round' });
            return;
        }

        const amount = parseFloat(data.amount);
        if (isNaN(amount) || amount <= 0) {
            socket.emit('bet:error', { error: 'Invalid bet amount' });
            return;
        }

        if (amount > player.balance) {
            socket.emit('bet:error', { error: 'Insufficient balance' });
            return;
        }

        player.balance -= amount;
        player.betAmount = amount;
        player.hasBet = true;
        player.cashedOut = false;

        playerBets.push({
            socketId: socket.id,
            amount: amount
        });

        socket.emit('bet:confirmed', {
            amount: amount,
            balance: player.balance
        });

        broadcastPlayerList();
    });

    // Handle cash out - FIXED: properly handles the event
    socket.on('bet:cashout', (data) => {
        console.log('💰 Cashout requested by:', socket.id);
        const player = getPlayer(socket.id);

        if (gameState.status !== 'RUNNING') {
            socket.emit('bet:error', { error: 'Round is not running' });
            return;
        }

        if (!player.hasBet) {
            socket.emit('bet:error', { error: 'No bet placed' });
            return;
        }

        if (player.cashedOut) {
            socket.emit('bet:error', { error: 'Already cashed out' });
            return;
        }

        // Calculate payout
        const payout = player.betAmount * gameState.multiplier;
        player.balance += payout;
        player.cashedOut = true;
        player.hasBet = false;

        // Remove from active bets
        const index = playerBets.findIndex(bet => bet.socketId === socket.id);
        if (index !== -1) {
            playerBets.splice(index, 1);
        }

        socket.emit('bet:cashout:confirmed', {
            multiplier: gameState.multiplier,
            payout: payout,
            balance: player.balance
        });

        console.log(`💰 Player ${socket.id} cashed out at ${gameState.multiplier.toFixed(2)}x for $${payout.toFixed(2)}`);

        broadcastPlayerList();
    });

    // Handle history request
    socket.on('game:history', () => {
        socket.emit('game:history:data', {
            history: gameState.history
        });
    });

    // Handle disconnect
    socket.on('disconnect', () => {
        console.log('🔴 Player disconnected:', socket.id);
        const index = playerBets.findIndex(bet => bet.socketId === socket.id);
        if (index !== -1) {
            playerBets.splice(index, 1);
        }
        broadcastPlayerList();
    });
});

function broadcastPlayerList() {
    const activePlayers = playerBets.map(bet => {
        const player = players.get(bet.socketId);
        return {
            name: bet.socketId.substring(0, 6),
            betAmount: bet.amount,
            cashedOut: player ? player.cashedOut : false
        };
    });

    io.emit('player:list', activePlayers);
}

// ============================================
// START SERVER
// ============================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Aviator Game Server running on port ${PORT}`);
    console.log(`📍 Open http://localhost:${PORT} in your browser`);
    startCountdown();
});

// Handle shutdown gracefully
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down server...');
    if (gameInterval) clearInterval(gameInterval);
    if (countdownInterval) clearInterval(countdownInterval);
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});
