const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { verifyPassword } = require('../utils/password');
const { signToken } = require('../utils/jwt');

router.get('/entrar', (req, res) => {
  res.render('superadmin/login', { title: 'Acesso Master', errors: [] });
});

router.post('/entrar', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const { rows } = await pool.query(
      `SELECT * FROM users WHERE role = 'superadmin' AND email = $1`,
      [email]
    );
    const user = rows[0];
    if (!user || !(await verifyPassword(user.password_hash, password))) {
      return res.status(401).render('superadmin/login', { title: 'Acesso Master', errors: [{ msg: 'Credenciais inválidas.' }] });
    }
    const token = signToken({ sub: user.id, role: user.role, org: null });
    res.cookie('session', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    res.redirect('/master');
  } catch (err) { next(err); }
});

router.post('/sair', (req, res) => {
  res.clearCookie('session');
  res.redirect('/master/entrar');
});

module.exports = router;
