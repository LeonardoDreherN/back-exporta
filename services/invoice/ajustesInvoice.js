/*
 * Ajustes da invoice: correcao que vale no papel e nao no pedido.
 *
 * Acontece de a invoice sair com valor errado — preco digitado errado no
 * cadastro, descricao que o despachante recusa, quantidade trocada — e o
 * documento precisar ser reemitido certo depois de a remessa ja existir.
 *
 * O preco do item NAO e editado em `pedido.itens` porque aquele campo nao
 * serve so a invoice: alimenta a estimativa de imposto (services/landedCost
 * monta o customsValue a partir dele), a cotacao da FedEx e da UPS, a previa
 * de importacao e o formulario CPSC. Reescrever o pedido mudaria a base de
 * calculo de uma remessa ja cobrada e apagaria o valor que foi declarado na
 * emissao — justamente o numero que a analise de acuracia do imposto compara
 * com o imposto real.
 *
 * Entao o pedido fica intacto e a correcao vive a parte, em
 * `cotacoes.invoice_ajustes`. A invoice e gerada a partir de pedido +
 * ajustes, e o que mudou continua legivel: `diferencas()` devolve de/para
 * campo a campo, que e o que vai para o log de auditoria.
 *
 * Os ajustes sao por indice do item, nao por SKU: o pedido de uma cotacao
 * emitida nao muda mais, e nem todo item tem SKU preenchido.
 */

// So estes campos podem ser corrigidos. Peso e pais de origem entram porque
// saem impressos na invoice; o resto do item nao aparece no papel.
const CAMPOS_AJUSTAVEIS = [
    'preco',
    'qty',
    'descricao',
    'hscode',
    'pesoUnit',
    'countryOfOrigin',
];

const NUMERICOS = ['preco', 'qty', 'pesoUnit'];

const texto = (v) => String(v ?? '').trim();

/*
 * Le o valor que o item tem hoje, aceitando os apelidos que as lojas mandam
 * — os mesmos que gerarInvoiceComercial consulta.
 */
function valorAtual(item, campo) {
    if (!item) return undefined;
    if (campo === 'preco') return item.preco ?? item.unitPrice ?? item.price;
    if (campo === 'qty') return item.qty ?? item.quantidade;
    if (campo === 'descricao') return item.descricao ?? item.description;
    if (campo === 'hscode') return item.hscode ?? item.hsCode;
    if (campo === 'pesoUnit') return item.pesoUnit ?? item.peso;
    return item[campo];
}

/*
 * Normaliza o que veio da tela: descarta campo desconhecido, numero
 * invalido e ajuste que nao aponta para item nenhum.
 *
 * Devolve `{ itens, erros }`. O endpoint recusa quando ha erro em vez de
 * emitir um documento aduaneiro com um numero que ninguem conferiu.
 */
function normalizarAjustes(pedido, ajustes) {
    const itensPedido = Array.isArray(pedido?.itens) ? pedido.itens : [];
    const entrada = Array.isArray(ajustes?.itens) ? ajustes.itens : [];
    const erros = [];
    const itens = [];

    entrada.forEach((bruto, i) => {
        const indice = Number(bruto?.indice);
        if (!Number.isInteger(indice) || indice < 0 || indice >= itensPedido.length) {
            erros.push(`Ajuste ${i + 1}: item ${bruto?.indice} não existe no pedido.`);
            return;
        }

        const limpo = { indice };

        CAMPOS_AJUSTAVEIS.forEach((campo) => {
            if (!(campo in (bruto || {}))) return;
            const valor = bruto[campo];

            // Campo enviado vazio quer dizer "nao mexer", e nao "zerar": o
            // formulario manda a linha inteira mesmo quando so um campo foi
            // tocado.
            if (valor === null || valor === undefined || texto(valor) === '') return;

            if (NUMERICOS.includes(campo)) {
                const n = Number(valor);
                if (!Number.isFinite(n) || n < 0) {
                    erros.push(`Ajuste ${i + 1}: ${campo} inválido (${valor}).`);
                    return;
                }
                if (campo === 'qty' && !Number.isInteger(n)) {
                    erros.push(`Ajuste ${i + 1}: quantidade precisa ser inteira (${valor}).`);
                    return;
                }
                limpo[campo] = n;
                return;
            }

            limpo[campo] = texto(valor);
        });

        // Linha que so traz o indice nao e ajuste.
        if (Object.keys(limpo).length > 1) itens.push(limpo);
    });

    return { itens, erros };
}

/*
 * Pedido com os ajustes aplicados, para alimentar o gerador da invoice.
 *
 * Copia antes de escrever: o objeto que entra aqui e o `pedido` da cotacao
 * carregada, e mutar significaria gravar a correcao no banco pelo caminho
 * errado na primeira vez que alguem desse save no registro.
 */
function aplicarAjustes(pedido, ajustes) {
    const itensPedido = Array.isArray(pedido?.itens) ? pedido.itens : [];
    const lista = Array.isArray(ajustes?.itens) ? ajustes.itens : [];
    if (!lista.length) return pedido;

    const porIndice = new Map(lista.map((a) => [Number(a.indice), a]));

    const itens = itensPedido.map((item, i) => {
        const ajuste = porIndice.get(i);
        if (!ajuste) return item;

        const novo = { ...item };

        CAMPOS_AJUSTAVEIS.forEach((campo) => {
            if (!(campo in ajuste)) return;
            novo[campo] = ajuste[campo];

            /*
             * Apaga os apelidos do campo corrigido. O gerador le
             * `preco || unitPrice || price` na ordem, entao deixar um
             * `unitPrice` antigo ao lado do `preco` novo nao quebra nada
             * hoje, mas um item cujo preco so existia como `price` voltaria
             * a valer se a ordem de leitura mudasse um dia.
             */
            if (campo === 'preco') { delete novo.unitPrice; delete novo.price; }
            if (campo === 'qty') { delete novo.quantidade; }
            if (campo === 'descricao') { delete novo.description; }
            if (campo === 'hscode') { delete novo.hsCode; }
            if (campo === 'pesoUnit') { delete novo.peso; }
        });

        return novo;
    });

    return { ...pedido, itens };
}

/*
 * De/para campo a campo, para o log de auditoria e para a tela confirmar o
 * que vai mudar antes de emitir.
 */
function diferencas(pedido, ajustes) {
    const itensPedido = Array.isArray(pedido?.itens) ? pedido.itens : [];
    const lista = Array.isArray(ajustes?.itens) ? ajustes.itens : [];
    const saida = [];

    lista.forEach((ajuste) => {
        const i = Number(ajuste.indice);
        const item = itensPedido[i];

        CAMPOS_AJUSTAVEIS.forEach((campo) => {
            if (!(campo in ajuste)) return;

            const de = valorAtual(item, campo);
            const para = ajuste[campo];

            // Comparacao frouxa de proposito: "10" vindo do formulario e 10
            // gravado no pedido sao o mesmo valor, e registrar isso como
            // mudanca enche o log de ruido.
            if (texto(de) === texto(para)) return;

            saida.push({
                indice: i,
                campo,
                de: de ?? null,
                para,
            });
        });
    });

    return saida;
}

module.exports = {
    CAMPOS_AJUSTAVEIS,
    normalizarAjustes,
    aplicarAjustes,
    diferencas,
};
