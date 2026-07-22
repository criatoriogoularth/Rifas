const { verifyToken } = require('../utils/jwt');
const pool = require('../db/pool');

// Carrega o usuário autenticado (se houver) em req.user, sem bloquear a rota.
async function loadUser(req, res, next) {
  try {
    const token = req.cookies?.session;
    if (!token) return next();

    const payload = verifyToken(token);
    if (!payload) return next();

    const { rows } = await pool.query(
      'SELECT id, organization_id, role, name, email, blocked FROM users WHERE id = $1',
      [payload.sub]
    );
    const user = rows[0];
    if (user && !user.blocked) {
      req.user = user;
      res.locals.user = user;
    }
    next();
  } catch (err) {
    next(err);
  }
}

function requireAuth(req, res, next) {
  if (!req.user) {
    // O redirecionamento precisa apontar pro login certo: da organização (se a rota for
    // dentro de /o/:orgSlug) ou do painel master (se não houver organização na rota).
    const loginBase = req.org ? `/o/${req.org.slug}/entrar` : '/master/entrar';
    return res.redirect(`${loginBase}?next=${encodeURIComponent(req.originalUrl)}`);
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).render('errors/403', { title: 'Acesso negado' });
    }
    next();
  };
}

module.exports = { loadUser, requireAuth, requireRole };
