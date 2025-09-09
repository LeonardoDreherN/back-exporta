// utils/norm.js
function norm(shopParam) {
    if (shopParam == null) throw new Error('Parâmetro "shop" ausente');
    let s = Array.isArray(shopParam) ? shopParam[0] : String(shopParam);
    s = s.trim().toLowerCase();
    s = s.replace(/^https?:\/\//i, ''); // tira protocolo
    s = s.split('/')[0];                // tira path
    s = s.replace(/:\d+$/, '');         // tira porta
    s = s.replace(/\.$/, '');           // ponto final
    const RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.myshopify\.com$/;
    if (!RE.test(s)) throw new Error('Domínio "shop" inválido (use loja.myshopify.com)');
    return s;
}

module.exports = { norm };
