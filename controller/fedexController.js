const FEDEX_BASE = process.env.NODE_ENV === 'production' ? 'https://api.fedex.com' : 'https://apis-sandbox.fedex.com';
const FEDEX_ACCOUNT_NUMBER = process.env.FEDEX_ACCOUNT_NUMBER;

const onlyDigits = (s) => String(s || '').replace(/\D+/g, '');
const trunc = (s, n) => (s ? String(s).slice(0, n) : undefined);
function cleanZip(s = '') { return String(s).replace(/['"`\s]/g, '').replace(/\D/g, ''); }
function kgToLbs(kg) { const n = Number(kg) || 0; return +(n * 2.2046226218).toFixed(3); }
function cmToIn(cm) { const n = Number(cm) || 0; return +(n / 2.54).toFixed(2); }
function round2(n) { return +((Number(n) || 0).toFixed(2)); }

function unitsForCountry(countryCode) {
    const cc = String(countryCode || '').toUpperCase();
    return cc === 'US' ? { w: 'LBS', d: 'IN' } : { w: 'KGS', d: 'CM' };
}

function labelTypeToMime(t) {
    const s = String(t || '').toUpperCase();
    if (s === 'PNG') return 'image/png';
    if (s === 'GIF') return 'image/gif';
    if (s === 'ZPL') return 'text/plain';
    if (s === 'URL') return 'text/uri-list';
    return 'application/octet-stream';
}

function isoState(s) { return String(s || '').trim().toUpperCase(); }

function toYMD(d) {
    if (!d) return null;
    if (d instanceof Date) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}${m}${day}`;
    }
    const s = String(d).trim();
    const m = s.match(/^(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})$/);
    if (m) return `${m[1]}${m[2]}${m[3]}`;
    const dd = new Date(s);
    return isNaN(dd.getTime()) ? null : toYMD(dd);
}

module.exports = {
    rate: async(req, res, next) => {
        try{
            const body = req.body || {};

        }catch(err){

        }
    },
    ship: async(req, res, next) => {
        const t0 = Date.now()
        try{

        }catch(err){

        }
    },
    track: async(req, res, next) => {
        try{

        }catch(err){
            
        }
    }
}