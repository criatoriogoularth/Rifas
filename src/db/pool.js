const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('ERRO: variável de ambiente DATABASE_URL não definida.');
}

const pool = new Pool({
  connectionString,
  // Render Postgres exige SSL em produção; em dev local geralmente não.
  ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('Erro inesperado no pool do Postgres:', err);
});

module.exports = pool;
