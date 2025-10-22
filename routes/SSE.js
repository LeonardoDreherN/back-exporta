const express = require('express');
const router = express.Router();
const clients = new Set();

router.get('/status', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3000'); // ou a URL do seu front
    res.flushHeaders?.();

    clients.add(res);

    // ping a cada 15s pra evitar timeouts de proxy
    const iv = setInterval(() => {
        res.write(`event: ping\ndata: "ok"\n\n`);
    }, 15000);

    req.on('close', () => {
        clearInterval(iv);
        clients.delete(res);
    });
});

function broadcastStatusUpdate(payload) {
    const data = `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of clients) res.write(data);
}

module.exports = { router, broadcastStatusUpdate };
