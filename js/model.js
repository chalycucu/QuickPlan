// Dữ liệu bản vẽ, danh mục ký hiệu đất, khối mẫu và tính chỉ tiêu.
import * as G from './geom.js';
import { LU_PLANS, LU_TABLES } from './landuse-tables.js';
import { junctionCorners } from './roadops.js';

export const APP_VERSION = '0.31.0';
export const DESIGNER = 'Phan Trọng Tuệ';

// Danh mục chức năng sử dụng đất: theo loại hình quy hoạch (QHC 1/10.000, QHC 1/5.000, QHPK 1/2.000, QHCT)
// và cách ghi mã (theo mã đất TN – TT 08/2024, hoặc theo mã XD – chức năng quy hoạch). Khoá của mỗi mã = mã TN
// (dòng cây xanh không có mã TN thì khoá = mã XD); nhãn hiện trên bản vẽ (lbl) đổi theo cách ghi mã.
// cat: o = đất ở, cc = công cộng, cx = cây xanh, gt = giao thông, mn = mặt nước, k = khác
export { LU_PLANS };
export const LU_BY = { TN: 'Mã theo TN', XD: 'Mã theo XD' };
// chỉ tiêu mặc định (MĐXD %, hệ số SDĐ, tầng cao) như bản cũ, theo nhóm mã
const IND = {
  ODT: ['o', 60, 3.0, 5], ONT: ['o', 50, 1.5, 3],
  TMD: ['k', 50, 5.0, 20], PNK: ['k', 40, 1.5, 4],
  TSC: ['cc', 40, 2.0, 7], DXH: ['cc', 40, 2.0, 5], CCC: ['cc', 40, 2.0, 5], DCH: ['cc', 40, 2.0, 5],
  DVH: ['cc', 40, 1.5, 4], DYT: ['cc', 40, 2.0, 7], DGD: ['cc', 40, 1.2, 4], DKH: ['cc', 40, 1.2, 4], DTT: ['cc', 25, 0.5, 2],
  CQP: ['k', 40, 2.0, 7], CAN: ['k', 40, 2.0, 7], DMT: ['k', 40, 2.0, 7], DKT: ['k', 40, 2.0, 7], DNG: ['k', 40, 2.0, 7], DSK: ['k', 40, 2.0, 7], SCT: ['k', 40, 2.0, 7], CGT: ['k', 40, 2.0, 7],
  CSK: ['k', 60, 1.5, 3], SCC: ['k', 60, 1.5, 3], SKK: ['k', 60, 1.5, 3], SKN: ['k', 60, 1.5, 3], SKC: ['k', 60, 1.5, 3], SKS: ['k', 30, 0.5, 2], DNL: ['k', 40, 1.0, 3],
  DCT: ['k', 40, 1.0, 3], DPC: ['k', 40, 1.0, 3], DRA: ['k', 40, 1.0, 3], DBV: ['k', 40, 1.0, 3],
  DDD: ['k', 30, 0.6, 2], TON: ['k', 30, 0.6, 2], TIN: ['k', 30, 0.6, 2], NTD: ['k', 10, 0.1, 1],
  DGT: ['gt', 0, 0, 0], DTL: ['mn', 0, 0, 0], MNC: ['mn', 0, 0, 0], SON: ['mn', 0, 0, 0], MCS: ['mn', 0, 0, 0], NTS: ['mn', 0, 0, 0],
  DKV: ['cx', 25, 0.5, 2], CX: ['cx', 5, 0.05, 1], CXD: ['cx', 5, 0.05, 1], CXH: ['cx', 5, 0.05, 1], CXL: ['cx', 0, 0, 0],
};
const indOf = (k) => IND[k] || ['k', 0, 0, 0]; // đất nông nghiệp, rừng, chưa sử dụng: không xây dựng
// ký hiệu của các bản trước -> mã TN tương ứng (bản vẽ cũ tự đổi khi mở)
export const LEGACY_LU = { TMDV: 'TMD', CC: 'CCC', GD: 'DGD', YT: 'DYT', VH: 'DVH', TDTT: 'DTT', CQ: 'TSC', CXCL: 'CXL', MN: 'MNC', HTKT: 'DCT' };
export const LEGACY_KEEP = { // không có mã tương ứng: giữ thành chức năng riêng của bản vẽ
  OXH: { name: 'Nhà ở xã hội', color: '#f2b84b', cat: 'o', mdxd: 50, far: 5.0, floors: 15 },
  HH: { name: 'Đất hỗn hợp', color: '#e7a07a', cat: 'k', mdxd: 50, far: 6.0, floors: 25 },
  BDX: { name: 'Bãi đỗ xe', color: '#cfcfcf', cat: 'gt', mdxd: 10, far: 0.2, floors: 2 },
};
export function luTable(plan, by) {
  const rows = LU_TABLES[plan] || LU_TABLES.QHPK, out = {};
  for (const [tn, xd, tnName, fnName, color] of rows) {
    const key = tn || xd, [cat, mdxd, far, floors] = indOf(key);
    out[key] = { name: by === 'XD' ? fnName || tnName : tnName || fnName, lbl: by === 'XD' ? xd || tn : tn || xd, tn, xd, tnName, fnName, color: color.toLowerCase(), cat, mdxd, far, floors };
  }
  return out;
}
export const luPlanOf = (doc) => { const s = (doc && doc.settings) || {}; return { plan: LU_TABLES[s.luPlan] ? s.luPlan : 'QHPK', by: s.luBy === 'XD' ? 'XD' : 'TN' }; };
export const LANDUSE = luTable('QHPK', 'TN');
let LANDUSE_DEFAULT = luTable('QHPK', 'TN');
export const isDefaultLanduse = (code) => !!LANDUSE_DEFAULT[code];
export const LANDUSE_DEFAULT_OF = (code) => LANDUSE_DEFAULT[code];
// nhãn mã hiện trên bản vẽ, bảng thống kê
export const luLabel = (code) => (LANDUSE[code] && LANDUSE[code].lbl) || code;
// Chức năng SDĐ riêng của bản vẽ (thêm mới, đổi màu) – đặt lại mặc định khi mở bản vẽ khác hoặc đổi loại hình / cách ghi mã
export function applyLanduse(doc) {
  const { plan, by } = luPlanOf(doc);
  LANDUSE_DEFAULT = luTable(plan, by);
  for (const k of Object.keys(LANDUSE)) delete LANDUSE[k];
  for (const [k, v] of Object.entries(LANDUSE_DEFAULT)) LANDUSE[k] = { ...v };
  for (const [k, v] of Object.entries((doc && doc.settings && doc.settings.landuse) || {})) LANDUSE[k] = { ...(LANDUSE[k] || { cat: 'k', mdxd: 40, far: 1, floors: 3, lbl: k, name: k, color: '#b39ddb' }), ...v, custom: !LANDUSE_DEFAULT[k] };
}
// Danh sách nút chọn mã: theo XD thì gộp các mã TN cùng ký hiệu + chức năng + màu thành một nút (đại diện = mã TN đầu tiên)
export function luChoices() {
  const seen = new Map();
  for (const [k, v] of Object.entries(LANDUSE)) { const g = v.lbl + '|' + v.name + '|' + v.color; if (!seen.has(g)) seen.set(g, k); }
  return [...seen.values()];
}
// bản vẽ của bản trước 0.22: đổi ký hiệu cũ sang mã TN
function migrateLanduse(d) {
  const st = d.settings; if (st.luV >= 2) return;
  st.luV = 2;
  const lu = st.landuse || {};
  for (const k of Object.keys(LEGACY_LU)) delete lu[k]; // màu đã đổi của ký hiệu cũ: theo bảng màu mới
  for (const it of d.items) {
    if (it.kind !== 'zone' || !it.props) continue;
    const c = it.props.code;
    if (LEGACY_LU[c]) it.props.code = LEGACY_LU[c];
    else if (LEGACY_KEEP[c] && !lu[c]) lu[c] = { ...LEGACY_KEEP[c] };
  }
  if (Object.keys(lu).length) st.landuse = lu;
}

