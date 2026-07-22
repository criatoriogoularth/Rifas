const pool = require('../db/pool');

async function listActiveRaffles(organizationId) {
  const { rows } = await pool.query(
    `SELECT r.*,
      (SELECT COUNT(*) FROM numeros n WHERE n.rifa_id = r.id AND n.status = 'sold') AS sold_count
     FROM rifas r
     WHERE r.organization_id = $1 AND r.status = 'active'
     ORDER BY r.created_at DESC`,
    [organizationId]
  );
  return rows;
}

async function getRaffleBySlug(organizationId, slug) {
  const { rows } = await pool.query(
    `SELECT r.*,
      (SELECT COUNT(*) FROM numeros n WHERE n.rifa_id = r.id AND n.status = 'sold') AS sold_count,
      (SELECT COALESCE(json_agg(url ORDER BY position), '[]') FROM rifa_imagens WHERE rifa_id = r.id) AS images
     FROM rifas r
     WHERE r.organization_id = $1 AND r.slug = $2`,
    [organizationId, slug]
  );
  return rows[0];
}

// Retorna o conjunto de números indisponíveis (reservados ou vendidos) — útil para pintar a grade.
async function getUnavailableNumbers(rifaId) {
  const { rows } = await pool.query(
    `SELECT number, status FROM numeros WHERE rifa_id = $1 AND status IN ('reserved', 'sold')`,
    [rifaId]
  );
  return rows;
}

async function pickRandomAvailableNumbers(rifaId, quantity) {
  const rifaRes = await pool.query('SELECT total_numbers FROM rifas WHERE id = $1', [rifaId]);
  const total = rifaRes.rows[0].total_numbers;

  const unavailable = await pool.query(
    `SELECT number FROM numeros WHERE rifa_id = $1 AND status IN ('reserved', 'sold')`,
    [rifaId]
  );
  const taken = new Set(unavailable.rows.map(r => r.number));

  if (total - taken.size < quantity) {
    throw httpError(400, 'Não há números suficientes disponíveis.');
  }

  const chosen = new Set();
  let attempts = 0;
  while (chosen.size < quantity && attempts < quantity * 50) {
    const n = Math.floor(Math.random() * total);
    if (!taken.has(n) && !chosen.has(n)) chosen.add(n);
    attempts++;
  }
  return [...chosen];
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

module.exports = { listActiveRaffles, getRaffleBySlug, getUnavailableNumbers, pickRandomAvailableNumbers };
