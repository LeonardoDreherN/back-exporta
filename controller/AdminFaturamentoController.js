// controller/AdminFaturamentoController.js
//
// Cadastro do valor de faturamento por SKU e da configuracao de imposto no
// checkout, por cliente.
//
// O valor aqui decide a base do imposto de todo pedido daquele SKU. Errar um
// numero na planilha nao aparece na hora: aparece semanas depois, na fatura
// da transportadora. Por isso o import e transacional (ou entra tudo, ou nao
// entra nada) e devolve a lista de linhas recusadas em vez de aceitar o que
// deu para aproveitar.

const db = require('../models');
const { lerPlanilha } = require('../services/faturamentoDeclarado/importador');
const { baseDeclarada, ajusteDePreco } = require('../services/faturamentoDeclarado');
const { calcularPeloRegime } = require('../services/regimeImportacao/calculoDireto');
const { logAdminAction } = require('../services/audit');

function quemEstaLogado(req) {
    return req.admin?.email || req.admin?.nome || req.adminUser?.email || 'admin';
}

/** GET /api/admin/faturamento/:clienteId — config + SKUs cadastrados. */
async function listar(req, res) {
    try {
        const clienteId = Number(req.params.clienteId);
        if (!Number.isInteger(clienteId)) {
            return res.status(400).json({ ok: false, error: 'clienteId invalido.' });
        }

        const cliente = await db.Cliente.findByPk(clienteId, {
            attributes: [
                'id', 'razaoSocial', 'codigo', 'impostoPctVisivel',
                'faturamentoFatorPadrao', 'impostoCheckoutAtivo', 'impostoCheckoutAtivadoEm',
            ],
        });
        if (!cliente) return res.status(404).json({ ok: false, error: 'Cliente nao encontrado.' });

        const skus = await db.FaturamentoSku.findAll({
            where: { cliente_id: clienteId },
            order: [['sku', 'ASC']],
        });

        return res.json({
            ok: true,
            cliente: {
                id: cliente.id,
                razaoSocial: cliente.razaoSocial,
                codigo: cliente.codigo,
                impostoPctVisivel: cliente.impostoPctVisivel,
                faturamentoFatorPadrao: cliente.faturamentoFatorPadrao,
                impostoCheckoutAtivo: cliente.impostoCheckoutAtivo,
                impostoCheckoutAtivadoEm: cliente.impostoCheckoutAtivadoEm,
            },
            skus: skus.map((s) => ({
                id: s.id,
                sku: s.sku,
                descricao: s.descricao,
                valor_faturado_usd: Number(s.valor_faturado_usd),
                ativo: s.ativo,
            })),
            total: skus.length,
        });
    } catch (err) {
        console.error('[ADMIN FATURAMENTO] listar:', err);
        return res.status(500).json({ ok: false, error: 'Falha ao listar.' });
    }
}

/**
 * PUT /api/admin/faturamento/:clienteId/config
 * body: { impostoPctVisivel, faturamentoFatorPadrao }
 */
async function salvarConfig(req, res) {
    try {
        const clienteId = Number(req.params.clienteId);
        const cliente = await db.Cliente.findByPk(clienteId);
        if (!cliente) return res.status(404).json({ ok: false, error: 'Cliente nao encontrado.' });

        const patch = {};

        if (req.body?.impostoPctVisivel !== undefined) {
            const pct = Number(req.body.impostoPctVisivel);
            if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
                return res.status(400).json({
                    ok: false,
                    error: 'impostoPctVisivel tem que ser um numero de 0 a 100.',
                });
            }
            patch.impostoPctVisivel = Math.round(pct);
        }

        if (req.body?.faturamentoFatorPadrao !== undefined) {
            const bruto = req.body.faturamentoFatorPadrao;

            if (bruto === null || bruto === '') {
                patch.faturamentoFatorPadrao = null;
            } else {
                const f = Number(bruto);
                // Fator e fracao da vitrine: 0,28 = fatura a 28%. Acima de 1
                // seria declarar MAIS do que o preco de venda, o que nao e o
                // caso de uso e quase certamente erro de digitacao (28 em vez
                // de 0,28).
                if (!Number.isFinite(f) || f <= 0 || f > 1) {
                    return res.status(400).json({
                        ok: false,
                        error: 'faturamentoFatorPadrao tem que estar entre 0 e 1 (0,28 = 28% da vitrine).',
                    });
                }
                patch.faturamentoFatorPadrao = f;
            }
        }

        if (!Object.keys(patch).length) {
            return res.status(400).json({ ok: false, error: 'Nada para alterar.' });
        }

        const antes = {
            impostoPctVisivel: cliente.impostoPctVisivel,
            faturamentoFatorPadrao: cliente.faturamentoFatorPadrao,
        };

        await cliente.update(patch);

        await logAdminAction({
            adminUserId: req.adminUser?.id,
            req,
            action: 'FATURAMENTO_CONFIG',
            entityType: 'cliente',
            entityId: clienteId,
            clienteId,
            metadata: { antes, depois: patch, por: quemEstaLogado(req) },
        });

        return res.json({ ok: true, config: patch });
    } catch (err) {
        console.error('[ADMIN FATURAMENTO] salvarConfig:', err);
        return res.status(500).json({ ok: false, error: 'Falha ao salvar.' });
    }
}

