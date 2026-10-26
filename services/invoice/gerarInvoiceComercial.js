/*
 * Invoice comercial gerada pela Intrex, no formulario padrao da FedEx
 * (Commercial Invoice, REV. 08-23-22).
 *
 * A FedEx nao devolve invoice em todo envio. Nos envios para a Colombia ela
 * criou a etiqueta e devolveu `shipmentDocuments: []`, sem alerta nenhum —
 * quatro vezes seguidas, enquanto 226 envios para outros 18 paises vieram
 * com invoice normalmente. O payload pede a invoice em dois lugares e ainda
 * assim nao vem, entao nao da para contar com ela.
 *
 * A invoice comercial e documento do exportador, nao da transportadora:
 * emitir aqui nao e contorno, e o lugar certo. Os dados sao os mesmos
 * declarados a transportadora na emissao, para o papel nao divergir do que a
 * alfandega ja recebeu.
 *
 * O desenho segue o formulario da FedEx campo a campo, e nao um layout
 * proprio: e o papel que o despachante e a alfandega esperam ver, e divergir
 * dele cria pergunta onde nao havia.
 *
 * Em ingles porque o proprio formulario exige ("This invoice must be
 * completed in English").
 */
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const A4 = [595.28, 841.89];
const MARGEM = 28;
const PRETO = rgb(0, 0, 0);
const BORDA = rgb(0, 0, 0);

const texto = (v) => String(v ?? '').trim();

// O formulario pede o nome do pais por extenso, nao o codigo ISO.
const PAISES = {
    AE: 'UNITED ARAB EMIRATES', AR: 'ARGENTINA', AU: 'AUSTRALIA', AT: 'AUSTRIA',
    BE: 'BELGIUM', BR: 'BRAZIL', CA: 'CANADA', CH: 'SWITZERLAND', CL: 'CHILE',
    CN: 'CHINA', CO: 'COLOMBIA', CY: 'CYPRUS', CZ: 'CZECH REPUBLIC',
    DE: 'GERMANY', DK: 'DENMARK', ES: 'SPAIN', FI: 'FINLAND', FR: 'FRANCE',
    GB: 'UNITED KINGDOM', GR: 'GREECE', HR: 'CROATIA', IE: 'IRELAND',
    IL: 'ISRAEL', IT: 'ITALY', JP: 'JAPAN', MX: 'MEXICO', NL: 'NETHERLANDS',
    NO: 'NORWAY', NZ: 'NEW ZEALAND', PE: 'PERU', PL: 'POLAND', PT: 'PORTUGAL',
    PY: 'PARAGUAY', SA: 'SAUDI ARABIA', SE: 'SWEDEN', SG: 'SINGAPORE',
    UY: 'URUGUAY', US: 'UNITED STATES OF AMERICA', ZA: 'SOUTH AFRICA',
};

const nomePais = (codigo) => {
    const c = texto(codigo).toUpperCase();
    return PAISES[c] || c;
};

