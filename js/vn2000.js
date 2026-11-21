// Hệ toạ độ VN-2000 (múi chiếu 3°, k0 = 0.9999) theo kinh tuyến trục từng tỉnh, và danh sách tỉnh thành trước / sau sáp nhập (1/7/2025)
// Tham số chuyển VN-2000 -> WGS-84 (7 tham số, quy ước vector vị trí, như EPSG:3405 towgs84)
const H7 = { dx: -191.90441429, dy: -39.30318279, dz: -111.45032835, rx: -0.00928836, ry: 0.01975479, rz: -0.00427372, s: 0.252906278 };
const A = 6378137, F = 1 / 298.257223563, E2 = F * (2 - F), K0 = 0.9999, FE = 500000;
const D2R = Math.PI / 180, AS = Math.PI / 648000;

function toECEF(lat, lon, h = 0) {
  const p = lat * D2R, l = lon * D2R, N = A / Math.sqrt(1 - E2 * Math.sin(p) ** 2);
  return [(N + h) * Math.cos(p) * Math.cos(l), (N + h) * Math.cos(p) * Math.sin(l), (N * (1 - E2) + h) * Math.sin(p)];
}
function fromECEF([x, y, z]) {
  const lon = Math.atan2(y, x), pr = Math.hypot(x, y);
  let lat = Math.atan2(z, pr * (1 - E2));
  for (let i = 0; i < 6; i++) { const N = A / Math.sqrt(1 - E2 * Math.sin(lat) ** 2); const h = pr / Math.cos(lat) - N; lat = Math.atan2(z, pr * (1 - (E2 * N) / (N + h))); }
  return [lat / D2R, lon / D2R];
}
function helmert(P, sign) {
  const rx = sign * H7.rx * AS, ry = sign * H7.ry * AS, rz = sign * H7.rz * AS, k = 1 + sign * H7.s * 1e-6;
  const [x, y, z] = P;
  return [k * (x - rz * y + ry * z) + sign * H7.dx, k * (rz * x + y - rx * z) + sign * H7.dy, k * (-ry * x + rx * y + z) + sign * H7.dz];
}
// Chiếu ngang Mercator (TM) trên elipxoit WGS-84 (VN-2000 dùng elipxoit này)
const ep2 = E2 / (1 - E2);
const M = (p) => A * ((1 - E2 / 4 - (3 * E2 ** 2) / 64 - (5 * E2 ** 3) / 256) * p - ((3 * E2) / 8 + (3 * E2 ** 2) / 32 + (45 * E2 ** 3) / 1024) * Math.sin(2 * p) + ((15 * E2 ** 2) / 256 + (45 * E2 ** 3) / 1024) * Math.sin(4 * p) - ((35 * E2 ** 3) / 3072) * Math.sin(6 * p));
function tmForward(lat, lon, lon0) {
  const p = lat * D2R, N = A / Math.sqrt(1 - E2 * Math.sin(p) ** 2), T = Math.tan(p) ** 2, C = ep2 * Math.cos(p) ** 2, Aa = (lon - lon0) * D2R * Math.cos(p);
  const x = K0 * N * (Aa + ((1 - T + C) * Aa ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * Aa ** 5) / 120);
  const y = K0 * (M(p) + N * Math.tan(p) * (Aa ** 2 / 2 + ((5 - T + 9 * C + 4 * C * C) * Aa ** 4) / 24 + ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * Aa ** 6) / 720));
  return [y, x + FE]; // [Bắc (X), Đông (Y)]
}
function tmInverse(n, e, lon0) {
  const x = e - FE, m = n / K0, mu = m / (A * (1 - E2 / 4 - (3 * E2 ** 2) / 64 - (5 * E2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const p1 = mu + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) + ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const N1 = A / Math.sqrt(1 - E2 * Math.sin(p1) ** 2), T1 = Math.tan(p1) ** 2, C1 = ep2 * Math.cos(p1) ** 2, R1 = (A * (1 - E2)) / (1 - E2 * Math.sin(p1) ** 2) ** 1.5, D = x / (N1 * K0);
  const lat = p1 - ((N1 * Math.tan(p1)) / R1) * (D ** 2 / 2 - ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4) / 24 + ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6) / 720);
  const lon = (D - ((1 + 2 * T1 + C1) * D ** 3) / 6 + ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5) / 120) / Math.cos(p1);
  return [lat / D2R, lon0 + lon / D2R];
}
// WGS-84 (kinh/vĩ độ GPS, ảnh vệ tinh) -> VN-2000 [X Bắc, Y Đông] theo kinh tuyến trục lon0
export function llToVN(lat, lon, lon0) { const [la, lo] = fromECEF(helmert(toECEF(lat, lon), -1)); return tmForward(la, lo, lon0); }
export function vnToLL(n, e, lon0) { const [la, lo] = tmInverse(n, e, lon0); return fromECEF(helmert(toECEF(la, lo), 1)); }
export const fmtKTT = (d) => { const g = Math.floor(d + 1e-9), m = Math.round((d - g) * 60); return `${g}°${String(m).padStart(2, '0')}'`; };
export function parseKTT(s) {
  const t = String(s).trim().replace(',', '.');
  const m = t.match(/^(\d{2,3})\s*[°ºo\s]\s*(\d{1,2}(?:\.\d+)?)?/);
  if (m && /[°ºo\s]/.test(t)) return +m[1] + (m[2] ? +m[2] / 60 : 0);
  const v = parseFloat(t); return isFinite(v) ? v : NaN;
}