export const CAT_NAMES = { o: 'Đất ở', gt: 'Giao thông', cx: 'Cây xanh', cc: 'Công cộng', mn: 'Mặt nước', k: 'Khác' };
export const CAT_COLORS = { o: '#f6d36b', gt: '#9aa3ad', cx: '#86c96a', cc: '#e5606b', mn: '#8ec9ec', k: '#b39ddb' };

export const LAYERS = [
  { id: 8, name: 'Ảnh nền (vệ tinh / Google)' },
  { id: 0, name: 'Nền CAD (DXF / GIS)' },
  { id: 2, name: 'Giao thông' },
  { id: 3, name: 'Sử dụng đất' },
  { id: 4, name: 'Sơ đồ phân tích' },
  { id: 5, name: 'Cọ nháp' },
  { id: 6, name: 'Công trình' },
  { id: 9, name: 'Công trình hiện trạng' },
  { id: 7, name: 'Cảnh quan' },
];
// thứ tự vẽ mặc định (từ dưới lên trên): lớp trên che lớp dưới
export const LAYER_ORDER = [8, 0, 3, 7, 2, 9, 6, 4, 5];
export const EXIST_LAYER = 9; // nhà hiện trạng (tải từ OpenStreetMap hoặc chuyển từ công trình)
export const BASE_LAYER = 8; // lớp riêng của ảnh nền, tách khỏi lớp nét CAD (0)
export const KIND_LAYER = { water: 7, road: 2, zone: 3, park: 7, land: 7, cover: 7, building: 6, facet: 6, arrow: 4, flow: 4, circle: 4, cloud: 4, icon: 4, sketch: 5, cad: 0, junction: 2 };
// QP-20: nét DXF / CAD «chỉ để nhìn» (Quản lý lớp, lớp 0): không bắt điểm, không chọn, không làm ranh giới phủ màu, cắt…
export const cadInert = (doc, it) => it.kind === 'cad' && !!((doc.layers || []).find((l) => l.id === layerOf(it)) || {}).cadView;
export const liveItems = (doc) => doc.items.filter((it) => !cadInert(doc, it));
// lớp người dùng tạo có số hiệu từ 100; đối tượng được gán vào đó giữ it.layer
export const layerOf = (it) => (it.layer >= 100 || (it.layer === 9 && (it.kind === 'building' || it.kind === 'facet')) ? it.layer : KIND_LAYER[it.kind] ?? 4);
export function isLocked(doc, it) { const l = doc.layers.find((x) => x.id === layerOf(it)); return !!(l && l.locked); }
export function layerOrder(doc) {
  const ids = new Set(doc.layers.map((l) => l.id));
  const o = (doc.layerOrder || LAYER_ORDER).filter((id) => ids.has(id));
  for (const l of doc.layers) if (!o.includes(l.id)) o.push(l.id);
  return o;
}
export function layerName(doc, id) { const l = doc.layers.find((x) => x.id === id); return (l && l.name) || (LAYERS.find((x) => x.id === id) || {}).name || 'Lớp ' + id; }
// Nâng cấp bản vẽ cũ: đủ các lớp, nét nháp sang lớp riêng
export function upgradeDoc(d) {
  // QP-20: lớp «Cọ nháp» (id 5) mặc định: nét vẽ (sketch) nằm ở đây; bản vẽ 0.24–0.26 tự thêm lớp
  const l3 = d.layers.find((l) => l.id === 3);
  // QP-22: lớp «Địa hình & Sông hồ» (id 1) gộp vào lớp «Cảnh quan» (id 7): sông hồ thuộc nhóm Cảnh quan
  d.layers = d.layers.filter((l) => l.id !== 1); if (d.layerOrder) d.layerOrder = d.layerOrder.filter((id) => id !== 1);
  // bản vẽ cũ: lớp Công trình / Cảnh quan tách ra từ lớp 3, giữ nguyên trạng thái hiện / khoá / độ rõ
  const l0 = d.layers.find((l) => l.id === 0), had8 = d.layers.some((l) => l.id === 8);
  for (const L of LAYERS) if (!d.layers.find((l) => l.id === L.id)) d.layers.push(l3 && (L.id === 6 || L.id === 7) ? { ...l3, id: L.id } : L.id === 8 && l0 ? { ...l0, id: 8 } : { id: L.id, visible: true, opacity: 1 });
  // bản vẽ cũ: ảnh nền tách khỏi lớp CAD, nằm ngay dưới lớp CAD
  if (!had8 && d.layerOrder && !d.layerOrder.includes(8)) { const i = d.layerOrder.indexOf(0); d.layerOrder.splice(i < 0 ? 0 : i, 0, 8); }
  if (d.layerOrder && !d.layerOrder.includes(9)) { const i = d.layerOrder.indexOf(6); d.layerOrder.splice(i < 0 ? 0 : i, 0, 9); }
  d.layers.sort((a, b) => a.id - b.id);
  const custom = new Set(d.layers.filter((l) => l.id >= 100).map((l) => l.id));
  for (const it of d.items) { if (it.layer >= 100 && !custom.has(it.layer)) it.layer = null; it.layer = layerOf(it); }
  d.layerOrder = layerOrder(d);
  d.settings.zoneLabel = Object.assign({ code: true, area: true, indic: true }, d.settings.zoneLabel || {});
  if (d.settings.zoneLabel.indic === false) Object.assign(d.settings.zoneLabel, { indic: true, mdxd: false, far: false, floors: false });
  migrateLanduse(d);
  applyLanduse(d);
  return d;
}
export const KIND_NAMES = {
  road: 'Đường giao thông', building: 'Công trình', water: 'Sông hồ', park: 'Cây xanh', zone: 'Ô đất',
  arrow: 'Mũi tên', flow: 'Mũi tên nét đứt', circle: 'Vòng tròn', cloud: 'Vùng mây', sketch: 'Nét vẽ', cad: 'Nét CAD', icon: 'Biểu tượng', land: 'Cảnh quan', facet: 'Mảng mặt khối', cover: 'Vật liệu phủ', junction: 'Góc giao lộ',
};

