// routes/chamadosRoutes.js
//
// Chamados de ocorrência: lista, conversa e anexo.
//
// Montado com autenticarUsuario + vincularCliente no server, então req.clienteId
// já chega resolvido. Toda consulta filtra por cliente_id: sem isso, trocar o
// id na URL leria o chamado de outra conta.
const express = require('express');
const crypto = require('crypto');
const { Op } = require('sequelize');
const { createClient } = require('@supabase/supabase-js');

const db = require('../models');
const { classificarOcorrencia } = require('../services/classificacaoOcorrencia');

const router = express.Router();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const ANEXOS_BUCKET = 'anexos';
const MAX_ANEXO_MB = Number(process.env.CHAMADO_ANEXO_MAX_MB || 10);
const MIMES_ACEITOS = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];

/** Mesmo corte de 90 dias do robô de rastreio: exceção velha não é acionável. */
const DIAS_RETROATIVOS = 90;

function requireCliente(req, res, next) {
    const cid = req.clienteId ?? req.usuario?.clienteId ?? req.user?.clienteId;
    if (!cid) return res.status(401).json({ ok: false, error: 'Cliente não autenticado' });
    req.cid = Number(cid);
    next();
}

/**
 * Cria chamado para cada cotação em EXCECAO que ainda não tem um, e registra a
 * fala da transportadora na linha do tempo.
 *
 * Roda na listagem porque não há fila nem worker neste serviço: o robô de
 * rastreio só grava `status_norm` e `tracking_raw` na cotação. A unicidade de
 * `cotacao_id` e a `chave` da mensagem é o que torna isso idempotente — rodar
 * de novo não duplica nada.
 */
async function sincronizarExcecoes(clienteId) {
    const corte = new Date(Date.now() - DIAS_RETROATIVOS * 24 * 60 * 60 * 1000);

    const excecoes = await db.Cotacao.findAll({
        where: {
            cliente_id: clienteId,
            status_norm: 'EXCECAO',
            createdAt: { [Op.gte]: corte },
        },
        attributes: ['id', 'pedido_ref', 'carrier', 'tracking_number', 'tracking_raw', 'pedido'],
        limit: 100,
    });

    if (!excecoes.length) return;

    const jaTem = await db.Chamado.findAll({
        where: { cliente_id: clienteId, cotacao_id: excecoes.map((c) => c.id) },
        attributes: ['cotacao_id'],
        raw: true,
    });
    const conhecidas = new Set(jaTem.map((c) => c.cotacao_id));

    for (const cot of excecoes) {
        if (conhecidas.has(cot.id)) continue;

        const classificacao = classificarOcorrencia(cot);
        const prazo = classificacao.prazoDias
            ? new Date(Date.now() + classificacao.prazoDias * 86400000)
                  .toISOString()
                  .slice(0, 10)
            : null;

        try {
            const chamado = await db.Chamado.create({
                cliente_id: clienteId,
                cotacao_id: cot.id,
                tipo: classificacao.tipo,
                titulo: classificacao.titulo,
                descricao: classificacao.descricao,
                acao: classificacao.acao,
                // Sem ação do cliente, a bola está com a Intrex.
                status: classificacao.acao ? 'ACAO_CLIENTE' : 'EM_ANALISE',
                prazo,
                origem: 'AUTO',
            });

            if (classificacao.textoOriginal) {
                await db.ChamadoMensagem.create({
                    chamado_id: chamado.id,
                    autor: 'TRANSPORTADORA',
                    texto: classificacao.textoOriginal,
                    chave: `rastreio:cotacao:${cot.id}`,
                });
            }
        } catch (err) {
            // Corrida entre duas abas abrindo a tela ao mesmo tempo: o índice
            // único resolve, só não vale derrubar a listagem por isso.
            if (err?.name !== 'SequelizeUniqueConstraintError') throw err;
        }
    }
}

/** Formato que a tela consome. */
function paraDTO(chamado, cotacao) {
    return {
        id: chamado.id,
        cotacao_id: chamado.cotacao_id,
        tipo: chamado.tipo,
        titulo: chamado.titulo,
        descricao: chamado.descricao,
        acao: chamado.acao,
        status: chamado.status,
        prazo: chamado.prazo,
        origem: chamado.origem,
        criado_em: chamado.created_at ?? chamado.createdAt,
        resolvido_em: chamado.resolvido_em,
        envio: cotacao
            ? {
                  pedido_ref: cotacao.pedido_ref,
                  carrier: cotacao.carrier,
                  tracking_number: cotacao.tracking_number,
                  comprador: cotacao.pedido?.nomeComprador ?? null,
                  destino: [cotacao.pedido?.cidade, cotacao.pedido?.pais]
                      .filter(Boolean)
                      .join(', '),
              }
            : null,
    };
}

