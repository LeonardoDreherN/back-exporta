// services/faturamentoDeclarado/importador.js
//
// Le a planilha de valor faturado por SKU.
//
// A planilha que o cliente usa e a MESMA que ele exporta da Shopify em
// Settings > Taxes and duties > Duties and import taxes > Update with CSV,
// com uma coluna a mais para o valor faturado. Assim ele preenche uma vez so
// e sobe nos dois lugares: a Shopify ignora a coluna extra, e nos ignoramos
// as colunas dela.
//
// Colunas que importam aqui:
//   Variant SKU          (chave; a Shopify escreve exatamente assim)
//   Valor faturado USD   (nossa)
//   Product title        (opcional, so para o admin reconhecer a linha)
//
// O parser e proposital e deliberadamente chato: uma planilha de precos que
// entra errada vira imposto errado em todo pedido daquele SKU, e ninguem
// percebe ate a fatura da transportadora chegar. Por isso linha invalida nao
// e ignorada em silencio — ela volta na lista de erros, com o numero da linha.

const { normSku } = require('./index');

/** Nomes aceitos para cada coluna, normalizados. Cobre a exportacao da
 *  Shopify (ingles) e a planilha montada a mao em portugues. */
const COLUNAS = {
    sku: ['variant sku', 'sku', 'codigo', 'codigo do produto'],
    valor: [
        'valor faturado usd', 'valor faturado', 'valor_faturado_usd',
        'valor declarado usd', 'valor declarado', 'declared value',
    ],
    descricao: ['product title', 'titulo', 'descricao', 'title', 'nome'],
};

const normCabecalho = (s) => String(s || '')
    .replace(/^﻿/, '')           // BOM do Excel
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');

/**
 * Separa uma linha de CSV respeitando aspas. Nao da para usar split(','):
 * descricao de produto tem virgula, e a Shopify exporta com aspas.
 */
function separarLinha(linha, sep) {
    const campos = [];
    let atual = '';
    let dentroDeAspas = false;

    for (let i = 0; i < linha.length; i++) {
        const c = linha[i];

        if (c === '"') {
            if (dentroDeAspas && linha[i + 1] === '"') { atual += '"'; i++; }
            else dentroDeAspas = !dentroDeAspas;
        } else if (c === sep && !dentroDeAspas) {
            campos.push(atual);
            atual = '';
        } else {
            atual += c;
        }
    }
    campos.push(atual);

    return campos.map((c) => c.trim());
}

/** Excel brasileiro salva com ';' e usa virgula decimal. Detecta pelo cabecalho. */
function detectarSeparador(primeiraLinha) {
    const ponto = (primeiraLinha.match(/,/g) || []).length;
    const pontoVirgula = (primeiraLinha.match(/;/g) || []).length;
    return pontoVirgula > ponto ? ';' : ',';
}

/**
 * "40,00" / "40.00" / "US$ 40" / "1.234,56" -> numero.
 * Devolve null quando nao da para ler com certeza — nunca chuta.
 */
function lerValor(bruto) {
    let s = String(bruto || '').trim();
    if (!s) return null;

    s = s.replace(/[^\d.,-]/g, '');          // tira US$, espaco, etc.
    if (!s) return null;

    const temVirgula = s.includes(',');
    const temPonto = s.includes('.');

    if (temVirgula && temPonto) {
        // O ultimo separador que aparece e o decimal: "1.234,56" ou "1,234.56"
        s = s.lastIndexOf(',') > s.lastIndexOf('.')
            ? s.replace(/\./g, '').replace(',', '.')
            : s.replace(/,/g, '');
    } else if (temVirgula) {
        // "40,00" e decimal; "1,234" sem casas e milhar — mas assumir milhar
        // num preco seria arriscado, entao so tratamos como decimal.
        s = s.replace(',', '.');
    }

    const n = Number(s);
    return Number.isFinite(n) ? n : null;
}

/**
 * @param {string} conteudo  o CSV inteiro
 * @returns {{ linhas:object[], erros:object[], colunasEncontradas:object }}
 */
function lerPlanilha(conteudo) {
    const texto = String(conteudo || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const linhas = texto.split('\n').filter((l) => l.trim() !== '');

    if (!linhas.length) {
        return { linhas: [], erros: [{ linha: 0, erro: 'Planilha vazia.' }], colunasEncontradas: {} };
    }

    const sep = detectarSeparador(linhas[0]);
    const cabecalho = separarLinha(linhas[0], sep).map(normCabecalho);

    const achar = (nomes) => cabecalho.findIndex((c) => nomes.includes(c));
    const iSku = achar(COLUNAS.sku);
    const iValor = achar(COLUNAS.valor);
    const iDesc = achar(COLUNAS.descricao);

    const colunasEncontradas = {
        sku: iSku >= 0 ? cabecalho[iSku] : null,
        valor: iValor >= 0 ? cabecalho[iValor] : null,
        descricao: iDesc >= 0 ? cabecalho[iDesc] : null,
        separador: sep,
    };

    if (iSku < 0 || iValor < 0) {
        const faltando = [];
        if (iSku < 0) faltando.push('"Variant SKU"');
        if (iValor < 0) faltando.push('"Valor faturado USD"');
        return {
            linhas: [],
            erros: [{
                linha: 1,
                erro: `Faltam colunas obrigatorias: ${faltando.join(' e ')}. `
                    + `O cabecalho lido foi: ${cabecalho.filter(Boolean).join(' | ')}`,
            }],
            colunasEncontradas,
        };
    }

    const out = [];
    const erros = [];
    const vistos = new Map();

    for (let i = 1; i < linhas.length; i++) {
        const nLinha = i + 1;   // numero como o Excel mostra
        const campos = separarLinha(linhas[i], sep);

        const sku = normSku(campos[iSku]);
        const brutoValor = campos[iValor];

        // Linha sem SKU e sem valor e so uma linha em branco com separadores.
        if (!sku && !String(brutoValor || '').trim()) continue;

        if (!sku) {
            erros.push({ linha: nLinha, erro: 'Sem SKU.' });
            continue;
        }

        const valor = lerValor(brutoValor);

        if (valor === null) {
            // Linha da exportacao da Shopify que o cliente nao preencheu.
            // Nao e erro de formato: e cadastro que falta.
            erros.push({ linha: nLinha, sku, erro: 'Valor faturado em branco ou ilegivel.' });
            continue;
        }

        if (valor < 0) {
            erros.push({ linha: nLinha, sku, erro: `Valor negativo (${valor}).` });
            continue;
        }

        if (vistos.has(sku)) {
            erros.push({
                linha: nLinha,
                sku,
                erro: `SKU repetido (ja aparece na linha ${vistos.get(sku)}).`,
            });
            continue;
        }

        vistos.set(sku, nLinha);

        out.push({
            sku,
            valor_faturado_usd: Number(valor.toFixed(2)),
            descricao: iDesc >= 0 ? String(campos[iDesc] || '').slice(0, 200) || null : null,
            linha: nLinha,
        });
    }

    return { linhas: out, erros, colunasEncontradas };
}

module.exports = { lerPlanilha, lerValor, separarLinha };