// Liên hệ chỉ tiêu: HSSDĐ = MĐXD (%) / 100 × Tầng cao. Giá trị được «giữ» (lock) là hằng số,
// sửa một trong hai giá trị còn lại thì giá trị kia tự tính theo công thức.
export const IND_KEYS = { mdxd: 'maxMdxd', far: 'maxFar', floors: 'maxFloors' };
export function setIndicator(pr, key, v) {
  const lock = pr.indLock || 'mdxd';
  const r2 = (x) => Math.round(x * 100) / 100;
  pr[IND_KEYS[key]] = v;
  const md = pr.maxMdxd / 100, far = pr.maxFar, fl = pr.maxFloors;
  // giá trị cần tính lại: không phải giá trị vừa nhập, không phải giá trị giữ cố định
  let target = ['mdxd', 'far', 'floors'].find((k) => k !== key && k !== lock);
  if (key === lock) target = key === 'far' ? 'floors' : 'far';
  if (target === 'far') pr.maxFar = r2(md * fl);
  else if (target === 'floors') pr.maxFloors = md > 0 ? r2(far / md) : 0;
  else if (target === 'mdxd') pr.maxMdxd = fl > 0 ? r2((far / fl) * 100) : 0;
  return target;
}

// Cọ cảnh quan: kiểu nét
export const LAND_STYLES = {
  row: { name: 'Hàng cây', hint: 'Vẽ nét để trồng một hàng cây dọc theo nét' },
  grove: { name: 'Cụm cây', hint: 'Khoanh vùng để trồng cây rải trong vùng' },
  lawn: { name: 'Thảm cỏ', hint: 'Khoanh vùng thảm cỏ, sân vườn' },
  plaza: { name: 'Sân lát', hint: 'Khoanh vùng quảng trường, sân lát đá' },
  flower: { name: 'Bồn hoa', hint: 'Khoanh vùng bồn hoa, vườn hoa' },
  tree: { name: 'Cây đơn', hint: 'Chạm để đặt một cây' },
};
export const LAND_CLOSED = { grove: 1, lawn: 1, plaza: 1, flower: 1 };
export const LAND_COLORS = { grove: '#cfe8bf', lawn: '#b5df97', plaza: '#e9dfcc', flower: '#f4c2d7' };
// Vị trí cây cố định (không ngẫu nhiên theo lần vẽ) cho hàng cây, cụm cây, cây đơn
export function landTrees(it, max = 2000) {
  const pr = it.props, sp = pr.spacing || 8, out = [];
  if (pr.style === 'tree') return [it.pts[0]];
  if (pr.style === 'row') {
    const L = G.length(it.pts); const n = Math.max(1, Math.min(max, Math.floor(L / sp)));
    for (let i = 0; i <= n; i++) out.push(alongAt(it.pts, (L * i) / n));
    return out;
  }
  if (pr.style === 'grove') {
    const bb = G.bbox(it.pts);
    for (let x = bb.x0 + sp / 2; x < bb.x1 && out.length < max; x += sp) for (let y = bb.y0 + sp / 2; y < bb.y1 && out.length < max; y += sp * 0.87) {
      const j = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; const fx = j - Math.floor(j), fy = (j * 7.13) % 1;
      const p = [x + (fx - 0.5) * sp * 0.6 + ((Math.round(y / (sp * 0.87)) % 2) * sp) / 2, y + (Math.abs(fy) - 0.5) * sp * 0.5];
      if (G.pointInPolygon(p, it.pts)) out.push(p);
    }
  }
  return out;
}
// Kích thước từng cây: cùng cỡ, hoặc to nhỏ khác nhau (cố định theo vị trí)
export function landTreeSize(it, p) {
  const s = it.props.size || 6;
  if (!it.props.vary) return s;
  const j = Math.sin(p[0] * 91.17 + p[1] * 37.71) * 43758.5453; const f = j - Math.floor(j);
  return s * (0.55 + 0.9 * f);
}
// Thư viện mẫu cây: mẫu có sẵn + mẫu nhập từ file (.glb / .gltf / .obj) lưu trong bản vẽ
export const TREE_TYPES = {
  round: { name: 'Cây tán tròn' },
  cone: { name: 'Cây lá kim' },
  palm: { name: 'Cau, dừa' },
  column: { name: 'Cây tán trụ' },
  shrub: { name: 'Cây bụi' },
};
export function treeName(doc, key) { if (TREE_TYPES[key]) return TREE_TYPES[key].name; const t = ((doc.settings && doc.settings.treeLib) || []).find((x) => x.id === key); return t ? t.name : TREE_TYPES.round.name; }
// Mảng mặt khối (chia mặt trong 3D): hình chiếu bằng để chọn, xoá và vẽ 2D
export function facetFootprint(f, parent) {
  const pr = f.props;
  if (pr.face === 'top' || !parent) return f.pts;
  const P = parent.pts, i = pr.face, a = P[i], b = P[(i + 1) % P.length];
  const L = G.dist(a, b) || 1, t = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  const n = facetNormal(parent, i);
  const us = pr.poly.map((q) => q[0]); const u0 = Math.min(...us), u1 = Math.max(...us);
  const dd = pr.depth || 0, d = Math.abs(dd) < 0.4 ? (dd < 0 ? -0.4 : 0.4) : dd; // âm: hình chiếu nằm trong khối
  const at = (u, k) => [a[0] + t[0] * u + n[0] * k, a[1] + t[1] * u + n[1] * k];
  return [at(u0, 0), at(u1, 0), at(u1, d), at(u0, d)];
}
// Đa giác gốc của một mặt khối trong hệ toạ độ của mặt: mái = toạ độ bản vẽ; mặt đứng i = (u dọc cạnh, v cao từ chân khối)
export function faceBase(parent, face) {
  if (face === 'top') return parent.pts.map((q) => q.slice());
  const P = parent.pts, a = P[face], b = P[(face + 1) % P.length];
  const L = G.dist(a, b), H = bldHeight(parent);
  return [[0, 0], [L, 0], [L, H], [0, H]];
}
// Dọn mảng mặt khối: bỏ mảng mất khối cha / mất cạnh, cập nhật hình chiếu bằng
export function syncFacets(doc) {
  if (!doc.items.some((i) => i.kind === 'facet')) return;
  const byId = new Map(doc.items.map((i) => [i.id, i]));
  doc.items = doc.items.filter((f) => {
    if (f.kind !== 'facet') return true;
    const par = byId.get(f.props.parent);
    if (!par || par.kind !== 'building') return false;
    if (f.props.face === 'top') { f.props.poly = f.pts.map((q) => q.slice()); return f.pts.length >= 3; }
    if (!(f.props.face < par.pts.length)) return false;
    f.pts = facetFootprint(f, par);
    return true;
  });
}
// pháp tuyến ngoài (2D) của cạnh i của đa giác mặt bằng
export function facetNormal(parent, i) {
  const P = parent.pts, a = P[i], b = P[(i + 1) % P.length];
  const L = G.dist(a, b) || 1; let n = [(b[1] - a[1]) / L, -(b[0] - a[0]) / L];
  const m = [(a[0] + b[0]) / 2 + n[0] * 0.01, (a[1] + b[1]) / 2 + n[1] * 0.01];
  if (G.pointInPolygon(m, P)) n = [-n[0], -n[1]];
  return n;
}
function alongAt(pts, d) {
  for (let i = 1; i < pts.length; i++) { const L = G.dist(pts[i - 1], pts[i]); if (d <= L || i === pts.length - 1) { const t = L ? Math.min(1, d / L) : 0; return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]; } d -= L; }
  return pts[0];
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function newDrawing(name = 'Bản vẽ mới') {
  const now = Date.now();
  return {
    id: uid(), name, createdAt: now, updatedAt: now, format: 1,
    settings: { lat: 21.0285, lon: 105.8542, georef: false, northDeg: 0, peoplePerM2: 40, maxFloorsWarn: true, showBuildLine: true },
    layers: LAYERS.map((l) => ({ id: l.id, visible: true, opacity: 1 })),
    base: null, // { image: dataURL, x, y, w, h, opacity }
    items: [],
    view: { cx: 0, cy: 0, scale: 2 },
  };
}

