const { Op } = require("sequelize")
const db = require("../models")

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
        const quantidade_cotacoes = await db.Cotacao.count({
            where: {
                cliente_id: req.clienteId
            }
        })


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

        // const hoje = new Date().toISOString().slice(0, 10)
        // console.log(hoje)

        const cotacoes = await db.Cotacao.findAll({
            where: {
                cliente_id: req.clienteId,
                [Op.and]: [
                    db.sequelize.where(db.sequelize.fn('DATE', db.sequelize.col('created_at')), db.sequelize.literal('CURRENT_DATE'))
                ]
            },
            attributes: [[db.sequelize.fn('SUM', db.sequelize.col('preco_final')), 'total']],
            raw: true
        });

        console.log(cotacoes)
        if (cotacoes[0].total === null) {
            cotacoes[0].total = 0
        }

        res.status(200).json({ ok: true, cotacoes });
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
    cotacaoHoje
}