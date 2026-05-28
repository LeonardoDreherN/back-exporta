const db = require('../models');
const { closeOutShipment, deleteMasterShipment } = require('../services/ups/worldease');
const { generateWorldeaseOverlabel } = require('../utils/generateWorldeaseOverlabel');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

function resolveWorldeaseCredentials(cliente) {
    const clientId = cliente?.ups_client_id || process.env.UPS_CLIENT_ID;
    const clientSecret = cliente?.ups_client_secret || process.env.UPS_CLIENT_SECRET;
    const merchantId = cliente?.ups_shipper_number || process.env.UPS_ACCOUNT_NUMBER;
    const shipperAccountNumber = cliente?.ups_shipper_number || process.env.UPS_ACCOUNT_NUMBER;
    return { clientId, clientSecret, merchantId, shipperAccountNumber };
}

async function salvarLabelMasterNaStorage(masterId, pdfBuffer) {
    const timestamp = Date.now();
    const path = `worldease/${masterId}/master-label-${timestamp}.pdf`;
    const { error } = await supabase.storage
        .from('labels')
        .upload(path, pdfBuffer, { contentType: 'application/pdf', upsert: true });
    if (error) {
        console.error('[WorldEase] erro ao salvar label na storage:', error);
        return null;
    }
    return path;
}

// POST /api/worldease/masters — cria um master shipment em aberto
async function createMaster(req, res) {
    try {
        const clienteId = req.clienteId || req.user?.clienteId;
        const { cotacao_ids, shipper_account_number } = req.body;

        if (!cotacao_ids?.length) {
            return res.status(400).json({ ok: false, error: 'cotacao_ids obrigatório' });
        }

        const cliente = await db.Cliente.findByPk(clienteId);
        const { shipperAccountNumber } = resolveWorldeaseCredentials(cliente);

        const master = await db.WorldeaseMaster.create({
            cliente_id: clienteId,
            shipper_account_number: shipper_account_number || shipperAccountNumber,
            cotacao_ids,
            status: 'ABERTO',
        });

        return res.status(201).json({ ok: true, master });
    } catch (err) {
        console.error('[WorldEase] createMaster error:', err);
        return res.status(500).json({ ok: false, error: err.message });
    }
}

// GET /api/worldease/masters — lista masters do cliente
async function listMasters(req, res) {
    try {
        const clienteId = req.clienteId || req.user?.clienteId;
        const masters = await db.WorldeaseMaster.findAll({
            where: { cliente_id: clienteId },
            order: [['created_at', 'DESC']],
        });
        return res.json({ ok: true, masters });
    } catch (err) {
        console.error('[WorldEase] listMasters error:', err);
        return res.status(500).json({ ok: false, error: err.message });
    }
}

// POST /api/worldease/masters/:id/closeout — fecha o master e gera overlabels
async function closeout(req, res) {
    try {
        const clienteId = req.clienteId || req.user?.clienteId;
        const { id } = req.params;

        const master = await db.WorldeaseMaster.findOne({ where: { id, cliente_id: clienteId } });
        if (!master) return res.status(404).json({ ok: false, error: 'Master não encontrado' });
        if (master.status === 'FECHADO') return res.status(400).json({ ok: false, error: 'Master já fechado' });

        const cliente = await db.Cliente.findByPk(clienteId);
        const { clientId, clientSecret, merchantId, shipperAccountNumber } = resolveWorldeaseCredentials(cliente);

        const gccn = req.body.gccn || master.gccn;
        if (!gccn) return res.status(400).json({ ok: false, error: 'GCCN obrigatório para o CloseOut' });

        const upsResponse = await closeOutShipment({
            gccn,
            shipperAccountNumber: master.shipper_account_number || shipperAccountNumber,
            clientId,
            clientSecret,
            merchantId,
        });

        // Salva label master retornada pela UPS (PNG base64)
        let labelPath = null;
        const labelData = upsResponse?.label?.lblData;
        const labelMime = upsResponse?.label?.opTyp === 'PNG' ? 'image/png' : 'application/pdf';

        if (labelData) {
            const labelBuf = Buffer.from(labelData, 'base64');
            const ts = Date.now();
            const ext = labelMime === 'image/png' ? 'png' : 'pdf';
            const path = `worldease/${master.id}/master-label-${ts}.${ext}`;
            const { error } = await supabase.storage
                .from('labels')
                .upload(path, labelBuf, { contentType: labelMime, upsert: true });
            if (!error) labelPath = path;
        }

        // Gera overlabels para cada cotação do master
        const cotacoes = await db.Cotacao.findAll({ where: { id: master.cotacao_ids } });
        const overlabels = [];

        const iorData = {
            importerName: cliente?.nomeIOR || '',
            address: [cliente?.enderecoIOR, cliente?.numeroIOR].filter(Boolean).join(', '),
            city: cliente?.cidadeIOR || '',
            state: cliente?.estadoIOR || '',
            zip: cliente?.cod_postalIOR || '',
            country: cliente?.paisIOR || '',
        };

        for (const cotacao of cotacoes) {
            const overlabelBuf = await generateWorldeaseOverlabel({
                ...iorData,
                trackingNumber: cotacao.tracking_number,
            });

            const path = `worldease/${master.id}/overlabel-cotacao-${cotacao.id}-${Date.now()}.pdf`;
            const { error } = await supabase.storage
                .from('labels')
                .upload(path, overlabelBuf, { contentType: 'application/pdf', upsert: true });

            overlabels.push({
                cotacao_id: cotacao.id,
                tracking_number: cotacao.tracking_number,
                overlabel_path: error ? null : path,
                overlabel_base64: error ? overlabelBuf.toString('base64') : null,
            });
        }

        await master.update({
            gccn,
            status: 'FECHADO',
            label_base64: labelData || null,
            label_mime: labelMime,
            label_path: labelPath,
            closeout_at: new Date(),
            raw_response: upsResponse,
        });

        return res.json({ ok: true, master, overlabels });
    } catch (err) {
        console.error('[WorldEase] closeout error:', err);
        return res.status(err.status || 500).json({ ok: false, error: err.message, upstream: err.upstream });
    }
}

// DELETE /api/worldease/masters/:id — deleta master na UPS
async function deleteMaster(req, res) {
    try {
        const clienteId = req.clienteId || req.user?.clienteId;
        const { id } = req.params;

        const master = await db.WorldeaseMaster.findOne({ where: { id, cliente_id: clienteId } });
        if (!master) return res.status(404).json({ ok: false, error: 'Master não encontrado' });
        if (!master.gccn) return res.status(400).json({ ok: false, error: 'Master sem GCCN — não foi enviado para a UPS ainda' });

        const cliente = await db.Cliente.findByPk(clienteId);
        const { clientId, clientSecret, merchantId, shipperAccountNumber } = resolveWorldeaseCredentials(cliente);

        const upsResponse = await deleteMasterShipment({
            gccn: master.gccn,
            shipperAccountNumber: master.shipper_account_number || shipperAccountNumber,
            clientId,
            clientSecret,
            merchantId,
        });

        await master.update({ status: 'CANCELADO' });

        return res.json({ ok: true, message: upsResponse?.message || 'Master cancelado', master });
    } catch (err) {
        console.error('[WorldEase] deleteMaster error:', err);
        return res.status(err.status || 500).json({ ok: false, error: err.message, upstream: err.upstream });
    }
}

module.exports = { createMaster, listMasters, closeout, deleteMaster };
