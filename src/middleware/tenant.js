const pool = require('../db/pool');

// Resolve a organização (tenant) a partir do slug na URL: /o/:orgSlug/...
// Em produção você pode trocar isso por subdomínio (orgSlug.suaplataforma.com)
// apontando um wildcard DNS para o Render e lendo req.hostname em vez do param.
async function resolveOrg(req, res, next) {
  try {
    const slug = req.params.orgSlug;
    const { rows } = await pool.query(
      'SELECT * FROM organizations WHERE slug = $1',
      [slug]
    );
    const org = rows[0];
    if (!org || org.status !== 'active') {
      return res.status(404).render('errors/404', { title: 'Loja não encontrada' });
    }
    req.org = org;
    res.locals.org = org;
    next();
  } catch (err) {
    next(err);
  }
}

// Garante que o org_admin logado só acesse dados da própria organização.
function requireSameOrg(req, res, next) {
  if (!req.user || (req.user.role !== 'superadmin' && req.user.organization_id !== req.org.id)) {
    return res.status(403).render('errors/403', { title: 'Acesso negado' });
  }
  next();
}

module.exports = { resolveOrg, requireSameOrg };
