const pool = require('../db/pool');

const RESERVATION_MINUTES = parseInt(process.env.RESERVATION_MINUTES || '15', 10);

// Reserva números de forma segura contra concorrência (SELECT ... FOR UPDATE dentro de transação).
// Suporta rifas "virtuais" (total_numbers grande, ex: 100000) sem precisar pré-popular a tabela `numeros`:
// só inserimos linhas em `numeros` quando um número é reservado/vendido pela primeira vez.
async function reserveNumbers({ rifaId, userId, numbers }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const rifaRes = await client.query('SELECT * FROM rifas WHERE id = $1 FOR UPDATE', [rifaId]);
    const rifa = rifaRes.rows[0];
    if (!rifa) throw httpError(404, 'Rifa não encontrada.');
    if (rifa.status !== 'active') throw httpError(400, 'Esta rifa não está ativa para vendas.');

    const uniqueNumbers = [...new Set(numbers)];
    for (const n of uniqueNumbers) {
      if (n < 0 || n >= rifa.total_numbers) {
        throw httpError(400, `Número ${n} fora do intervalo desta rifa.`);
      }
    }

    // Trava as linhas existentes desses números (se houver) para evitar corrida.
    const existing = await client.query(
      `SELECT number, status FROM numeros WHERE rifa_id = $1 AND number = ANY($2::int[]) FOR UPDATE`,
      [rifaId, uniqueNumbers]
    );
    const taken = existing.rows.filter(r => r.status !== 'available').map(r => r.number);
    if (taken.length > 0) {
      throw httpError(409, `Os números ${taken.join(', ')} não estão mais disponíveis.`);
    }

    const expiresAt = new Date(Date.now() + RESERVATION_MINUTES * 60 * 1000);
    const totalAmount = (parseFloat(rifa.price_per_number) * uniqueNumbers.length).toFixed(2);

    const reservaRes = await client.query(
      `INSERT INTO reservas (rifa_id, user_id, numbers, quantity, total_amount, status, expires_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6) RETURNING *`,
      [rifaId, userId, uniqueNumbers, uniqueNumbers.length, totalAmount, expiresAt]
    );
    const reserva = reservaRes.rows[0];

    // Upsert das linhas de número como "reserved"
    for (const n of uniqueNumbers) {
      await client.query(
        `INSERT INTO numeros (rifa_id, number, status, user_id, reservation_id)
         VALUES ($1, $2, 'reserved', $3, $4)
         ON CONFLICT (rifa_id, number)
         DO UPDATE SET status = 'reserved', user_id = $3, reservation_id = $4`,
        [rifaId, n, userId, reserva.id]
      );
    }

    await client.query('COMMIT');
    return reserva;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Libera reservas expiradas (chamado por um sweeper periódico).
async function releaseExpiredReservations() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const expired = await client.query(
      `SELECT id FROM reservas WHERE status = 'pending' AND expires_at < now() FOR UPDATE`
    );
    for (const row of expired.rows) {
      await client.query(`UPDATE reservas SET status = 'expired' WHERE id = $1`, [row.id]);
      await client.query(
        `UPDATE numeros SET status = 'available', user_id = NULL, reservation_id = NULL
         WHERE reservation_id = $1`,
        [row.id]
      );
    }
    await client.query('COMMIT');
    if (expired.rows.length > 0) {
      console.log(`[reservas] ${expired.rows.length} reserva(s) expirada(s) liberada(s).`);
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erro ao liberar reservas expiradas:', err);
  } finally {
    client.release();
  }
}

function startExpirySweeper() {
  const intervalMs = 60 * 1000; // a cada 1 minuto
  setInterval(releaseExpiredReservations, intervalMs);
  console.log('[reservas] sweeper de expiração iniciado (a cada 60s).');
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

module.exports = { reserveNumbers, releaseExpiredReservations, startExpirySweeper, RESERVATION_MINUTES };
