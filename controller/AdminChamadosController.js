// controller/AdminChamadosController.js
//
// Atendimento dos chamados pelo lado da Intrex.
//
// O chamado existia só do lado do cliente: ele abria, escrevia e ele mesmo
// marcava como resolvido. `autor: 'INTREX'` estava no enum de ChamadoMensagem e
// ninguém escrevia — o status EM_ANALISE dizia "a bola está com a Intrex" e
// nenhuma tela mostrava isso para a Intrex. O atendimento seguia no WhatsApp,
// que é justamente o que a tela de ocorrências foi feita para tirar de lá.
//
// Aqui o chamado ganha a outra ponta: ver a fila de todos os clientes,
// responder como INTREX, corrigir a classificação e encerrar.

const crypto = require('crypto');
const { Op } = require('sequelize');
const { createClient } = require('@supabase/supabase-js');

const db = require('../models');
const { logAdminAction } = require('../services/audit');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// Mesmo bucket, mesmos limites e mesmos tipos do lado do cliente: o anexo da
// Intrex vai para o mesmo lugar que o do cliente e a thread fica homogênea.
const ANEXOS_BUCKET = 'anexos';
const MAX_ANEXO_MB = Number(process.env.CHAMADO_ANEXO_MAX_MB || 10);
const MIMES_ACEITOS = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];

const STATUS = db.Chamado.STATUS; // ACAO_CLIENTE | EM_ANALISE | RESOLVIDO
const TIPOS = db.Chamado.TIPOS;

/** Converte "" e undefined em null, mantendo o texto quando existe. */
function textoOuNull(v, max) {
    if (v === undefined) return undefined;
    const s = String(v ?? '').trim();
    if (!s) return null;
    return max ? s.slice(0, max) : s;
}

function mensagemDTO(m) {
    return {
        id: m.id,
        autor: m.autor,
        texto: m.texto,
        anexo_nome: m.anexo_nome,
        tem_anexo: Boolean(m.anexo_path),
        criado_em: m.created_at ?? m.createdAt,
    };
}

