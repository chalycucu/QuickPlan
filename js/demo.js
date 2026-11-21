// Bản vẽ mẫu để xem thử các tính năng
import * as M from './model.js';
import * as G from './geom.js';

export function demoDrawing() {
  const d = M.newDrawing('Bản vẽ mẫu – Khu đô thị');
  const it = (kind, pts, props, extra = {}) => { const o = { id: M.uid(), kind, layer: M.KIND_LAYER[kind], pts, props, ...extra }; d.items.push(o); return o; };
  const xs = [[-180, 10.25], [0, 15.5], [180, 10.25]];
  const ys = [[-150, 10.25], [0, 15.5], [150, 10.25]];
  // đường
  for (const [y, hw] of ys) it('road', [[-300, y], [300, y]], hw > 12 ? { width: 15, sidewalk: 8, name: 'Trục Đông Tây' } : { width: 10.5, sidewalk: 5, name: '' });
  for (const [x, hw] of xs) it('road', [[x, -260], [x, 260]], hw > 12 ? { width: 15, sidewalk: 8, name: 'Trục Bắc Nam' } : { width: 10.5, sidewalk: 5, name: '' });
  // ô đất
  const codes = [['ODT', 'TMD'], ['CX', 'DGD']];
  const zones = [];
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
    const x0 = xs[i][0] + xs[i][1], x1 = xs[i + 1][0] - xs[i + 1][1];
    const y0 = ys[j][0] + ys[j][1], y1 = ys[j + 1][0] - ys[j + 1][1];
    const code = codes[j][i], lu = M.LANDUSE[code];
    zones.push(it('zone', [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], { code, label: '', maxMdxd: lu.mdxd, maxFar: lu.far, maxFloors: lu.floors }));
  }
  const preset = (type, params, cx, cy, rot, floors) => {
    const b = it('building', [], { floors, floorH: 3.3, preset: { type, params, cx, cy, rot } });
    M.applyPreset(b); return b;
  };
  // ODT: dãy nhà
  for (let k = 0; k < 4; k++) preset('slab', { w: 60, d: 14 }, -125 + (k % 2) * 85, -115 + Math.floor(k / 2) * 55, 0, 5);
  // TMDV: khối U và tháp trụ
  preset('U', { w: 70, d: 60, t: 16 }, 70, -75, 0, 9);
  preset('cyl', { r: 16 }, 140, -40, 0, 25);
  // GD: khối L
  preset('L', { w: 70, d: 60, t: 16 }, 85, 75, 0, 4);
  // CX: công viên + hồ
  it('park', G.chaikin([[-160, 25], [-30, 25], [-30, 130], [-160, 130]], 2, true), { name: 'Công viên trung tâm' });
  it('water', G.catmullRom([[-120, 55], [-70, 50], [-55, 85], [-95, 105], [-130, 90]], 6, true), { mode: 'lake', setback: 8, name: 'Hồ điều hoà' });
  // sông phía Nam
  it('water', G.catmullRom([[-320, 235], [-150, 210], [0, 245], [150, 215], [320, 240]], 8, false), { mode: 'river', width: 30, setback: 20, name: 'Sông' });
  // sơ đồ phân tích
  it('arrow', G.catmullRom([[-290, -210], [-150, -205], [0, -215], [140, -205], [280, -210]], 6, false), { label: 'Trục động lực phát triển' });
  it('flow', G.catmullRom([[260, 200], [200, 150], [150, 120]], 6, false), { label: 'Gió Đông Nam' });
  it('circle', [[0, 0]], { radius: 300, label: 'Bán kính phục vụ' });
  it('cloud', [[20, -140], [170, -140], [170, -15], [20, -15]], { label: 'Giai đoạn 1' });
  d.view = null;
  return d;
}

// Bản vẽ thử quy mô lớn (~3000 ha) để kiểm tra hiệu năng
export function bigDemoDrawing(sizeM = 5500, step = 180) {
  const d = M.newDrawing('Thử tải 3000 ha');
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const it = (kind, pts, props) => { const o = { id: M.uid(), kind, layer: M.KIND_LAYER[kind], pts, props }; d.items.push(o); return o; };
  const half = sizeM / 2, n = Math.floor(sizeM / step);
  const lines = Array.from({ length: n + 1 }, (_, i) => -half + i * step);
  const hw = (i) => (i % 5 === 0 ? 15.5 : 10.25);
  lines.forEach((y, i) => it('road', [[-half - 40, y], [half + 40, y]], i % 5 === 0 ? { width: 15, sidewalk: 8, name: '' } : { width: 10.5, sidewalk: 5, name: '' }));
  lines.forEach((x, i) => it('road', [[x, -half - 40], [x, half + 40]], i % 5 === 0 ? { width: 15, sidewalk: 8, name: '' } : { width: 10.5, sidewalk: 5, name: '' }));
  const pick = () => { const r = rnd(); return r < 0.45 ? 'ODT' : r < 0.55 ? 'TMD' : r < 0.65 ? 'PNK' : r < 0.75 ? 'CX' : r < 0.82 ? 'DGD' : r < 0.87 ? 'DYT' : r < 0.93 ? 'ONT' : 'SKC'; };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x0 = lines[i] + hw(i), x1 = lines[i + 1] - hw(i + 1), y0 = lines[j] + hw(j), y1 = lines[j + 1] - hw(j + 1);
    const code = pick(), lu = M.LANDUSE[code];
    it('zone', [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], { code, label: '', maxMdxd: lu.mdxd, maxFar: lu.far, maxFloors: lu.floors, setback: code === 'CX' ? 0 : 6 });
    if (code === 'CX') { it('park', [[x0 + 8, y0 + 8], [x1 - 8, y0 + 8], [x1 - 8, y1 - 8], [x0 + 8, y1 - 8]], { name: '' }); continue; }
    const w = x1 - x0 - 12, h = y1 - y0 - 12;
    const rows = 3, cols = 2;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const bx = x0 + 6 + 4 + c * (w / cols), by = y0 + 6 + 4 + r * (h / rows);
      const bw = w / cols - 12, bh = Math.min(16, h / rows - 10);
      const fl = code === 'TMD' || code === 'PNK' ? 9 + Math.floor(rnd() * 15) : 3 + Math.floor(rnd() * 6);
      it('building', [[bx, by], [bx + bw, by], [bx + bw, by + bh], [bx, by + bh]], { floors: fl, floorH: 3.3 });
    }
  }
  it('water', G.catmullRom([[-half - 50, 900], [-1500, 700], [0, 1100], [1500, 800], [half + 50, 1000]], 8, false), { mode: 'river', width: 60, setback: 30, name: 'Sông' });
  d.view = null;
  return d;
}
