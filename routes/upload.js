// routes/upload.js
const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const router = express.Router();

// Limite de upload em MB (configurável no .env)
const MAX_MB = Number(process.env.UPLOAD_MAX_MB || 15);
router.use(express.json({ limit: `${MAX_MB}mb` }));

// Pasta base local
const EXPORTS_DIR = path.join(process.cwd(), "exports"); // você já serve /exports estático
const UPLOADS_DIR = path.join(EXPORTS_DIR, "uploads");

if (!fs.existsSync(EXPORTS_DIR)) fs.mkdirSync(EXPORTS_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Helpers
function stripDataUrl(b64) {
    return String(b64).replace(/^data:.*;base64,/, "");
}
function detectExt(mime, extFromBody) {
    const fromMime = (mime || "").split("/")[1];
    const ext = extFromBody || fromMime || "bin";
    return String(ext).toLowerCase().replace(/[^a-z0-9.]/gi, "");
}
function buildKey(prefix, sha, refId, ext) {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, "0");
    const p = prefix || "uploads";
    return `${p}/${y}/${m}/${sha}${refId ? "-" + refId : ""}.${ext}`;
}

// =====================================================
// POST /upload
// =====================================================
router.post("/", async (req, res, next) => {
    try {
        const { base64, mime, ext, prefix, refId } = req.body || {};
        if (!base64 || !mime) {
            const e = new Error("base64 e mime são obrigatórios");
            e.status = 400;
            throw e;
        }

        // remove cabeçalho do base64
        const raw = stripDataUrl(base64);
        const buf = Buffer.from(raw, "base64");

        // limite
        if (buf.length > MAX_MB * 1024 * 1024) {
            const e = new Error(`Arquivo excede limite de ${MAX_MB}MB`);
            e.status = 413;
            throw e;
        }

        // gera hash e nome
        const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
        const safeExt = detectExt(mime, ext);
        const key = buildKey(prefix, sha256, refId, safeExt);

        // cria subpastas /exports/uploads/ano/mes/
        const subPath = path.join(UPLOADS_DIR, ...key.split("/").slice(1, -1)); // remove 'uploads' do início
        if (!fs.existsSync(subPath)) fs.mkdirSync(subPath, { recursive: true });

        const absPath = path.join(UPLOADS_DIR, ...key.split("/").slice(1)); // caminho completo
        fs.writeFileSync(absPath, buf);

        const publicUrl = `/exports/${key}`;

        return res.json({
            ok: true,
            backend: "disk",
            key,
            mime,
            size: buf.length,
            sha256,
            url: publicUrl,
        });
    } catch (e) {
        return next(e);
    }
});

// =====================================================
// DELETE /upload
// =====================================================
router.delete("/", async (req, res, next) => {
    try {
        const { key } = req.body || {};
        if (!key) return res.status(400).json({ erro: "key obrigatória" });

        const absPath = path.join(UPLOADS_DIR, ...key.split("/").slice(1));
        if (fs.existsSync(absPath)) {
            fs.unlinkSync(absPath);
            return res.json({ ok: true, deleted: key });
        } else {
            return res.status(404).json({ erro: "arquivo não encontrado" });
        }
    } catch (e) {
        return next(e);
    }
});

module.exports = router;
