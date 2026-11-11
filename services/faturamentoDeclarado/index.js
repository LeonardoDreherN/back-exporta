// services/faturamentoDeclarado/index.js
//
// Base de calculo do imposto quando o cliente opera por triangulacao.
//
// O problema: o imposto de importacao incide sobre o valor DECLARADO na
// invoice, nao sobre o preco de vitrine. Quem vende via IOR fatura ao custo —
// uma bolsa de USD 145 sai na invoice a USD 40 — e e sobre os 40 que a
// alfandega cobra. Calcular o imposto do checkout sobre os 145 mostraria ao
// comprador um numero que ninguem vai pagar.
//
// O que este modulo faz: converte a lista de itens do checkout na base
// aduaneira real do cliente, e reparte o imposto resultante entre a parte que
// APARECE no checkout e a parte EMBUTIDA no preco.
//
// O que ele nao faz: decidir o valor. O valor vem do cadastro, e precisa
// corresponder a uma venda real ao IOR — e o preco da transacao que a invoice
// declara, nao um parametro de ajuste.

/** SKU da plataforma -> chave de busca. A mesma loja escreve de varios jeitos. */
const normSku = (sku) => String(sku || '').trim().toUpperCase();

/**
 * Converte os itens do checkout na base declarada.
 *
 * Cada item cai num de dois casos:
 *   - SKU cadastrado  -> usa o valor faturado da tabela (x quantidade)
 *   - SKU sem cadastro -> cai no fator padrao do cliente sobre o preco de
 *     venda; sem fator, usa o proprio preco de venda. Nunca inventa desconto:
 *     declarar a menos por falta de cadastro seria subdeclarar por acidente.
 *
 * @param {object[]} itens  [{ sku, precoUnitarioUsd, quantidade }]
 * @param {Map<string, number>} tabela  SKU normalizado -> valor faturado unitario USD
 * @param {number|null} fatorPadrao  fracao (0-1) aplicada ao preco quando falta SKU
 * @returns {{ baseUsd:number, vendaUsd:number, linhas:object[], semCadastro:string[] }}
 */
function baseDeclarada({ itens = [], tabela = new Map(), fatorPadrao = null }) {
    const linhas = [];
    const semCadastro = [];
    let baseUsd = 0;
    let vendaUsd = 0;

    for (const item of itens) {
        const qtd = Math.max(1, Number(item?.quantidade) || 1);
        const precoUnit = Math.max(0, Number(item?.precoUnitarioUsd) || 0);
        const sku = normSku(item?.sku);

        const cadastrado = sku ? tabela.get(sku) : undefined;

        let unitDeclarado;
        let origem;

        if (Number.isFinite(cadastrado) && cadastrado >= 0) {
            unitDeclarado = Number(cadastrado);
            origem = 'sku';
        } else if (Number.isFinite(fatorPadrao) && fatorPadrao > 0 && fatorPadrao <= 1) {
            unitDeclarado = precoUnit * fatorPadrao;
            origem = 'fator_padrao';
            if (sku) semCadastro.push(sku);
        } else {
            // Sem cadastro e sem fator: declara o preco de venda. E o unico
            // valor que o sistema sabe ser verdadeiro.
            unitDeclarado = precoUnit;
            origem = 'preco_venda';
            if (sku) semCadastro.push(sku);
        }

        const linhaDeclarada = unitDeclarado * qtd;
        const linhaVenda = precoUnit * qtd;

        baseUsd += linhaDeclarada;
        vendaUsd += linhaVenda;

        linhas.push({
            sku: sku || null,
            quantidade: qtd,
            precoUnitarioUsd: Number(precoUnit.toFixed(2)),
            declaradoUnitarioUsd: Number(unitDeclarado.toFixed(2)),
            declaradoLinhaUsd: Number(linhaDeclarada.toFixed(2)),
            origem,
        });
    }

    return {
        baseUsd: Number(baseUsd.toFixed(2)),
        vendaUsd: Number(vendaUsd.toFixed(2)),
        linhas,
        semCadastro,
    };
}

