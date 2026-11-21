import { fetchTile } from './pc.js';
// Tải ảnh nền theo toạ độ (ảnh vệ tinh Esri hoặc OpenStreetMap) qua máy tính chạy QuickPlan.
const TILE = 256;
const lon2x = (lon, z) => ((lon + 180) / 360) * TILE * 2 ** z;
const lat2y = (lat, z) => { const r = (lat * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * TILE * 2 ** z; };

export async function downloadBasemap(src, lat, lon, sizeM, onProgress, opts = {}) {
  const maxZ = 19;
  const mppAt = (z) => (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
  let z = maxZ;
  while (z > 1 && sizeM / mppAt(z) > 3600) z--;
  const mpp = mppAt(z);
  const halfPx = sizeM / 2 / mpp;
  const cx = lon2x(lon, z), cy = lat2y(lat, z);
  const x0 = cx - halfPx, y0 = cy - halfPx, x1 = cx + halfPx, y1 = cy + halfPx;
  const tx0 = Math.floor(x0 / TILE), tx1 = Math.floor(x1 / TILE), ty0 = Math.floor(y0 / TILE), ty1 = Math.floor(y1 / TILE);
  const W = Math.round(x1 - x0), H = Math.round(y1 - y0);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#e5e7eb'; g.fillRect(0, 0, W, H);
  const jobs = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) jobs.push([tx, ty]);
  let done = 0, ok = 0;
  const run = async ([tx, ty]) => {
    try {
      const r = await fetchTile(src, z, tx, ty);
      if (!r.ok) throw new Error(r.status);
      const bmp = await blobToImage(await r.blob());
      g.drawImage(bmp, Math.round(tx * TILE - x0), Math.round(ty * TILE - y0), TILE, TILE);
      ok++;
    } catch (e) { /* ô thiếu để màu xám */ }
    onProgress && onProgress(++done, jobs.length);
  };
  const queue = jobs.slice();
  await Promise.all(Array.from({ length: 6 }, async () => { while (queue.length) await run(queue.shift()); }));
  if (!ok) throw new Error('chưa có Internet (hoặc máy tính chạy QuickPlan chưa có Internet)');
  if (opts.raw) return { canvas: c, z, px0: x0, py0: y0, mpp, W, H };
  credit(g, W, H, src);
  return { dataURL: c.toDataURL('image/jpeg', 0.86), wM: W * mpp, hM: H * mpp, zoom: z };
}
function credit(g, W, H, src) {
  g.font = `${Math.max(12, Math.round(W / 120))}px sans-serif`; g.fillStyle = 'rgba(255,255,255,.8)';
  const t = src === 'osm' ? '© OpenStreetMap contributors' : 'Ảnh: Esri, Maxar, Earthstar Geographics';
  const tw = g.measureText(t).width;
  g.fillRect(W - tw - 16, H - Math.round(W / 70) - 8, tw + 12, Math.round(W / 70) + 6);
  g.fillStyle = '#333'; g.fillText(t, W - tw - 10, H - 8);
}
// Ảnh nền đặt theo lưới VN-2000: tải ảnh Web Mercator rộng hơn một chút rồi nắn (affine) về lưới chiếu của kinh tuyến trục.
// box: [x0, y0, x1, y1] toạ độ bản vẽ (mét); toLL(p) -> [lat, lon]
export async function downloadGridBasemap(src, box, toLL, onProgress) {
  const [bx0, by0, bx1, by1] = box, sizeM = Math.max(bx1 - bx0, by1 - by0);
  const c0 = toLL([(bx0 + bx1) / 2, (by0 + by1) / 2]);
  const r = await downloadBasemap(src, c0[0], c0[1], sizeM * 1.08, onProgress, { raw: true });
  const res = r.mpp; // mét / điểm ảnh trên lưới ra
  const W = Math.round((bx1 - bx0) / res), H = Math.round((by1 - by0) / res);
  const merc = (p) => { const ll = toLL(p); return [lon2x(ll[1], r.z) - r.px0, lat2y(ll[0], r.z) - r.py0]; };
  // ánh xạ điểm ảnh ra (u, v) -> điểm ảnh nguồn: affine từ 3 góc
  const P0 = merc([bx0, by0]), Pu = merc([bx1, by0]), Pv = merc([bx0, by1]);
  const a = (Pu[0] - P0[0]) / W, b = (Pu[1] - P0[1]) / W, cc = (Pv[0] - P0[0]) / H, d = (Pv[1] - P0[1]) / H;
  // nghịch đảo: nguồn -> ra
  const det = a * d - b * cc;
  const ia = d / det, ib = -b / det, ic = -cc / det, id = a / det;
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const g = out.getContext('2d'); g.fillStyle = '#e5e7eb'; g.fillRect(0, 0, W, H);
  g.imageSmoothingQuality = 'high';
  g.setTransform(ia, ib, ic, id, -(ia * P0[0] + ic * P0[1]), -(ib * P0[0] + id * P0[1]));
  g.drawImage(r.canvas, 0, 0);
  g.setTransform(1, 0, 0, 1, 0, 0);
  credit(g, W, H, src);
  return { dataURL: out.toDataURL('image/jpeg', 0.86), x: bx0, y: by0, wM: W * res, hM: H * res, zoom: r.z };
}

function blobToImage(blob) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => { URL.revokeObjectURL(i.src); res(i); }; i.onerror = rej; i.src = URL.createObjectURL(blob); });
}
