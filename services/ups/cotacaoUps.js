const { default: axios } = require("axios");
const { Cotacao, Cliente, sequelize } = require("../../models");
const { onlyDigits } = require("../../utils/cnpj");
const { extractUpsBreakdown } = require("../../utils/extractUpsBreakdown");
const { cotarCarrier } = require("../carriers");
const { toNumSafe, up, normalizeTimeToHHMM, iso2Country, splitEndereco } = require("../cotacoesHelpers");
const { getUpsToken } = require("../upsAuth");
const { cleanPostal } = require("../../utils/postalcode");

const SHIPPER_NUMBER = process.env.UPS_ACCOUNT_NUMBER

// Substitui Package.PackageWeight.Weight no rate_payload pela soma pesoTotalKg,
// distribuída igualmente entre os pacotes. Não muta o original.
function overrideUpsPackageWeight(payload, pesoTotalKg) {
    const total = Number(pesoTotalKg);
    if (!Number.isFinite(total) || total <= 0) return payload;

    const rr = payload?.RateRequest;
    if (!rr?.Shipment?.Package) return payload;

    const pkgArr = Array.isArray(rr.Shipment.Package)
        ? rr.Shipment.Package
        : [rr.Shipment.Package];

    const perPkg = Number((total / pkgArr.length).toFixed(3));

    const newPkgs = pkgArr.map((pkg, i) => {
        const weight = i === pkgArr.length - 1
            ? Number((total - perPkg * (pkgArr.length - 1)).toFixed(3))
            : perPkg;
        return {
            ...pkg,
            PackageWeight: {
                ...(pkg.PackageWeight || {}),
                UnitOfMeasurement: pkg.PackageWeight?.UnitOfMeasurement || { Code: 'KGS' },
                Weight: String(weight),
            },
        };
    });

    return {
        ...payload,
        RateRequest: {
            ...rr,
            Shipment: {
                ...rr.Shipment,
                Package: pkgArr.length === 1 ? newPkgs[0] : newPkgs,
            },
        },
    };
}

