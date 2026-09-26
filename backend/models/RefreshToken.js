const mongoose = require("mongoose");

// Refresh tokens are stored hashed and one row per issued token, so a single
// session can be revoked without invalidating the user's other devices, and a
// stolen database dump does not yield usable tokens.
const refreshTokenSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true,
    },
    // SHA-256 of the raw token. The raw value only ever exists in the response
    // body and the client's storage.
    tokenHash: {
        type: String,
        required: true,
        unique: true,
    },
    // Set when the token is rotated or revoked; a replay of a rotated token is
    // treated as theft and drops the whole family.
    revokedAt: { type: Date, default: null },
    replacedBy: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
    // TTL index: MongoDB removes the row once this timestamp passes.
    expiresAt: {
        type: Date,
        required: true,
        index: { expires: 0 },
    },
});

module.exports = mongoose.model("RefreshToken", refreshTokenSchema);
