// controller/shipments.controller.js
const { Transaction } = require('sequelize');
const db = require('../models');

const { Cliente, Shipment, Cotacao, sequelize } = db;

// Reaproveita o que você já tem pronto:
const { prepararCotacaoUPS } = require('../services/ups/cotacaoUps');
const { prepararCotacaoFedex } = require('../services/fedex/cotacaoFedex');

function toInt(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}
function normRef(v) {
    return String(v || '').trim();
}

function getClienteId(req) {
    return Number(req.cliente?.id ?? req.clienteId ?? req.usuario?.clienteId ?? req.user?.clienteId);
}

// Normaliza as 2 respostas num formato único pro front
function normalizeRateResult(carrierResult) {
    if (!carrierResult) return null;

    const base = Number(carrierResult.base);
    const total = Number(carrierResult.total);

    return {
        carrier: String(carrierResult.carrier || '').toUpperCase(),
        currency: carrierResult.currency || 'USD',
        base: Number.isFinite(base) ? base : null,
        total: Number.isFinite(total) ? total : null,
        taxesTotal: Number.isFinite(Number(carrierResult.taxesTotal)) ? Number(carrierResult.taxesTotal) : null,
        fonte_base: carrierResult.fonte_base || null,
        surcharges: carrierResult.surcharges ?? null,
        carrier_raw: carrierResult.carrier_raw ?? null,
        serviceCode: carrierResult.serviceCode || null,
    };
}

// -------------------------
// POST /api/shipments/compare
// -------------------------
async function compareRates(req, res) {
    try {
        const cliente_id = getClienteId(req);
        if (!cliente_id) return res.status(401).json({ ok: false, error: 'Cliente não autenticado' });

        const {
            pedido_ref: pedido_ref_raw,
            pedido,
            caixa,

            // Você pode mandar os dois payloads ou só um, dependendo de como o front está hoje
            ups_rate_payload,
            fedex_rate_payload,

            // overrides opcionais
            preco_base_ups,
            preco_base_fedex,

            freightValueNum_ups,
            freightValueNum_fedex,

            // serviceCode fixo (UPS geralmente exige isso no rating)
            serviceCode,
        } = req.body || {};

        const pedido_ref = normRef(pedido_ref_raw);
        if (!pedido_ref) return res.status(400).json({ ok: false, error: 'pedido_ref é obrigatório' });

        // carrega plano do cliente (mesma lógica do seu createCotacaoReal)
        const cli = await Cliente.findByPk(cliente_id, { attributes: ['id', 'plano'] });
        const plano = cli?.plano || null;

        // Calcula ambos (defensivo: se um falhar, devolve erro parcial)
        let upsResult = null;
        let fedexResult = null;
        const errors = {};

        try {
            upsResult = await prepararCotacaoUPS({
                req: { ...req, body: { ...req.body, rate_payload: ups_rate_payload, serviceCode } },
                rate_payload: ups_rate_payload,
                preco_base: preco_base_ups,
                freightValueNum: freightValueNum_ups,
                plano,
            });
        } catch (e) {
            errors.UPS = e?.message || 'Falha ao cotar UPS';
        }

        try {
            fedexResult = await prepararCotacaoFedex({
                req: { ...req, body: { ...req.body, rate_payload: fedex_rate_payload } },
                rate_payload: fedex_rate_payload,
                preco_base: preco_base_fedex,
                freightValueNum: freightValueNum_fedex,
                plano,
            });
        } catch (e) {
            errors.FEDEX = e?.message || 'Falha ao cotar FedEx';
        }

        // Se ambos falharam, retorna erro de verdade
        if (!upsResult && !fedexResult) {
            return res.status(400).json({ ok: false, error: 'Nenhuma cotação foi gerada', errors });
        }

        // Cria um Shipment “pré-confirmacao” pra travar idempotência do compare (1 por pedido_ref)
        // - rate_result guarda as duas cotações
        // - ship_result/track_result ficam null por enquanto
        // - carrier fica null até confirmar
        const rate_result = {
            pedido_ref,
            pedido: pedido && typeof pedido === 'object' ? pedido : {},
            caixa: caixa && typeof caixa === 'object' ? caixa : {},
            plano,
            quotes: {
                UPS: upsResult ? normalizeRateResult(upsResult) : null,
                FEDEX: fedexResult ? normalizeRateResult(fedexResult) : null,
            },
            errors: Object.keys(errors).length ? errors : null,
            createdAt: new Date().toISOString(),
        };

        // UPSERT manual (como você não tem unique index, fazemos find+update)
        let shipment = await Shipment.findOne({
            where: { cliente_id, status: 'COMPARE', carrier: null, pedido_ref },
            order: [['created_at', 'DESC']],
        });

        // se existir um COMPARE recente pro mesmo pedido_ref, reaproveita (evita lixo)
        if (shipment && shipment?.rate_result?.pedido_ref === pedido_ref) {
            await shipment.update({ rate_result });
        } else {
            shipment = await Shipment.create({
                cliente_id,
                pedido_ref,
                rate_result,
                ship_result: null,
                track_result: null,
                carrier: null,
                status: 'COMPARE',
            });
        }

        return res.json({
            ok: true,
            shipment_id: shipment.id,
            pedido_ref,
            quotes: rate_result.quotes,
            errors: rate_result.errors,
        });
    } catch (err) {
        console.error('[SHIPMENTS/COMPARE][ERROR]', err);
        return res.status(500).json({ ok: false, error: err?.message || 'Erro ao comparar cotações' });
    }
}

