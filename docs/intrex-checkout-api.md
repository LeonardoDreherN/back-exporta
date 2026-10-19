# Intrex Shipping API — Integração de Frete no Checkout

## Visão geral

Esta API retorna as opções de frete internacional disponíveis (UPS e FedEx) com base nas dimensões do pacote e no país de destino. Ela deve ser chamada no checkout da loja para exibir as opções de frete ao cliente antes de finalizar o pedido.

---

## Autenticação

Todas as requisições devem incluir a API key no header `x-api-key`.

```
x-api-key: <sua_chave>
```

Requisições sem a chave ou com chave inválida retornam `401 Unauthorized`.

---

## Endpoint

### `POST /api/public-quote`

**URL base:** `https://back-exporta.onrender.com`

**URL completa:** `https://back-exporta.onrender.com/api/public-quote`

---

## Request

**Headers:**

| Header         | Valor                        | Obrigatório |
|----------------|------------------------------|-------------|
| Content-Type   | application/json             | Sim         |
| x-api-key      | chave fornecida pela Intrex  | Sim         |

**Body (JSON):**

| Campo        | Tipo   | Obrigatório | Descrição                                      |
|--------------|--------|-------------|------------------------------------------------|
| `peso`       | number | Sim         | Peso do pacote em **kg** (ex: `1.5`)           |
| `comprimento`| number | Não         | Comprimento em **cm** (padrão: 20)             |
| `largura`    | number | Não         | Largura em **cm** (padrão: 15)                 |
| `altura`     | number | Não         | Altura em **cm** (padrão: 10)                  |
| `destino`    | string | Sim         | Código ISO do país de destino (ex: `"US"`)     |

> O campo `destino` aceita o código ISO 3166-1 alpha-2 do país (2 letras maiúsculas).  
> Exemplos: `"US"`, `"DE"`, `"FR"`, `"GB"`, `"JP"`, `"AU"`.

**Exemplo de body:**

```json
{
  "peso": 1.5,
  "comprimento": 30,
  "largura": 20,
  "altura": 15,
  "destino": "US"
}
```

---

## Response

**Status `200 OK`:**

```json
{
  "ok": true,
  "options": [
    {
      "carrier": "FedEx",
      "service": "International Connect Plus",
      "price": 41.80,
      "currency": "USD",
      "sla_days": 7,
      "base": 35.00,
      "surcharges": 6.80,
      "label": "FedEx - USD 41.80",
      "sla_label": "7 dias úteis"
    },
    {
      "carrier": "UPS",
      "service": "Worldwide Expedited",
      "price": 45.20,
      "currency": "USD",
      "sla_days": 5,
      "base": 38.00,
      "surcharges": 7.20,
      "label": "UPS - USD 45.20",
      "sla_label": "5 dias úteis"
    }
  ]
}
```

**Campos da resposta:**

| Campo        | Tipo   | Descrição                                                   |
|--------------|--------|-------------------------------------------------------------|
| `carrier`    | string | Nome da transportadora (`"UPS"` ou `"FedEx"`)               |
| `service`    | string | Nome do serviço                                             |
| `price`      | number | Valor total em USD (frete base + taxas)                     |
| `currency`   | string | Moeda (`"USD"`)                                             |
| `sla_days`   | number | Prazo estimado em dias úteis                                |
| `base`       | number | Valor do frete base                                         |
| `surcharges` | number | Valor das taxas adicionais                                  |
| `label`      | string | Texto pronto para exibir no checkout (transportadora + preço)|
| `sla_label`  | string | Texto pronto para exibir o prazo no checkout                |

> As opções já vêm ordenadas do **menor para o maior preço**.

---

## Erros

| Status | Situação                                      |
|--------|-----------------------------------------------|
| `400`  | Parâmetros obrigatórios ausentes ou inválidos |
| `401`  | API key ausente ou inválida                   |
| `502`  | Carriers indisponíveis no momento             |

**Exemplo de erro `400`:**

```json
{
  "ok": false,
  "error": "peso e destino são obrigatórios"
}
```

**Exemplo de erro `401`:**

```json
{
  "ok": false,
  "error": "API key inválida ou ausente"
}
```

---

## Países suportados

| Código | País                   | Código | País               |
|--------|------------------------|--------|--------------------|
| US     | Estados Unidos         | DE     | Alemanha           |
| CA     | Canadá                 | FR     | França             |
| MX     | México                 | IT     | Itália             |
| AR     | Argentina              | ES     | Espanha            |
| CL     | Chile                  | PT     | Portugal           |
| CO     | Colômbia               | GB     | Reino Unido        |
| PE     | Peru                   | NL     | Países Baixos      |
| UY     | Uruguai                | BE     | Bélgica            |
| PY     | Paraguai               | CH     | Suíça              |
| EC     | Equador                | SE     | Suécia             |
| BO     | Bolívia                | NO     | Noruega            |
| VE     | Venezuela              | DK     | Dinamarca          |
| PA     | Panamá                 | FI     | Finlândia          |
| CR     | Costa Rica             | AT     | Áustria            |
| JP     | Japão                  | PL     | Polônia            |
| CN     | China                  | CZ     | República Tcheca   |
| IN     | Índia                  | HU     | Hungria            |
| AU     | Austrália              | RO     | Romênia            |
| NZ     | Nova Zelândia          | GR     | Grécia             |
| KR     | Coreia do Sul          | TR     | Turquia            |
| SG     | Cingapura              | AE     | Emirados Árabes    |
| HK     | Hong Kong              | SA     | Arábia Saudita     |
| TW     | Taiwan                 | IL     | Israel             |
| TH     | Tailândia              | EG     | Egito              |
| MY     | Malásia                | MA     | Marrocos           |
| ID     | Indonésia              | ZA     | África do Sul      |
| PH     | Filipinas              | RU     | Rússia             |

---

## Exemplos de implementação

### cURL

```bash
curl -X POST https://back-exporta.onrender.com/api/public-quote \
  -H "Content-Type: application/json" \
  -H "x-api-key: SUA_CHAVE_AQUI" \
  -d '{
    "peso": 1.5,
    "comprimento": 30,
    "largura": 20,
    "altura": 15,
    "destino": "US"
  }'
```

### JavaScript (fetch)

```javascript
async function buscarFrete({ peso, comprimento, largura, altura, destino }) {
  const response = await fetch('https://back-exporta.onrender.com/api/public-quote', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': 'SUA_CHAVE_AQUI',
    },
    body: JSON.stringify({ peso, comprimento, largura, altura, destino }),
  });

  const data = await response.json();

  if (!data.ok) {
    throw new Error(data.error || 'Erro ao buscar frete');
  }

  return data.options;
}

// Uso no checkout:
const opcoes = await buscarFrete({
  peso: 1.5,
  comprimento: 30,
  largura: 20,
  altura: 15,
  destino: 'US', // código ISO do país selecionado pelo cliente
});

// Exibir no checkout:
opcoes.forEach(opcao => {
  console.log(`${opcao.label} — ${opcao.sla_label}`);
  // "FedEx - USD 41.80 — 7 dias úteis"
  // "UPS - USD 45.20 — 5 dias úteis"
});
```

---

## Observações

- Os preços são retornados em **dólares americanos (USD)**.
- O prazo em `sla_days` é uma estimativa. O prazo exato pode variar conforme alfândega e região de destino.
- Em caso de instabilidade temporária de um carrier, a API retorna as opções do carrier disponível sem falhar (desde que ao menos um responda).
- Para dúvidas ou para gerar novas chaves, entrar em contato com a equipe Intrex.
