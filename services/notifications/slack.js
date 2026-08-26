// services/notifications/slack.js
// Envia alertas pro Slack via Incoming Webhook. Sem SLACK_WEBHOOK_URL
// configurado, vira no-op silencioso — não trava nada que já funciona.
const SEVERITY_EMOJI = {
  critical: '🔴',
  warning: '🟡',
  success: '🟢',
  info: 'ℹ️',
};

async function enviarAlertaSlack({ title, message, severity = 'info' }) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;

  const emoji = SEVERITY_EMOJI[severity] || SEVERITY_EMOJI.info;

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `${emoji} *${title}*${message ? `\n${message}` : ''}`,
      }),
    });
    if (!res.ok) {
      console.error(`[Slack] webhook respondeu HTTP ${res.status}`);
    }
  } catch (e) {
    console.error('[Slack] falha ao enviar alerta:', e.message);
  }
}

module.exports = { enviarAlertaSlack };
