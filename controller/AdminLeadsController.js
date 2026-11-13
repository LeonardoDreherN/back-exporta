// controller/AdminLeadsController.js
// Contatos deixados no simulador da página Sobre.
//
// A captura existe desde que o simulador passou a exigir e-mail e WhatsApp
// para mostrar o preço, mas o contato era descartado no /api/public-quote.
// Agora ele é gravado em leads_simulador, e esta é a leitura para o admin.

const { Op } = require('sequelize');
const db = require('../models');

const DIAS_RECENTES = 7;

/** Converte o decimal do Postgres (vem como string) em número. */
const dec = (v) => (v === null || v === undefined ? null : Number(v));

/**
 * Lista os contatos, mais recentes primeiro. GET /api/admin/leads
 *
 * Query: ?busca=  (nome, e-mail ou telefone, parcial)
 *        ?destino=US
 *        ?limit= / ?offset=
 */
async function listar(req, res) {
    try {
        const { busca, destino } = req.query || {};
        const limit = Math.min(Math.max(Number(req.query?.limit) || 100, 1), 500);
        const offset = Math.max(Number(req.query?.offset) || 0, 0);

        const where = {};

        if (destino) where.destino = String(destino).trim().toUpperCase();

        const termo = String(busca || '').trim();
        if (termo) {
            const digitos = termo.replace(/\D/g, '');
            where[Op.or] = [
                { nome: { [Op.iLike]: `%${termo}%` } },
                { email: { [Op.iLike]: `%${termo}%` } },
                ...(digitos ? [{ telefone: { [Op.like]: `%${digitos}%` } }] : []),
            ];
        }

        const { rows, count } = await db.LeadSimulador.findAndCountAll({
            where,
            order: [['created_at', 'DESC']],
            limit,
            offset,
        });

        const desde = new Date(Date.now() - DIAS_RECENTES * 24 * 60 * 60 * 1000);
        const [totalGeral, recentes] = await Promise.all([
            db.LeadSimulador.count(),
            db.LeadSimulador.count({ where: { created_at: { [Op.gte]: desde } } }),
        ]);

        const emails = [...new Set(rows.map((r) => r.email).filter(Boolean))];
        const vezesPorEmail = {};
        if (emails.length) {
            const contagens = await db.LeadSimulador.findAll({
                attributes: ['email', [db.sequelize.fn('COUNT', '*'), 'total']],
                where: { email: { [Op.in]: emails } },
                group: ['email'],
                raw: true,
            });
            for (const c of contagens) vezesPorEmail[c.email] = Number(c.total) || 1;
        }

        return res.json({
            ok: true,
            total: count,
            total_geral: totalGeral,
            recentes,
            dias_recentes: DIAS_RECENTES,
            limit,
            offset,
            leads: rows.map((l) => ({
                id: l.id,
                nome: l.nome, // <--- ADICIONADO AQUI
                email: l.email,
                telefone: l.telefone,
                origem: l.origem,
                destino: l.destino,
                peso_kg: dec(l.peso_kg),
                comprimento_cm: l.comprimento_cm,
                largura_cm: l.largura_cm,
                altura_cm: l.altura_cm,
                cotou: l.cotou,
                melhor_carrier: l.melhor_carrier,
                melhor_preco_usd: dec(l.melhor_preco_usd),
                simulacoes_do_email: l.email ? (vezesPorEmail[l.email] || 1) : null,
                created_at: l.created_at, // <--- GARANTINDO O ENVIO DA DATA
            })),
        });
    } catch (err) {
        console.error('[ADMIN LEADS][LISTAR]', err);
        return res.status(500).json({ ok: false, error: 'Não foi possível carregar os leads.' });
    }
}

module.exports = { listar };