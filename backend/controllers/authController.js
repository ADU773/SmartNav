const { z } = require("zod");
const User = require("../models/User");
const { sendError, fail } = require("../services/integrity");
const {
    hashPassword,
    verifyPassword,
    signAccessToken,
    issueRefreshToken,
    rotateRefreshToken,
    revokeRefreshToken,
} = require("../services/auth");

const registerSchema = z.object({
    email: z.string().email("Enter a valid email address."),
    password: z.string().min(8, "Password must be at least 8 characters."),
    name: z.string().min(1, "Name is required.").max(80),
});

const loginSchema = z.object({
    email: z.string().email("Enter a valid email address."),
    password: z.string().min(1, "Password is required."),
});

function parse(schema, body) {
    const result = schema.safeParse(body || {});
    if (!result.success) fail(400, result.error.issues[0].message);
    return result.data;
}

async function issueSession(res, user, status = 200) {
    const accessToken = signAccessToken(user);
    const refreshToken = await issueRefreshToken(user);
    return res.status(status).json({
        success: true,
        data: { user: user.toPublic(), accessToken, refreshToken },
    });
}

const register = async (req, res) => {
    try {
        const { email, password, name } = parse(registerSchema, req.body);
        if (await User.exists({ email: email.toLowerCase() })) {
            fail(409, "An account with that email already exists.");
        }
        const user = await User.create({
            email: email.toLowerCase(),
            name,
            passwordHash: await hashPassword(password),
            // The first account to register owns the deployment.
            role: (await User.estimatedDocumentCount()) === 0 ? "admin" : "member",
        });
        return await issueSession(res, user, 201);
    } catch (error) {
        // A racing duplicate registration surfaces as a unique-index violation.
        if (error.code === 11000) return res.status(409).json({ success: false, message: "An account with that email already exists." });
        return sendError(res, error);
    }
};

const login = async (req, res) => {
    try {
        const { email, password } = parse(loginSchema, req.body);
        const user = await User.findOne({ email: email.toLowerCase() }).select("+passwordHash");
        // Same message and roughly the same work for both failure modes, so the
        // response does not reveal which emails are registered.
        const ok = await verifyPassword(password, user?.passwordHash);
        if (!user || !ok) fail(401, "Email or password is incorrect.");
        return await issueSession(res, user);
    } catch (error) { return sendError(res, error); }
};

const refresh = async (req, res) => {
    try {
        const token = req.body?.refreshToken;
        if (typeof token !== "string" || !token) fail(400, "A refresh token is required.");
        const { userId, refreshToken } = await rotateRefreshToken(token);
        const user = await User.findById(userId);
        if (!user) fail(401, "Your session has expired. Sign in again.");
        return res.json({
            success: true,
            data: { user: user.toPublic(), accessToken: signAccessToken(user), refreshToken },
        });
    } catch (error) { return sendError(res, error); }
};

const logout = async (req, res) => {
    try {
        await revokeRefreshToken(req.body?.refreshToken);
        return res.json({ success: true, message: "Signed out." });
    } catch (error) { return sendError(res, error); }
};

const me = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) fail(401, "Sign in to continue.");
        return res.json({ success: true, data: user.toPublic() });
    } catch (error) { return sendError(res, error); }
};

module.exports = { register, login, refresh, logout, me };
