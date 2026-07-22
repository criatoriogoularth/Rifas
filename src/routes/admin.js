const express = require('express');
const router = express.Router({ mergeParams: true });
const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');
const { requireSameOrg } = require('../middleware/tenant');
const { upload, buildUploadUrl } = require('../middleware/upload');
const drawService = require('../services/drawService');

const guard = [requireAuth, requireRole('org_admin', 'superadmin'), requireSameOrg];

router.get('/', guard, async (req, res, next) => {
  try {
    const orgId = req.org.id;
    const vendas = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE status='pago') AS vendas_pagas,
              COUNT(*) FILTER (WHERE status='aguardando_pagamento') AS aguardando,
              COALESCE(SUM(total_amount) FILTER (WHERE status='pago'), 0) AS valor_vendido,
              COALESCE(SUM(platform_fee) FILTER (WHERE status='pago'), 0) AS taxa_plataforma
       FROM pedidos WHERE organization_id = $1`,
      [orgId]
    );
    const rifasAtivas = await pool.query(`SELECT COUNT(*) FROM rifas WHERE organization_id = $1 AND status = 'active'`, [orgId]);
    const clientes = await pool.query(`SELECT COUNT(*) FROM users WHERE organization_id = $1 AND role = 'customer'`, [orgId]);
    const recentes = await pool.query(
      `SELECT p.*, u.name as cliente, r.title as rifa_title FROM pedidos p
       JOIN users u ON u.id = p.user_id JOIN rifas r ON r.id = p.rifa_id
       WHERE p.organization_id = $1 ORDER BY p.created_at DESC LIMIT 10`,
      [orgId]
    );
    res.render('admin/dashboard', {
      title: 'Painel Administrativo',
      metrics: vendas.rows[0],
      rifasAtivas: rifasAtivas.rows[0].count,
      clientes: clientes.rows[0].count,
      recentes: recentes.rows,
    });
  } catch (err) { next(err); }
});

// ---------- RIFAS ----------
router.get('/rifas', guard, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.*, (SELECT COUNT(*) FROM numeros n WHERE n.rifa_id = r.id AND n.status='sold') as vendidos
       FROM rifas r WHERE r.organization_id = $1 ORDER BY r.created_at DESC`,
      [req.org.id]
    );
    res.render('admin/rifas-list', { title: 'Gerenciar Rifas', rifas: rows });
  } catch (err) { next(err); }
});

router.get('/rifas/nova', guard, (req, res) => {
  res.render('admin/rifa-form', { title: 'Nova Rifa', rifa: {}, errors: [] });
});

router.post('/rifas', guard, async (req, res, next) => {
  try {
    const { title, description, regulation, price_per_number, total_numbers, digits, min_numbers_to_draw, draw_type, draw_date } = req.body;
    const slug = slugify(title) + '-' + uuidv4().slice(0, 6);
    await pool.query(
      `INSERT INTO rifas (organization_id, title, slug, description, regulation, price_per_number, total_numbers, digits, min_numbers_to_draw, draw_type, draw_date, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'draft')`,
      [req.org.id, title, slug, description, regulation, price_per_number, total_numbers, digits || String(total_numbers).length, min_numbers_to_draw || 1, draw_type || 'online', draw_date || null]
    );
    res.redirect(`/o/${req.org.slug}/admin/rifas`);
  } catch (err) { next(err); }
});

router.post('/rifas/:id/status', guard, async (req, res, next) => {
  try {
    const { status } = req.body; // active, paused, closed, cancelled, draft
    await pool.query(
      `UPDATE rifas SET status = $1, updated_at = now() WHERE id = $2 AND organization_id = $3`,
      [status, req.params.id, req.org.id]
    );
    res.redirect(`/o/${req.org.slug}/admin/rifas`);
  } catch (err) { next(err); }
});

router.get('/rifas/:id/editar', guard, async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM rifas WHERE id = $1 AND organization_id = $2', [req.params.id, req.org.id]);
    if (!rows[0]) return res.status(404).render('errors/404', { title: 'Rifa não encontrada' });
    res.render('admin/rifa-form', { title: 'Editar Rifa', rifa: rows[0], errors: [] });
  } catch (err) { next(err); }
});

