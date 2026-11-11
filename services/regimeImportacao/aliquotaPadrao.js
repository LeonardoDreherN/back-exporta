// services/regimeImportacao/aliquotaPadrao.js
//
// Preenche as medidas que o regime deixa como "depende do NCM".
//
// POR QUE ISTO EXISTE: nos EUA, em Portugal e no Reino Unido o direito de
// importacao varia por produto, e o regime guarda isso como aliquota_pct -1.
// O calculo direto, corretamente, se recusa a fechar conta assim. Resultado
// pratico: o checkout nao cobrava imposto nenhum nos tres destinos que mais
// importam — os EUA sao hoje a totalidade das vendas.
//
// Entre nao cobrar nada e cobrar uma estimativa unica, uma estimativa unica
// perde menos dinheiro. Entao aqui entra um numero fixo por pais.
//
// O QUE ISTO NAO E: nao e a aliquota do produto. Numa remessa de calcado a
// real passa de 37%; numa de bolsa fica perto de 4,5%. O numero daqui erra
// nos dois sentidos, e o erro fica no pedido. Para acertar de verdade e
// preciso o NCM do item e a tarifa oficial (USITC para os EUA, UK Trade
// Tariff para o Reino Unido) — e o que substitui este modulo quando houver.
//
// Configuracao, sem deploy, por env var no Render:
//   IMPOSTO_NCM_PADRAO_PCT=25        vale para todos os paises
//   IMPOSTO_NCM_PADRAO_PCT_US=25     sobrescreve so os EUA
//   IMPOSTO_NCM_PADRAO_PCT_GB=12
// A env var tem prioridade sobre o default por pais abaixo.
// O valor 'off' desliga a estimativa e volta ao comportamento antigo (nao
// calcula nada naquele pais). O valor 0 e uma aliquota de verdade: zero por
// cento — util nos EUA, onde a Secao 301 de 25% ja esta cadastrada a parte e
// somar outros 25% dobraria o imposto.

const PADRAO_GLOBAL = 25;

/*
 * Default por pais, quando a soma das medidas JA cadastradas responde pelo
 * total que se quer cobrar.
 *
 * EUA: o imposto combinado e 25%, e a Sobretaxa Secao 301 de 25% ja esta no
 * regime como medida fixa. Entao a medida que depende do NCM entra com ZERO —
 * botar 25% aqui tambem faria o pedido pagar 50%, o dobro do combinado.
 */
const PADRAO_POR_PAIS = {
    US: 0,
};

/**
 * @param {string} pais ISO-2
 * @returns {number|null} aliquota em %, ou null quando a estimativa esta
 *          desligada ('off') e o pais deve voltar a nao calcular
 */
function aliquotaPadraoNcm(pais) {
    const iso = String(pais || '').trim().toUpperCase();

    const bruto = process.env[`IMPOSTO_NCM_PADRAO_PCT_${iso}`] ?? process.env.IMPOSTO_NCM_PADRAO_PCT;

    if (bruto !== undefined && String(bruto).trim() !== '') {
        if (String(bruto).trim().toLowerCase() === 'off') return null;
        const n = Number(bruto);
        if (Number.isFinite(n) && n >= 0) return n;
    }

    if (Object.prototype.hasOwnProperty.call(PADRAO_POR_PAIS, iso)) {
        return PADRAO_POR_PAIS[iso];
    }

    return PADRAO_GLOBAL;
}

/**
 * Devolve uma COPIA do regime com as medidas -1 preenchidas.
 *
 * Nao altera o regime recebido: ele vem do banco e e usado em outros
 * caminhos (simulador, cotacao) que nao querem esta estimativa.
 *
 * @returns {{ regime:object, estimado:boolean, aliquotaUsada:number|null,
 *             medidasEstimadas:string[] }}
 */
function preencherMedidasVariaveis(regime, pais) {
    if (!regime) return { regime, estimado: false, aliquotaUsada: null, medidasEstimadas: [] };

    const medidas = Array.isArray(regime.medidas) ? regime.medidas : [];
    const variaveis = medidas.filter((m) => Number(m.aliquota_pct) === -1);

    if (!variaveis.length) {
        return { regime, estimado: false, aliquotaUsada: null, medidasEstimadas: [] };
    }

    const pct = aliquotaPadraoNcm(pais);

    // 'off' e uma escolha: "prefiro nao cobrar a cobrar errado". Devolve o
    // regime intacto e o calculo volta a recusar, como antes.
    if (pct === null) {
        return { regime, estimado: false, aliquotaUsada: null, medidasEstimadas: [] };
    }

    return {
        regime: {
            ...regime,
            medidas: medidas.map((m) => (
                Number(m.aliquota_pct) === -1
                    ? { ...m, aliquota_pct: pct, estimada: true }
                    : m
            )),
        },
        estimado: true,
        aliquotaUsada: pct,
        medidasEstimadas: variaveis.map((m) => m.medida),
    };
}

module.exports = { aliquotaPadraoNcm, preencherMedidasVariaveis, PADRAO_GLOBAL };