/**
 * POST /api/admin/faturamento/:clienteId/importar
 * body: { csv: "<conteudo>", substituirTudo?: boolean }
 *
 * Transacional de proposito: uma planilha meio aplicada deixa o cliente com
 * parte dos precos novos e parte dos velhos, sem ninguem saber onde foi que
 * parou.
 */
async function importar(req, res) {
    const t = await db.sequelize.transaction();
    try {
        const clienteId = Number(req.params.clienteId);
        const cliente = await db.Cliente.findByPk(clienteId, { transaction: t });
        if (!cliente) {
            await t.rollback();
            return res.status(404).json({ ok: false, error: 'Cliente nao encontrado.' });
        }

        const csv = req.body?.csv;
        if (!csv || typeof csv !== 'string') {
            await t.rollback();
            return res.status(400).json({ ok: false, error: 'Mande o conteudo do CSV em "csv".' });
        }

        const { linhas, erros, colunasEncontradas } = lerPlanilha(csv);

        // Erro de cabecalho: nem adianta olhar as linhas.
        if (!linhas.length && erros.length) {
            await t.rollback();
            return res.status(400).json({
                ok: false,
                error: 'Nenhuma linha aproveitavel.',
                erros,
                colunasEncontradas,
            });
        }

        if (req.body?.substituirTudo === true) {
            await db.FaturamentoSku.destroy({ where: { cliente_id: clienteId }, transaction: t });
        }

        let criados = 0;
        let atualizados = 0;

        for (const l of linhas) {
            const [, novo] = await db.FaturamentoSku.findOrCreate({
                where: { cliente_id: clienteId, sku: l.sku },
                defaults: {
                    cliente_id: clienteId,
                    sku: l.sku,
                    descricao: l.descricao,
                    valor_faturado_usd: l.valor_faturado_usd,
                    ativo: true,
                },
                transaction: t,
            });

            if (novo) {
                criados++;
            } else {
                await db.FaturamentoSku.update(
                    {
                        valor_faturado_usd: l.valor_faturado_usd,
                        ...(l.descricao ? { descricao: l.descricao } : {}),
                        ativo: true,
                    },
                    { where: { cliente_id: clienteId, sku: l.sku }, transaction: t },
                );
                atualizados++;
            }
        }

        await t.commit();

        await logAdminAction({
            adminUserId: req.adminUser?.id,
            req,
            action: 'FATURAMENTO_IMPORTAR',
            entityType: 'cliente',
            entityId: clienteId,
            clienteId,
            metadata: {
                criados,
                atualizados,
                recusadas: erros.length,
                substituiuTudo: req.body?.substituirTudo === true,
                por: quemEstaLogado(req),
            },
        });

        return res.json({
            ok: true,
            criados,
            atualizados,
            aceitas: linhas.length,
            recusadas: erros.length,
            erros,
            colunasEncontradas,
        });
    } catch (err) {
        await t.rollback().catch(() => {});
        console.error('[ADMIN FATURAMENTO] importar:', err);
        return res.status(500).json({ ok: false, error: 'Falha ao importar.' });
    }
}

/** DELETE /api/admin/faturamento/:clienteId/sku/:id */
async function remover(req, res) {
    try {
        const clienteId = Number(req.params.clienteId);
        const id = Number(req.params.id);

        const n = await db.FaturamentoSku.destroy({ where: { id, cliente_id: clienteId } });
        if (!n) return res.status(404).json({ ok: false, error: 'SKU nao encontrado.' });

        await logAdminAction({
            adminUserId: req.adminUser?.id,
            req,
            action: 'FATURAMENTO_REMOVER',
            entityType: 'cliente',
            entityId: clienteId,
            clienteId,
            metadata: { id, por: quemEstaLogado(req) },
        });

        return res.json({ ok: true });
    } catch (err) {
        console.error('[ADMIN FATURAMENTO] remover:', err);
        return res.status(500).json({ ok: false, error: 'Falha ao remover.' });
    }
}

/**
 * GET /api/admin/faturamento/:clienteId/ajuste?pais=US&mfn=16.5&venda=145
 *
 * O numero que o lojista digita no price adjustment do mercado.
 */