/**
 * Reparte o imposto entre o que aparece no checkout e o que vai embutido.
 *
 * pctVisivel = 50  -> metade na linha de imposto, metade no preco do produto
 * pctVisivel = 0   -> nada aparece; o imposto inteiro vai embutido
 * pctVisivel = 100 -> o imposto inteiro aparece
 *
 * As duas partes SEMPRE somam o imposto cheio: o comprador paga o total de
 * qualquer jeito, muda so onde ele enxerga. Quem muda esse numero esta
 * escolhendo apresentacao, nao valor — se a soma nao fechasse, o lojista
 * estaria absorvendo a diferenca sem saber.
 *
 * @param {number} impostoUsd  imposto total calculado sobre a base declarada
 * @param {number} pctVisivel  0 a 100
 */
function repartirImposto(impostoUsd, pctVisivel) {
    const total = Math.max(0, Number(impostoUsd) || 0);

    let pct = Number(pctVisivel);
    if (!Number.isFinite(pct)) pct = 50;
    pct = Math.min(100, Math.max(0, pct));

    const visivel = Number((total * (pct / 100)).toFixed(2));
    // O embutido e o resto, nao um segundo arredondamento: assim os dois
    // somam o total exato, sem sobrar ou faltar centavo.
    const embutido = Number((total - visivel).toFixed(2));

    return { totalUsd: total, visivelUsd: visivel, embutidoUsd: embutido, pctVisivel: pct };
}

/**
 * Quanto somar no preco de um mercado para cobrir a parte EMBUTIDA do imposto.
 *
 * Este e o numero que o lojista digita em Settings > Markets > price
 * adjustments da Shopify. Ele e percentual porque e assim que a Shopify
 * aplica: uma fracao sobre o preco base, igual para todo o catalogo daquele
 * mercado.
 *
 * A conta, para a parte proporcional, se reduz a:
 *
 *     ajuste% = fator de faturamento x aliquota efetiva x (1 - % visivel)
 *
 * O fator entra porque o imposto incide sobre o valor DECLARADO, nao sobre a
 * vitrine. E por isso que o ajuste costuma ser muito menor do que a aliquota
 * do pais assusta: faturando a 28% com aliquota de 25% e metade visivel, o
 * ajuste e de 3,5%, nao de 12,5%.
 *
 * TAXAS FIXAS (MPF nos EUA e afins) nao cabem num percentual: elas nao
 * escalam com o preco, entao um percentual que as cubra num pedido pequeno
 * cobra demais num pedido grande. Elas voltam separadas, para ir na parte
 * visivel (somada ao frete), que e por pedido.
 *
 * @param {object} calculo  retorno de calcularPeloRegime(), sobre a base declarada
 * @param {number} baseDeclaradaUsd  valor declarado que gerou esse calculo
 * @param {number} vendaUsd  preco de vitrine correspondente
 * @param {number} pctVisivel  0 a 100
 * @returns {{ ajustePrecoPct:number, fixasPorPedidoUsd:number, embutidoUsd:number,
 *             visivelUsd:number, fatorFaturamento:number }|null}
 */
function ajusteDePreco({ calculo, baseDeclaradaUsd, vendaUsd, pctVisivel = 50 }) {
    if (!calculo) return null;

    const venda = Number(vendaUsd) || 0;
    const base = Number(baseDeclaradaUsd) || 0;
    if (venda <= 0) return null;

    const fixas = Math.max(0, Number(calculo.taxas_fixas_usd) || 0);
    // Parte que escala com o valor: o total menos o que e fixo.
    const proporcional = Math.max(0, (Number(calculo.total_usd) || 0) - fixas);

    const split = repartirImposto(proporcional, pctVisivel);

    // O ajuste e sobre o preco de vitrine, que e o que a Shopify multiplica.
    const ajustePct = (split.embutidoUsd / venda) * 100;

    // As taxas fixas vao inteiras para a parte visivel: nao da para diluir no
    // percentual sem errar em um dos extremos de valor.
    const visivelTotal = Number((split.visivelUsd + fixas).toFixed(2));

    return {
        ajustePrecoPct: Number(ajustePct.toFixed(2)),
        fixasPorPedidoUsd: Number(fixas.toFixed(2)),
        embutidoUsd: split.embutidoUsd,
        visivelUsd: visivelTotal,
        fatorFaturamento: Number((base / venda).toFixed(4)),
    };
}

module.exports = { baseDeclarada, repartirImposto, ajusteDePreco, normSku };
