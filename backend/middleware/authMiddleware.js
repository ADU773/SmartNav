const User = require("../models/User");
const { verifyAccessToken } = require("../services/auth");

function bearerToken(req) {
    const header = req.get("authorization") || "";
    if (!header.toLowerCase().startsWith("bearer ")) return null;
    const token = header.slice(7).trim();
    return token || null;
}

/**
 * Rejects the request unless it carries a valid access token. Populates
 * `req.user` with `{ id, email, role }` for downstream ownership checks.
 */
async function requireAuth(req, res, next) {
    const token = bearerToken(req);
    if (!token) {
        return res.status(401).json({ success: false, message: "Sign in to continue." });
    }
    try {
        const payload = verifyAccessToken(token);
        // Confirm the account still exists; a deleted user's unexpired token
        // must stop working immediately.
        const user = await User.findById(payload.sub).lean();
        if (!user) return res.status(401).json({ success: false, message: "Sign in to continue." });
        req.user = { id: String(user._id), email: user.email, role: user.role };
        return next();
    } catch (error) {
        const expired = error.name === "TokenExpiredError";
        return res.status(401).json({
            success: false,
            message: expired ? "Your session expired. Refreshing…" : "Sign in to continue.",
            code: expired ? "token_expired" : "token_invalid",
        });
    }
}

/**
 * Populates `req.user` when a valid token is present, but never rejects.
 * Used by endpoints that serve both signed-in users and public share links.
 */
async function optionalAuth(req, _res, next) {
    const token = bearerToken(req);
    if (!token) return next();
    try {
        const payload = verifyAccessToken(token);
        const user = await User.findById(payload.sub).lean();
        if (user) req.user = { id: String(user._id), email: user.email, role: user.role };
    } catch {
        // An invalid token on an optional route is simply an anonymous request.
    }
    return next();
}

module.exports = { requireAuth, optionalAuth, bearerToken };
