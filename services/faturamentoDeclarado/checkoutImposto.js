// services/faturamentoDeclarado/checkoutImposto.js
//
// O imposto que entra na linha de frete do checkout.
//
// Regras que mandam no desenho:
//
// 1. NUNCA derrubar o checkout. A Shopify corta o callback em ~10s e, sem
//    resposta, o comprador fica sem nenhuma opcao de frete. Entao toda falha
//    aqui — cliente nao identificado, regime ausente, banco fora — devolve
//    zero imposto e deixa o frete passar. Cobrar a menos e ruim; nao vender
//    e pior.
//
// 2. ZERO NAO E "SEM IMPOSTO". Quando nao da para calcular, o retorno diz
//    por que (`motivo`), para o log distinguir "esse destino nao tem imposto"
//    de "nao consegui calcular". Os dois dariam 0 e sao problemas opostos.
//
// 3. So a parte VISIVEL entra aqui. A outra metade ja esta no preco do
//    produto, via price adjustment do mercado na Shopify. Somar as duas seria
//    cobrar o imposto duas vezes do mesmo comprador.

const db = require('../../models');
const { baseDeclarada, repartirImposto } = require('./index');
const { calcularPeloRegime } = require('../regimeImportacao/calculoDireto');
const { preencherMedidasVariaveis } = require('../regimeImportacao/aliquotaPadrao');
const { cotacoesParaUsd } = require('../../utils/cotacoes');

/**
 * Converte os itens que a Shopify manda no callback para o formato do
 * calculo. `items[].price` vem em CENTAVOS e e o preco UNITARIO — ja custou
 * uma invoice declarada a um terco do valor por ter sido lido como total da
 * linha.
 */
function itensDoCallback(items = []) {
    return (Array.isArray(items) ? items : [])
        .filter((i) => i?.requires_shipping !== false)
        .map((i) => ({
            sku: i?.sku || null,
            precoUnitarioUsd: Number(i?.price || 0) / 100,
            quantidade: Math.max(1, Number(i?.quantity || 1) || 1),
        }));
}

/**
 * @param {object} args
 * @param {string} args.shopDomain  loja que chamou o callback
 * @param {object[]} args.items     rate.items como a Shopify manda
 * @param {string} args.paisDestino ISO-2
 * @param {number} args.freteUsd
 * @returns {Promise<{ visivelUsd:number, motivo:string, detalhe?:object }>}
 */
