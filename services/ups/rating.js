const { createHttp } = require('../../utils/https');
const { getToken } = require('./oauth');
const cfg = require('../../config/ups');

const http = createHttp(cfg.timeoutMs);

// tenta extrair a melhor mensagem de erro possível do payload da UPS
function extractUpsMessage(err) {
    const data = err?.response?.data;
    if (!data) return null;

    return (
        // Formato JSON comum da UPS
        data?.response?.errors?.[0]?.message ||
        data?.response?.errors?.[0]?.code ||
        // Alguns serviços antigos SOAP/JSON
        data?.Fault?.detail?.Errors?.ErrorDetail?.PrimaryErrorCode?.Description ||
        data?.Fault?.detail ||
        // OAuth/Genérico
        data?.error_description ||
        data?.error ||
        null
    );
}

async function quote(payload) {
    try {
        const token = await getToken();

        const res = await http.post(
            cfg.rate,           // URL do endpoint de Rating (ex.: https://.../rate)
            payload,            // payload já mapeado no controller
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    // Cabeçalho opcional que ajuda em suporte/trace
                    transactionSrc: 'back-exporta',
                },
                timeout: cfg.timeoutMs || 30000,
            }
        );

        return res.data; // normalize no controller, se quiser
    } catch (err) {
        const status = err?.response?.status || 500;
        const data = err?.response?.data;
        const headers = err?.response?.headers;

        // Log detalhado no servidor para debug rápido
        console.error('UPS RATE error =>', {
            status,
            correlation:
                headers?.['transId'] ||
                headers?.['x-correlation-id'] ||
                headers?.['x-transaction-id'] ||
                null,
            data,
        });

        const e = new Error(extractUpsMessage(err) || `UPS Rate failed with status ${status}`);
        e.status = status;
        e.details = data;
        throw e;
    }
}

module.exports = { quote };
