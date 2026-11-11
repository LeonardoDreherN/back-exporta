// middleware/limiteCredito.js
// Barra o despacho quando o cliente ja tem em aberto o que o nivel dele
// permite.
//
// Vai DEPOIS de bloquearEnvios e nas mesmas rotas que de fato criam custo:
// confirmar cotacao, emitir etiqueta. Cotar nao entra de proposito — quem
// esta no limite precisa continuar vendo preco para saber o que vai pagar;
// barrar a consulta so esconde a informacao de quem ja esta devendo.
//
// Diferente do bloqueio do admin, este nao e punicao: e teto de exposicao. A
// mensagem diz quanto falta liberar, porque a acao do cliente e pagar, nao
// "falar com o suporte".

const { avaliarLimite } = require('../services/limiteCredito');

function clienteDaRequisicao(req) {
    return Number(
        req.cliente?.id ?? req.clienteId ?? req.usuario?.clienteId ?? req.user?.clienteId
    );
}

/**
 * Valor do envio que esta sendo criado, quando da para saber pelo corpo.
 * Nao da sempre: em varias rotas o preco so existe depois de cotar. Nesse
 * caso avalia-se so o acumulado, que ja e o que importa.
 */
function valorDoCorpo(req) {
    const candidatos = [
        req.body?.preco_final,
        req.body?.precoFinal,
        req.body?.total,
        req.body?.valor_usd,
    ];
    for (const c of candidatos) {
        const n = Number(c);
        if (Number.isFinite(n) && n > 0) return n;
    }
    return 0;
}

async function limitarPorCredito(req, res, next) {
    try {
        const clienteId = clienteDaRequisicao(req);
        if (!clienteId) return next();

        const r = await avaliarLimite({
            clienteId,
            valorNovoUsd: valorDoCorpo(req),
        });

        if (r.permitido) return next();

        const falta = Math.max(0, r.emAbertoUsd - r.limiteUsd);

        return res.status(403).json({
            ok: false,
            // Campo proprio para o front mostrar a tela certa: isto nao e o
            // bloqueio manual do admin nem um 403 de permissao.
            limite_credito: true,
            nivel: r.nivel,
            nivel_rotulo: r.rotulo,
            limite_usd: r.limiteUsd,
            em_aberto_usd: r.emAbertoUsd,
            disponivel_usd: Math.max(0, r.disponivelUsd),
            envios_em_aberto: r.envios,
            error: r.motivo === 'limite_atingido'
                ? `Esta conta tem US$ ${r.emAbertoUsd.toFixed(2)} em envios ainda não pagos, `
                  + `e o limite do nível ${r.nivel} (${r.rotulo}) é US$ ${r.limiteUsd.toFixed(2)}. `
                  + `Quite US$ ${falta.toFixed(2)} para liberar novos envios.`
                : `Este envio ultrapassa o limite do nível ${r.nivel} (${r.rotulo}). `
                  + `Disponível agora: US$ ${Math.max(0, r.disponivelUsd).toFixed(2)}.`,
        });
    } catch (err) {
        // Mesma regra do bloqueio: falha de consulta nao vira barreira. Travar
        // o despacho de todo mundo por causa de um erro de banco seria um
        // estrago maior do que deixar passar um envio acima do teto.
        console.error('[LIMITE_CREDITO] falha ao verificar, deixando passar:', err?.message);
        return next();
    }
}

module.exports = { limitarPorCredito };
