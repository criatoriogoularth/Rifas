# Plataforma de Rifas — SaaS Multi-Tenant

Sistema completo de rifas online: multi-empresa (cada organizador com sua própria loja isolada),
pagamento PIX automático via Mercado Pago, sorteio online ou por Loteria Federal, painel do
organizador e painel master da plataforma.

## Stack

- **Backend:** Node.js + Express
- **Views:** EJS (server-rendered, sem passo de build de frontend)
- **Banco:** PostgreSQL puro (`pg`), sem ORM — schema em `src/db/schema.sql`
- **Pagamento:** Mercado Pago (PIX), com webhook de confirmação automática
- **Segurança:** Argon2id, JWT em cookie httpOnly, CSRF, rate limiting, Helmet

## Estrutura

```
src/
  server.js          # ponto de entrada
  db/                # schema.sql, pool de conexão, scripts de migração/seed
  middleware/         # autenticação, tenant (multi-empresa), CSRF, erros
  services/           # regras de negócio (reservas, pagamentos, sorteio, rifas)
  routes/              # rotas HTTP (público, auth, checkout, conta, admin, master, webhooks)
  views/               # templates EJS
public/
  css/style.css        # identidade visual (verde-esmeralda + dourado, motivo "bilhete")
render.yaml            # blueprint de deploy no Render
```

## 1. Configurar o banco de dados (Postgres que você já tem)

Você disse que já tem um Postgres — ótimo, é só isso que precisa:

1. Pegue a **connection string** dele (algo como `postgresql://usuario:senha@host:5432/banco`).
2. No painel do seu banco (Render, Supabase etc.), garanta que aceita conexões externas se for de outro provedor.

Depois do deploy (ou localmente), rode a migração para criar todas as tabelas:

```bash
npm install
DATABASE_URL="sua-connection-string" npm run migrate
```

E, opcionalmente, popule com dados de demonstração (cria um usuário master, uma organização
"demo" e uma rifa de exemplo):

```bash
DATABASE_URL="sua-connection-string" SUPERADMIN_EMAIL="voce@exemplo.com" SUPERADMIN_PASSWORD="SenhaForte123!" npm run seed
```

## 2. Testar localmente sem configurar o Mercado Pago ainda

Se você só quer ver o sistema funcionando (cadastro, escolha de números, checkout, sorteio, painéis)
antes de mexer com gateway de pagamento, **não precisa configurar o Mercado Pago agora**.

Deixe `MP_ACCESS_TOKEN` em branco e `ALLOW_SIMULATED_PAYMENTS=true` no `.env` (é o padrão). Quando
não há gateway configurado, a tela de pagamento mostra um aviso de "modo de teste local" com um
botão **"Simular pagamento confirmado"** — ele marca o pedido como pago na hora, exatamente como o
webhook real faria, então dá pra testar o fluxo inteiro (número reservado → vendido, notificação,
aparecer no painel financeiro, sortear a rifa) sem sair do seu notebook.

```bash
npm install
cp .env.example .env    # edite DATABASE_URL, JWT_SECRET, SUPERADMIN_EMAIL/PASSWORD
npm run migrate
npm run seed
npm start
```

Acesse `http://localhost:3000/o/demo/`.

## 3. Configurar o Mercado Pago (PIX de verdade)

Quando quiser ativar o pagamento real:

1. Crie uma conta em https://www.mercadopago.com.br/developers
2. Gere um **Access Token de produção** (Suas aplicações → Credenciais).
3. Isso vira a variável `MP_ACCESS_TOKEN` (conta "mestre" da plataforma). Cada organização
   também pode conectar seu **próprio** token mais tarde em `/o/<slug>/admin/configuracoes`.
4. Configure a **notification_url** do webhook (já é montada automaticamente pelo sistema como
   `SUA_APP_URL/webhooks/mercadopago` — só precisa garantir que `APP_URL` está correto).
5. Lembre de colocar `ALLOW_SIMULATED_PAYMENTS=false` (ou simplesmente `NODE_ENV=production`) assim
   que for para produção, pra garantir que ninguém consiga "simular" um pagamento de verdade.

Testar o webhook localmente exige uma URL pública (o Mercado Pago não alcança `localhost`) — use
um túnel como **ngrok** (`ngrok http 3000`) se quiser validar isso antes de subir no Render.

## 4. Subir no Render

### Opção A — Deploy manual (mais simples, já que você já tem o Postgres)

1. Suba este código para um repositório no GitHub/GitLab.
2. No Render, clique em **New +** → **Web Service** e conecte o repositório.
3. Configure:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Runtime:** Node
4. Em **Environment**, adicione as variáveis (veja `.env.example`):
   - `DATABASE_URL` → a connection string do seu Postgres
   - `PGSSL` → `true` (deixe assim se seu Postgres exigir SSL, o que é comum)
   - `JWT_SECRET` → clique em "Generate" ou cole uma string aleatória longa
   - `APP_URL` → a URL que o Render vai te dar (ex: `https://raffle-platform.onrender.com`) — pode
     editar depois do primeiro deploy, quando souber a URL final
   - `MP_ACCESS_TOKEN` → seu token do Mercado Pago
   - `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` → credenciais do seu usuário master