function chamadoDTO(chamado, { cliente, cotacao } = {}) {
    return {
        id: chamado.id,
        cliente_id: chamado.cliente_id,
        cotacao_id: chamado.cotacao_id,
        tipo: chamado.tipo,
        titulo: chamado.titulo,
        descricao: chamado.descricao,
        acao: chamado.acao,
        status: chamado.status,
        prazo: chamado.prazo,
        origem: chamado.origem,
        criado_em: chamado.created_at ?? chamado.createdAt,
        atualizado_em: chamado.updated_at ?? chamado.updatedAt,
        resolvido_em: chamado.resolvido_em,
        cliente: cliente
            ? {
                  id: cliente.id,
                  razaoSocial: cliente.razaoSocial,
                  emailPrincipal: cliente.emailPrincipal,
              }
            : null,
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

/**
 * Fila de atendimento. GET /admin/chamados
 *
 * Ordem padrão: quem está esperando a Intrex primeiro (EM_ANALISE), depois o
 * que está com o cliente, resolvido no fim. Dentro de cada grupo, o mais antigo
 * no topo — chamado parado é o que dói.
 */
async function listar(req, res) {
    try {
        const { status, tipo, origem, cliente_id, q } = req.query || {};
        const page = Math.max(1, Number(req.query.page) || 1);
        const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));

        const where = {};
        if (status && STATUS.includes(String(status))) where.status = String(status);
        if (tipo && TIPOS.includes(String(tipo))) where.tipo = String(tipo);
        if (origem && ['AUTO', 'CLIENTE'].includes(String(origem))) where.origem = String(origem);
        if (cliente_id) where.cliente_id = Number(cliente_id);

        // Busca livre no título: é o campo que o atendente lembra.
        const busca = String(q || '').trim();
        if (busca) where.titulo = { [Op.iLike]: `%${busca}%` };

        // `abertos=1` é o filtro que a tela abre: os dois status não resolvidos.
        // Só vale se não houver filtro de status explícito, senão sobrescreveria
        // o que a pessoa escolheu.
        if (!where.status && String(req.query.abertos || '') === '1') {
            where.status = { [Op.ne]: 'RESOLVIDO' };
        }

        const { rows, count } = await db.Chamado.findAndCountAll({
            where,
            order: [
                // Postgres ordena o ENUM pela ordem de declaração
                // (ACAO_CLIENTE, EM_ANALISE, RESOLVIDO), que não é a ordem de
                // urgência. O CASE deixa explícito quem vem primeiro.
                [
                    db.sequelize.literal(
                        `CASE "Chamado"."status" WHEN 'EM_ANALISE' THEN 0 WHEN 'ACAO_CLIENTE' THEN 1 ELSE 2 END`,
                    ),
                    'ASC',
                ],
                ['created_at', 'ASC'],
            ],
            limit: pageSize,
            offset: (page - 1) * pageSize,
        });

        // Cliente e envio em duas consultas, com os ids da página — evita um
        // include com constraints:false, que o model não garante.
        const clienteIds = [...new Set(rows.map((c) => c.cliente_id).filter(Boolean))];
        const cotacaoIds = [...new Set(rows.map((c) => c.cotacao_id).filter(Boolean))];

        const [clientes, cotacoes, resumo] = await Promise.all([
            clienteIds.length
                ? db.Cliente.findAll({
                      where: { id: clienteIds },
                      attributes: ['id', 'razaoSocial', 'emailPrincipal'],
                  })
                : [],
            cotacaoIds.length
                ? db.Cotacao.findAll({
                      where: { id: cotacaoIds },
                      attributes: ['id', 'pedido_ref', 'carrier', 'tracking_number', 'pedido'],
                  })
                : [],
            // Contagem por status sobre a base inteira, não sobre a página: é o
            // número que vai nos cartões do topo da tela.
            db.Chamado.findAll({
                attributes: ['status', [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'total']],
                group: ['status'],
                raw: true,
            }),
        ]);

        const porCliente = new Map(clientes.map((c) => [c.id, c]));
        const porCotacao = new Map(cotacoes.map((c) => [c.id, c]));

        const contagem = { ACAO_CLIENTE: 0, EM_ANALISE: 0, RESOLVIDO: 0 };
        for (const r of resumo) contagem[r.status] = Number(r.total) || 0;

        return res.json({
            ok: true,
            page,
            pageSize,
            total: count,
            resumo: {
                ...contagem,
                abertos: contagem.ACAO_CLIENTE + contagem.EM_ANALISE,
                aguardando_intrex: contagem.EM_ANALISE,
            },
            chamados: rows.map((c) =>
                chamadoDTO(c, {
                    cliente: porCliente.get(c.cliente_id),
                    cotacao: porCotacao.get(c.cotacao_id),
                }),
            ),
        });
    } catch (err) {
        console.error('[ADMIN][CHAMADOS][LISTAR]', err?.message);
        return res.status(500).json({ ok: false, error: 'Falha ao carregar os chamados.' });
    }
}