// ---------------------------------------------------------------- listagem

router.get('/', requireCliente, async (req, res) => {
    try {
        await sincronizarExcecoes(req.cid);

        const chamados = await db.Chamado.findAll({
            where: { cliente_id: req.cid },
            order: [['created_at', 'DESC']],
            limit: 100,
        });

        const idsCotacao = chamados.map((c) => c.cotacao_id).filter(Boolean);
        const cotacoes = idsCotacao.length
            ? await db.Cotacao.findAll({
                  where: { id: idsCotacao },
                  attributes: ['id', 'pedido_ref', 'carrier', 'tracking_number', 'pedido'],
              })
            : [];
        const porId = new Map(cotacoes.map((c) => [c.id, c]));

        const itens = chamados.map((c) => paraDTO(c, porId.get(c.cotacao_id)));

        return res.json({
            ok: true,
            itens,
            abertas: itens.filter((i) => i.status !== 'RESOLVIDO').length,
            resolvidas: itens.filter((i) => i.status === 'RESOLVIDO').length,
            acao_necessaria: itens.filter((i) => i.status === 'ACAO_CLIENTE').length,
        });
    } catch (err) {
        console.error('[CHAMADOS][LIST]', err?.message);
        return res.status(500).json({ ok: false, error: 'Falha ao carregar as ocorrências.' });
    }
});

// ------------------------------------------------------------------ detalhe

router.get('/:id', requireCliente, async (req, res) => {
    try {
        const chamado = await db.Chamado.findOne({
            where: { id: Number(req.params.id), cliente_id: req.cid },
        });
        if (!chamado) return res.status(404).json({ ok: false, error: 'Chamado não encontrado.' });

        const [mensagens, cotacao] = await Promise.all([
            db.ChamadoMensagem.findAll({
                where: { chamado_id: chamado.id },
                order: [['created_at', 'ASC']],
            }),
            chamado.cotacao_id
                ? db.Cotacao.findByPk(chamado.cotacao_id, {
                      attributes: ['id', 'pedido_ref', 'carrier', 'tracking_number', 'pedido'],
                  })
                : null,
        ]);

        return res.json({
            ok: true,
            chamado: paraDTO(chamado, cotacao),
            mensagens: mensagens.map((m) => ({
                id: m.id,
                autor: m.autor,
                texto: m.texto,
                anexo_nome: m.anexo_nome,
                tem_anexo: Boolean(m.anexo_path),
                criado_em: m.created_at ?? m.createdAt,
            })),
        });
    } catch (err) {
        console.error('[CHAMADOS][DETALHE]', err?.message);
        return res.status(500).json({ ok: false, error: 'Falha ao carregar o chamado.' });
    }
});

// -------------------------------------------------------------- relatar novo

router.post('/', requireCliente, async (req, res) => {
    try {
        const { titulo, texto, cotacao_id } = req.body || {};
        if (!String(titulo || '').trim()) {
            return res.status(400).json({ ok: false, error: 'Descreva o problema no título.' });
        }

        // Só aceita vincular a envio do próprio cliente.
        let cotacaoId = null;
        if (cotacao_id) {
            const cot = await db.Cotacao.findOne({
                where: { id: Number(cotacao_id), cliente_id: req.cid },
                attributes: ['id'],
            });
            if (cot) cotacaoId = cot.id;
        }

        const chamado = await db.Chamado.create({
            cliente_id: req.cid,
            cotacao_id: cotacaoId,
            tipo: 'OUTRO',
            titulo: String(titulo).trim().slice(0, 200),
            descricao: null,
            acao: null,
            // Quem relata já fez a parte dele; a bola fica com a Intrex.
            status: 'EM_ANALISE',
            origem: 'CLIENTE',
        });

        if (String(texto || '').trim()) {
            await db.ChamadoMensagem.create({
                chamado_id: chamado.id,
                autor: 'CLIENTE',
                texto: String(texto).trim(),
            });
        }

        return res.status(201).json({ ok: true, chamado: paraDTO(chamado, null) });
    } catch (err) {
        console.error('[CHAMADOS][CRIAR]', err?.message);
        return res.status(500).json({ ok: false, error: 'Falha ao abrir o chamado.' });
    }
});

// ------------------------------------------------------------------ mensagem

