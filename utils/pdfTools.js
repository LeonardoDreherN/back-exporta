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

/**
 * Junta as etiquetas de um envio multi-volume num PDF só, uma página por
 * volume: a transportadora devolve uma etiqueta por caixa e a cotação tem uma
 * vaga de etiqueta, então quem despacha baixa um arquivo e imprime o lote.
 *
 * PDF entra por cópia de páginas, PNG/JPG entram como página do tamanho da
 * imagem. Qualquer outro formato (ZPL, por exemplo) devolve null — aí quem
 * chamou decide o fallback, em vez de salvar um arquivo quebrado.
 *
 * @param {Array<{ b64: string, mime?: string }>} partes
 * @returns {Promise<string|null>} base64 do PDF juntado
 */
async function mesclarEtiquetasEmPdfB64(partes = []) {
    const lista = (Array.isArray(partes) ? partes : []).filter(
        (p) => p && typeof p.b64 === 'string' && p.b64.trim()
    );
    if (!lista.length) return null;

    try {
        const out = await PDFDocument.create();

        for (const parte of lista) {
            const mime = String(parte.mime || 'application/pdf').toLowerCase();
            const bytes = Buffer.from(parte.b64, 'base64');

            if (mime.includes('pdf')) {
                const src = await PDFDocument.load(bytes);
                const pages = await out.copyPages(src, src.getPageIndices());
                for (const p of pages) out.addPage(p);
                continue;
            }

            if (mime.includes('png') || mime.includes('jpeg') || mime.includes('jpg')) {
                const img = mime.includes('png')
                    ? await out.embedPng(bytes)
                    : await out.embedJpg(bytes);
                const dims = img.scale(1);
                const page = out.addPage([dims.width, dims.height]);
                page.drawImage(img, { x: 0, y: 0, width: dims.width, height: dims.height });
                continue;
            }

            return null;
        }

        if (!out.getPageCount()) return null;

        const pdfBytes = await out.save();
        return Buffer.from(pdfBytes).toString('base64');
    } catch (err) {
        console.error('[ETIQUETA][MERGE] falhou ao juntar as etiquetas:', err?.message);
        return null;
    }
}

module.exports = {
    keepFirstPageFromPdfB64,
    imagePngB64ToPdfB64,
    mesclarEtiquetasEmPdfB64,
};