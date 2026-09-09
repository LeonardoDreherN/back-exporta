// services/simulacao/index.js
// Simulador de frete + impostos do dashboard do cliente.
//
// Cota UPS e FedEx em paralelo (mesma mecanica da cotacao publica de checkout)
// e, na mesma rodada, pede o EDT da FedEx para estimar o imposto de importacao
// do pais de destino. Nada aqui grava no banco: e so estimativa.

const { quote: upsQuote } = require('../ups/rating');
const { quoteRates: fedexRates } = require('../fedex/ratingFedex');
const { cotarEdt, parseEdt } = require('../fedex/edtFedex');
const { valorConversao } = require('../../utils/dolar');
const { impostosMargemPct, impostosColchaoCambioPct } = require('../featureFlags');
const { resolveDestino, listarDestinos } = require('../../utils/destinosPadrao');

// Origens que as contas UPS/FedEx da Intrex conseguem cotar. A UPS recusa
// cotacao saindo de Florianopolis 88036003 (erro 111217 em todos os servicos);
// saindo de Santo Amaro ela cota normalmente — por isso a origem e fixa por
// pais e nao um endereco livre. Para habilitar uma nova origem basta somar uma
// entrada aqui.
const ORIGENS = {
    BR: {
        code: 'BR',
        nome: 'Brasil',
        name: 'INTREX',
        phone: '47992104226',
        address: 'Rua Saint German, 87',
        city: 'Santo Amaro da Imperatriz',
        state: 'SC',
        postalCode: '88140570',
    },
};

// SLA estimado em dias uteis (a FedEx nem sempre devolve transit time no rate).
const SLA_FEDEX_ICP = 7;
const SLA_UPS_PADRAO = 5;

const UPS_SERVICES = {
    '07': { name: 'Worldwide Express', slaDays: 3 },
    '08': { name: 'Worldwide Expedited', slaDays: 5 },
    '11': { name: 'Standard', slaDays: 7 },
    '54': { name: 'Worldwide Express Plus', slaDays: 2 },
    '65': { name: 'Worldwide Saver', slaDays: 4 },
};

const UPS_SERVICE_CODES = ['65', '08', '07'];

// Desembaraco aduaneiro cobrado pela transportadora, em USD. E fixo por
// transportadora e vale para qualquer destino — nao entra no rate nem no EDT,
// entao precisa ser somado aqui. Valores mudam: da para sobrescrever por env
// sem mexer no codigo.
const DESEMBARACO_USD = {
    FEDEX: Number(process.env.SIMULACAO_DESEMBARACO_FEDEX_USD) || 15,
    UPS: Number(process.env.SIMULACAO_DESEMBARACO_UPS_USD) || 3,
};

