const db = require("../models")

const valorTotalCotacoes = async (req, res) => {
    try {
        const { id_user } = req.body
        const total = await db.Cotacao.sum( 'preco_final', {
            where: { cliente_id: id_user }
        })

        console.log(total)

        return res.status(201).json({ ok: true, total })
    } catch (err) {
        console.error("Erro ao pegar valor das cotacoes: ", err)
        return res.status(500).json({ ok: false, err })
    }
}

module.exports = { valorTotalCotacoes }