async function prepararCotacaoUPS({ req, rate_payload, preco_base, freightValueNum, pesoTotalPedidoKg }) {
    let precoBase = null;      // valor base retornado/override
    let carrierResp = null;    // resposta do adapter UPS
    let breakdown = null;      // resultado do extractUpsBreakdown

    const precoBaseOverride = toNumSafe(preco_base ?? freightValueNum);
    const overrideUsado = Number.isFinite(precoBaseOverride);

    if (overrideUsado) {
        // Usuário mandou a BASE manualmente (override)
        precoBase = precoBaseOverride;

        if (rate_payload) {
            try {
                const rateRaw =
                    rate_payload?.RateResponse ||
                    rate_payload?.rateResponse ||
                    rate_payload?.raw ||
                    rate_payload;

                breakdown = extractUpsBreakdown(rateRaw);
            } catch (_) {
                // ignora, segue só com override
            }
        }
    } else if (rate_payload) {
        // Não tem override, então chamamos o adapter UPS (cotarCarrier)
        try {
            const payloadParaCotar = Number(pesoTotalPedidoKg) > 0
                ? overrideUpsPackageWeight(rate_payload, pesoTotalPedidoKg)
                : rate_payload;
            carrierResp = await cotarCarrier({ payload: payloadParaCotar });

            const rateRaw =
                carrierResp?.raw?.RateResponse || carrierResp?.raw?.rateResponse
                    ? carrierResp.raw
                    : rate_payload;

            breakdown = extractUpsBreakdown(rateRaw);

            const baseFromBreakdown = Number.isFinite(breakdown?.base)
                ? Number(breakdown.base)
                : null;

            // Se não houver breakdown.base, ficamos com 0 (controller valida depois)
            precoBase = baseFromBreakdown ?? 0;
        } catch (e) {
            const status = e?.response?.status || 502;
            const upstream = e?.upstream || e?.response?.data;
            const msg =
                upstream?.message ||
                upstream?.error_description ||
                upstream?.error ||
                e.message;

            const err = new Error(msg);
            err.status = status;
            err.upstream = upstream;
            throw err;
        }
    } else {
        const err = new Error(
            'Envie preco_base (ou freightValueNum) OU rate_payload para cotação.'
        );
        err.status = 400;
        throw err;
    }

    if (!Number.isFinite(precoBase)) {
        const err = new Error('Carrier não retornou preço base');
        err.status = 400;
        throw err;
    }

    // ===== Consolida valores UPS =====
    const upsBase = Number.isFinite(breakdown?.base)
        ? Number(breakdown.base)
        : toNumSafe(precoBase) ?? 0;

    const upsTotal =
        toNumSafe(breakdown?.total) ??
        toNumSafe(carrierResp?.negotiated) ??
        toNumSafe(carrierResp?.published) ??
        toNumSafe(carrierResp?.amount) ??
        ((Number.isFinite(breakdown?.base) ? toNumSafe(breakdown.base) : 0) +
            (Number.isFinite(breakdown?.serviceOptions)
                ? toNumSafe(breakdown.serviceOptions)
                : 0) +
            (Array.isArray(breakdown?.itemized)
                ? breakdown.itemized.reduce(
                    (a, b) => a + (toNumSafe(b.value) || 0),
                    0
                )
                : 0)) ??
        upsBase;

    const upsTaxesTotal = Math.max(0, upsTotal - upsBase);

    const currency = breakdown?.currency || 'USD';

    const svc = Number(breakdown?.serviceOptions) || 0;
    const items = Array.isArray(breakdown?.itemized)
        ? breakdown.itemized.map((it) => ({
            code: up(it.code ?? it.Code ?? ''),
            label:
                it.label ??
                it.Description ??
                it.code ??
                'Surcharge',
            value: Number(it.value ?? it.MonetaryValue ?? 0) || 0,
        }))
        : [];

    let totalCalc =
        Number(breakdown?.total) ||
        (upsBase + svc + items.reduce((a, b) => a + (b.value || 0), 0));

    const hasRealItemized = items.length > 0;
    const consolidatedItems = [...items];

    if (!hasRealItemized) {
        const diff = Math.max(0, totalCalc - upsBase - svc);
        if (diff > 0.009) {
            consolidatedItems.unshift({
                code: 'UPS-SUR',
                label: 'UPS surcharges (consolidado)',
                value: diff,
            });
        }
    }

    const savedSurcharges = {
        currency: currency || 'USD',
        base: Number.isFinite(breakdown?.base) ? Number(breakdown.base) : upsBase,
        serviceOptions: svc,
        itemized: consolidatedItems, // taxas negociadas/publicadas ou consolidado
        total: totalCalc, // negociado se houver
    };

    const carrierRawToSave =
        (carrierResp && (carrierResp.raw || carrierResp)) ||
        rate_payload ||
        null;

    return {
        carrier: 'UPS',
        base: upsBase,
        total: upsTotal,
        taxesTotal: upsTaxesTotal,
        currency,
        surcharges: savedSurcharges,
        carrier_raw: carrierRawToSave,
        fonte_base: overrideUsado ? 'OVERRIDE' : 'UPS',
        serviceCode: "08",
    };
}

function normalizePickupServiceCode(serviceCode) {
    const s = String(serviceCode || "").trim();
    if (!s) return "";
    return s.padStart(3, "0");
}

function getItensTotalKgFromCotacao(cotacao) {
    const pedido = cotacao?.pedido || {};
    const manual = Number(pedido?.peso_total_kg);
    if (manual > 0) return manual;

    const itens = Array.isArray(pedido?.itens) ? pedido.itens : [];
    return itens.reduce((acc, it) => {
        const candidates = [
            it.peso_kg,
            it.weightKg,
            it.grams != null ? Number(it.grams) / 1000 : undefined,
            it.peso,
            it.pesoBruto,
        ];
        const unitKg =
            (candidates.map((v) => Number(v || 0)).find((v) => v > 0)) || 0;
        const qty = Number(it.qty || it.quantidade || 1) || 1;
        return acc + qty * unitKg;
    }, 0);
}

function extractUpsServiceCode(carrierRaw) {
    if (!carrierRaw) return "";

    if (typeof carrierRaw === "string") {
        try {
            carrierRaw = JSON.parse(carrierRaw);
        } catch {
            return "";
        }
    }

    const rated = carrierRaw?.RateResponse?.RatedShipment;

    if (Array.isArray(rated)) {
        return rated[0]?.Service?.Code || "";
    }

    return rated?.Service?.Code || "";
}

