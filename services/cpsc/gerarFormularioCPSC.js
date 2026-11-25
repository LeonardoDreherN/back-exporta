/*
 * Formulario CPSC "Goods Not Registered" da FedEx, pre-preenchido com os
 * dados da cotacao.
 *
 * O despachante passou a pedir o papel no desembaraco; o primeiro caso foi a
 * conta Tex Brands, em outubro de 2026. Apesar do titulo, nao e certificado
 * de conformidade: e o formulario que DISCLAMA, ou seja, declara que a
 * mercadoria nao tem registro na CPSC e que o dado nao e exigido.
 *
 * Nao desenhamos o formulario: preenchemos o PDF oficial da FedEx, que esta
 * em CPSC_NOT_REGISTERED_FORM.pdf e ja vem com os 50 campos preenchiveis.
 * Redesenhar o papel criaria um sosia com a marca da FedEx no cabecalho e
 * sem a garantia de bater campo a campo com o que o despachante confere.
 *
 * O PAPEL SAI COM TODOS OS CAMPOS PREENCHIDOS.
 *
 * Nao e como comecou. A primeira versao seguia a instrucao do campo 2
 * ("Skip to part V, to complete the remainder of the form") e deixava as
 * Partes II, III e IV vazias, como na via que a Tex Brands tinha usado no
 * tracking 879071712961. A pratica desmentiu isso duas vezes: primeiro o
 * formulario voltou por falta da Parte III (fabricante), depois uma
 * mercadoria RETORNOU em novembro de 2026 porque o resto continuava em
 * branco. Na alfandega, campo vazio nao e lido como "nao se aplica": e lido
 * como formulario incompleto.
 *
 * Entao a regra passou a ser: nenhum campo de texto sai vazio. O que o
 * sistema sabe vai com o dado real; o que nao se aplica vai escrito "N/A",
 * que e declaracao de que foi considerado e nao se aplica. As unicas
 * excecoes estao anotadas uma a uma abaixo.
 *
 * O campo 11 (produto infantil) nao existe como campo preenchivel no PDF
 * oficial — as caixas estao desenhadas, mas sem widget. Por isso ele e
 * DESENHADO na pagina, com um X nas coordenadas da caixa, em vez de ficar
 * para a caneta: era mais um campo em branco.
 *
 * Um formulario por item: os campos de produto sao singulares, entao carga
 * com tres SKUs rende tres vias.
 */
const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts } = require('pdf-lib');

const TEMPLATE = path.join(__dirname, 'CPSC_NOT_REGISTERED_FORM.pdf');

/*
 * Nomes exatos dos campos no PDF da FedEx. Tres deles foram batizados pelo
 * texto vizinho quando o formulario foi montado e nao dizem o que sao, entao
 * ficam anotados aqui com o numero que tem no papel:
 *
 *  - 'undefined' e a caixa "Noncommercial transaction" (a terceira do campo 2)
 *  - 'If yes complete lines...' e a SEGUNDA linha do campo 10
 *  - 'Part III  Manufacturer information required' e o campo 20
 *  - 'Text1' e a assinatura, campo 41
 *
 * Conferidos pela posicao de cada widget na pagina, nao pelo nome.
 */