// Limites do simulador. Express internacional nao aceita volume acima disso,
// entao barramos antes de gastar chamada de transportadora.
const LIMITES = {
    maxCaixas: 20,
    pesoMinKg: 0.1,
    pesoMaxKg: 70,
    dimMinCm: 1,
    dimMaxCm: 274,
    valorMin: 1,
    valorMax: 1000000,
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const num = (v) => {
    const n = Number(String(v ?? '').replace(',', '.'));
    return Number.isFinite(n) ? n : NaN;
};

/** Erro de entrada do usuario: vira 400 no controller, nao 500. */
class SimulacaoInputError extends Error {
    constructor(message) {
        super(message);
        this.name = 'SimulacaoInputError';
        this.status = 400;
    }
}

function listarOrigens() {
    return Object.values(ORIGENS).map((o) => ({
        code: o.code,
        nome: o.nome,
        cidade: o.city,
    }));
}

/**
 * Valida e normaliza as caixas informadas no modal.
 * @returns {{ comprimento:number, largura:number, altura:number, peso:number,
 *             quantidade:number, cubadoKg:number, taxavelKg:number }[]}
 */
function normalizarCaixas(caixas) {
    const lista = Array.isArray(caixas) ? caixas : [];
    if (!lista.length) throw new SimulacaoInputError('Informe ao menos uma caixa');
    if (lista.length > LIMITES.maxCaixas) {
        throw new SimulacaoInputError(`Maximo de ${LIMITES.maxCaixas} caixas por simulacao`);
    }

    return lista.map((c, i) => {
        const pos = i + 1;
        const comprimento = num(c.comprimento ?? c.length);
        const largura = num(c.largura ?? c.width);
        const altura = num(c.altura ?? c.height);
        const peso = num(c.peso ?? c.pesoKg ?? c.weightKg);
        const quantidade = Math.trunc(num(c.quantidade ?? c.qtd ?? 1)) || 1;

        for (const [nome, v] of [['comprimento', comprimento], ['largura', largura], ['altura', altura]]) {
            if (!Number.isFinite(v) || v < LIMITES.dimMinCm || v > LIMITES.dimMaxCm) {
                throw new SimulacaoInputError(
                    `Caixa ${pos}: ${nome} deve estar entre ${LIMITES.dimMinCm} e ${LIMITES.dimMaxCm} cm`
                );
            }
        }
        if (!Number.isFinite(peso) || peso < LIMITES.pesoMinKg || peso > LIMITES.pesoMaxKg) {
            throw new SimulacaoInputError(
                `Caixa ${pos}: peso deve estar entre ${LIMITES.pesoMinKg} e ${LIMITES.pesoMaxKg} kg`
            );
        }
        if (quantidade < 1 || quantidade > LIMITES.maxCaixas) {
            throw new SimulacaoInputError(`Caixa ${pos}: quantidade invalida`);
        }

        // Divisor 5000 e o padrao aereo internacional de UPS e FedEx.
        const cubadoKg = round3((comprimento * largura * altura) / 5000);

        return {
            comprimento,
            largura,
            altura,
            peso,
            quantidade,
            cubadoKg,
            taxavelKg: round3(Math.max(peso, cubadoKg)),
        };
    });
}

/** Expande quantidade em volumes individuais (a transportadora cota volume a volume). */
function expandirVolumes(caixas) {
    const volumes = [];
    for (const c of caixas) {
        for (let i = 0; i < c.quantidade; i++) {
            volumes.push({
                comprimento: c.comprimento,
                largura: c.largura,
                altura: c.altura,
                pesoTaxavel: c.taxavelKg,
            });
        }
    }
    if (volumes.length > LIMITES.maxCaixas) {
        throw new SimulacaoInputError(`Maximo de ${LIMITES.maxCaixas} volumes por simulacao`);
    }
    return volumes;
}

function totaisDePeso(caixas) {
    let real = 0;
    let cubado = 0;
    let taxavel = 0;
    for (const c of caixas) {
        real += c.peso * c.quantidade;
        cubado += c.cubadoKg * c.quantidade;
        taxavel += c.taxavelKg * c.quantidade;
    }
    return { real: round3(real), cubado: round3(cubado), taxavel: round3(taxavel) };
}

/* ---------- UPS ---------- */

function ratedShipmentToRates(r) {
    const serviceCode = String(r?.Service?.Code || '').trim();
    const currency = r?.TotalCharges?.CurrencyCode || 'USD';
    const published = round2(r?.TotalCharges?.MonetaryValue || 0);
    const negotiated = round2(
        r?.NegotiatedRateCharges?.TotalCharge?.MonetaryValue ||
        r?.TotalCharges?.MonetaryValue || 0
    );
    const baseRaw = round2(
        r?.NegotiatedRateCharges?.BaseServiceCharge?.MonetaryValue ||
        r?.TransportationCharges?.MonetaryValue || 0
    );
    const base = baseRaw > 0 ? baseRaw : negotiated;
    const info = UPS_SERVICES[serviceCode] ||
        { name: serviceCode ? `Internacional ${serviceCode}` : 'Internacional', slaDays: SLA_UPS_PADRAO };

    return {
        negotiated,
        published,
        currency,
        base,
        surcharges: round2(Math.max(0, negotiated - base)),
        slaDays: info.slaDays,
        service: info.name,
    };
}

function extractUpsRates(upsRaw) {
    const rs = upsRaw?.RateResponse?.RatedShipment;
    const arr = Array.isArray(rs) ? rs : (rs ? [rs] : []);
    const rates = arr.map(ratedShipmentToRates).filter((r) => r.negotiated > 0);
    if (!rates.length) return null;
    rates.sort((a, b) => a.negotiated - b.negotiated);
    return rates[0];
}

function montarPayloadUps({ origem, destino, volumes }) {
    const shipToAddr = {
        CountryCode: destino.code,
        ...(destino.city ? { City: destino.city } : {}),
        ...(destino.state ? { StateProvinceCode: destino.state } : {}),
        ...(destino.postalCode ? { PostalCode: destino.postalCode } : {}),
    };

    return {
        RateRequest: {
            Request: {
                RequestOption: 'Rate',
                TransactionReference: { CustomerContext: 'intrex-simulacao' },
            },
            Shipment: {
                Shipper: {
                    Name: origem.name,
                    ShipperNumber: process.env.UPS_ACCOUNT_NUMBER,
                    Address: {
                        AddressLine: [origem.address],
                        City: origem.city,
                        StateProvinceCode: origem.state,
                        PostalCode: origem.postalCode,
                        CountryCode: origem.code,
                    },
                },
                // Sem ShipFrom de proposito: quando ele existe a UPS valida a
                // origem por ele em vez de pelo endereco do Shipper.
                ShipTo: { Name: 'Destinatario', Address: shipToAddr },
                ShipmentRatingOptions: { NegotiatedRatesIndicator: 'Y' },
                Package: volumes.map((v) => ({
                    PackagingType: { Code: '02' },
                    PackageWeight: {
                        UnitOfMeasurement: { Code: 'KGS' },
                        Weight: String(v.pesoTaxavel),
                    },
                    Dimensions: {
                        UnitOfMeasurement: { Code: 'CM' },
                        Length: String(v.comprimento),
                        Width: String(v.largura),
                        Height: String(v.altura),
                    },
                })),
            },
        },
    };
}

// Cada Service.Code em paralelo; fica a mais barata que responder. O endpoint
// Shop (catalogo por rota) responde 111100 nesta conta, por isso a varredura.
async function cotarUps(basePayload) {
    const tentativas = await Promise.allSettled(
        UPS_SERVICE_CODES.map((code) => upsQuote({
            ...basePayload,
            RateRequest: {
                ...basePayload.RateRequest,
                Shipment: { ...basePayload.RateRequest.Shipment, Service: { Code: code } },
            },
        }))
    );

    const rates = [];
    const falhas = [];

    tentativas.forEach((t, i) => {
        if (t.status === 'fulfilled') {
            const rate = extractUpsRates(t.value);
            if (rate) rates.push(rate);
        } else {
            falhas.push(`${UPS_SERVICE_CODES[i]}: ${t.reason?.message || 'sem resposta'}`);
        }
    });

    if (!rates.length) throw new Error(falhas.join(' | ') || 'UPS nao retornou cotacao');

    rates.sort((a, b) => a.negotiated - b.negotiated);
    return rates[0];
}

/* ---------- FedEx ---------- */

function extractFedexRates(fedexResp) {
    const rows = fedexResp?.rows || [];
    const raw = fedexResp?.raw;

    const icpRow =
        rows.find((r) => r?.serviceType === 'FEDEX_INTERNATIONAL_CONNECT_PLUS') || rows[0];
    if (!icpRow) return null;

    const negotiated = round2(icpRow.total || 0);
    const baseRaw = round2(icpRow.base || 0);
    const base = baseRaw > 0 ? baseRaw : negotiated;

    let published = negotiated;
    const details = raw?.output?.rateReplyDetails || [];
    const svc = details.find((d) => d?.serviceType === 'FEDEX_INTERNATIONAL_CONNECT_PLUS') || details[0];
    const listRated = svc?.ratedShipmentDetails?.find((r) => r.rateType === 'LIST');
    if (listRated) {
        const toNum = (v) => {
            const n = Number(v?.amount ?? v);
            return Number.isFinite(n) ? n : null;
        };
        const totalRaw =
            toNum(listRated?.ratedPackages?.[0]?.packageRateDetail?.totalNetCharge) ??
            toNum(listRated?.shipmentRateDetail?.totalNetCharge) ??
            toNum(listRated?.totalNetCharge) ?? 0;

        if (totalRaw > 0) {
            const fx = Number(listRated?.shipmentRateDetail?.currencyExchangeRate?.rate);
            const carrierCurrency = String(listRated?.currency || 'USD').toUpperCase();
            published = (Number.isFinite(fx) && fx > 0 && carrierCurrency === 'BRL')
                ? round2(totalRaw / fx)
                : round2(totalRaw);
        }
    }

    return {
        negotiated,
        published,
        currency: icpRow.currency || 'USD',
        base,
        surcharges: round2(Math.max(0, negotiated - base)),
        slaDays: SLA_FEDEX_ICP,
        service: 'International Connect Plus',
    };
}

function montarEnderecosFedex({ origem, destino }) {
    return {
        shipper: {
            contact: { companyName: origem.name, phoneNumber: origem.phone },
            address: {
                streetLines: [origem.address],
                city: origem.city,
                stateOrProvinceCode: origem.state,
                postalCode: origem.postalCode,
                countryCode: origem.code,
            },
        },
        recipient: {
            contact: { companyName: 'Destinatario' },
            address: {
                streetLines: [destino.city],
                city: destino.city,
                ...(destino.state ? { stateOrProvinceCode: destino.state } : {}),
                ...(destino.postalCode ? { postalCode: destino.postalCode } : {}),
                countryCode: destino.code,
                residential: false,
            },
        },
    };
}

/* ---------- Impostos (FedEx EDT) ---------- */

/**
 * Estimativa de imposto do destino em duas leituras: o bruto que a alfandega
 * cobraria (EDT puro) e o valor que a Intrex cobraria na antecipacao, ja com
 * margem de seguranca e colchao de cambio.
 */
async function estimarImpostosSimulacao({ shipper, recipient, packages, commodities, moeda }) {
    const edtResp = await cotarEdt({ shipper, recipient, packages, commodities, currency: moeda });
    const edt = parseEdt(edtResp);

    const margemPct = impostosMargemPct();
    const colchaoPct = impostosColchaoCambioPct();

    const brutoUsd = round2(edt.total);
    const comMargemUsd = round2(brutoUsd * (1 + margemPct / 100));

    let fx = Number(await valorConversao());
    if (!Number.isFinite(fx) || fx <= 0) fx = 0;

    return {
        disponivel: true,
        provider: 'FEDEX_EDT',
        moeda: edt.currency || 'USD',
        duties: round2(edt.duties),
        taxes: round2(edt.taxes),
        fees: round2(edt.fees),
        breakdown: edt.breakdown || [],
        de_minimis: brutoUsd === 0,

        bruto_usd: brutoUsd,
        bruto_brl: round2(brutoUsd * fx),

        margem_pct: margemPct,
        colchao_cambio_pct: colchaoPct,
        intrex_usd: comMargemUsd,
        intrex_brl: round2(comMargemUsd * fx * (1 + colchaoPct / 100)),

        fx,
        fx_fonte: 'awesomeapi',
        is_estimate: true,
    };
}

/* ---------- Simulacao ---------- */

/**
 * @param {{
 *   origem?: string,
 *   destino: string,
 *   caixas: any[],
 *   valorDeclarado: number|string,
 *   moeda?: string,
 *   descricao?: string,
 *   ncm?: string,
 * }} entrada
 */
async function simular(entrada = {}) {
    const {
        origem: origemInput = 'BR',
        destino: destinoInput,
        caixas: caixasInput,
        valorDeclarado,
        moeda: moedaInput = 'USD',
        descricao,
        ncm,
    } = entrada;

    const origem = ORIGENS[String(origemInput || 'BR').trim().toUpperCase()];
    if (!origem) {
        throw new SimulacaoInputError(
            `Origem nao suportada: ${origemInput}. Origens disponiveis: ${Object.keys(ORIGENS).join(', ')}`
        );
    }

    // Antes de resolver: senao um destino igual a origem cai em "destino nao
    // reconhecido" (o pais de origem nao esta na tabela de destinos).
    if (String(destinoInput || '').trim().toUpperCase() === origem.code) {
        throw new SimulacaoInputError('Origem e destino nao podem ser o mesmo pais');
    }

    const destino = resolveDestino(destinoInput);
    if (!destino) {
        throw new SimulacaoInputError(`Destino nao reconhecido: ${destinoInput || '(vazio)'}`);
    }

    const valor = num(valorDeclarado);
    if (!Number.isFinite(valor) || valor < LIMITES.valorMin || valor > LIMITES.valorMax) {
        throw new SimulacaoInputError(
            `Valor declarado deve estar entre ${LIMITES.valorMin} e ${LIMITES.valorMax}`
        );
    }

    const moeda = String(moedaInput || 'USD').trim().toUpperCase() || 'USD';
    const caixas = normalizarCaixas(caixasInput);
    const volumes = expandirVolumes(caixas);
    const pesos = totaisDePeso(caixas);

    const { shipper, recipient } = montarEnderecosFedex({ origem, destino });

    const packagesFedex = volumes.map((v) => ({
        weightKg: v.pesoTaxavel,
        dimCm: { length: v.comprimento, width: v.largura, height: v.altura },
    }));

    const commodities = [{
        description: String(descricao || '').trim().slice(0, 60) || 'General Merchandise',
        quantity: volumes.length,
        quantityUnits: 'PCS',
        weight: { units: 'KG', value: pesos.taxavel || 0.1 },
        unitPrice: { amount: round2(valor / (volumes.length || 1)), currency: moeda },
        customsValue: { amount: round2(valor), currency: moeda },
        countryOfManufacture: origem.code,
        ...(ncm ? { harmonizedCode: String(ncm).replace(/\D/g, '') } : {}),
    }];

    const [upsResult, fedexResult, impostoResult] = await Promise.allSettled([
        cotarUps(montarPayloadUps({ origem, destino, volumes })),
        fedexRates({ shipper, recipient, packages: packagesFedex, commodities, currency: moeda }),
        estimarImpostosSimulacao({ shipper, recipient, packages: packagesFedex, commodities, moeda }),
    ]);

    const fretes = [];
    const avisos = [];

    if (upsResult.status === 'fulfilled') {
        const r = upsResult.value;
        fretes.push({
            carrier: 'UPS',
            servico: r.service,
            moeda: r.currency,
            total: r.negotiated,
            tabela: r.published,
            base: r.base,
            surcharges: r.surcharges,
            prazo_dias: r.slaDays,
        });
    } else {
        console.error('[SIMULACAO][UPS]', upsResult.reason?.message);
        avisos.push('UPS indisponivel para esta rota no momento.');
    }

    if (fedexResult.status === 'fulfilled') {
        const r = extractFedexRates(fedexResult.value);
        if (r) {
            fretes.push({
                carrier: 'FEDEX',
                servico: r.service,
                moeda: r.currency,
                total: r.negotiated,
                tabela: r.published,
                base: r.base,
                surcharges: r.surcharges,
                prazo_dias: r.slaDays,
            });
        } else {
            avisos.push('FedEx nao retornou tarifa para esta rota.');
        }
    } else {
        console.error('[SIMULACAO][FEDEX]', fedexResult.reason?.message);
        avisos.push('FedEx indisponivel para esta rota no momento.');
    }

    let impostos = { disponivel: false, is_estimate: true };
    if (impostoResult.status === 'fulfilled') {
        impostos = impostoResult.value;
        if (impostos.de_minimis) {
            avisos.push(
                'A alfandega do destino nao apontou imposto para este valor declarado (possivel de minimis).'
            );
        }
    } else {
        console.error('[SIMULACAO][EDT]', impostoResult.reason?.message);
        avisos.push('Nao foi possivel estimar os impostos do destino agora.');
    }

    if (!fretes.length) {
        const err = new Error('Nenhuma transportadora retornou cotacao para esta rota.');
        err.status = 502;
        err.avisos = avisos;
        throw err;
    }

    // A FedEx sempre normaliza para USD, mas a UPS devolve na moeda de
    // faturamento da conta — que numa conta BR pode vir em BRL. Somar ou
    // ordenar os dois pelo numero cru daria resultado errado, entao tudo passa
    // por conversao explicita. Sem cambio disponivel devolvemos null em vez de
    // chutar um valor.
    let fx = impostos.disponivel ? Number(impostos.fx) : 0;
    if (!Number.isFinite(fx) || fx <= 0) {
        fx = Number(await valorConversao().catch(() => 0)) || 0;
    }

    const paraUsd = (valor, moedaFrete) => {
        if (moedaFrete === 'USD') return round2(valor);
        if (moedaFrete === 'BRL') return fx ? round2(valor / fx) : null;
        return null;
    };
    const paraBrl = (valor, moedaFrete) => {
        if (moedaFrete === 'BRL') return round2(valor);
        if (moedaFrete === 'USD') return fx ? round2(valor * fx) : null;
        return null;
    };

    const moedasMisturadas = new Set(fretes.map((f) => f.moeda)).size > 1;

    fretes.sort((a, b) => {
        if (!moedasMisturadas) return a.total - b.total;
        const av = paraUsd(a.total, a.moeda);
        const bv = paraUsd(b.total, b.moeda);
        if (av == null || bv == null) return 0; // sem cambio: nao reordena
        return av - bv;
    });

    if (moedasMisturadas && !fx) {
        avisos.push('Transportadoras cotaram em moedas diferentes e o cambio esta indisponivel: nao da para compara-las agora.');
    }

    // Landed cost: frete + desembaraco + imposto, que e a leitura que o cliente
    // quer. O desembaraco fica em linha propria: e taxa da transportadora, nao
    // tributo do destino, e o valor muda conforme quem leva.
    const totais = fretes.map((f) => {
        const freteUsd = paraUsd(f.total, f.moeda);
        const freteBrl = paraBrl(f.total, f.moeda);

        const desembaracoUsd = round2(DESEMBARACO_USD[f.carrier] ?? 0);
        const desembaracoBrl = fx ? round2(desembaracoUsd * fx) : null;

        const impostoUsd = impostos.disponivel ? impostos.intrex_usd : null;
        const impostoBrl = impostos.disponivel ? impostos.intrex_brl : null;

        return {
            carrier: f.carrier,
            moeda_frete: f.moeda,
            frete_usd: freteUsd,
            frete_brl: freteBrl,
            desembaraco_usd: desembaracoUsd,
            desembaraco_brl: desembaracoBrl,
            imposto_usd: impostoUsd,
            imposto_brl: impostoBrl,
            total_usd: (freteUsd != null && impostoUsd != null)
                ? round2(freteUsd + desembaracoUsd + impostoUsd)
                : null,
            total_brl: (freteBrl != null && impostoBrl != null && desembaracoBrl != null)
                ? round2(freteBrl + desembaracoBrl + impostoBrl)
                : null,
        };
    });

    return {
        ok: true,
        entrada: {
            origem: { code: origem.code, nome: origem.nome, cidade: origem.city },
            destino: { code: destino.code, nome: destino.nomePt, cidade: destino.city },
            caixas,
            volumes: volumes.length,
            peso_real_kg: pesos.real,
            peso_cubado_kg: pesos.cubado,
            peso_taxavel_kg: pesos.taxavel,
            valor_declarado: round2(valor),
            moeda,
            descricao: commodities[0].description,
            ncm: commodities[0].harmonizedCode || null,
        },
        fretes,
        impostos,
        totais,
        avisos,
        simulado_em: new Date().toISOString(),
    };
}

module.exports = {
    simular,
    listarOrigens,
    listarDestinos,
    LIMITES,
    SimulacaoInputError,
};
