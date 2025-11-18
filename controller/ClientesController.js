
const Cliente = require("../models/index.js");
const db = require("../models/index.js");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { validateCNPJ, onlyDigits } = require("../utils/cnpj.js");
const { UniqueConstraintError, ValidationError, Op } = require("sequelize");
const { validateCNAE } = require("../utils/cnae.js");
const { validateEmailFormat } = require("../utils/email.js");
require('dotenv').config()

async function gerarCodigoUnico() {
    // ajuste seu prefixo/regra
    let tentativas = 0;
    while (tentativas < 5) {
        const codigo = "CLI-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
        const jaExiste = await db.Cliente.findOne({ where: { codigo } });
        if (!jaExiste) return codigo;
        tentativas++;
    }
    throw new Error("Não foi possível gerar código único");
}

const registrarCliente = async (req, res) => {
    const t = await db.sequelize.transaction(); // <<< transação
    try {
        const b = req.body || {};

        // 1) Validação mínima de campos obrigatórios
        const required = [
            "emailPrincipal", "senha", "tipoConta", "emailAssociado", "razaoSocial",
            "enderecoPais", "enderecoCEP", "enderecoRua", "enderecoNumero",
            "enderecoCidade", "enderecoEstado", "cnpj", "cnaePrincipal", "telefoneCelular", "plano"
        ];
        const missing = required.filter(k => !b[k] && b[k] !== 0);
        if (missing.length) {
            await t.rollback();
            return res.status(400).json({ erro: `Campos obrigatórios ausentes: ${missing.join(", ")}` });
        }

        const e1 = validateEmailFormat ? validateEmailFormat(b.emailPrincipal) : { valid: true };
        const e2 = validateEmailFormat ? validateEmailFormat(b.emailAssociado) : { valid: true };
        if (!e1.valid) { await t.rollback(); return res.status(400).json({ erro: "E-mail principal inválido (formato)." }); }
        if (!e2.valid) { await t.rollback(); return res.status(400).json({ erro: "E-mail associado inválido (formato)." }); }

        if (!["empresa", "parceiro"].includes(b.tipoConta)) {
            await t.rollback();
            return res.status(400).json({ erro: "tipoConta inválido. Use 'empresa' ou 'parceiro'." });
        }

        const cleanCnpj = onlyDigits(b.cnpj);
        const cnpjRes = await validateCNPJ(cleanCnpj, { online: undefined }); // <<< sem internet
        if (!cnpjRes.valid) {
            await t.rollback();
            return res.status(400).json({ erro: "CNPJ inválido (dígitos verificadores)." });
        }

        const cleanCnae = String(b.cnaePrincipal || "").replace(/\D/g, "");
        if (!(cleanCnae.length === 5 || cleanCnae.length === 7)) {
            await t.rollback();
            return res.status(400).json({ erro: "CNAE deve ter 5 (classe) ou 7 dígitos (subclasse)." });
        }

        const cnaeRes = await validateCNAE(cleanCnae);
        console.log("[DEBUG CNAE]", cnaeRes); // <-- log temporário para ver o que vem

        if (cnaeRes.valid !== true) {
            await t.rollback();
            return res.status(400).json({ erro: "CNAE inválido (formato)." });
        }
        if (cnaeRes.exists === false) {
            await t.rollback();
            return res.status(400).json({ erro: "CNAE não encontrado no IBGE." });
        }

        // 2) Checagens de unicidade ANTES de criar
        const [emailJa, cnpjJa, codigoJa] = await Promise.all([
            db.Cliente.findOne({ where: { emailPrincipal: b.emailPrincipal }, transaction: t }),
            db.Cliente.findOne({ where: { cnpj: b.cnpj }, transaction: t }),
            b.codigo ? db.Cliente.findOne({ where: { codigo: b.codigo }, transaction: t }) : Promise.resolve(null),
        ]);

        if (emailJa) { await t.rollback(); return res.status(409).json({ erro: "E-mail já cadastrado." }); }
        if (cnpjJa) { await t.rollback(); return res.status(409).json({ erro: "CNPJ já cadastrado." }); }

        // 3) Gera/valida 'codigo' no backend para evitar colisões
        let codigoFinal = b.codigo;
        if (!codigoFinal || codigoJa) {
            codigoFinal = await gerarCodigoUnico();
        }

        // 4) Hash da senha
        const senhaHash = await bcrypt.hash(b.senha, 10);

        // 5) Whitelist: apenas os campos do model
        const dadosCliente = {
            emailPrincipal: b.emailPrincipal,
            senha: senhaHash,
            tipoConta: b.tipoConta,
            emailAssociado: b.emailAssociado,
            codigo: codigoFinal,
            razaoSocial: b.razaoSocial,
            enderecoPais: b.enderecoPais,
            enderecoCEP: b.enderecoCEP,
            enderecoRua: b.enderecoRua,
            enderecoNumero: b.enderecoNumero,
            enderecoComplemento: b.enderecoComplemento || null,
            enderecoCidade: b.enderecoCidade,
            enderecoEstado: b.enderecoEstado,
            cnpj: b.cnpj,
            cnaePrincipal: b.cnaePrincipal,
            telefoneCelular: b.telefoneCelular,
            plano: b.plano
        };


        // 6) Cria dentro da transação
        const novoCliente = await db.Cliente.create(dadosCliente, { transaction: t });

        // 7) Commit só após tudo OK
        await t.commit();

        return res.status(201).json({
            mensagem: "Cliente registrado com sucesso",
            cliente: {
                id: novoCliente.id,
                cnpj: novoCliente.cnpj,
                emailPrincipal: novoCliente.emailPrincipal,
            }
        });
    } catch (err) {
        // Rollback garante que nada fique salvo se deu erro depois do create
        try { await t.rollback(); } catch { }
        console.error("❌ Erro ao registrar cliente:", err);

        if (err instanceof UniqueConstraintError) {
            const campos = Object.keys(err.fields || {});
            return res.status(409).json({ erro: `Violação de unicidade${campos.length ? " em: " + campos.join(", ") : ""}` });
        }
        if (err instanceof ValidationError) {
            return res.status(400).json({ erro: err.message + "###########" });
        }
        return res.status(500).json({ erro: "Erro interno ao registrar cliente", detalhes: err.message });
    }
};