async function agendarPickupCotacao(req, res) {
    const t = await sequelize.transaction();
    try {
        const cotacaoId = Number(req.params.id || req.body.cotacaoId);
        if (!cotacaoId) {
            await t.rollback();
            return res.status(400).json({ ok: false, error: "cotacaoId inválido." });
        }

        const { pickupDate, readyTime, closeTime, serviceCode: serviceCodeBody } =
            req.body || {};

        if (!pickupDate) {
            await t.rollback();
            return res
                .status(400)
                .json({ ok: false, error: "pickupDate é obrigatório." });
        }

        // carrega cotacao + cliente (remetente)
        const cotacao = await Cotacao.findByPk(cotacaoId, {
            transaction: t,
        });

        if (!cotacao) {
            await t.rollback();
            return res
                .status(404)
                .json({ ok: false, error: "Cotação não encontrada." });
        }

        if (cotacao.carrier !== "UPS") {
            await t.rollback();
            return res.status(400).json({
                ok: false,
                error: "Agendamento de coleta disponível apenas para UPS no momento.",
            });
        }

        const cliente = await Cliente.findByPk(cotacao.cliente_id, {
            transaction: t,
        });

        if (!cliente) {
            await t.rollback();
            return res
                .status(404)
                .json({ ok: false, error: "Cliente da cotação não encontrado." });
        }

        // Montar remetente a partir do Cliente
        const remetente = {
            nome: cliente.razaoSocial || cliente.nomeFantasia || "Remetente",
            telefone: cliente.telefoneCelular || cliente.telefone || "",
            rua: cliente.enderecoRua || "",
            numero: cliente.enderecoNumero || "",
            cidade: cliente.enderecoCidade || "",
            estado: cliente.enderecoEstado || "",
            cep: onlyDigits(cliente.enderecoCEP),
            pais: iso2Country(cliente.enderecoPais || "BR"),
            email: cliente.emailPrincipal || "",
        };

        const pedido = cotacao.pedido || {};
        const dest = pedido?.endereco || pedido?.shipping_address || {};
        const destinatario = {
            nome: dest.nome || dest.name || pedido.nomeComprador || "Destinatário",
            telefone: dest.telefone || dest.phone || pedido.telefoneComprador || "17865994231",
            rua: splitEndereco(dest.rua || dest.address1 || pedido.endereco || "").rua,
            numero: splitEndereco(dest.rua || dest.address1 || pedido.rua || "").numero,
            cidade: dest.cidade || pedido.cidade || "",
            estado: dest.estado || pedido.estado || "",
            cep: cleanPostal(dest.pais || pedido.pais, pedido.CEP || ""),
            pais:
                iso2Country(dest.pais || pedido.pais) || "",
            email: dest.emailComprador || pedido.emailComprador || "",
        };

        const okPessoa = (p) =>
            p.nome && p.rua && p.cidade && p.estado && p.cep && p.pais;

        if (!okPessoa(remetente)) {
            await t.rollback();
            return res.status(400).json({
                ok: false,
                error: "Cadastro do remetente incompleto para agendar coleta.",
            });
        }
        if (!okPessoa(destinatario)) {
            await t.rollback();
            return res.status(400).json({
                ok: false,
                error: "Endereço do destinatário incompleto para agendar coleta.",
            });
        }

        const pickupYMD = String(pickupDate).replace(/-/g, "");
        const ready = normalizeTimeToHHMM(readyTime);
        const close = normalizeTimeToHHMM(closeTime);

        if (ready >= close) {
            await t.rollback();
            return res.status(400).json({
                ok: false,
                error: "O horário inicial deve ser menor que o horário final.",
            });
        }

        const totalKg = getItensTotalKgFromCotacao(cotacao);
        if (!totalKg || totalKg <= 0) {
            await t.rollback();
            return res.status(400).json({
                ok: false,
                error: "Peso total dos itens não encontrado para o pickup.",
            });
        }

        const pickupAddressLine = [remetente.rua, remetente.numero]
            .filter(Boolean)
            .join(", ")
            .slice(0, 35);

        const serviceCode =
            cotacao?.serviceCode ||
            cotacao?.service_code ||
            ""; // fallback


        const pickUpPayload = {
            PickupCreationRequest: {
                RatePickupIndicator: "N",
                Shipper: {
                    Account: {
                        AccountNumber: SHIPPER_NUMBER || "",
                        AccountCountryCode: iso2Country(remetente.pais),
                    },
                },
                PickupDateInfo: {
                    CloseTime: close,
                    ReadyTime: ready,
                    PickupDate: pickupYMD,
                },
                PickupAddress: {
                    CompanyName: remetente.nome,
                    ContactName: remetente.nome,
                    AddressLine: pickupAddressLine || "",
                    Room: "",
                    Floor: "",
                    City: remetente.cidade,
                    StateProvince: remetente.estado.toUpperCase(),
                    Urbanization: "",
                    PostalCode: onlyDigits(remetente.cep),
                    CountryCode: iso2Country(remetente.pais),
                    ResidentialIndicator: "N",
                    PickupPoint: "",
                    Phone: {
                        Number: remetente.telefone,
                        Extension: "",
                    },
                },
                AlternateAddressIndicator: "N",
                PickupPiece: [
                    {
                        ServiceCode: normalizePickupServiceCode(serviceCode),
                        Quantity: "1", // ou derive de cotacao.caixa.length se você salvar esse array lá
                        DestinationCountryCode: iso2Country(destinatario.pais),
                        ContainerCode: "01",
                    },
                ],
                TotalWeight: {
                    Weight: String(totalKg),
                    UnitOfMeasurement: "KGS",
                },
                OverweightIndicator: "N",
                PaymentMethod: "01",
                SpecialInstruction: "Pickup solicitado pelo sistema Intrex",
                ReferenceNumber: cotacao.tracking_number || String(cotacao.id),
                Notification: {
                    ConfirmationEmailAddress: remetente.email,
                    UndeliverableEmailAddress: remetente.email,
                },
                CSR: {
                    ProfileId: "",
                    ProfileCountryCode: iso2Country(remetente.pais),
                },
            },
        };

        const url =
            "https://onlinetools.ups.com/api/pickupcreation/v2407/pickup";
        const transId = `pickup-${Date.now()}`;
        let token = await getUpsToken();

        const doPost = (bearer) =>
            axios.post(url, pickUpPayload, {
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                    Authorization: `Bearer ${bearer}`,
                    transId,
                    transactionSrc: "exporta-digital",
                },
                timeout: 20000,
            });

        let resp;
        try {
            resp = await doPost(token);
        } catch (e) {
            const status = e?.response?.status;
            if (status === 401) {
                token = await getUpsToken(true);
                resp = await doPost(token);
            } else {
                throw e;
            }
        }

        const upsData = resp.data || {};

        // Atualiza apenas a cotação existente (SEM recriar)
        await cotacao.update(
            {
                data_coleta: pickupYMD,
                ready_hora: ready,
                close_hora: close,
                pickup_raw: upsData, // se quiser criar esse campo JSONB
            },
            { transaction: t }
        );

        await t.commit();
        return res.json({
            ok: true,
            cotacao_id: cotacao.id,
            pickup: upsData,
        });
    } catch (err) {
        console.error("[COTACAO][PICKUP][ERROR] MESSAGE:", err?.message);
        console.error("[COTACAO][PICKUP][ERROR] STATUS:", err?.response?.status);

        if (err?.response?.data) {
            console.error(
                "[COTACAO][PICKUP][ERROR] DATA:",
                JSON.stringify(err.response.data, null, 2)
            );

            const errors = err.response.data?.response?.errors;
            if (Array.isArray(errors)) {
                console.error(
                    "[COTACAO][PICKUP][ERROR] FIRST ERROR:",
                    JSON.stringify(errors[0], null, 2)
                );
            }
        }

        try {
            await t.rollback();
        } catch (e2) {
            console.error("[COTACAO][PICKUP][ROLLBACK_ERROR]", e2?.message);
        }

        const status = err?.response?.status || 500;
        const raw = err?.response?.data || err;

        return res.status(status).json({
            ok: false,
            error:
                raw?.response?.errors?.[0]?.description ||
                raw?.response?.errors?.[0]?.message ||
                raw?.message ||
                "Falha ao agendar pickup na UPS.",
            raw,
        });
    }
}

module.exports = {
    prepararCotacaoUPS,
    agendarPickupCotacao
};
