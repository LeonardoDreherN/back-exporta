// utils/cpf.js
const onlyDigits = (v) => String(v || "").replace(/\D/g, "");

function isValidCPFDigits(raw) {
  const cpf = onlyDigits(raw);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const calc = (len) => {
    const nums = cpf.slice(0, len).split("").map(Number);
    const factors = Array.from({ length: len }, (_, i) => len + 1 - i);
    const sum = nums.reduce((acc, n, i) => acc + n * factors[i], 0);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };

  const d1 = calc(9);
  const d2 = calc(10);
  return d1 === Number(cpf[9]) && d2 === Number(cpf[10]);
}

function validateCPF(raw) {
  const cpf = onlyDigits(raw);
  if (!cpf) return { valid: false, reason: "empty" };
  if (!isValidCPFDigits(cpf)) return { valid: false, reason: "digits" };
  return { valid: true };
}

module.exports = { validateCPF, isValidCPFDigits, onlyDigits };
