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

module.exports = {
    valorTotalCotacoes,
    valorMedioPorCotacao,
    porcentagemTransportadora,
    porcentagemPaisDestinatario
}