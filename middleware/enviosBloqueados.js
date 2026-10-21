// middleware/enviosBloqueados.js
// Barra a operação de quem está com envios bloqueados pelo admin.
//
// É diferente de `Cliente.status`, que barra o login: aqui a pessoa entra
// normalmente, vê os envios em andamento, baixa a etiqueta do que já despachou
// e fala com o suporte — só não consegue cotar nem despachar coisa nova.
//
// Vai nas rotas que COMEÇAM alguma coisa (cotar, confirmar, emitir). Consultar,
// listar e baixar documento de envio antigo seguem livres de propósito: o
// cliente não pode ficar sem o que já pagou.

const db = require('../models');

function clienteDaRequisicao(req) {
    return Number(
        req.cliente?.id ?? req.clienteId ?? req.usuario?.clienteId ?? req.user?.clienteId
    );
}

async function bloquearEnvios(req, res, next) {
    try {
        const clienteId = clienteDaRequisicao(req);
        // Sem cliente identificado não é aqui que se decide: a autenticação
        // já respondeu, ou a rota é pública.
        if (!clienteId) return next();

        const cliente = await db.Cliente.findByPk(clienteId, {
            attributes: ['id', 'enviosBloqueados', 'enviosBloqueadosMotivo'],
        });

        if (!cliente?.enviosBloqueados) return next();

        return res.status(403).json({
            ok: false,
            // `envios_bloqueados` no corpo para o front distinguir disto de
            // um 403 de permissão e mostrar a tela certa.
            envios_bloqueados: true,
            error:
                cliente.enviosBloqueadosMotivo ||
                'Os envios desta conta estão bloqueados. Fale com o suporte da Intrex.',
        });
    } catch (err) {
        // Falha ao consultar não pode virar bloqueio: deixar passar é o menor
        // dano, e o erro fica no log.
        console.error('[ENVIOS_BLOQUEADOS] falha ao verificar', err?.message);
        return next();
    }
}

module.exports = { bloquearEnvios };