/** Conversa completa. GET /admin/chamados/:id */
async function detalhe(req, res) {
    try {
        const chamado = await db.Chamado.findByPk(Number(req.params.id));
        if (!chamado) return res.status(404).json({ ok: false, error: 'Chamado não encontrado.' });

        const [mensagens, cliente, cotacao] = await Promise.all([
            db.ChamadoMensagem.findAll({
                where: { chamado_id: chamado.id },
                order: [['created_at', 'ASC']],
            }),
            db.Cliente.findByPk(chamado.cliente_id, {
                attributes: ['id', 'razaoSocial', 'emailPrincipal', 'telefoneCelular'],
            }),
            chamado.cotacao_id
                ? db.Cotacao.findByPk(chamado.cotacao_id, {
                      attributes: [
                          'id', 'pedido_ref', 'carrier', 'tracking_number',
                          'status_norm', 'tracking_raw', 'pedido',
                      ],
                  })
                : null,
        ]);

        return res.json({
            ok: true,
            chamado: chamadoDTO(chamado, { cliente, cotacao }),
            // O texto cru da transportadora fica fora do DTO do cliente, mas o
            // atendente precisa dele para conferir o que a FedEx/UPS disse.
            tracking_raw: cotacao?.tracking_raw ?? null,
            status_envio: cotacao?.status_norm ?? null,
            telefone: cliente?.telefoneCelular ?? null,
            opcoes: { status: STATUS, tipos: TIPOS },
            mensagens: mensagens.map(mensagemDTO),
        });
    } catch (err) {
        console.error('[ADMIN][CHAMADOS][DETALHE]', err?.message);
        return res.status(500).json({ ok: false, error: 'Falha ao carregar o chamado.' });
    }
}

/**
 * Resposta da Intrex. POST /admin/chamados/:id/mensagens
 *
 * `status` no corpo é opcional e é o que resolve o caso comum: responder
 * pedindo um documento devolve a bola para o cliente (ACAO_CLIENTE); responder
 * só informando mantém o chamado em análise.
 */
async function responder(req, res) {
    try {
        const chamado = await db.Chamado.findByPk(Number(req.params.id));
        if (!chamado) return res.status(404).json({ ok: false, error: 'Chamado não encontrado.' });

        const { texto, anexo, status } = req.body || {};
        const temTexto = String(texto || '').trim().length > 0;
        if (!temTexto && !anexo?.base64) {
            return res.status(400).json({ ok: false, error: 'Escreva algo ou anexe um arquivo.' });
        }

        if (status !== undefined && !STATUS.includes(String(status))) {
            return res.status(400).json({ ok: false, error: 'Status inválido.' });
        }

        let anexoPath = null;
        let anexoNome = null;
        let anexoMime = null;

        if (anexo?.base64) {
            const mime = String(anexo.mime || '').toLowerCase();
            if (!MIMES_ACEITOS.includes(mime)) {
                return res.status(415).json({ ok: false, error: 'Envie PDF, JPG ou PNG.' });
            }

            const buf = Buffer.from(String(anexo.base64).replace(/^data:.*;base64,/, ''), 'base64');
            if (buf.length > MAX_ANEXO_MB * 1024 * 1024) {
                return res
                    .status(413)
                    .json({ ok: false, error: `O arquivo passa de ${MAX_ANEXO_MB} MB.` });
            }

            const sha = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
            const ext = mime.split('/')[1].replace('jpeg', 'jpg');
            anexoPath = `chamados/${chamado.cliente_id}/${chamado.id}/${Date.now()}-${sha}.${ext}`;

            const { error } = await supabase.storage
                .from(ANEXOS_BUCKET)
                .upload(anexoPath, buf, { contentType: mime, upsert: false });

            if (error) {
                console.error('[ADMIN][CHAMADOS][ANEXO]', error.message);
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
            autor: 'INTREX',
            texto: temTexto ? String(texto).trim() : null,
            anexo_path: anexoPath,
            anexo_nome: anexoNome,
            anexo_mime: anexoMime,
        });

        const statusAnterior = chamado.status;
        if (status !== undefined && String(status) !== statusAnterior) {
            const novo = String(status);
            await chamado.update({
                status: novo,
                resolvido_em: novo === 'RESOLVIDO' ? new Date() : null,
            });
        }

        await logAdminAction({
            adminUserId: req.adminUser?.id,
            action: 'chamado.respondido',
            entityType: 'Chamado',
            entityId: chamado.id,
            clienteId: chamado.cliente_id,
            metadata: {
                mensagemId: mensagem.id,
                tem_anexo: Boolean(anexoPath),
                statusAnterior,
                statusNovo: chamado.status,
            },
            req,
        });

        return res.status(201).json({
            ok: true,
            mensagem: mensagemDTO(mensagem),
            status: chamado.status,
        });
    } catch (err) {
        console.error('[ADMIN][CHAMADOS][RESPONDER]', err?.message);
        return res.status(500).json({ ok: false, error: 'Falha ao enviar a resposta.' });
    }
}

