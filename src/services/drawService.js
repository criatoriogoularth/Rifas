const crypto = require('crypto');
const pool = require('../db/pool');

// Sorteio "Online": escolhe aleatoriamente entre os números PAGOS, usando uma semente
// aleatória guardada para fins de auditoria/transparência (o organizador pode publicar a seed).
async function drawOnline({ rifaId, adminId }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rifaRes = await client.query('SELECT * FROM rifas WHERE id = $1 FOR UPDATE', [rifaId]);
    const rifa = rifaRes.rows[0];
    if (!rifa) throw httpError(404, 'Rifa não encontrada.');
    if (rifa.status === 'finished') throw httpError(400, 'Esta rifa já foi sorteada.');

    const soldRes = await client.query(
      `SELECT number, user_id FROM numeros WHERE rifa_id = $1 AND status = 'sold' ORDER BY number`,
      [rifaId]
    );
    if (soldRes.rows.length < rifa.min_numbers_to_draw) {
      throw httpError(400, `É necessário vender pelo menos ${rifa.min_numbers_to_draw} números para sortear (vendidos: ${soldRes.rows.length}).`);
    }

    const seed = crypto.randomBytes(16).toString('hex');
    const index = seededRandomIndex(seed, soldRes.rows.length);
    const winner = soldRes.rows[index];

    const sorteioRes = await client.query(
      `INSERT INTO sorteios (rifa_id, type, winning_number, seed, drawn_by)
       VALUES ($1, 'online', $2, $3, $4) RETURNING *`,
      [rifaId, winner.number, seed, adminId]
    );
    const sorteio = sorteioRes.rows[0];

    await client.query(
      `INSERT INTO ganhadores (sorteio_id, rifa_id, user_id, numero) VALUES ($1, $2, $3, $4)`,
      [sorteio.id, rifaId, winner.user_id, winner.number]
    );

    await client.query(`UPDATE rifas SET status = 'finished' WHERE id = $1`, [rifaId]);
    await client.query(
      `INSERT INTO notificacoes (user_id, title, body) VALUES ($1, $2, $3)`,
      [winner.user_id, 'Parabéns, você ganhou!', `Você foi sorteado com o número ${winner.number} na rifa "${rifa.title}".`]
    );

    await client.query('COMMIT');
    return { sorteio, winningNumber: winner.number, winnerId: winner.user_id };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Sorteio "Loteria Federal": o admin informa o concurso e o resultado (5 dezenas do 1º prêmio,
// por exemplo), e o sistema aplica a regra configurada (aqui: últimos dígitos do 1º prêmio,
// ajustável conforme a quantidade de dígitos da rifa) para achar o número vencedor.
async function drawFederal({ rifaId, adminId, concurso, federalResult }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rifaRes = await client.query('SELECT * FROM rifas WHERE id = $1 FOR UPDATE', [rifaId]);
    const rifa = rifaRes.rows[0];
    if (!rifa) throw httpError(404, 'Rifa não encontrada.');
    if (rifa.status === 'finished') throw httpError(400, 'Esta rifa já foi sorteada.');

    const digits = rifa.digits;
    const cleanResult = federalResult.replace(/\D/g, '');
    if (cleanResult.length < digits) {
      throw httpError(400, `Resultado da Loteria Federal precisa ter ao menos ${digits} dígitos.`);
    }
    const winningNumber = parseInt(cleanResult.slice(-digits), 10);

    const numRes = await client.query(
      `SELECT number, user_id, status FROM numeros WHERE rifa_id = $1 AND number = $2`,
      [rifaId, winningNumber]
    );
    if (numRes.rows.length === 0 || numRes.rows[0].status !== 'sold') {
      throw httpError(400, `O número correspondente (${winningNumber}) não foi vendido. Verifique o resultado informado.`);
    }
    const winner = numRes.rows[0];

    const sorteioRes = await client.query(
      `INSERT INTO sorteios (rifa_id, type, concurso, federal_result, winning_number, drawn_by)
       VALUES ($1, 'loteria_federal', $2, $3, $4, $5) RETURNING *`,
      [rifaId, concurso, federalResult, winningNumber, adminId]
    );
    const sorteio = sorteioRes.rows[0];

    await client.query(
      `INSERT INTO ganhadores (sorteio_id, rifa_id, user_id, numero) VALUES ($1, $2, $3, $4)`,
      [sorteio.id, rifaId, winner.user_id, winningNumber]
    );
    await client.query(`UPDATE rifas SET status = 'finished' WHERE id = $1`, [rifaId]);
    await client.query(
      `INSERT INTO notificacoes (user_id, title, body) VALUES ($1, $2, $3)`,
      [winner.user_id, 'Parabéns, você ganhou!', `Você foi sorteado com o número ${winningNumber} na rifa "${rifa.title}" (Loteria Federal, concurso ${concurso}).`]
    );

    await client.query('COMMIT');
    return { sorteio, winningNumber, winnerId: winner.user_id };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function seededRandomIndex(seed, max) {
  const hash = crypto.createHash('sha256').update(seed).digest('hex');
  const num = parseInt(hash.slice(0, 8), 16);
  return num % max;
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

module.exports = { drawOnline, drawFederal };
