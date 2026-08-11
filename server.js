/**
 * Photobooth backend
 * - Nhận ảnh (photo.png) + video (video.webm) upload từ frontend
 * - Lưu vào /uploads/<sessionId>/
 * - Sinh QR code trỏ tới trang download /d/:id
 * - Serve luôn phần frontend tĩnh trong /public
 */
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.json({ limit: '50mb' }));

// Lấy IP LAN để QR code quét bằng điện thoại (cùng wifi) vẫn mở được,
// vì "localhost" trên máy tính sẽ không hoạt động trên điện thoại.
function getLanIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

// Mỗi request tạo 1 sessionId riêng, lưu ảnh + video vào cùng thư mục
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!req.sessionId) req.sessionId = uuidv4();
    const dir = path.join(UPLOAD_DIR, req.sessionId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, file.fieldname === 'photo' ? 'photo.png' : 'video.webm');
  }
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

app.post('/api/save', upload.fields([{ name: 'photo' }, { name: 'video' }]), async (req, res) => {
  try {
    const id = req.sessionId;
    const baseUrl = process.env.BASE_URL || `http://${getLanIP()}:${PORT}`;
    const downloadUrl = `${baseUrl}/d/${id}`;
    const qrDataUrl = await QRCode.toDataURL(downloadUrl, { width: 320, margin: 1 });
    res.json({ id, downloadUrl, qrDataUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Save failed' });
  }
});

app.get('/d/:id', (req, res) => {
  const id = req.params.id;
  const dir = path.join(UPLOAD_DIR, id);
  if (!fs.existsSync(dir)) return res.status(404).send('Không tìm thấy ảnh (link đã hết hạn hoặc sai).');

  const hasPhoto = fs.existsSync(path.join(dir, 'photo.png'));
  const hasVideo = fs.existsSync(path.join(dir, 'video.webm'));

  res.send(`<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Ảnh của bạn - Photobooth</title>
<style>
  body{font-family:'Segoe UI',sans-serif;background:#0f0f14;color:#fff;text-align:center;padding:24px;margin:0}
  h1{font-size:22px}
  img,video{max-width:100%;border-radius:16px;margin:16px 0;box-shadow:0 8px 24px rgba(0,0,0,.5)}
  a.btn{display:inline-block;margin:8px;padding:12px 26px;background:linear-gradient(135deg,#ff5c8a,#ff9d6c);
    color:#fff;border-radius:999px;text-decoration:none;font-weight:600}
</style>
</head>
<body>
  <h1>📸 Ảnh của bạn</h1>
  ${hasPhoto ? `<img src="/uploads/${id}/photo.png" alt="photo"><br><a class="btn" href="/uploads/${id}/photo.png" download>Tải ảnh</a>` : '<p>Không có ảnh</p>'}
  ${hasVideo ? `<h3>🎬 Video 3s trước khi chụp</h3><video src="/uploads/${id}/video.webm" controls playsinline></video><br><a class="btn" href="/uploads/${id}/video.webm" download>Tải video</a>` : ''}
</body>
</html>`);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Photobooth server: http://${getLanIP()}:${PORT}`);
});
