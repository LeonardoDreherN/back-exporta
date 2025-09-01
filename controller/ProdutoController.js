const db = require("../models");

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
        if (!req.clienteId) return res.status(401).json({ erro: "Não autenticado" });

        // aceita id no params ou no body
        const id = Number(req.params.id ?? req.body.id);
        if (!Number.isFinite(id)) {
            return res.status(400).json({ erro: "ID inválido" });
        }

        // busca garantindo propriedade
        const produto = await db.Produto.findOne({ where: { id, id_cliente: req.clienteId } });
        if (!produto) return res.status(404).json({ erro: "Produto não encontrado" });

        // campos opcionais: só atualiza o que veio
        const {
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
        } = req.body;

        const updateData = {};

        if (typeof cod_identificacao === "string" && cod_identificacao.trim()) {
            updateData.cod_identificacao = cod_identificacao.trim();
        }
        if (typeof descricao === "string" && descricao.trim()) {
            updateData.descricao = descricao.trim();
        }

        const a = altura !== undefined ? Number(altura) : undefined;
        const l = largura !== undefined ? Number(largura) : undefined;
        const p = profundidade !== undefined ? Number(profundidade) : undefined;
        const kg = peso !== undefined ? Number(peso) : undefined;

        if (altura !== undefined) {
            const a = Number(altura);
            if (!isPosNumber(a) || a > MAX_DIM) {
                return res.status(400).json({ erro: `Altura inválida (0 < altura ≤ ${MAX_DIM} cm)` });
            }
            updateData.altura = a;
        }
        if (largura !== undefined) {
            const l = Number(largura);
            if (!isPosNumber(l) || l > MAX_DIM) {
                return res.status(400).json({ erro: `Largura inválida (0 < largura ≤ ${MAX_DIM} cm)` });
            }
            updateData.largura = l;
        }
        if (profundidade !== undefined) {
            const p = Number(profundidade);
            if (!isPosNumber(p) || p > MAX_DIM) {
                return res.status(400).json({ erro: `Profundidade inválida (0 < profundidade ≤ ${MAX_DIM} cm)` });
            }
            updateData.profundidade = p;
        }
        if (peso !== undefined) {
            const kg = Number(peso);
            if (!isPosNumber(kg) || kg >= 10000000) {
                return res.status(400).json({ erro: "Peso inválido (máx. 9.999.999,999 kg)" });
            }
            updateData.peso = kg;
        }

        await produto.update(updateData);
        return res.status(200).json({ mensagem: "Produto editado com sucesso", produto });
    } catch (err) {
        console.error("❌ editarProduto:", err);
        return res.status(500).json({ erro: "Erro ao editar produto", detalhes: err.message });
    }
};

module.exports = { verProdutos, registrarProduto, excluirProduto, editarProduto };