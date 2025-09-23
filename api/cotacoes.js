const ALLOW_ORIGIN = process.env.FRONTEND_URL ?? "localhost:3000";
const cors = {
    "Access-Control-Allow-Origin": ALLOW_ORIGIN,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function OPTIONS() {
    return new Response(null, { status: 204, headers: cors });
}

export async function POST(req, res) {
    try {
        const payload = await req.json();

        // Repassa para sua "transportadora" (mock)
        const carrierUrl = process.env.CARRIER_API_URL;
        const r = await fetch(carrierUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        const data = await r.json().catch(() => ({}));
        return new Response(JSON.stringify({ ok: r.ok, carrierResponse: data }), {
            status: r.status,
            headers: { "Content-Type": "application/json", ...cors },
        });
    } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: err?.message || "bad request" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...cors },
        });
    }
}