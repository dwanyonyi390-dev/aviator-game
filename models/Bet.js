const mongoose = require('mongoose');

const BetSchema = new mongoose.Schema({
    roundId: {
        type: Number,
        required: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    username: {
        type: String,
        required: true
    },
    amount: {
        type: Number,
        required: true,
        min: 0
    },
    cashedOut: {
        type: Boolean,
        default: false
    },
    cashoutMultiplier: {
        type: Number,
        default: 0
    },
    payout: {
        type: Number,
        default: 0
    },
    status: {
        type: String,
        enum: ['active', 'cashed', 'lost'],
        default: 'active'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Index for faster queries
BetSchema.index({ roundId: 1, userId: 1 });
BetSchema.index({ roundId: 1, status: 1 });

module.exports = mongoose.model('Bet', BetSchema);