// ---------- Khối mẫu (Parametric Presets) ----------
export const PRESETS = {
  box: { name: 'Hộp', params: { w: 30, d: 20 } },
  cyl: { name: 'Trụ tròn', params: { r: 12 } },
  L: { name: 'Chữ L', params: { w: 40, d: 40, t: 14 } },
  U: { name: 'Chữ U', params: { w: 50, d: 40, t: 14 } },
  C: { name: 'Chữ C', params: { w: 45, d: 45, t: 14 } },
  H: { name: 'Chữ H', params: { w: 50, d: 40, t: 14 } },
  ring: { name: 'Donut / Ring', params: { w: 50, d: 50, t: 14 } },
  slab: { name: 'Khối dải', params: { w: 70, d: 14 } },
};
export const PARAM_NAMES = { w: 'Rộng (m)', d: 'Sâu (m)', t: 'Bề dày nhà (m)', r: 'Bán kính (m)' };

// Trả về { outer, holes } với gốc toạ độ tại tâm, chưa xoay
export function presetShape(type, p) {
  const w = p.w, d = p.d, t = Math.min(p.t || 0, (p.w || 0) / 2 - 1, (p.d || 0) / 2 - 1);
  const W = w / 2, D = d / 2;
  const R = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  switch (type) {
    case 'box': case 'slab': return { outer: R(-W, -D, W, D), holes: [] };
    case 'cyl': {
      const pts = []; const n = 32;
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; pts.push([Math.cos(a) * p.r, Math.sin(a) * p.r]); }
      return { outer: pts, holes: [] };
    }
    case 'L': return { outer: [[-W, -D], [-W + t, -D], [-W + t, D - t], [W, D - t], [W, D], [-W, D]], holes: [] };
    case 'U': return { outer: [[-W, -D], [-W + t, -D], [-W + t, D - t], [W - t, D - t], [W - t, -D], [W, -D], [W, D], [-W, D]], holes: [] };
    case 'C': return { outer: [[-W, -D], [W, -D], [W, -D + t], [-W + t, -D + t], [-W + t, D - t], [W, D - t], [W, D], [-W, D]], holes: [] };
    case 'H': return { outer: [[-W, -D], [-W + t, -D], [-W + t, -t / 2], [W - t, -t / 2], [W - t, -D], [W, -D], [W, D], [W - t, D], [W - t, t / 2], [-W + t, t / 2], [-W + t, D], [-W, D]], holes: [] };
    case 'ring': return { outer: R(-W, -D, W, D), holes: [R(-W + t, -D + t, W - t, D - t).reverse()] };
  }
  return { outer: R(-W, -D, W, D), holes: [] };
}

