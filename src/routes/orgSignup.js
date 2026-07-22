const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const pool = require('../db/pool');
const { hashPassword } = require('../utils/password');
const { signToken } = require('../utils/jwt');

router.get('/criar-loja', (req, res) => {
  res.render('org-signup', { title: 'Criar minha loja de rifas', errors: [], old: {} });
});

router.post(
  '/criar-loja',
  [
    body('store_name').trim().isLength({ min: 3 }).withMessage('Informe o nome da sua loja.'),
    body('slug')
      .trim()
      .isLength({ min: 3 }).withMessage('O endereço da loja precisa ter ao menos 3 caracteres.')
      .matches(/^[a-z0-9-]+$/).withMessage('Use apenas letras minúsculas, números e hífen no endereço da loja.'),
    body('admin_name').trim().isLength({ min: 3 }).withMessage('Informe seu nome completo.'),
    body('email').isEmail().withMessage('E-mail inválido.').normalizeEmail(),
    body('password').isLength({ min: 8 }).withMessage('A senha deve ter ao menos 8 caracteres.'),
    body('terms').equals('on').withMessage('É necessário aceitar os termos de uso.'),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).render('org-signup', { title: 'Criar minha loja de rifas', errors: errors.array(), old: req.body });
    }

    const { store_name, slug, admin_name, email, password } = req.body;
    const RESERVED_SLUGS = ['admin', 'master', 'api', 'webhooks', 'demo', 'www', 'app'];
    if (RESERVED_SLUGS.includes(slug)) {
      return res.status(400).render('org-signup', {
        title: 'Criar minha loja de rifas',
        errors: [{ msg: 'Esse endereço de loja não está disponível, escolha outro.' }],
        old: req.body,
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const existingSlug = await client.query('SELECT id FROM organizations WHERE slug = $1', [slug]);
      if (existingSlug.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).render('org-signup', {
          title: 'Criar minha loja de rifas',
          errors: [{ msg: 'Esse endereço de loja já está em uso, escolha outro.' }],
          old: req.body,
        });
      }

      const orgRes = await client.query(
        `INSERT INTO organizations (name, slug, support_email, plan, status, fee_percent)
         VALUES ($1, $2, $3, 'trial', 'active', 8.00) RETURNING *`,
        [store_name, slug, email]
      );
      const org = orgRes.rows[0];

      await client.query(
        `INSERT INTO configuracoes (organization_id, site_name, seo_title) VALUES ($1, $2, $2)`,
        [org.id, store_name]
      );

      const hash = await hashPassword(password);
      const userRes = await client.query(
        `INSERT INTO users (organization_id, role, name, email, password_hash, email_verified_at)
         VALUES ($1, 'org_admin', $2, $3, $4, now()) RETURNING id, role, organization_id, name, email`,
        [org.id, admin_name, email, hash]
      );
      const user = userRes.rows[0];

      await client.query(
        `INSERT INTO logs (organization_id, user_id, action, ip) VALUES ($1, $2, 'loja_criada_self_service', $3)`,
        [org.id, user.id, req.ip]
      );

      await client.query('COMMIT');

      const token = signToken({ sub: user.id, role: user.role, org: user.organization_id });
      res.cookie('session', token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      res.redirect(`/o/${slug}/admin`);
    } catch (err) {
      await client.query('ROLLBACK');
      next(err);
    } finally {
      client.release();
    }
  }
);

module.exports = router;
