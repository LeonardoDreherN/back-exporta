const { Op, literal } = require("sequelize")
const db = require("../models")

const tz = "America/Sao_Paulo";

const valorTotalCotacoes = async (req, res) => {
    try {
        const total = await db.Cotacao.sum('preco_final', {
            where: { cliente_id: req.clienteId }
        })

        console.log(total)

        return res.status(200).json({ ok: true, total })
    } catch (err) {
        console.error("Erro ao pegar valor das cotacoes: ", err)
        return res.status(500).json({ ok: false, err })
    }
}

const valorMedioPorCotacao = async (req, res) => {
    try {
        const total = await db.Cotacao.sum('preco_final', {
            where: { cliente_id: req.clienteId }
        })

        const quantidade_cotacoes = await db.Cotacao.count({
            where: {
                cliente_id: req.clienteId
            }
        })

        const valorMedio = (total / quantidade_cotacoes).toFixed(2)

        return res.status(200).json({ ok: true, valorMedio })

    } catch (err) {
        console.error("Erro ao pegar valor medio das cotacoes: ", err)
        return res.status(500).json({ ok: false, err })
    }
}

const porcentagemTransportadora = async (req, res) => {
    try {
        const quantidade_cotacoes = await db.Cotacao.count({
            where: {
                cliente_id: req.clienteId
            }
        })

        const contagemFedex = await db.Cotacao.count({
            where: {
                cliente_id: req.clienteId,
                carrier: "FEDEX"
            }
        })

        const contagemUps = await db.Cotacao.count({
            where: {
                cliente_id: req.clienteId,
                carrier: "UPS"
            }
        })

        const porcentagemFedex = (contagemFedex / quantidade_cotacoes) * 100
        const porcentagemUps = (contagemUps / quantidade_cotacoes) * 100

        return res.status(200).json({ ok: true, porcentagemFedex, porcentagemUps })
    } catch (err) {
        console.error("Erro ao pegar porcentagem de transportadoras das cotacoes: ", err)
        return res.status(500).json({ ok: false, err })
    }
}

const porcentagemPaisDestinatario = async (req, res) => {
    try {
        const quantidade_cotacoes = await db.Cotacao.count({
            where: {
                cliente_id: req.clienteId
            }
        })
        const rows = await db.Cotacao.findAll({
            where: { cliente_id: req.clienteId },
            attributes: ['pais_dest', [db.sequelize.fn('COUNT', db.sequelize.col('pais_dest')), 'count']],
            group: ['pais_dest']
        })

        const porcentagens = rows.map(r => {
            const data = r.toJSON()
            return {
                pais_dest: data.pais_dest,
                porcentagem: (data.count / quantidade_cotacoes) * 100
            }
        })

        return res.status(200).json({ ok: true, porcentagens })

    } catch (err) {
        console.error("Erro ao pegar porcentagem de paises destinatarios das cotacoes: ", err)
        return res.status(500).json({ ok: false, err })
    }
}

const valorMedioPorPais = async (req, res) => {
    try {

        const rows = await db.Cotacao.findAll({
            where: { cliente_id: req.clienteId },
            attributes: ['pais_dest', [db.sequelize.fn('COUNT', db.sequelize.col('pais_dest', 'preco_final')), 'count'], [db.sequelize.fn('SUM', db.sequelize.col('preco_final')), 'total']],
            group: ['pais_dest']
        })
        const mediaPorPais = await rows.map((r) => {
            const data = r.toJSON()
            return {
                pais_dest: data.pais_dest,
                media: data.total / data.count
            }
        })

        return res.status(200).json({ ok: true, mediaPorPais })
    } catch (err) {
        console.error("Erro ao pegar valor medio das cotacoes por pais: ", err)
        return res.status(500).json({ ok: false, err })
    }
}


