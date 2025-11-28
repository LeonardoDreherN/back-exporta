// routes/relatorioPagamentos.js
const router = require("express").Router();
const { Op } = require("sequelize");
const db = require("../models");
const Cotacao = db.Cotacao;  

// util data
function range(from, to) {
    if (!from && !to) return null;
    const ini = new Date((from || "1970-01-01") + "T00:00:00Z");
    const fim = new Date((to || "2999-12-31") + "T23:59:59Z");
    return { [Op.between]: [ini, fim] };
}
const n = (v) => {
    const x = Number(typeof v === "string" ? v.replace(",", ".") : v);
    return Number.isFinite(x) ? x : 0;
};


// Lê jsonb `surcharges` -> base, soma de itemized (taxas), total, moeda, e string de itens
// Lê jsonb `surcharges` -> base, soma de itemized (taxas), total, moeda, e string de itens
export function fromSurcharges(c) {
    const s = c.surcharges || {};
    const base = n(s.base);
    const itemized = Array.isArray(s.itemized) ? s.itemized : [];
    const taxas = itemized.reduce((acc, it) => acc + n(it.value), 0);
    const totalCarrier = n(s.total) || (base + taxas + n(s.serviceOptions));
    const currency = s.currency || "USD";
    const taxas_itens = itemized.map(it => `${it.code}:${n(it.value).toFixed(2)}`).join(" | ");
    return { base, taxas, totalCarrier, currency, taxas_itens };
}

// CSV bem simples
function csvEscape(s) {
    const v = String(s ?? "");
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
function toCSV(rows) {
    const head = "pedido_ref,tracking_number, preco_base, taxas, preco_final\n";
    const body = rows.map(r =>
        [r.pedido_ref, r.tracking_number, r.preco_base, r.taxas, r.preco_final.toFixed(2)]
            .map(csvEscape).join(",")
    ).join("\n");
    return head + body + "\n";
}

router.post("/pagamentos.csv", async (req, res) => {
    try {
        const { from, to, clienteId } = req.body || {};
        const where = {};
        if (clienteId) where.clienteId = Number(clienteId);
        if (from || to) {
            where.createdAt = {
                [Op.between]: [
                    new Date((from || "1970-01-01") + "T00:00:00Z"),
                    new Date((to || "2999-12-31") + "T23:59:59Z"),
                ],
            };
        }

        const cotacoes = await Cotacao.findAll({
            where,
            order: [["createdAt", "DESC"]],
            raw: true
        });

        const linhas = cotacoes.map(c => {
            const sur = fromSurcharges(c);
            // usa SEMPRE o preço final já salvo no seu banco (ajuste o nome do campo abaixo)
            const precoFinal = n(c.preco_final) || n(c.total_cliente) || n(c.valor_frete_cliente);

            return {
                pedido_ref: c.pedido_ref || c.ref || "",
                tracking_number: c.tracking_number || c.tracking || "",
                preco_base: sur.base,
                taxas: sur.taxas,
                total_carrier: sur.totalCarrier, // informativo
                preco_final: precoFinal,         // o que entra no total geral
                moeda: sur.currency,
                taxas_itens: sur.taxas_itens
            };
        });

        // totais (somamos o que você precisa)
        const total_final = linhas.reduce((acc, l) => acc + n(l.preco_final), 0);

        // linha de rodapé (só para referência; você pode deixar só o TOTAL_GERAL)
        linhas.push({
            pedido_ref: "TOTAL_GERAL",
            tracking_number: "",
            preco_final: total_final,
            moeda: "",
            taxas_itens: ""
        });

        const csv = toCSV(linhas);
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", 'attachment; filename="relatorio-pagamentos.csv"');
        res.status(200).send(csv);
    } catch (e) {
        console.error(e);
        res.status(500).json({ ok: false, error: "ERRO_RELATORIO_PAGAMENTOS" });
    }
});


module.exports = router;
