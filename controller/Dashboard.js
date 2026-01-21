const db = require("../models")

const valorTotalCotacoes = async (req, res) => {
    try {
        const total = await db.Cotacao.sum( 'preco_final', {
            where: { cliente_id: req.clienteId }
        })

        console.log(total)

        return res.status(201).json({ ok: true, total })
    } catch (err) {
        console.error("Erro ao pegar valor das cotacoes: ", err)
        return res.status(500).json({ ok: false, err })
    }
}

const valorMedioPorCotacao = async(req, res) => {
    try{
        const total = await db.Cotacao.sum( 'preco_final', {
            where: { cliente_id: req.clienteId }
        })

        const quantidade_cotacoes = await db.Cotacao.count({
            where: {
                cliente_id: req.clienteId
            }
        })

        const valorMedio = (total / quantidade_cotacoes).toFixed(2)

        return res.status(201).json({ ok: true, valorMedio })

    }catch(err){
        console.error("Erro ao pegar valor medio das cotacoes: ", err)
        return res.status(500).json({ ok: false, err })
    }
}

const porcentagemTransportadora = async(req, res) => {
    try{
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

        return res.status(201).json({ ok: true, porcentagemFedex, porcentagemUps})
    }catch(err){
        console.error("Erro ao pegar porcentagem de transportadoras das cotacoes: ", err)
        return res.status(500).json({ ok: false, err })
    }
}

module.exports = { 
    valorTotalCotacoes,
    valorMedioPorCotacao,
    porcentagemTransportadora
}