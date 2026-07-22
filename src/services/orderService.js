const pool = require('../db/pool');

async function createOrderFromReservation({ reservaId, userId }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const reservaRes = await client.query(
      `SELECT r.*, rf.organization_id, rf.title, rf.id as rifa_id, o.fee_percent
       FROM reservas r
       JOIN rifas rf ON rf.id = r.rifa_id
       JOIN organizations o ON o.id = rf.organization_id
       WHERE r.id = $1 AND r.user_id = $2 FOR UPDATE`,
      [reservaId, userId]
    );
    const reserva = reservaRes.rows[0];
    if (!reserva) throw httpError(404, 'Reserva não encontrada.');
    if (reserva.status !== 'pending') throw httpError(400, 'Esta reserva não está mais disponível para pagamento.');
    if (new Date(reserva.expires_at) < new Date()) throw httpError(400, 'Reserva expirada. Escolha os números novamente.');

    const platformFee = (parseFloat(reserva.total_amount) * (parseFloat(reserva.fee_percent) / 100)).toFixed(2);

    const pedidoRes = await client.query(
      `INSERT INTO pedidos (organization_id, rifa_id, user_id, reserva_id, numbers, quantity, total_amount, platform_fee, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'aguardando_pagamento') RETURNING *`,
      [reserva.organization_id, reserva.rifa_id, userId, reservaId, reserva.numbers, reserva.quantity, reserva.total_amount, platformFee]
    );

    await client.query('COMMIT');
    return pedidoRes.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Confirma o pagamento de um pedido: marca números como vendidos, pedido como pago.
async function markOrderPaid(pedidoId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pedidoRes = await client.query('SELECT * FROM pedidos WHERE id = $1 FOR UPDATE', [pedidoId]);
    const pedido = pedidoRes.rows[0];
    if (!pedido) throw httpError(404, 'Pedido não encontrado.');
    if (pedido.status === 'pago') {
      await client.query('COMMIT');
      return pedido; // idempotente: webhook pode chegar duplicado
    }

    await client.query(`UPDATE pedidos SET status = 'pago', paid_at = now() WHERE id = $1`, [pedidoId]);
    await client.query(
      `UPDATE numeros SET status = 'sold', order_id = $1 WHERE rifa_id = $2 AND number = ANY($3::int[])`,
      [pedidoId, pedido.rifa_id, pedido.numbers]
    );
    if (pedido.reserva_id) {
      await client.query(`UPDATE reservas SET status = 'paid' WHERE id = $1`, [pedido.reserva_id]);
    }
    await client.query(
      `INSERT INTO notificacoes (user_id, title, body) VALUES ($1, $2, $3)`,
      [pedido.user_id, 'Pagamento confirmado!', `Seu pagamento do pedido foi confirmado. Números: ${pedido.numbers.join(', ')}.`]
    );

    await client.query('COMMIT');
    return { ...pedido, status: 'pago' };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

module.exports = { createOrderFromReservation, markOrderPaid };
