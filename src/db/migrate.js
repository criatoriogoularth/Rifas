require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./pool');

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  console.log('Aplicando schema.sql no banco...');
  try {
    await pool.query(sql);
    console.log('Migração concluída com sucesso.');
  } catch (err) {
    console.error('Falha na migração:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

migrate();