router.post('/:id/mensagens', requireCliente, async (req, res) => {
    try {
        const chamado = await db.Chamado.findOne({
            where: { id: Number(req.params.id), cliente_id: req.cid },
        });
        if (!chamado) return res.status(404).json({ ok: false, error: 'Chamado não encontrado.' });

        const { texto, anexo } = req.body || {};
        const temTexto = String(texto || '').trim().length > 0;
        if (!temTexto && !anexo?.base64) {
            return res.status(400).json({ ok: false, error: 'Escreva algo ou anexe um arquivo.' });
        }

        let anexoPath = null;
        let anexoNome = null;
        let anexoMime = null;

        if (anexo?.base64) {
            const mime = String(anexo.mime || '').toLowerCase();
            if (!MIMES_ACEITOS.includes(mime)) {
                return res
                    .status(415)
                    .json({ ok: false, error: 'Envie PDF, JPG ou PNG.' });
            }

            const buf = Buffer.from(String(anexo.base64).replace(/^data:.*;base64,/, ''), 'base64');
            if (buf.length > MAX_ANEXO_MB * 1024 * 1024) {
                return res
                    .status(413)
                    .json({ ok: false, error: `O arquivo passa de ${MAX_ANEXO_MB} MB.` });
            }

            const sha = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
            const ext = mime.split('/')[1].replace('jpeg', 'jpg');
            anexoPath = `chamados/${req.cid}/${chamado.id}/${Date.now()}-${sha}.${ext}`;

            const { error } = await supabase.storage
                .from(ANEXOS_BUCKET)
                .upload(anexoPath, buf, { contentType: mime, upsert: false });

            if (error) {
                console.error('[CHAMADOS][ANEXO]', error.message);
                return res.status(502).json({
                    ok: false,
                    error: 'Não foi possível guardar o arquivo. Tente de novo.',
                });
            }

            anexoNome = String(anexo.nome || `anexo.${ext}`).slice(0, 180);
            anexoMime = mime;
        }

        const mensagem = await db.ChamadoMensagem.create({
            chamado_id: chamado.id,
            autor: 'CLIENTE',
            texto: temTexto ? String(texto).trim() : null,
            anexo_path: anexoPath,
            anexo_nome: anexoNome,
            anexo_mime: anexoMime,
        });

        // Cliente respondeu: a bola passa para a Intrex.
        if (chamado.status === 'ACAO_CLIENTE') {
            await chamado.update({ status: 'EM_ANALISE' });
        }

        return res.status(201).json({
            ok: true,
            mensagem: {
                id: mensagem.id,
                autor: mensagem.autor,
                texto: mensagem.texto,
                anexo_nome: mensagem.anexo_nome,
                tem_anexo: Boolean(mensagem.anexo_path),
                criado_em: mensagem.created_at ?? mensagem.createdAt,
            },
            status: chamado.status,
        });
    } catch (err) {
        console.error('[CHAMADOS][MENSAGEM]', err?.message);
        return res.status(500).json({ ok: false, error: 'Falha ao enviar a mensagem.' });
    }
});

// ------------------------------------------------------------------ download

router.get('/:id/mensagens/:mensagemId/anexo', requireCliente, async (req, res) => {
    try {
        const chamado = await db.Chamado.findOne({
            where: { id: Number(req.params.id), cliente_id: req.cid },
            attributes: ['id'],
        });
        if (!chamado) return res.status(404).json({ ok: false, error: 'Chamado não encontrado.' });

        const mensagem = await db.ChamadoMensagem.findOne({
            where: { id: Number(req.params.mensagemId), chamado_id: chamado.id },
        });
        if (!mensagem?.anexo_path) {
            return res.status(404).json({ ok: false, error: 'Anexo não encontrado.' });
        }

        const { data, error } = await supabase.storage
            .from(ANEXOS_BUCKET)
            .download(mensagem.anexo_path);
        if (error || !data) {
            return res.status(502).json({ ok: false, error: 'Falha ao baixar o anexo.' });
        }

        const buf = Buffer.from(await data.arrayBuffer());
        res.setHeader('Content-Type', mensagem.anexo_mime || 'application/octet-stream');
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="${(mensagem.anexo_nome || 'anexo').replace(/"/g, '')}"`,
        );
        return res.send(buf);
    } catch (err) {
        console.error('[CHAMADOS][ANEXO][DOWNLOAD]', err?.message);
        return res.status(500).json({ ok: false, error: 'Falha ao baixar o anexo.' });
    }
});

// ------------------------------------------------------------------ resolver

router.post('/:id/resolver', requireCliente, async (req, res) => {
    try {
        const chamado = await db.Chamado.findOne({
            where: { id: Number(req.params.id), cliente_id: req.cid },
        });
        if (!chamado) return res.status(404).json({ ok: false, error: 'Chamado não encontrado.' });

        if (chamado.status === 'RESOLVIDO') {
            return res.json({ ok: true, ja_resolvido: true });
        }

        await chamado.update({ status: 'RESOLVIDO', resolvido_em: new Date() });
        return res.json({ ok: true, status: chamado.status });
    } catch (err) {
        console.error('[CHAMADOS][RESOLVER]', err?.message);
        return res.status(500).json({ ok: false, error: 'Falha ao encerrar o chamado.' });
    }
});

module.exports = router;
