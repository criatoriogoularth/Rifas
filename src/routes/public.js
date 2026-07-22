const express = require('express');
const router = express.Router({ mergeParams: true });
const pool = require('../db/pool');
const raffleService = require('../services/raffleService');

router.get('/', async (req, res, next) => {
  try {
    const raffles = await raffleService.listActiveRaffles(req.org.id);
    const winnersRes = await pool.query(
      `SELECT g.numero, u.name, r.title, g.created_at
       FROM ganhadores g
       JOIN users u ON u.id = g.user_id
       JOIN rifas r ON r.id = g.rifa_id
       WHERE r.organization_id = $1
       ORDER BY g.created_at DESC LIMIT 6`,
      [req.org.id]
    );
    const statsRes = await pool.query(
      `SELECT COUNT(*) AS total_orders, COALESCE(SUM(total_amount),0) AS total_paid
       FROM pedidos WHERE organization_id = $1 AND status = 'pago'`,
      [req.org.id]
    );
    res.render('home', {
      title: req.org.name,
      raffles,
      winners: winnersRes.rows,
      stats: statsRes.rows[0],
    });
  } catch (err) { next(err); }
});

router.get('/rifas/:slug', async (req, res, next) => {
  try {
    const rifa = await raffleService.getRaffleBySlug(req.org.id, req.params.slug);
    if (!rifa) return res.status(404).render('errors/404', { title: 'Rifa não encontrada' });
    const unavailable = await raffleService.getUnavailableNumbers(rifa.id);
    res.render('raffle', { title: rifa.title, rifa, unavailable });
  } catch (err) { next(err); }
});

router.get('/ganhadores', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT g.numero, u.name, r.title, g.created_at
       FROM ganhadores g
       JOIN users u ON u.id = g.user_id
       JOIN rifas r ON r.id = g.rifa_id
       WHERE r.organization_id = $1
       ORDER BY g.created_at DESC`,
      [req.org.id]
    );
    res.render('winners', { title: 'Ganhadores', winners: rows });
  } catch (err) { next(err); }
});

router.get('/como-funciona', (req, res) => {
  res.render('how-it-works', { title: 'Como Funciona' });
});

module.exports = router;
