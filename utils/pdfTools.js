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

async function imagePngB64ToPdfB64(pngB64) {
    try {
        const pngBytes = Buffer.from(pngB64, 'base64');
        const pdfDoc = await PDFDocument.create();
        const pngImage = await pdfDoc.embedPng(pngBytes);
        const pngDims = pngImage.scale(1);

        const page = pdfDoc.addPage([pngDims.width, pngDims.height]);
        page.drawImage(pngImage, {
            x: 0,
            y: 0,
            width: pngDims.width,
            height: pngDims.height,
        });

        const pdfBytes = await pdfDoc.save();
        return Buffer.from(pdfBytes).toString('base64');
    } catch (err) {
        console.error('Erro ao converter PNG para PDF:', err);
        return pngB64; // fallback: devolve original
    }
}

module.exports = { keepFirstPageFromPdfB64, imagePngB64ToPdfB64 };