// utils/cnpj.js
const onlyDigits = (v) => String(v || "").replace(/\D/g, "");

function isValidCNPJDigits(raw) {
  const cnpj = onlyDigits(raw);
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;

  const calc = (len) => {
    const nums = cnpj.slice(0, len).split("").map(Number);
    const factors = len === 12
      ? [5,4,3,2,9,8,7,6,5,4,3,2]
      : [6,5,4,3,2,9,8,7,6,5,4,3,2];
    const sum = factors.reduce((acc, f, i) => acc + f * nums[i], 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  const d1 = calc(12);
  const d2 = calc(13);
  return d1 === Number(cnpj[12]) && d2 === Number(cnpj[13]);
}

async function validateCNPJ(raw, { online } = {}) {
  const cnpj = onlyDigits(raw);
  if (!cnpj) return { valid: false, reason: "empty" };
  if (!isValidCNPJDigits(cnpj)) return { valid: false, reason: "digits" };

  if (online === "receitaws") {
    const resp = await fetch(`https://receitaws.com.br/v1/cnpj/${cnpj}`, { headers: { Accept: "application/json" }});
    if (!resp.ok) return { valid: true, exists: false, status: resp.status };
    const data = await resp.json();
    const exists = data?.status === "OK" && onlyDigits(data?.cnpj) === cnpj;
    return { valid: true, exists, data };
  }

  return { valid: true };
}

module.exports = { validateCNPJ, isValidCNPJDigits, onlyDigits };