router.post('/rifas/:id/editar', guard, async (req, res, next) => {
  try {
    const { title, description, regulation, price_per_number, min_numbers_to_draw, draw_type, draw_date } = req.body;
    await pool.query(
      `UPDATE rifas SET title=$1, description=$2, regulation=$3, price_per_number=$4, min_numbers_to_draw=$5, draw_type=$6, draw_date=$7, updated_at=now()
       WHERE id = $8 AND organization_id = $9`,
      [title, description, regulation, price_per_number, min_numbers_to_draw, draw_type, draw_date || null, req.params.id, req.org.id]
    );
    res.redirect(`/o/${req.org.slug}/admin/rifas`);
  } catch (err) { next(err); }
});

router.post('/rifas/:id/excluir', guard, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM rifas WHERE id = $1 AND organization_id = $2', [req.params.id, req.org.id]);
    res.redirect(`/o/${req.org.slug}/admin/rifas`);
  } catch (err) { next(err); }
});

// ---------- SORTEIO ----------
router.get('/rifas/:id/sortear', guard, async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM rifas WHERE id = $1 AND organization_id = $2', [req.params.id, req.org.id]);
    if (!rows[0]) return res.status(404).render('errors/404', { title: 'Rifa não encontrada' });
    const soldCount = await pool.query(`SELECT COUNT(*) FROM numeros WHERE rifa_id=$1 AND status='sold'`, [req.params.id]);
    res.render('admin/sortear', { title: 'Realizar Sorteio', rifa: rows[0], soldCount: soldCount.rows[0].count, error: null });
  } catch (err) { next(err); }
});

router.post('/rifas/:id/sortear/online', guard, async (req, res, next) => {
  try {
    const result = await drawService.drawOnline({ rifaId: req.params.id, adminId: req.user.id });
    res.redirect(`/o/${req.org.slug}/admin/rifas`);
  } catch (err) {
    if (err.status) {
      const { rows } = await pool.query('SELECT * FROM rifas WHERE id = $1 AND organization_id = $2', [req.params.id, req.org.id]);
      const soldCount = await pool.query(`SELECT COUNT(*) FROM numeros WHERE rifa_id=$1 AND status='sold'`, [req.params.id]);
      return res.status(err.status).render('admin/sortear', { title: 'Realizar Sorteio', rifa: rows[0], soldCount: soldCount.rows[0].count, error: err.message });
    }
    next(err);
  }
});

router.post('/rifas/:id/sortear/federal', guard, async (req, res, next) => {
  try {
    const { concurso, federal_result } = req.body;
    await drawService.drawFederal({ rifaId: req.params.id, adminId: req.user.id, concurso, federalResult: federal_result });
    res.redirect(`/o/${req.org.slug}/admin/rifas`);
  } catch (err) {
    if (err.status) {
      const { rows } = await pool.query('SELECT * FROM rifas WHERE id = $1 AND organization_id = $2', [req.params.id, req.org.id]);
      const soldCount = await pool.query(`SELECT COUNT(*) FROM numeros WHERE rifa_id=$1 AND status='sold'`, [req.params.id]);
      return res.status(err.status).render('admin/sortear', { title: 'Realizar Sorteio', rifa: rows[0], soldCount: soldCount.rows[0].count, error: err.message });
    }
    next(err);
  }
});

// ---------- CLIENTES ----------
router.get('/clientes', guard, async (req, res, next) => {
  try {
    const q = req.query.q || '';
    const { rows } = await pool.query(
      `SELECT id, name, cpf, email, phone, blocked, created_at FROM users
       WHERE organization_id = $1 AND role = 'customer'
       AND (name ILIKE $2 OR email ILIKE $2 OR cpf ILIKE $2)
       ORDER BY created_at DESC LIMIT 100`,
      [req.org.id, `%${q}%`]
    );
    res.render('admin/clientes', { title: 'Clientes', clientes: rows, q });
  } catch (err) { next(err); }
});

router.post('/clientes/:id/bloquear', guard, async (req, res, next) => {
  try {
    await pool.query(`UPDATE users SET blocked = NOT blocked WHERE id = $1 AND organization_id = $2`, [req.params.id, req.org.id]);
    res.redirect(`/o/${req.org.slug}/admin/clientes`);
  } catch (err) { next(err); }
});

