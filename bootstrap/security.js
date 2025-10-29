const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const compression = require("compression");
const cookieParser = require("cookie-parser");

/** Aplica middlewares de segurança (JS/Express) */
function applySecurity(app) {
    app.disable("x-powered-by");

    app.use(helmet({
        crossOriginResourcePolicy: { policy: "cross-origin" }, // não bloquear assets externos
    }));

    const allowed = (process.env.CORS_ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);

    app.use(
        cors({
            origin: (origin, cb) => {
                if (!origin) return cb(null, true);
                return cb(null, allowed.includes(origin));
            },
            methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
            allowedHeaders: [
                "Content-Type",
                "Authorization",
                "authorization",
                "x-csrf-token",
            ],
            exposedHeaders: ["Authorization"],
            credentials: true,
        })
    );

    app.use(compression());
    app.use(cookieParser());

    // rate limit nas rotas sensíveis
    const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true });
    const uploadLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 50, standardHeaders: true });
    app.use("/auth", authLimiter);
    app.use("/upload", uploadLimiter);

    // cache-control padrão
    app.use((_req, res, next) => {
        res.setHeader(
            "Content-Security-Policy",
            "frame-ancestors https://admin.shopify.com https://*.myshopify.com https://*.shopify.com;"
        );
        res.removeHeader("X-Framae-Options");
        next();
    });

    app.use((_req, res, next) =>{
        res.setHeader("Cache-Control", "no-store");
        next();
    })
}

module.exports = { applySecurity };
