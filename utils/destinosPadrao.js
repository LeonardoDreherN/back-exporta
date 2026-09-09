// utils/destinosPadrao.js
// Cidade/CEP representativos de cada pais de destino. As transportadoras nao
// cotam so com o codigo do pais: precisam de uma cidade e (quando o pais usa)
// um CEP valido. Como o simulador nao pede endereco do destinatario, usamos
// aqui a capital/maior praca de cada pais como referencia.
//
// Os mesmos valores estao hoje em controller/publicQuoteController.js (cotacao
// de checkout). Este modulo e a versao compartilhada; o controller antigo segue
// com a copia local ate ser apontado para ca.

// nomePt e a chave de busca por nome (sem acento, minusculo, ver normKey).
const DESTINOS = [
    // Americas
    { code: 'US', nomePt: 'Estados Unidos',         city: 'New York',         state: 'NY',  postalCode: '10001' },
    { code: 'CA', nomePt: 'Canada',                 city: 'Toronto',          state: 'ON',  postalCode: 'M5H2N2' },
    { code: 'MX', nomePt: 'Mexico',                 city: 'Ciudad de Mexico', state: 'CMX', postalCode: '06600' },
    { code: 'AR', nomePt: 'Argentina',              city: 'Buenos Aires',     state: 'C',   postalCode: 'C1000' },
    { code: 'CL', nomePt: 'Chile',                  city: 'Santiago',         state: 'RM',  postalCode: '8320000' },
    { code: 'CO', nomePt: 'Colombia',               city: 'Bogota',           state: 'DC',  postalCode: '110111' },
    { code: 'PY', nomePt: 'Paraguai',               city: 'Asuncion',         state: '',    postalCode: '1001' },
    { code: 'UY', nomePt: 'Uruguai',                city: 'Montevideo',       state: '',    postalCode: '11000' },
    { code: 'PE', nomePt: 'Peru',                   city: 'Lima',             state: 'LIM', postalCode: '15001' },
    { code: 'EC', nomePt: 'Equador',                city: 'Quito',            state: 'P',   postalCode: '170150' },
    { code: 'BO', nomePt: 'Bolivia',                city: 'Santa Cruz',       state: '',    postalCode: '' },
    { code: 'VE', nomePt: 'Venezuela',              city: 'Caracas',          state: 'A',   postalCode: '1010' },
    { code: 'PA', nomePt: 'Panama',                 city: 'Panama',           state: '',    postalCode: '0801' },
    { code: 'CR', nomePt: 'Costa Rica',             city: 'San Jose',         state: 'SJ',  postalCode: '10101' },
    { code: 'CU', nomePt: 'Cuba',                   city: 'Havana',           state: '',    postalCode: '10400' },
    { code: 'JM', nomePt: 'Jamaica',                city: 'Kingston',         state: 'AK',  postalCode: 'JMAKN05' },

    // Europa
    { code: 'PT', nomePt: 'Portugal',               city: 'Lisboa',           state: '',    postalCode: '1000-001' },
    { code: 'GB', nomePt: 'Reino Unido',            city: 'London',           state: 'ENG', postalCode: 'EC1A1BB' },
    { code: 'FR', nomePt: 'Franca',                 city: 'Paris',            state: '',    postalCode: '75001' },
    { code: 'DE', nomePt: 'Alemanha',               city: 'Berlin',           state: '',    postalCode: '10115' },
    { code: 'ES', nomePt: 'Espanha',                city: 'Madrid',           state: '',    postalCode: '28001' },
    { code: 'IT', nomePt: 'Italia',                 city: 'Roma',             state: '',    postalCode: '00100' },
    { code: 'NL', nomePt: 'Paises Baixos',          city: 'Amsterdam',        state: '',    postalCode: '1011' },
    { code: 'BE', nomePt: 'Belgica',                city: 'Brussels',         state: '',    postalCode: '1000' },
    { code: 'SE', nomePt: 'Suecia',                 city: 'Stockholm',        state: '',    postalCode: '11120' },
    { code: 'NO', nomePt: 'Noruega',                city: 'Oslo',             state: '',    postalCode: '0150' },
    { code: 'DK', nomePt: 'Dinamarca',              city: 'Copenhagen',       state: '',    postalCode: '1000' },
    { code: 'FI', nomePt: 'Finlandia',              city: 'Helsinki',         state: '',    postalCode: '00100' },
    { code: 'CH', nomePt: 'Suica',                  city: 'Zurich',           state: '',    postalCode: '8001' },
    { code: 'AT', nomePt: 'Austria',                city: 'Vienna',           state: '',    postalCode: '1010' },
    { code: 'PL', nomePt: 'Polonia',                city: 'Warsaw',           state: '',    postalCode: '00-001' },
    { code: 'CZ', nomePt: 'Republica Tcheca',       city: 'Prague',           state: '',    postalCode: '11000' },
    { code: 'HU', nomePt: 'Hungria',                city: 'Budapest',         state: '',    postalCode: '1051' },
    { code: 'RO', nomePt: 'Romenia',                city: 'Bucharest',        state: '',    postalCode: '010011' },
    { code: 'GR', nomePt: 'Grecia',                 city: 'Athens',           state: '',    postalCode: '10431' },
    { code: 'TR', nomePt: 'Turquia',                city: 'Istanbul',         state: '',    postalCode: '34000' },

    // Oriente Medio / Africa
    { code: 'IL', nomePt: 'Israel',                 city: 'Tel Aviv',         state: '',    postalCode: '6100000' },
    { code: 'AE', nomePt: 'Emirados Arabes Unidos', city: 'Dubai',            state: 'DU',  postalCode: '' },
    { code: 'SA', nomePt: 'Arabia Saudita',         city: 'Riyadh',           state: 'RI',  postalCode: '11564' },
    { code: 'EG', nomePt: 'Egito',                  city: 'Cairo',            state: '',    postalCode: '11511' },
    { code: 'MA', nomePt: 'Marrocos',               city: 'Casablanca',       state: '',    postalCode: '10000' },
    { code: 'ZA', nomePt: 'Africa do Sul',          city: 'Johannesburg',     state: 'GP',  postalCode: '2001' },

    // Asia / Pacifico
    { code: 'CN', nomePt: 'China',                  city: 'Beijing',          state: 'BJ',  postalCode: '100000' },
    { code: 'JP', nomePt: 'Japao',                  city: 'Tokyo',            state: '13',  postalCode: '1000001' },
    { code: 'IN', nomePt: 'India',                  city: 'New Delhi',        state: 'DL',  postalCode: '110001' },
    { code: 'KR', nomePt: 'Coreia do Sul',          city: 'Seoul',            state: '',    postalCode: '04524' },
    { code: 'SG', nomePt: 'Cingapura',              city: 'Singapore',        state: '',    postalCode: '018989' },
    { code: 'HK', nomePt: 'Hong Kong',              city: 'Hong Kong',        state: '',    postalCode: '' },
    { code: 'TW', nomePt: 'Taiwan',                 city: 'Taipei',           state: '',    postalCode: '100' },
    { code: 'TH', nomePt: 'Tailandia',              city: 'Bangkok',          state: '',    postalCode: '10110' },
    { code: 'MY', nomePt: 'Malasia',                city: 'Kuala Lumpur',     state: '',    postalCode: '50000' },
    { code: 'ID', nomePt: 'Indonesia',              city: 'Jakarta',          state: 'JK',  postalCode: '10110' },
    { code: 'PH', nomePt: 'Filipinas',              city: 'Manila',           state: '',    postalCode: '1000' },
    { code: 'AU', nomePt: 'Australia',              city: 'Sydney',           state: 'NSW', postalCode: '2000' },
    { code: 'NZ', nomePt: 'Nova Zelandia',          city: 'Auckland',         state: '',    postalCode: '1010' },

    // Leste Europeu
    { code: 'RU', nomePt: 'Russia',                 city: 'Moscow',           state: '',    postalCode: '101000' },
];

const POR_CODE = new Map(DESTINOS.map((d) => [d.code, d]));

// eslint-disable-next-line no-misleading-character-class
const normKey = (s) => String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim();

const POR_NOME = new Map(DESTINOS.map((d) => [normKey(d.nomePt), d]));

/**
 * Aceita ISO-2 ("US") ou nome em portugues com ou sem acento ("Estados Unidos").
 * @param {string} destino
 * @returns {{code:string,nomePt:string,city:string,state:string,postalCode:string} | null}
 */
function resolveDestino(destino) {
    const raw = String(destino || '').trim();
    if (!raw) return null;

    if (/^[A-Za-z]{2}$/.test(raw)) return POR_CODE.get(raw.toUpperCase()) || null;

    return POR_NOME.get(normKey(raw)) || null;
}

/** Lista para popular o select do front, ordenada pelo nome em portugues. */
function listarDestinos() {
    return DESTINOS
        .map((d) => ({ code: d.code, nome: d.nomePt, cidade: d.city }))
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

module.exports = { DESTINOS, resolveDestino, listarDestinos, normKey };
