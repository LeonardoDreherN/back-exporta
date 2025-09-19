const { readCsvBuffer } = require('../services/csvReader.js');
const { findSingleCustomer } = require('../services/customerFinder');

async function findCustomerFromCsv(req, res) {
    try {
        if (!req.files?.file?.[0]) {
            return res.status(400).json({ error: "Envie 'file' (CSV de pedidos/rascunhos)" });
        }
        const { email, nome } = req.body;
        if (!email && !nome) {
            return res.status(400).json({ error: "Informe 'email' ou 'nome' para buscar" });
        }

        const rows = await readCsvBuffer(req.files.file[0].buffer);
        const customer = findSingleCustomer(rows, { email, nome });

        if (!customer) return res.status(404).json({ error: 'Cliente não encontrado' });
        return res.json(customer);
    } catch (e) {
        console.error('[findCustomerFromCsv]', e);
        return res.status(500).json({ error: 'Falha ao processar CSV', details: e.message });
    }
}

module.exports = { findCustomerFromCsv };