/**
 * Corrige a classificação e o estado. PATCH /admin/chamados/:id
 *
 * A classificação automática erra: ela lê o texto da transportadora e chuta
 * tipo, título e prazo. Quem atende precisa poder arrumar sem abrir o banco.
 */
async function atualizar(req, res) {
    try {
        const chamado = await db.Chamado.findByPk(Number(req.params.id));
        if (!chamado) return res.status(404).json({ ok: false, error: 'Chamado não encontrado.' });

        const body = req.body || {};
        const patch = {};

        if (body.tipo !== undefined) {
            if (!TIPOS.includes(String(body.tipo))) {
                return res.status(400).json({ ok: false, error: 'Tipo inválido.' });
            }
            patch.tipo = String(body.tipo);
        }

        if (body.titulo !== undefined) {
            const t = textoOuNull(body.titulo, 200);
            // titulo é NOT NULL no model: apagar quebraria a linha.
            if (!t) return res.status(400).json({ ok: false, error: 'O título não pode ficar vazio.' });
            patch.titulo = t;
        }

        if (body.descricao !== undefined) patch.descricao = textoOuNull(body.descricao);
        if (body.acao !== undefined) patch.acao = textoOuNull(body.acao);

        if (body.prazo !== undefined) {
            const p = textoOuNull(body.prazo);
            if (p && !/^\d{4}-\d{2}-\d{2}$/.test(p)) {
                return res.status(400).json({ ok: false, error: 'Prazo deve ser AAAA-MM-DD.' });
            }
            patch.prazo = p;
        }

        if (body.status !== undefined) {
            if (!STATUS.includes(String(body.status))) {
                return res.status(400).json({ ok: false, error: 'Status inválido.' });
            }
            patch.status = String(body.status);
            // Reabrir tem que limpar a data, senão o chamado volta para a fila
            // carregando um "resolvido em" que não vale mais.
            patch.resolvido_em = patch.status === 'RESOLVIDO' ? new Date() : null;
        }

        if (!Object.keys(patch).length) {
            return res.status(400).json({ ok: false, error: 'Nada para alterar.' });
        }

        const antes = {};
        for (const campo of Object.keys(patch)) antes[campo] = chamado[campo];

        await chamado.update(patch);

        await logAdminAction({
            adminUserId: req.adminUser?.id,
            action: 'chamado.atualizado',
            entityType: 'Chamado',
            entityId: chamado.id,
            clienteId: chamado.cliente_id,
            metadata: { antes, depois: patch },
            req,
        });

        return res.json({ ok: true, chamado: chamadoDTO(chamado) });
    } catch (err) {
        console.error('[ADMIN][CHAMADOS][ATUALIZAR]', err?.message);
        return res.status(500).json({ ok: false, error: 'Falha ao atualizar o chamado.' });
    }
}

/**
 * Baixa o anexo da conversa. GET /admin/chamados/:id/mensagens/:mensagemId/anexo
 *
 * É o documento que a alfândega pediu: sem isso o atendente não consegue
 * conferir o que o cliente mandou.
 */
async function baixarAnexo(req, res) {
    try {
        const mensagem = await db.ChamadoMensagem.findOne({
            where: {
                id: Number(req.params.mensagemId),
                chamado_id: Number(req.params.id),
            },
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
        console.error('[ADMIN][CHAMADOS][ANEXO][DOWNLOAD]', err?.message);
        return res.status(500).json({ ok: false, error: 'Falha ao baixar o anexo.' });
    }
}

module.exports = { listar, detalhe, responder, atualizar, baixarAnexo };
