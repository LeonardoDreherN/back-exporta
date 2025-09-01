const db = require("../models");

const toNum = (v) => {
    if (v === undefined || v === null || v === "") return undefined;
    const n = Number(String(v).replace(",", "."));
    return Number.isFinite(n) ? n : undefined;
};

const isPosNumber = (n) => Number.isFinite(n) && n > 0;
// Se já tiver essas constantes, pode remover as defaults abaixo
const MAX_DIM = global.MAX_DIM ?? 999999;
const MAX_PESO_NUMERIC = global.MAX_PESO_NUMERIC ?? 9999999.999;

const registrarProduto = async (req, res) => {
    const clienteId =
        req.clienteId ??
        req.userId ??
        req.user?.id ??
        req.usuario?.id ??
        req.cliente?.id ??
        null;
    if (!clienteId) return res.status(401).json({ erro: 'Cliente não autenticado' });
    try {


        const b = req.body || {};

        const sku = (b.sku || '').trim();
        const nome = (b.nome || '').trim();
        const descricao = (b.descricao || '').trim();
        const pais_origem = (b.pais_origem || '').trim();
        const categoria = (b.categoria || '').trim();
        const hscode = (b.hscode || '').trim();

        // normaliza números
        const altura = Number(b.altura);
        const largura = Number(b.largura);
        const profundidade = Number(b.profundidade);
        const peso = Number(b.peso);

        // normaliza código da caixa (aceita vários nomes, remove espaços)
        const rawCod =
            b.cod_identificacao ??
            b.caixa_codigo ??
            b.codigo_caixa ??
            b.caixaCodigo ??
            b.cod_caixa ??
            null;
        const cod_identificacao = typeof rawCod === 'string' && rawCod.trim() !== '' ? rawCod.trim() : null;

        const payloadPreview = {
            sku,
            nome,
            descricao,
            pais_origem,
            categoria,
            hscode,
            altura,
            largura,
            profundidade,
            peso,
            cod_identificacao
        };

        // obrigatórios
        const obrigatorios = ['sku', 'nome', 'descricao', 'pais_origem', 'categoria', 'hscode', 'altura', 'largura', 'profundidade', 'peso', 'cod_identificacao'];
        const faltando = obrigatorios.filter(k => payloadPreview[k] === undefined || payloadPreview[k] === null || payloadPreview[k] === '');
        if (faltando.length) {
            return res.status(400).json({ erro: 'Campos obrigatórios faltando', campos: faltando });
        }

        // validações numéricas
        if (![altura, largura, profundidade, peso].every(isPosNumber)) {
            return res.status(400).json({ erro: 'Dimensões e peso devem ser números positivos' });
        }
        if (altura > MAX_DIM || largura > MAX_DIM || profundidade > MAX_DIM) {
            return res.status(400).json({ erro: `Dimensões inválidas (0 < valor ≤ ${MAX_DIM} cm)` });
        }
        if (peso >= MAX_PESO_NUMERIC) {
            return res.status(400).json({ erro: 'Peso inválido (máx. 9.999.999,999 kg)' });
        }

        // valida cliente (se vier)
        const caixa = await db.Caixa.findOne({
            where: { id_cliente: clienteId, cod_identificacao }
        });
        if (!caixa) {
            return res.status(400).json({
                erro: 'cod_identificacao inválido (não existe em Caixas para este cliente)'
            });
        }

        const payload = {
            sku,
            nome,
            descricao,
            pais_origem,
            categoria,
            hscode,
            altura,
            largura,
            profundidade,
            peso,
            cod_identificacao,
            id_cliente: clienteId
        };

        const novo = await db.Produto.create(payload);

        // retorno 100% do que ficou salvo
        return res.status(201).json({
            mensagem: 'Produto registrado com sucesso',
            produto: novo.toJSON()
        });

    } catch (err) {
        console.error('❌ Erro ao registrar produto:', err);
        return res.status(500).json({ erro: 'Erro interno ao registrar produto', detalhes: err.message });
    }
};

const verProdutos = async (req, res) => {

    try {

        const clienteId =
            req.clienteId ??
            req.userId ??
            req.user?.id ??
            req.usuario?.id ??
            req.cliente?.id ??
            req.decoded?.clienteId ??   // caso seu middleware ponha em req.decoded
            req.decoded?.id_cliente ??  // fallback comum
            null;

        // garanta número inteiro > 0
        const cid = Number(clienteId);
        if (!Number.isInteger(cid) || cid <= 0) {
            return res.status(401).json({ erro: "Cliente não autenticado" });
        }
        const produtos = await db.Produto.findAll({
            where: { id_cliente: cid },
            attributes: ["id", "sku", "nome", "descricao", "pais_origem", "categoria", "hscode", "altura", "largura", "profundidade", "peso", "id_cliente", "cod_identificacao"],
            order: [["id", "DESC"]],
        });

        res.json(produtos);
    } catch (err) {
        res.status(500).json({
            erro: "Erro ao ver produtos",
            detalhes: err.message,
        });
    }
};

