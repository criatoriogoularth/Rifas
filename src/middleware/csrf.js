const crypto = require('crypto');

// Proteção CSRF via double-submit cookie: um token legível por JS (não HttpOnly)
// é comparado com o token enviado no corpo do formulário.
function csrfToken(req, res, next) {
  let token = req.cookies?.csrf_token;
  if (!token) {
    token = crypto.randomBytes(32).toString('hex');
    res.cookie('csrf_token', token, {
      httpOnly: false,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    });
  }
  res.locals.csrfToken = token;
  req.csrfToken = token;
  next();
}

function csrfProtect(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const bodyToken = req.body?._csrf;
  const cookieToken = req.cookies?.csrf_token;
  if (!bodyToken || !cookieToken || bodyToken !== cookieToken) {
    return res.status(403).render('errors/403', { title: 'Sessão inválida, recarregue a página' });
  }
  next();
}

module.exports = { csrfToken, csrfProtect };
