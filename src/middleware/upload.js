const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'public', 'uploads');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Arquivos ficam organizados por organização: /public/uploads/<orgId>/<tipo>/<arquivo>
// Isso é servido estaticamente em /uploads/... (ver server.js).
// IMPORTANTE: no Render, o disco de um Web Service comum é efêmero (some a cada novo deploy).
// Pra produção de verdade, o ideal é trocar este storage por um bucket S3-compatível — a função
// buildUploadUrl() abaixo é o único lugar que precisaria mudar para isso.
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const kind = file.fieldname.includes('video') ? 'videos' : 'images';
    const dir = path.join(UPLOAD_ROOT, req.org.id, kind);
    ensureDir(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
    cb(null, name);
  },
});

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];

function fileFilter(req, file, cb) {
  const isVideoField = file.fieldname.includes('video');
  const allowed = isVideoField ? VIDEO_TYPES : IMAGE_TYPES;
  if (!allowed.includes(file.mimetype)) {
    return cb(new Error(isVideoField ? 'Formato de vídeo não suportado (use MP4, WebM ou MOV).' : 'Formato de imagem não suportado (use JPG, PNG, WEBP ou GIF).'));
  }
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 60 * 1024 * 1024 }, // 60MB — ajuste conforme o plano do seu disco no Render
});

function buildUploadUrl(orgId, kind, filename) {
  return `/uploads/${orgId}/${kind}/${filename}`;
}

module.exports = { upload, buildUploadUrl };
