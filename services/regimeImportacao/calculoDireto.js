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
 *   ncm?: string,                       // usado so pelo escopo por capitulo do HS
 * }} args
 * @returns {{
 *   imposto_importacao_usd:number, imposto_consumo_usd:number,
 *   taxas_fixas_usd:number, total_usd:number,
 *   aliquota_importacao_pct:number, aliquota_consumo_pct:number,
 *   medidas_aplicadas:{medida:string,aliquota_pct:number}[],
 *   determinado_por:'regime',
 * } | null} null quando o regime depende do NCM e exige classificacao.
 */
function calcularPeloRegime({ regime, valorUsd, freteUsd = 0, cotacoes = {}, ncm = null }) {
    if (!regime) return null;

    const todas = Array.isArray(regime.medidas) ? regime.medidas : [];
    const valor = Math.max(0, Number(valorUsd) || 0);
    const frete = Math.max(0, Number(freteUsd) || 0);

    /*
     * De minimis vem ANTES de tudo. Se a remessa esta abaixo de um limiar que
     * isenta de verdade, nao importa qual seria a tarifa do item: nao se paga.
     * Checar isto depois do -1 descartava Coreia, Japao e Taiwan por causa de
     * uma tarifa que a remessa nunca alcancaria — eles sumiam do calculo
     * justamente nas faixas em que o imposto e zero.
     */
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


    /*
     * Medida com faixa de valor so entra quando a remessa alcanca a faixa.
     * E o que separa a UE abaixo de EUR 150 — onde o direito e um valor fixo e
     * a tarifa por NCM nem aparece — da UE acima, onde a tarifa e do item. Sem
     * isto, a medida TARIC marcada com -1 derrubava para a IA ate remessas de
     * EUR 20, que nunca veriam aquela tarifa.
     *
     * Sem cambio para o limite, nao da para saber de que lado a remessa esta:
     * a medida fica valendo, que e o lado conservador.
     */
    const medidas = todas.filter((m) => {
        const acima = Number(m.aplica_acima_de);
        if (Number.isFinite(acima) && acima > 0) {
            const limiteUsd = paraUsd(acima, m.moeda_limite, cotacoes);
            if (limiteUsd !== null && valor <= limiteUsd) return false;
        }
        // O par de `aplica_acima_de`: o EUR 3 vale ATE EUR 150 e some acima,
        // onde quem assume e a tarifa da posicao.
        const ate = Number(m.aplica_ate);
        if (Number.isFinite(ate) && ate > 0) {
            const limiteUsd = paraUsd(ate, m.moeda_limite, cotacoes);
            if (limiteUsd !== null && valor > limiteUsd) return false;
        }

        /*
         * Escopo por capitulo do HS. Ha medida que nao depende do VALOR e sim
         * do QUE e a mercadoria: a Suica aboliu o direito sobre produto
         * industrial em 2024 e manteve sobre agricola e pesca (capitulos 01 a
         * 24). Para uma camiseta, a medida agricola simplesmente nao existe —
         * mas, sem declarar o escopo, o -1 dela mandava para a IA um calculo
         * cuja resposta e zero.
         *
         * Sem NCM nao da para saber o capitulo, e entao a medida fica valendo:
         * de novo o lado conservador, que no fim leva a classificacao.
         */
        /*
         * O par do `aplica_a_capitulos`: declara onde a medida NAO alcanca.
         *
         * No Canada o direito varia por posicao — por isso o -1 —, mas ha
         * capitulo em que a tarifa e Free para qualquer linha. Cafe (capitulo
         * 09) e o caso verificado na tarifa oficial da CBSA. Sem poder dizer
         * isso, o -1 do direito mandava para a classificacao por IA ate uma
         * remessa cuja tarifa e zero com todas as letras.
         *
         * A exclusao vem ANTES da inclusao: se a medida nao alcanca aquele
         * capitulo, nao importa o que a lista de inclusao diga.
         */
        const fora = m.nao_aplica_a_capitulos;
        if (Array.isArray(fora) && fora.length) {
            const cap = String(ncm || '').replace(/\D/g, '').slice(0, 2);
            if (cap.length === 2 && fora.includes(cap)) return false;
        }

        const caps = m.aplica_a_capitulos;
        if (Array.isArray(caps) && caps.length) {
            const digitos = String(ncm || '').replace(/\D/g, '');
            if (digitos.length < 2) return true;
            return caps.includes(digitos.slice(0, 2));
        }
        return true;
    });

    // Qualquer medida que dependa do NCM tira o regime do caminho direto.
    if (medidas.some((m) => Number(m.aliquota_pct) === -1)) return null;

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

    /*
     * Base do imposto sobre consumo: a maioria dos destinos tributa CIF mais o
     * direito, e esse segue sendo o padrao. O frete entra aqui e nao na base do
     * direito — mesma regra que o resto do sistema usa.
     *
     * Mas ha destino que exclui o transporte internacional POR LEI. O Canada
     * deduz o trecho "from the place within the country of export from which
     * the goods are shipped directly to Canada" (Customs Act, 48(5)(b)(i)): a
     * base e o valor da mercadoria, sem o frete. Somar o frete ali cobraria GST
     * sobre uma base que a alfandega nao usa — numa remessa de US$ 95 com US$
     * 56 de frete isso inflaria o imposto em mais de 50%.
     *
     * O padrao continua somando: so sai da base o regime que declarar, com
     * todas as letras, `imposto_consumo.base_inclui_frete: false`.
     */
    const freteNaBase = ic.base_inclui_frete === false ? 0 : frete;
    const baseConsumo = valor + freteNaBase + impImportacao + taxasFixas;
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
