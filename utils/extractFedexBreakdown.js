/**
 * Extrai valores de tarifa da resposta da FedEx (Rates ou Ship)
 * Compatível com FedEx API v1/v2 — cobre nested ratedPackages
 */
function extractFedexBreakdown(data, preferredServiceType = null) {
    try {
        if (!data) return null;

        const output = data.output || data;
        const rateDetails = output.rateReplyDetails || output.RateReplyDetails || [];
        if (!Array.isArray(rateDetails) || rateDetails.length === 0) return null;

        // filtra o serviço preferido ou usa o primeiro
        const svc = preferredServiceType
            ? rateDetails.find(r => r.serviceType === preferredServiceType)
            : rateDetails[0];

        if (!svc) return null;

        const rated = Array.isArray(svc.ratedShipmentDetails)
            ? svc.ratedShipmentDetails
            : Array.isArray(svc.RatedShipmentDetails)
                ? svc.RatedShipmentDetails
                : [];

        let chosen = rated.find(r => r.rateType === 'ACCOUNT') || rated[0];
        if (!chosen) return null;

        const det = chosen.shipmentRateDetail || {};
        const baseMain = Number(det.totalBaseCharge || 0);
        const totalMain = Number(det.totalNetCharge || det.totalNetFedExCharge || 0);
        const svcOpts = Number(det.totalSurcharges || 0);
        const currency = det.currency || det.currencyCode || 'USD';

        // --- tenta extrair do nível dos pacotes, se o nível do shipment vier zerado
        let basePkg = 0, totalPkg = 0;
        const ratedPackages = chosen.ratedPackages || [];
        if (ratedPackages.length) {
            for (const pkg of ratedPackages) {
                const pr = pkg.packageRateDetail || {};
                basePkg += Number(pr.baseCharge || pr.netFreight || 0);
                totalPkg += Number(pr.totalNetCharge || pr.netCharge || pr.netFedExCharge || 0);
            }
        }

        const base = baseMain || basePkg || 0;
        const total = totalMain || totalPkg || 0;

        // mapeia surcharges (fuel, demand, etc.)
        const itemized = [];
        const surs = det.surcharges || det.surCharges || [];
        for (const s of surs) {
            itemized.push({
                code: s.type || s.code,
                label: s.description || s.type,
                value: Number(s.amount || 0)
            });
        }

        return {
            currency,
            base,
            total,
            serviceOptions: svcOpts,
            itemized,
            serviceType: svc.serviceType || null,
            _source: 'extractFedexBreakdown'
        };
    } catch (e) {
        console.error('[extractFedexBreakdown][ERROR]', e);
        return null;
    }
}

module.exports = { extractFedexBreakdown };
