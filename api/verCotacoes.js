// backend/api/mock-transportadora.js
const ALLOW_ORIGIN = process.env.FRONTEND_URL || "http://localhost:3000";

const cors = {
    "Access-Control-Allow-Origin": ALLOW_ORIGIN,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function OPTIONS() {
    return new Response(null, { status: 204, headers: cors });
}

// export async function GET() {
//     try{

//     }
// }