async function impostoVisivelDoCheckout({ shopDomain, items, paisDestino, freteUsd = 0 }) {
    const nada = (motivo, detalhe) => ({ visivelUsd: 0, motivo, ...(detalhe ? { detalhe } : {}) });

    try {
        const pais = String(paisDestino || '').trim().toUpperCase();
        if (!pais) return nada('sem_pais_destino');

        const loja = String(shopDomain || '').trim().toLowerCase();
        if (!loja) return nada('sem_shop_domain');

        const info = await db.InfoShopify.findOne({ where: { shopDomain: loja } });
        if (!info) return nada('loja_nao_vinculada', { loja });

        const clienteId = info.id_cliente;

        // As tres leituras nao dependem uma da outra: vao juntas para nao
        // somar latencia dentro do limite da Shopify.
        const [cliente, registros, regime] = await Promise.all([
            db.Cliente.findByPk(clienteId, {
                attributes: ['id', 'impostoPctVisivel', 'faturamentoFatorPadrao'],
            }),
            db.FaturamentoSku.findAll({
                where: { cliente_id: clienteId, ativo: true },
                attributes: ['sku', 'valor_faturado_usd'],
            }),
            db.RegimeImportacao.findOne({
                where: { pais_destino: pais, status: 'aprovado' },
                order: [['createdAt', 'DESC']],
            }),
        ]);

        if (!cliente) return nada('cliente_nao_encontrado', { clienteId });
        if (!regime) return nada('sem_regime_aprovado', { pais });

        const itens = itensDoCallback(items);
        if (!itens.length) return nada('carrinho_sem_itens_fisicos');

        const tabela = new Map(registros.map((r) => [r.sku, Number(r.valor_faturado_usd)]));
        const fator = Number(cliente.faturamentoFatorPadrao);

        const base = baseDeclarada({
            itens,
            tabela,
            fatorPadrao: Number.isFinite(fator) ? fator : null,
        });

        const bruto = regime.toJSON ? regime.toJSON() : regime;

        // Medida que depende do NCM (EUA, Portugal, Reino Unido): sem o codigo
        // do produto o calculo direto se recusa a fechar, e o checkout ficava
        // sem imposto nenhum justamente nos destinos que mais vendem. Entra a
        // estimativa fixa por pais, configuravel por env var.
        const { regime: r, estimado, aliquotaUsada, medidasEstimadas } =
            preencherMedidasVariaveis(bruto, pais);

        /*
         * Os limiares e as taxas fixas do regime vem na moeda do destino
         * (EUR 3 por linha, EUR 150, GBP 135). Sem converter, o calculo nao
         * sabe de que lado do limiar a remessa esta e desiste — foi o que
         * fez Portugal nao calcular nada, mesmo com a aliquota preenchida.
         * Busca-se so o que o proprio regime cita.
         */
        const moedas = new Set();
        for (const m of (r.medidas || [])) {
            if (m.moeda_fixo) moedas.add(m.moeda_fixo);
            if (m.moeda_limite) moedas.add(m.moeda_limite);
        }
        if (r.de_minimis?.moeda) moedas.add(r.de_minimis.moeda);

        const cotacoes = moedas.size ? await cotacoesParaUsd([...moedas]) : {};

        const calculo = calcularPeloRegime({
            regime: r,
            valorUsd: base.baseUsd,
            freteUsd: Number(freteUsd) || 0,
            cotacoes,
        });

        if (!calculo) {
            return nada('regime_depende_de_ncm', { pais, baseUsd: base.baseUsd });
        }

        if (calculo.isento_por_de_minimis) {
            return { visivelUsd: 0, motivo: 'isento_de_minimis', detalhe: { pais } };
        }

        /*
         * `estimado` so diz que o regime TEM medida variavel — nao que ela
         * entrou na conta. No Reino Unido o direito some abaixo de GBP 135, e
         * o total vira so o VAT, que e exato. Marcar esse numero como
         * estimado faria a flag perder o sentido justamente onde ela serve:
         * avisar quem le o log que o valor e aproximado.
         */
        const nomesAplicados = new Set(
            (calculo.medidas_aplicadas || []).map((m) => m.medida),
        );
        const estimativaEntrou = estimado
            && medidasEstimadas.some((nome) => nomesAplicados.has(nome));

        const fixas = Number(calculo.taxas_fixas_usd) || 0;
        const proporcional = Math.max(0, (Number(calculo.total_usd) || 0) - fixas);

        const split = repartirImposto(proporcional, cliente.impostoPctVisivel);

        // As taxas fixas vao inteiras na parte visivel: nao escalam com o
        // preco, entao nao ha como embuti-las num percentual do produto.
        const visivel = Number((split.visivelUsd + fixas).toFixed(2));

        return {
            visivelUsd: visivel,
            motivo: 'ok',
            detalhe: {
                pais,
                baseDeclaradaUsd: base.baseUsd,
                vendaUsd: base.vendaUsd,
                impostoTotalUsd: calculo.total_usd,
                pctVisivel: split.pctVisivel,
                taxasFixasUsd: fixas,
                skusSemCadastro: base.semCadastro,
                // Marca que a aliquota nao veio do NCM do produto. Quem ler
                // o log precisa saber que este numero e aproximado.
                aliquotaEstimada: estimativaEntrou,
                ...(estimativaEntrou
                    ? { aliquotaNcmUsadaPct: aliquotaUsada, medidasEstimadas }
                    : {}),
            },
        };
    } catch (err) {
        // Falha aqui nao pode custar a venda.
        console.error('[CHECKOUT IMPOSTO] falhou, seguindo sem imposto:', err.message);
        return nada('erro_interno', { erro: err.message });
    }
}

module.exports = { impostoVisivelDoCheckout, itensDoCallback };