export function applyPreset(item) {
  const pr = item.props.preset;
  const s = presetShape(pr.type, pr.params);
  const tr = (pts) => G.translatePts(G.rotatePts(pts, pr.rot || 0), pr.cx, pr.cy);
  item.pts = tr(s.outer);
  item.holes = s.holes.map(tr);
}

// ---------- Đo đạc từng đối tượng ----------
export function roadTotalWidth(it) { return it.props.width + 2 * it.props.sidewalk; }

export function itemArea(it) {
  switch (it.kind) {
    case 'road': return G.length(it.pts) * roadTotalWidth(it);
    case 'water': return it.props.mode === 'river' ? G.length(it.pts) * it.props.width : G.area(it.pts);
    case 'land': if (!LAND_CLOSED[it.props.style]) return 0; // fallthrough
    case 'building': case 'zone': case 'park': case 'cover':
      return G.area(it.pts) - (it.holes || []).reduce((s, h) => s + G.area(h), 0);
  }
  return 0;
}
// QP-18: phần lộ giới vát ở góc giao lộ (tam giác vát vỉa hè) là đất giao thông
export function junctionCutArea(doc, j) { return junctionCorners(doc, j).reduce((t, c) => t + (c.chamfer ? G.area(c.chamfer) : 0), 0); }