const excluirProduto = async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
            return res.status(400).json({ erro: "ID inválido" });
        }

        // garanta que o produto pertence ao cliente autenticado
        const produto = await db.Produto.findOne({
            where: { id },
        });
        if (!produto) {
            // pode retornar 404 para “não existe/ não pertence”
            return res.status(404).json({ erro: "Produto não encontrado" });
        }

        await produto.destroy();

        return res.status(200).json({ mensagem: "Produto excluído com sucesso", id: produto.id });
    } catch (err) {
        console.error("❌ excluirProduto:", err);
        return res.status(500).json({ erro: "Erro ao excluir produto", detalhes: err.message });
    }
};

const editarProduto = async (req, res) => {
    try {
        const clienteId =
            req.clienteId ?? req.userId ?? req.user?.id ?? req.usuario?.id ?? req.cliente?.id ?? null;

        if (!clienteId) return res.status(401).json({ erro: "Cliente não autenticado" });

        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ erro: "ID inválido" });
        }

        const b = req.body || {};
        const changes = {};

        // strings (apenas se vierem)
        if (b.sku != null) changes.sku = String(b.sku).trim();
        if (b.nome != null) changes.nome = String(b.nome).trim();
        if (b.descricao != null) changes.descricao = String(b.descricao).trim();
        if (b.pais_origem != null) changes.pais_origem = String(b.pais_origem).trim();
        if (b.categoria != null) changes.categoria = String(b.categoria).trim();
        if (b.hscode != null) changes.hscode = String(b.hscode).trim();

        // números (apenas se vierem válidos)
        const altura = toNum(b.altura);
        const largura = toNum(b.largura);
        const profundidade = toNum(b.profundidade);
        const peso = toNum(b.peso);
        if (altura !== undefined) changes.altura = altura;
        if (largura !== undefined) changes.largura = largura;
        if (profundidade !== undefined) changes.profundidade = profundidade;
        if (peso !== undefined) changes.peso = peso;

        // cod_identificacao (se vier, valida na Caixas do MESMO cliente)
        if (b.cod_identificacao != null) {
            const cod = String(b.cod_identificacao).trim();
            if (!cod) return res.status(400).json({ erro: "cod_identificacao inválido" });

            const caixa = await db.Caixa.findOne({
                where: { id_cliente: clienteId, cod_identificacao: cod },
            });
            if (!caixa) {
                return res.status(400).json({ erro: "cod_identificacao não encontrado para este cliente" });
            }
            changes.cod_identificacao = cod;
        }

        // nada para atualizar?
        if (Object.keys(changes).length === 0) {
            return res.status(400).json({ erro: "Nenhuma alteração informada" });
        }

        // checagens de duplicidade se sku/nome foram enviados
        if (changes.sku) {
            const exists = await db.Produto.count({
                where: { id_cliente: clienteId, sku: changes.sku, id: { [db.Sequelize.Op.ne]: id } },
            });
            if (exists) return res.status(409).json({ erro: "SKU já em uso para este cliente." });
        }
        if (changes.nome) {
            const exists = await db.Produto.count({
                where: { id_cliente: clienteId, nome: changes.nome, id: { [db.Sequelize.Op.ne]: id } },
            });
            if (exists) return res.status(409).json({ erro: "Nome de produto já em uso para este cliente." });
        }

        // UPDATE com filtro por id e cliente
        const [affected, rows] = await db.Produto.update(changes, {
            where: { id, id_cliente: clienteId },
            returning: true, // Postgres
        });

        if (affected === 0) {
            return res.status(404).json({ erro: "Produto não encontrado" });
        }

        // devolve o registro atualizado
        const produto = (rows?.[0] ? rows[0].toJSON?.() || rows[0] : null);
        return res.json({ mensagem: "Produto editado com sucesso", produto });

    } catch (err) {
        if (err?.original?.code === "23505") {
            const c = err?.original?.constraint || "";
            if (c.includes("produtos_cliente_sku_uq"))
                return res.status(409).json({ erro: "SKU já em uso para este cliente." });
            if (c.includes("produtos_cliente_nome_uq"))
                return res.status(409).json({ erro: "Nome de produto já em uso para este cliente." });
            return res.status(409).json({ erro: "Registro duplicado." });
        }
        console.error("❌ editarProduto:", err);
        return res.status(500).json({ erro: "Erro interno ao editar produto", detalhes: err.message });
    }
};


module.exports = { verProdutos, registrarProduto, excluirProduto, editarProduto };