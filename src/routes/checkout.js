const express = require('express');
const router = express.Router({ mergeParams: true });
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const reservationService = require('../services/reservationService');
const raffleService = require('../services/raffleService');
const orderService = require('../services/orderService');
const paymentService = require('../services/paymentService');

// Escolha manual ou automática de números -> cria reserva
router.post('/rifas/:slug/reservar', requireAuth, async (req, res, next) => {
  try {
    const rifa = await raffleService.getRaffleBySlug(req.org.id, req.params.slug);
    if (!rifa) return res.status(404).render('errors/404', { title: 'Rifa não encontrada' });

    let numbers;
    if (req.body.mode === 'auto') {
      const quantity = Math.max(1, parseInt(req.body.quantity || '1', 10));
      numbers = await raffleService.pickRandomAvailableNumbers(rifa.id, quantity);
    } else {
      numbers = (req.body.numbers || '')
        .split(',')
        .map(n => parseInt(n.trim(), 10))
        .filter(n => !isNaN(n));
    }
    if (numbers.length === 0) {
      req.flash = 'Selecione ao menos um número.';
      return res.redirect(`/o/${req.org.slug}/rifas/${rifa.slug}`);
    }

    const reserva = await reservationService.reserveNumbers({ rifaId: rifa.id, userId: req.user.id, numbers });
    res.redirect(`/o/${req.org.slug}/checkout/${reserva.id}`);
  } catch (err) {
    if (err.status) {
      const rifa = await raffleService.getRaffleBySlug(req.org.id, req.params.slug);
      const unavailable = await raffleService.getUnavailableNumbers(rifa.id);
      return res.status(err.status).render('raffle', { title: rifa.title, rifa, unavailable, error: err.message });
    }
    next(err);
  }
});

router.get('/checkout/:reservaId', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.*, rf.title as rifa_title, rf.slug as rifa_slug
       FROM reservas r JOIN rifas rf ON rf.id = r.rifa_id
       WHERE r.id = $1 AND r.user_id = $2`,
      [req.params.reservaId, req.user.id]
    );
    const reserva = rows[0];
    if (!reserva) return res.status(404).render('errors/404', { title: 'Reserva não encontrada' });
    res.render('checkout', { title: 'Finalizar compra', reserva });
  } catch (err) { next(err); }
});

const SIMULATE = process.env.ALLOW_SIMULATED_PAYMENTS === 'true' || (process.env.NODE_ENV !== 'production' && process.env.ALLOW_SIMULATED_PAYMENTS !== 'false');

router.post('/checkout/:reservaId/pagar', requireAuth, async (req, res, next) => {
  try {
    const pedido = await orderService.createOrderFromReservation({ reservaId: req.params.reservaId, userId: req.user.id });

    let payment;
    if (!paymentService.isGatewayConfigured(req.org) && SIMULATE) {
      payment = await paymentService.createSimulatedPixPayment({ pedido });
    } else {
      payment = await paymentService.createPixPayment({
        pedido,
        org: req.org,
        payerEmail: req.user.email,
        payerCpf: req.user.cpf,
        payerName: req.user.name,
      });
    }

    res.render('payment-pix', {
      title: 'Pagamento PIX',
      pedido,
      qrCodeBase64: payment.qrCodeBase64,
      copiaECola: payment.copiaECola,
      simulated: !!payment.simulated,
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).render('errors/500', { title: 'Erro no pagamento', message: err.message });
    }
    next(err);
  }
});

// Marca um pagamento simulado como pago instantaneamente — só existe em modo de desenvolvimento,
// pra testar o fluxo de compra completo sem precisar do Mercado Pago configurado.
router.post('/pedidos/:pedidoId/simular-pagamento', requireAuth, async (req, res, next) => {
  try {
    if (!SIMULATE) return res.status(403).render('errors/403', { title: 'Não disponível' });
    const { rows } = await pool.query('SELECT * FROM pedidos WHERE id = $1 AND user_id = $2', [req.params.pedidoId, req.user.id]);
    const pedido = rows[0];
    if (!pedido) return res.status(404).render('errors/404', { title: 'Pedido não encontrado' });

    await pool.query(
      `UPDATE pagamentos SET status = 'approved', updated_at = now() WHERE pedido_id = $1`,
      [pedido.id]
    );
    await orderService.markOrderPaid(pedido.id);
    res.redirect(`/o/${req.org.slug}/minha-conta`);
  } catch (err) { next(err); }
});

// Polling simples de status do pedido (chamado via JS na tela de pagamento)
router.get('/pedidos/:pedidoId/status', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT status FROM pedidos WHERE id = $1 AND user_id = $2',
      [req.params.pedidoId, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'not_found' });
    res.json({ status: rows[0].status });
  } catch (err) { next(err); }
});

module.exports = router;