// ---------- FINANCEIRO ----------
router.get('/financeiro', guard, async (req, res, next) => {
  try {
    const pagamentos = await pool.query(
      `SELECT pg.*, p.rifa_id, r.title as rifa_title, u.name as cliente
       FROM pagamentos pg
       JOIN pedidos p ON p.id = pg.pedido_id
       JOIN rifas r ON r.id = p.rifa_id
       JOIN users u ON u.id = p.user_id
       WHERE p.organization_id = $1
       ORDER BY pg.created_at DESC LIMIT 200`,
      [req.org.id]
    );
    res.render('admin/financeiro', { title: 'Painel Financeiro', pagamentos: pagamentos.rows });
  } catch (err) { next(err); }
});

// ---------- RELATÓRIOS ----------
router.get('/relatorios', guard, async (req, res, next) => {
  try {
    const porRifa = await pool.query(
      `SELECT r.title, COUNT(p.id) as pedidos, COALESCE(SUM(p.total_amount) FILTER (WHERE p.status='pago'),0) as total
       FROM rifas r LEFT JOIN pedidos p ON p.rifa_id = r.id
       WHERE r.organization_id = $1 GROUP BY r.title ORDER BY total DESC`,
      [req.org.id]
    );
    res.render('admin/relatorios', { title: 'Relatórios', porRifa: porRifa.rows });
  } catch (err) { next(err); }
});

