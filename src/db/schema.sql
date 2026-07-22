-- =========================================================
-- Plataforma de Rifas — Schema Multi-Tenant (PostgreSQL)
-- =========================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- ORGANIZAÇÕES (tenants) ----------
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(150) NOT NULL,
  slug VARCHAR(80) UNIQUE NOT NULL,
  logo_url TEXT,
  favicon_url TEXT,
  whatsapp VARCHAR(30),
  support_email VARCHAR(150),
  primary_color VARCHAR(20) DEFAULT '#0F6B4C',
  secondary_color VARCHAR(20) DEFAULT '#D4A72C',
  font_choice VARCHAR(30) DEFAULT 'fraunces', -- fraunces, poppins, playfair, montserrat
  plan VARCHAR(30) NOT NULL DEFAULT 'trial', -- trial, starter, pro, enterprise
  status VARCHAR(20) NOT NULL DEFAULT 'active', -- active, suspended, cancelled
  fee_percent NUMERIC(5,2) NOT NULL DEFAULT 8.00, -- taxa da plataforma sobre vendas
  mp_access_token TEXT, -- token do gateway PIX (Mercado Pago) do organizador, criptografado na aplicação
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- USUÁRIOS ----------
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE, -- NULL para superadmin
  role VARCHAR(20) NOT NULL DEFAULT 'customer', -- superadmin, org_admin, customer
  name VARCHAR(150) NOT NULL,
  cpf VARCHAR(14),
  email VARCHAR(150) NOT NULL,
  phone VARCHAR(30),
  password_hash TEXT NOT NULL,
  email_verified_at TIMESTAMPTZ,
  phone_verified_at TIMESTAMPTZ,
  two_factor_enabled BOOLEAN NOT NULL DEFAULT false,
  two_factor_secret TEXT,
  blocked BOOLEAN NOT NULL DEFAULT false,
  failed_login_attempts INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, email)
);
CREATE INDEX IF NOT EXISTS idx_users_org ON users(organization_id);

