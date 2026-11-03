// services/impostosPublicos.js
// Estimativa de imposto do simulador da pagina Sobre (sem login).
//
// Usa o mesmo calculo do simulador do dashboard, mas o visitante so escolhe
// uma categoria desta lista, nunca texto livre. Cada categoria tem NCM fixo,
// entao a classificacao por IA roda no maximo uma vez por categoria, destino e
// faixa de valor, e depois sai do cache. Texto livre numa pagina aberta seria
// uma chamada paga (~US$ 0,20) a cada descricao nova que alguem digitasse.
//
// A lista do front (components/SimuladorFrete) precisa ter os mesmos ids.

const { estimarImpostosSimulacao } = require('./simulacao');

const CATEGORIAS = {
    // NCM de 8 digitos, igual ao das cotacoes reais: a chave do cache e o NCM,
    // entao categoria e cliente com o mesmo item dividem a classificacao.
    roupas: { nome: 'Roupas em geral', ncm: '61091000', descricao: 'Camisetas e roupas de malha de algodão' },
    fitness: { nome: 'Roupas fitness', ncm: '61046300', descricao: 'Leggings e roupas fitness de fibra sintética' },
    calcados: { nome: 'Calçados', ncm: '64039990', descricao: 'Calçados com cabedal de couro' },
    bolsas: { nome: 'Bolsas e acessórios de couro', ncm: '42022100', descricao: 'Bolsas de couro' },
    bijuterias: { nome: 'Bijuterias', ncm: '71171900', descricao: 'Bijuterias de metal comum' },
    cosmeticos: { nome: 'Cosméticos e skincare', ncm: '33049990', descricao: 'Cosméticos e produtos de cuidado da pele' },
    suplementos: { nome: 'Suplementos alimentares', ncm: '21069030', descricao: 'Suplementos alimentares' },
    cafe: { nome: 'Café', ncm: '09012100', descricao: 'Café torrado' },
    livros: { nome: 'Livros', ncm: '49019900', descricao: 'Livros impressos' },
};

const VALOR_MAX_USD = 10000;

// Dois visitantes simulando a mesma categoria nova ao mesmo tempo dispariam
// duas classificacoes pagas iguais. Por destino e categoria as estimativas
// rodam uma de cada vez: a segunda espera a primeira e ja acha o cache.
const emAndamento = new Map();

class ImpostoPublicoInputError extends Error { }

async function estimarImpostoPublico({ destino, categoria, valor }) {
    const cat = CATEGORIAS[String(categoria || '').trim()];
    if (!cat) throw new ImpostoPublicoInputError('Categoria inválida');

    const destinoIso = String(destino || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(destinoIso)) throw new ImpostoPublicoInputError('Destino inválido');

    const valorUsd = Number(String(valor ?? '').replace(',', '.'));
    if (!Number.isFinite(valorUsd) || valorUsd <= 0 || valorUsd > VALOR_MAX_USD) {
        throw new ImpostoPublicoInputError(`Valor deve estar entre US$ 1 e US$ ${VALOR_MAX_USD}`);
    }

    const chave = `${destinoIso}|${categoria}`;
    const anterior = emAndamento.get(chave) || Promise.resolve();
    const atual = anterior.catch(() => { }).then(() => estimarImpostosSimulacao({
        destino: destinoIso,
        valor: valorUsd,
        moeda: 'USD',
        descricao: cat.descricao,
        ncm: cat.ncm,
    }));
    emAndamento.set(chave, atual);
    atual.catch(() => { }).finally(() => {
        if (emAndamento.get(chave) === atual) emAndamento.delete(chave);
    });
    const est = await atual;

    if (!est.disponivel) {
        return { disponivel: false, motivo: est.motivo };
    }

    return {
        disponivel: true,
        categoria: cat.nome,
        // Mesmo numero que o simulador do dashboard soma no total: estimativa
        // com margem de seguranca, nao o bruto da alfandega.
        imposto_usd: est.intrex_usd,
        aliquota_pct: est.aliquota_pct,
        de_minimis: est.de_minimis,
        confianca: est.confianca,
    };
}

module.exports = { estimarImpostoPublico, ImpostoPublicoInputError, CATEGORIAS };
