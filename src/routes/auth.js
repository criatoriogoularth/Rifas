const express = require('express');
const router = express.Router({ mergeParams: true });
const { body, validationResult } = require('express-validator');
const pool = require('../db/pool');
const { hashPassword, verifyPassword } = require('../utils/password');
const { signToken } = require('../utils/jwt');

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

router.get('/cadastrar', (req, res) => {
  res.render('auth/register', { title: 'Criar conta', errors: [], old: {} });
});

router.post(
  '/cadastrar',
  [
    body('name').trim().isLength({ min: 3 }).withMessage('Informe seu nome completo.'),
    body('email').isEmail().withMessage('E-mail inválido.').normalizeEmail(),
    body('cpf').trim().isLength({ min: 11, max: 14 }).withMessage('CPF inválido.'),
    body('password').isLength({ min: 8 }).withMessage('A senha deve ter ao menos 8 caracteres.'),
    body('lgpd').equals('on').withMessage('É necessário aceitar os termos (LGPD).'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).render('auth/register', {
          title: 'Criar conta',
          errors: errors.array(),
          old: req.body,
        });
      }
      const { name, email, cpf, phone, password } = req.body;

      const existing = await pool.query(
        'SELECT id FROM users WHERE organization_id = $1 AND email = $2',
        [req.org.id, email]
      );
      if (existing.rows.length > 0) {
        return res.status(400).render('auth/register', {
          title: 'Criar conta',
          errors: [{ msg: 'Já existe uma conta com este e-mail.' }],
          old: req.body,
        });
      }

      const hash = await hashPassword(password);
      const { rows } = await pool.query(
        `INSERT INTO users (organization_id, role, name, cpf, email, phone, password_hash)
         VALUES ($1, 'customer', $2, $3, $4, $5, $6) RETURNING id, role, organization_id, name, email`,
        [req.org.id, name, cpf, email, phone, hash]
      );
      const user = rows[0];

      await pool.query(
        `INSERT INTO logs (organization_id, user_id, action, ip) VALUES ($1, $2, 'cadastro', $3)`,
        [req.org.id, user.id, req.ip]
      );

      issueSession(res, user);
      res.redirect('/o/' + req.org.slug + '/');
    } catch (err) { next(err); }
  }
);

router.get('/entrar', (req, res) => {
  res.render('auth/login', { title: 'Entrar', errors: [], old: {}, next: req.query.next || '' });
});

router.post(
  '/entrar',
  [body('email').isEmail().normalizeEmail(), body('password').notEmpty()],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).render('auth/login', {
          title: 'Entrar', errors: [{ msg: 'Preencha e-mail e senha corretamente.' }], old: req.body, next: req.body.next || '',
        });
      }
      const { email, password } = req.body;

      const { rows } = await pool.query(
        `SELECT * FROM users WHERE organization_id = $1 AND email = $2`,
        [req.org.id, email]
      );
      const user = rows[0];
      const genericError = [{ msg: 'E-mail ou senha inválidos.' }];

      if (!user) {
        return res.status(401).render('auth/login', { title: 'Entrar', errors: genericError, old: req.body, next: req.body.next || '' });
      }
      if (user.blocked) {
        return res.status(403).render('auth/login', { title: 'Entrar', errors: [{ msg: 'Conta bloqueada. Contate o suporte.' }], old: req.body, next: '' });
      }
      if (user.locked_until && new Date(user.locked_until) > new Date()) {
        return res.status(403).render('auth/login', { title: 'Entrar', errors: [{ msg: 'Conta temporariamente bloqueada por tentativas inválidas. Tente novamente mais tarde.' }], old: req.body, next: '' });
      }

      const ok = await verifyPassword(user.password_hash, password);
      if (!ok) {
        const attempts = (user.failed_login_attempts || 0) + 1;
        const lockUntil = attempts >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCK_MINUTES * 60000) : null;
        await pool.query(
          'UPDATE users SET failed_login_attempts = $1, locked_until = $2 WHERE id = $3',
          [attempts, lockUntil, user.id]
        );
        return res.status(401).render('auth/login', { title: 'Entrar', errors: genericError, old: req.body, next: req.body.next || '' });
      }

      await pool.query('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1', [user.id]);
      await pool.query(
        `INSERT INTO acessos (user_id, ip, user_agent) VALUES ($1, $2, $3)`,
        [user.id, req.ip, req.headers['user-agent']]
      );

      issueSession(res, user);
      const dest = req.body.next && req.body.next.startsWith('/o/') ? req.body.next : `/o/${req.org.slug}/minha-conta`;
      res.redirect(dest);
    } catch (err) { next(err); }
  }
);

router.post('/sair', (req, res) => {
  res.clearCookie('session');
  res.redirect(`/o/${req.org.slug}/`);
});

function issueSession(res, user) {
  const token = signToken({ sub: user.id, role: user.role, org: user.organization_id });
  res.cookie('session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

module.exports = router;