const cotacaoHoje = async (req, res) => {
    try {
        const cliente_id = req.clienteId;

        if (!cliente_id) {
            return res.status(401).json({ ok: false, error: "CLIENTE_NAO_AUTENTICADO" });
        }

        const hojeSP = new Intl.DateTimeFormat("en-CA", {
            timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
        }).format(new Date());

        console.log(hojeSP) //dia de hoje

        const start = new Date(`${hojeSP}T00:00:00-03:00`);
        const end = new Date(`${hojeSP}T23:59:59.999-03:00`);

        console.log(start, end) //hojeT03:00:00.000Z hojeT02:59:59.999Z

        // 2026-01-22T03:00:00.000Z = 22/01 00:00 no Brasil
        // 2026-01-23T02:59:59.999Z = 22/01 23:59:59.999 no Brasil

        const hourLabel = literal(
            `to_char(date_trunc('hour', (created_at AT TIME ZONE '${tz}')), 'HH24')` //retorna os horarios: 01, 02, 03...
        );

        const rows = await db.Cotacao.findAll({
            where: { cliente_id, created_at: { [Op.between]: [start, end] } },
            attributes: [
                [hourLabel, "hora"],
                [db.sequelize.fn("SUM", db.sequelize.col("preco_final")), "total"],
            ],
            group: [hourLabel],
            order: [[hourLabel, "ASC"]],
            raw: true,
        });

        const map = new Map(rows.map(r => [r.hora, Number(r.total) || 0]));

        // completa 00..23
        const data = Array.from({ length: 24 }, (_, i) => {
            const hora = String(i).padStart(2, "0");
            return { hora, total: map.get(hora) ?? 0 };
        });

        return res.status(200).json({ ok: true, data });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ ok: false, error: "erro ao pegar cotacao por data" });
    }
};

function gerarDias(start, end) {
    const dias = [];
    const d = new Date(start);
    d.setHours(0, 0, 0, 0);

    const e = new Date(end);
    e.setHours(0, 0, 0, 0);

    while (d <= e) {
        dias.push(d.toISOString().slice(0, 10)); // YYYY-MM-DD
        d.setDate(d.getDate() + 1);
    }
    return dias;
}

const cotacaoMes = async (req, res) => {
    try {
        const cliente_id = req.clienteId;

        if (!cliente_id) {
            return res.status(401).json({ ok: false, error: "CLIENTE_NAO_AUTENTICADO" });
        }

        const hojeSP = new Intl.DateTimeFormat("en-CA", {
            timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
        }).format(new Date());

        const fmt = new Intl.DateTimeFormat("en-CA", {
            timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
        });

        const d = new Date();
        d.setMonth(d.getMonth() - 1);

        const mes = fmt.format(d);

        const start = new Date(`${mes}T00:00:00-03:00`);
        const end = new Date(`${hojeSP}T23:59:59.999-03:00`);

        const dayExpr = literal(
            `date_trunc('day', (created_at AT TIME ZONE 'America/Sao_Paulo'))`
        );

        const cotacoes = await db.Cotacao.findAll({
            where: {
                cliente_id: req.clienteId,
                created_at: { [Op.between]: [start, end] }
            },
            attributes: [
                [dayExpr, "day"],
                [db.sequelize.fn("SUM", db.sequelize.col("preco_final")), "total"],
            ],
            group: [dayExpr],
            order: [[dayExpr, 'ASC']],
            raw: true
        });

        const map = new Map(
            cotacoes.map(row => {
                console.log(row)
                const dia = new Intl.DateTimeFormat("en-CA", {
                    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
                }).format(new Date(row.day));; // garante YYYY-MM-DD
                console.log(row.dia, row.total);
                return [dia, Number(row.total) || 0];
            })
        );

        console.log(map);

        // 🔑 gera todos os dias do período e preenche com 0
        const diasPeriodo = gerarDias(start, end);

        console.log(diasPeriodo);

        const data = diasPeriodo.map(dia => (
            {
                dia,
                total: map.get(dia) ?? 0
            }));

        console.log(data);

        res.status(200).json({ ok: true, total: data });
    } catch (e) {
        console.error(e);
        res.status(500).json({ ok: false, error: "erro ao pegar cotacao por data" });
    }
}

