const express = require('express');
const router = express.Router({ mergeParams: true });
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { hashPassword, verifyPassword } = require('../utils/password');

router.get('/minha-conta', requireAuth, async (req, res, next) => {
  try {
    const pedidos = await pool.query(
      `SELECT p.*, r.title as rifa_title FROM pedidos p
       JOIN rifas r ON r.id = p.rifa_id
       WHERE p.user_id = $1 AND p.organization_id = $2
       ORDER BY p.created_at DESC`,
      [req.user.id, req.org.id]
    );
    const notificacoes = await pool.query(
      `SELECT * FROM notificacoes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10`,
      [req.user.id]
    );
    res.render('account/dashboard', { title: 'Minha Conta', pedidos: pedidos.rows, notificacoes: notificacoes.rows });
  } catch (err) { next(err); }
});

router.get('/minha-conta/dados', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    res.render('account/profile', { title: 'Meus Dados', profile: rows[0], errors: [] });
  } catch (err) { next(err); }
});

router.post('/minha-conta/dados', requireAuth, async (req, res, next) => {
  try {
    const { name, phone, cpf } = req.body;
    await pool.query('UPDATE users SET name = $1, phone = $2, cpf = $3, updated_at = now() WHERE id = $4', [name, phone, cpf, req.user.id]);
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    res.render('account/profile', { title: 'Meus Dados', profile: rows[0], errors: [], success: true });
  } catch (err) { next(err); }
});

router.post('/minha-conta/senha', requireAuth, async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body;
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    const user = rows[0];
    const ok = await verifyPassword(user.password_hash, current_password);
    if (!ok) {
      return res.status(400).render('account/profile', { title: 'Meus Dados', profile: user, errors: [{ msg: 'Senha atual incorreta.' }] });
    }
    if (!new_password || new_password.length < 8) {
      return res.status(400).render('account/profile', { title: 'Meus Dados', profile: user, errors: [{ msg: 'A nova senha deve ter ao menos 8 caracteres.' }] });
    }
    const hash = await hashPassword(new_password);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);
    res.render('account/profile', { title: 'Meus Dados', profile: user, errors: [], success: true });
  } catch (err) { next(err); }
});

module.exports = router;