// ---------- Bảng chỉ tiêu (HUD) ----------
export function computeMetrics(doc) {
  const zones = doc.items.filter((i) => i.kind === 'zone');
  const buildings = doc.items.filter((i) => i.kind === 'building');
  // lưới không gian để tìm ô đất chứa một điểm nhanh (bản vẽ lớn hàng nghìn công trình)
  const CELL = 200, grid = new Map(), zb = new Map();
  for (const z of zones) {
    if (!z.pts.length) continue;
    const b = G.bbox(z.pts); zb.set(z, b);
    for (let gx = Math.floor(b.x0 / CELL); gx <= Math.floor(b.x1 / CELL); gx++) for (let gy = Math.floor(b.y0 / CELL); gy <= Math.floor(b.y1 / CELL); gy++) {
      const k = gx + ',' + gy; let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(z);
    }
  }
  const insideZone = (p) => {
    const a = grid.get(Math.floor(p[0] / CELL) + ',' + Math.floor(p[1] / CELL)); if (!a) return undefined;
    for (let i = 0; i < a.length; i++) { const z = a[i], b = zb.get(z); if (p[0] >= b.x0 && p[0] <= b.x1 && p[1] >= b.y0 && p[1] <= b.y1 && G.pointInPolygon(p, z.pts) && !(z.holes && z.holes.some((h) => G.pointInPolygon(p, h)))) return z; }
    return undefined;
  };
  const innerOf = new Map();
  const cats = { o: 0, gt: 0, cx: 0, cc: 0, mn: 0, k: 0 };
  let total = 0;
  for (const z of zones) {
    const a = itemArea(z); total += a;
    cats[(LANDUSE[z.props.code] || LANDUSE.ODT).cat] += a;
  }
  for (const it of doc.items) {
    if (it.kind === 'road') { const a = itemArea(it); cats.gt += a; total += a; }
    if (it.kind === 'junction') { const a = junctionCutArea(doc, it); cats.gt += a; total += a; }
    if (it.kind === 'park' && !insideZone(G.centroid(it.pts))) { const a = itemArea(it); cats.cx += a; total += a; }
    if (it.kind === 'water') {
      const c = it.props.mode === 'river' ? it.pts[Math.floor(it.pts.length / 2)] : G.centroid(it.pts);
      if (!insideZone(c)) { const a = itemArea(it); cats.mn += a; total += a; }
    }
  }
  // trừ phần chồng lấn tại nút giao để không tính hai lần
  const roads = doc.items.filter((i) => i.kind === 'road');
  for (let i = 0; i < roads.length; i++) for (let j = 0; j < roads.length; j++) {
    if (i === j) continue;
    const r1 = roads[i], r2 = roads[j], w1 = roadTotalWidth(r1), w2 = roadTotalWidth(r2);
    let ov = 0;
    if (i < j) ov += G.countCrossings(r1.pts, r2.pts) * w1 * w2;
    for (const e of [r1.pts[0], r1.pts[r1.pts.length - 1]]) {
      const isEnd2 = G.dist(e, r2.pts[0]) < 0.5 || G.dist(e, r2.pts[r2.pts.length - 1]) < 0.5;
      if (!isEnd2 && G.distToPolyline(e, r2.pts).d < 0.5) ov += (w1 * w2) / 2;
    }
    cats.gt -= ov; total -= ov;
  }
  let fp = 0, gfa = 0, resGfa = 0;
  const lots = new Map(zones.map((z) => [z.id, { zone: z, area: itemArea(z), fp: 0, gfa: 0, maxFloors: 0 }]));
  const alerts = {}; // id -> 'warn' | 'over'
  const outside = [];
  const viol = {}; // id công trình -> ['Tầng cao 9T > 5T', 'Khoảng lùi 2,1 m < 6 m', 'MĐXD lô 52% > 40%']
  const addV = (id, t) => (viol[id] || (viol[id] = [])).push(t);
  const f1 = (x) => G.fmtNum(x, 1);
  const level = (v, lim) => (lim <= 0 ? (v > 0 ? 'over' : null) : v > lim + 1e-6 ? 'over' : v > lim * 0.9 ? 'warn' : null);
  const byId = new Map(doc.items.map((i) => [i.id, i]));
  const zoneOf = {};
  for (const b of buildings) {
    if (b.props.existing && !insideZone(G.centroid(b.pts))) continue; // nhà hiện trạng ngoài các ô đất: không tính vào chỉ tiêu
    const a = itemArea(b); const own = b.props.floors || 1;
    const stacked = !!(b.props.on && byId.get(b.props.on));
    const f = stackFloors(b, byId); // tổng số tầng tính từ mặt đất (khối đặt chồng lên khối khác)
    if (!stacked) fp += a; // khối chồng không chiếm thêm đất
    gfa += a * own;
    const z = insideZone(G.centroid(b.pts));
    if (z) zoneOf[b.id] = z;
    if (z) {
      const L = lots.get(z.id); if (!stacked) L.fp += a; L.gfa += a * own; L.maxFloors = Math.max(L.maxFloors, f);
      if ((LANDUSE[z.props.code] || {}).cat === 'o') resGfa += a * own;
      if (z.props.maxFloors > 0 && f > z.props.maxFloors) { alerts[b.id] = 'over'; addV(b.id, `Tầng cao ${f}T > ${z.props.maxFloors}T`); }
      if (z.props.setback > 0) {
        let inner = innerOf.get(z); if (!inner) innerOf.set(z, (inner = G.offsetPolygon(z.pts, -z.props.setback)));
        if (b.pts.some((p) => !G.pointInPolygon(p, inner) && G.distToPolyline(p, inner, true).d > 0.05)) {
          alerts[b.id] = 'over'; outside.push(b.id);
          let dmin = Infinity; for (const p of b.pts) { const d = G.pointInPolygon(p, z.pts) ? G.distToPolyline(p, z.pts, true).d : 0; if (d < dmin) dmin = d; }
          addV(b.id, `Khoảng lùi ${f1(dmin)} m < ${f1(z.props.setback)} m`);
        }
      }
    } else resGfa += 0;
  }
  for (const L of lots.values()) {
    L.mdxd = L.area ? (L.fp / L.area) * 100 : 0;
    L.far = L.area ? L.gfa / L.area : 0;
    const z = L.zone.props;
    const lv = worst(level(L.mdxd, z.maxMdxd), level(L.far, z.maxFar));
    if (lv) alerts[L.zone.id] = lv;
    L.overMd = z.maxMdxd > 0 && L.mdxd > z.maxMdxd + 1e-6;
  }
  for (const b of buildings) { const z = zoneOf[b.id], L = z && lots.get(z.id); if (L && L.overMd) addV(b.id, `MĐXD lô ${f1(L.mdxd)}% > ${f1(L.zone.props.maxMdxd)}%`); }
  const people = resGfa / (doc.settings.peoplePerM2 || 40);
  return {
    total, cats, fp, gfa,
    mdxd: total ? (fp / total) * 100 : 0,
    far: total ? gfa / total : 0,
    people, greenPerCap: people >= 1 ? cats.cx / people : null,
    lots: [...lots.values()], alerts, outside, zoneOf, viol, lotNames: lotNumbering(zones),
  };
}