const CAMPO = {
    // Parte I - Disclaim
    tracking: 'Tracking number',
    data: 'date',
    optionA: 'Option A  product is not regulated by this agency',
    optionB: 'Option B  Data is not required',
    naoComercial: 'undefined',
    intendedUseCode: 'Intended use code',
    descricao: 'Description',

    // Parte II - Product & Certification
    certificacaoExiste: 'Part II  Product  Certification Information required', // radio Yes/No, campo 3
    certCPC: 'CPC  Childrens Product Cert',
    certGCC: 'GCC  General Cert of Conformity',
    produtoId: '5 Product IDSKUproduct codemodel numberserial numberregistered number',
    produtoNome: '6 Product name',
    entidadeNome: '7 Cert Entity co name',
    entidadeEndereco: '8 Cert Entity address',
    entidadeContato: '9 Cert Entity point of contact name',
    entidadeEmail: '10 Certifying Entity point of contact email address',
    entidadeEmail2: 'If yes complete lines 1215 If not complete lines 1619 One of the sections must be completed In addition complete line 20 regardless of if',
    itlId: '12 ITL ID',
    itlNome: '13 ITL name',
    itlParte: '14 ITL party name',
    itlEndereco1: '15 ITL party address 1',
    itlEndereco2: '15 ITL party address 2',
    labDataTeste: '16 Indicate the date of previous lab testing',
    labSemTeste: 'or no lab testing completed',
    labNome: '17 Lab name',
    labParte: '18 Lab party name',
    labEndereco: '19 Lab party address',
    regraOuExclusao: 'Part III  Manufacturer information required', // campo 20

    // Parte III - Manufacturer
    fabricanteNome: '21 Manufacturer name',
    fabricanteData: '22 Manufacturer date',
    fabricanteEndereco: '23 Manufacturer address',
    fabricanteTelefone: '24 Manufacturer phone',
    fabricanteEmail: 'Email address',

    // Parte IV - Additional details (opcional no papel, preenchida mesmo assim)
    marca: '25 Brand name',
    cor: '26 Model color',
    modeloDescricao: '27 Model description',
    modeloEstilo: '28 Model style',
    lote: '29 Lot numbers',
    registryId: '30 Registry ID',
    labReportId: '31 Lab report ID',
    labReportUrl: '32 Lab report url',
    chaveRelatorio: '33 Access key to lab test report',
    smallBatchId: '34 Small batch id',

    // Parte V - Submitter
    submitterEmpresa: '35 Submitter company name',
    submitterTitulo: '36 Submitter title',
    submitterNome: '37 Submitter name',
    submitterTelefone: '38 Submitter phone number',
    submitterEmail: '39 Submitter email address',
    submitterData: '40 Date',
    submitterAssinatura: 'Text1', // campo 41
};

/*
 * Campos que NAO levam "N/A" quando vazios.
 *
 * Os dois sao segunda linha de um campo que cabe numa linha: a continuacao
 * do e-mail do campo 10 e a do endereco do campo 15. A primeira linha sempre
 * sai preenchida, entao escrever "N/A" embaixo do e-mail nao declara nada —
 * faz o e-mail parecer "N/A".
 */
const CONTINUACOES = new Set([
    'If yes complete lines 1215 If not complete lines 1619 One of the sections must be completed In addition complete line 20 regardless of if',
    '15 ITL party address 2',
]);

const NAO_SE_APLICA = 'N/A';

/*
 * Campo 11 ("Is this a children's product? [ ] yes [ ] no"), que nao tem
 * widget no PDF oficial.
 *
 * As coordenadas sao a posicao dos proprios glifos no conteudo da pagina,
 * lidas do PDF: as caixas nascem em x=177.5 (yes) e x=225.7 (no), na linha de
 * base y=495.6, do mesmo tamanho das caixas que TEM widget (~9pt). Pagina
 * unica de 612x792.
 */
const CAIXA_INFANTIL = {
    sim: { x: 177.5, y: 495.6 },
    nao: { x: 225.7, y: 495.6 },
};

/*
 * Lacuna sem rotulo que sobra a direita da assinatura, depois do widget do
 * campo 41 (que termina em x=427). No formulario e onde vai a data de quem
 * assina, e tambem nao tem widget.
 */
const DATA_ASSINATURA = { x: 437, y: 36.5 };

const texto = (v) => String(v ?? '').trim();

const PAISES = { BR: 'BRAZIL', US: 'UNITED STATES OF AMERICA' };
const nomePais = (codigo) => {
    const c = texto(codigo).toUpperCase();
    return PAISES[c] || c;
};

/*
 * "10/27/2026".
 *
 * Formato americano porque e assim que o formulario aceito saiu e porque o
 * papel e lido na entrada nos EUA, onde 10/27 nao tem outra leitura. A
 * invoice usa mes por extenso; aqui vale a consistencia com o que o
 * despachante ja recebeu.
 */
