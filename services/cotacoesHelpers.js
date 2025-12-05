function toNumSafe(v) {
    if (v == null) return undefined;
    const n = Number(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : undefined;
}

const up = (s) => (typeof s === 'string' ? s.toUpperCase() : s);

function normalizeTimeToHHMM(timeRaw) {
    const raw = (timeRaw || "").trim();

    if (!raw) {
        throw new Error(`Informe o horário de coleta (inicial e final).`);
    }

    if (/[a-zA-Z]/.test(raw)) {
        throw new Error(
            `Horário inválido. Use apenas números ou formato HH:MM.`
        );
    }

    const digits = raw.replace(/\D/g, "");

    if (digits.length !== 3 && digits.length !== 4) {
        throw new Error(
            `Horário inválido. Use HHMM ou HH:MM (ex.: 0900 para 09:00, 1730 para 17:30).`
        );
    }

    const padded = digits.length === 3 ? `0${digits}` : digits;
    const hh = Number(padded.slice(0, 2));
    const mm = Number(padded.slice(2, 4));

    if (
        !Number.isInteger(hh) ||
        !Number.isInteger(mm) ||
        hh < 0 ||
        hh > 23 ||
        mm < 0 ||
        mm > 59
    ) {
        throw new Error(`Horário inválido. Hora/minuto fora do intervalo.`);
    }

    return padded;
}

function iso2Country(c) {
    if (!c) return undefined;
    const x = String(c).trim().toUpperCase();
    const map = {
        BR: 'BR', BRA: 'BR', BRASIL: 'BR', BRAZIL: 'BR',
        US: 'US', USA: 'US', UNITEDSTATES: 'US', 'UNITED STATES': 'US',
        CA: 'CA', CANADA: 'CA',
        MX: 'MX', MEXICO: 'MX',
        AR: 'AR', ARGENTINA: 'AR', CL: 'CL', CHILE: 'CL',
    };
    return map[x] || (x.length === 2 ? x : undefined);
}

function splitEndereco(enderecoRaw = "") {
    const s = String(enderecoRaw || "").trim();
    if (!s) return { rua: "", numero: "" };

    // tenta separar "Rua Tal 123 Bloco B"
    const match = s.match(/^(.+?)\s+(\d+.*)$/);
    if (!match) {
        // não achou número: considera tudo como rua
        return { rua: s, numero: "" };
    }

    return {
        rua: match[1].trim(),
        numero: match[2].trim(),
    };
}

module.exports = { up, toNumSafe, normalizeTimeToHHMM, iso2Country, splitEndereco }