import { fetchTile } from './pc.js';
// Địa hình 3D từ mô hình số độ cao (DEM) lấy trên mạng, tại đúng vị trí bản vẽ.
// Nguồn: AWS Terrain Tiles (bộ ô độ cao "Terrarium" của dự án Tilezen/Mapzen, gộp SRTM, GMTED, ETOPO1… ; dữ liệu mở,
// dùng được cho mục đích thương mại, cần ghi nguồn). Ô ảnh tải qua máy tính chạy QuickPlan (/api/tiles/dem/…).
const TILE = 256;
const lon2x = (lon, z) => ((lon + 180) / 360) * TILE * 2 ** z;
const lat2y = (lat, z) => { const r = (lat * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * TILE * 2 ** z; };
export const DEM_CREDIT = 'Độ cao: AWS Terrain Tiles (Tilezen/Mapzen: SRTM, GMTED, ETOPO1)';

async function tileData(z, x, y) {
  const r = await fetchTile('dem', z, x, y);
  if (!r.ok) throw new Error(r.status === 502 ? 'máy tính chưa kết nối Internet' : 'lỗi tải ô độ cao ' + r.status);
  const bmp = await createImageBitmap(await r.blob());
  const c = document.createElement('canvas'); c.width = c.height = TILE;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0);
  return g.getImageData(0, 0, TILE, TILE).data;
}

// Tải độ cao cho lưới vuông bbox [x0, y0, x1, y1] (mét, toạ độ bản vẽ), bước `step` mét.
// toLL(p) → [vĩ độ, kinh độ]. Trả về { x0, y0, nx, ny, step, h: Float32Array (m so với mực nước biển) }
export async function downloadDEM(bbox, toLL, step, onProgress) {
  const [x0, y0, x1, y1] = bbox;
  const nx = Math.floor((x1 - x0) / step) + 1, ny = Math.floor((y1 - y0) / step) + 1;
  const c = toLL([(x0 + x1) / 2, (y0 + y1) / 2]);
  const mppAt = (z) => (156543.03392 * Math.cos((c[0] * Math.PI) / 180)) / 2 ** z;
  const corners = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(toLL);
  const tilesAt = (z) => {
    const xs = corners.map((q) => lon2x(q[1], z) / TILE), ys = corners.map((q) => lat2y(q[0], z) / TILE);
    return [Math.floor(Math.min(...xs)), Math.floor(Math.max(...xs)), Math.floor(Math.min(...ys)), Math.floor(Math.max(...ys))];
  };
  let z = 15; while (z > 8 && mppAt(z) < step * 0.5) z--; // ô độ cao không cần mịn hơn bước lưới
  let T = tilesAt(z); while (z > 6 && (T[1] - T[0] + 1) * (T[3] - T[2] + 1) > 64) { z--; T = tilesAt(z); }
  const jobs = []; for (let ty = T[2]; ty <= T[3]; ty++) for (let tx = T[0]; tx <= T[1]; tx++) jobs.push([tx, ty]);
  const tiles = new Map(); let done = 0, ok = 0, lastErr = null;
  const queue = jobs.slice();
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const [tx, ty] = queue.shift();
      try { tiles.set(tx + ',' + ty, await tileData(z, tx, ty)); ok++; } catch (e) { lastErr = e; }
      onProgress && onProgress(++done, jobs.length);
    }
  }));
  if (!ok) throw new Error(lastErr ? lastErr.message : 'không tải được dữ liệu độ cao');
  const px = (gx, gy) => {
    const tx = Math.floor(gx / TILE), ty = Math.floor(gy / TILE), d = tiles.get(tx + ',' + ty);
    if (!d) return NaN;
    const i = ((gy - ty * TILE) * TILE + (gx - tx * TILE)) * 4;
    return d[i] * 256 + d[i + 1] + d[i + 2] / 256 - 32768;
  };
  const h = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const ll = toLL([x0 + i * step, y0 + j * step]);
    const fx = lon2x(ll[1], z) - 0.5, fy = lat2y(ll[0], z) - 0.5, ix = Math.floor(fx), iy = Math.floor(fy), u = fx - ix, v = fy - iy;
    const a = px(ix, iy), b = px(ix + 1, iy), cc = px(ix, iy + 1), d = px(ix + 1, iy + 1);
    h[j * nx + i] = a * (1 - u) * (1 - v) + b * u * (1 - v) + cc * (1 - u) * v + d * u * v;
  }
  // ô thiếu: lấy độ cao trung bình
  let s = 0, n = 0; for (const v of h) if (isFinite(v)) { s += v; n++; }
  const avg = n ? s / n : 0; for (let k = 0; k < h.length; k++) if (!isFinite(h[k]) || h[k] < -500) h[k] = avg;
  return { x0, y0, nx, ny, step, z, h };
}

