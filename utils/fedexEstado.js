// utils/fedexEstado.js
// Normaliza o estado/provincia para o formato que a FedEx aceita.
//
// A FedEx so aceita SIGLA DE DUAS LETRAS em stateOrProvinceCode. Qualquer
// coisa maior — "LIM" (Lima), "ENG" (England), "CMX" (Ciudad de Mexico),
// "Sao Paulo" por extenso — faz a cotacao voltar vazia, sem erro que explique
// o motivo: a remessa simplesmente nao recebe tarifa daquela transportadora.
//
// Foi o que aconteceu com o Peru no simulador: a tabela de destinos trazia
// "LIM" e a FedEx nao cotava a rota, enquanto a UPS cotava normalmente. Os
// destinos que funcionavam (Italia, Franca, Portugal) eram justamente os que
// nao levam estado nenhum.
//
// Havia tres tratamentos diferentes no projeto — um no checkout da Shopify,
// outro no da Nuvemshop e nenhum no simulador, na cotacao publica e no envio
// real. Este modulo passa a ser o unico.

/*
 * Nome por extenso -> sigla. Entra so o que chega de verdade pelos checkouts:
 * as plataformas mandam ora a sigla, ora o nome completo do estado.
 */
const POR_EXTENSO = {
    // Brasil (origem)
    acre: 'AC', alagoas: 'AL', amapa: 'AP', amazonas: 'AM', bahia: 'BA',
    ceara: 'CE', 'distrito federal': 'DF', 'espirito santo': 'ES', goias: 'GO',
    maranhao: 'MA', 'mato grosso': 'MT', 'mato grosso do sul': 'MS',
    'minas gerais': 'MG', para: 'PA', paraiba: 'PB', parana: 'PR',
    pernambuco: 'PE', piaui: 'PI', 'rio de janeiro': 'RJ',
    'rio grande do norte': 'RN', 'rio grande do sul': 'RS', rondonia: 'RO',
    roraima: 'RR', 'santa catarina': 'SC', 'sao paulo': 'SP', sergipe: 'SE',
    tocantins: 'TO',

    // Estados Unidos (maior destino)
    alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
    colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
    hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
    kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
    massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
    missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
    'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
    'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
    oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
    'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
    virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
    wyoming: 'WY', 'district of columbia': 'DC', 'puerto rico': 'PR',

    // Canada
    alberta: 'AB', 'british columbia': 'BC', manitoba: 'MB', 'new brunswick': 'NB',
    'newfoundland and labrador': 'NL', 'nova scotia': 'NS', ontario: 'ON',
    'prince edward island': 'PE', quebec: 'QC', saskatchewan: 'SK',
};

const semAcento = (s) => String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');

/**
 * @param {string} estado sigla ou nome por extenso
 * @returns {string|undefined} sigla de 2 letras, ou undefined quando nao da
 *          para resolver — nesse caso o campo deve sair do payload, porque
 *          mandar um valor invalido e pior do que nao mandar.
 */
function estadoFedex(estado) {
    const raw = String(estado || '').trim();
    if (!raw) return undefined;

    if (raw.length === 2) return raw.toUpperCase();

    return POR_EXTENSO[semAcento(raw)];
}

module.exports = { estadoFedex };
