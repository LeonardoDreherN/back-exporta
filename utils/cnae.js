const onlyDigits = (v) => String(v || "").replace(/\D/g, "");

async function validateCNAE(raw) {
  const code = onlyDigits(raw);
  if (!code) return { valid: false, reason: "empty" };
  if (!(code.length === 5 || code.length === 7)) {
    return { valid: false, reason: "length" };
  }

  let url;
  if (code.length === 5) {
    // consulta direta no código de 5 dígitos
    url = `https://servicodados.ibge.gov.br/api/v2/cnae/classes/${code}`;
  } else {
    // consulta no código de 7 dígitos (atividade específica)
    url = `https://servicodados.ibge.gov.br/api/v2/cnae/subclasses/${code}`;
  }

  try {

    const resp = await fetch(url, { headers: { Accept: "application/json" } });
    if (!resp.ok) {
      return { valid: true, exists: false, code, url, status: resp.status };
    }

    // const exists = Array.isArray(data) && data.length > 0;
    const data = await resp.json();
    let exists = false

    if (Array.isArray(data) && data.length > 0) {
      const found = data.find((it) => {
        const idDigits = String(it?.id ?? "").replace(/\D/g, "");
        return idDigits === code;
      });
      exists = !!found;
    } else if (data && typeof data === "object") {
      // fallback defensivo (se algum dia retornar objeto)
      const idDigits = String(data?.id ?? "").replace(/\D/g, "");
      exists = idDigits === code;
    }

    return { valid: true, exists, data };
  } catch (err) {
    console.error("[validateCNAE]", err);
    return {
      valid: true,
      exists: undefined,
      code,
      url,
      error: String(err?.message || err),
    };
  }
}

module.exports = { validateCNAE, onlyDigits };