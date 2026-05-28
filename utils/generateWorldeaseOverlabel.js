const { PDFDocument, rgb, StandardFonts, degrees } = require('pdf-lib');

// UPS brown color
const UPS_BROWN = rgb(0.49, 0.31, 0.03);
const BLACK = rgb(0, 0, 0);
const WHITE = rgb(1, 1, 1);

// 4" x 6" in points (72 pts per inch)
const PAGE_W = 288;
const PAGE_H = 432;

const SIDE_STRIP_W = 36;

/**
 * Gera a overlabel WorldEase em PDF (Buffer)
 * @param {object} params
 * @param {string} params.importerName   Nome do importador (IOR)
 * @param {string} params.address        Endereço (rua + número)
 * @param {string} params.city           Cidade
 * @param {string} params.state          Estado/Província
 * @param {string} params.zip            CEP / Código Postal
 * @param {string} params.country        País (ex: BR, JP, US)
 * @param {string} [params.trackingNumber] Número de rastreio do pacote individual
 * @returns {Promise<Buffer>}
 */
async function generateWorldeaseOverlabel({ importerName, address, city, state, zip, country, trackingNumber }) {
    const doc = await PDFDocument.create();
    const page = doc.addPage([PAGE_W, PAGE_H]);

    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const regular = await doc.embedFont(StandardFonts.Helvetica);

    // Faixa lateral esquerda — UPS brown com texto rotacionado
    page.drawRectangle({
        x: 0,
        y: 0,
        width: SIDE_STRIP_W,
        height: PAGE_H,
        color: UPS_BROWN,
    });

    page.drawText('UPS World Ease', {
        x: SIDE_STRIP_W / 2 + 5,
        y: PAGE_H / 2 - 40,
        size: 11,
        font: bold,
        color: WHITE,
        rotate: degrees(90),
    });

    // Borda externa da área de conteúdo
    page.drawRectangle({
        x: SIDE_STRIP_W,
        y: 0,
        width: PAGE_W - SIDE_STRIP_W,
        height: PAGE_H,
        borderColor: BLACK,
        borderWidth: 1,
    });

    const contentX = SIDE_STRIP_W + 10;
    let y = PAGE_H - 30;

    // Cabeçalho "SHIP TO:"
    page.drawText('SHIP TO:', {
        x: contentX,
        y,
        size: 14,
        font: bold,
        color: BLACK,
    });

    y -= 28;
    page.drawText(importerName || '', {
        x: contentX,
        y,
        size: 12,
        font: bold,
        color: BLACK,
        maxWidth: PAGE_W - SIDE_STRIP_W - 20,
    });

    y -= 22;
    if (address) {
        page.drawText(address, {
            x: contentX,
            y,
            size: 10,
            font: regular,
            color: BLACK,
            maxWidth: PAGE_W - SIDE_STRIP_W - 20,
        });
        y -= 18;
    }

    if (city || state) {
        const cityState = [city, state].filter(Boolean).join(', ');
        page.drawText(cityState, {
            x: contentX,
            y,
            size: 10,
            font: regular,
            color: BLACK,
            maxWidth: PAGE_W - SIDE_STRIP_W - 20,
        });
        y -= 18;
    }

    if (zip || country) {
        page.drawText(`${zip || ''} - ${country || ''}`, {
            x: contentX,
            y,
            size: 10,
            font: regular,
            color: BLACK,
        });
        y -= 18;
    }

    // Linha separadora
    y -= 10;
    page.drawLine({
        start: { x: SIDE_STRIP_W + 5, y },
        end: { x: PAGE_W - 10, y },
        thickness: 0.5,
        color: BLACK,
    });

    // Tracking number (referência)
    if (trackingNumber) {
        y -= 20;
        page.drawText('Tracking:', {
            x: contentX,
            y,
            size: 8,
            font: bold,
            color: BLACK,
        });
        y -= 14;
        page.drawText(trackingNumber, {
            x: contentX,
            y,
            size: 9,
            font: regular,
            color: BLACK,
        });
    }

    const pdfBytes = await doc.save();
    return Buffer.from(pdfBytes);
}

module.exports = { generateWorldeaseOverlabel };