async function ajusteMercado(req, res) {
    try {
        const clienteId = Number(req.params.clienteId);
        const cliente = await db.Cliente.findByPk(clienteId, {
            attributes: ['id', 'impostoPctVisivel', 'faturamentoFatorPadrao'],
        });
        if (!cliente) return res.status(404).json({ ok: false, error: 'Cliente nao encontrado.' });

        const pais = String(req.query.pais || 'US').toUpperCase();
        const venda = Number(req.query.venda) || 145;
        const mfn = req.query.mfn !== undefined ? Number(req.query.mfn) : null;
        const frete = Number(req.query.frete) || 25;

        const regime = await db.RegimeImportacao.findOne({
            where: { pais_destino: pais, status: 'aprovado' },
            order: [['createdAt', 'DESC']],
        });
        if (!regime) {
            return res.status(404).json({
                ok: false,
                error: `Nenhum regime aprovado para ${pais}.`,
            });
        }

        const r = regime.toJSON();
        const temVariavel = (Array.isArray(r.medidas) ? r.medidas : [])
            .some((m) => Number(m.aliquota_pct) === -1);

        if (temVariavel && mfn === null) {
            // Devolver um numero aqui seria pior do que nao devolver: ele
            // entraria no price adjustment como se fosse o imposto inteiro.
            return res.status(422).json({
                ok: false,
                error: `O regime de ${pais} tem medida que depende do NCM. `
                    + 'Informe a aliquota do produto em "mfn" para fechar a conta.',
                medidas: r.medidas,
            });
        }

        if (temVariavel) {
            r.medidas = r.medidas.map((m) => (
                Number(m.aliquota_pct) === -1 ? { ...m, aliquota_pct: mfn } : m
            ));
        }

        const fator = Number(cliente.faturamentoFatorPadrao);
        const base = Number.isFinite(fator) && fator > 0 ? venda * fator : venda;

        const calculo = calcularPeloRegime({ regime: r, valorUsd: base, freteUsd: frete });
        const ajuste = ajusteDePreco({
            calculo,
            baseDeclaradaUsd: base,
            vendaUsd: venda,
            pctVisivel: cliente.impostoPctVisivel,
        });

        return res.json({
            ok: true,
            pais,
            regime_id: r.id,
            referencia: { vendaUsd: venda, baseDeclaradaUsd: Number(base.toFixed(2)), freteUsd: frete },
            imposto: calculo,
            ajuste,
        });
    } catch (err) {
        console.error('[ADMIN FATURAMENTO] ajusteMercado:', err);
        return res.status(500).json({ ok: false, error: 'Falha ao calcular.' });
    }
}

/**
 * POST /api/admin/faturamento/:clienteId/simular
 * body: { itens: [{ sku, precoUnitarioUsd, quantidade }], pais, mfn?, frete? }
 *
 * Mostra o que o comprador veria. Serve para conferir um cadastro antes de
 * ligar no checkout de verdade.
 */
async function simular(req, res) {
    try {
        const clienteId = Number(req.params.clienteId);
        const cliente = await db.Cliente.findByPk(clienteId, {
            attributes: ['id', 'impostoPctVisivel', 'faturamentoFatorPadrao'],
        });
        if (!cliente) return res.status(404).json({ ok: false, error: 'Cliente nao encontrado.' });

        const itens = Array.isArray(req.body?.itens) ? req.body.itens : [];
        if (!itens.length) {
            return res.status(400).json({ ok: false, error: 'Mande "itens".' });
        }

        const registros = await db.FaturamentoSku.findAll({
            where: { cliente_id: clienteId, ativo: true },
        });
        const tabela = new Map(
            registros.map((x) => [x.sku, Number(x.valor_faturado_usd)]),
        );

        const fator = Number(cliente.faturamentoFatorPadrao);
        const base = baseDeclarada({
            itens,
            tabela,
            fatorPadrao: Number.isFinite(fator) ? fator : null,
        });

        const pais = String(req.body?.pais || 'US').toUpperCase();
        const frete = Number(req.body?.frete) || 25;
        const mfn = req.body?.mfn !== undefined ? Number(req.body.mfn) : null;

        const regime = await db.RegimeImportacao.findOne({
            where: { pais_destino: pais, status: 'aprovado' },
            order: [['createdAt', 'DESC']],
        });
        if (!regime) {
            return res.status(404).json({ ok: false, error: `Sem regime aprovado para ${pais}.` });
        }

        const r = regime.toJSON();
        const temVariavel = (Array.isArray(r.medidas) ? r.medidas : [])
            .some((m) => Number(m.aliquota_pct) === -1);

        if (temVariavel && mfn === null) {
            return res.status(422).json({
                ok: false,
                error: `O regime de ${pais} depende do NCM. Informe "mfn".`,
                base_declarada: base,
            });
        }
        if (temVariavel) {
            r.medidas = r.medidas.map((m) => (
                Number(m.aliquota_pct) === -1 ? { ...m, aliquota_pct: mfn } : m
            ));
        }

        const calculo = calcularPeloRegime({ regime: r, valorUsd: base.baseUsd, freteUsd: frete });
        const ajuste = ajusteDePreco({
            calculo,
            baseDeclaradaUsd: base.baseUsd,
            vendaUsd: base.vendaUsd,
            pctVisivel: cliente.impostoPctVisivel,
        });

        return res.json({
            ok: true,
            pais,
            base_declarada: base,
            imposto: calculo,
            ajuste,
            checkout: {
                freteUsd: frete,
                impostoVisivelUsd: ajuste?.visivelUsd ?? 0,
                linhaShippingUsd: Number((frete + (ajuste?.visivelUsd ?? 0)).toFixed(2)),
            },
        });
    } catch (err) {
        console.error('[ADMIN FATURAMENTO] simular:', err);
        return res.status(500).json({ ok: false, error: 'Falha ao simular.' });
    }
}