// [tên, kinh tuyến trục (độ), vĩ độ, kinh độ trung tâm hành chính, gồm các tỉnh cũ]
export const PROV_NEW = [
  ['TP. Hà Nội', 105, 21.0285, 105.8542],
  ['TP. Hồ Chí Minh', 105.75, 10.7769, 106.7009, 'TP.HCM, Bình Dương, Bà Rịa – Vũng Tàu'],
  ['TP. Hải Phòng', 105.75, 20.8449, 106.6881, 'Hải Phòng, Hải Dương'],
  ['TP. Đà Nẵng', 107.75, 16.0544, 108.2022, 'Đà Nẵng, Quảng Nam'],
  ['TP. Cần Thơ', 105, 10.0341, 105.7880, 'Cần Thơ, Sóc Trăng, Hậu Giang'],
  ['TP. Huế', 107, 16.4637, 107.5909],
  ['An Giang', 104.75, 10.0125, 105.0809, 'An Giang, Kiên Giang'],
  ['Bắc Ninh', 107, 21.2731, 106.1946, 'Bắc Ninh, Bắc Giang'],
  ['Cà Mau', 104.5, 9.1769, 105.1524, 'Cà Mau, Bạc Liêu'],
  ['Cao Bằng', 105.75, 22.6657, 106.2577],
  ['Đắk Lắk', 108.5, 12.6667, 108.0378, 'Đắk Lắk, Phú Yên'],
  ['Điện Biên', 103, 21.3860, 103.0230],
  ['Đồng Nai', 107.75, 10.9574, 106.8427, 'Đồng Nai, Bình Phước'],
  ['Đồng Tháp', 105, 10.3600, 106.3600, 'Đồng Tháp, Tiền Giang'],
  ['Gia Lai', 108.25, 13.7765, 109.2237, 'Gia Lai, Bình Định'],
  ['Hà Tĩnh', 105.5, 18.3428, 105.9057],
  ['Hưng Yên', 105.5, 20.6464, 106.0511, 'Hưng Yên, Thái Bình'],
  ['Khánh Hòa', 108.25, 12.2388, 109.1967, 'Khánh Hòa, Ninh Thuận'],
  ['Lai Châu', 103, 22.3964, 103.4582],
  ['Lạng Sơn', 107.25, 21.8537, 106.7613],
  ['Lào Cai', 104.75, 21.7050, 104.8750, 'Lào Cai, Yên Bái'],
  ['Lâm Đồng', 107.75, 11.9404, 108.4583, 'Lâm Đồng, Đắk Nông, Bình Thuận'],
  ['Nghệ An', 104.75, 18.6796, 105.6813],
  ['Ninh Bình', 105, 20.2506, 105.9745, 'Ninh Bình, Hà Nam, Nam Định'],
  ['Phú Thọ', 104.75, 21.3227, 105.4019, 'Phú Thọ, Vĩnh Phúc, Hòa Bình'],
  ['Quảng Ngãi', 108, 15.1205, 108.7923, 'Quảng Ngãi, Kon Tum'],
  ['Quảng Ninh', 107.75, 20.9517, 107.0800],
  ['Quảng Trị', 106, 17.4689, 106.6223, 'Quảng Trị, Quảng Bình'],
  ['Sơn La', 104, 21.3270, 103.9141],
  ['Tây Ninh', 105.75, 10.5359, 106.4137, 'Tây Ninh, Long An'],
  ['Thái Nguyên', 106.5, 21.5942, 105.8482, 'Thái Nguyên, Bắc Kạn'],
  ['Thanh Hóa', 105, 19.8067, 105.7852],
  ['Tuyên Quang', 106, 21.8233, 105.2141, 'Tuyên Quang, Hà Giang'],
  ['Vĩnh Long', 105.5, 10.2537, 105.9722, 'Vĩnh Long, Bến Tre, Trà Vinh'],
];
export const PROV_OLD = [
  ['An Giang', 104.75, 10.3864, 105.4352], ['Bà Rịa – Vũng Tàu', 107.75, 10.4963, 107.1684], ['Bạc Liêu', 105, 9.2940, 105.7278], ['Bắc Giang', 107, 21.2731, 106.1946],
  ['Bắc Kạn', 106.5, 22.1470, 105.8348], ['Bắc Ninh', 105.5, 21.1861, 106.0763], ['Bến Tre', 105.75, 10.2415, 106.3759], ['Bình Định', 108.25, 13.7765, 109.2237],
  ['Bình Dương', 105.75, 10.9804, 106.6519], ['Bình Phước', 106.25, 11.5349, 106.8832], ['Bình Thuận', 108.5, 10.9289, 108.1021], ['Cà Mau', 104.5, 9.1769, 105.1524],
  ['Cao Bằng', 105.75, 22.6657, 106.2577], ['Cần Thơ', 105, 10.0341, 105.7880], ['Đà Nẵng', 107.75, 16.0544, 108.2022], ['Đắk Lắk', 108.5, 12.6667, 108.0378],
  ['Đắk Nông', 108.5, 11.9980, 107.6900], ['Điện Biên', 103, 21.3860, 103.0230], ['Đồng Nai', 107.75, 10.9574, 106.8427], ['Đồng Tháp', 105, 10.4600, 105.6330],
  ['Gia Lai', 108.5, 13.9833, 108.0000], ['Hà Giang', 105.5, 22.8233, 104.9836], ['Hà Nam', 105, 20.5411, 105.9140], ['Hà Nội', 105, 21.0285, 105.8542],
  ['Hà Tĩnh', 105.5, 18.3428, 105.9057], ['Hải Dương', 105.5, 20.9400, 106.3330], ['Hải Phòng', 105.75, 20.8449, 106.6881], ['Hậu Giang', 105, 9.7840, 105.4700],
  ['Hòa Bình', 106, 20.8170, 105.3380], ['Hưng Yên', 105.5, 20.6464, 106.0511], ['Khánh Hòa', 108.25, 12.2388, 109.1967], ['Kiên Giang', 104.5, 10.0125, 105.0809],
  ['Kon Tum', 107.5, 14.3500, 108.0000], ['Lai Châu', 103, 22.3964, 103.4582], ['Lạng Sơn', 107.25, 21.8537, 106.7613], ['Lào Cai', 104.75, 22.4856, 103.9707],
  ['Lâm Đồng', 107.75, 11.9404, 108.4583], ['Long An', 105.75, 10.5359, 106.4137], ['Nam Định', 105.5, 20.4340, 106.1770], ['Nghệ An', 104.75, 18.6796, 105.6813],
  ['Ninh Bình', 105, 20.2506, 105.9745], ['Ninh Thuận', 108.25, 11.5650, 108.9880], ['Phú Thọ', 104.75, 21.3227, 105.4019], ['Phú Yên', 108.5, 13.0955, 109.3209],
  ['Quảng Bình', 106, 17.4689, 106.6223], ['Quảng Nam', 107.75, 15.5736, 108.4740], ['Quảng Ngãi', 108, 15.1205, 108.7923], ['Quảng Ninh', 107.75, 20.9517, 107.0800],
  ['Quảng Trị', 106.25, 16.8163, 107.1003], ['Sóc Trăng', 105.5, 9.6030, 105.9800], ['Sơn La', 104, 21.3270, 103.9141], ['Tây Ninh', 105.5, 11.3100, 106.0980],
  ['Thái Bình', 105.5, 20.4470, 106.3360], ['Thái Nguyên', 106.5, 21.5942, 105.8482], ['Thanh Hóa', 105, 19.8067, 105.7852], ['Thừa Thiên Huế', 107, 16.4637, 107.5909],
  ['Tiền Giang', 105.75, 10.3600, 106.3600], ['TP. Hồ Chí Minh', 105.75, 10.7769, 106.7009], ['Trà Vinh', 105.5, 9.9350, 106.3450], ['Tuyên Quang', 106, 21.8233, 105.2141],
  ['Vĩnh Long', 105.5, 10.2537, 105.9722], ['Vĩnh Phúc', 105, 21.3100, 105.5970], ['Yên Bái', 104.75, 21.7050, 104.8750],
];
