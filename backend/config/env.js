const { z } = require("zod");

// Validated once at boot so a missing or malformed variable fails loudly at
// startup instead of surfacing as a confusing 500 on the first request.
const schema = z.object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(5000),
    // MONGODB_URI is the name this project has always used; MONGO_URI is
    // accepted as an alias so either spelling works.
    MONGODB_URI: z.string({ error: "MONGODB_URI is required (MongoDB connection string)." }).min(1, "MONGODB_URI is required (MongoDB connection string)."),

    // Secrets. Refused in production when left at the development default, so a
    // deploy cannot silently ship forgeable tokens.
    JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters."),
    JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET must be at least 32 characters."),
    ACCESS_TOKEN_TTL: z.string().default("15m"),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

    // Comma-separated browser origins allowed to call this API.
    CORS_ORIGINS: z.string().default("http://localhost:5173"),

    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

    // Optional integrations. Absent means the feature reports itself unavailable.
    GEMINI_API_KEY: z.string().optional(),
    YOLO_API_URL: z.string().url().optional(),
    // This API's public address, used to build image links for YOLO_API_URL.
    PUBLIC_API_URL: z.string().url().optional(),
});

const DEV_SECRET = "development-only-insecure-secret-change-me";

function loadEnv(source = process.env) {
    const candidate = { ...source };
    // A line left blank in .env (as copied from .env.example) means "not set",
    // so optional settings stay optional instead of failing URL validation.
    for (const key of Object.keys(candidate)) if (candidate[key] === "") delete candidate[key];
    candidate.MONGODB_URI ||= candidate.MONGO_URI;
    // Development convenience only: never applied when NODE_ENV=production.
    if (candidate.NODE_ENV !== "production") {
        candidate.JWT_ACCESS_SECRET ||= `${DEV_SECRET}-access`;
        candidate.JWT_REFRESH_SECRET ||= `${DEV_SECRET}-refresh`;
    }

    const parsed = schema.safeParse(candidate);
    if (!parsed.success) {
        const details = parsed.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`).join("\n");
        throw new Error(`Invalid backend environment configuration:\n${details}`);
    }

    const env = parsed.data;
    if (env.NODE_ENV === "production") {
        for (const key of ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"]) {
            if (env[key].includes(DEV_SECRET)) throw new Error(`${key} still uses the development default. Set a real secret before deploying.`);
        }
    }

    env.corsOrigins = env.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean);
    return env;
}

module.exports = { loadEnv, schema };