-- ---------- ENDEREÇOS ----------
CREATE TABLE IF NOT EXISTS enderecos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cep VARCHAR(10),
  logradouro VARCHAR(200),
  numero VARCHAR(20),
  complemento VARCHAR(100),
  bairro VARCHAR(100),
  cidade VARCHAR(100),
  estado VARCHAR(2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- RIFAS ----------
CREATE TABLE IF NOT EXISTS rifas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  slug VARCHAR(220) NOT NULL,
  description TEXT,
  regulation TEXT,
  cover_image_url TEXT,
  video_url TEXT,
  price_per_number NUMERIC(10,2) NOT NULL,
  total_numbers INT NOT NULL,             -- 100, 1000, 10000, ou personalizado
  digits INT NOT NULL DEFAULT 2,          -- quantidade de dígitos exibidos (00-99, 000-999...)
  min_numbers_to_draw INT NOT NULL DEFAULT 1, -- quantidade mínima vendida para poder sortear
  draw_type VARCHAR(20) NOT NULL DEFAULT 'online', -- online, loteria_federal
  draw_date TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'draft', -- draft, active, paused, closed, in_review, finished, cancelled
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_rifas_org ON rifas(organization_id);
CREATE INDEX IF NOT EXISTS idx_rifas_status ON rifas(status);

CREATE TABLE IF NOT EXISTS rifa_imagens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rifa_id UUID NOT NULL REFERENCES rifas(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  position INT NOT NULL DEFAULT 0
);

-- ---------- NÚMEROS ----------
-- Estado dos números é derivado por linha (mais simples e seguro para concorrência
-- do que gerar milhões de linhas para rifas de 100.000 números "sem limite" —
-- nesse caso os números ficam "virtuais" e só materializamos quando reservados/vendidos).
CREATE TABLE IF NOT EXISTS numeros (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rifa_id UUID NOT NULL REFERENCES rifas(id) ON DELETE CASCADE,
  number INT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'available', -- available, reserved, sold
  user_id UUID REFERENCES users(id),
  reservation_id UUID,
  order_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(rifa_id, number)
);
CREATE INDEX IF NOT EXISTS idx_numeros_rifa_status ON numeros(rifa_id, status);

-- ---------- RESERVAS ----------
CREATE TABLE IF NOT EXISTS reservas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rifa_id UUID NOT NULL REFERENCES rifas(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  numbers INT[] NOT NULL,
  quantity INT NOT NULL,
  total_amount NUMERIC(10,2) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, paid, expired, cancelled
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reservas_status_expires ON reservas(status, expires_at);

-- ---------- PEDIDOS ----------
CREATE TABLE IF NOT EXISTS pedidos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rifa_id UUID NOT NULL REFERENCES rifas(id),
  user_id UUID NOT NULL REFERENCES users(id),
  reserva_id UUID REFERENCES reservas(id),
  numbers INT[] NOT NULL,
  quantity INT NOT NULL,
  total_amount NUMERIC(10,2) NOT NULL,
  platform_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'aguardando_pagamento',
  -- aguardando_pagamento, pago, cancelado, reembolsado, expirado
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_pedidos_org ON pedidos(organization_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_user ON pedidos(user_id);

-- ---------- PAGAMENTOS ----------
CREATE TABLE IF NOT EXISTS pagamentos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pedido_id UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  method VARCHAR(20) NOT NULL, -- pix, cartao_credito, cartao_debito, boleto
  gateway VARCHAR(30) NOT NULL DEFAULT 'mercadopago',
  gateway_payment_id VARCHAR(100),
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, approved, rejected, refunded, cancelled
  amount NUMERIC(10,2) NOT NULL,
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pagamentos_pedido ON pagamentos(pedido_id);
CREATE INDEX IF NOT EXISTS idx_pagamentos_gateway_id ON pagamentos(gateway_payment_id);

CREATE TABLE IF NOT EXISTS pix (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pagamento_id UUID NOT NULL REFERENCES pagamentos(id) ON DELETE CASCADE,
  qr_code TEXT,
  qr_code_base64 TEXT,
  copia_e_cola TEXT,
  expires_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS cartoes (
  -- NUNCA armazenamos número/CVV. Guardamos apenas o token retornado pelo gateway.
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gateway_token VARCHAR(200) NOT NULL,
  brand VARCHAR(30),
  last4 VARCHAR(4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- SORTEIOS E GANHADORES ----------
CREATE TABLE IF NOT EXISTS sorteios (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rifa_id UUID NOT NULL REFERENCES rifas(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL, -- online, loteria_federal
  concurso VARCHAR(20),
  federal_result VARCHAR(20),
  winning_number INT,
  seed VARCHAR(100), -- semente usada no sorteio online, para auditoria/transparência
  drawn_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  drawn_by UUID REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS ganhadores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sorteio_id UUID NOT NULL REFERENCES sorteios(id) ON DELETE CASCADE,
  rifa_id UUID NOT NULL REFERENCES rifas(id),
  user_id UUID NOT NULL REFERENCES users(id),
  numero INT NOT NULL,
  prize_delivered BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- CONFIGURAÇÕES POR ORGANIZAÇÃO ----------
CREATE TABLE IF NOT EXISTS configuracoes (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  site_name VARCHAR(150),
  smtp_host VARCHAR(150),
  smtp_port INT,
  smtp_user VARCHAR(150),
  smtp_pass TEXT,
  seo_title VARCHAR(200),
  seo_description TEXT,
  google_analytics_id VARCHAR(50),
  meta_pixel_id VARCHAR(50),
  terms_url TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- CUPONS ----------
CREATE TABLE IF NOT EXISTS cupons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code VARCHAR(40) NOT NULL,
  discount_percent NUMERIC(5,2),
  discount_amount NUMERIC(10,2),
  max_uses INT,
  used_count INT NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE(organization_id, code)
);

-- ---------- LOGS / AUDITORIA ----------
CREATE TABLE IF NOT EXISTS logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  action VARCHAR(100) NOT NULL,
  ip VARCHAR(60),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_logs_org ON logs(organization_id);

CREATE TABLE IF NOT EXISTS auditoria (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  admin_id UUID REFERENCES users(id),
  entity VARCHAR(60) NOT NULL,
  entity_id UUID,
  change JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- NOTIFICAÇÕES ----------
CREATE TABLE IF NOT EXISTS emails (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID REFERENCES organizations(id),
  to_email VARCHAR(150) NOT NULL,
  subject VARCHAR(200),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID REFERENCES organizations(id),
  to_phone VARCHAR(30) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notificacoes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(150) NOT NULL,
  body TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- PERMISSÕES (para futura granularidade dentro de uma org) ----------
CREATE TABLE IF NOT EXISTS permissoes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission VARCHAR(80) NOT NULL,
  UNIQUE(user_id, permission)
);

CREATE TABLE IF NOT EXISTS acessos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip VARCHAR(60),
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Migração idempotente para bancos que já rodaram uma versão anterior deste schema ----------
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS secondary_color VARCHAR(20) DEFAULT '#D4A72C';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS font_choice VARCHAR(30) DEFAULT 'fraunces';
ALTER TABLE rifa_imagens ADD COLUMN IF NOT EXISTS kind VARCHAR(10) NOT NULL DEFAULT 'image'; -- image, video