// Lưu gọn trong bản vẽ: Int16 (đơn vị dm, so với ref) dạng base64
export function encodeHeights(h, ref) {
  const a = new Int16Array(h.length); for (let i = 0; i < h.length; i++) a[i] = Math.max(-32767, Math.min(32767, Math.round((h[i] - ref) * 10)));
  const u = new Uint8Array(a.buffer); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
const cache = new Map();
export function decodeHeights(t) {
  const key = t.d.length + ':' + t.d.slice(0, 40) + t.d.slice(-40);
  if (cache.has(key)) return cache.get(key);
  const b = atob(t.d), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  const a = new Int16Array(u.buffer), h = new Float32Array(a.length); for (let i = 0; i < a.length; i++) h[i] = a[i] / 10; // mét so với ref
  cache.clear(); cache.set(key, h); return h;
}

// Khung bao các đối tượng đã vẽ (khu vực san nền)
export function drawnBBox(doc, withCad = false) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const it of doc.items) {
    if ((it.kind === 'cad' && !withCad) || it.kind === 'facet' || !it.pts) continue;
    for (const p of it.pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  }
  return isFinite(x0) ? [x0, y0, x1, y1] : null;
}
// Độ cao hiển thị (m, mặt bằng khu vẽ = 0) tại mỗi nút lưới: phóng đại theo exag;
// «San nền khu vẽ»: trong khung các đối tượng đã vẽ (+ lề) về cao độ 0, chuyển tiếp mềm ra địa hình xung quanh
export function displayHeights(doc) {
  const t = doc.terrain; if (!t || !t.d) return null;
  const h = decodeHeights(t), exag = t.exag || 1, out = new Float32Array(h.length);
  const bb = t.flat !== false ? drawnBBox(doc) : null, M = 12, BL = Math.max(30, t.step * 4);
  for (let j = 0; j < t.ny; j++) for (let i = 0; i < t.nx; i++) {
    const k = j * t.nx + i; let v = h[k] * exag;
    if (bb) {
      const x = t.x0 + i * t.step, y = t.y0 + j * t.step;
      const dx = Math.max(bb[0] - M - x, 0, x - bb[2] - M), dy = Math.max(bb[1] - M - y, 0, y - bb[3] - M), d = Math.hypot(dx, dy);
      const s = Math.min(1, d / BL); v *= s * s * (3 - 2 * s);
    }
    out[k] = v;
  }
  return out;
}

// Hàm độ cao mặt đất (m, so với cao độ khu vẽ, đã phóng đại) dùng để đặt công trình, cây, nét… theo địa hình thật.
// Chỉ có khi địa hình đang hiện và KHÔNG san nền khu vẽ.
const gcache = new WeakMap();
export function groundSampler(doc) {
  const t = doc && doc.terrain;
  if (!t || !t.d || t.on === false || t.flat !== false) return null;
  const key = (t.exag || 1) + '|' + t.d.length;
  const c = gcache.get(t); if (c && c.key === key) return c.fn;
  const h = decodeHeights(t), ex = t.exag || 1, { nx, ny, step, x0, y0 } = t;
  const fn = (x, y) => {
    let fx = (x - x0) / step, fy = (y - y0) / step;
    fx = Math.max(0, Math.min(nx - 1.0001, fx)); fy = Math.max(0, Math.min(ny - 1.0001, fy));
    const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, k = j * nx + i;
    return ex * (h[k] * (1 - u) * (1 - v) + h[k + 1] * u * (1 - v) + h[k + nx] * (1 - u) * v + h[k + nx + 1] * u * v);
  };
  gcache.set(t, { key, fn }); return fn;
}

// Bảng màu theo cao độ (dùng cho mặt địa hình và chú giải)
export const ELEV_STOPS = [[0, '#2f7d4f'], [0.25, '#8dbf6a'], [0.5, '#e8d98c'], [0.75, '#b98a55'], [1, '#f2efe9']];
export const SEA_COLOR = '#7fb3d5';
const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const STOPS = ELEV_STOPS.map(([t, h]) => [t, hex(h)]), SEA = hex(SEA_COLOR);
export function elevColor(h, hmin, hmax, out) {
  let rgb;
  if (h < 0) rgb = SEA;
  else {
    const lo = Math.max(0, hmin), t = Math.max(0, Math.min(1, (h - lo) / Math.max(1, hmax - lo)));
    let i = 1; while (i < STOPS.length - 1 && STOPS[i][0] < t) i++;
    const [t0, a] = STOPS[i - 1], [t1, b] = STOPS[i], u = (t - t0) / (t1 - t0);
    rgb = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
  }
  out.setRGB(rgb[0], rgb[1], rgb[2], 'srgb'); return out;
}
