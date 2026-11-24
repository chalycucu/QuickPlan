// QP-24: nhập Excel vào bảng «Chỉ tiêu sử dụng đất»: nối dữ liệu theo trường chung (lô / mã đối tượng / cột riêng)
import { norm } from './bdata.js';

// trường của ô đất có thể cập nhật từ file
export const LOT_FIELDS = [
  ['name', 'Lô'],
  ['code', 'Mã đất'],
  ['maxMdxd', 'MĐXD tối đa (%)'],
  ['maxFar', 'HSSDĐ tối đa'],
  ['maxFloors', 'Tầng tối đa'],
  ['setback', 'Khoảng lùi (m)'],
];
const ALIAS = {
  name: ['lô', 'số hiệu lô', 'ký hiệu lô', 'tên lô', 'lo', 'mã lô'],
  code: ['mã đất', 'ký hiệu đất', 'mã sdđ', 'mã loại đất', 'ký hiệu sdđ'],
  maxMdxd: ['mđxd tối đa (%)', 'mđxd tối đa', 'mật độ xây dựng tối đa', 'mật độ xây dựng tối đa (%)', 'mđxd', 'mđxd (%)', 'mật độ xây dựng', 'mật độ xây dựng (%)', 'mật độ'],
  maxFar: ['hssdđ tối đa', 'hệ số sử dụng đất tối đa', 'hssdđ', 'hệ số sử dụng đất', 'hệ số sdđ'],
  maxFloors: ['tầng tối đa', 'tầng cao tối đa', 'tầng cao', 'tầng', 'số tầng'],
  setback: ['khoảng lùi (m)', 'khoảng lùi', 'chỉ giới xd', 'chỉ giới xây dựng', 'lùi'],
};
// cột tính sẵn (không nhập)
const COMPUTED = ['loại đất', 'diện tích', 'diện tích (m²)', 'diện tích (m2)', 'diện tích (ha)', 'tỷ lệ', 'đánh giá', 'mã đối tượng'];

// hàng tiêu đề: hàng đầu tiên có từ 2 ô trở lên (bỏ dòng tiêu đề bảng ở trên)
export function headerRow(rows) { const i = rows.findIndex((r) => r.filter((v) => String(v ?? '').trim() !== '').length >= 2); return i < 0 ? 0 : i; }

// ánh xạ cột -> trường; cột «tối đa» được ưu tiên hơn cột cùng loại không ghi «tối đa» (giá trị thực tế)
export function mapHeader(header) {
  const H = header.map(norm), out = header.map(() => null);
  for (const [f, al] of Object.entries(ALIAS)) {
    let best = -1, rank = 1e9;
    H.forEach((h, i) => { const k = al.indexOf(h); if (k >= 0 && k < rank) { rank = k; best = i; } });
    if (best >= 0) out[best] = f;
  }
  H.forEach((h, i) => { if (!out[i] && (COMPUTED.includes(h) || Object.values(ALIAS).some((al) => al.includes(h)))) out[i] = '-'; });
  return out; // null: cột riêng (thêm thành cột mới), '-': bỏ qua
}
// số nhỏ (%, lần, tầng, m): dấu phẩy thập phân kiểu Việt cũng được
const num = (v) => { const m = /-?\d+(?:[.,]\d+)?/.exec(String(v ?? '')); const n = m ? parseFloat(m[0].replace(',', '.')) : NaN; return Number.isFinite(n) ? n : null; };
export const lotExtraCols = (zones) => { const s = new Set(); for (const z of zones) for (const k of Object.keys((z.props.zdata && z.props.zdata.extra) || {})) s.add(k); return [...s]; };

// lots: [{ zone, name }]; table: [header, ...data]; keyField: 'name' | 'id' | tên cột riêng
export function joinLots(lots, table, keyCol, keyField, LANDUSE) {
  const [header, ...data] = table, map = mapHeader(header);
  const keyOf = (l) => (keyField === 'name' ? l.name : keyField === 'id' ? l.zone.id : ((l.zone.props.zdata || {}).extra || {})[keyField]);
  const idx = new Map(); for (const l of lots) { const v = keyOf(l); if (v != null && v !== '') idx.set(norm(v), l); }
  let hit = 0, miss = 0, changed = 0, badCode = 0;
  for (const d of data) {
    const l = idx.get(norm(d[keyCol])); if (!l) { if (String(d[keyCol] ?? '').trim()) miss++; continue; }
    hit++;
    const P = l.zone.props;
    header.forEach((h, c) => {
      if (c === keyCol || !String(h).trim()) return;
      const f = map[c], raw = d[c] ?? '', v = String(raw).trim();
      if (f === '-') return;
      if (f === 'name') { if (v && norm(v) !== norm(l.name)) { P.name = v; changed++; } return; }
      if (f === 'code') { if (!v) return; const k = Object.keys(LANDUSE).find((x) => norm(x) === norm(v) || norm(LANDUSE[x].lbl || '') === norm(v)); if (k) { if (P.code !== k) { P.code = k; changed++; } } else badCode++; return; }
      if (f) { if (v === '') return; const n = num(v); if (n == null) return; P[f] = f === 'maxFloors' ? Math.round(n) : n; changed++; return; }
      const zd = P.zdata || (P.zdata = {}), ex = zd.extra || (zd.extra = {});
      if (v === '') delete ex[String(h).trim()]; else ex[String(h).trim()] = v;
      if (!Object.keys(ex).length) delete P.zdata;
      changed++;
    });
  }
  return { hit, miss, changed, badCode };
}
