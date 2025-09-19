const { H, pick, getFullName } = require("./fieldMap");

// monta o objeto de cliente a partir de 1 linha do CSV
function buildCustomer(row) {
    return {
        nome: getFullName(row) || null,
        email: pick(row, H.email) || null,
        shipping: {
            address1: pick(row, H.shipAddr1) || null,
            address2: pick(row, H.shipAddr2) || null,
            city: pick(row, H.shipCity) || null,
            province: pick(row, H.shipProv) || null,
            zip: pick(row, H.shipZip) || null,
            country: pick(row, H.shipCountry) || null
        },
        telefone: pick(row, H.shipPhone) || null,
        pedido: {
            id: pick(row, H.id) || null,
            total: null,
            currency: null
        }
    };
}

// retorna a PRIMEIRA ocorrência do cliente (pelo e-mail; senão, nome)
function findSingleCustomer(rows, { email, nome }) {
    let match = null;

    if (email) {
        const e = email.trim().toLowerCase();
        match = rows.find(r => (pick(r, H.email) || "").trim().toLowerCase() === e);
    }
    if (!match && nome) {
        const n = nome.trim().toLowerCase();
        match = rows.find(r => (getFullName(r) || "").trim().toLowerCase() === n);
    }

    return match ? buildCustomer(match) : null;
}

module.exports = { findSingleCustomer, buildCustomer };