const MESES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// O formulario usa "16 Sep, 2026".
function dataFormulario(valor) {
    const d = valor ? new Date(valor) : new Date();
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getDate()} ${MESES[d.getMonth()]}, ${d.getFullYear()}`;
}

function numero(n, casas = 2) {
    const v = Number(n) || 0;
    return v.toFixed(casas);
}

/*
 * A alfandega recusa descricao vaga, e a FedEx tambem (VAGUE.NOTALLOWED). O
 * cadastro tem `descricao`, que e o texto pensado para a invoice; `titulo` e
 * o nome do anuncio da loja e pode nem estar em ingles. Usa a descricao e so
 * cai no titulo quando ela esta vazia: nome imperfeito e melhor do que linha
 * em branco num documento de alfandega.
 */
function descricaoItem(item, indice) {
    return (
        texto(item?.descricao) ||
        texto(item?.description) ||
        texto(item?.titulo) ||
        texto(item?.name) ||
        `Item ${indice + 1}`
    );
}

function valorUnitario(item) {
    const unit = Number(item?.preco ?? item?.unitPrice ?? item?.price);
    if (Number.isFinite(unit) && unit > 0) return unit;

    // Algumas lojas mandam so o total da linha.
    const linha = Number(item?.valorTotalLinha ?? item?.total);
    const qty = Number(item?.qty ?? item?.quantidade) || 1;
    if (Number.isFinite(linha) && linha > 0) return linha / qty;

    return 0;
}

/*
 * Peso liquido do item.
 *
 * O peso unitario do produto costuma vir vazio no cadastro. Sem ele o campo
 * fica em branco: somar so a tara da caixa daria "0,100 kg" para uma caixa
 * com 2 kg de mercadoria dentro, que e declaracao falsa de peso. Campo vazio
 * a alfandega pergunta; campo errado ela autua.
 */
function pesoLiquidoItem(item) {
    const p = Number(item?.pesoUnit ?? item?.peso ?? 0) || 0;
    const q = Number(item?.qty ?? item?.quantidade) || 1;
    return p * q;
}

async function gerarInvoiceComercial({ cotacao, cliente }) {
    const pedido = cotacao?.pedido || {};
    const itens = Array.isArray(pedido.itens) ? pedido.itens : [];
    const caixas = Array.isArray(cotacao?.caixa) ? cotacao.caixa : [];
    const moeda = texto(pedido.moeda).toUpperCase() || 'USD';
    const termos = texto(pedido?.triangulacao) || 'DDP';

    const doc = await PDFDocument.create();
    const pagina = doc.addPage(A4);
    const normal = await doc.embedFont(StandardFonts.Helvetica);
    const forte = await doc.embedFont(StandardFonts.HelveticaBold);
    const { width, height } = pagina.getSize();

    const X0 = MARGEM;
    const X1 = width - MARGEM;
    const LARG = X1 - X0;

    // ---------------- primitivas de desenho ----------------

    const cortar = (t, fonte, size, max) => {
        let s = texto(t);
        while (s && fonte.widthOfTextAtSize(s, size) > max) s = s.slice(0, -1);
        return s;
    };

    /*
     * Quebra em palavras dentro da largura disponivel. Cortar no limite e
     * perder informacao, e endereco truncado numa invoice e endereco errado.
     */
    const quebrar = (t, fonte, size, max, limite = 3) => {
        const palavras = texto(t).split(/\s+/).filter(Boolean);
        if (!palavras.length) return [];

        const linhas = [];
        let atual = '';

        for (const palavra of palavras) {
            const tentativa = atual ? `${atual} ${palavra}` : palavra;
            if (fonte.widthOfTextAtSize(tentativa, size) <= max) {
                atual = tentativa;
                continue;
            }
            if (atual) linhas.push(atual);
            atual = fonte.widthOfTextAtSize(palavra, size) > max
                ? cortar(palavra, fonte, size, max)
                : palavra;
            if (linhas.length === limite) break;
        }

        if (linhas.length < limite && atual) linhas.push(atual);
        return linhas.slice(0, limite);
    };

    const txt = (t, x, y, { size = 7, fonte = normal, max } = {}) => {
        const s = max ? cortar(t, fonte, size, max) : texto(t);
        if (!s) return;
        pagina.drawText(s, { x, y, size, font: fonte, color: PRETO });
    };

    const txtDir = (t, xFim, y, { size = 7, fonte = normal } = {}) => {
        const s = texto(t);
        if (!s) return;
        pagina.drawText(s, {
            x: xFim - fonte.widthOfTextAtSize(s, size),
            y, size, font: fonte, color: PRETO,
        });
    };

    const txtCentro = (t, xa, xb, y, { size = 7, fonte = normal } = {}) => {
        const s = texto(t);
        if (!s) return;
        pagina.drawText(s, {
            x: (xa + xb) / 2 - fonte.widthOfTextAtSize(s, size) / 2,
            y, size, font: fonte, color: PRETO,
        });
    };

    const linhaH = (xa, xb, y) => pagina.drawLine({
        start: { x: xa, y }, end: { x: xb, y },
        thickness: 0.7, color: BORDA,
    });

    const linhaV = (x, ya, yb) => pagina.drawLine({
        start: { x, y: ya }, end: { x, y: yb },
        thickness: 0.7, color: BORDA,
    });

    const caixaVazia = (x, y, lado = 7) => pagina.drawRectangle({
        x, y, width: lado, height: lado,
        borderWidth: 0.7, borderColor: BORDA,
    });

    // Caixinha de marcar: o X vai dentro, como no formulario impresso.
    const marcar = (x, y, marcado, lado = 7) => {
        caixaVazia(x, y, lado);
        if (marcado) txt('X', x + 1.6, y + 1.3, { size: 6.5, fonte: forte });
    };

    // ---------------- dados ----------------

    const exportador = {
        taxId: texto(cliente?.cnpj),
        contato: texto(cliente?.razaoSocial),
        telefone: texto(cliente?.telefoneCelular),
        email: texto(cliente?.emailPrincipal),
        nome: texto(cliente?.razaoSocial),
        endereco: [texto(cliente?.enderecoRua), texto(cliente?.enderecoNumero)]
            .filter(Boolean).join(', '),
        complemento: texto(cliente?.enderecoComplemento),
        cidadeLinha: [
            texto(cliente?.enderecoCidade),
            texto(cliente?.enderecoEstado),
            texto(cliente?.enderecoCEP),
        ].filter(Boolean).join(' '),
        pais: nomePais(cliente?.enderecoPais),
    };

    const consignatario = {
        contato: texto(pedido?.nomeComprador),
        telefone: texto(pedido?.telefoneComprador),
        email: texto(pedido?.emailComprador),
        nome: texto(pedido?.nomeComprador),
        endereco: texto(pedido?.endereco),
        cidadeLinha: [texto(pedido?.cidade), texto(pedido?.estado), texto(pedido?.CEP)]
            .filter(Boolean).join(' '),
        pais: nomePais(pedido?.pais),
    };

    /*
     * Importador de registro so entra quando e outra parte E esta no pais de
     * destino. O cadastro guarda um IOR fixo por cliente, pensado para
     * triangulacao nos EUA; num envio para outro pais esse IOR poria na
     * invoice um importador sem relacao com a operacao. Sem IOR valido, vale
     * "Same as CONSIGNEE", que e o caso normal.
     */
    const paisIOR = texto(cliente?.paisIOR).toUpperCase();
    const paisDestino = texto(pedido?.pais).toUpperCase();
    const temIOR = Boolean(texto(cliente?.nomeIOR) && paisIOR && paisIOR === paisDestino);

    const importador = temIOR ? {
        taxId: texto(cliente?.state_tax_idIOR),
        nome: texto(cliente?.nomeIOR),
        endereco: texto(cliente?.enderecoIOR),
        cidadeLinha: [
            texto(cliente?.cidadeIOR),
            texto(cliente?.estadoIOR),
            texto(cliente?.cod_postalIOR),
        ].filter(Boolean).join(' '),
        pais: nomePais(cliente?.paisIOR),
    } : null;

    // ---------------- titulo ----------------

    let y = height - MARGEM - 12;
    txtCentro('Commercial Invoice', X0, X1, y, { size: 13, fonte: forte });
    y -= 11;
    txt('This invoice must be completed in English.', X0, y, { size: 6.5, fonte: forte });
    txtDir('Page _____ of _____', X1, y, { size: 6.5 });
    txt('1', X1 - 62, y + 3, { size: 6.5 });
    txt('1', X1 - 18, y + 3, { size: 6.5 });

    y -= 5;
    const TOPO = y;

    // ---------------- grade ----------------

    const XM = X0 + 268;           // divisor das colunas de cima
    const XR = X0 + 398;           // coluna de valores do rodape

    const H_PARTES = 122;          // EXPORTER / dados do envio
    const H_CONSIG = 118;          // CONSIGNEE / SOLD TO
    const H_BROKER = 15;
    const H_DUTIES = 15;
    const H_CAB_TAB = 20;
    const H_TOT = 26;              // linha de totais
    const H_ESPECIAL = 36;
    const H_DECLARACAO = 36;
    const H_DECLARO = 16;
    const H_ORIGEM = 26;
    const H_ASSINA = 26;

    const fixo = H_PARTES + H_CONSIG + H_BROKER + H_DUTIES + H_CAB_TAB
        + H_TOT + H_ESPECIAL + H_DECLARACAO + H_DECLARO + H_ORIGEM + H_ASSINA;

    // O corpo da tabela fica com o que sobra da pagina, como no formulario.
    const H_CORPO = (TOPO - MARGEM) - fixo;
    const BASE = MARGEM;

    const yParteTopo = TOPO;
    const yParteBase = yParteTopo - H_PARTES;
    const yConsigBase = yParteBase - H_CONSIG;
    const yBrokerBase = yConsigBase - H_BROKER;
    const yDutiesBase = yBrokerBase - H_DUTIES;
    const yCabBase = yDutiesBase - H_CAB_TAB;
    const yCorpoBase = yCabBase - H_CORPO;
    const yTotBase = yCorpoBase - H_TOT;
    const yEspecialBase = yTotBase - H_ESPECIAL;
    const yDeclaracaoBase = yEspecialBase - H_DECLARACAO;
    const yDeclaroBase = yDeclaracaoBase - H_DECLARO;
    const yOrigemBase = yDeclaroBase - H_ORIGEM;

    // moldura externa
    pagina.drawRectangle({
        x: X0, y: BASE, width: LARG, height: TOPO - BASE,
        borderWidth: 0.9, borderColor: BORDA,
    });

    [yParteBase, yConsigBase, yBrokerBase, yDutiesBase, yCabBase,
        yCorpoBase, yTotBase].forEach((yy) => linhaH(X0, X1, yy));

    // divisor vertical das duas caixas de cima
    linhaV(XM, yConsigBase, yParteTopo);

    // ---------------- EXPORTER ----------------

    let yy = yParteTopo - 9;
    const L = X0 + 3;
    const rotulo = (t, x, yv) => txt(t, x, yv, { size: 6, fonte: forte });

    rotulo('EXPORTER:', L, yy);
    yy -= 9;
    rotulo('Tax ID#:', L, yy);
    txt(exportador.taxId, L + 34, yy, { size: 6.5, max: XM - L - 40 });
    yy -= 9;
    rotulo('Contact Name:', L, yy);
    txt(exportador.contato, L + 52, yy, { size: 6.5, max: XM - L - 58 });
    yy -= 9;
    rotulo('Telephone No.:', L, yy);
    txt(exportador.telefone, L + 54, yy, { size: 6.5, max: XM - L - 60 });
    yy -= 9;
    rotulo('E-Mail:', L, yy);
    txt(exportador.email, L + 28, yy, { size: 6.5, max: XM - L - 34 });
    yy -= 9;
    rotulo('Company Name/Address:', L, yy);
    yy -= 9;
    [exportador.nome, exportador.endereco, exportador.complemento]
        .filter(Boolean)
        .forEach((linha) => {
            quebrar(linha, normal, 6.5, XM - L - 6, 1).forEach((l) => {
                txt(l, L, yy, { size: 6.5 });
                yy -= 8;
            });
        });

    // cidade/estado/CEP e pais ficam colados no pe da caixa, como no modelo
    txt(exportador.cidadeLinha, L, yParteBase + 24, { size: 6.5, max: XM - L - 6 });
    rotulo('Country/Territory:', L, yParteBase + 15);
    txt(exportador.pais, L + 62, yParteBase + 15, { size: 6.5, max: XM - L - 68 });
    rotulo('Parties to Transaction:', L, yParteBase + 7);
    marcar(L + 6, yParteBase - 4, false);
    txt('Related', L + 16, yParteBase - 2.5, { size: 6, fonte: forte });
    marcar(L + 80, yParteBase - 4, true);
    txt('Non-Related', L + 90, yParteBase - 2.5, { size: 6, fonte: forte });

    // ---------------- dados do envio (direita) ----------------

    const R = XM + 4;
    yy = yParteTopo - 9;

    rotulo('Ship Date:', R, yy);
    yy -= 9;
    txt(dataFormulario(cotacao?.created_at), R + 4, yy, { size: 6.5 });
    yy -= 10;
    rotulo('Air Waybill No. / Tracking No.:', R, yy);
    yy -= 9;
    txt(texto(cotacao?.tracking_number), R + 4, yy, { size: 6.5 });
    yy -= 10;
    rotulo('Invoice No.:', R, yy);
    rotulo('Purchase Order No.:', R + 170, yy);
    yy -= 9;
    const anoInvoice = new Date(cotacao?.created_at || Date.now()).getFullYear();
    txt(`INV-${anoInvoice}-#${texto(cotacao?.pedido_ref)}`, R + 4, yy, { size: 6.5, max: 160 });
    yy -= 10;
    rotulo('Payment Terms:', R, yy);
    rotulo('Bill of Lading:', R + 170, yy);
    yy -= 9;
    txt('Paid in Advance', R + 4, yy, { size: 6.5 });
    yy -= 10;
    rotulo('Purpose of Shipment:', R, yy);
    yy -= 9;
    txt('Commercial', R + 4, yy, { size: 6.5 });

    // ---------------- CONSIGNEE ----------------

    yy = yParteBase - 9;
    rotulo('CONSIGNEE:', L, yy);
    yy -= 9;
    rotulo('Tax ID#:', L, yy);
    yy -= 9;
    rotulo('Contact Name:', L, yy);
    txt(consignatario.contato, L + 52, yy, { size: 6.5, max: XM - L - 58 });
    yy -= 9;
    rotulo('Telephone No.:', L, yy);
    txt(consignatario.telefone, L + 54, yy, { size: 6.5, max: XM - L - 60 });
    yy -= 9;
    rotulo('E-Mail:', L, yy);
    txt(consignatario.email, L + 28, yy, { size: 6.5, max: XM - L - 34 });
    yy -= 9;
    rotulo('Company Name/Address:', L, yy);
    yy -= 9;
    [consignatario.nome, consignatario.endereco].filter(Boolean).forEach((linha) => {
        quebrar(linha, normal, 6.5, XM - L - 6, 2).forEach((l) => {
            txt(l, L, yy, { size: 6.5 });
            yy -= 8;
        });
    });

    txt(consignatario.cidadeLinha, L, yConsigBase + 15, { size: 6.5, max: XM - L - 6 });
    rotulo('Country/Territory:', L, yConsigBase + 6);
    txt(consignatario.pais, L + 62, yConsigBase + 6, { size: 6.5, max: XM - L - 68 });

    // ---------------- SOLD TO / IMPORTER ----------------

    yy = yParteBase - 9;
    rotulo('SOLD TO / IMPORTER (if different from Consignee):', R, yy);
    yy -= 12;
    marcar(R + 2, yy - 1, !temIOR);
    txt('Same as CONSIGNEE:', R + 14, yy, { size: 6, fonte: forte });
    yy -= 14;
    rotulo('Tax ID#:', R, yy);
    if (importador) txt(importador.taxId, R + 34, yy, { size: 6.5, max: X1 - R - 40 });
    yy -= 14;
    rotulo('Company Name/Address:', R, yy);
    yy -= 9;
    if (importador) {
        [importador.nome, importador.endereco].filter(Boolean).forEach((linha) => {
            quebrar(linha, normal, 6.5, X1 - R - 6, 2).forEach((l) => {
                txt(l, R, yy, { size: 6.5 });
                yy -= 8;
            });
        });
        txt(importador.cidadeLinha, R, yConsigBase + 15, { size: 6.5, max: X1 - R - 6 });
    }
    rotulo('Country/Territory:', R, yConsigBase + 6);
    if (importador) {
        txt(importador.pais, R + 62, yConsigBase + 6, { size: 6.5, max: X1 - R - 68 });
    }

    // ---------------- broker / duties ----------------

    txt('If there is a designated broker for this shipment, please provide contact information.',
        L, yConsigBase - 10, { size: 6, fonte: forte });

    rotulo('Name of Broker', L, yBrokerBase - 10);
    rotulo('Tel. No.', X0 + 180, yBrokerBase - 10);
    rotulo('Contact Name', X0 + 330, yBrokerBase - 10);

    rotulo('Duties and Taxes Payable by', L, yDutiesBase - 10.5);
    // DDP: quem paga e o exportador. Qualquer outro incoterm, o consignatario.
    const pagaExportador = termos.toUpperCase() === 'DDP';
    marcar(L + 100, yDutiesBase - 12, pagaExportador);
    txt('Exporter', L + 110, yDutiesBase - 10.5, { size: 6, fonte: forte });
    marcar(L + 148, yDutiesBase - 12, !pagaExportador);
    txt('Consignee', L + 158, yDutiesBase - 10.5, { size: 6, fonte: forte });
    marcar(L + 200, yDutiesBase - 12, false);
    txt('Other', L + 210, yDutiesBase - 10.5, { size: 6, fonte: forte });
    txt('If Other, please specify', L + 240, yDutiesBase - 10.5, { size: 6, fonte: forte });

    // ---------------- tabela ----------------

    const colunas = [
        { t: ['No. of', 'Packages'], x: X0, w: 42, dir: false },
        { t: ['No. of', 'Units'], x: X0 + 42, w: 36, dir: true },
        { t: ['Net Weight', '(LBS / KGS)'], x: X0 + 78, w: 48, dir: true },
        { t: ['Unit of', 'Measure'], x: X0 + 126, w: 42, dir: false },
        { t: ['Description of Goods'], x: X0 + 168, w: 170, dir: false },
        { t: ['Harmonized', 'Tariff Number'], x: X0 + 338, w: 62, dir: false },
        { t: ['Country/', 'Terr. of MFR'], x: X0 + 400, w: 50, dir: false },
        { t: ['Unit', 'Value'], x: X0 + 450, w: 48, dir: true },
        { t: ['Total', 'Value'], x: X0 + 498, w: LARG - 498, dir: true },
    ];

    colunas.forEach((c, i) => {
        if (i > 0) linhaV(c.x, yCorpoBase, yCabBase + H_CAB_TAB);
        const linhas = c.t;
        linhas.forEach((t, n) => {
            txtCentro(t, c.x, c.x + c.w, yCabBase + H_CAB_TAB - 8 - n * 7,
                { size: 5.6, fonte: forte });
        });
    });

    let yLinha = yCabBase - 9;
    let somaValor = 0;
    let somaUnidades = 0;
    let somaPesoLiquido = 0;

    itens.forEach((item, i) => {
        const qty = Number(item?.qty ?? item?.quantidade) || 1;
        const unit = valorUnitario(item);
        const total = unit * qty;
        const peso = pesoLiquidoItem(item);

        somaValor += total;
        somaUnidades += qty;
        somaPesoLiquido += peso;

        const celulas = [
            '',
            numero(qty),
            peso ? numero(peso) : '',
            'PCS',
            null, // descricao desenhada a parte: ocupa varias linhas
            texto(item?.hscode || item?.hsCode),
            texto(item?.countryOfOrigin) || texto(cliente?.enderecoPais) || 'BR',
            numero(unit, 6),
            numero(total),
        ];

        celulas.forEach((v, c) => {
            if (v === null) return;
            const col = colunas[c];
            if (col.dir) txtDir(v, col.x + col.w - 3, yLinha, { size: 6.5 });
            else txt(v, col.x + 3, yLinha, { size: 6.5, max: col.w - 6 });
        });

        const colDesc = colunas[4];
        const linhasDesc = quebrar(descricaoItem(item, i), normal, 6.5, colDesc.w - 6, 3);
        linhasDesc.forEach((l, n) => txt(l, colDesc.x + 3, yLinha - n * 7.5, { size: 6.5 }));

        yLinha -= Math.max(1, linhasDesc.length) * 7.5 + 2;
    });

    // ---------------- linha de totais ----------------

    const totCols = [
        { t: ['Total', 'Pkgs'], x: X0, w: 42 },
        { t: ['Total', 'Units'], x: X0 + 42, w: 36 },
        { t: ['Total Net', 'Weight'], x: X0 + 78, w: 48 },
        { t: ['Total Gross', 'Weight'], x: X0 + 126, w: 60 },
        { t: ['Terms', 'of Sale:'], x: X0 + 186, w: 80 },
    ];
    totCols.forEach((c, i) => {
        if (i > 0) linhaV(c.x, yTotBase, yCorpoBase);
        c.t.forEach((t, n) => txt(t, c.x + 3, yCorpoBase - 8 - n * 7, { size: 5.6, fonte: forte }));
    });
    txt('(Indicate', X0 + 78 + 30, yCorpoBase - 8, { size: 5.2, fonte: forte });
    txt('LBS/KGS)', X0 + 78 + 30, yCorpoBase - 15, { size: 5.2, fonte: forte });
    txt('(Indicate', X0 + 126 + 32, yCorpoBase - 8, { size: 5.2, fonte: forte });
    txt('LBS/KGS)', X0 + 126 + 32, yCorpoBase - 15, { size: 5.2, fonte: forte });

    txt(termos, X0 + 186 + 32, yCorpoBase - 8, { size: 6.5 });

    const yValTot = yTotBase + 7;
    txt(String(caixas.length || 1), X0 + 6, yValTot, { size: 6.5 });
    txt(numero(somaUnidades), X0 + 46, yValTot, { size: 6.5 });
    txt(somaPesoLiquido ? `${numero(somaPesoLiquido)} KG` : '', X0 + 86, yValTot, { size: 6.5 });

    // ---------------- coluna de valores ----------------

    linhaV(XR, BASE, yTotBase);

    const frete = Number(cotacao?.preco_final) || 0;
    const valores = [
        ['Subtotal:', numero(somaValor), yTotBase],
        ['Insurance:', numero(0), yTotBase - 20],
        ['Freight:', numero(frete), yTotBase - 40],
        ['Packing:', numero(0), yTotBase - 60],
        ['Handling:', numero(0), yTotBase - 80],
        ['Other:', numero(0), yTotBase - 100],
        ['Invoice Total:', numero(somaValor + frete), yTotBase - 120],
        ['Currency Code:', moeda, yTotBase - 140],
    ];
    valores.forEach(([rot, val, yTopoCel]) => {
        linhaH(XR, X1, yTopoCel - 20);
        txt(rot, XR + 4, yTopoCel - 13, { size: 6.5, fonte: forte });
        txtDir(val, X1 - 5, yTopoCel - 13, { size: 6.5 });
    });

    // ---------------- blocos de texto do rodape ----------------

    linhaH(X0, XR, yEspecialBase);
    linhaH(X0, XR, yDeclaracaoBase);
    linhaH(X0, XR, yDeclaroBase);
    linhaH(X0, XR, yOrigemBase);

    txt('Special Instructions:', L, yTotBase - 10, { size: 6, fonte: forte });
    txt('Declaration Statement(s):', L, yEspecialBase - 10, { size: 6, fonte: forte });
    txt('I declare that all the information contained in this invoice to be true and correct.',
        L, yDeclaracaoBase - 11, { size: 6, fonte: forte });
    txt('Originator or Name of Company Representative if the invoice is being completed on behalf of a company or individual:',
        L, yDeclaroBase - 9, { size: 6, fonte: forte });
    txt(exportador.nome, L, yDeclaroBase - 19, { size: 6.5, max: XR - L - 6 });

    txt('Signature / Title / Date:', L, BASE + 8, { size: 6, fonte: forte });
    txtDir(dataFormulario(cotacao?.created_at), X1 - 5, BASE + 18, { size: 6.5 });
    txtDir('REV. 08-23-22', X1, BASE - 9, { size: 6, fonte: forte });

    const bytes = await doc.save();
    return Buffer.from(bytes).toString('base64');
}

module.exports = { gerarInvoiceComercial };
