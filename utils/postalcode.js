function cleanPostal(countryCode, value) {
    const raw = String(value || "").trim().toUpperCase();
    if (!raw) return "";
    if (countryCode === "BR") return raw.replace(/\D/g, "");
    return raw.replace(/\s+/g, ""); // UK: TN235RZ
}

module.exports = {cleanPostal}