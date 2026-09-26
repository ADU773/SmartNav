const router = require("express").Router();
const { register, login, refresh, logout, me } = require("../controllers/authController");
const { requireAuth } = require("../middleware/authMiddleware");
const { authLimiter } = require("../middleware/rateLimit");

// Credential endpoints carry their own strict limiter so password guessing is
// throttled far harder than ordinary API traffic.
router.post("/register", authLimiter, register);
router.post("/login", authLimiter, login);
router.post("/refresh", authLimiter, refresh);
router.post("/logout", logout);
router.get("/me", requireAuth, me);

module.exports = router;
