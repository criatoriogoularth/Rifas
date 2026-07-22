const argon2 = require('argon2');

async function hashPassword(plain) {
  return argon2.hash(plain, {
    type: argon2.argon2id,
    memoryCost: 19456, // ~19 MB, recomendação OWASP
    timeCost: 2,
    parallelism: 1,
  });
}

async function verifyPassword(hash, plain) {
  try {
    return await argon2.verify(hash, plain);
  } catch (err) {
    return false;
  }
}

module.exports = { hashPassword, verifyPassword };