const cotacaoOntem = async (req, res) => {
    try {
        const cliente_id = req.clienteId;

        if (!cliente_id) {
            return res.status(401).json({ ok: false, error: "CLIENTE_NAO_AUTENTICADO" });
        }

        const hoje = new Date();
        hoje.setDate(hoje.getDate() - 1); // ontem

        const ontemSP = new Intl.DateTimeFormat("en-CA", {
            timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
        }).format(hoje);

        console.log(ontemSP) //dia de hoje
        const start = new Date(`${ontemSP}T00:00:00-03:00`);
        const end = new Date(`${ontemSP}T23:59:59.999-03:00`);

        console.log(start, end) //hojeT03:00:00.000Z hojeT02:59:59.999Z

        // 2026-01-22T03:00:00.000Z = 22/01 00:00 no Brasil
        // 2026-01-23T02:59:59.999Z = 22/01 23:59:59.999 no Brasil

        const hourLabel = literal(
            `to_char(date_trunc('hour', (created_at AT TIME ZONE '${tz}')), 'HH24')` //retorna os horarios: 01, 02, 03...
        );

        const rows = await db.Cotacao.findAll({
            where: { cliente_id, created_at: { [Op.between]: [start, end] } },
            attributes: [
                [hourLabel, "hora"],
                [db.sequelize.fn("SUM", db.sequelize.col("preco_final")), "total"],
            ],
            group: [hourLabel],
            order: [[hourLabel, "ASC"]],
            raw: true,
        });

        const map = new Map(rows.map(r => [r.hora, Number(r.total) || 0]));

        // completa 00..23
        const data = Array.from({ length: 24 }, (_, i) => {
            const hora = String(i).padStart(2, "0");
            return { hora, total: map.get(hora) ?? 0 };
        });

        return res.status(200).json({ ok: true, data });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ ok: false, error: "erro ao pegar cotacao por data" });
    }
}

const cotacaoSemana = async (req, res) => {
    try {
        const cliente_id = req.clienteId;

        if (!cliente_id) {
            return res.status(401).json({ ok: false, error: "CLIENTE_NAO_AUTENTICADO" });
        }

        const hojeSP = new Intl.DateTimeFormat("en-CA", {
            timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
        }).format(new Date());

        const fmt = new Intl.DateTimeFormat("en-CA", {
            timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
        });

        const d = new Date();
        d.setDate(d.getDate() - 7);

        const semana = fmt.format(d);

        const start = new Date(`${semana}T00:00:00-03:00`);
        const end = new Date(`${hojeSP}T23:59:59.999-03:00`);

        const dayExpr = literal(
            `date_trunc('day', (created_at AT TIME ZONE 'America/Sao_Paulo'))`
        );

        const cotacoes = await db.Cotacao.findAll({
            where: {
                cliente_id: req.clienteId,
                created_at: { [Op.between]: [start, end] }
            },
            attributes: [
                [dayExpr, "day"],
                [db.sequelize.fn("SUM", db.sequelize.col("preco_final")), "total"],
            ],
            group: [dayExpr],
            order: [[dayExpr, 'ASC']],
            raw: true
        });

        const map = new Map(
            cotacoes.map(row => {
                console.log(row)
                const dia = new Intl.DateTimeFormat("en-CA", {
                    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
                }).format(new Date(row.day));; // garante YYYY-MM-DD
                console.log(row.dia, row.total);
                return [dia, Number(row.total) || 0];
            })
        );

        console.log(map);

        // 🔑 gera todos os dias do período e preenche com 0
        const diasPeriodo = gerarDias(start, end);

        console.log(diasPeriodo);

        const data = diasPeriodo.map(dia => (
            {
                dia,
                total: map.get(dia) ?? 0
            }));

        console.log(data);

        res.status(200).json({ ok: true, total: data });
    } catch (e) {
        console.error(e);
        res.status(500).json({ ok: false, error: "erro ao pegar cotacao por data" });
    }
}

module.exports = {
    valorTotalCotacoes,
    valorMedioPorCotacao,
    porcentagemTransportadora,
    porcentagemPaisDestinatario,
    valorMedioPorPais,
    cotacaoHoje,
    cotacaoMes,
    cotacaoOntem,
    cotacaoSemana
}