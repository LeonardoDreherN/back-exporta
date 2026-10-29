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
 * O preenchimento segue o formulario que a Tex Brands enviou e que passou no
 * desembaraco (tracking 879071712961): Parte I com o disclaim e Parte V com
 * o submitter. As Partes II, III e IV ficam vazias de proposito — a propria
 * instrucao do campo 2 manda "Skip to part V, to complete the remainder of
 * the form" quando se disclama. So quando NAO ha disclaim (`disclaimer:
 * null`) e que as partes de certificacao e fabricante entram.
 *
 * O campo 11 (produto infantil) nao existe como campo preenchivel no PDF
 * oficial — as caixas estao desenhadas, mas sem widget. Fica para a caneta,
 * que e como o formulario aceito tambem saiu.
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

    // Parte IV - Additional details (opcional)
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
 * Preenche uma via do formulario e devolve o PDFDocument.
 */
async function preencherUmaVia(bytesTemplate, dados) {
    const doc = await PDFDocument.load(bytesTemplate);
    const form = doc.getForm();
    const fonte = await doc.embedFont(StandardFonts.Helvetica);

    const T = (nome, valor) => preencherTexto(form, fonte, nome, valor);

    // ---------------- Parte I - Disclaim ----------------

    T(CAMPO.tracking, dados.trackingNumber);
    T(CAMPO.data, dados.data);

    if (dados.disclaimer === 'A') marcarCaixa(form, CAMPO.optionA);
    if (dados.disclaimer === 'B') marcarCaixa(form, CAMPO.optionB);
    if (dados.disclaimer === 'NAO_COMERCIAL') marcarCaixa(form, CAMPO.naoComercial);

    T(CAMPO.intendedUseCode, dados.intendedUseCode);
    // A via aceita trouxe a descricao do produto aqui, nao no campo 6: com
    // disclaim a Parte II nao e preenchida, entao e o unico lugar do papel
    // onde a mercadoria aparece.
    T(CAMPO.descricao, dados.intendedUseDescricao || dados.produtoNome);

    // ---------------- Partes II a IV ----------------

    /*
     * So entram quando nao ha disclaim. O campo 2 manda pular para a Parte V
     * ao disclamar, e a via que passou no desembaraco saiu assim: preencher
     * a Parte II por cima do disclaim diz duas coisas diferentes no mesmo
     * papel.
     */
    if (!dados.disclaimer) {
        if (dados.certificacaoExiste !== undefined) {
            try {
                form.getRadioGroup(CAMPO.certificacaoExiste)
                    .select(dados.certificacaoExiste ? 'Yes' : 'No');
            } catch (err) {
                console.warn('[CPSC] radio "Certification exists?" não encontrado');
            }
        }
        if (dados.tipoCertificado === 'CPC') marcarCaixa(form, CAMPO.certCPC);
        if (dados.tipoCertificado === 'GCC') marcarCaixa(form, CAMPO.certGCC);

        T(CAMPO.produtoId, dados.produtoId);
        T(CAMPO.produtoNome, dados.produtoNome);
        T(CAMPO.entidadeNome, dados.entidadeNome);
        T(CAMPO.entidadeEndereco, dados.entidadeEndereco);
        T(CAMPO.entidadeContato, dados.entidadeContato);
        T(CAMPO.entidadeEmail, dados.entidadeEmail);

        T(CAMPO.itlId, dados.itlId);
        T(CAMPO.itlNome, dados.itlNome);
        T(CAMPO.itlParte, dados.itlParte);
        T(CAMPO.itlEndereco1, dados.itlEndereco);
        T(CAMPO.labDataTeste, dados.labDataTeste);
        T(CAMPO.labSemTeste, dados.labSemTeste);
        T(CAMPO.labNome, dados.labNome);
        T(CAMPO.labParte, dados.labParte);
        T(CAMPO.labEndereco, dados.labEndereco);
        T(CAMPO.regraOuExclusao, dados.regraOuExclusao);

        T(CAMPO.fabricanteNome, dados.fabricanteNome);
        T(CAMPO.fabricanteData, dados.fabricanteData);
        T(CAMPO.fabricanteEndereco, dados.fabricanteEndereco);
        T(CAMPO.fabricanteTelefone, dados.fabricanteTelefone);
        T(CAMPO.fabricanteEmail, dados.fabricanteEmail);

        T(CAMPO.marca, dados.marca);
        T(CAMPO.modeloDescricao, dados.modeloDescricao);
        T(CAMPO.modeloEstilo, dados.modeloEstilo);
        T(CAMPO.lote, dados.lote);
        T(CAMPO.registryId, dados.registryId);
        T(CAMPO.labReportId, dados.labReportId);
        T(CAMPO.labReportUrl, dados.labReportUrl);
        T(CAMPO.chaveRelatorio, dados.chaveRelatorio);
        T(CAMPO.smallBatchId, dados.smallBatchId);
    }

    // ---------------- Parte V - Submitter ----------------

    T(CAMPO.submitterEmpresa, dados.submitterEmpresa);
    T(CAMPO.submitterTitulo, dados.submitterTitulo);
    T(CAMPO.submitterNome, dados.submitterNome);
    T(CAMPO.submitterTelefone, dados.submitterTelefone);
    T(CAMPO.submitterEmail, dados.submitterEmail);
    T(CAMPO.submitterData, dados.data);
    // Campo 41 so sai preenchido se mandarem: assinatura e ato de quem
    // assina, nao default do sistema.
    T(CAMPO.submitterAssinatura, dados.submitterAssinatura);

    form.updateFieldAppearances(fonte);
    return doc;
}

/*
 * `opcoes` carrega o que a cotacao nao sabe: o codigo de disclaim, o intended
 * use code e os dados de laboratorio. Vem do endpoint, porque sao declaracoes
 * de quem assina e nao dados derivaveis do pedido.
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

    const comuns = {
        trackingNumber: texto(cotacao?.tracking_number),
        data,

        // Disclaim B por padrao: e o que a Tex Brands declarou e o que vale
        // para mercadoria sem registro na CPSC. `null` desliga o disclaim e
        // abre as Partes II a IV.
        disclaimer: opcoes.disclaimer === undefined ? 'B' : opcoes.disclaimer,
        // "N/A" foi o que saiu na via aceita.
        intendedUseCode: opcoes.intendedUseCode === undefined ? 'N/A' : texto(opcoes.intendedUseCode),
        intendedUseDescricao: texto(opcoes.intendedUseDescricao),

        certificacaoExiste: opcoes.certificacaoExiste,
        tipoCertificado: opcoes.tipoCertificado || null,

        entidadeNome: texto(opcoes.entidadeNome) || razao,
        entidadeEndereco: texto(opcoes.entidadeEndereco) || enderecoCliente,
        entidadeContato: texto(opcoes.entidadeContato) || razao,
        entidadeEmail: texto(opcoes.entidadeEmail) || email,

        itlId: texto(opcoes.itlId),
        itlNome: texto(opcoes.itlNome),
        itlParte: texto(opcoes.itlParte),
        itlEndereco: texto(opcoes.itlEndereco),
        labDataTeste: texto(opcoes.labDataTeste),
        labSemTeste: texto(opcoes.labSemTeste),
        labNome: texto(opcoes.labNome),
        labParte: texto(opcoes.labParte),
        labEndereco: texto(opcoes.labEndereco),
        regraOuExclusao: texto(opcoes.regraOuExclusao),

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
        submitterNome: texto(opcoes.submitterNome) || razao,
        submitterTelefone: texto(opcoes.submitterTelefone) || telefone,
        submitterEmail: texto(opcoes.submitterEmail) || email,
        submitterAssinatura: texto(opcoes.submitterAssinatura),
    };

    // Pedido sem itens ainda rende uma via: tracking e submitter saem
    // preenchidos e o produto fica para a caneta.
    const lista = itens.length ? itens : [null];

    const vias = [];
    for (let i = 0; i < lista.length; i += 1) {
        const item = lista[i];
        vias.push(await preencherUmaVia(bytesTemplate, {
            ...comuns,
            produtoId: item ? skuItem(item) : '',
            produtoNome: item ? descricaoItem(item, i) : '',
            marca: item ? marcaItem(item) : '',
        }));
    }

    /*
     * Uma via so sai editavel: os campos continuam preenchiveis e quem
     * assina completa no Acrobat o que o papel pede e nos nao temos — o
     * campo 11, por exemplo, que nem widget tem.
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