router.get('/relatorios/export.csv', guard, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.id, u.name as cliente, u.email, r.title as rifa, p.quantity, p.total_amount, p.status, p.created_at
       FROM pedidos p JOIN users u ON u.id = p.user_id JOIN rifas r ON r.id = p.rifa_id
       WHERE p.organization_id = $1 ORDER BY p.created_at DESC`,
      [req.org.id]
    );
    const header = 'id,cliente,email,rifa,quantidade,valor,status,data\n';
    const csv = rows.map(r => [r.id, r.cliente, r.email, r.rifa, r.quantity, r.total_amount, r.status, r.created_at.toISOString()].join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="relatorio-pedidos.csv"');
    res.send(header + csv);
  } catch (err) { next(err); }
});

// ---------- CONFIGURAÇÕES ----------
router.get('/configuracoes', guard, async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM configuracoes WHERE organization_id = $1', [req.org.id]);
    res.render('admin/configuracoes', { title: 'Configurações', config: rows[0] || {}, org: req.org, success: false });
  } catch (err) { next(err); }
});

router.post('/configuracoes', guard, async (req, res, next) => {
  try {
    const { site_name, seo_title, seo_description, google_analytics_id, meta_pixel_id, whatsapp, support_email, mp_access_token } = req.body;
    await pool.query(
      `INSERT INTO configuracoes (organization_id, site_name, seo_title, seo_description, google_analytics_id, meta_pixel_id, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6, now())
       ON CONFLICT (organization_id) DO UPDATE SET site_name=$2, seo_title=$3, seo_description=$4, google_analytics_id=$5, meta_pixel_id=$6, updated_at=now()`,
      [req.org.id, site_name, seo_title, seo_description, google_analytics_id, meta_pixel_id]
    );
    await pool.query(
      `UPDATE organizations SET whatsapp = $1, support_email = $2, mp_access_token = COALESCE(NULLIF($3,''), mp_access_token) WHERE id = $4`,
      [whatsapp, support_email, mp_access_token, req.org.id]
    );
    const { rows } = await pool.query('SELECT * FROM configuracoes WHERE organization_id = $1', [req.org.id]);
    res.render('admin/configuracoes', { title: 'Configurações', config: rows[0], org: req.org, success: true });
  } catch (err) { next(err); }
});

// ---------- MÍDIA DA RIFA (fotos e vídeo) ----------
router.post(
  '/rifas/:id/midia',
  guard,
  (req, res, next) => {
    const handler = upload.fields([
      { name: 'cover_image', maxCount: 1 },
      { name: 'gallery_images', maxCount: 8 },
      { name: 'video_file', maxCount: 1 },
    ]);
    handler(req, res, (err) => {
      if (err) {
        req.uploadError = err.message;
        return next();
      }
      next();
    });
  },
  async (req, res, next) => {
    try {
      const { rows } = await pool.query('SELECT * FROM rifas WHERE id = $1 AND organization_id = $2', [req.params.id, req.org.id]);
      const rifa = rows[0];
      if (!rifa) return res.status(404).render('errors/404', { title: 'Rifa não encontrada' });

      if (req.uploadError) {
        return res.status(400).render('admin/rifa-midia', { title: 'Fotos e Vídeo', rifa, images: [], error: req.uploadError });
      }

      if (req.files?.cover_image?.[0]) {
        const f = req.files.cover_image[0];
        const url = buildUploadUrl(req.org.id, 'images', f.filename);
        await pool.query('UPDATE rifas SET cover_image_url = $1, updated_at = now() WHERE id = $2', [url, rifa.id]);
      }

      if (req.files?.gallery_images?.length) {
        let position = 0;
        for (const f of req.files.gallery_images) {
          const url = buildUploadUrl(req.org.id, 'images', f.filename);
          await pool.query(
            `INSERT INTO rifa_imagens (rifa_id, url, position, kind) VALUES ($1, $2, $3, 'image')`,
            [rifa.id, url, position++]
          );
        }
      }

      if (req.body.video_external_url) {
        await pool.query('UPDATE rifas SET video_url = $1, updated_at = now() WHERE id = $2', [req.body.video_external_url, rifa.id]);
      } else if (req.files?.video_file?.[0]) {
        const f = req.files.video_file[0];
        const url = buildUploadUrl(req.org.id, 'videos', f.filename);
        await pool.query('UPDATE rifas SET video_url = $1, updated_at = now() WHERE id = $2', [url, rifa.id]);
      }

      res.redirect(`/o/${req.org.slug}/admin/rifas/${rifa.id}/midia`);
    } catch (err) { next(err); }
  }
);

router.get('/rifas/:id/midia', guard, async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM rifas WHERE id = $1 AND organization_id = $2', [req.params.id, req.org.id]);
    const rifa = rows[0];
    if (!rifa) return res.status(404).render('errors/404', { title: 'Rifa não encontrada' });
    const images = await pool.query('SELECT * FROM rifa_imagens WHERE rifa_id = $1 ORDER BY position', [rifa.id]);
    res.render('admin/rifa-midia', { title: 'Fotos e Vídeo', rifa, images: images.rows, error: null });
  } catch (err) { next(err); }
});

router.post('/rifas/:id/midia/:imageId/excluir', guard, async (req, res, next) => {
  try {
    await pool.query(
      `DELETE FROM rifa_imagens WHERE id = $1 AND rifa_id = (SELECT id FROM rifas WHERE id = $2 AND organization_id = $3)`,
      [req.params.imageId, req.params.id, req.org.id]
    );
    res.redirect(`/o/${req.org.slug}/admin/rifas/${req.params.id}/midia`);
  } catch (err) { next(err); }
});

// ---------- APARÊNCIA (personalização da loja) ----------
router.get('/aparencia', guard, (req, res) => {
  res.render('admin/aparencia', { title: 'Aparência da Loja', org: req.org, success: false, error: null });
});

router.post(
  '/aparencia',
  guard,
  (req, res, next) => {
    const handler = upload.fields([{ name: 'logo_image', maxCount: 1 }, { name: 'favicon_image', maxCount: 1 }]);
    handler(req, res, (err) => {
      if (err) { req.uploadError = err.message; }
      next();
    });
  },
  async (req, res, next) => {
    try {
      if (req.uploadError) {
        return res.status(400).render('admin/aparencia', { title: 'Aparência da Loja', org: req.org, success: false, error: req.uploadError });
      }
      const { name, primary_color, secondary_color, font_choice } = req.body;

      let logoUrl = req.org.logo_url;
      if (req.files?.logo_image?.[0]) {
        logoUrl = buildUploadUrl(req.org.id, 'images', req.files.logo_image[0].filename);
      }
      let faviconUrl = req.org.favicon_url;
      if (req.files?.favicon_image?.[0]) {
        faviconUrl = buildUploadUrl(req.org.id, 'images', req.files.favicon_image[0].filename);
      }

      const { rows } = await pool.query(
        `UPDATE organizations SET name = $1, primary_color = $2, secondary_color = $3, font_choice = $4,
         logo_url = $5, favicon_url = $6, updated_at = now()
         WHERE id = $7 RETURNING *`,
        [name, primary_color, secondary_color, font_choice, logoUrl, faviconUrl, req.org.id]
      );
      res.render('admin/aparencia', { title: 'Aparência da Loja', org: rows[0], success: true, error: null });
    } catch (err) { next(err); }
  }
);

function slugify(text) {
  return text.toString().toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

module.exports = router;
