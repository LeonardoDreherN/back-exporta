// Cabeçalhos EN/PT mais comuns nos exports de Orders/Draft Orders
// Cabeçalhos EN/PT mais comuns nos exports de Orders/Draft Orders
const H = {
    id: ["Name", "Nome do pedido"],
    total: ["Total", "Total"],
    currency: ["Currency", "Moeda"],

    // contato
    email: ["Email", "E-mail"],
    shipPhone: ["Shipping Phone", "Telefone (envio)"],

    // shipping address
    shipName: ["Shipping Name", "Nome do envio", "Recipient Name", "Nome do destinatário"],
    shipFirst: ["Shipping First Name", "Nome do envio (nome)"],
    shipLast: ["Shipping Last Name", "Nome do envio (sobrenome)"],
    shipAddr1: ["Shipping Address1", "Endereço de envio 1", "Shipping Street"],
    shipAddr2: ["Shipping Address2", "Endereço de envio 2"],
    shipCity: ["Shipping City", "Cidade (envio)"],
    shipProv: ["Shipping Province", "Estado (envio)", "Shipping Province Name"],
    shipZip: ["Shipping Zip", "CEP (envio)", "Shipping Postal Code"],
    shipCountry: ["Shipping Country", "País (envio)"],

    // billing (fallback)
    billName: ["Billing Name", "Nome do faturamento"],
    billFirst: ["Billing First Name", "Nome do faturamento (nome)"],
    billLast: ["Billing Last Name", "Nome do faturamento (sobrenome)"],

    // às vezes há “Customer Name”
    customerName: ["Customer Name", "Nome do cliente", "Customer"],

    // ---------- FALTAVAM ESTES ----------
    itemTitle: ["Lineitem name", "Item do pedido - Nome", "Item Name"],
    itemSKU: ["Lineitem sku", "Item do pedido - SKU", "Item Sku"],
    itemQty: ["Lineitem quantity", "Item do pedido - Quantidade", "Item Quantity"],
    itemPrice: ["Lineitem price", "Item do pedido - Preço", "Item Price"],
};


function pick(row, keys) {
    if (!row) return "";
    const arr = Array.isArray(keys) ? keys : (keys ? [keys] : []);
    for (const k of arr) {
        if (k in row && String(row[k]).trim() !== "") {
            return String(row[k]).trim();
        }
    }
    return "";
}

function joinName(first, last) {
    return [first, last].map(v => (v || "").trim()).filter(Boolean).join(" ");
}
function getFullName(row) {
    return (
        pick(row, H.shipName) ||
        pick(row, H.billName) ||
        pick(row, H.customerName) ||
        joinName(pick(row, H.shipFirst), pick(row, H.shipLast)) ||
        joinName(pick(row, H.billFirst), pick(row, H.billLast)) ||
        ""
    );
}

function pickWithKey(row, keys) {
    const arr = Array.isArray(keys) ? keys : (keys ? [keys] : []);
    for (const k of arr) {
        if (k in row && String(row[k]).trim() !== '') {
            return { value: String(row[k]).trim(), key: k };
        }
    }
    return { value: '', key: null };
}

module.exports = { H, pick, getFullName, pickWithKey };
