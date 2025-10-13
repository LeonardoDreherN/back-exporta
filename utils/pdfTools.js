// utils/pdfTools.js
const { PDFDocument } = require('pdf-lib');

async function keepFirstPageFromPdfB64(b64) {
    try {
        const bytes = Buffer.from(b64, 'base64');
        const src = await PDFDocument.load(bytes);
        if (src.getPageCount() <= 1) return b64;
        const dst = await PDFDocument.create();
        const [p0] = await dst.copyPages(src, [0]);
        dst.addPage(p0);
        const out = await dst.save();
        return Buffer.from(out).toString('base64');
    } catch {
        return b64; // se algo falhar, devolve o original
    }
}

module.exports = { keepFirstPageFromPdfB64 };
