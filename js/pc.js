// Kết nối với máy tính chạy QuickPlan.exe.
// - Mở app từ chính máy tính (địa chỉ IP / localhost): gọi /api/... cùng địa chỉ như trước.
// - Mở app từ trang web (ví dụ github.io): gọi tới https://<IP máy tính>:<cổng> đã lưu trong Cài đặt kết nối.
const KEY = 'qp.pc';
const host = location.hostname;
export const HOSTED = !(host === 'localhost' || host === '127.0.0.1' || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith('[') || host.endsWith('.local'));

export const pc = {
  ok: false, // lần thử gần nhất kết nối được
  get addr() { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } },
  set addr(v) { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch {} },
};

// "192.168.1.5" -> "https://192.168.1.5:8080"; giữ nguyên nếu đã ghi đủ cổng
export function normAddr(s) {
  s = String(s || '').trim().replace(/\/+$/, '');
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  const u = new URL(s);
  if (!u.port && u.protocol === 'http:') u.port = '8080';
  return u.port ? u.origin : u.origin + ':8080'; // QuickPlan.exe nhận cả https trên cổng 8080
}
// Các địa chỉ thử lần lượt: cổng 8080 (http+https chung) rồi 8443
function candidates(input) {
  const b = normAddr(input);
  if (/^https:\/\/[^/]+$/.test(b) && !/:\d+$/.test(String(input).trim().replace(/\/+$/, ''))) return [b, b.replace(/:8080$/, ':8443')];
  return [b];
}

// Gốc địa chỉ API: '' (cùng máy chủ) hoặc 'https://IP:cổng'; null nếu bản web chưa cài máy tính
export function apiBase() {
  if (!HOSTED) return '';
  return pc.addr || null;
}

export async function api(path, opts = {}) {
  const b = apiBase();
  if (b === null) throw new Error('chưa kết nối máy tính');
  return fetch(b + path, { mode: 'cors', ...opts });
}

const timeout = (ms) => (AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined);

export async function ping(base = apiBase()) {
  if (base === null) return false;
  try {
    const r = await fetch(base + '/api/ping', { cache: 'no-store', mode: 'cors', signal: timeout(3000) });
    return r.ok;
  } catch { return false; }
}

// Thử kết nối tới địa chỉ người dùng nhập; trả về thông tin máy tính hoặc ném lỗi dễ hiểu
export async function connect(input) {
  const list = candidates(input);
  for (const base of list) {
    let r;
    try { r = await fetch(base + '/api/info', { cache: 'no-store', mode: 'cors', signal: timeout(5000) }); }
    catch { continue; }
    if (!r.ok) continue;
    const info = await r.json();
    pc.addr = base; pc.ok = true;
    return info;
  }
  throw new Error('Không kết nối được ' + list[0].replace('https://', '') + '. Kiểm tra: QuickPlan.exe bản 0.23.0 trở lên đang chạy, iPad và máy tính cùng Wi-Fi, đã cài chứng chỉ QuickPlan trên iPad.');
}

const DIRECT = {
  sat: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
  osm: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
  dem: (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,
};

// Ô ảnh nền / độ cao: qua máy tính nếu đang kết nối (máy tính lưu lại để dùng khi mất mạng), không thì tải thẳng từ Internet
export async function fetchTile(src, z, x, y) {
  const b = apiBase();
  if (b !== null && (!HOSTED || pc.ok)) {
    try {
      const r = await fetch(`${b}/api/tiles/${src}/${z}/${x}/${y}`, { mode: 'cors' });
      if (r.ok || !HOSTED) return r;
    } catch (e) { if (!HOSTED) throw e; }
  }
  if (!DIRECT[src]) throw new Error('nguồn ảnh không hỗ trợ');
  return fetch(DIRECT[src](z, x, y), { mode: 'cors' });
}

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
// Nhà có sẵn từ OpenStreetMap trong khung (s, w, n, e); trả về Response JSON giống máy tính
export async function fetchOSMBuildings(s, w, n, e) {
  const qs = `s=${s.toFixed(6)}&w=${w.toFixed(6)}&n=${n.toFixed(6)}&e=${e.toFixed(6)}`;
  const b = apiBase();
  if (b !== null && (!HOSTED || pc.ok)) {
    try { const r = await fetch(`${b}/api/osm/buildings?${qs}`, { mode: 'cors' }); if (r.ok || !HOSTED) return r; }
    catch (err) { if (!HOSTED) throw err; }
  }
  const q = `[out:json][timeout:90];(way["building"](${s},${w},${n},${e});relation["building"](${s},${w},${n},${e}););out geom qt;`;
  let last;
  for (const u of OVERPASS) {
    try { const r = await fetch(u, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }); if (r.ok) return r; last = new Error('Overpass ' + r.status); }
    catch (err) { last = err; }
  }
  throw last || new Error('không tải được dữ liệu nhà');
}