/**
 * POST /api/admin/faturamento/:clienteId/ativar
 * body: { ativo: boolean }
 *
 * Ligar sem SKU cadastrado faria o calculo cair no preco de venda e cobrar
 * varias vezes o imposto real, entao a API recusa — e o motivo volta escrito
 * para a tela mostrar.
 */
async function ativar(req, res) {
    try {
        const clienteId = Number(req.params.clienteId);
        const cliente = await db.Cliente.findByPk(clienteId);
        if (!cliente) return res.status(404).json({ ok: false, error: 'Cliente nao encontrado.' });

        const ativo = req.body?.ativo === true;

        if (ativo) {
            const n = await db.FaturamentoSku.count({
                where: { cliente_id: clienteId, ativo: true },
            });
            const temFator = Number(cliente.faturamentoFatorPadrao) > 0;

            if (!n && !temFator) {
                return res.status(409).json({
                    ok: false,
                    error: 'Esta loja nao tem nenhum SKU com valor faturado, nem fator padrao. '
                        + 'Sem isso o imposto seria calculado sobre o preco de venda e sairia '
                        + 'varias vezes maior que o real. Suba a planilha ou defina o fator antes.',
                    skus_cadastrados: 0,
                });
            }
        }

        await cliente.update({
            impostoCheckoutAtivo: ativo,
            impostoCheckoutAtivadoEm: ativo ? new Date() : null,
        });

        await logAdminAction({
            adminUserId: req.adminUser?.id,
            req,
            action: ativo ? 'IMPOSTO_CHECKOUT_ATIVADO' : 'IMPOSTO_CHECKOUT_DESATIVADO',
            entityType: 'cliente',
            entityId: clienteId,
            clienteId,
            metadata: { por: quemEstaLogado(req) },
        });

        return res.json({ ok: true, ativo });
    } catch (err) {
        console.error('[ADMIN FATURAMENTO] ativar:', err);
        return res.status(500).json({ ok: false, error: 'Falha ao alterar.' });
    }
}

/** GET /api/admin/faturamento — panorama das lojas Shopify. */
async function panorama(_req, res) {
    try {
        const linhas = await db.sequelize.query(
            `
            SELECT cl.id, cl."razaoSocial" AS nome, cl.codigo,
                   cl."impostoCheckoutAtivo" AS ativo,
                   cl."impostoPctVisivel"    AS pct_visivel,
                   cl."faturamentoFatorPadrao" AS fator,
                   COUNT(f.id)::int AS skus,
                   COUNT(s."shopDomain")::int AS lojas
            FROM "Clientes" cl
            LEFT JOIN faturamento_skus f ON f.cliente_id = cl.id AND f.ativo = true
            LEFT JOIN "InfoShopifies" s ON s.id_cliente = cl.id
            GROUP BY cl.id, cl."razaoSocial", cl.codigo, cl."impostoCheckoutAtivo",
                     cl."impostoPctVisivel", cl."faturamentoFatorPadrao"
            HAVING COUNT(s."shopDomain") > 0
            ORDER BY cl."razaoSocial"
            `,
            { type: require('sequelize').QueryTypes.SELECT },
        );

        return res.json({
            ok: true,
            lojas: linhas.map((l) => ({
                id: l.id,
                nome: l.nome,
                codigo: l.codigo,
                ativo: l.ativo,
                pctVisivel: l.pct_visivel,
                fatorPadrao: l.fator === null ? null : Number(l.fator),
                skus: l.skus,
                // Ligar sem cadastro cobraria sobre o preco de venda.
                podeAtivar: l.skus > 0 || Number(l.fator) > 0,
            })),
        });
    } catch (err) {
        console.error('[ADMIN FATURAMENTO] panorama:', err);
        return res.status(500).json({ ok: false, error: 'Falha ao carregar.' });
    }
}

module.exports = {
    listar, salvarConfig, importar, remover, ajusteMercado, simular, ativar, panorama,
};