const verClientes = async (req, res) => {
    try {
        const clientes = await db.Cliente.findAll({
            attributes: ["id", "cnpj", "emailPrincipal", "enderecoRua"] // 🚫 não retorna senha
        });

        res.json(clientes);
    } catch (err) {
        res.status(500).json({
            erro: "Erro ao ver clientes",
            detalhes: err.message,
        });
    }
};

const ACCESS_TOKEN = 15 * 60
const REFRESH_TOKEN = 7 * 24 * 60 * 60

const jwt_secret = process.env.JWT_SECRET
const jwt_refresh = process.env.JWT_REFRESH_SECRET

function signAccess(payload) {
    return jwt.sign(payload, jwt_secret, { expiresIn: ACCESS_TOKEN });
}
function signRefresh(payload) {
    // jti para permitir rotação/blacklist
    return jwt.sign({ jti: crypto.randomUUID(), ...payload }, jwt_refresh, { expiresIn: REFRESH_TOKEN });
}
const isProd = process.env.NODE_ENV === "production";

const cookieBase = {
    httpOnly: true,
    secure: isProd, // true em prod
    sameSite: isProd? "none" : 'lax',
    path: '/',
};


const loginCliente = async (req, res) => {
    const { emailPrincipal, senha } = req.body;

    try {
        // Busca case-insensitive (Postgres iLike). Em MySQL/MariaDB normalmente já é case-insensitive pelo collation.
        const cliente = await db.Cliente.findOne({
            where: { emailPrincipal: { [Op.iLike]: emailPrincipal } }
        });

        // DEBUG temporário (remova depois):
        console.log('[LOGIN] body.email =', emailPrincipal);
        console.log('[LOGIN] found =', !!cliente, 'dbEmail =', cliente?.emailPrincipal);
        console.log('[LOGIN] hash prefix =', cliente?.senha?.slice(0, 4)); // espera $2a/$2b

        if (!cliente) return res.status(401).json({ erro: 'Credenciais inválidas' });

        // Suporte a legado: se senha no BD não é bcrypt, aceita 1x e migra
        let ok = false;
        if (cliente.senha?.startsWith('$2')) {
            ok = await bcrypt.compare(senha, cliente.senha);
        } else {
            ok = (senha === cliente.senha);
            if (ok) {
                const novoHash = await bcrypt.hash(senha, 10);
                await cliente.update({ senha: novoHash });
                console.log('[LOGIN] senha migrada para bcrypt');
            }
        }

        if (!ok) return res.status(401).json({ erro: 'Credenciais inválidas' });

        const payload = {
            sub: cliente.id,
            id: cliente.id,
            clienteId: cliente.id,
            emailPrincipal: cliente.emailPrincipal,
            razaoSocial: cliente.razaoSocial,
            scope: ['user'],
        };

        const access = signAccess(payload);
        const refresh = signRefresh(payload);

        res.cookie('access_token', access, { ...cookieBase, maxAge: ACCESS_TOKEN * 1000 });
        res.cookie('refresh_token', refresh, { ...cookieBase, maxAge: REFRESH_TOKEN * 1000 });
        // compat com trechos legados:
        res.cookie('token', access, { ...cookieBase, maxAge: ACCESS_TOKEN * 1000 });

        const csrfToken = crypto.randomUUID();
        res.cookie('csrf_token', csrfToken, {
            httpOnly: false,
            secure: isProd,
            sameSite: isProd ? "none" : "lax",
            path: '/',
            maxAge: REFRESH_TOKEN * 1000,
        });

        return res.json({
            mensagem: 'Login bem-sucedido',
            cliente: {
                id: cliente.id,
                emailPrincipal: cliente.emailPrincipal,
                razaoSocial: cliente.razaoSocial,
            },
        });
    } catch (err) {
        console.error('Erro no login:', err);
        return res.status(500).json({ erro: 'Erro interno do servidor' });
    }
};

const verClienteAtual = async (req, res) => {
    try {
        const id =
            req.clienteId ??
            req.usuario?.clienteId ??
            req.usuario?.id ??
            req.user?.clienteId ??
            req.user?.id;

        if (!id) return res.status(401).json({ erro: "Não autenticado" });

        const cliente = await db.Cliente.findByPk(id, {
            attributes: [
                "id",
                "razaoSocial",
                "emailPrincipal",
                "telefoneCelular",
                "cnpj",
                "enderecoPais",
                "enderecoCEP",
                "enderecoRua",
                "enderecoNumero",
                "enderecoComplemento",
                "enderecoCidade",
                "enderecoEstado",
                "plano"
            ]
        });

        if (!cliente) return res.status(404).json({ erro: "Cliente não encontrado" });

        res.json(cliente);
    } catch (err) {
        console.error("Erro ao ver cliente atual:", err);
        res.status(500).json({ erro: "Erro interno do servidor", detalhes: err.message });
    }
};

module.exports = {
    registrarCliente,
    verClientes,
    loginCliente,
    verClienteAtual
};
