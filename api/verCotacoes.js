// GET /api/ver-cotacoes
export async function GET() {
    const itens = [
        { quote_id: "Q1ABC", preco_total: 42.5, moeda: "USD", pais_remetente: "BR", pais_dest: "US" },
        { quote_id: "Q2XYZ", preco_total: 55.1, moeda: "USD", pais_remetente: "BR", pais_dest: "US" }
    ];
    return new Response(JSON.stringify({ ok: true, itens }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
    });
}
