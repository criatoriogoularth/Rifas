const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');
const { hashPassword } = require('../utils/password');

const guard = [requireAuth, requireRole('superadmin')];

router.get('/', guard, async (req, res, next) => {
  try {
    const orgs = await pool.query(`SELECT COUNT(*) FROM organizations`);
    const orgsAtivas = await pool.query(`SELECT COUNT(*) FROM organizations WHERE status = 'active'`);
    const receita = await pool.query(`SELECT COALESCE(SUM(platform_fee),0) as total FROM pedidos WHERE status = 'pago'`);
    const volume = await pool.query(`SELECT COALESCE(SUM(total_amount),0) as total FROM pedidos WHERE status = 'pago'`);
    res.render('superadmin/dashboard', {
      title: 'Painel Master',
      totalOrgs: orgs.rows[0].count,
      orgsAtivas: orgsAtivas.rows[0].count,
      receita: receita.rows[0].total,
      volume: volume.rows[0].total,
    });
  } catch (err) { next(err); }
});

router.get('/organizacoes', guard, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT o.*,
        (SELECT COUNT(*) FROM rifas WHERE organization_id = o.id) as total_rifas,
        (SELECT COALESCE(SUM(total_amount),0) FROM pedidos WHERE organization_id = o.id AND status='pago') as volume_vendido
       FROM organizations o ORDER BY o.created_at DESC`
    );
    res.render('superadmin/organizacoes', { title: 'Organizações', orgs: rows });
  } catch (err) { next(err); }
});

router.get('/organizacoes/nova', guard, (req, res) => {
  res.render('superadmin/org-form', { title: 'Nova Organização', errors: [] });
});

router.post('/organizacoes', guard, async (req, res, next) => {
  try {
    const { name, slug, support_email, admin_name, admin_email, admin_password, fee_percent } = req.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const org = await client.query(
        `INSERT INTO organizations (name, slug, support_email, fee_percent, status, plan)
         VALUES ($1,$2,$3,$4,'active','trial') RETURNING id`,
        [name, slug, support_email, fee_percent || 8]
      );
      const hash = await hashPassword(admin_password);
      await client.query(
        `INSERT INTO users (organization_id, role, name, email, password_hash, email_verified_at)
         VALUES ($1, 'org_admin', $2, $3, $4, now())`,
        [org.rows[0].id, admin_name, admin_email, hash]
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    res.redirect('/master/organizacoes');
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).render('superadmin/org-form', { title: 'Nova Organização', errors: [{ msg: 'Já existe uma organização com esse slug ou e-mail.' }] });
    }
    next(err);
  }
});

router.post('/organizacoes/:id/status', guard, async (req, res, next) => {
  try {
    const { status } = req.body; // active, suspended, cancelled
    await pool.query('UPDATE organizations SET status = $1, updated_at = now() WHERE id = $2', [status, req.params.id]);
    res.redirect('/master/organizacoes');
  } catch (err) { next(err); }
});

router.post('/organizacoes/:id/taxa', guard, async (req, res, next) => {
  try {
    await pool.query('UPDATE organizations SET fee_percent = $1, updated_at = now() WHERE id = $2', [req.body.fee_percent, req.params.id]);
    res.redirect('/master/organizacoes');
  } catch (err) { next(err); }
});

router.get('/logs', guard, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT l.*, o.name as org_name FROM logs l LEFT JOIN organizations o ON o.id = l.organization_id
       ORDER BY l.created_at DESC LIMIT 300`
    );
    res.render('superadmin/logs', { title: 'Logs & Auditoria', logs: rows });
  } catch (err) { next(err); }
});

module.exports = router;