function dataFormulario(valor) {
    const d = valor ? new Date(valor) : new Date();
    if (Number.isNaN(d.getTime())) return '';
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${mm}/${dd}/${d.getFullYear()}`;
}

/*
 * Mesma regra da invoice: `descricao` e o texto pensado para a alfandega,
 * `titulo` e o nome do anuncio e pode nem estar em ingles.
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

function skuItem(item) {
    return texto(item?.sku) || texto(item?.SKU) || texto(item?.codigo) || texto(item?.id);
}

function marcaItem(item) {
    return texto(item?.marca) || texto(item?.brand) || texto(item?.vendor);
}

function corItem(item) {
    return texto(item?.cor) || texto(item?.color);
}

/*
 * Escreve num campo de texto ajustando a fonte ao espaco que ele tem.
 *
 * Os campos do formulario sao estreitos — "22 Manufacturer date" tem 80pt — e
 * texto maior que a caixa some na renderizacao em vez de vazar. Entao a
 * fonte encolhe ate 6.5 e, se ainda nao couber, o texto e cortado: campo com
 * meia razao social e pior que campo vazio, mas e melhor que campo que
 * aparenta estar vazio por acidente.
 */
function preencherTexto(form, fonte, nome, valor) {
    const v = texto(valor);
    if (!v) return;

    let campo;
    try {
        campo = form.getTextField(nome);
    } catch (err) {
        // Campo ausente: o template mudou de versao. Nao derruba a emissao
        // inteira por causa de um campo.
        console.warn('[CPSC] campo não encontrado no template:', nome);
        return;
    }

    const larg = campo.acroField.getWidgets()[0]?.getRectangle()?.width ?? 200;
    const util = Math.max(20, larg - 4);

    let size = 9;
    while (size > 6.5 && fonte.widthOfTextAtSize(v, size) > util) size -= 0.5;

    let s = v;
    while (s.length > 1 && fonte.widthOfTextAtSize(s, size) > util) s = s.slice(0, -1);

    campo.setFontSize(size);
    campo.setText(s);
}

function marcarCaixa(form, nome) {
    try {
        form.getCheckBox(nome).check();
    } catch (err) {
        console.warn('[CPSC] caixa não encontrada no template:', nome);
    }
}

/*
 * Marca com X uma caixa que esta desenhada no papel mas nao tem widget.
 *
 * E o caso do campo 11. O X e conteudo da pagina, nao campo de formulario,
 * entao sobrevive ao flatten das vias multiplas e ninguem desmarca sem dar
 * por isso.
 */
function marcarCaixaDesenhada(pagina, fonteBold, caixa) {
    pagina.drawText('X', {
        x: caixa.x + 1.4,
        y: caixa.y + 1.4,
        size: 7.5,
        font: fonteBold,
    });
}

/*
 * Preenche uma via do formulario e devolve o PDFDocument.
 */
async function preencherUmaVia(bytesTemplate, dados) {
    const doc = await PDFDocument.load(bytesTemplate);
    const form = doc.getForm();
    const fonte = await doc.embedFont(StandardFonts.Helvetica);
    const fonteBold = await doc.embedFont(StandardFonts.HelveticaBold);
    const pagina = doc.getPages()[0];

    /*
     * Todo campo de texto do papel, na ordem do papel.
     *
     * A lista e a garantia de que nada sai vazio: e ela que cobre os 50
     * campos, e qualquer valor que chegue vazio vira "N/A" logo abaixo.
     * Campo novo, em versao nova do template, entra aqui — e nao espalhado
     * pelo codigo, onde some.
     */
    const valores = {
        // ---- Parte I - Disclaim ----
        [CAMPO.tracking]: dados.trackingNumber,
        [CAMPO.data]: dados.data,
        [CAMPO.intendedUseCode]: dados.intendedUseCode,
        // A via aceita trouxe a descricao do produto aqui, nao no campo 6.
        [CAMPO.descricao]: dados.intendedUseDescricao || dados.produtoNome,

        // ---- Parte II - Product & Certification ----
        [CAMPO.produtoId]: dados.produtoId,
        [CAMPO.produtoNome]: dados.produtoNome,
        [CAMPO.entidadeNome]: dados.entidadeNome,
        [CAMPO.entidadeEndereco]: dados.entidadeEndereco,
        [CAMPO.entidadeContato]: dados.entidadeContato,
        [CAMPO.entidadeEmail]: dados.entidadeEmail,
        [CAMPO.entidadeEmail2]: dados.entidadeEmail2,
        [CAMPO.itlId]: dados.itlId,
        [CAMPO.itlNome]: dados.itlNome,
        [CAMPO.itlParte]: dados.itlParte,
        [CAMPO.itlEndereco1]: dados.itlEndereco,
        [CAMPO.itlEndereco2]: dados.itlEndereco2,
        [CAMPO.labDataTeste]: dados.labDataTeste,
        [CAMPO.labSemTeste]: dados.labSemTeste,
        [CAMPO.labNome]: dados.labNome,
        [CAMPO.labParte]: dados.labParte,
        [CAMPO.labEndereco]: dados.labEndereco,
        [CAMPO.regraOuExclusao]: dados.regraOuExclusao,

        // ---- Parte III - Manufacturer ----
        [CAMPO.fabricanteNome]: dados.fabricanteNome,
        [CAMPO.fabricanteData]: dados.fabricanteData,
        [CAMPO.fabricanteEndereco]: dados.fabricanteEndereco,
        [CAMPO.fabricanteTelefone]: dados.fabricanteTelefone,
        [CAMPO.fabricanteEmail]: dados.fabricanteEmail,

        // ---- Parte IV - Additional details ----
        [CAMPO.marca]: dados.marca,
        [CAMPO.cor]: dados.cor,
        [CAMPO.modeloDescricao]: dados.modeloDescricao || dados.produtoNome,
        [CAMPO.modeloEstilo]: dados.modeloEstilo,
        [CAMPO.lote]: dados.lote,
        [CAMPO.registryId]: dados.registryId,
        [CAMPO.labReportId]: dados.labReportId,
        [CAMPO.labReportUrl]: dados.labReportUrl,
        [CAMPO.chaveRelatorio]: dados.chaveRelatorio,
        [CAMPO.smallBatchId]: dados.smallBatchId,

        // ---- Parte V - Submitter ----
        [CAMPO.submitterEmpresa]: dados.submitterEmpresa,
        [CAMPO.submitterTitulo]: dados.submitterTitulo,
        [CAMPO.submitterNome]: dados.submitterNome,
        [CAMPO.submitterTelefone]: dados.submitterTelefone,
        [CAMPO.submitterEmail]: dados.submitterEmail,
        [CAMPO.submitterData]: dados.data,
        [CAMPO.submitterAssinatura]: dados.submitterAssinatura,
    };

    for (const [nome, valor] of Object.entries(valores)) {
        const v = texto(valor) || (CONTINUACOES.has(nome) ? '' : NAO_SE_APLICA);
        preencherTexto(form, fonte, nome, v);
    }

    // ---------------- Caixas de selecao ----------------

    // Campo 2: o disclaim.
    if (dados.disclaimer === 'A') marcarCaixa(form, CAMPO.optionA);
    if (dados.disclaimer === 'B') marcarCaixa(form, CAMPO.optionB);
    if (dados.disclaimer === 'NAO_COMERCIAL') marcarCaixa(form, CAMPO.naoComercial);

    /*
     * Campo 3: "Certification exists?".
     *
     * Sai sempre marcado, e nao mais so quando nao havia disclaim. Mercadoria
     * sem registro na CPSC nao tem certificado, entao o padrao e "No" — e
     * "No" marcado e uma resposta, enquanto radio sem marcacao e o campo em
     * branco que fez a carga voltar.
     */
    try {
        form.getRadioGroup(CAMPO.certificacaoExiste)
            .select(dados.certificacaoExiste ? 'Yes' : 'No');
    } catch (err) {
        console.warn('[CPSC] radio "Certification exists?" não encontrado');
    }

    /*
     * Campo 4: qual certificado, CPC ou GCC.
     *
     * Fica sem marcar quando nao existe certificado (campo 3 = No): marcar
     * CPC ou GCC declararia um certificado que a mercadoria nao tem, e caixa
     * marcada a mais e pior que caixa vazia — aqui o papel ja respondeu "No"
     * na linha de cima.
     */
    if (dados.tipoCertificado === 'CPC') marcarCaixa(form, CAMPO.certCPC);
    if (dados.tipoCertificado === 'GCC') marcarCaixa(form, CAMPO.certGCC);

    /*
     * Campo 11: produto infantil. Desenhado, porque nao tem widget. Padrao
     * "no", que e o que vale para a mercadoria que a Intrex despacha;
     * `opcoes.produtoInfantil` troca para "yes" quando for produto infantil
     * de verdade, e e isso que torna obrigatorio o bloco de laboratorio
     * (campos 12 a 15), que ninguem tem como adivinhar aqui.
     */
    marcarCaixaDesenhada(
        pagina,
        fonteBold,
        dados.produtoInfantil ? CAIXA_INFANTIL.sim : CAIXA_INFANTIL.nao
    );

    // Lacuna sem rotulo ao lado da assinatura: a data.
    const dataAssinatura = texto(dados.data);
    if (dataAssinatura) {
        pagina.drawText(dataAssinatura, {
            x: DATA_ASSINATURA.x,
            y: DATA_ASSINATURA.y,
            size: 9,
            font: fonte,
        });
    }

    form.updateFieldAppearances(fonte);
    return doc;
}

/*
 * `opcoes` carrega o que a cotacao nao sabe: o codigo de disclaim, o intended
 * use code e os dados de laboratorio. Vem do endpoint, porque sao declaracoes
 * de quem assina e nao dados derivaveis do pedido.
 *
 * Todo default aqui e sobrescrivel: quando o fabricante e outro (industria
 * terceirizada), quando existe certificado e laboratorio, ou quando o produto
 * e infantil, quem emite manda o valor e ele entra no lugar do padrao.
 */
async function gerarFormularioCPSC({ cotacao, cliente, opcoes = {} }) {
    const pedido = cotacao?.pedido || {};
    const itens = Array.isArray(pedido.itens) ? pedido.itens : [];
    const bytesTemplate = fs.readFileSync(TEMPLATE);

    const enderecoCliente = [
        [texto(cliente?.enderecoRua), texto(cliente?.enderecoNumero)].filter(Boolean).join(', '),
        texto(cliente?.enderecoComplemento),
        texto(cliente?.enderecoCidade),
        texto(cliente?.enderecoEstado),
        texto(cliente?.enderecoCEP),
        nomePais(cliente?.enderecoPais),
    ].filter(Boolean).join(', ');

    const razao = texto(cliente?.razaoSocial);
    const telefone = texto(cliente?.telefoneCelular);
    const email = texto(cliente?.emailPrincipal);
    const data = dataFormulario(cotacao?.created_at);

    // Disclaim B por padrao: e o que a Tex Brands declarou e o que vale para
    // mercadoria sem registro na CPSC. `null` desliga o disclaim.
    const disclaimer = opcoes.disclaimer === undefined ? 'B' : opcoes.disclaimer;
    const produtoInfantil = opcoes.produtoInfantil === true;
    const certificacaoExiste = opcoes.certificacaoExiste === true;

    /*
     * Campo 20, "CPS rule citation or exclusion".
     *
     * Sem certificado nao ha regra a citar, mas o papel pede o campo
     * "regardless". Entao sai o motivo escrito, que e o mesmo que o disclaim
     * declara em cima — "N/A" sozinho nao diz por que.
     */
    const regraPadrao = disclaimer === 'A'
        ? 'N/A - PRODUCT NOT REGULATED BY CPSC'
        : (disclaimer === 'B' ? 'N/A - DATA NOT REQUIRED' : NAO_SE_APLICA);

    /*
     * Campo 16: data de teste anterior, ou a declaracao de que nao houve
     * teste. Sem data informada, "NONE" na lacuna do "no lab testing
     * completed" — ela tem 40pt, nao cabe frase.
     */
    const labDataTeste = texto(opcoes.labDataTeste);
    const labSemTeste = texto(opcoes.labSemTeste) || (labDataTeste ? NAO_SE_APLICA : 'NONE');

    const submitterNome = texto(opcoes.submitterNome) || razao;

    const comuns = {
        trackingNumber: texto(cotacao?.tracking_number),
        data,

        disclaimer,
        // "N/A" foi o que saiu na via aceita.
        intendedUseCode: opcoes.intendedUseCode === undefined
            ? NAO_SE_APLICA
            : texto(opcoes.intendedUseCode),
        intendedUseDescricao: texto(opcoes.intendedUseDescricao),

        produtoInfantil,
        certificacaoExiste,
        tipoCertificado: opcoes.tipoCertificado || null,

        entidadeNome: texto(opcoes.entidadeNome) || razao,
        entidadeEndereco: texto(opcoes.entidadeEndereco) || enderecoCliente,
        entidadeContato: texto(opcoes.entidadeContato) || razao,
        entidadeEmail: texto(opcoes.entidadeEmail) || email,
        entidadeEmail2: texto(opcoes.entidadeEmail2),

        itlId: texto(opcoes.itlId),
        itlNome: texto(opcoes.itlNome),
        itlParte: texto(opcoes.itlParte),
        itlEndereco: texto(opcoes.itlEndereco),
        itlEndereco2: texto(opcoes.itlEndereco2),
        labDataTeste,
        labSemTeste,
        labNome: texto(opcoes.labNome),
        labParte: texto(opcoes.labParte),
        labEndereco: texto(opcoes.labEndereco),
        regraOuExclusao: texto(opcoes.regraOuExclusao) || regraPadrao,

        /*
         * Parte III, fabricante. O cliente que emite e o fabricante da
         * mercadoria, e razao social, endereco, telefone e e-mail ja estao no
         * cadastro.
         *
         * Fica de fora so o campo 22 (data de fabricacao), que o sistema nao
         * tem de onde tirar: sai "N/A" pelo default geral, em vez de inventar
         * a data da cotacao.
         */
        fabricanteNome: texto(opcoes.fabricanteNome) || razao,
        fabricanteData: texto(opcoes.fabricanteData),
        fabricanteEndereco: texto(opcoes.fabricanteEndereco) || enderecoCliente,
        fabricanteTelefone: texto(opcoes.fabricanteTelefone) || telefone,
        fabricanteEmail: texto(opcoes.fabricanteEmail) || email,

        modeloDescricao: texto(opcoes.modeloDescricao),
        modeloEstilo: texto(opcoes.modeloEstilo),
        lote: texto(opcoes.lote),
        registryId: texto(opcoes.registryId),
        labReportId: texto(opcoes.labReportId),
        labReportUrl: texto(opcoes.labReportUrl),
        chaveRelatorio: texto(opcoes.chaveRelatorio),
        smallBatchId: texto(opcoes.smallBatchId),

        submitterEmpresa: texto(opcoes.submitterEmpresa) || razao,
        submitterTitulo: texto(opcoes.submitterTitulo) || 'Legal Representative',
        submitterNome,
        submitterTelefone: texto(opcoes.submitterTelefone) || telefone,
        submitterEmail: texto(opcoes.submitterEmail) || email,
        /*
         * Campo 41. Saia em branco porque assinatura e ato de quem assina — e
         * era mais uma linha vazia no papel que voltou. Agora sai o nome
         * datilografado de quem submete, que e o que o formulario eletronico
         * da CPSC aceita como assinatura; quem preferir rubricar a caneta
         * manda `submitterAssinatura: ' '` e assina a via impressa.
         */
        submitterAssinatura: opcoes.submitterAssinatura === undefined
            ? submitterNome
            : texto(opcoes.submitterAssinatura),
    };

    // Pedido sem itens ainda rende uma via: tracking e submitter saem
    // preenchidos e os campos de produto saem "N/A".
    const lista = itens.length ? itens : [null];

    const vias = [];
    for (let i = 0; i < lista.length; i += 1) {
        const item = lista[i];
        vias.push(await preencherUmaVia(bytesTemplate, {
            ...comuns,
            produtoId: item ? skuItem(item) : '',
            produtoNome: item ? descricaoItem(item, i) : '',
            marca: item ? marcaItem(item) : '',
            cor: item ? corItem(item) : '',
        }));
    }

    /*
     * Uma via so sai editavel: os campos continuam preenchiveis e quem assina
     * corrige no Acrobat o que precisar — a data de fabricacao, por exemplo,
     * que sai "N/A".
     *
     * Varias vias precisam ser achatadas antes de juntar, senao os 50 campos
     * repetem o mesmo nome em todas as paginas e o leitor passa a tratar
     * como um campo so: digitar o tracking na via 2 reescreveria a via 1.
     */
    if (vias.length === 1) {
        const bytes = await vias[0].save();
        return Buffer.from(bytes).toString('base64');
    }

    const final = await PDFDocument.create();
    for (const via of vias) {
        via.getForm().flatten();
        const [pagina] = await final.copyPages(via, [0]);
        final.addPage(pagina);
    }

    const bytes = await final.save();
    return Buffer.from(bytes).toString('base64');
}

module.exports = { gerarFormularioCPSC };