// ---------- Khối chồng (mặt trên khối + đẩy khối) ----------
export const bldHeight = (b) => (b.props.floors || 1) * (b.props.floorH || 3.3);
// Địa hình thật (không san nền): chân công trình đặt ở điểm thấp nhất của mặt đất dưới khối
let groundFn = null;
export function setGroundFn(f) { groundFn = f || null; }
export const groundAt = (x, y) => (groundFn ? groundFn(x, y) : 0);
function groundOf(b) {
  if (!groundFn || !b.pts || !b.pts.length) return 0;
  let m = Infinity; for (const p of b.pts) { const v = groundFn(p[0], p[1]); if (v < m) m = v; }
  return isFinite(m) ? m : 0;
}
export function bldElev(b, byId, depth = 0) {
  if (!b.props.on || depth > 30) return groundOf(b);
  const p = byId.get(b.props.on); if (!p) return 0;
  return bldElev(p, byId, depth + 1) + bldHeight(p);
}
export function stackFloors(b, byId, depth = 0) {
  const own = b.props.floors || 1;
  if (!b.props.on || depth > 30) return own;
  const p = byId.get(b.props.on); return p ? own + stackFloors(p, byId, depth + 1) : own;
}

// ---------- Đánh số lô: theo từng ký hiệu, từ trên xuống dưới, từ trái qua phải (CX01, CX02…) ----------
export function lotNumbering(zones) {
  const names = {};
  const byCode = new Map();
  for (const z of zones) { if (!z.pts.length) continue; const lb = luLabel(z.props.code); const a = byCode.get(lb) || []; a.push(z); byCode.set(lb, a); }
  for (const [code, zs] of byCode) {
    const info = zs.map((z) => { const b = G.bbox(z.pts), c = G.centroid(z.pts); return { z, c, h: b.y1 - b.y0 }; });
    const hs = info.map((i) => i.h).sort((a, b) => a - b);
    const tol = Math.max(5, (hs[hs.length >> 1] || 20) * 0.5);
    info.sort((a, b) => a.c[1] - b.c[1]);
    const rows = [];
    for (const i of info) { const r = rows[rows.length - 1]; if (r && i.c[1] - r.y0 <= tol) r.items.push(i); else rows.push({ y0: i.c[1], items: [i] }); }
    let n = 0;
    for (const r of rows) for (const i of r.items.sort((a, b) => a.c[0] - b.c[0])) names[i.z.id] = code + String(++n).padStart(2, '0');
  }
  return names;
}
export function lotName(metrics, z) {
  if (z.props.name) return z.props.name;
  return (metrics && metrics.lotNames && metrics.lotNames[z.id]) || luLabel(z.props.code);
}
const worst = (a, b) => (a === 'over' || b === 'over' ? 'over' : a || b);

// Phân tích chuỗi gõ nhanh: "ODT 15", "CX", "12 tầng"
export function parseQuick(text) {
  const out = {};
  for (const tok of text.toUpperCase().split(/[\s,;]+/).filter(Boolean)) {
    if (LANDUSE[tok]) out.code = tok;
    else if (!out.code) { const k = Object.keys(LANDUSE).find((c) => LANDUSE[c].lbl === tok); if (k) out.code = k; }
    else if (/^\d+(\.\d+)?$/.test(tok)) out.num = parseFloat(tok);
  }
  return out;
}
