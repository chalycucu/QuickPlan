// Vật liệu phủ mặt đất (lát sân, cỏ, sỏi…): mẫu có sẵn vẽ bằng canvas + ảnh mẫu người dùng thêm (lưu trong bản vẽ)
const T = 256;
function rnd(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function cv() { const c = document.createElement('canvas'); c.width = c.height = T; return [c, c.getContext('2d')]; }
function speckle(x, r, n, cols, a = 0.35, size = 2) { for (let i = 0; i < n; i++) { x.globalAlpha = a * r(); x.fillStyle = cols[Math.floor(r() * cols.length)]; const s = 0.5 + r() * size; x.fillRect(r() * T, r() * T, s, s); } x.globalAlpha = 1; }

const DRAW = {
  gach(x, r) { // gạch lát nghiêng kiểu xương cá đơn giản: hàng gạch so le
    x.fillStyle = '#b8644a'; x.fillRect(0, 0, T, T);
    const h = T / 8, w = T / 4;
    for (let j = 0; j < 8; j++) for (let i = -1; i < 5; i++) {
      const ox = (j % 2) * (w / 2);
      x.fillStyle = `hsl(${12 + r() * 10},${38 + r() * 14}%,${42 + r() * 12}%)`; x.fillRect(i * w + ox + 1.5, j * h + 1.5, w - 3, h - 3);
    }
    speckle(x, r, 900, ['#5b2a1c', '#e7b29c'], 0.25);
  },
  da(x, r) { // đá lát vuông
    x.fillStyle = '#8f9399'; x.fillRect(0, 0, T, T);
    const s = T / 2;
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) { const l = 60 + r() * 12; x.fillStyle = `hsl(210,6%,${l}%)`; x.fillRect(i * s + 2, j * s + 2, s - 4, s - 4); }
    speckle(x, r, 2500, ['#555b62', '#d9dde2'], 0.35);
  },
  gachxam(x, r) { // gạch block tự chèn xám
    x.fillStyle = '#7c8086'; x.fillRect(0, 0, T, T);
    const h = T / 4, w = T / 2;
    for (let j = 0; j < 4; j++) for (let i = -1; i < 3; i++) { const ox = (j % 2) * (w / 2); x.fillStyle = `hsl(30,4%,${62 + r() * 10}%)`; x.fillRect(i * w + ox + 2, j * h + 2, w - 4, h - 4); }
    speckle(x, r, 1500, ['#4b5057', '#e5e7eb'], 0.3);
  },
  co(x, r) { // cỏ
    x.fillStyle = '#7cb867'; x.fillRect(0, 0, T, T);
    for (let i = 0; i < 2600; i++) { x.strokeStyle = `hsla(${95 + r() * 30},${40 + r() * 25}%,${32 + r() * 30}%,0.55)`; const px = r() * T, py = r() * T; x.lineWidth = 1; x.beginPath(); x.moveTo(px, py); x.lineTo(px + (r() - 0.5) * 3, py - 2 - r() * 5); x.stroke(); }
  },
  soi(x, r) { // sỏi
    x.fillStyle = '#cbbfa8'; x.fillRect(0, 0, T, T);
    for (let i = 0; i < 900; i++) { x.fillStyle = `hsl(${25 + r() * 25},${8 + r() * 18}%,${50 + r() * 35}%)`; x.beginPath(); x.ellipse(r() * T, r() * T, 2 + r() * 4, 1.5 + r() * 3, r() * 3, 0, 7); x.fill(); }
  },
  go(x, r) { // sàn gỗ
    x.fillStyle = '#a8784c'; x.fillRect(0, 0, T, T);
    const h = T / 6;
    for (let j = 0; j < 6; j++) {
      const off = r() * T; x.fillStyle = `hsl(${26 + r() * 8},${42 + r() * 12}%,${40 + r() * 12}%)`; x.fillRect(0, j * h + 1, T, h - 2);
      x.fillStyle = 'rgba(60,35,15,0.5)'; x.fillRect(off, j * h, 2, h);
      for (let k = 0; k < 12; k++) { x.strokeStyle = 'rgba(70,40,15,0.18)'; x.beginPath(); const yy = j * h + 2 + r() * (h - 4); x.moveTo(0, yy); x.bezierCurveTo(T / 3, yy + (r() - 0.5) * 4, (2 * T) / 3, yy + (r() - 0.5) * 4, T, yy); x.stroke(); }
    }
  },
  betong(x, r) { // bê tông
    x.fillStyle = '#b7b9b6'; x.fillRect(0, 0, T, T);
    speckle(x, r, 6000, ['#8d908c', '#d5d7d3', '#a2a5a1'], 0.5, 2.2);
    x.strokeStyle = 'rgba(90,92,90,0.45)'; x.lineWidth = 1.5; x.strokeRect(0.75, 0.75, T - 1.5, T - 1.5);
  },
  gachdo(x, r) { // gạch đất nung vuông
    x.fillStyle = '#d6b3a0'; x.fillRect(0, 0, T, T);
    const s = T / 4;
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { x.fillStyle = `hsl(${14 + r() * 8},${48 + r() * 14}%,${46 + r() * 10}%)`; x.fillRect(i * s + 2, j * s + 2, s - 4, s - 4); }
    speckle(x, r, 800, ['#6b2c19'], 0.2);
  },
};
export const PRESET_MATS = [
  { id: 'p:gach', name: 'Gạch lát so le', scale: 1.6, color: '#b8644a' },
  { id: 'p:gachxam', name: 'Gạch block xám', scale: 0.8, color: '#9a9ea4' },
  { id: 'p:gachdo', name: 'Gạch đất nung', scale: 1.2, color: '#c4785a' },
  { id: 'p:da', name: 'Đá lát', scale: 1.2, color: '#9da1a7' },
  { id: 'p:betong', name: 'Bê tông', scale: 3, color: '#b7b9b6' },
  { id: 'p:go', name: 'Sàn gỗ', scale: 1.2, color: '#a8784c' },
  { id: 'p:co', name: 'Cỏ', scale: 2, color: '#7cb867' },
  { id: 'p:soi', name: 'Sỏi', scale: 1, color: '#cbbfa8' },
];
const cache = new Map(); // id -> { img, ok, wait: [] }
// danh sách vật liệu: mẫu có sẵn + mẫu người dùng thêm (doc.settings.mats)
export function allMats(doc) { return PRESET_MATS.concat(((doc && doc.settings && doc.settings.mats) || []).map((m) => ({ ...m, user: true }))); }
export function findMat(doc, id) { return id ? allMats(doc).find((m) => m.id === id) || null : null; }
// ảnh (canvas hoặc Image) của vật liệu; chưa sẵn thì trả null và gọi onReady khi tải xong
export function matImage(doc, id, onReady) {
  if (!id) return null;
  let c = cache.get(id);
  if (c) { if (c.ok) return c.img; if (onReady) c.wait.push(onReady); return null; }
  if (id.startsWith('p:')) {
    const k = id.slice(2); if (!DRAW[k]) return null;
    const [cn, x] = cv(); DRAW[k](x, rnd(k.length * 7919 + k.charCodeAt(0)));
    cache.set(id, { img: cn, ok: true, wait: [] }); return cn;
  }
  const m = findMat(doc, id); if (!m || !m.src) return null;
  c = { img: new Image(), ok: false, wait: onReady ? [onReady] : [] }; cache.set(id, c);
  c.img.onload = () => { c.ok = true; const w = c.wait; c.wait = []; w.forEach((f) => f()); };
  c.img.src = m.src;
  return null;
}
// mẫu nhỏ (dataURL) để hiện trên nút chọn vật liệu
export function matThumb(doc, id) {
  const m = findMat(doc, id); if (!m) return '';
  if (m.src) return m.src;
  const img = matImage(doc, id); if (!img) return '';
  const c = document.createElement('canvas'); c.width = c.height = 48; c.getContext('2d').drawImage(img, 0, 0, 48, 48); return c.toDataURL();
}
// Đọc ảnh người dùng chọn (thư viện ảnh iPad / file), thu nhỏ còn tối đa 512 điểm ảnh, JPEG
export function readMatFile(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => {
      const k = Math.min(1, 512 / Math.max(im.width, im.height)), w = Math.max(8, Math.round(im.width * k)), h = Math.max(8, Math.round(im.height * k));
      const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(im, 0, 0, w, h);
      URL.revokeObjectURL(url);
      // màu trung bình để làm màu đại diện (khi nhìn xa / xuất)
      const d = c.getContext('2d').getImageData(0, 0, w, h).data; let r = 0, g = 0, b = 0, n = 0; for (let i = 0; i < d.length; i += 64) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
      const hex = '#' + [r, g, b].map((v) => Math.round(v / n).toString(16).padStart(2, '0')).join('');
      res({ src: c.toDataURL('image/jpeg', 0.82), color: hex, aspect: w / h });
    };
    im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Không đọc được ảnh')); };
    im.src = url;
  });
}
export function forgetMat(id) { cache.delete(id); }
