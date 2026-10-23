// services/classificacaoOcorrencia.js
//
// Traduz o que a transportadora disse para o que o cliente precisa saber.
//
// O evento de rastreio chega cru e em inglês ("Shipment held by customs:
// commercial invoice signature required"). A tela mostrava exatamente isso, e
// o cliente — que exporta, mas não necessariamente lê inglês técnico de
// logística — não sabia nem o que tinha acontecido nem o que fazer.
//
// Aqui NÃO se inventa informação: a classificação olha o texto que a
// transportadora mandou e escolhe um título, uma explicação e a ação
// correspondente. Quando nada bate, cai no genérico e o texto original
// continua visível na linha do tempo do chamado.

/**
 * Cada regra é testada na ordem. `padrao` roda contra o texto do evento em
 * minúsculas (descrição + status + código, concatenados).
 */
const REGRAS = [
    {
        tipo: 'ALFANDEGA',
        padrao: /(customs|alf[âa]ndega|clearance|despacho aduaneiro|held by customs|duty|invoice.*(required|missing)|commercial invoice)/i,
        titulo: 'Retido na alfândega',
        descricao:
            'A alfândega do destino segurou o pacote para conferência de documentos. ' +
            'Normalmente é a fatura comercial (commercial invoice) que falta, está sem assinatura ou não bate com o conteúdo declarado.',
        acao:
            'Envie a fatura comercial assinada (PDF ou foto) por aqui. A Intrex encaminha para a transportadora e para a alfândega do destino.',
        /** Dias para o cliente responder antes de o pacote correr risco de retorno. */
        prazoDias: 3,
    },
    {
        tipo: 'ENDERECO',
        padrao: /(incorrect address|address.*(incomplete|invalid|unknown|correction)|endere[çc]o|bad address|unable to locate|recipient unknown)/i,
        titulo: 'Endereço incompleto',
        descricao:
            'A transportadora não conseguiu confirmar o endereço de entrega. Faltou um complemento, o número não confere ou o destinatário não foi localizado no local.',
        acao:
            'Confirme o endereço completo do destinatário por aqui — com complemento, número e um telefone de contato. A Intrex repassa a correção à transportadora.',
        prazoDias: 2,
    },
    {
        tipo: 'TENTATIVA_ENTREGA',
        padrao: /(delivery attempt|attempted delivery|no one (was )?available|recipient not (home|available)|tentativa de entrega)/i,
        titulo: 'Tentativa de entrega sem sucesso',
        descricao:
            'A transportadora foi ao endereço e não encontrou ninguém para receber. Em geral são feitas até três tentativas antes de o pacote voltar.',
        acao:
            'Combine com o destinatário uma data em que haja alguém no endereço, ou informe por aqui um endereço alternativo.',
        prazoDias: 2,
    },
    {
        tipo: 'AVARIA',
        padrao: /(damaged|damage|avaria|broken|package.*torn)/i,
        titulo: 'Pacote avariado',
        descricao:
            'A transportadora registrou dano na embalagem durante o transporte.',
        acao:
            'Descreva por aqui o conteúdo e o valor do item para a Intrex abrir a reclamação junto à transportadora.',
        prazoDias: 5,
    },
    {
        tipo: 'ATRASO',
        padrao: /(delay|delayed|atraso|weather|operational|mechanical|missed the|rescheduled)/i,
        titulo: 'Atraso na entrega',
        descricao:
            'O envio sofreu atraso na malha da transportadora. Costuma ser clima, volume na operação ou conexão perdida — o pacote segue em trânsito.',
        // Sem ação do cliente: quem acompanha é a Intrex.
        acao: null,
        prazoDias: null,
    },
];

const GENERICO = {
    tipo: 'OUTRO',
    titulo: 'Ocorrência no envio',
    descricao:
        'A transportadora sinalizou uma ocorrência neste envio. O relato original dela está na linha do tempo abaixo.',
    acao: null,
    prazoDias: null,
};

/** Junta os campos de texto do evento num só, para as regras testarem. */
function textoDoEvento(trackingRaw) {
    if (!trackingRaw || typeof trackingRaw !== 'object') return '';

    const e = trackingRaw;
    return [
        e.description,
        e.statusDescription,
        e.activity,
        e.eventType,
        e.code,
        e.derivedCode,
        e.raw?.status?.description,
        e.raw?.status?.code,
    ]
        .filter(Boolean)
        .map(String)
        .join(' | ');
}

/**
 * Classifica a ocorrência de uma cotação.
 *
 * @param {object} cotacao linha de `cotacoes`, com tracking_raw
 * @returns {{tipo:string,titulo:string,descricao:string,acao:string|null,prazoDias:number|null,textoOriginal:string}}
 */
function classificarOcorrencia(cotacao) {
    const texto = textoDoEvento(cotacao?.tracking_raw);
    const regra = REGRAS.find((r) => r.padrao.test(texto)) || GENERICO;

    return {
        tipo: regra.tipo,
        titulo: regra.titulo,
        descricao: regra.descricao,
        acao: regra.acao,
        prazoDias: regra.prazoDias ?? null,
        textoOriginal: texto,
    };
}

module.exports = { classificarOcorrencia, textoDoEvento, REGRAS };
