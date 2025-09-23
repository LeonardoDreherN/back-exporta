const ALLOW_ORIGIN = process.env.FRONTEND || "http://localhost:3000";

const cors = {
    "Access-Control-Allow-Origin": ALLOW_ORIGIN,
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function OPTIONS() {
    return new Response(null, { status: 204, headers: cors });
}

export async function GET() {
    return new Response(JSON.stringify({ ok: true, message: "API on Vercel" }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...cors },
    });
}