function validateEmailFormat(raw, opts = {}) {
    const { allowUnicode = true } = opts;
    if (raw == null) return { valid: false, reason: "empty" };

    // Remove espaços e quebras em volta
    const email = String(raw).trim();
    if (!email) return { valid: false, reason: "empty" };

    // Não permitir nomes com <...>
    if (/[<>]/.test(email)) {
        return { valid: false, reason: "display_name_not_allowed" };
    }

    const atCount = (email.match(/@/g) || []).length;
    if (atCount !== 1) return { valid: false, reason: "at_count" };

    const [local, domain] = email.split("@");
    if (!local || !domain) return { valid: false, reason: "parts_missing" };

    // 1) Local-part
    // Aceita: a-zA-Z0-9 e os símbolos RFC comuns; ou forma "quoted"
    const localUnquoted = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/;
    const localQuoted = /^"(?:[\x20-\x7E]|\\[\x00-\x7F])*"$/; // "..." com escapes
    const isLocalOk = localUnquoted.test(local) || localQuoted.test(local);

    if (!isLocalOk) return { valid: false, reason: "local_invalid" };

    if (!localQuoted.test(local)) {
        if (!/^[A-Za-z0-9]/.test(local)) {
            return { valid: false, reason: "local_starts_with_symbol" };
        } //verifica se começa com símbolo

        if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) {
            return { valid: false, reason: "local_invalid_chars" };
        } //verifica se tem caracteres inválidos

        if (local.includes("..")) {
            return { valid: false, reason: "local_consecutive_dots" };
        } //verifica se existe ..

        if (local.startsWith(".") || local.endsWith(".")) {
            return { valid: false, reason: "local_dot_edge" };
        } //Sem ponto no começo/fim
    }

    // 2) Domínio
    // Permite Unicode se allowUnicode=true (bastante aceito hoje). Se quiser forçar ASCII, troque o regex.
    let labelRegex;
    if (allowUnicode) {
        // Permite letras/números + hífen com Unicode (IDN)
        labelRegex = /^(?:[A-Za-z0-9\u00C0-\uFFFF](?:[A-Za-z0-9\u00C0-\uFFFF-]{0,61}[A-Za-z0-9\u00C0-\uFFFF])?)$/;
    } else {
        // Apenas ASCII (sem Unicode)
        labelRegex = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)$/;
    }

    const labels = domain.split(".");
    if (labels.length < 2) return { valid: false, reason: "domain_no_dot" };

    // Cada label: 1–63 chars, sem começar/terminar com "-", só letras/números/hífens
    for (const lbl of labels) {
        if (!labelRegex.test(lbl)) {
            return { valid: false, reason: "domain_label_invalid", detail: lbl };
        }
    }

    // TLD com 2+ chars (ex.: .br, .com, .email)
    const tld = labels[labels.length - 1];
    if (tld.length < 2) return { valid: false, reason: "tld_short" };

    // Comprimento max RFC do domínio: 255
    if (domain.length > 255) return { valid: false, reason: "domain_too_long" };

    // Comprimento total do e-mail (RFC prevê até 254 chars em geral)
    if (email.length > 254) return { valid: false, reason: "email_too_long" };

    return { valid: true, normalized: email.toLowerCase() };
}

// Versão "rápida" para front (menos rígida, só pra UX instantâneo)
function isEmailFormatQuick(s) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s || "").trim());
}

module.exports = { validateEmailFormat, isEmailFormatQuick };
