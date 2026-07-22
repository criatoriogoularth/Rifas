require('dotenv').config();
const argon2 = require('argon2');
const pool = require('./pool');

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const superadminEmail = process.env.SUPERADMIN_EMAIL || 'admin@plataforma.com';
    const superadminPassword = process.env.SUPERADMIN_PASSWORD || 'MudeEstaSenha123!';
    const hash = await argon2.hash(superadminPassword, { type: argon2.argon2id });

    const existing = await client.query('SELECT id FROM users WHERE role = $1 AND email = $2', ['superadmin', superadminEmail]);
    if (existing.rows.length === 0) {
      await client.query(
        `INSERT INTO users (role, name, email, password_hash, email_verified_at)
         VALUES ('superadmin', 'Administrador da Plataforma', $1, $2, now())`,
        [superadminEmail, hash]
      );
      console.log(`Superadmin criado: ${superadminEmail} / senha definida em SUPERADMIN_PASSWORD`);
    } else {
      console.log('Superadmin já existe, pulando.');
    }

    // Organização demo
    const orgResult = await client.query('SELECT id FROM organizations WHERE slug = $1', ['demo']);
    let orgId;
    if (orgResult.rows.length === 0) {
      const org = await client.query(
        `INSERT INTO organizations (name, slug, support_email, plan, status)
         VALUES ('Rifas Demo', 'demo', 'contato@rifasdemo.com', 'pro', 'active')
         RETURNING id`
      );
      orgId = org.rows[0].id;
      await client.query(
        `INSERT INTO configuracoes (organization_id, site_name, seo_title)
         VALUES ($1, 'Rifas Demo', 'Rifas Demo — Concorra e Ganhe')`,
        [orgId]
      );
      console.log('Organização demo criada (slug: demo).');
    } else {
      orgId = orgResult.rows[0].id;
      console.log('Organização demo já existe.');
    }

    // Admin da org demo
    const orgAdminEmail = 'org@rifasdemo.com';
    const orgAdminExisting = await client.query(
      'SELECT id FROM users WHERE organization_id = $1 AND email = $2',
      [orgId, orgAdminEmail]
    );
    if (orgAdminExisting.rows.length === 0) {
      const orgHash = await argon2.hash('MudeEstaSenha123!', { type: argon2.argon2id });
      await client.query(
        `INSERT INTO users (organization_id, role, name, email, password_hash, email_verified_at)
         VALUES ($1, 'org_admin', 'Organizador Demo', $2, $3, now())`,
        [orgId, orgAdminEmail, orgHash]
      );
      console.log(`Admin da organização demo criado: ${orgAdminEmail} / MudeEstaSenha123!`);
    }

    // Rifa demo
    const rifaExisting = await client.query('SELECT id FROM rifas WHERE organization_id=$1 AND slug=$2', [orgId, 'rifa-de-lancamento']);
    if (rifaExisting.rows.length === 0) {
      await client.query(
        `INSERT INTO rifas (organization_id, title, slug, description, regulation, price_per_number, total_numbers, digits, min_numbers_to_draw, draw_type, status)
         VALUES ($1, 'Rifa de Lançamento', 'rifa-de-lancamento', 'Concorra a um prêmio incrível comprando seus números da sorte.', 'Regulamento padrão. Sorteio realizado ao vivo assim que atingida a quantidade mínima de números vendidos.', 5.00, 100, 2, 50, 'online', 'active')`,
        [orgId]
      );
      console.log('Rifa demo criada.');
    }

    await client.query('COMMIT');
    console.log('Seed concluído.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erro no seed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
