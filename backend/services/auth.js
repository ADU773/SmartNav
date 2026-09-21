const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const RefreshToken = require("../models/RefreshToken");

const BCRYPT_ROUNDS = 12;

function config() {
    // Read at call time rather than import time so tests can install their own
    // environment before the first token is signed.
    const env = require("../config/runtime").env();
    return {
        accessSecret: env.JWT_ACCESS_SECRET,
        refreshSecret: env.JWT_REFRESH_SECRET,
        accessTtl: env.ACCESS_TOKEN_TTL,
        refreshDays: env.REFRESH_TOKEN_TTL_DAYS,
    };
}

async function hashPassword(plain) {
    return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

async function verifyPassword(plain, hash) {
    if (!hash) return false;
    return bcrypt.compare(plain, hash);
}

function signAccessToken(user) {
    const { accessSecret, accessTtl } = config();
    return jwt.sign(
        { sub: String(user._id), email: user.email, role: user.role },
        accessSecret,
        { expiresIn: accessTtl, issuer: "smartnav360" }
    );
}

function verifyAccessToken(token) {
    const { accessSecret } = config();
    return jwt.verify(token, accessSecret, { issuer: "smartnav360" });
}

function hashToken(raw) {
    return crypto.createHash("sha256").update(raw).digest("hex");
}

/**
 * Issues a refresh token and records its hash. The raw token goes to the
 * client; only the hash is persisted.
 */
async function issueRefreshToken(user) {
    const { refreshSecret, refreshDays } = config();
    const raw = jwt.sign(
        { sub: String(user._id), jti: crypto.randomUUID() },
        refreshSecret,
        { expiresIn: `${refreshDays}d`, issuer: "smartnav360" }
    );
    const expiresAt = new Date(Date.now() + refreshDays * 24 * 60 * 60 * 1000);
    await RefreshToken.create({ userId: user._id, tokenHash: hashToken(raw), expiresAt });
    return raw;
}

/**
 * Validates a refresh token and rotates it.
 *
 * A token that verifies but is already revoked means the same token was used
 * twice — the earlier use already rotated it. That is the classic replay
 * signature, so every token for that user is revoked rather than just this one.
 *
 * @returns {Promise<{ userId: string, refreshToken: string }>}
 */
async function rotateRefreshToken(raw) {
    const { refreshSecret } = config();
    let payload;
    try {
        payload = jwt.verify(raw, refreshSecret, { issuer: "smartnav360" });
    } catch {
        const error = new Error("Your session has expired. Sign in again.");
        error.status = 401;
        throw error;
    }

    const tokenHash = hashToken(raw);
    const stored = await RefreshToken.findOne({ tokenHash });
    if (!stored || stored.revokedAt) {
        // Replaying a token that was already ROTATED means two parties hold the
        // same token, so the family is dropped. A token revoked by an ordinary
        // sign-out has no replacement and is simply dead — treating that as
        // theft would sign the user out on their other devices.
        if (stored?.revokedAt && stored.replacedBy) {
            await RefreshToken.updateMany({ userId: payload.sub, revokedAt: null }, { $set: { revokedAt: new Date() } });
        }
        const error = new Error("Your session has expired. Sign in again.");
        error.status = 401;
        throw error;
    }

    const replacement = await issueRefreshToken({ _id: payload.sub });
    stored.revokedAt = new Date();
    stored.replacedBy = hashToken(replacement);
    await stored.save();

    return { userId: payload.sub, refreshToken: replacement };
}

async function revokeRefreshToken(raw) {
    if (!raw) return;
    await RefreshToken.updateOne({ tokenHash: hashToken(raw) }, { $set: { revokedAt: new Date() } });
}

async function revokeAllForUser(userId) {
    await RefreshToken.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
}

module.exports = {
    BCRYPT_ROUNDS,
    hashPassword,
    verifyPassword,
    signAccessToken,
    verifyAccessToken,
    issueRefreshToken,
    rotateRefreshToken,
    revokeRefreshToken,
    revokeAllForUser,
    hashToken,
};