// -------------------------
// POST /api/shipments/:id/confirm
// -------------------------
async function confirmRate(req, res) {
    const t = await sequelize.transaction();
    try {
        const cliente_id = getClienteId(req);
        if (!cliente_id) { await t.rollback(); return res.status(401).json({ ok: false, error: 'Cliente não autenticado' }); }

        const shipment_id = toInt(req.params.id);
        if (!shipment_id) { await t.rollback(); return res.status(400).json({ ok: false, error: 'shipment_id inválido' }); }

        const { carrier } = req.body || {};
        const chosen = String(carrier || '').toUpperCase();
        if (!['UPS', 'FEDEX'].includes(chosen)) {
            await t.rollback();
            return res.status(400).json({ ok: false, error: 'carrier inválido (use UPS ou FEDEX)' });
        }

        // trava shipment
        const shipment = await Shipment.findByPk(shipment_id, {
            transaction: t,
            lock: Transaction.LOCK.UPDATE,
        });

        if (!shipment) { await t.rollback(); return res.status(404).json({ ok: false, error: 'Shipment não encontrado' }); }
        if (Number(shipment.cliente_id) !== Number(cliente_id)) { await t.rollback(); return res.status(403).json({ ok: false, error: 'Sem permissão' }); }

        if (shipment.status !== 'COMPARE') {
            await t.rollback();
            return res.status(409).json({ ok: false, error: `Shipment não está em COMPARE (status atual: ${shipment.status})` });
        }

        const rate_result = shipment.rate_result || {};
        const pedido_ref = normRef(rate_result.pedido_ref);
        if (!pedido_ref) { await t.rollback(); return res.status(400).json({ ok: false, error: 'Shipment sem pedido_ref' }); }

        const quote = rate_result?.quotes?.[chosen];
        if (!quote || !Number.isFinite(Number(quote.base))) {
            await t.rollback();
            return res.status(400).json({ ok: false, error: `Cotação ${chosen} não disponível nesse shipment` });
        }

        // Idempotência: se já existe cotação desse pedido_ref + carrier, retorna ela
        const existente = await Cotacao.findOne({
            where: { cliente_id, pedido_ref, carrier: chosen },
            attributes: ['id', 'pedido_ref', 'carrier', 'createdAt'],
            transaction: t,
            lock: Transaction.LOCK.UPDATE,
        });
        if (existente) {
            await shipment.update({ carrier: chosen, status: 'CONFIRMED' }, { transaction: t });
            await t.commit();
            return res.status(200).json({
                ok: true,
                created: false,
                cotacao_id: existente.id,
                pedido_ref: existente.pedido_ref,
                carrier: existente.carrier,
                shipment_id: shipment.id,
            });
        }

        console.log(`[SHIPMENTS/CONFIRM] ${chosen})`);
        console.log(`[SHIPMENTS/CONFIRM] ${Object.keys(rate_result)})`);
        console.log(`[SHIPMENTS/CONFIRM] ${Object.keys(quote)})`);

        // Monta um req "fake" pro seu createCotacaoReal (pra reaproveitar o mesmo código)
        // Aqui é o ponto: vamos salvar APENAS 1 cotação.
        const fakeReq = {
            ...req,
            cliente: { id: cliente_id },
            body: {
                pedido_ref,
                // comentario informal: tenta preencher pais pra nao salvar null
                pais_remetente: rate_result?.pedido?.pais_remetente || rate_result?.pedido?.endereco?.pais || null,
                pais_dest: rate_result?.pedido?.pais_dest || rate_result?.pedido?.shipping_address?.country_code || null,
                pedido: rate_result.pedido || {},
                caixa: rate_result.caixa || {},

                carrier: chosen,
                rate_payload: quote.carrier_raw, // isso é o que seus prepararCotacao* esperam como "raw"
                preco_base: quote.base,          // override para garantir consistência
                freightValueNum: null,
                serviceCode: quote.serviceCode || rate_result?.pedido?.serviceCode || null,
            }
        };

        // Reaproveita o MESMO fluxo do seu controller atual:
        // Importa aqui pra evitar circular imports
        const { createCotacaoReal } = require('../controller/CotacaoController');

        // Vamos capturar o retorno dele sem re-enviar res duplicado:
        // truque: criar um "res fake"
        let createdPayload = null;
        const fakeRes = {
            status(code) { this._status = code; return this; },
            json(payload) { createdPayload = { status: this._status || 200, payload }; return payload; },
        };

        await createCotacaoReal(fakeReq, fakeRes);

        if (!createdPayload?.payload?.ok) {
            await t.rollback();
            return res.status(400).json({
                ok: false,
                error: createdPayload?.payload?.error || 'Falha ao criar cotação final',
                raw: createdPayload?.payload || null,
            });
        }

        const cotacao_id = createdPayload.payload.cotacao_id;

        // Atualiza shipment: agora ele “vira” o registro de envio em andamento
        await shipment.update({
            carrier: chosen,
            status: 'CONFIRMED',
            // guarda o resultado final também (opcional)
            rate_result: {
                ...rate_result,
                confirmedCarrier: chosen,
                confirmedCotacaoId: cotacao_id,
                confirmedAt: new Date().toISOString(),
            }
        }, { transaction: t });

        await t.commit();
        return res.json({
            ok: true,
            created: true,
            shipment_id: shipment.id,
            cotacao_id,
            pedido_ref,
            carrier: chosen,
            preco_final: createdPayload.payload.preco_final,
        });
    } catch (err) {
        try { await t.rollback(); } catch (_) { }
        console.error('[SHIPMENTS/CONFIRM][ERROR]', err);
        return res.status(500).json({ ok: false, error: err?.message || 'Erro ao confirmar cotação' });
    }
}

module.exports = {
    compareRates,
    confirmRate,
};
