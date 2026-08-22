const mongoose = require('mongoose');

const GameHistorySchema = new mongoose.Schema({
    roundId: {
        type: Number,
        required: true,
        unique: true
    },
    crashPoint: {
        type: Number,
        required: true
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
});

// Index for faster queries
GameHistorySchema.index({ roundId: -1 });

module.exports = mongoose.model('GameHistory', GameHistorySchema);
