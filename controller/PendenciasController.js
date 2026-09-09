// controller/PendenciasController.js
// Alimenta o bloco "Precisa de você" do dashboard do cliente.
//
// Tudo aqui e leitura e sai numa chamada so: o dashboard ja dispara sete
// requisicoes na carga, nao faz sentido somar mais quatro.

const { Op } = require('sequelize');
const db = require('../models');

// Envio parado: em transito mas sem atualizacao de rastreio ha esse tempo.
// Rota internacional normal tem movimento a cada 2-3 dias; 5 sem nada
// costuma ser retencao na alfandega ou pendencia documental.
const DIAS_SEM_MOVIMENTO = 5;

// Cotacao em CRIADO so vira pendencia se for recente. O banco tem cotacao
// parada nesse status desde dezembro: sao abandonadas, nao pendencias. Cobrar
// isso todo dia vira ruido que o cliente aprende a ignorar.
const DIAS_AGUARDANDO_DESPACHO = 7;

function ymd(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * GET /dashboard/pendencias
 * Devolve só o que exige ação do cliente, em ordem de urgência.
 */
const pendencias = async (req, res) => {
    try {
        const clienteId = req.clienteId;
        const agora = new Date();

        const hoje = ymd(agora);
        const amanha = ymd(new Date(agora.getTime() + 24 * 60 * 60 * 1000));

        const limiteSemMovimento = new Date(
            agora.getTime() - DIAS_SEM_MOVIMENTO * 24 * 60 * 60 * 1000
        );
        const limiteDespacho = new Date(
            agora.getTime() - DIAS_AGUARDANDO_DESPACHO * 24 * 60 * 60 * 1000
        );

        const [aguardandoDespacho, comExcecao, paradas, coletasProximas] = await Promise.all([
            // Cotação fechada que ainda não virou envio. Só as recentes: ver
            // DIAS_AGUARDANDO_DESPACHO. (Não dá para usar etiqueta_path aqui —
            // ela está preenchida em 100% das cotações do banco.)
            db.Cotacao.count({
                where: {
                    cliente_id: clienteId,
                    status_norm: 'CRIADO',
                    created_at: { [Op.gte]: limiteDespacho },
                },
            }),

            // A transportadora sinalizou problema na entrega.
            db.Cotacao.count({
                where: { cliente_id: clienteId, status_norm: 'EXCECAO' },
            }),

            // Em trânsito, mas sem evento de rastreio ha dias.
            db.Cotacao.count({
                where: {
                    cliente_id: clienteId,
                    status_norm: 'EM_TRANSITO',
                    last_tracking_at: { [Op.lt]: limiteSemMovimento },
                },
            }),

            // Coletas de hoje e amanha que ainda nao foram atendidas.
            db.ColetaAgendada.findAll({
                where: {
                    cliente_id: clienteId,
                    status: 'AGENDADA',
                    pickup_date: { [Op.in]: [hoje, amanha] },
                },
                attributes: ['id', 'carrier', 'pickup_date', 'ready_time', 'close_time'],
                order: [['pickup_date', 'ASC'], ['ready_time', 'ASC']],
                raw: true,
            }),
        ]);

        const itens = [];

        if (comExcecao > 0) {
            itens.push({
                tipo: 'EXCECAO',
                severidade: 'alta',
                quantidade: comExcecao,
                titulo: comExcecao === 1
                    ? '1 envio com problema na entrega'
                    : `${comExcecao} envios com problema na entrega`,
                detalhe: 'A transportadora sinalizou uma exceção nesses envios.',
                acao: 'Ver envios',
            });
        }

        if (paradas > 0) {
            itens.push({
                tipo: 'SEM_MOVIMENTO',
                severidade: 'alta',
                quantidade: paradas,
                titulo: paradas === 1
                    ? '1 envio sem movimento'
                    : `${paradas} envios sem movimento`,
                detalhe: `Em trânsito sem atualização há mais de ${DIAS_SEM_MOVIMENTO} dias — costuma ser retenção na alfândega.`,
                acao: 'Rastrear',
            });
        }

        for (const coleta of coletasProximas) {
            const eHoje = String(coleta.pickup_date) === hoje;
            const janela = [coleta.ready_time, coleta.close_time].filter(Boolean).join('–');

            itens.push({
                tipo: 'COLETA_PROXIMA',
                severidade: eHoje ? 'alta' : 'media',
                quantidade: 1,
                titulo: `Coleta ${coleta.carrier} ${eHoje ? 'hoje' : 'amanhã'}${janela ? `, ${janela}` : ''}`,
                detalhe: 'Deixe os volumes prontos e etiquetados antes da janela.',
                acao: 'Ver coleta',
                coleta_id: coleta.id,
            });
        }

        if (aguardandoDespacho > 0) {
            itens.push({
                tipo: 'AGUARDANDO_DESPACHO',
                severidade: 'media',
                quantidade: aguardandoDespacho,
                titulo: aguardandoDespacho === 1
                    ? '1 cotação aguardando despacho'
                    : `${aguardandoDespacho} cotações aguardando despacho`,
                detalhe: `Fechada nos últimos ${DIAS_AGUARDANDO_DESPACHO} dias e ainda sem coleta.`,
                acao: 'Ver cotações',
            });
        }

        return res.status(200).json({ ok: true, data: itens });
    } catch (err) {
        console.error('Erro ao montar pendencias do dashboard: ', err);
        return res.status(500).json({ ok: false, err: err?.message });
    }
};

module.exports = { pendencias };