5. Deploy. Depois do primeiro deploy concluído, abra o **Shell** do serviço no Render e rode:
   ```bash
   npm run migrate
   npm run seed
   ```
   (ou rode localmente apontando `DATABASE_URL` para o mesmo banco, como no passo 1)

### Opção B — Usando o `render.yaml` (Blueprint)

Se preferir que o Render também crie um banco novo automaticamente, use **New +** → **Blueprint**
e aponte para este repositório — ele lê o `render.yaml` incluído. Se for usar o Postgres que você
já tem, edite o `render.yaml` removendo a seção `databases:` e o `fromDatabase` de `DATABASE_URL`,
e configure `DATABASE_URL` manualmente como na Opção A.

## 5. Acessar o sistema

- **Site da organização demo:** `SUA_URL/o/demo/`
- **Login do organizador demo:** `org@rifasdemo.com` / `MudeEstaSenha123!` (troque depois do primeiro
  login — vá em Minha Conta → Alterar senha)
- **Painel master (dono da plataforma):** `SUA_URL/master/entrar`, com o e-mail/senha definidos em
  `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD`

Pelo painel master você cria novas organizações (cada uma com seu próprio admin, rifas e clientes,
totalmente isolados uma da outra).

## Personalização completa (aparência, fotos e vídeos)

Cada organização tem seu próprio painel em **Aparência** (`/o/<slug>/admin/aparencia`), onde dá pra
trocar:

- Nome da loja
- Cor principal e cor de destaque (aplicadas em botões, títulos e detalhes em toda a loja pública)
- Fonte dos títulos (4 opções prontas)
- Logo e favicon

E em cada rifa, na aba **Fotos/Vídeo** (`/o/<slug>/admin/rifas/<id>/midia`):
- Foto de capa
- Galeria com várias fotos
- Vídeo — por link do YouTube/Vimeo (fica embutido automaticamente) ou por upload de arquivo direto

⚠️ **Sobre arquivos enviados (fotos/vídeos/logo) no Render:** por padrão, um Web Service do Render
usa disco **efêmero** — ou seja, os arquivos enviados por upload somem a cada novo deploy. Pra
manter as fotos permanentemente, escolha uma destas opções antes de ir pra produção de verdade:

1. **Disco persistente do Render** (Settings → Disks, anexa um volume permanente ao serviço) — mais
   simples, funciona sem mudar o código, mas só existe em planos pagos do Render.
2. **Bucket S3-compatível** (Cloudflare R2, AWS S3, Backblaze B2) — mais robusto e escalável. Toda a
   lógica de upload está isolada em `src/middleware/upload.js`; é só trocar o `multer.diskStorage`
   por um storage engine S3 (ex: `multer-s3`) e ajustar `buildUploadUrl()` pra apontar pra URL pública
   do bucket. Se quiser, eu faço essa troca depois.

Pra testar localmente ou numa organização de baixo volume, o disco padrão funciona normalmente —
só não é confiável a longo prazo em produção sem uma dessas duas opções.

## Isolamento entre organizações (multi-tenant)

Cada organizador só enxerga o próprio painel — isso já está garantido em duas camadas:

1. **Toda query do painel filtra por `organization_id`** (nunca aparece rifa, cliente ou pedido de
   outra organização).
2. **Middleware `requireSameOrg`** bloqueia com erro 403 se um `org_admin` tentar acessar a URL de
   outra organização (ex: trocar o slug na barra de endereço manualmente).

Só o **superadmin** (painel `/master`) enxerga todas as organizações ao mesmo tempo — é o dono da
plataforma, que gerencia quem pode vender.


## Como as URLs funcionam

Cada organização tem uma URL própria: `/o/<slug>/`. Isso é o suficiente para rodar no Render sem
custo extra de domínio. Se no futuro você quiser subdomínios reais (`empresa.suaplataforma.com`),
troque a resolução de tenant em `src/middleware/tenant.js` para ler `req.hostname` em vez do
parâmetro de URL, e configure um domínio wildcard (`*.suaplataforma.com`) apontando pro Render.

## O que fica pra depois (não incluído nesta entrega)

Para manter a qualidade do que foi entregue, ficaram de fora por enquanto (e podem ser adicionados
depois, um de cada vez):

- Cartão de crédito/débito (só PIX está implementado; a estrutura de banco já tem as tabelas prontas)
- Verificação de e-mail/SMS, autenticação de dois fatores (2FA)
- Sistema de afiliados, cupons ativos no checkout, programa de fidelidade
- App mobile nativo / PWA instalável
- Upload de imagens para as rifas (hoje é só um campo de URL — próximo passo natural é integrar
  um bucket S3-compatível)

## Segurança implementada

- Senhas com Argon2id (nunca texto puro)
- Nunca armazenamos número de cartão ou CVV
- Cookies de sessão `httpOnly` + `sameSite`
- Proteção CSRF em todos os formulários
- Rate limiting global e reforçado em login/cadastro
- Cada pagamento é reconfirmado direto na API do Mercado Pago no webhook (nunca confia só no payload recebido)
- Isolamento de dados por organização em todas as queries (multi-tenant)
