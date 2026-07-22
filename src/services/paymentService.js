const axios = require('axios');
const pool = require('../db/pool');

const MP_API = 'https://api.mercadopago.com';

// Cada organização pode ter seu próprio access_token do Mercado Pago (organizations.mp_access_token).
// Se não tiver, cai no token global da plataforma (modo "conta mestre", útil para o plano SaaS
// centralizado antes do organizador conectar a própria conta).
function resolveAccessToken(org) {
  return org.mp_access_token || process.env.MP_ACCESS_TOKEN;
}

async function createPixPayment({ pedido, org, payerEmail, payerCpf, payerName }) {
  const accessToken = resolveAccessToken(org);
  if (!accessToken) {
    throw httpError(500, 'Gateway de pagamento não configurado para esta organização.');
  }

  const idempotencyKey = pedido.id;

  const payload = {
    transaction_amount: parseFloat(pedido.total_amount),
    description: `Rifa - Pedido ${pedido.id}`,
    payment_method_id: 'pix',
    payer: {
      email: payerEmail,
      first_name: payerName?.split(' ')[0] || 'Cliente',
      identification: payerCpf ? { type: 'CPF', number: payerCpf.replace(/\D/g, '') } : undefined,
    },
    notification_url: `${process.env.APP_URL}/webhooks/mercadopago`,
    external_reference: pedido.id,
  };

  const { data } = await axios.post(`${MP_API}/v1/payments`, payload, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': idempotencyKey,
    },
  });

  const txData = data.point_of_interaction?.transaction_data || {};

  const pagamentoRes = await pool.query(
    `INSERT INTO pagamentos (pedido_id, method, gateway, gateway_payment_id, status, amount, raw_payload)
     VALUES ($1, 'pix', 'mercadopago', $2, $3, $4, $5) RETURNING *`,
    [pedido.id, String(data.id), mapStatus(data.status), pedido.total_amount, JSON.stringify(data)]
  );
  const pagamento = pagamentoRes.rows[0];

  await pool.query(
    `INSERT INTO pix (pagamento_id, qr_code, qr_code_base64, copia_e_cola, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [pagamento.id, txData.qr_code, txData.qr_code_base64, txData.qr_code, data.date_of_expiration]
  );

  return {
    pagamento,
    qrCode: txData.qr_code,
    qrCodeBase64: txData.qr_code_base64,
    copiaECola: txData.qr_code,
  };
}

function mapStatus(mpStatus) {
  const map = {
    approved: 'approved',
    pending: 'pending',
    in_process: 'pending',
    rejected: 'rejected',
    cancelled: 'cancelled',
    refunded: 'refunded',
  };
  return map[mpStatus] || 'pending';
}

// Consulta o status atual de um pagamento diretamente na API (usado pelo webhook, nunca confiamos
// apenas no payload recebido — sempre confirmamos buscando na API do gateway).
async function fetchPaymentStatus(gatewayPaymentId, org) {
  const accessToken = resolveAccessToken(org);
  const { data } = await axios.get(`${MP_API}/v1/payments/${gatewayPaymentId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data;
}

function isGatewayConfigured(org) {
  return !!resolveAccessToken(org);
}

// Modo de desenvolvimento: cria um "pagamento" fake (sem chamar o Mercado Pago) para permitir
// testar o fluxo de compra ponta a ponta localmente, sem precisar de um Access Token ainda.
// Só deve ser usado quando ALLOW_SIMULATED_PAYMENTS=true (nunca em produção).
async function createSimulatedPixPayment({ pedido }) {
  const fakeCode = `00020126580014BR.GOV.BCB.PIX-SIMULADO-${pedido.id.slice(0, 8)}-${Date.now()}5204000053039865802BR5920TESTE SIMULADO6009SAO PAULO`;

  const pagamentoRes = await pool.query(
    `INSERT INTO pagamentos (pedido_id, method, gateway, gateway_payment_id, status, amount, raw_payload)
     VALUES ($1, 'pix', 'simulado', $2, 'pending', $3, $4) RETURNING *`,
    [pedido.id, `sim_${pedido.id}`, pedido.total_amount, JSON.stringify({ simulated: true })]
  );
  const pagamento = pagamentoRes.rows[0];

  await pool.query(
    `INSERT INTO pix (pagamento_id, qr_code, qr_code_base64, copia_e_cola, expires_at)
     VALUES ($1, $2, NULL, $3, now() + interval '15 minutes')`,
    [pagamento.id, fakeCode, fakeCode]
  );

  return { pagamento, qrCode: fakeCode, qrCodeBase64: null, copiaECola: fakeCode, simulated: true };
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

module.exports = { createPixPayment, fetchPaymentStatus, resolveAccessToken, mapStatus, isGatewayConfigured, createSimulatedPixPayment };
