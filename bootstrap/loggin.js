// bootstrap/logging.js
const pino = require("pino");
const pinoHttp = require("pino-http");

/** Cria logger global */
const logger = pino({
    level: process.env.LOG_LEVEL || "info",
    transport:
        process.env.NODE_ENV !== "production"
            ? { target: "pino-pretty", options: { translateTime: true } }
            : undefined,
});

/** Aplica logging HTTP */
function applyLogging(app) {
    const mode = (process.env.HTTP_LOG || "basic").toLowerCase();
    // modes: basic | errors | none | verbose

    app.use(
        pinoHttp({
            logger,
            // não loga automaticamente health/debug
            autoLogging: {
                ignore: (req) =>
                    req.url === "/health" ||
                    req.url === "/healthz" ||
                    req.url.startsWith("/_debug"),
            },
            // tira dados sensíveis
            redact: [
                "req.headers.authorization",
                "req.headers.cookie",
                "res.headers.set-cookie",
            ],
            // SERIALIZERS ENXUTOS (evita o dump gigante)
            serializers: {
                req(req) {
                    return {
                        id: req.id,
                        method: req.method,
                        url: req.url,
                        ip: req.ip,
                    };
                },
                res(res) {
                    return {
                        statusCode: res.statusCode,
                    };
                },
            },
            // renomeia chaves e inclui tempo
            customAttributeKeys: {
                req: "request",
                res: "response",
                err: "error",
                responseTime: "time",
            },
            // define o nível conforme o modo e o status
            customLogLevel(req, res, err) {
                const sc = res.statusCode || 0;
                if (mode === "none") return "silent";
                if (mode === "errors") {
                    if (err || sc >= 500) return "error";
                    if (sc >= 400) return "warn";
                    return "silent"; // só erros/4xx/5xx
                }
                if (mode === "basic") {
                    if (err || sc >= 500) return "error";
                    if (sc >= 400) return "warn";
                    return "info";
                }
                // verbose
                if (err || sc >= 500) return "error";
                if (sc >= 400) return "warn";
                return "info";
            },
            // mensagens curtas
            customReceivedMessage: (req /*, res*/) =>
                `→ ${req.method} ${req.url}`,
            customSuccessMessage: (req, res) =>
                `✓ ${req.method} ${req.url} ${res.statusCode}`,
            customErrorMessage: (req, res, err) =>
                `✗ ${req.method} ${req.url} ${res.statusCode} - ${err && err.message}`,
        })
    );
}

/** Middleware final de erro */
function errorHandler(err, req, res, _next) {
    const status = err?.status || 500;
    if (status >= 500) req.log?.error({ err }, "Erro não tratado");
    else req.log?.warn({ err }, "Erro tratado");

    res
        .status(status)
        .json({ error: status >= 500 ? "Internal Server Error" : err.message });
}

module.exports = { logger, applyLogging, errorHandler };
