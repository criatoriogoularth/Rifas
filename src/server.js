require('dotenv').config();
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');

const { loadUser } = require('./middleware/auth');
const { resolveOrg } = require('./middleware/tenant');
const { csrfToken, csrfProtect } = require('./middleware/csrf');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const { startExpirySweeper } = require('./services/reservationService');

const publicRoutes = require('./routes/public');
const authRoutes = require('./routes/auth');
const checkoutRoutes = require('./routes/checkout');
const accountRoutes = require('./routes/account');
const adminRoutes = require('./routes/admin');
const superadminRoutes = require('./routes/superadmin');
const masterAuthRoutes = require('./routes/masterAuth');
const orgSignupRoutes = require('./routes/orgSignup');
const webhookRoutes = require('./routes/webhooks');

const app = express();
app.set('trust proxy', 1); // necessário no Render para IP real e cookies "secure" funcionarem
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(helmet({
  contentSecurityPolicy: false, // ajuste conforme os domínios de assets/CDN usados no front
}));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Webhooks precisam do corpo bruto/JSON ANTES do parser de formulário e SEM proteção CSRF
// (a chamada vem do gateway de pagamento, não de um formulário do navegador).
app.use('/webhooks', express.json(), webhookRoutes);

app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public')));

const globalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 600, standardHeaders: true, legacyHeaders: false });
app.use(globalLimiter);

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });

app.use(loadUser);
app.use(csrfToken);

// ---------- Landing da plataforma (marketing, não é uma organização) ----------
app.get('/', (req, res) => {
  res.render('platform-landing', { title: 'Plataforma de Rifas Online' });
});

// ---------- Auto-cadastro de lojas (qualquer pessoa pode criar sua própria loja de rifas) ----------
app.use('/', authLimiter, csrfProtect, orgSignupRoutes);

// ---------- Painel Master (superadmin da plataforma SaaS) ----------
app.use('/master', authLimiter, csrfProtect, masterAuthRoutes);
app.use('/master', superadminRoutes);

// ---------- Rotas por organização (tenant) ----------
app.use('/o/:orgSlug', resolveOrg, publicRoutes);
app.use('/o/:orgSlug', resolveOrg, authLimiter, csrfProtect, authRoutes);
app.use('/o/:orgSlug', resolveOrg, csrfProtect, checkoutRoutes);
app.use('/o/:orgSlug', resolveOrg, csrfProtect, accountRoutes);
app.use('/o/:orgSlug/admin', resolveOrg, csrfProtect, adminRoutes);

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  startExpirySweeper();
});
