const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const paymentService = require('../services/paymentService');
const orderService = require('../services/orderService');

// Mercado Pago envia notificações do tipo ?type=payment&data.id=XXXX (ou no corpo).
// Nunca confiamos apenas no payload recebido: sempre buscamos o status oficial na API
// usando o access_token da organização correspondente, para evitar fraude de webhook forjado.
router.post('/mercadopago', async (req, res) => {
  try {
    const paymentId = req.query['data.id'] || req.body?.data?.id || req.body?.id;
    if (!paymentId) return res.sendStatus(200); // ignora eventos irrelevantes sem erro

    const pagamentoRes = await pool.query(
      `SELECT pg.*, p.organization_id FROM pagamentos pg
       JOIN pedidos p ON p.id = pg.pedido_id
       WHERE pg.gateway_payment_id = $1`,
      [String(paymentId)]
    );
    const pagamentoLocal = pagamentoRes.rows[0];
    if (!pagamentoLocal) return res.sendStatus(200);

    const orgRes = await pool.query('SELECT * FROM organizations WHERE id = $1', [pagamentoLocal.organization_id]);
    const org = orgRes.rows[0];

    const mpPayment = await paymentService.fetchPaymentStatus(paymentId, org);
    const status = paymentService.mapStatus(mpPayment.status);

    await pool.query(
      `UPDATE pagamentos SET status = $1, raw_payload = $2, updated_at = now() WHERE id = $3`,
      [status, JSON.stringify(mpPayment), pagamentoLocal.id]
    );

    if (status === 'approved') {
      await orderService.markOrderPaid(pagamentoLocal.pedido_id);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('Erro no webhook Mercado Pago:', err.message);
    // Retorna 200 mesmo em erro interno para evitar reenvio agressivo do gateway;
    // o erro fica registrado no log do servidor para investigação manual.
    res.sendStatus(200);
  }
});

module.exports = router;
