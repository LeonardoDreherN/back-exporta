// services/regimeImportacao/calculoDireto.js
// Calcula o imposto do destino direto do regime, sem passar pela IA.
//
// POR QUE EXISTE
// --------------
// Nem todo destino precisa de classificacao fiscal. Em Cingapura o direito e
// zero para mercadoria geral e o GST e 9% sobre o CIF: a conta e a mesma para
// camiseta, cafe ou bijuteria. Em Hong Kong nao ha imposto nenhum. Nesses casos
// chamar o modelo para "classificar o item" nao acrescenta informacao — so
// gasta uma chamada paga e, quando a conta de IA esta sem saldo, derruba a
// estimativa de um destino cujas regras ja estao apuradas e aprovadas.
//
// O regime ja carrega a distincao: `aliquota_pct: -1` e o marcador de "depende
// do NCM do item". Se NENHUMA medida usa -1, o regime e deterministico e a
// conta e aritmetica pura. Se alguma usa, devolve null e quem chama segue pelo
// caminho da classificacao.
//
// CONSERVADOR POR PADRAO
// ----------------------
// De minimis so zera a conta quando o regime declara `isencao_real: true`.
// Sem essa marca, cobra-se. Em Cingapura, Australia e Nova Zelandia o limiar
// muda QUEM recolhe (vendedor x fronteira), nao se ha imposto: zerar ali
// mostraria "sem imposto" para uma venda que paga imposto.

/** Converte um valor de qualquer moeda conhecida para USD. */
function paraUsd(valor, moeda, cotacoes) {
    const v = Number(valor);
    if (!Number.isFinite(v) || v === 0) return 0;

    const m = String(moeda || 'USD').trim().toUpperCase();
    if (m === 'USD') return v;

    const taxa = cotacoes?.[m];
    return Number.isFinite(taxa) && taxa > 0 ? v * taxa : null;
}

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * @param {{
 *   regime: object,
 *   valorUsd: number,
 *   freteUsd?: number,
 *   cotacoes?: Record<string, number>,  // moeda -> quanto vale 1 unidade em USD
 * }} args
 * @returns {{
 *   imposto_importacao_usd:number, imposto_consumo_usd:number,
 *   taxas_fixas_usd:number, total_usd:number,
 *   aliquota_importacao_pct:number, aliquota_consumo_pct:number,
 *   medidas_aplicadas:{medida:string,aliquota_pct:number}[],
 *   determinado_por:'regime',
 * } | null} null quando o regime depende do NCM e exige classificacao.
 */
function calcularPeloRegime({ regime, valorUsd, freteUsd = 0, cotacoes = {} }) {
    if (!regime) return null;

    const medidas = Array.isArray(regime.medidas) ? regime.medidas : [];
    const valor = Math.max(0, Number(valorUsd) || 0);
    const frete = Math.max(0, Number(freteUsd) || 0);

    // Qualquer medida que dependa do NCM tira o regime do caminho direto.
    if (medidas.some((m) => Number(m.aliquota_pct) === -1)) return null;

    // De minimis: so isenta quando o regime diz, com todas as letras, que a
    // isencao e real. O limite precisa estar na mesma moeda que da para
    // converter; sem conversao, nao se arrisca a zerar.
    const dm = regime.de_minimis;
    if (dm?.existe && dm.isencao_real === true) {
        const limiteUsd = paraUsd(dm.limite, dm.moeda, cotacoes);
        if (limiteUsd !== null && valor <= limiteUsd) {
            return {
                imposto_importacao_usd: 0,
                imposto_consumo_usd: 0,
                taxas_fixas_usd: 0,
                total_usd: 0,
                aliquota_importacao_pct: 0,
                aliquota_consumo_pct: 0,
                medidas_aplicadas: [{ medida: `De minimis do destino (${dm.limite} ${dm.moeda})`, aliquota_pct: 0 }],
                determinado_por: 'regime',
                isento_por_de_minimis: true,
            };
        }
    }

    const aplicadas = [];
    let aliquotaImportacao = 0;
    let taxasFixas = 0;

    for (const m of medidas) {
        const pct = Number(m.aliquota_pct) || 0;
        const tipo = String(m.tipo || '').toLowerCase();

        // Valor fixo por remessa (MPF, EUR 3, UHF). So entra quando vem
        // estruturado: ler o numero do texto de `base` seria adivinhacao.
        if (Number(m.valor_fixo) > 0) {
            const emUsd = paraUsd(m.valor_fixo, m.moeda_fixo, cotacoes);
            // Sem cambio para a moeda da taxa, o total sairia menor do que e.
            if (emUsd === null) return null;
            taxasFixas += emUsd * (Number(m.vezes) > 0 ? Number(m.vezes) : 1);
            aplicadas.push({ medida: m.medida, aliquota_pct: 0 });
            continue;
        }

        if (tipo === 'imposto_consumo') continue;   // tratado abaixo, uma vez so
        if (pct <= 0) continue;

        aliquotaImportacao += pct;
        aplicadas.push({ medida: m.medida, aliquota_pct: pct });
    }

    const ic = regime.imposto_consumo || {};
    const aliquotaConsumo = ic.incide_na_importacao ? (Number(ic.aliquota_pct) || 0) : 0;

    const impImportacao = r2(valor * (aliquotaImportacao / 100));

    // Base do imposto sobre consumo: a maioria dos destinos tributa CIF mais o
    // direito. O frete entra aqui e nao na base do direito — mesma regra que o
    // resto do sistema usa.
    const baseConsumo = valor + frete + impImportacao + taxasFixas;
    const impConsumo = r2(baseConsumo * (aliquotaConsumo / 100));

    if (aliquotaConsumo > 0) {
        aplicadas.push({ medida: ic.nome || 'Imposto sobre consumo', aliquota_pct: aliquotaConsumo });
    }

    return {
        imposto_importacao_usd: impImportacao,
        imposto_consumo_usd: impConsumo,
        taxas_fixas_usd: r2(taxasFixas),
        total_usd: r2(impImportacao + impConsumo + taxasFixas),
        aliquota_importacao_pct: aliquotaImportacao,
        aliquota_consumo_pct: aliquotaConsumo,
        medidas_aplicadas: aplicadas,
        determinado_por: 'regime',
        isento_por_de_minimis: false,
    };
}

module.exports = { calcularPeloRegime };
