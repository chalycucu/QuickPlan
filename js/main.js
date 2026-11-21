// QuickPlan – giao diện và tương tác chính.
import * as G from './geom.js';
import { ICONS as IC, ICON_KEYS, drawIconAt } from './icons.js';
import * as M from './model.js';
import { View, renderScene, drawGrid, drawScaleBar, drawLiveStroke, hitTest, hitAll, handlePoints, onMatReady } from './render2d.js';
import * as AX from './axis.js';
import * as MT from './materials.js';
import { drawInk } from './icons.js';
import * as Store from './store.js';
import * as PC from './pc.js';
import * as OD from './onedrive.js';
import * as X from './exporters.js';
import { fillRegionAt, edgeSources } from './fill.js';
import * as RO from './roadops.js';
import * as ZO from './zoneops.js';
import * as SH from './shapes.js';
import * as PEN from './pen.js';
import * as C from './constrain.js';
import * as BM from './basemap.js';
import * as VN from './vn2000.js';
import * as FA from './faces.js';
import * as TR from './terrain.js';
import * as AL from './autolayout.js';
import { demoDrawing, bigDemoDrawing } from './demo.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);

$$('[data-version]').forEach((e) => (e.textContent = M.APP_VERSION));
$$('[data-designer]').forEach((e) => (e.textContent = M.DESIGNER));

// ---------------- Trạng thái ----------------
const S = {
  doc: null, view: new View(), tool: 'road', selectedId: null, multi: [], metrics: null,
  undo: [], redo: [], mode: '2d', images: {}, stroke: null, prevAlerts: {},
  opts: {
    road: { width: 10.5, sidewalk: 5, minR: 15 },
    footpath: { width: 3, minR: 3 },
    building: { floors: 5, ortho: true, osnap: true },
    cover: { mat: 'p:gach', color: '#d9cdb4', scale: 0, ang: 0, by: 'mat' },
    axis: { on: { facet: true }, step: 90, ang: 0 },
    water: { setback: 20, width: 30 },
    zone: { code: 'ODT', setback: 6, brush: 'basic', form: 'free' },
    facet: { form: 'axis', offset: 1, guides: true, mode: 'stroke', ortho: true, ext: true, rw: 0, rh: 0, cr: 0 },
    push: { mode: 'pos' },
    land: { style: 'row', spacing: 8, size: 6 },
    sketch: { color: '#111827', width: 3 },
    pen: { on: false, shape: null, op: null, R: 5, V: 3, osnap: true, axis: false },
    measure: { unit: 'm', mode: 'line' },
    selMode: 'move', snapMove: true, snapParallel: true,
    preset: { type: 'U', setback: 6 },
    autolay: { type: 'auto', replace: true, p: {} },
    circle: { radius: 500, color: '#7b3fe4', width: 2 },
    arrow: { color: '#d9381e', width: 8 },
    flow: { color: '#1f7a3a', width: 3 },
    icon: { sym: 'pin', size: 20, color: '', elev: 4, showLabel: true, askInk: false },
    tour: { speed: 5, eye: 1.6, color: '#7c3aed' },
    fingerDraw: false,
    handNum: true,
  },
};
try { const sv = JSON.parse(localStorage.getItem('qp.opts') || '{}'); for (const [k, v] of Object.entries(sv)) S.opts[k] = v && typeof v === 'object' && S.opts[k] && typeof S.opts[k] === 'object' ? { ...S.opts[k], ...v } : v; } catch {}
// bản 0.4.1: bỏ trạng thái thu gọn cũ (bản 0.4.0 có thể làm hộp thoại biến mất)
const PANEL = (() => { try { if (localStorage.getItem('qp.panels.v') !== '2') { localStorage.removeItem('qp.panels'); localStorage.setItem('qp.panels.v', '2'); } return JSON.parse(localStorage.getItem('qp.panels') || '{}'); } catch { return {}; } })();
const savePanels = () => { try { localStorage.setItem('qp.panels', JSON.stringify(PANEL)); } catch {} };
const saveOpts = () => { try { localStorage.setItem('qp.opts', JSON.stringify(S.opts)); } catch {} };

// ---------------- Khởi động ----------------
const splash = $('#splash');
setTimeout(() => { splash.classList.add('fade'); setTimeout(() => splash.remove(), 600); }, 1800);

let needReload = false;
if ('serviceWorker' in navigator && window.isSecureContext) {
  // Có bản mới: tải lại trang ngay (nếu đang ở danh sách) hoặc khi quay về danh sách
  const hadCtrl = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadCtrl || needReload) return;
    needReload = true;
    if ($('#editor').hidden) location.reload();
    else toast('Đã có bản QuickPlan mới · sẽ cập nhật khi quay về danh sách bản vẽ');
  });
  navigator.serviceWorker.register('sw.js').then((reg) => {
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch((e) => console.warn('SW', e));
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

// ---------------- Màn hình danh sách ----------------
async function showHome() {
  if (needReload) { location.reload(); return; }
  S.mode = '2d'; v3 && v3.stop();
  $('#editor').hidden = true; $('#home').hidden = false;
  await renderList();
  Store.syncNow(onRemote).then(renderList);
}
async function renderList() {
  const list = (await Store.listLocal()).sort((a, b) => b.updatedAt - a.updatedAt);
  const box = $('#drawingList'); box.innerHTML = '';
  if (!list.length) box.append(h(`<div class="empty">Chưa có bản vẽ nào. Bấm “Bản vẽ mới” để bắt đầu, hoặc mở bản vẽ mẫu để xem thử.</div>`));
  for (const d of list) {
    const c = h(`<div class="card">
      <button class="thumb" aria-label="Mở ${esc(d.name)}"></button>
      <div class="meta"><div><b>${esc(d.name)}</b><small>${new Date(d.updatedAt).toLocaleString('vi-VN')}</small></div>
      <button class="ibtn" aria-label="Xoá"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg></button></div></div>`);
    if (d.thumb) c.querySelector('.thumb').style.backgroundImage = `url(${d.thumb})`;
    c.querySelector('.thumb').onclick = () => openDrawing(d.id);
    c.querySelector('.meta .ibtn').onclick = async () => {
      if (!confirm(`Xoá bản vẽ “${d.name}”? (Bản sao lưu vẫn còn trên PC trong thư mục LichSu)`)) return;
      await Store.deleteDrawing(d.id); renderList(); Store.syncNow();
    };
    box.append(c);
  }
  // Gợi ý cài đặt
  const hint = $('#installHint');
  const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  if (!window.isSecureContext) {
    hint.hidden = false;
    hint.innerHTML = 'Đang mở qua địa chỉ <b>http</b> nên chưa dùng được khi mất mạng. Mở trang <a href="/setup">Cài đặt cho iPad</a> để cài chứng chỉ một lần rồi dùng địa chỉ https.';
  } else if (!standalone && /iPad|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document) {
    hint.hidden = false;
    hint.innerHTML = 'Để dùng như ứng dụng: bấm nút <b>Chia sẻ</b> trên Safari → <b>Thêm vào MH chính</b>.';
  } else hint.hidden = true;
}
$('#btnNew').onclick = async () => {
  const d = M.newDrawing('Bản vẽ ' + new Date().toLocaleDateString('vi-VN'));
  const lu = savedLanduse(); if (lu) d.settings.landuse = cleanLanduse(lu);
  await Store.putDrawing(d); openDrawing(d.id);
};
$('#btnDemo').onclick = async () => { const d = demoDrawing(); await Store.putDrawing(d); openDrawing(d.id); };

function onRemote(remote) {
  if (S.doc && remote.id === S.doc.id && remote.updatedAt > S.doc.updatedAt) {
    M.upgradeDoc(remote); S.doc = remote; S.undo = []; S.redo = []; loadBaseImage(); changed({ save: false }); toast('Đã cập nhật bản vẽ mới hơn từ PC');
  }
}

// Trạng thái đồng bộ
function renderSync() {
  const st = Store.sync.state;
  const txt = { idle: 'Đã lưu trên máy', syncing: 'Đang đồng bộ…', ok: 'Đã lưu về PC', offline: PC.HOSTED ? 'Chưa thấy PC · lưu trên iPad' : 'Ngoại tuyến · lưu trên máy', error: 'Lỗi đồng bộ', nopc: 'Lưu trên iPad · Kết nối PC' }[st];
  $$('[data-sync]').forEach((e) => { e.textContent = txt; e.className = 'sync-pill ' + st + (PC.HOSTED ? ' click' : ''); });
}
// Bản web: chạm vào trạng thái đồng bộ để nhập địa chỉ máy tính
if (PC.HOSTED) {
  const dlg = $('#pcDlg'), inp = $('#pcAddr'), msg = $('#pcMsg');
  const say = (t, cls = '') => { msg.textContent = t; msg.className = 'pc-msg ' + cls; };
  const short = (a) => a.replace('https://', '').replace(/:8080$/, '');
  $$('[data-sync]').forEach((e) => {
    e.setAttribute('role', 'button'); e.tabIndex = 0; e.title = 'Kết nối máy tính để lưu song song bản vẽ về PC';
    e.onclick = () => {
      const a = PC.pc.addr, on = Store.sync.state === 'ok';
      inp.value = a ? short(a) : '';
      say(a ? (on ? 'Đang kết nối máy tính ' + short(a) : 'Đã lưu địa chỉ ' + short(a) + ' nhưng hiện chưa thấy máy tính.') : '', on ? 'ok' : '');
      $('#pcOff').hidden = !a; dlg.showModal();
    };
  });
  $('#pcTry').onclick = async () => {
    if (!inp.value.trim()) { say('Nhập địa chỉ máy tính trước', 'err'); return; }
    let base; try { base = PC.normAddr(inp.value); } catch { say('Địa chỉ không hợp lệ', 'err'); return; }
    say('Đang thử kết nối ' + short(base) + '…');
    try {
      const info = await PC.connect(inp.value);
      say(`Đã kết nối máy tính (QuickPlan ${info.version}). Bản vẽ lưu tại: ${info.dataDir}`, 'ok');
      $('#pcOff').hidden = false;
      Store.syncNow(onRemote).then(renderList);
    } catch (err) {
      say(err.message + ' Nếu iPad chưa cài chứng chỉ: mở http://' + new URL(base).hostname + ':8080/setup trong Safari và làm theo bước 1, 2.', 'err');
    }
  };
  $('#pcOff').onclick = () => { PC.pc.addr = ''; PC.pc.ok = false; Store.sync.set('nopc'); dlg.close(); };
}
Store.sync.listeners.add(renderSync); renderSync();
window.addEventListener('online', () => { Store.syncNow(onRemote); odSync(); });
setInterval(() => Store.syncNow(onRemote), 20000);
// ---------------- OneDrive: lưu song song (ngoài iPad và PC) ----------------
let odTimer = 0;
function odSync(delay = 0) { clearTimeout(odTimer); odTimer = setTimeout(() => OD.syncNow(Store.odIO), delay); }
function odQueueExport(name, blob) { if (!OD.od.enabled) return; Store.odIO.queueExport(name, blob).then(() => odSync(300)).catch((e) => console.warn('OneDrive hàng đợi', e)); }
function renderOD() {
  const st = OD.od.state;
  const txt = { off: '☁ OneDrive', 'need-login': 'OneDrive: cần đăng nhập', syncing: 'OneDrive: đang lưu…', ok: 'Đã lưu OneDrive', offline: 'OneDrive: chờ có mạng', error: 'OneDrive: lỗi' }[st] || '';
  $$('[data-od]').forEach((e) => { e.textContent = txt; e.hidden = !txt || !(PC.HOSTED || location.hostname === 'localhost'); e.className = 'sync-pill od ' + st + ' click'; e.title = OD.od.msg || 'Lưu song song lên OneDrive'; });
}
OD.od.listeners.add(renderOD);
$$('[data-od]').forEach((e) => (e.onclick = () => openODDialog()));
function openODDialog() {
  const dlg = h(`<dialog class="pc-dlg od-dlg"><form method="dialog">
    <h3>Lưu song song lên OneDrive</h3>
    <p id="odPc" class="pc-msg">Đang hỏi máy tính…</p>
    <details id="odDirect" ${OD.od.clientId ? 'open' : ''}><summary>iPad lưu thẳng lên OneDrive (cần mã ứng dụng Microsoft)</summary>
    <p class="muted">Bản vẽ và file xuất được lưu thêm vào một thư mục OneDrive mỗi khi có mạng (gửi bù khi mất mạng). Lưu trên iPad và lưu về PC vẫn chạy như cũ.</p>
    <label>Thư mục trên OneDrive <input id="odFolder" class="txt" value="${esc(OD.od.folder)}"></label>
    <details ${OD.od.clientId ? '' : 'open'}><summary>Mã ứng dụng Microsoft (Client ID)</summary><input id="odCid" class="txt" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" value="${esc(OD.od.clientId)}"><small class="muted">Tạo một lần ở entra.microsoft.com (App registrations, loại Single-page application, địa chỉ chuyển về ${esc(OD.redirectUri())}). Tài khoản Microsoft cá nhân (live.com, outlook.com) không tạo được mã, cần tài khoản Azure hoặc tài khoản công ty.</small></details>
    <p id="odMsg" class="pc-msg"></p></details>
    <div class="row"><button type="button" class="btn primary" id="odLogin"></button><button type="button" class="btn" id="odNow">Lưu ngay</button><button type="button" class="btn" id="odOff">Tắt / đăng xuất</button><button class="btn" value="close">Đóng</button></div>
  </form></dialog>`);
  document.body.append(dlg);
  const msg = dlg.querySelector('#odMsg'), say = (t, c = '') => { msg.textContent = t; msg.className = 'pc-msg ' + c; };
  const sync = () => {
    const signed = OD.od.signedIn;
    dlg.querySelector('#odLogin').textContent = signed ? 'Đăng nhập tài khoản khác' : 'Đăng nhập Microsoft';
    dlg.querySelector('#odLogin').hidden = !signed && !OD.od.clientId && !dlg.querySelector('#odDirect').open;
    dlg.querySelector('#odNow').hidden = !signed; dlg.querySelector('#odOff').hidden = !OD.od.enabled && !signed;
    if (signed) say(`Đang lưu vào OneDrive${OD.od.account ? ' của ' + OD.od.account : ''}, thư mục «${OD.od.folder}» (BanVe, XuatFile).${OD.od.msg ? ' ' + OD.od.msg : ''}`, OD.od.state === 'error' ? 'err' : 'ok');
    else if (OD.od.state === 'need-login' && OD.od.account) say('Phiên đăng nhập đã hết hạn. Bấm Đăng nhập Microsoft để tiếp tục lưu (các bản vẽ đã sửa sẽ được gửi bù).', 'err');
    else say(OD.od.msg || '');
  };
  const keep = () => { OD.od.folder = dlg.querySelector('#odFolder').value; OD.od.clientId = dlg.querySelector('#odCid').value; };
  dlg.querySelector('#odLogin').onclick = async () => {
    keep();
    if (!OD.od.clientId) { say('Dán mã ứng dụng (Client ID) trước', 'err'); dlg.querySelectorAll('details').forEach((d) => (d.open = true)); return; }
    if (!OD.supported()) { say('Cần mở QuickPlan bằng địa chỉ https (bản web) để đăng nhập OneDrive', 'err'); return; }
    if (S.doc) await saveNow();
    say('Đang chuyển sang trang đăng nhập Microsoft…');
    try { await OD.login(); } catch (e) { say(e.message, 'err'); }
  };
  dlg.querySelector('#odNow').onclick = async () => { keep(); say('Đang lưu…'); await OD.syncNow(Store.odIO); sync(); };
  dlg.querySelector('#odOff').onclick = () => { OD.od.enabled = false; OD.logout(); sync(); renderOD(); toast('Đã tắt lưu OneDrive'); };
  dlg.addEventListener('close', () => { keep(); dlg.remove(); });
  dlg.querySelector('#odDirect').addEventListener('toggle', sync);
  sync(); dlg.showModal();
  const pcMsg = dlg.querySelector('#odPc');
  (PC.apiBase() === null ? Promise.reject(new Error('nopc')) : PC.api('/api/info', { cache: 'no-store' }).then((r) => r.json())).then((i) => {
    if (i.onedriveDir) { pcMsg.textContent = `✓ Không cần cài gì thêm: QuickPlan.exe trên máy tính tự chép mọi bản vẽ và file xuất vào thư mục OneDrive ${i.onedriveDir} (BanVe, XuatFile). iPad gửi bù mỗi khi thấy máy tính.`; pcMsg.className = 'pc-msg ok'; }
    else { pcMsg.textContent = i.version && i.version < '0.25' ? `QuickPlan.exe trên máy tính là bản ${i.version}. Cài bản 0.25.0 trở lên để máy tính tự chép bản vẽ vào OneDrive.` : 'Máy tính chưa có ứng dụng OneDrive (hoặc đã tắt chép sang OneDrive).'; pcMsg.className = 'pc-msg'; }
  }).catch(() => { pcMsg.textContent = 'Cách dễ nhất: kết nối máy tính có QuickPlan.exe 0.25.0 và OneDrive. Máy tính sẽ tự chép mọi bản vẽ vào thư mục OneDrive\\QuickPlan.'; pcMsg.className = 'pc-msg'; });
}
// quay về từ trang đăng nhập Microsoft
OD.handleRedirect().then((ok) => { if (ok) { toast('Đã kết nối OneDrive · bản vẽ sẽ được lưu song song vào thư mục «' + OD.od.folder + '»'); Store.listLocal().then(async (l) => { for (const d of l) { const full = await Store.getDrawing(d.id); if (full) await Store.putDrawing(full, { markDirty: false }); } odSync(500); }); } else odSync(1500); renderOD(); }).catch((e) => { console.warn(e); renderOD(); });
setInterval(() => { if (OD.od.enabled) odSync(); }, 30000);

// ---------------- Mở / lưu bản vẽ ----------------
async function openDrawing(id) {
  const d = await Store.getDrawing(id);
  if (!d) return;
  M.upgradeDoc(d);
  S.doc = d; S.undo = []; S.redo = []; S.selectedId = null; S.multi = []; S.prevAlerts = {}; M.setGroundFn(TR.groundSampler(d));
  S.iso = null; S.isoFace = false; S.facetSel = null; S.skSel = null; S.faceDraft = null; S.isoPrev = null; ISO_C = null; if (S.lookLock) setLookLock(false); syncIsoBar();
  S.view.rot = 0; Object.assign(S.view, d.view || {}); syncNorthBtn();
  if (d.items.length > 3000) setTimeout(() => { if (S.doc === d) snapItems(); }, 2500); // chuẩn bị sẵn ảnh hoàn tác cho bản vẽ nặng
  $('#home').hidden = true; $('#editor').hidden = false; setTimeout(syncPenBar, 0);
  $('#docName').value = d.name;
  setMode('2d');
  loadBaseImage();
  resize();
  if (!d.view) fitView();
  buildToolbar(); renderToolOpts();
  changed({ save: false });
}

let saveTimer, syncTimer;
const heavyDelay = (ms) => ms + Math.min(4000, ((S.doc && S.doc.items.length) || 0) / 10);
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, heavyDelay(600)); // bản vẽ nặng: gom nhiều thao tác rồi mới lưu
}
async function saveNow() {
  if (!S.doc) return;
  S.doc.view = { cx: S.view.cx, cy: S.view.cy, scale: S.view.scale, rot: S.view.rot || 0 };
  S.doc.thumb = makeThumb();
  await Store.putDrawing(S.doc);
  Store.sync.set(Store.sync.state === 'ok' ? 'ok' : 'idle');
  clearTimeout(syncTimer); syncTimer = setTimeout(() => Store.syncNow(onRemote), heavyDelay(1500));
  if (OD.od.enabled) odSync(heavyDelay(4000));
}
document.addEventListener('visibilitychange', () => { if (document.hidden && S.doc) saveNow(); });

$('#btnHome').onclick = async () => { S.baseEdit = null; $('#hud').style.display = ''; await saveNow(); S.doc = null; showHome(); };
$('#docName').onchange = (e) => { S.doc.name = e.target.value.trim() || 'Bản vẽ'; touch(); };

function touch() { S.doc.updatedAt = Date.now(); scheduleSave(); }

// ---------------- Hoàn tác ----------------
// Ảnh chụp để hoàn tác: mảng chuỗi JSON từng đối tượng; đối tượng không đổi dùng lại đúng chuỗi cũ
// (bản vẽ nặng: không phải chuỗi hoá lại cả bản vẽ mỗi lần chạm, 100 bước hoàn tác không tốn bộ nhớ gấp 100 lần)
const _itemJS = new WeakMap();
function itemJSON(it) {
  const P = it.pts || []; let cs = P.length;
  for (let i = 0; i < P.length; i++) { const q = P[i]; if (q) cs += q[0] * (i + 1.618) + q[1] * (i + 2.414) + (q[2] || 0) * 0.577; }
  const rest = JSON.stringify(it.kind === 'cad' ? [it.id, it.closed, it.layer, it.props] : { ...it, pts: 0 });
  const c = _itemJS.get(it);
  if (c && c.cs === cs && c.rest === rest) return c.s;
  const s = JSON.stringify(it); _itemJS.set(it, { cs, rest, s }); return s;
}
function snapItems() { return S.doc.items.map(itemJSON); }
const parseSnap = (sn) => (typeof sn === 'string' ? JSON.parse(sn) : sn.map((x) => JSON.parse(x)));
function checkpoint() {
  S.undo.push(snapItems());
  if (S.undo.length > 100) S.undo.shift();
  S.redo = [];
}
function undo() {
  if (!S.undo.length) return toast('Không còn gì để hoàn tác');
  S.redo.push(snapItems());
  S.doc.items = parseSnap(S.undo.pop());
  if (!S.doc.items.find((i) => i.id === S.selectedId)) S.selectedId = null;
  changed(); toast('Hoàn tác');
}
function redo() {
  if (!S.redo.length) return toast('Không còn gì để làm lại');
  S.undo.push(snapItems());
  S.doc.items = parseSnap(S.redo.pop());
  changed(); toast('Làm lại');
}
$('#btnUndo').onclick = undo; $('#btnRedo').onclick = redo;

// Gọi sau mọi thay đổi
function changed({ save = true, light = false } = {}) {
  ISO_C = null;
  FA.syncFaces(S.doc, (props) => newItem('facet', [], props));
  S.metrics = M.computeMetrics(S.doc);
  const newOver = Object.entries(S.metrics.alerts).filter(([id, lv]) => lv === 'over' && S.prevAlerts[id] !== 'over');
  if (newOver.length) {
    navigator.vibrate && navigator.vibrate([30, 40, 30]);
    const hud = $('#hud'); hud.classList.remove('flash'); void hud.offsetWidth; hud.classList.add('flash');
  }
  S.prevAlerts = S.metrics.alerts;
  if (save) touch();
  requestRender();
  renderHUD();
  if (!light) renderProps();
  $('#btnUndo').disabled = !S.undo.length; $('#btnRedo').disabled = !S.redo.length;
  if (S.mode === '3d') schedule3D();
}

// ---------------- Canvas 2D ----------------
const canvas = $('#c2d');
const ctx = canvas.getContext('2d');
let dpr = 1, raf = 0;
function resize() {
  const r = $('#stage').getBoundingClientRect();
  dpr = Math.min(3, window.devicePixelRatio || 1);
  canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
  S.view.w = r.width; S.view.h = r.height;
  requestRender();
}
window.addEventListener('resize', resize);
new ResizeObserver(resize).observe($('#stage'));

// kind: bỏ trống = nội dung bản vẽ có thể đã đổi; 'view' = chỉ dời / thu phóng khung nhìn; 'ov' = chỉ lớp vẽ tạm (nét đang vẽ…)
function requestRender(kind) { if (!kind) sceneVer++; if (!raf) raf = requestAnimationFrame(render); }
// ---- Bộ đệm hình cho bản vẽ nặng (QP 16) ----
// snap: ảnh mặt bằng đúng khung hiện tại (vẽ nét đang vẽ chỉ cần dán lại ảnh, không vẽ lại cả bản vẽ)
// wide: ảnh rộng gấp đôi khung nhìn, dùng tạm khi kéo / thu phóng / xoay rồi vẽ lại đầy đủ khi dừng tay
let sceneVer = 0, snap = null, wide = null, heavyMs = 0, lastVs = '', settleT = 0, wideT = 0;
const viewSig = () => { const v = S.view; return [v.cx, v.cy, v.scale, v.rot || 0, v.w, v.h, dpr].join(','); };
function drawBase(c, v) {
  c.fillStyle = '#fbfcfd'; c.fillRect(0, 0, v.w, v.h);
  drawGrid(c, v);
  if (axisOn(S.tool) && S.tool !== 'facet') AX.drawAxisGrid(c, v, axisRad(), S.opts.axis.step);
}
const sceneOpts = () => ({ isoFn: S.iso ? inIso : null, check: S.tool === 'check', selectedId: S.selectedId, multiIds: S.hoverId && !$('#pop').hidden ? S.multi.concat([S.hoverId]) : S.multi, metrics: S.metrics, images: S.images });
function buildWide() {
  wideT = 0; if (!S.doc || S.mode !== '2d' || !snap || snap.ver !== sceneVer) return;
  const v = new View(); Object.assign(v, { cx: S.view.cx, cy: S.view.cy, scale: S.view.scale, rot: S.view.rot || 0, w: S.view.w * 2, h: S.view.h * 2 });
  const c = (wide && wide.c) || document.createElement('canvas'); c.width = Math.round(v.w); c.height = Math.round(v.h);
  const x = c.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); drawBase(x, v); renderScene(x, S.doc, v, sceneOpts());
  wide = { c, v, ver: sceneVer, doc: S.doc };
}
onMatReady(() => { requestRender(); if (S.mode === '3d') schedule3D(); });
function render(ts) {
  raf = 0;
  if (!S.doc) return;
  if (typeof ts !== 'number') sceneVer++; // gọi trực tiếp: luôn vẽ lại đầy đủ
  const vs = viewSig(), moving = vs !== lastVs; lastVs = vs;
  if (snap && snap.ver === sceneVer && snap.vs === vs && snap.doc === S.doc) { // nội dung và khung nhìn không đổi: dán lại ảnh
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(snap.c, 0, 0); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  } else if (moving && heavyMs > 28 && wide && wide.ver === sceneVer && wide.doc === S.doc && snap) { // đang kéo / thu phóng bản vẽ nặng: dùng ảnh rộng
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); drawBase(ctx, S.view);
    const wv = wide.v, o = S.view.toScreen(wv.toWorld(0, 0)), ax = S.view.toScreen(wv.toWorld(1, 0)), ay = S.view.toScreen(wv.toWorld(0, 1));
    ctx.setTransform(dpr * (ax[0] - o[0]), dpr * (ax[1] - o[1]), dpr * (ay[0] - o[0]), dpr * (ay[1] - o[1]), dpr * o[0], dpr * o[1]);
    ctx.drawImage(wide.c, 0, 0); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    clearTimeout(settleT); settleT = setTimeout(() => requestRender('view'), 160);
  } else {
    const t0 = performance.now();
    if (!snap) snap = { c: document.createElement('canvas') };
    if (snap.c.width !== canvas.width || snap.c.height !== canvas.height) { snap.c.width = canvas.width; snap.c.height = canvas.height; }
    const sx = snap.c.getContext('2d'); sx.setTransform(dpr, 0, 0, dpr, 0, 0); sx.clearRect(0, 0, S.view.w, S.view.h);
    drawBase(sx, S.view);
    renderScene(sx, S.doc, S.view, sceneOpts());
    Object.assign(snap, { ver: sceneVer, vs, doc: S.doc });
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(snap.c, 0, 0); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    heavyMs = performance.now() - t0;
    clearTimeout(wideT); wideT = heavyMs > 28 ? setTimeout(buildWide, 400) : 0;
    if (heavyMs <= 28) wide = null;
  }
  if (S.stroke && S.stroke.pts.length) drawLiveStroke(ctx, S.view, liveShapePts(), DRAW_TOOLS.has(S.tool) ? TOOL_COLORS[S.tool] || '#16325c' : S.opts.sketch.color);
  if (S.circleDraft) {
    const c = S.view.toScreen(S.circleDraft.c);
    ctx.beginPath(); ctx.arc(c[0], c[1], S.circleDraft.r * S.view.scale, 0, 7); ctx.strokeStyle = '#7b3fe4'; ctx.setLineDash([8, 6]); ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#7b3fe4'; ctx.font = '600 13px system-ui'; ctx.fillText('R = ' + Math.round(S.circleDraft.r) + ' m', c[0] + 8, c[1] - 8);
  }
  if (S.baseEdit && S.doc.base) drawBaseHandles();
  if (S.osnapHint) AX.drawOsnapMark(ctx, S.view.toScreen(S.osnapHint.q), S.osnapHint.type);
  const LIM = penOp() === 'trim' ? S.penLim : null;
  if (LIM && LIM.P) { // giới hạn cắt: cả đối tượng (nét đậm đỏ) + phần kéo dài (nét đứt)
    const path = (pts, close) => { ctx.beginPath(); pts.forEach((q, i) => { const s2 = S.view.toScreen(q); i ? ctx.lineTo(s2[0], s2[1]) : ctx.moveTo(s2[0], s2[1]); }); if (close) ctx.closePath(); };
    ctx.save(); ctx.strokeStyle = '#dc2626';
    if (!LIM.closed) { ctx.lineWidth = 1.5; ctx.setLineDash([10, 6]); path(PEN.limitPath(LIM.P, false, 4000 / S.view.scale), false); ctx.stroke(); ctx.setLineDash([]); }
    ctx.lineWidth = 4; path(LIM.P, LIM.closed); ctx.stroke(); ctx.restore();
  }
  { const pid = (penOp() === 'trim' && S.penCut) || (penOp() === 'join' && S.penJoin && S.penJoin.id) || (penOp() === 'offset' && S.penOff);
    const it = pid && S.doc.items.find((i) => i.id === pid);
    if (it && it.pts) { ctx.save(); ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 5; ctx.globalAlpha = 0.8; ctx.beginPath();
      if (it.kind === 'circle') { const c = S.view.toScreen(it.pts[0]); ctx.arc(c[0], c[1], it.props.radius * S.view.scale, 0, 7); }
      else it.pts.forEach((q, i) => { const s2 = S.view.toScreen(q); i ? ctx.lineTo(s2[0], s2[1]) : ctx.moveTo(s2[0], s2[1]); });
      if (isClosedItem(it)) ctx.closePath(); ctx.stroke(); ctx.restore(); } }
  if (S.measure) drawMeasure(ctx);
  if (S.axisPick) { ctx.save(); ctx.font = '600 14px system-ui'; ctx.fillStyle = '#1d4ed8'; ctx.fillText('Chạm vào một cạnh để căn trục vẽ theo cạnh đó', 100, 90); ctx.restore(); }
  drawScaleBar(ctx, S.view, 100, S.view.h - 22);
}

function fitView() {
  const grp = S.doc.items.map((i) => (i.kind === 'circle' ? [[i.pts[0][0] - i.props.radius, i.pts[0][1] - i.props.radius], [i.pts[0][0] + i.props.radius, i.pts[0][1] + i.props.radius]] : i.pts));
  if (S.doc.base) grp.push([[S.doc.base.x, S.doc.base.y], [S.doc.base.x + S.doc.base.w, S.doc.base.y + S.doc.base.h]]);
  const b = G.robustBBox(grp);
  if (!b) { S.view.cx = 0; S.view.cy = 0; S.view.setRatio(2000); requestRender(); return; }
  S.view.cx = (b.x0 + b.x1) / 2; S.view.cy = (b.y0 + b.y1) / 2;
  S.view.scale = Math.min((S.view.w - 200) / Math.max(10, b.x1 - b.x0), (S.view.h - 120) / Math.max(10, b.y1 - b.y0));
  requestRender();
}

function makeThumb() {
  try {
    const c = document.createElement('canvas'); c.width = 320; c.height = 240;
    const x = c.getContext('2d'); x.fillStyle = '#fbfcfd'; x.fillRect(0, 0, 320, 240);
    const pts = S.doc.items.flatMap((i) => i.pts);
    if (!pts.length) return null;
    const b = G.bbox(pts); const v = new View();
    v.w = 320; v.h = 240; v.cx = (b.x0 + b.x1) / 2; v.cy = (b.y0 + b.y1) / 2;
    v.scale = Math.min(290 / Math.max(10, b.x1 - b.x0), 210 / Math.max(10, b.y1 - b.y0));
    renderScene(x, S.doc, v, { metrics: S.metrics, images: S.images });
    return c.toDataURL('image/jpeg', 0.7);
  } catch { return null; }
}

// ---------------- Công cụ ----------------
const ICONS = { // bộ biểu tượng nét mảnh, một màu + lớp tô nhạt (QP 15)
  select: '<path d="M6 4l12 7.5-5.2 1.3L10 18z" fill="currentColor" fill-opacity=".14"/>',
  eraser: '<path d="M14.5 4.5l5 5-8.5 8.5H7l-2.5-2.5a1.5 1.5 0 010-2.1z" fill="currentColor" fill-opacity=".14"/><path d="M10 9l5 5M11 18h8"/>',
  road: '<path d="M8 20L10.5 4M16 20L13.5 4"/><path d="M12 7v1.6M12 11.2v1.6M12 15.4V17"/>',
  footpath: '<circle cx="13.5" cy="4.6" r="1.7" fill="currentColor" fill-opacity=".14"/><path d="M12.5 8.2l-2 4.6 3 2.2.8 5"/><path d="M10.5 12.8L8.6 20M12.5 8.2l3 2.6 2.6.7"/>',
  move: '<path d="M12 4v16M4 12h16"/><path d="M9.5 6.5L12 4l2.5 2.5M9.5 17.5L12 20l2.5-2.5M6.5 9.5L4 12l2.5 2.5M17.5 9.5L20 12l-2.5 2.5"/>',
  building: '<path d="M5 20V9.5l7-4.5 7 4.5V20z" fill="currentColor" fill-opacity=".14"/><path d="M3.5 20h17M10 20v-4.5h4V20"/>',
  autolay: '<rect x="3.5" y="4.5" width="17" height="15" rx="2" stroke-dasharray="2.5 2"/><rect x="6.5" y="7.5" width="4" height="4.5" rx=".8" fill="currentColor" fill-opacity=".14"/><rect x="12" y="7.5" width="3.5" height="4.5" rx=".8" fill="currentColor" fill-opacity=".14"/><rect x="6.5" y="14" width="9" height="2.6" rx=".8" fill="currentColor" fill-opacity=".14"/><path d="M18.5 8v3M17 9.5h3"/>',
  preset: '<rect x="4" y="4" width="7" height="7" rx="1.5" fill="currentColor" fill-opacity=".14"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5" stroke-dasharray="2 2"/>',
  water: '<path d="M3 9.5c2.2-2 3.8 2 6 0s3.8 2 6 0 3.8 2 6 0"/><path d="M3 14.5c2.2-2 3.8 2 6 0s3.8 2 6 0 3.8 2 6 0"/>',
  park: '<path d="M12 3.5a5.5 5.5 0 015.5 5.5c0 3-2.5 5.5-5.5 5.5S6.5 12 6.5 9A5.5 5.5 0 0112 3.5z" fill="currentColor" fill-opacity=".14"/><path d="M12 14.5V20.5M9 20.5h6"/>',
  zone: '<rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor" fill-opacity=".14"/><path d="M4 11l7-7M4 18L18 4M10 20l10-10M17 20l3-3"/>',
  check: '<path d="M4 20V10l5-4 5 4v10z" fill="currentColor" fill-opacity=".14"/><path d="M7.5 20v-4h3v4"/><circle cx="17.5" cy="16.5" r="3.8"/><path d="M15.9 16.6l1.1 1.1 2.1-2.3"/>',
  arrow: '<path d="M5 19L18 6"/><path d="M10.5 6H18v7.5"/>',
  flow: '<path d="M5 19l1.6-1.6M9 15l1.6-1.6M13 11l1.6-1.6"/><path d="M11 6h7v7"/>',
  circle: '<circle cx="12" cy="12" r="7.5" stroke-dasharray="3 2.2"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>',
  cloud: '<path d="M7 17.5a3.5 3.5 0 01-.3-7 5 5 0 019.5-1.3A3.8 3.8 0 0117 17.5z" fill="currentColor" fill-opacity=".14"/>',
  face: '<path d="M4 8.5l8-4 8 4-8 4z" fill="currentColor" fill-opacity=".14"/><path d="M4 8.5v7l8 4 8-4v-7M12 12.5v7"/>',
  push: '<path d="M4 15l8 4 8-4-8-4z" fill="currentColor" fill-opacity=".14"/><path d="M12 3.5V11M9.2 6.3L12 3.5l2.8 2.8"/>',
  analysis: '<path d="M4.5 19.5l7-7"/><path d="M8 12.5h3.5V16"/><circle cx="16.5" cy="7.5" r="3.5" fill="currentColor" fill-opacity=".14"/><path d="M4 4.5h5M4 7.5h3"/>',
  view3d: '<path d="M12 3.5l7.5 4.2v8.6L12 20.5l-7.5-4.2V7.7z" fill="currentColor" fill-opacity=".14"/><path d="M4.5 7.7L12 12l7.5-4.3M12 12v8.5"/>',
  selbld: '<path d="M4.5 8L11 4.5 17.5 8v7.5L11 19l-6.5-3.5z" stroke-dasharray="2.6 2"/><path d="M13.5 13l6.5 2.6-2.8 1-1.1 2.9z" fill="currentColor"/>',
  selface: '<path d="M4.5 8L11 4.5 17.5 8v7.5L11 19l-6.5-3.5z"/><path d="M11 11.5L17.5 8v7.5L11 19z" fill="currentColor" fill-opacity=".35"/><path d="M4.5 8l6.5 3.5V19"/>',
  editbld: '<path d="M3.5 8.5L10 5l6.5 3.5v6.5L10 18.5 3.5 15z" fill="currentColor" fill-opacity=".14"/><path d="M3.5 8.5L10 12l6.5-3.5M10 12v6.5"/><path d="M15 21l6-6-1.8-1.8-6 6V21z"/>',
  facet: '<path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v8"/><path d="M14.5 13.5l3.5-1.8v4.6l-3.5 1.8z" fill="currentColor" fill-opacity=".14"/>',
  land: '<circle cx="8" cy="8.5" r="3.3" fill="currentColor" fill-opacity=".14"/><circle cx="16.3" cy="7.5" r="3.8" fill="currentColor" fill-opacity=".14"/><path d="M8 11.8V15M16.3 11.3V15"/><path d="M3.5 19c2.8-1.6 5.7-1.6 8.5 0s5.7 1.6 8.5 0"/>',
  tour: '<circle cx="6" cy="5.5" r="1.7" fill="currentColor" fill-opacity=".14"/><path d="M6 8.5v4.5l-1.8 4.5M6 13l1.8 4.5"/><path d="M11 19c3.5 0 3-4 6.5-4s3-4.5-.5-5.5" stroke-dasharray="2 2"/><circle cx="17" cy="7.5" r="1.4" fill="currentColor"/>',
  icon: '<path d="M12 3.8l2.5 5.1 5.6.8-4 3.9 1 5.6-5.1-2.7-5 2.7 1-5.6-4.1-3.9 5.6-.8z" fill="currentColor" fill-opacity=".14"/>',
  pen: '<path d="M4 20l1.2-4.6L15.8 4.8a2.1 2.1 0 0 1 3 3L8.2 18.4z" fill="currentColor" fill-opacity=".14"/><path d="M13.8 6.8l3 3M4 20l4.2-1.6"/>',
  measure: '<path d="M3 15.5L15.5 3 21 8.5 8.5 21z" fill="currentColor" fill-opacity=".14"/><path d="M6.5 12l2 2M9 9.5l1.4 1.4M11.5 7l2 2M14 4.5l1.4 1.4"/>',
  sketch: '<path d="M3.5 16.5c2.5-5 4.5 1.5 7-2.5s3.5-5 6-3.5"/><path d="M14.5 20.5l6-6-2-2-6 6v2z" fill="currentColor" fill-opacity=".14"/>',
  cover: '<path d="M3.5 14.5l8.5-4.8 8.5 4.8-8.5 4.8z" fill="currentColor" fill-opacity=".14"/><path d="M7.8 12.1l8.5 4.8M12 9.7l-8.5 4.8M16.2 12.1l-8.5 4.8"/><path d="M12 3.5v3.5M10.2 5.3L12 7l1.8-1.7"/>',
};
// nhóm công cụ: một nút trên thanh công cụ, bấm mở hộp chọn (Phân tích) hoặc chọn kiểu ngay trong thanh tuỳ chọn (Cảnh quan)
const TOOL_GROUPS = {
  analysis: { name: 'Phân tích', tools: [['arrow', 'Mũi tên'], ['flow', 'Nét đứt'], ['circle', 'Vòng tròn'], ['cloud', 'Vùng mây'], ['tour', 'Tour route'], ['icon', 'Biểu tượng']] },
  bld: { name: 'Công trình', tools: [['building', 'Vẽ công trình'], ['selbld', 'Chọn khối'], ['selface', 'Sửa mặt'], ['push', 'Kéo mặt'], ['face', 'Mặt trên khối'], ['preset', 'Khối mẫu'], ['autolay', 'Xếp khối']] },
  land: { name: 'Cảnh quan', tools: [['land', 'Cảnh quan'], ['park', 'Cây xanh'], ['water', 'Sông hồ'], ['cover', 'Vật liệu phủ']] },
};
ICONS.bld = ICONS.building;
const groupOf = (t) => (t === 'push' || t === 'facet' ? 'bld' : Object.keys(TOOL_GROUPS).find((g) => TOOL_GROUPS[g].tools.some((x) => x[0] === t)));
const TOOLS = [
  ['select', 'Chọn'], ['eraser', 'Xoá'], null,
  ['road', 'Đường'], ['bld', 'Công trình', 'group'], ['move', 'Di chuyển'], ['land', 'Cảnh quan', 'group'], ['zone', 'SDĐ'], ['check', 'Kiểm tra chỉ tiêu'], null,
  ['analysis', 'Phân tích', 'group'], ['measure', 'Thước đo'], null, ['pen', 'Cọ vẽ', 'action'], ['view3d', 'Hiển thị 3D', 'action'],
];
const TOOL_COLORS = { cover: '#b45309', facet: '#9333ea', land: '#4d7c0f', face: '#0f766e', road: '#59626d', footpath: '#a8864f', building: '#16325c', water: '#2b8ccf', park: '#3f8a3a', zone: '#b7791f', arrow: '#d9381e', flow: '#1f7a3a', cloud: '#c2410c' };

function buildToolbar() {
  const tb = $('#toolbar'); tb.innerHTML = '';
  for (const t of TOOLS) {
    if (!t) { tb.append(document.createElement('hr')); continue; }
    const b = h(`<button class="tool" data-tool="${t[0]}"><span class="ti"><svg viewBox="0 0 24 24">${ICONS[t[0]]}</svg></span><span class="tl">${t[1]}</span></button>`);
    if (t[0] === 'view3d') b.onclick = () => toggle3DBar();
    else if (t[0] === 'pen') b.onclick = () => togglePenBar();
    else if (t[0] === 'analysis' || t[0] === 'bld') b.onclick = () => openToolGroup(b, t[0]);
    else if (t[0] === 'land') b.onclick = () => setTool(groupOf(S.tool) === 'land' ? S.tool : (S.opts.landTool || 'land'));
    else b.onclick = () => setTool(t[0]);
    tb.append(b);
  }
  setTool(S.tool);
}
function setTool(t) {
  if (S.baseEdit) endBaseEdit(true);
  // trong nhóm Sửa khối: «Chọn khối» = công cụ Chọn, luôn chọn cả khối; «Sửa mặt» = Vẽ mặt khối ở kiểu chọn mặt
  const sub = t === 'selbld' || t === 'selface' || t === 'push' ? t : t === 'facet' ? 'selface' : null;
  if (t === 'selbld') t = 'select';
  if (t === 'selface') { t = 'facet'; S.opts.facet.mode = 'select'; S.faceDraft = null; saveOpts(); }
  S.subTool = sub; S.axisPick = false; S.osnapHint = null; if (t !== 'measure') S.measure = null;
  if (PANEL.opts && PANEL.opts.min) { PANEL.opts.min = false; savePanels(); } // chọn công cụ: luôn mở lại bảng tuỳ chọn
  const wasCheck = S.tool === 'check';
  S.tool = t; S.stroke = null;
  if ((wasCheck || t === 'check') && S.mode === '3d' && v3) schedule3D(); // bật / tắt tô đỏ công trình vi phạm
  const grp = groupOf(sub || t);
  if (grp === 'land') S.opts.landTool = t;
  $$('#toolbar .tool').forEach((b) => { if (b.dataset.tool === 'view3d' || b.dataset.tool === 'pen') return; b.classList.toggle('on', grp ? b.dataset.tool === grp : b.dataset.tool === t); });
  for (const g of ['analysis', 'bld']) { const ab = document.querySelector(`.tool[data-tool="${g}"]`); if (ab) { const k = sub || t, cur = grp === g ? k : g; ab.querySelector('svg').innerHTML = ICONS[cur]; ab.querySelector('.tl').textContent = grp === g ? TOOL_GROUPS[g].tools.find((x) => x[0] === k)[1] : TOOL_GROUPS[g].name; } }
  if (t !== 'select' && t !== 'eraser') { S.selectedId = null; S.multi = []; renderProps(); }
  renderToolOpts(); requestRender(); syncPenBar();
  if (S.mode === '3d' && v3) draw3DOverlay(); // xoá viền mặt khối đang chọn khi đổi công cụ
}

// «Sửa mặt»: chuyển nhanh giữa Vẽ mặt khối và Kéo mặt (vẫn giữ mặt đang chọn, ô Khóa mặt)
function faceSwitchEl() {
  const sg = h('<div class="seg"></div>');
  for (const [k, n] of [['facet', '✎ Vẽ mặt khối'], ['push', '⇕ Kéo mặt']]) { const b = h(`<button class="${S.tool === k ? 'on' : ''}">${n}</button>`); b.onclick = () => { if (S.tool !== k) { const keep = { sel: S.facetSel, iso: S.isoFace }; setTool(k); S.facetSel = keep.sel; S.isoFace = keep.iso; syncIsoBar(); renderToolOpts(); if (S.mode === '3d' && v3) draw3DOverlay(); } }; sg.append(b); }
  return sg;
}
// Hộp chọn công cụ của nhóm Phân tích
// khối để «Khóa khối»: khối đang khóa, khối / mảng đang chọn, hoặc khối chứa mặt đang chọn
function lockTarget() {
  if (S.iso) return S.doc.items.find((i) => i.id === S.iso) || null;
  const byId = docById();
  const pick = (id) => { const it = id && byId.get(id); const r = it && rootOf(it, byId); return r && r.kind === 'building' ? r : null; };
  return pick(S.selectedId) || (S.facetSel && pick(S.facetSel.parent)) || null;
}
// hai ô tích trong hộp Sửa khối
function lockRows(done) {
  const wrap = h('<div class="tg-locks"></div>');
  const tb = lockTarget();
  const kb = h(`<label class="chk ${tb ? '' : 'dis'}"><input type="checkbox" ${S.iso ? 'checked' : ''} ${tb ? '' : 'disabled'}> 🔒 Khóa khối</label>`);
  kb.querySelector('input').onchange = (e) => { setIso(e.target.checked && tb ? tb.id : null); done(); };
  const mb = h(`<label class="chk ${S.facetSel ? '' : 'dis'}"><input type="checkbox" ${S.isoFace && S.facetSel ? 'checked' : ''} ${S.facetSel ? '' : 'disabled'}> ▣ Khóa mặt</label>`);
  mb.querySelector('input').onchange = (e) => { setIsoFace(e.target.checked); done(); };
  wrap.append(kb, mb);
  if (!tb || !S.facetSel) wrap.append(h(`<div class="tg-note">${!tb ? 'Chọn một khối để khóa khối' : ''}${!tb && !S.facetSel ? ' · ' : ''}${!S.facetSel ? 'chọn một mặt (Sửa mặt) để khóa mặt' : ''}</div>`));
  return wrap;
}
function closeToolGroup() { const o = document.querySelector('.toolgrp'); if (o) o.parentNode.removeChild(o); return o; }
function openToolGroup(btn, g) {
  const old = closeToolGroup(); if (old && old.dataset.g === g) return;
  const r = btn.getBoundingClientRect();
  const box = h(`<div class="toolgrp" data-g="${g}" style="left:${r.right + 8}px;top:${Math.max(8, Math.min(r.top - 8, innerHeight - (g === 'bld' ? 640 : 330)))}px"><div class="tg-h">${TOOL_GROUPS[g].name}</div></div>`);
  for (const [k, n] of TOOL_GROUPS[g].tools) {
    const b = h(`<button class="tool ${(S.subTool || S.tool) === k ? 'on' : ''}" data-pick="${k}"><span class="ti"><svg viewBox="0 0 24 24">${ICONS[k]}</svg></span><span class="tl">${n}</span></button>`);
    b.onclick = () => { closeToolGroup(); setTool(k); };
    if (g === 'bld' && k === 'selbld') box.append(h('<div class="tg-h tg-sub">Sửa khối</div>'));
    if (g === 'bld' && k === 'preset') { box.append(lockRows(() => { closeToolGroup(); })); box.append(h('<div class="tg-h tg-sub">Khối</div>')); }
    box.append(b);
  }
  document.body.append(box);
  const off = (e) => { if (!document.body.contains(box)) { document.removeEventListener('pointerdown', off, true); return; } if (!box.contains(e.target) && e.target.closest('.tool') !== btn) { closeToolGroup(); document.removeEventListener('pointerdown', off, true); } };
  setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
}
// Nút Hiển thị 3D: bật / tắt hộp hiển thị 3D (chuyển sang 3D nếu đang ở 2D)
async function toggle3DBar() {
  const P = PANEL.bar3d || (PANEL.bar3d = {});
  if (S.mode !== '3d') { P.shown = true; savePanels(); await setMode('3d'); }
  else { P.shown = P.shown === false; savePanels(); sync3DBar(); }
}
function sync3DBar() {
  const P = PANEL.bar3d || (PANEL.bar3d = {}), show = S.mode === '3d' && P.shown !== false;
  $('#bar3d').hidden = !show;
  if (show) { P.min = false; panelState($('#bar3d'), P); }
  const b = document.querySelector('.tool[data-tool="view3d"]'); if (b) b.classList.toggle('on', show);
}

// Tự khép chỗ hở nhỏ khi đổ màu / phủ vùng (dùng chung cho Cọ SDĐ, Cảnh quan, Vật liệu phủ)
const gapTol = () => { const g = S.opts.fillGap || {}; return g.on === false ? 0 : Math.max(0, +(g.tol ?? 0.5) || 0); };
function gapRow() {
  const g = S.opts.fillGap || (S.opts.fillGap = { on: true, tol: 0.5 });
  const wrap = h('<span class="gap-row" title="Khi chạm đổ màu: coi vùng là khép kín nếu chỗ hở giữa các nét không lớn hơn khoảng này"></span>');
  const ck = h(`<label class="chk"><input type="checkbox" ${g.on !== false ? 'checked' : ''}> 🔗 Khép chỗ hở ≤</label>`);
  ck.querySelector('input').onchange = (e) => { g.on = e.target.checked; saveOpts(); renderToolOpts(); };
  wrap.append(ck);
  if (g.on !== false) { wrap.append(stepper(g.tol ?? 0.5, 0.01, 0.1, (v) => { g.tol = v; saveOpts(); })); wrap.append(h('<span class="muted">m</span>')); }
  return wrap;
}
function stepper(value, min, step, onChange) {
  const el = h(`<span class="stepper"><button aria-label="Giảm">−</button><input inputmode="decimal" value="${value}"><button aria-label="Tăng">+</button></span>`);
  const inp = el.querySelector('input');
  const set = (v) => { v = Math.max(min, Math.round(v * 100) / 100); inp.value = v; onChange(v); };
  el.children[0].onclick = () => set(parseFloat(inp.value) - step);
  el.children[2].onclick = () => set(parseFloat(inp.value) + step);
  inp.onchange = () => set(parseFloat(inp.value) || min);
  return el;
}
function numInput(value, onChange, min = 0) {
  const el = h(`<input class="num" inputmode="decimal" value="${value}">`);
  el.onchange = () => { const v = Math.max(min, parseFloat(el.value.replace(',', '.')) || 0); el.value = v; onChange(v); };
  return el;
}
function lbl(text, ...nodes) { const l = h(`<label>${text}</label>`); l.append(...nodes); return l; }

const PALETTE = ['#d9381e', '#ea580c', '#f59e0b', '#16a34a', '#1f7a3a', '#0284c7', '#2563eb', '#7b3fe4', '#db2777', '#111827', '#64748b'];
function colorChips(box, cur, onPick, allowAuto = false) {
  if (allowAuto) { const a = h(`<button class="chip ${!cur ? 'on' : ''}">Màu gốc</button>`); a.onclick = () => onPick(''); box.append(a); }
  for (const c of PALETTE) {
    const b = h(`<button class="chip" style="width:30px;background:${c};${cur === c ? 'box-shadow:0 0 0 3px #fff inset,0 0 0 2px ' + c : ''}" aria-label="Màu"></button>`);
    b.onclick = () => onPick(c); box.append(b);
  }
  const col = h(`<input type="color" value="${cur || '#d9381e'}" style="width:36px;height:32px;border:0;background:none" aria-label="Màu khác">`);
  col.onchange = () => onPick(col.value); box.append(col);
}
// màu + độ dày cho mũi tên / vòng tròn (công cụ)
function styleOpts(box, o, widths) {
  colorChips(box, o.color, (c) => { o.color = c; saveOpts(); renderToolOpts(); });
  for (const [n, w] of widths) { const b = h(`<button class="chip ${o.width === w ? 'on' : ''}">${n}</button>`); b.onclick = () => { o.width = w; saveOpts(); renderToolOpts(); }; box.append(b); }
}
// ---------------- Trục vẽ, bắt điểm ----------------
const AXIS_TOOLS = ['road', 'footpath', 'building', 'zone', 'park', 'water', 'land', 'cover', 'cloud', 'arrow', 'flow', 'tour', 'sketch', 'facet'];
function axisOn(tool) { const a = S.opts.axis; void a; if (tool === 'facet') return penOn() && !!S.opts.pen.axis; return (AXIS_TOOLS.includes(tool) || tool === 'pen') && penOn() && !!S.opts.pen.axis; }
const axisRad = () => ((S.opts.axis.ang || 0) * Math.PI) / 180;
// hàng tuỳ chọn «Trục vẽ» trong hộp thoại của công cụ vẽ
function axisRow(tool) {
  const a = S.opts.axis, on = axisOn(tool), wrap = h('<div class="axis-row"></div>');
  const rr = () => { if (tool === 'pen') syncPenBar(); else renderToolOpts(); };
  if (tool !== 'pen') {
    const ck = h(`<label class="chk"><input type="checkbox" ${on ? 'checked' : ''}> 📐 Trục vẽ</label>`);
    ck.querySelector('input').onchange = (e) => { a.on = { ...(a.on || {}), [tool]: e.target.checked }; saveOpts(); renderToolOpts(); requestRender(); if (S.mode === '3d') draw3DOverlay(); };
    wrap.append(ck);
  }
  if (on) {
    const sg = h('<div class="seg"></div>');
    for (const [k, n] of [[90, 'Lưới 90°'], [45, 'Lưới 45°']]) { const b = h(`<button class="${(a.step || 90) === k ? 'on' : ''}">${n}</button>`); b.onclick = () => { a.step = k; saveOpts(); rr(); requestRender(); }; sg.append(b); }
    wrap.append(sg);
    const setAng = (v) => { v = ((v % 360) + 360) % 360; a.ang = Math.round(v * 100) / 100; saveOpts(); rr(); requestRender(); if (S.mode === '3d') draw3DOverlay(); };
    wrap.append(lbl(tool === 'facet' ? 'Xoay trục (° so với cạnh mặt)' : 'Xoay trục (°)', stepper(a.ang || 0, -360, 5, setAng)));
    const r0 = h('<button class="chip">0°</button>'); r0.onclick = () => setAng(0); wrap.append(r0);
    const pk = h(`<button class="chip ${S.axisPick ? 'on' : ''}">∥ Căn theo cạnh</button>`);
    pk.onclick = () => { S.axisPick = !S.axisPick; rr(); requestRender(); if (S.axisPick) toast(tool === 'facet' ? 'Chạm vào một cạnh hoặc nét trên mặt để căn trục theo' : 'Chạm vào một cạnh (đường, công trình, ô đất…) để căn trục theo'); };
    wrap.append(pk);
  }
  return wrap;
}
// «Căn theo cạnh»: chạm 2D vào cạnh đối tượng
function axisPickAt(w, sc) {
  S.axisPick = false;
  const ang = AX.edgeAngleAt(S.doc.items.filter((i) => i.pts && i.kind !== 'facet'), w, 16 / sc);
  if (ang == null) { toast('Không có cạnh nào gần chỗ chạm'); renderToolOpts(); requestRender(); return; }
  S.opts.axis.ang = Math.round((AX.normAxis(ang, S.opts.axis.step || 90) * 180 / Math.PI) * 100) / 100; saveOpts();
  toast(`Trục vẽ đã căn theo cạnh: ${G.fmtNum(S.opts.axis.ang, 1)}°`); renderToolOpts(); syncPenBar(); requestRender();
}
// ---- Vật liệu phủ ----
function coverProps() { const co = S.opts.cover; if ((co.by || 'mat') === 'color') return { mat: '', color: co.color || '#d9cdb4', scale: 0, ang: 0, name: '' }; const m = MT.findMat(S.doc, co.mat); return { mat: m ? m.id : '', color: (m && m.color) || co.color, scale: co.scale || (m && m.scale) || 1, ang: co.ang || 0, name: '' }; }
function addMatFromPhoto() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = async () => {
    const f = inp.files && inp.files[0]; if (!f) return;
    try {
      const r = await MT.readMatFile(f);
      const name = (f.name || 'Ảnh mẫu').replace(/\.[a-z0-9]+$/i, '').slice(0, 24) || 'Ảnh mẫu';
      const m = { id: 'u:' + M.uid(), name, src: r.src, color: r.color, scale: 2 };
      checkpoint(); S.doc.settings.mats = (S.doc.settings.mats || []).concat([m]); S.opts.cover.mat = m.id; S.opts.cover.by = 'mat'; S.opts.cover.scale = 2; saveOpts();
      changed(); renderToolOpts(); toast('Đã thêm vật liệu «' + name + '» · chỉnh «Tỉ lệ mẫu» cho đúng kích thước thật');
    } catch (e) { toast('Không đọc được ảnh: ' + e.message); }
  };
  inp.click();
}
function confirmMatDelete(m) {
  const used = S.doc.items.filter((i) => i.kind === 'cover' && i.props.mat === m.id).length;
  checkpoint(); S.doc.settings.mats = (S.doc.settings.mats || []).filter((x) => x.id !== m.id);
  for (const i of S.doc.items) if (i.kind === 'cover' && i.props.mat === m.id) i.props.mat = '';
  MT.forgetMat(m.id); if (S.opts.cover.mat === m.id) S.opts.cover.mat = 'p:gach';
  changed(); renderToolOpts(); toast(`Đã bỏ mẫu «${m.name}»${used ? ` · ${used} vùng chuyển sang màu đơn` : ''}`); return true;
}
// chạm vào vùng khép kín: phủ vật liệu (chạm vùng đã phủ thì thay vật liệu)
function tapCover(w, sc) {
  const cur = S.doc.items.filter((i) => i.kind === 'cover' && inIso(i)).reverse().find((i) => G.pointInPolygon(w, i.pts) && !(i.holes || []).some((hh) => G.pointInPolygon(w, hh)));
  if (cur) { checkpoint(); Object.assign(cur.props, coverProps()); S.selectedId = cur.id; changed(); renderProps(); toast('Đã thay vật liệu phủ'); return; }
  const extra = [];
  for (const i of S.doc.items) {
    if (i.kind === 'sketch' || i.kind === 'cloud') extra.push(i.pts.map((q) => [q[0], q[1]]));
    else if (i.kind === 'cover') extra.push(i.pts.concat([i.pts[0]]));
  }
  const poly = fillRegionAt(S.doc, w, extra, { land: true, gap: gapTol() });
  if (!poly) { toast('Vùng này chưa khép kín. Hãy khoanh vùng bằng bút, hoặc vẽ thêm nét nháp để khép vùng.'); return; }
  const it = newItem('cover', poly.map((q) => [q[0], q[1]]), coverProps()); if (poly.holes && poly.holes.length) it.holes = poly.holes;
  checkpoint(); S.doc.items.push(it); S.selectedId = it.id; changed(); renderProps();
  toast(`Đã phủ vật liệu (${G.fmtArea(M.itemArea(it))})`);
}
// Nắn đối tượng vừa vẽ theo trục vẽ và bắt điểm
function shapeByAxis(it, sc, tool = S.tool, opts = {}) {
  if (!it) return it;
  const ax = axisOn(tool), os = tool === 'building' && penOn() && S.opts.pen.osnap && !opts.pen;
  if (!ax && !os) return it;
  const step = S.opts.axis.step || 90, base = axisRad();
  const curved = (it.props && it.props.ring) || it.kind === 'circle' || opts.circle || (it.kind === 'building' && bldShape() === 'organic') || (it.kind === 'land' && it.props.style === 'tree');
  const closed = ['building', 'zone', 'park', 'cloud', 'cover'].includes(it.kind) || (it.kind === 'land' && M.LAND_CLOSED[it.props.style]) || (it.kind === 'water' && it.props.mode !== 'river');
  if (ax && !curved) {
    if (it.kind === 'road' && it.props.pis) {
      const isC = G.dist(it.props.pis[0], it.props.pis[it.props.pis.length - 1]) < 1e-6;
      let pis = AX.axisSnapPts(it.props.pis, isC, base, step); if (isC) pis = pis.concat([pis[0]]);
      it.props.pis = pis; it.props.radii = (it.props.radii || []).slice(0, Math.max(0, pis.length - 2)); while (it.props.radii.length < pis.length - 2) it.props.radii.push(it.props.radii[0] || 0);
      delete it.props.ctrl; setRoadGeometry(it);
    } else if (it.pts.length >= 2) {
      const z = it.kind === 'sketch' ? (it.pts[0][2] ?? 0.5) : null;
      const simp = closed ? G.rdp(it.pts.concat([it.pts[0]]), 3 / sc).slice(0, -1) : G.rdp(it.pts, 3 / sc);
      let q = AX.axisSnapPts(simp.length >= (closed ? 3 : 2) ? simp : it.pts, closed, base, step);
      if (z != null) q = q.map((p) => [p[0], p[1], z]);
      if (closed && q.length >= 3 && G.area(q) > 1) it.pts = q; else if (!closed && q.length >= 2) it.pts = q;
    }
  }
  if (os && it.kind === 'building' && it.pts.length >= 3) { // bắt điểm: đỉnh gần điểm bắt thì hút vào
    const tol = 18 / sc, others = S.doc.items.filter((i) => i.id !== it.id && i.kind !== 'facet');
    const rigid = ax || bldShape() !== 'poly';
    let best = null;
    const P = it.pts.map((q) => q.slice());
    for (let i = 0; i < P.length; i++) {
      const sn = AX.osnap(others, P[i], tol, P[(i - 1 + P.length) % P.length]);
      if (!sn) continue;
      const dd = G.dist(sn.q, P[i]);
      if (rigid) { if (!best || dd < best.d) best = { d: dd, dx: sn.q[0] - P[i][0], dy: sn.q[1] - P[i][1], type: sn.type }; }
      else { P[i] = sn.q; best = best || { type: sn.type, n: 0 }; best.n = (best.n || 0) + 1; }
    }
    if (best) {
      it.pts = rigid ? P.map((q) => [q[0] + best.dx, q[1] + best.dy]) : P;
      toast('Bắt điểm: ' + AX.OSNAP_NAMES[best.type].toLowerCase());
    }
  }
  return it;
}

// ---------------- Cọ vẽ (QP-18): thanh vẽ trên cùng, dùng cho mọi lớp ----------------
// công cụ vẽ theo lớp: nét / hình vẽ bằng Cọ vẽ thành đối tượng của lớp đó (đường, công trình, ô đất…)
const DRAW_TOOLS = new Set(['road', 'footpath', 'building', 'zone', 'park', 'water', 'land', 'cover', 'cloud', 'arrow', 'flow', 'tour', 'face']);
const penOn = () => !!(S.opts.pen && S.opts.pen.on);
// nhóm «Chỉnh sửa» theo công cụ / loại đối tượng
const EDIT_TOOL = { road: 'road', building: 'building', preset: 'building', autolay: 'building', face: 'building', zone: 'zone', land: 'land', park: 'land', water: 'land', cover: 'land' };
const EDIT_KIND = { road: 'road', junction: 'road', building: 'building', facet: 'building', zone: 'zone', land: 'land', park: 'land', water: 'land', cover: 'land' };
const EDIT_NAME = { road: 'Đường', building: 'Công trình', zone: 'SDĐ', land: 'Cảnh quan' };
const editOn = (k) => !k || !!(S.opts.edit && S.opts.edit[k]);
const canEdit = (it) => editOn(EDIT_KIND[it.kind]);
const penLayerTool = () => DRAW_TOOLS.has(S.tool) && editOn(EDIT_TOOL[S.tool]); // nét Cọ vẽ thành đối tượng của lớp công cụ
function noEditToast(it) { const k = EDIT_KIND[it.kind]; toast(`Lớp ${EDIT_NAME[k]} chưa bật «Chỉnh sửa»: tích ô ✏ Chỉnh sửa trong hộp ${EDIT_NAME[k]} để Cọ vẽ sửa đối tượng này`); }
function editChk(key) {
  const on = editOn(key), c = h(`<label class="chk editchk ${on ? 'on' : ''}"><input type="checkbox" ${on ? 'checked' : ''}> ✏ Chỉnh sửa</label>`);
  c.querySelector('input').onchange = (e) => { S.opts.edit = { ...(S.opts.edit || {}), [key]: e.target.checked }; saveOpts(); syncPenBar(); renderToolOpts(); toast(e.target.checked ? `Cọ vẽ: thêm, sửa đối tượng lớp ${EDIT_NAME[key]}` : 'Cọ vẽ: nét mới vào lớp Cọ nháp'); };
  return c;
}
// Sửa mặt (3D): kiểu vẽ trên mặt theo thanh Cọ vẽ; tắt Cọ vẽ = chỉ chọn mặt
function facetMode() {
  if (!penOn()) return 'select';
  const p = S.opts.pen;
  if (p.op === 'erase' || p.op === 'trim') return p.op;
  if (p.op) return 'select';
  return { line: 'line', pline: 'pline', curve: 'curve', free: 'free', smooth: 'free', organic: 'free', rect: 'rect', circle: 'circle' }[p.shape] || 'stroke';
}
const penShape = () => (penOn() && !S.opts.pen.op ? S.opts.pen.shape || null : null);
const penOp = () => (penOn() ? S.opts.pen.op || null : null);
const CURVED_PEN = new Set(['free', 'organic', 'smooth', 'arc', 'curve', 'circle', 'ellipse']);
function penHint(auto) { const k = penShape(); return k ? `Cọ vẽ: ${PEN.penName(k).toLowerCase()}${PEN.isClosedShape(k) ? ' · khoanh / kéo theo đường chéo (hình tròn, ngũ giác: kéo từ tâm)' : ''}` : auto; }
function penTarget() {
  if (penOp()) return '';
  const t = penLayerTool() ? S.tool : 'sketch';
  const n = { road: 'Đường', footpath: 'Đường đi bộ', building: 'Công trình', zone: 'Ô đất SDĐ', park: 'Cây xanh', water: 'Sông hồ', land: 'Cảnh quan', cover: 'Vật liệu phủ', cloud: 'Vùng mây', arrow: 'Mũi tên', flow: 'Nét đứt', tour: 'Tour', face: 'Khối trên mái', sketch: 'Cọ nháp' }[t];
  return n;
}
function togglePenBar(force) {
  const p = S.opts.pen; p.on = force == null ? !p.on : !!force;
  if (!p.on) { S.penLim = null; S.measure = S.tool === 'measure' ? S.measure : null; }
  saveOpts(); syncPenBar(); renderToolOpts(); requestRender();
  toast(p.on ? 'Cọ vẽ: chọn kiểu nét / hình rồi vẽ · nét vẽ thành đối tượng của lớp đang chọn (Đường, Công trình, SDĐ…)' : 'Đã tắt Cọ vẽ');
}
function syncPenBar() {
  let bar = $('#penbar');
  const on = penOn() && S.doc;
  document.body.classList.toggle('pen-on', !!on);
  const tb = document.querySelector('.tool[data-tool="pen"]'); if (tb) tb.classList.toggle('on', !!on);
  if (!on) { if (bar) bar.hidden = true; return; }
  if (!bar) { bar = h('<div class="penbar" id="penbar"></div>'); $('#editor').append(bar); }
  bar.hidden = false; bar.innerHTML = '';
  const p = S.opts.pen;
  const ib = (k, n, ic, on, fn) => { const b = h(`<button class="pb ${on ? 'on' : ''}" data-pen="${k}" title="${n}" aria-label="${n}"><svg viewBox="0 0 24 24">${ic}</svg></button>`); b.onclick = fn; return b; };
  const g1 = h('<div class="pgrp"></div>');
  for (const [k, n, ic] of PEN.PEN_SHAPES) g1.append(ib(k, n, ic, !p.op && p.shape === k, () => { p.shape = p.shape === k && !p.op ? null : k; p.op = null; penReset(); syncPen3DTool(); saveOpts(); syncPenBar(); renderToolOpts(); requestRender(); toast(p.shape ? 'Cọ vẽ: ' + n : 'Cọ vẽ: tự nhận dạng theo công cụ'); }));
  const g2 = h('<div class="pgrp"></div>');
  for (const [k, n, ic] of PEN.PEN_OPS) g2.append(ib(k, n, ic, p.op === k, () => { p.op = p.op === k ? null : k; penReset(); saveOpts(); syncPen3DTool(); syncPenBar(); renderToolOpts(); requestRender(); if (S.mode === '3d' && v3) draw3DOverlay(); if (p.op) toast(OP_HINT[p.op]); }));
  bar.append(g1, h('<span class="psep"></span>'), g2);
  if (p.op === 'fillet') bar.append(lbl('R (m)', stepper(p.R ?? 5, 0.1, 0.5, (v) => { p.R = v; saveOpts(); })));
  if (p.op === 'chamfer') bar.append(lbl('Vát (m)', stepper(p.V ?? 3, 0.1, 0.5, (v) => { p.V = v; saveOpts(); })));
  if (p.op === 'join') bar.append(lbl('R (m)', stepper(p.J ?? 10, 0.1, 0.5, (v) => { p.J = v; saveOpts(); })));
  if (p.op === 'offset') bar.append(lbl('Khoảng (m)', stepper(p.D ?? 3, 0.05, 0.5, (v) => { p.D = v; saveOpts(); })));
  if (p.op === 'extrude') {
    if (S.mode === '3d') { const sg = h('<div class="seg"></div>'), pm = (S.opts.push && S.opts.push.mode) || 'pos'; for (const [k, n] of [['pos', '＋ Đùn ra'], ['neg', '－ Ấn lõm']]) { const b = h(`<button class="${pm === k ? 'on' : ''}">${n}</button>`); b.onclick = () => { S.opts.push = { ...(S.opts.push || {}), mode: k }; saveOpts(); syncPenBar(); }; sg.append(b); } bar.append(sg); }
    else bar.append(lbl('Cao (m)', stepper(p.H ?? 10, 0.5, 1, (v) => { p.H = v; saveOpts(); })));
  }
  const step = penStep(); if (step) bar.append(h(`<span class="pstep">${step}</span>`));
  if ((p.op === 'trim' && S.penLim) || (p.op === 'join' && S.penJoin) || (p.op === 'offset' && S.penOff)) { const r = h('<button class="chip">↺ Chọn lại</button>'); r.onclick = () => { penReset(); syncPenBar(); requestRender(); }; bar.append(r); }
  bar.append(h('<span class="psep"></span>'));
  const ck = (key, n, cb) => { const c = h(`<label class="chk"><input type="checkbox" ${p[key] ? 'checked' : ''}> ${n}</label>`); c.querySelector('input').onchange = (e) => { p[key] = e.target.checked; saveOpts(); S.osnapHint = null; syncPenBar(); renderToolOpts(); requestRender(); if (cb) cb(); }; return c; };
  bar.append(ck('osnap', '🧲 Bắt điểm'), ck('axis', '📐 Trục vẽ', () => { if (S.mode === '3d') draw3DOverlay(); }));
  const fd = h(`<button class="chip ${S.opts.fingerDraw ? 'on' : ''}" title="Khi không có Apple Pencil">✋ Ngón tay</button>`);
  fd.onclick = () => { S.opts.fingerDraw = !S.opts.fingerDraw; saveOpts(); syncPenBar(); toast(S.opts.fingerDraw ? 'Ngón tay dùng để vẽ · dùng 2 ngón để di chuyển' : 'Ngón tay dùng để di chuyển · vẽ bằng bút'); };
  bar.append(fd);
  const tg = penTarget(); if (tg) bar.append(h(`<span class="ptarget" title="Nét vẽ thành đối tượng của lớp này">→ ${tg}</span>`));
  const x = h('<button class="pb px" title="Tắt Cọ vẽ" aria-label="Tắt Cọ vẽ"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>'); x.onclick = () => togglePenBar(false); bar.append(x);
  if (p.axis) { const ar = axisRow('pen'); ar.classList.add('pen-axis'); bar.append(ar); }
  requestAnimationFrame(() => document.body.style.setProperty('--penh', bar.offsetHeight + 'px'));
}
const OP_HINT = {
  erase: 'Xoá: chạm hoặc quét bút qua đối tượng cần xoá',
  trim: 'Cắt: ① chạm đối tượng làm giới hạn (nét đỏ) → ② chạm đối tượng cần cắt → ③ chạm vào miền cần cắt bỏ',
  join: 'Bán kính cong: nhập R, chạm đường thẳng / đường cong thứ nhất rồi thứ hai: tạo cung tròn R nối hai đối tượng (như lệnh Fillet)',
  offset: 'Offset: nhập khoảng cách, chạm đối tượng cần offset, rồi chạm vào phía muốn đặt bản offset',
  extrude: 'Extrude khối: 2D: nhập chiều cao, chạm vào một hình khép kín để dựng thành khối (chạm công trình để đổi chiều cao) · 3D: kéo mặt khối / mảng lên xuống',
  fillet: 'Bo tròn: chạm vào góc (đỉnh) của đối tượng, hoặc vào góc giao lộ đường, để bo theo bán kính R',
  chamfer: 'Vát góc: chạm vào góc (đỉnh) của đối tượng, hoặc vào góc giao lộ (vát vỉa hè), để vát theo khoảng đã nhập',
};
// điểm bắt (đầu / cuối nét) khi bật Bắt điểm
function penSnapFn(sc) {
  if (!penOn() || !S.opts.pen.osnap) return null;
  const items = M.liveItems(S.doc).filter((i) => i.kind !== 'facet');
  return (q) => { const sn = AX.osnap(items, q, 16 / sc, null); return sn ? sn.q : q; };
}
function penGeomFor(raw, sc) {
  const k = penShape(); if (!k) return null;
  const g = PEN.penGeom(k, raw, sc, { ang: penOn() && S.opts.pen.axis ? axisRad() : null, snap: penSnapFn(sc), minR: S.tool === 'road' ? S.opts.road.minR || 15 : S.tool === 'footpath' ? S.opts.footpath.minR || 3 : 5 });
  if (g) g.pen = k;
  return g;
}
// ---- Cắt / bo tròn / vát góc ----
const OPEN_KINDS = new Set(['sketch', 'arrow', 'flow', 'land', 'cad', 'water']);
const POLY_KINDS = new Set(['building', 'zone', 'park', 'cover', 'cloud', 'land', 'water', 'cad']);
const isClosedItem = (it) => ['building', 'zone', 'park', 'cover', 'cloud'].includes(it.kind) || (it.kind === 'land' && M.LAND_CLOSED[it.props.style]) || (it.kind === 'water' && it.props.mode !== 'river') || (it.kind === 'cad' && !!it.closed);
function penTap(op, w, sc) {
  if (op === 'trim') return penTrim(w, sc);
  if (op === 'join') return penJoin(w, sc);
  if (op === 'offset') return penOffset(w, sc);
  if (op === 'extrude') return penExtrude(w, sc);
  return penCorner(op, w, sc);
}
function penReset() { S.penLim = null; S.penCut = null; S.penJoin = null; S.penOff = null; }
// bước đang chờ của lệnh nhiều bước (hiện trên thanh Cọ vẽ)
function penStep() {
  const op = penOp();
  if (op === 'trim') return !S.penLim ? '① Chạm đối tượng giới hạn' : !S.penCut ? '② Chạm đối tượng cần cắt' : '③ Chạm miền cần cắt bỏ';
  if (op === 'join') return S.penJoin ? '② Chạm đối tượng thứ hai' : '① Chạm đối tượng thứ nhất';
  if (op === 'offset') return S.penOff ? '② Chạm phía đặt bản offset' : '① Chạm đối tượng cần offset';
  return '';
}
const NO_EDIT = ['junction', 'facet', 'icon'];
const pickFor = (w, sc, ok, edit = true) => { const all = hitAll(S.doc, w, sc).filter((i) => !NO_EDIT.includes(i.kind) && inIso(i) && ok(i)); const r = all.find((i) => !edit || canEdit(i)); if (!r && all.length) noEditToast(all[0]); return r || null; };
function penTrim(w, sc) {
  const T = S.penLim;
  if (!T) {
    const e = RO.nearestEdge(S.doc, w, 14 / sc);
    if (!e) { toast('① Chạm vào đối tượng làm giới hạn cắt (nét, cạnh ô đất, mép đường…)'); return; }
    S.penLim = { id: e.it.id, P: e.P.map((q) => [q[0], q[1]]), closed: !!e.closed }; S.penCut = null;
    syncPenBar(); requestRender('ov'); toast('② Chạm vào đối tượng cần cắt'); return;
  }
  const cur = S.penCut && S.doc.items.find((i) => i.id === S.penCut);
  if (!cur) {
    const hit = pickFor(w, sc, (i) => i.id !== T.id && i.kind !== 'circle' && i.pts && i.pts.length >= 2);
    if (!hit) { toast('② Chạm vào đối tượng cần cắt (khác đối tượng giới hạn)'); return; }
    if (M.isLocked(S.doc, hit)) { lockedToast(); return; }
    S.penCut = hit.id; syncPenBar(); requestRender('ov'); toast('③ Chạm vào miền cần cắt bỏ của đối tượng'); return;
  }
  const lim = PEN.limitPath(T.P, T.closed);
  let ok;
  if (cur.kind === 'road') ok = cutRoadItem(cur, lim, w);
  else if (isClosedItem(cur)) ok = cutPolyItem(cur, lim, w);
  else ok = cutOpenItem(cur, lim, w);
  if (ok === null) { toast('Đối tượng không cắt qua giới hạn (kể cả phần kéo dài) · ↺ Chọn lại'); return; }
  if (ok === false) { toast('③ Chạm vào bên trong miền cần cắt bỏ'); return; }
  S.penCut = null; syncPenBar(); requestRender('ov');
  toast('Đã cắt · ② chạm đối tượng khác để cắt tiếp theo cùng giới hạn');
}
function cutRoadItem(road, lim, w) {
  const pieces = PEN.cutPathBy(road.pts, lim, w);
  if (!pieces) return null;
  checkpoint();
  const asPiece = (r, pc) => { const pr = r.props; delete pr.ctrl; delete pr.smooth; delete pr.ring; delete pr.radiiEff; pr.pis = pc.map((q) => q.slice()); pr.radii = pc.slice(2).map(() => 0); setRoadGeometry(r); return r; };
  if (!pieces.length) S.doc.items = S.doc.items.filter((i) => i !== road);
  else {
    const rest = pieces.slice(1).map(() => ({ ...road, id: M.uid(), props: JSON.parse(JSON.stringify(road.props)) }));
    asPiece(road, pieces[0]);
    rest.forEach((r, k) => { asPiece(r, pieces[k + 1]); S.doc.items.push(r); });
  }
  changed(); return true;
}
function cutOpenItem(it, lim, w) {
  const z = it.pts[0] && it.pts[0].length > 2 ? it.pts[0][2] : null;
  const pieces = PEN.cutPathBy(it.pts, lim, w);
  if (!pieces) return null;
  checkpoint();
  const fix = (pc) => (z != null ? pc.map((q) => [q[0], q[1], z]) : pc.map((q) => [q[0], q[1]]));
  if (!pieces.length) S.doc.items = S.doc.items.filter((i) => i !== it);
  else {
    it.pts = fix(pieces[0]);
    for (const pc of pieces.slice(1)) S.doc.items.push({ ...JSON.parse(JSON.stringify(it)), id: M.uid(), pts: fix(pc) });
  }
  changed(); return true;
}
function cutPolyItem(it, lim, w) {
  const P = it.pts.map((q) => [q[0], q[1]]);
  const pieces = ZO.splitPolygon(P, lim);
  if (pieces.length < 2) return null;
  const k = pieces.findIndex((pc) => G.pointInPolygon(w, pc));
  if (k < 0) return false;
  const keep = pieces.filter((_, i) => i !== k);
  checkpoint();
  const withHoles = (pc) => { pc.holes = (it.holes || []).filter((hh) => G.pointInPolygon(hh[0], pc)); pc.net = Math.abs(G.area(pc)) - pc.holes.reduce((s2, q) => s2 + Math.abs(G.area(q)), 0); return pc; };
  if (it.kind === 'building' && it.props.preset) delete it.props.preset;
  setZonePoly(it, withHoles(keep[0]));
  for (const q of keep.slice(1)) { const c = { ...JSON.parse(JSON.stringify(it)), id: M.uid() }; setZonePoly(c, withHoles(q)); S.doc.items.push(c); }
  changed(); return true;
}
// ---- Bán kính cong nối 2 đối tượng (Fillet) ----
const joinable = (i) => (i.kind === 'road' ? !i.props.ring : !isClosedItem(i) && OPEN_KINDS.has(i.kind)) && i.pts && i.pts.length >= 2;
function nearestSeg(P, w) { let b = null; for (let i = 0; i < P.length - 1; i++) { const r = G.distToSegment(w, P[i], P[i + 1]); if (!b || r.d < b.d) b = { i, d: r.d }; } return b; }
function penJoin(w, sc) {
  const hit = pickFor(w, sc, joinable);
  if (!hit) { toast('Chạm vào một đường thẳng, đường cong hoặc nét vẽ (với lộ giới đường dùng Bo tròn ở góc giao lộ)'); return; }
  if (M.isLocked(S.doc, hit)) { lockedToast(); return; }
  const A = S.penJoin && S.doc.items.find((i) => i.id === S.penJoin.id);
  if (!A) { S.penJoin = { id: hit.id, w: w.slice() }; syncPenBar(); requestRender('ov'); toast('② Chạm đối tượng thứ hai'); return; }
  if (hit.id === A.id) { toast('② Chạm đối tượng thứ hai (khác đối tượng thứ nhất)'); return; }
  const w1 = S.penJoin.w, R = S.opts.pen.J ?? 10; S.penJoin = null;
  if (A.kind === 'road' || hit.kind === 'road') return joinRoads(A, hit, w1, w, R);
  const s1 = nearestSeg(A.pts, w1), s2 = nearestSeg(hit.pts, w);
  const r = PEN.joinArc(A.pts[s1.i], A.pts[s1.i + 1], w1, hit.pts[s2.i], hit.pts[s2.i + 1], w, R);
  if (!r) { toast('Hai đối tượng song song (hoặc thẳng hàng), không nối được'); syncPenBar(); requestRender('ov'); return; }
  checkpoint();
  const zOf = (it) => (it.pts[0].length > 2 ? it.pts[0][2] : null), fz = (z, pts) => (z != null ? pts.map((q) => [q[0], q[1], z]) : pts);
  const t1 = PEN.trimToPoint(A.pts, s1.i, r.T1, r.X, w1), t2 = PEN.trimToPoint(hit.pts, s2.i, r.T2, r.X, w);
  if (A.kind === hit.kind && ['sketch', 'cad'].includes(A.kind)) { // cùng loại nét: nối thành một nét
    const p1 = t1.atEnd ? t1.pts : t1.pts.slice().reverse(), p2 = t2.atEnd ? t2.pts.slice().reverse() : t2.pts;
    A.pts = fz(zOf(A), p1.concat(r.arc.slice(1, -1), p2));
    if (A.kind === 'cad') A.closed = false;
    S.doc.items = S.doc.items.filter((i) => i !== hit);
  } else {
    const zA = zOf(A), zB = zOf(hit);
    A.pts = fz(zA, t1.pts); hit.pts = fz(zB, t2.pts);
    for (const it of [A, hit]) if (it.props && it.props.ctrl) delete it.props.ctrl;
    S.doc.items.push(newItem('sketch', r.arc.map((q) => [q[0], q[1], 0.5]), { color: S.opts.sketch.color, width: 2 / S.view.scale }));
  }
  changed(); syncPenBar();
  toast(`Đã nối bằng cung tròn R = ${G.fmtNum(R)} m`);
}
// hai đường giao thông: kéo / cắt tim tới giao điểm, gộp thành một đường có bán kính cong R tại góc
function joinRoads(A, B, w1, w2, R) {
  if (A.kind !== 'road' || B.kind !== 'road') { toast('Bán kính cong: chọn hai đường giao thông, hoặc hai nét (đường thẳng, đường cong)'); syncPenBar(); requestRender('ov'); return; }
  const tim = (r) => (r.props.pis && !r.props.ctrl ? r.props.pis : r.pts).map((q) => [q[0], q[1]]);
  const P1 = tim(A), P2 = tim(B), s1 = nearestSeg(P1, w1), s2 = nearestSeg(P2, w2);
  const r = PEN.joinArc(P1[s1.i], P1[s1.i + 1], w1, P2[s2.i], P2[s2.i + 1], w2, R);
  if (!r) { toast('Hai đường song song (hoặc thẳng hàng), không nối được'); syncPenBar(); requestRender('ov'); return; }
  const t1 = PEN.trimToPoint(P1, s1.i, r.X, r.X, w1), t2 = PEN.trimToPoint(P2, s2.i, r.X, r.X, w2);
  const p1 = t1.atEnd ? t1.pts : t1.pts.slice().reverse(), p2 = t2.atEnd ? t2.pts.slice().reverse() : t2.pts;
  const pis = p1.concat(p2.slice(1));
  const oldR = (rd, P) => { const m = new Map(); (P === P1 && !A.props.ctrl ? A.props.radii : P === P2 && !B.props.ctrl ? B.props.radii : []).forEach((v, i) => m.set(P[i + 1].join(','), v)); return m; };
  const r1 = oldR(0, P1), r2 = oldR(0, P2);
  const radii = pis.slice(1, -1).map((q) => (G.dist(q, r.X) < 1e-6 ? R : r1.get(q.join(',')) ?? r2.get(q.join(',')) ?? 0));
  checkpoint();
  const pr = A.props; delete pr.ctrl; delete pr.smooth; delete pr.ring; delete pr.radiiEff;
  pr.pis = pis; pr.radii = radii; setRoadGeometry(A);
  S.doc.items = S.doc.items.filter((i) => i !== B);
  changed(); syncPenBar();
  toast(`Đã nối hai đường bằng bán kính cong R = ${G.fmtNum(R)} m`);
}
// ---- Offset ----
function penOffset(w, sc) {
  const D = S.opts.pen.D ?? 3;
  const src = S.penOff && S.doc.items.find((i) => i.id === S.penOff);
  if (!src) {
    const hit = pickFor(w, sc, (i) => (i.kind === 'circle' || (i.pts && i.pts.length >= 2)), false);
    if (!hit) { toast('① Chạm vào đối tượng cần offset'); return; }
    S.penOff = hit.id; syncPenBar(); requestRender('ov'); toast('② Chạm vào phía muốn đặt bản offset'); return;
  }
  S.penOff = null;
  const z = src.pts[0] && src.pts[0].length > 2 ? src.pts[0][2] : null, fz = (pts) => (z != null ? pts.map((q) => [q[0], q[1], z]) : pts);
  let it = null;
  if (src.kind === 'circle') {
    const r = src.props.radius, inside = G.dist(w, src.pts[0]) < r, nr = inside ? r - D : r + D;
    if (nr <= 0.05) { toast('Khoảng offset lớn hơn bán kính'); syncPenBar(); return; }
    it = { ...JSON.parse(JSON.stringify(src)), id: M.uid() }; it.props.radius = nr;
  } else if (src.kind === 'road') {
    it = newItem('sketch', PEN.offsetOpen(src.pts, M.roadTotalWidth(src) / 2 + D, w).map((q) => [q[0], q[1], 0.5]), { color: S.opts.sketch.color, width: 2 / sc });
  } else if (isClosedItem(src) || (src.kind === 'sketch' && src.pts.length > 3 && G.dist(src.pts[0], src.pts[src.pts.length - 1]) < 1e-6)) {
    const ring = src.pts.map((q) => [q[0], q[1]]); if (G.dist(ring[0], ring[ring.length - 1]) < 1e-6) ring.pop();
    const o = PEN.offsetClosed(ring, D, w);
    it = src.kind === 'sketch' || src.kind === 'cad' ? { ...JSON.parse(JSON.stringify(src)), id: M.uid(), pts: fz(src.kind === 'sketch' ? o.concat([o[0]]) : o) } : newItem('sketch', o.concat([o[0]]).map((q) => [q[0], q[1], 0.5]), { color: S.opts.sketch.color, width: 2 / sc });
  } else {
    const op2 = PEN.offsetOpen(src.pts, D, w);
    it = canEdit(src) ? { ...JSON.parse(JSON.stringify(src)), id: M.uid(), pts: fz(op2) } : newItem('sketch', op2.map((q) => [q[0], q[1], 0.5]), { color: S.opts.sketch.color, width: 2 / sc });
    if (it.props && it.props.ctrl) delete it.props.ctrl;
  }
  checkpoint(); S.doc.items.push(it); changed(); syncPenBar();
  toast(`Đã offset ${G.fmtNum(D)} m · chạm đối tượng khác để offset tiếp`);
}
// ---- Extrude khối (2D): hình khép kín -> công trình cao H ----
function penExtrude(w, sc) {
  const H = S.opts.pen.H ?? 10;
  const ringOf = (i) => { if (isClosedItem(i)) return i.pts.map((q) => [q[0], q[1]]); if ((i.kind === 'sketch' || i.kind === 'cad') && i.pts.length > 3 && G.dist(i.pts[0], i.pts[i.pts.length - 1]) < 1e-6) return i.pts.slice(0, -1).map((q) => [q[0], q[1]]); return null; };
  if (!editOn('building')) { toast('Lớp Công trình chưa bật «Chỉnh sửa»: tích ô ✏ Chỉnh sửa trong hộp Công trình để Extrude'); return; }
  const hit = pickFor(w, sc, (i) => !!ringOf(i), false);
  if (!hit) { toast('Chạm vào một hình khép kín (nét vẽ khép kín, ô đất, vật liệu phủ…) hoặc một công trình'); return; }
  if (M.isLocked(S.doc, hit)) { lockedToast(); return; }
  const floors = Math.max(1, Math.round(H / 3.3)), floorH = +(H / floors).toFixed(3);
  checkpoint();
  if (hit.kind === 'building') { hit.props.floors = floors; hit.props.floorH = floorH; changed(); toast(`Công trình cao ${G.fmtNum(H)} m (${floors} tầng)`); return; }
  const b = newItem('building', ringOf(hit), { floors, floorH });
  S.doc.items.push(b); S.selectedId = b.id; changed(); renderProps();
  toast(`Đã extrude thành khối cao ${G.fmtNum(H)} m (${floors} tầng) · bật 3D để xem`);
}
// 3D: lệnh Extrude dùng công cụ Kéo mặt; bỏ lệnh thì về Sửa mặt
function syncPen3DTool() {
  if (!S.doc) return;
  const keep = { sel: S.facetSel, iso: S.isoFace }, back = () => { S.facetSel = keep.sel; S.isoFace = keep.iso; syncIsoBar(); renderToolOpts(); };
  if (penOn() && S.opts.pen.op === 'extrude' && S.mode === '3d' && S.tool !== 'push') { S.penPushFrom = S.tool; setTool('push'); back(); }
  else if (S.tool === 'push' && S.penPushFrom && !(penOn() && S.opts.pen.op === 'extrude')) { const t = S.penPushFrom; S.penPushFrom = null; setTool(t === 'facet' ? 'selface' : t); back(); }
}
// đỉnh gần điểm chạm nhất (mọi đối tượng có góc)
function nearestCorner(w, sc) {
  const tol = 18 / sc; let best = null;
  for (const it of S.doc.items) {
    if (!it.pts || !inIso(it) || ['junction', 'facet', 'icon', 'circle'].includes(it.kind) || !canEdit(it)) continue;
    if (it.kind === 'road') {
      if (!it.props.pis || it.props.ring) continue;
      const P = it.props.pis;
      for (let i = 1; i < P.length - 1; i++) { const d = G.dist(P[i], w); if (d <= tol && (!best || d < best.d)) best = { it, i, d, road: true }; }
      continue;
    }
    const closed = isClosedItem(it), P = it.pts;
    for (let i = closed ? 0 : 1; i < (closed ? P.length : P.length - 1); i++) { const d = G.dist(P[i], w); if (d <= tol && (!best || d < best.d)) best = { it, i, d, closed }; }
  }
  return best;
}
// giao lộ gần chỗ chạm; exact = chạm sát góc mép vỉa hè / bó vỉa của giao lộ (ưu tiên hơn đỉnh ô đất trùng chỗ)
function junctionAt(w, sc) {
  const near = 60 / sc, js = RO.junctionPoints(S.doc, { x0: w[0] - near * 3, y0: w[1] - near * 3, x1: w[0] + near * 3, y1: w[1] + near * 3 });
  let jc = null;
  for (const q of js) { const arms = RO.junctionArms(S.doc, q); if (arms.length < 2) continue; const ht = Math.max(...arms.map((a) => a.ht)); const d = G.dist(q, w); if (d < ht * 2.2 + near && (!jc || d < jc.d)) jc = { c: q, d }; }
  if (!jc) return null;
  const j = S.doc.items.find((i) => i.kind === 'junction' && G.dist(i.pts[0], jc.c) < 2) || { kind: 'junction', pts: [jc.c], props: { V: 0, R: 0, cs: [] } };
  const tol = Math.max(22 / sc, 2);
  jc.exact = RO.junctionCorners(S.doc, j).some((cr) => G.dist(cr.Q, w) < tol || G.dist(cr.P, w) < tol || (cr.chamfer && cr.chamfer.some((q) => G.dist(q, w) < tol)));
  return jc;
}
function penCorner(op, w, sc) {
  const p = S.opts.pen, val = op === 'fillet' ? p.R ?? 5 : p.V ?? 3;
  const jHit = editOn('road') ? junctionAt(w, sc) : null;
  const c = jHit && jHit.exact ? null : nearestCorner(w, sc);
  if (c) {
    if (M.isLocked(S.doc, c.it)) { lockedToast(); return; }
    const it = c.it;
    if (c.road) {
      checkpoint();
      const pr = it.props; delete pr.radiiEff;
      if (op === 'fillet') { pr.radii = (pr.radii || []).slice(); while (pr.radii.length < pr.pis.length - 2) pr.radii.push(0); pr.radii[c.i - 1] = val; }
      else { const r = PEN.chamferAt(pr.pis, c.i, false, val); if (!r) { toast('Góc này thẳng hàng, không vát được'); S.undo.pop(); return; } const radii = (pr.radii || []).slice(); radii.splice(c.i - 1, 1, 0, 0); pr.pis = r.pts; pr.radii = radii.slice(0, r.pts.length - 2); }
      setRoadGeometry(it); changed();
      toast(op === 'fillet' ? `Đã bo tim đường R = ${G.fmtNum(val)} m` : `Đã vát góc tim đường ${G.fmtNum(val)} m`);
      return;
    }
    const z = it.pts[0] && it.pts[0].length > 2 ? it.pts[0][2] : null;
    const P = it.pts.map((q) => [q[0], q[1]]);
    const r = op === 'fillet' ? PEN.filletAt(P, c.i, c.closed, val) : PEN.chamferAt(P, c.i, c.closed, val);
    if (!r) { toast('Góc này thẳng hàng, không ' + (op === 'fillet' ? 'bo' : 'vát') + ' được'); return; }
    checkpoint();
    it.pts = z != null ? r.pts.map((q) => [q[0], q[1], z]) : r.pts;
    if (it.kind === 'building' && it.props.preset) delete it.props.preset;
    changed();
    const lim = op === 'fillet' ? r.R < val - 0.01 : r.d < val - 0.01;
    toast((op === 'fillet' ? `Đã bo tròn R = ${G.fmtNum(r.R)} m` : `Đã vát góc ${G.fmtNum(r.d)} m`) + (lim ? ' (giới hạn theo độ dài cạnh)' : ''));
    return;
  }
  // góc giao lộ đường: bo bó vỉa (R) / vát vỉa hè (V) tại góc gần chỗ chạm
  const jc = jHit;
  if (!jc) { toast(op === 'fillet' ? 'Chạm gần một góc (đỉnh) của đối tượng hoặc góc giao lộ để bo tròn' : 'Chạm gần một góc (đỉnh) của đối tượng hoặc góc giao lộ để vát'); return; }
  let j = S.doc.items.find((i) => i.kind === 'junction' && G.dist(i.pts[0], jc.c) < 2);
  const isNew = !j;
  if (isNew) j = newItem('junction', [jc.c.slice()], { V: 0, R: 0, cs: [] });
  const cors = RO.junctionCorners(S.doc, j); if (!cors.length) { toast('Giao lộ này không có góc để chỉnh'); return; }
  const ang = Math.atan2(w[1] - jc.c[1], w[0] - jc.c[0]);
  cors.sort((a, b) => Math.abs(Math.atan2(Math.sin(a.bisAng - ang), Math.cos(a.bisAng - ang))) - Math.abs(Math.atan2(Math.sin(b.bisAng - ang), Math.cos(b.bisAng - ang))));
  const cor = cors[0];
  checkpoint();
  if (isNew) S.doc.items.push(j);
  const key = op === 'fillet' ? 'R' : 'V';
  j.props.cs = j.props.cs || [];
  let e = j.props.cs.find((y) => Math.abs(Math.atan2(Math.sin(y.ang - cor.bisAng), Math.cos(y.ang - cor.bisAng))) < 0.35);
  if (!e) { e = { ang: cor.bisAng }; j.props.cs.push(e); }
  e[key] = val;
  carveJunction(j);
  changed();
  toast(op === 'fillet' ? `Giao lộ: bo bó vỉa R = ${G.fmtNum(val)} m tại góc đã chạm` : `Giao lộ: vát vỉa hè ${G.fmtNum(val)} m tại góc đã chạm (lộ giới vát thật, ô đất bên cạnh được cắt góc)`);
}
// Góc vát vỉa hè cắt thật vào lộ giới: tam giác vát thuộc đất giao thông, ô đất / cây xanh / vật liệu phủ chồng lên thì cắt bỏ
function carveJunction(j, only = null) {
  const tris = RO.junctionCorners(S.doc, j).filter((c) => c.chamfer).map((c) => c.chamfer);
  let n = 0;
  for (const t of tris) {
    const tb = G.bbox(t);
    for (const it of only ? [only] : S.doc.items.slice()) {
      if (!['zone', 'park', 'cover'].includes(it.kind) || M.isLocked(S.doc, it) || !bbHit(G.bbox(it.pts), tb)) continue;
      const a0 = M.itemArea(it);
      const rest = ZO.booleanPolys([...zOps(it), { pts: t, add: false }]);
      const tot = rest.reduce((s2, q) => s2 + q.net, 0);
      if (tot > a0 - 0.05) continue;
      if (!rest.length) { S.doc.items = S.doc.items.filter((i) => i !== it); n++; continue; }
      setZonePoly(it, rest[0]); n++;
    }
  }
  return n;
}
function carveAllJunctions(only = null) { let n = 0; for (const j of S.doc.items.filter((i) => i.kind === 'junction')) n += carveJunction(j, only); return n; }

// ---------------- Thước đo khoảng cách ----------------
function measureSnap(w, sc) {
  const sn = AX.osnap(M.liveItems(S.doc).filter((i) => i.kind !== 'facet'), w, 14 / sc, null);
  return sn ? sn.q : w;
}
function measureLen(m) { let L = 0; for (let i = 1; i < m.pts.length; i++) L += G.dist(m.pts[i - 1], m.pts[i]); return L; }
function drawMeasure(ctx) {
  const m = S.measure; if (!m || !m.pts.length) return;
  const u = S.opts.measure.unit || 'm';
  const P = m.pts.map((q) => S.view.toScreen(q));
  ctx.save();
  ctx.strokeStyle = '#e11d48'; ctx.fillStyle = '#e11d48'; ctx.lineWidth = 2; ctx.setLineDash([]);
  ctx.beginPath(); P.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.stroke();
  for (const q of P) { ctx.beginPath(); ctx.arc(q[0], q[1], 4, 0, 7); ctx.fill(); }
  const label = (x, y, t, strong) => { ctx.font = `${strong ? 700 : 600} ${strong ? 14 : 12.5}px system-ui`; const tw = ctx.measureText(t).width; ctx.fillStyle = strong ? '#e11d48' : 'rgba(255,255,255,.94)'; ctx.fillRect(x - tw / 2 - 6, y - 11, tw + 12, 22); ctx.fillStyle = strong ? '#fff' : '#9f1239'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(t, x, y); };
  if (P.length > 2) for (let i = 1; i < P.length; i++) label((P[i - 1][0] + P[i][0]) / 2, (P[i - 1][1] + P[i][1]) / 2 - 12, PEN.fmtLen(G.dist(m.pts[i - 1], m.pts[i]), u), false);
  if (P.length >= 2) {
    const q = P[P.length - 1], L = measureLen(m);
    let t = (P.length > 2 ? 'Tổng ' : '') + PEN.fmtLen(L, u);
    if (P.length === 2) { const dx = m.pts[1][0] - m.pts[0][0], dy = m.pts[1][1] - m.pts[0][1]; t += `  ·  ΔX ${PEN.fmtLen(Math.abs(dx), u)}  ΔY ${PEN.fmtLen(Math.abs(dy), u)}`; }
    label(q[0], q[1] - 22, t, true);
  }
  ctx.restore();
}
function measureDown(base, w, sc) {
  const q = measureSnap(w, sc), m = S.measure, mode = S.opts.measure.mode || 'line';
  if (mode === 'line' || !m || m.done) S.measure = { pts: [q, q.slice()] };
  else m.pts.push(q.slice());
  drag = { ...base, kind: 'measure' }; requestRender('ov'); renderToolOpts();
}
function measureMove(w, sc) { const m = S.measure; if (!m) return; m.pts[m.pts.length - 1] = measureSnap(w, sc); requestRender('ov'); }
function measureUp(tap) {
  const m = S.measure; if (!m) return;
  const mode = S.opts.measure.mode || 'line';
  if (mode === 'line' && tap && m.pts.length === 2 && G.dist(m.pts[0], m.pts[1]) < 1e-6) { S.measure = null; requestRender('ov'); renderToolOpts(); return; }
  if (mode === 'pline' && m.pts.length >= 2 && G.dist(m.pts[m.pts.length - 1], m.pts[m.pts.length - 2]) < 1e-6) m.pts.pop(); // chạm: thêm điểm
  requestRender('ov'); renderToolOpts();
}

function renderToolOpts() {
  const box = $('#toolOpts'); box.innerHTML = '';
  if (S.baseEdit && S.mode === '2d') { renderBaseEditOpts(box); return; }
  const o = S.opts;
  const title = (t) => box.append(h(`<span class="title">${S.mode === '3d' ? '3D · ' : ''}${t}</span>`));
  const hint = (t) => box.append(h(`<span class="muted" style="font-size:12.5px">${t}</span>`));
  const toggle = (label, key, onMsg) => { const c = h(`<button class="chip ${o[key] ? 'on' : ''}">${label}</button>`); c.onclick = () => { o[key] = !o[key]; saveOpts(); renderToolOpts(); if (onMsg) toast(o[key] ? onMsg + ': bật' : onMsg + ': tắt'); }; box.append(c); };
  if (groupOf(S.tool) === 'land') box.append(editChk('land'));
  if (groupOf(S.tool) === 'land') { // công cụ Cảnh quan gộp: Cảnh quan / Cây xanh / Sông hồ
    const sg = h('<div class="seg lgrp"></div>');
    for (const [k, n] of TOOL_GROUPS.land.tools) { const b = h(`<button class="${S.tool === k ? 'on' : ''}">${n}</button>`); b.onclick = () => setTool(k); sg.append(b); }
    box.append(sg);
  }
  switch (S.tool) {
    case 'select': {
      title('Chọn');
      { const pk = o.selPick || 'top', sg = h('<div class="seg selpick"></div>');
        for (const [k, ic, n] of [['top', '<svg viewBox="0 0 24 24"><path d="M5 3l14 8-6 2-2 6z"/></svg>', 'Trên cùng'], ['list', '<svg viewBox="0 0 24 24"><path d="M4 5h16M4 12h16M4 19h16"/></svg>', 'Chọn trong danh sách'], ['box', '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="1" stroke-dasharray="3 2.5"/></svg>', 'Theo vùng chữ nhật']]) {
          const b = h(`<button class="${pk === k ? 'on' : ''}" title="${n}">${ic}<span>${n}</span></button>`); b.onclick = () => { o.selPick = k; saveOpts(); renderToolOpts(); }; sg.append(b);
        }
        box.append(sg); }
      for (const [k, n] of [['move', '✥ Di chuyển'], ['rotate', '⟳ Xoay']]) {
        const c = h(`<button class="chip ${o.selMode === k ? 'on' : ''}">${n}</button>`);
        c.onclick = () => { o.selMode = k; saveOpts(); renderToolOpts(); }; box.append(c);
      }
      toggle('🧲 Bắt điểm', 'snapMove', 'Bắt điểm khi di chuyển');
      toggle('∥ Song song đường', 'snapParallel', 'Xoay song song đường');
      hint({ list: 'Chạm vào chỗ có nhiều đối tượng chồng nhau: hiện danh sách để chọn đúng đối tượng cần chọn', box: 'Kéo bút thành khung chữ nhật: đối tượng nằm trọn trong khung được chọn · kéo một đối tượng đang chọn để dời cả nhóm' }[o.selPick] || (S.mode === '3d' ? 'Chạm khối để chọn · bút vuốt lên/xuống trên khối để đổi số tầng' : (o.selMode === 'rotate' ? 'Kéo trên công trình để xoay quanh tâm' : 'Chạm để chọn (đối tượng trên cùng) · kéo để di chuyển · kéo chấm tròn để sửa đỉnh')));
      break;
    }
    case 'footpath':
      title('Đường đi bộ');
      box.append(lbl('Bề rộng (m)', numInput(o.footpath.width, (v) => { o.footpath.width = Math.max(0.5, v); saveOpts(); })));
      for (const wv of [1.5, 2, 3, 5, 8]) { const c = h(`<button class="chip ${o.footpath.width === wv ? 'on' : ''}">${String(wv).replace('.', ',')} m</button>`); c.onclick = () => { o.footpath.width = wv; saveOpts(); renderToolOpts(); }; box.append(c); }
      hint('Chỉ có bề rộng, không có vỉa hè · Giữ bút ở cuối nét: đường thẳng; vẽ vòng kín rồi giữ: vòng tròn');
      break;
    case 'face':
      title('Tạo mặt trên khối');
      box.append(lbl('Số tầng khối mới', stepper(o.building.floors, 1, 1, (v) => { o.building.floors = v; saveOpts(); })));
      hint('Vẽ hình khép kín trên mái một công trình → tạo khối mới đặt trên mái (khối chồng). Chạm vào mái: phủ kín cả mặt trên. Dùng «Kéo khối» để đổi chiều cao');
      break;
    case 'facet': {
      title('Sửa mặt');
      if (S.mode !== '3d') { hint('Chuyển sang chế độ <b>3D</b> để chọn mặt khối'); break; }
      const mode = facetMode();
      if (S.facetSel) {
        box.append(h(`<span class="muted" style="font-size:12.5px">Mặt đang chọn: <b>${faceLabel(S.facetSel)}</b></span>`));
        box.append(lookBtn());
        const iso = h(`<label class="chk"><input type="checkbox" ${S.isoFace ? 'checked' : ''}> Khóa mặt</label>`); iso.querySelector('input').onchange = (e) => setIsoFace(e.target.checked); box.append(iso);
      }
      if (mode === 'pline' && S.faceDraft && S.faceDraft.kind === 'pline') {
        const ok = h(`<button class="chip on" ${S.faceDraft.pts.length < 3 ? 'disabled' : ''}>✓ Khép kín</button>`); ok.onclick = () => closePline(); box.append(ok);
        const cn = h('<button class="chip">✕ Huỷ</button>'); cn.onclick = () => { S.faceDraft = null; renderToolOpts(); draw3DOverlay(); }; box.append(cn);
      }
      hint(S.facetSel ? 'Vẽ, cắt, xoá nét, offset, extrude trên mặt: dùng thanh <b>Cọ vẽ</b> · chạm mặt khác để chọn' : 'Chạm mái hoặc mặt đứng để chọn mặt · vẽ trên mặt bằng thanh <b>Cọ vẽ</b>');
      break;
    }
    case 'push':
      title('Sửa mặt · Kéo mặt'); box.append(faceSwitchEl());
      if (S.facetSel) { const iso = h(`<label class="chk"><input type="checkbox" ${S.isoFace ? 'checked' : ''}> Khóa mặt (${faceLabel(S.facetSel)})</label>`); iso.querySelector('input').onchange = (e) => setIsoFace(e.target.checked); box.append(iso); box.append(lookBtn()); }
      else box.append(h('<span class="muted" style="font-size:12.5px">Muốn chỉ thao tác một mặt: bấm «Vẽ mặt khối», chạm chọn mặt, tích «Khóa mặt»</span>'));
      { const sg = h('<div class="seg"></div>'); const pm = (o.push && o.push.mode) || 'pos';
        for (const [k, n] of [['pos', '＋ Kéo dương (đùn ra)'], ['neg', '－ Kéo âm (ấn lõm)']]) { const b = h(`<button class="${pm === k ? 'on' : ''}">${n}</button>`); b.onclick = () => { o.push = { ...(o.push || {}), mode: k }; saveOpts(); renderToolOpts(); }; sg.append(b); }
        box.append(sg);
        if (pm === 'neg') hint('Kéo âm (3D): nhấn vào một mặt khối hoặc một mảng đã chia rồi kéo xuống để ấn lõm vào trong khối (hốc, lô gia, khoảng thông tầng); kéo lên để nông lại');
        else hint('Nhấn vào công trình rồi kéo lên để thêm tầng, kéo xuống để bớt tầng (bút, ngón tay hoặc chuột) · dùng được cả 2D và 3D · trong 3D nhấn vào một mảng mặt khối để đùn mảng đó');
      }
      break;
    case 'move':
      title('Di chuyển công trình');
      toggle('🧲 Bắt điểm', 'snapMove', 'Bắt điểm khi di chuyển');
      hint('Kéo bất kỳ công trình (hoặc đối tượng) nào để dời đi, không cần chọn trước · không vượt chỉ giới xây dựng');
      break;
    case 'check': {
      title('Kiểm tra chỉ tiêu');
      const V = (S.metrics && S.metrics.viol) || {};
      const bs = S.doc.items.filter((i) => i.kind === 'building' && V[i.id]);
      const nB = S.doc.items.filter((i) => i.kind === 'building').length;
      box.append(h(`<div class="chk-sum ${bs.length ? 'bad' : 'ok'}">${bs.length ? `⚠ ${bs.length} / ${nB} công trình vi phạm` : nB ? `✓ ${nB} công trình đạt chỉ tiêu` : 'Chưa có công trình'}</div>`));
      box.append(h('<span class="muted" style="font-size:12.5px">Công trình vi phạm khoảng lùi, mật độ xây dựng (MĐXD của lô), tầng cao tô đỏ, có nhãn ghi vi phạm · chạm một công trình để xem · chọn công cụ khác để trở về như cũ</span>'));
      if (bs.length) {
        const list = h('<div class="chk-list"></div>');
        for (const b of bs.slice(0, 40)) {
          const z = S.metrics.zoneOf && S.metrics.zoneOf[b.id];
          const r = h(`<button class="chk-row"><b>${esc(b.props.name || (b.props.floors || 1) + 'T')}${z ? ' · lô ' + esc(M.lotName(S.metrics, z)) : ''}</b><span>${V[b.id].map(esc).join(' · ')}</span></button>`);
          r.onclick = () => { const c = G.centroid(b.pts); S.view.cx = c[0]; S.view.cy = c[1]; requestRender(); if (S.mode === '3d' && v3) { const t = v3.controls.target, cam = v3.camera.position, dx = c[0] - t.x, dz = c[1] - t.z; t.x += dx; t.z += dz; cam.x += dx; cam.z += dz; v3.controls.update(); } };
          list.append(r);
        }
        box.append(list);
      }
      break;
    }
    case 'eraser': title('Xoá'); box.append(h(`<span class="muted" style="font-size:13px">Chạm hoặc quét bút qua đối tượng để xoá${S.mode === '3d' ? ' · trong 3D: chạm / quét qua nét vẽ trên mặt khối thì chỉ xoá nét đó' : ''}</span>`)); break;
    case 'road': {
      title('Đường'); box.append(editChk('road'));
      const sub = o.road.sub || 'type';
      { // hai nút con: Phân loại đường / Góc vát, bán kính
        const sg = h('<div class="seg road-sub"></div>');
        for (const [k, ic, n] of [['type', '<path d="M8 20L10.5 4M16 20L13.5 4"/><path d="M12 7v1.6M12 11.2v1.6M12 15.4V17"/>', 'Phân loại đường'], ['corner', '<path d="M4 20V11a7 7 0 0 1 7-7h9"/><path d="M4 20h0M9 20v-6l5-5h6"/>', 'Góc vát, bán kính']]) {
          const b = h(`<button class="${sub === k ? 'on' : ''}" data-sub="${k}"><svg viewBox="0 0 24 24" style="width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;vertical-align:-5px;margin-right:4px">${ic}</svg>${n}</button>`);
          b.onclick = () => { o.road.sub = k; o.road.fromLine = false; saveOpts(); renderToolOpts(); requestRender(); if (k === 'corner') startJunctionPick(); };
          sg.append(b);
        }
        box.append(sg);
      }
      if (sub === 'corner') {
        const b = h('<button class="chip">◯ Khoanh giao lộ</button>'); b.onclick = () => startJunctionPick(); box.append(b);
        const js = S.doc.items.filter((i) => i.kind === 'junction');
        if (js.length) box.append(h(`<span class="muted" style="font-size:12.5px">Bản vẽ có ${js.length} giao lộ đã chỉnh góc · chạm vào tâm giao lộ bằng công cụ Chọn để sửa lại</span>`));
        hint('Khoanh một giao lộ bằng bút: hộp thoại hiện giao lộ phóng to với các ô tròn. V = góc vát vỉa hè, R = bán kính bó vỉa lòng đường. Ô ở tâm áp dụng cho mọi góc, ô ở góc chỉ áp dụng góc đó');
        break;
      }
      { // phân loại đường theo cấp (QCVN 01:2021): chọn loại thì mặt cắt lấy theo loại
        const cl = h('<div class="road-cls"></div>');
        for (const [lv, ln] of Object.entries(RO.ROAD_LEVELS)) {
          const row = h(`<div class="rc-row"><span class="rc-lv">${ln}</span></div>`);
          for (const c of RO.ROAD_CLASSES.filter((x) => x.lvl === lv)) {
            const b = h(`<button class="chip ${o.road.cls === c.id ? 'on' : ''}" title="Lòng đường ${G.fmtNum(c.width)} m · vỉa hè ${G.fmtNum(c.sidewalk)} m">${c.id}. ${c.name.replace(/^Đường /, '')}</button>`);
            b.onclick = () => { o.road.cls = c.id; o.road.width = c.width; o.road.sidewalk = c.sidewalk; saveOpts(); renderToolOpts(); };
            row.append(b);
          }
          cl.append(row);
        }
        box.append(cl);
      }
      box.append(lbl('Lòng đường (m)', numInput(o.road.width, (v) => { o.road.width = v; saveOpts(); })));
      box.append(lbl('Vỉa hè mỗi bên (m)', numInput(o.road.sidewalk, (v) => { o.road.sidewalk = v; saveOpts(); })));
      box.append(lbl('Bán kính cong tối thiểu (m)', numInput(o.road.minR, (v) => { o.road.minR = Math.max(5, v); saveOpts(); })));
      { // tạo đường theo nét line / polyline; cắt đường
        const fl = h(`<button class="chip ${o.road.fromLine ? 'on' : ''}" data-act="fromLine">⤳ Tạo đường theo line / polyline</button>`);
        fl.onclick = () => { o.road.fromLine = !o.road.fromLine; saveOpts(); renderToolOpts(); requestRender(); };
        box.append(fl);
      }
      const cn = RO.roadClass(o.road.cls);
      if (o.road.fromLine) hint(`Chạm vào một nét line / polyline (nét CAD, nét DXF đã nhập hoặc nét vẽ bằng Cọ vẽ): nét đó làm tim, tạo ${cn ? cn.name.toLowerCase() : 'đường'} lòng ${G.fmtNum(o.road.width)} m, vỉa hè ${G.fmtNum(o.road.sidewalk)} m · bấm lại nút để thôi`);
      else hint((cn ? cn.name + ' · ' : '') + penHint('Tuyến tự nắn thành đoạn thẳng + cung tròn bán kính chẵn · Giữ bút ở cuối nét: đường thẳng; vẽ vòng kín rồi giữ: đường tròn'));
      break;
    }
    case 'building': {
      title('Công trình'); box.append(editChk('building'));
      box.append(lbl('Số tầng', stepper(o.building.floors, 1, 1, (v) => { o.building.floors = v; saveOpts(); })));
      { const cs = h('<div class="chips bcol"><span class="muted" style="font-size:13px">Màu khối mới</span></div>'); const d0 = h(`<button class="chip ${!o.building.color ? 'on' : ''}">Mặc định</button>`); d0.onclick = () => { o.building.color = ''; saveOpts(); renderToolOpts(); }; cs.append(d0);
        for (const c of TONES.slice(0, 10)) { const b = h(`<button class="chip" style="width:28px;background:${c};${o.building.color === c ? 'box-shadow:0 0 0 3px #fff inset,0 0 0 2px #1d4ed8' : ''}" aria-label="Màu ${c}"></button>`); b.onclick = () => { o.building.color = c; saveOpts(); renderToolOpts(); }; cs.append(b); }
        const pk = h(`<input type="color" value="${o.building.color || '#ffffff'}" style="width:34px;height:30px;border:0;background:none" aria-label="Màu khác">`); pk.onchange = () => { o.building.color = pk.value; saveOpts(); renderToolOpts(); }; cs.append(pk); box.append(cs); }
      { const auto = !penShape(); const c = h(`<button class="chip ${auto ? 'on' : ''}" data-act="bauto">Tự động</button>`);
        c.onclick = () => { if (!auto) { S.opts.pen.shape = null; S.opts.pen.op = null; saveOpts(); syncPenBar(); renderToolOpts(); } }; box.append(c); }
      hint(penHint('Tự động: góc gần vuông thì bẻ vuông, còn lại thành đa giác lồi cạnh thẳng'));
      break;
    }
    case 'autolay': {
      title('Xếp khối tự động');
      const ao = o.autolay; ao.p = ao.p || {};
      const z = S.autoZone && (S.doc.items.find((i) => i.id === S.autoZone) || (S.autoSrc && S.autoSrc.id === S.autoZone ? S.autoSrc.zone : null));
      const zt = z ? AL.defaultType(z.props.code, M.LANDUSE[z.props.code]) : null;
      const sg = h('<div class="seg"></div>');
      for (const [k, n] of [['auto', 'Theo mã đất' + (z && zt ? ' (' + AL.TYPES[zt].name + ')' : '')], ...Object.entries(AL.TYPES).map(([k2, v]) => [k2, v.name])]) {
        const b = h(`<button class="${ao.type === k ? 'on' : ''}">${n}</button>`);
        b.onclick = () => { ao.type = k; saveOpts(); rerunAuto(); renderToolOpts(); };
        sg.append(b);
      }
      box.append(sg);
      const ty = ao.type === 'auto' ? zt || 'lk' : ao.type;
      const P = { ...AL.TYPES[ty].defaults, ...(ao.p[ty] || {}) };
      const setP = (k, v) => { ao.p[ty] = { ...(ao.p[ty] || {}), [k]: v }; saveOpts(); rerunAuto(); };
      const num = (k, t) => box.append(lbl(t, numInput(P[k], (v) => setP(k, v))));
      if (ty === 'lk') { num('w', 'Rộng lô (m)'); num('d', 'Sâu lô (m)'); box.append(lbl('Số tầng', stepper(P.floors, 1, 1, (v) => setP('floors', v)))); num('brk', 'Ngắt dãy mỗi (m)'); num('back', 'Hai dãy quay lưng cách (m)'); num('lane', 'Đường nội bộ giữa cụm (m)'); }
      if (ty === 'bt') { num('w', 'Rộng lô (m)'); num('d', 'Sâu lô (m)'); box.append(lbl('Số tầng', stepper(P.floors, 1, 1, (v) => setP('floors', v)))); num('cov', 'Mật độ trong lô (%)'); num('front', 'Lùi trước (m)'); num('side', 'Lùi các phía khác (m)'); num('lane', 'Đường nội bộ giữa cụm (m)'); }
      if (ty === 'lk' || ty === 'bt') { const c = h(`<label class="chk"><input type="checkbox" ${P.ends !== false ? 'checked' : ''}> Nhà đầu hồi quay ra đường hai đầu dãy</label>`); c.querySelector('input').onchange = (e) => setP('ends', e.target.checked); box.append(c); }
      const fitChk = () => { const c = h(`<label class="chk"><input type="checkbox" ${P.fit ? 'checked' : ''}> Giữ trong chỉ tiêu của ô (tự hạ tầng, thu mỏng)</label>`); c.querySelector('input').onchange = (e) => setP('fit', e.target.checked); box.append(c); };
      if (ty === 'cc') {
        const fs = h('<div class="seg"></div>');
        for (const [k, n] of Object.entries(AL.FORMS)) { const b = h(`<button class="${P.form === k ? 'on' : ''}">${n}</button>`); b.onclick = () => { setP('form', k); renderToolOpts(); }; fs.append(b); }
        box.append(lbl('Bố cục', fs));
        box.append(lbl('Số tầng', stepper(P.floors, 1, 1, (v) => setP('floors', v))));
        if ((P.form || 'san') === 'san') { num('grid', 'Lưới đường mỗi (m, 0 = không)'); num('roadW', 'Đường rộng (m)'); num('grp', 'Cỡ nhóm (m)'); num('gap', 'Nhóm cách nhau (m)'); num('t', 'Nhà rộng (m)'); num('tBig', 'Cạnh giáp đường lớn (m)'); num('park', 'Công viên (% đất)'); num('dens', 'Mật độ mục tiêu (%)'); }
        else num('t', 'Chiều dày nhà (m)');
        num('sb', 'Khoảng lùi tối thiểu (m)'); fitChk();
      }
      if (ty === 'hh') { box.append(lbl('Số tầng', stepper(P.floors, 1, 1, (v) => setP('floors', v)))); num('grid', 'Lưới đường mỗi (m, 0 = không)'); num('roadW', 'Đường rộng (m)'); num('park', 'Công viên (% đất)'); num('dens', 'Mật độ mục tiêu (%)'); num('grp', 'Cỡ nhóm (m)'); num('gap', 'Nhóm cách nhau (m)'); num('t', 'Nhà rộng (m)'); num('tBig', 'Cạnh giáp đường lớn (m)'); num('sb', 'Khoảng lùi tối thiểu (m)'); fitChk(); }
      if (ty === 'cn') {
        num('grid', 'Lưới đường mỗi (m)'); num('roadW', 'Đường rộng (m)');
        { const c = h(`<label class="chk"><input type="checkbox" ${P.park !== false ? 'checked' : ''}> Thửa giữa làm công viên cây xanh</label>`); c.querySelector('input').onchange = (e) => setP('park', e.target.checked); box.append(c); }
        num('fw', 'Nhà xưởng dài (m)'); num('fd', 'Nhà xưởng rộng (m)'); num('gap', 'Khoảng cách giữa xưởng (m)');
        box.append(lbl('Tầng khối chính', stepper(P.floors, 1, 1, (v) => setP('floors', v)))); box.append(lbl('Tầng khối phụ', stepper(P.auxF, 1, 1, (v) => setP('auxF', v))));
        num('sbMain', 'Lùi khối chính (m)'); num('sb', 'Lùi khối phụ (m)');
        const c = h(`<label class="chk"><input type="checkbox" ${P.aux !== false ? 'checked' : ''}> Khối phụ trợ trước mỗi xưởng</label>`); c.querySelector('input').onchange = (e) => setP('aux', e.target.checked); box.append(c);
      }
      if (ty === 'cong') { box.append(lbl('Số tầng', stepper(P.floors, 1, 1, (v) => setP('floors', v)))); num('t', 'Chiều dày nhà (m)'); num('sb', 'Khoảng lùi tối thiểu (m)'); }
      const rp = h(`<label class="chk"><input type="checkbox" ${ao.replace !== false ? 'checked' : ''}> Thay các công trình cũ trong ô</label>`);
      rp.querySelector('input').onchange = (e) => { ao.replace = e.target.checked; saveOpts(); };
      box.append(rp);
      const r = S.autoRes;
      if (z && r) {
        box.append(h(`<div class="chk-sum ${r.notes.some((x) => /vượt|không đủ/.test(x)) ? 'bad' : 'ok'}">Lô ${esc(M.lotName(S.metrics, z))}: ${r.grid ? `${r.grid.roads} đường, ${r.grid.plots} thửa${r.grid.park ? ', 1 công viên' : ''} · ` : ''}${r.pieces.length} khối · MĐXD ${G.fmtNum(r.mdxd, 1)}% · HSSDĐ ${G.fmtNum(r.far, 2)} · cao nhất ${r.maxFloors}T</div>`));
        if (r.notes.length) box.append(h(`<span class="muted" style="font-size:12.5px">${r.notes.map(esc).join(' · ')}</span>`));
        const un = h('<button class="chip">✕ Bỏ khối vừa xếp</button>');
        un.onclick = () => { checkpoint(); clearAuto(z.id); S.autoZone = null; S.autoRes = null; S.autoSrc = null; changed(); renderToolOpts(); };
        box.append(un);
      }
      box.append(h('<span class="muted" style="font-size:12.5px">Chạm vào một ô đất để tự xếp công trình theo chức năng · đổi thông số thì ô vừa chọn được xếp lại · hoàn tác bằng ↶</span>'));
      break;
    }
    case 'preset': {
      title('Khối mẫu');
      const wrap = h('<div class="presets" style="grid-template-columns:repeat(8,1fr)"></div>');
      for (const [k, p] of Object.entries(M.PRESETS)) {
        const b = h(`<button class="${o.preset.type === k ? 'on' : ''}">${presetIcon(k)}${p.name}</button>`);
        b.onclick = () => { o.preset.type = k; saveOpts(); renderToolOpts(); };
        wrap.append(b);
      }
      box.append(wrap);
      box.append(lbl('Khoảng lùi (m)', numInput(o.preset.setback, (v) => { o.preset.setback = v; saveOpts(); })));
      box.append(lbl('Số tầng', stepper(o.building.floors, 1, 1, (v) => { o.building.floors = v; saveOpts(); })));
      box.append(h('<span class="muted" style="font-size:12.5px">Chạm vào bản vẽ để đặt khối · đặt gần đường sẽ tự xoay theo đường và lùi đúng khoảng lùi</span>'));
      break;
    }
    case 'water':
      title('Cọ sông hồ');
      box.append(h('<span class="muted" style="font-size:13px">Nét khép kín → hồ · nét hở → sông</span>'));
      box.append(lbl('Rộng sông (m)', numInput(o.water.width, (v) => { o.water.width = v; saveOpts(); })));
      box.append(lbl('Hành lang bảo vệ (m)', numInput(o.water.setback, (v) => { o.water.setback = v; saveOpts(); })));
      break;
    case 'park': title('Cọ cây xanh'); box.append(h('<span class="muted" style="font-size:13px">Tô hoặc khoanh vùng không gian xanh</span>')); break;
    case 'zone': {
      title('SDĐ'); box.append(editChk('zone'));
      const br = o.zone.brush || 'basic';
      const brushes = h('<div class="brushes"></div>');
      for (const [k, n, ic] of [['basic', 'SDĐ cơ bản', '<path d="M4 4h16v16H4z" fill="currentColor" fill-opacity=".25"/><path d="M4 4h16v16H4z"/>'], ['split', 'Chia SDĐ', '<path d="M3 4h18v16H3z" fill="currentColor" fill-opacity=".2"/><path d="M9 2l6 20" stroke-dasharray="3 2" stroke-width="2.4"/>'], ['merge', 'Nhập SDĐ', '<path d="M3 6h10v12H3z" fill="currentColor" fill-opacity=".25"/><path d="M13 9h8v6h-8"/><path d="M13 12h7M17 9l3 3-3 3"/>']]) {
        const b = h(`<button class="${br === k ? 'on' : ''}"><svg viewBox="0 0 24 24">${ic}</svg>${n}</button>`);
        b.onclick = () => { o.zone.brush = k; saveOpts(); renderToolOpts(); }; brushes.append(b);
      }
      box.append(brushes);
      box.append(h('<span class="brk"></span>'));
      { // loại hình quy hoạch + cách ghi mã (bảng mã, màu theo đề cương QP-17)
        const st = S.doc.settings, cur = M.luPlanOf(S.doc);
        const setLu = (f, v) => { checkpoint(); st[f] = v; M.applyLanduse(S.doc); if (!M.LANDUSE[o.zone.code]) o.zone.code = 'ODT'; saveOpts(); changed(); renderToolOpts(); renderProps(); };
        const by = h('<div class="seg lu-by"></div>');
        for (const [k, n] of Object.entries(M.LU_BY)) { const b = h(`<button class="${cur.by === k ? 'on' : ''}">${n}</button>`); b.onclick = () => setLu('luBy', k); by.append(b); }
        const pl = h('<div class="seg lu-plan"></div>');
        for (const [k, n] of Object.entries(M.LU_PLANS)) { const b = h(`<button class="${cur.plan === k ? 'on' : ''}">${n}</button>`); b.onclick = () => setLu('luPlan', k); pl.append(b); }
        box.append(by, pl);
      }
      { const grid = h('<div class="lu-grid"></div>');
        const sel = M.LANDUSE[o.zone.code], selG = sel ? sel.lbl + '|' + sel.name + '|' + sel.color : '';
        for (const k of M.luChoices()) {
          const lu = M.LANDUSE[k], on = lu.lbl + '|' + lu.name + '|' + lu.color === selG;
          const c = h(`<button class="chip ${on ? 'on' : ''}" title="${esc(lu.name)}" data-code="${k}" style="touch-action:none"><span class="sw" style="background:${lu.color}"></span>${esc(lu.lbl)}</button>`);
          chipDrag(c, k);
          grid.append(c);
        }
        box.append(grid);
        requestAnimationFrame(() => { const on = grid.querySelector('.chip.on'); if (on) on.scrollIntoView({ block: 'nearest' }); });
      }
      { const add = h('<button class="chip add">🎨 Đổi màu / thêm chức năng</button>'); add.onclick = () => openLanduseDialog(o.zone.code); box.append(add); }
      box.append(lbl('Khoảng lùi (m)', numInput(o.zone.setback, (v) => { o.zone.setback = v; saveOpts(); })));
      { const c = h(`<button class="chip ${S.doc.settings.showBuildLine !== false ? 'on' : ''}">Hiện chỉ giới XD</button>`); c.onclick = () => { S.doc.settings.showBuildLine = S.doc.settings.showBuildLine === false; changed(); renderToolOpts(); }; box.append(c); }
      box.append(gapRow());
      if (!M.LANDUSE[o.zone.code]) o.zone.code = 'ODT';
      hint({
        basic: `${M.luLabel(o.zone.code)} – ${M.LANDUSE[o.zone.code].name} · Khoanh vùng khép kín (tự cắt bỏ phần đường, sông) · hoặc vẽ nét hở nối hai mép đường để khép vùng nhỏ hơn · chạm vào ô trống hay kéo thả mã vào vùng khép kín để tô`,
        split: 'Vẽ nét cắt xuyên qua ô đất (từ mép này sang mép kia) để chia thành nhiều ô · một nét có thể cắt nhiều ô',
        merge: 'Bắt đầu nét trong ô đất cần mở rộng rồi khoanh phần đất thêm vào · kéo nét từ ô này sang ô bên cạnh để nhập hai ô thành một',
      }[br]);
      break;
    }
    case 'land': {
      title('Cọ cảnh quan');
      const st = o.land.style || 'row';
      for (const [k, L] of Object.entries(M.LAND_STYLES)) {
        const c = h(`<button class="chip ${st === k ? 'on' : ''}" ${M.LAND_CLOSED[k] ? 'style="touch-action:none"' : ''}>${M.LAND_CLOSED[k] ? '<span class="sw" style="background:' + M.LAND_COLORS[k] + '"></span>' : ''}${L.name}</button>`);
        if (M.LAND_CLOSED[k]) landChipDrag(c, k); else c.onclick = () => { o.land.style = k; saveOpts(); renderToolOpts(); };
        box.append(c);
      }
      if (st === 'row' || st === 'grove') {
        box.append(h('<span class="brk"></span>'));
        box.append(h('<span class="muted" style="font-size:12.5px">Mật độ:</span>'));
        for (const [n, sp] of [['Thưa', 14], ['Vừa', 9], ['Dày', 5]]) { const c = h(`<button class="chip ${o.land.spacing === sp ? 'on' : ''}">${n}</button>`); c.onclick = () => { o.land.spacing = sp; saveOpts(); renderToolOpts(); }; box.append(c); }
        box.append(lbl('Khoảng cách (m)', stepper(o.land.spacing, 2, 1, (v) => { o.land.spacing = v; saveOpts(); })));
      }
      if (st === 'row' || st === 'grove' || st === 'tree') {
        box.append(lbl('Tán cây (m)', stepper(o.land.size, 2, 1, (v) => { o.land.size = v; saveOpts(); })));
        if (st !== 'tree') { const c = h(`<button class="chip ${o.land.vary ? 'on' : ''}">${o.land.vary ? '✓ ' : ''}Cây to nhỏ khác nhau</button>`); c.onclick = () => { o.land.vary = !o.land.vary; saveOpts(); renderToolOpts(); }; box.append(c); }
        box.append(h('<span class="brk"></span>'));
        treeLibChips(box, o.land.tree || 'round', (k) => { o.land.tree = k; saveOpts(); renderToolOpts(); });
      }
      hint(M.LAND_STYLES[st].hint + (M.LAND_CLOSED[st] ? ' · hoặc kéo thả nút ' + M.LAND_STYLES[st].name + ' vào vùng khép kín (giữa đường, công trình, mép ô đất)' : '') + ' · thuộc lớp Cảnh quan');
      break;
    }
    case 'circle':
      title('Vòng tròn bán kính phục vụ');
      for (const r of [300, 500, 800, 1000]) {
        const c = h(`<button class="chip ${o.circle.radius === r ? 'on' : ''}">R = ${r} m</button>`);
        c.onclick = () => { o.circle.radius = r; saveOpts(); renderToolOpts(); };
        box.append(c);
      }
      styleOpts(box, o.circle, [['Mảnh', 1], ['Vừa', 2], ['Đậm', 4], ['Rất đậm', 7]]);
      box.append(h('<span class="muted" style="font-size:12.5px">Chạm để đặt, hoặc kéo để chọn bán kính</span>'));
      break;
    case 'arrow': title('Mũi tên đặc'); styleOpts(box, o.arrow, [['Mảnh', 4], ['Vừa', 8], ['Đậm', 14], ['Rất đậm', 22]]); hint('Trục động lực, hướng tiếp cận, hướng nhìn'); break;
    case 'flow': title('Mũi tên nét đứt'); styleOpts(box, o.flow, [['Mảnh', 1.5], ['Vừa', 3], ['Đậm', 6], ['Rất đậm', 10]]); hint('Kết nối tương lai, luồng sinh thái, hướng gió'); break;
    case 'icon': {
      title('Biểu tượng');
      const wrap = h('<div class="icon-grid"></div>');
      for (const k of ICON_KEYS) {
        const b = h(`<button class="${o.icon.sym === k ? 'on' : ''}" title="${IC[k].name}"><canvas width="56" height="56"></canvas><span>${IC[k].name}</span></button>`);
        drawIconAt(b.querySelector('canvas').getContext('2d'), k, 28, 28, 44, o.icon.color || '');
        b.onclick = () => { o.icon.sym = k; saveOpts(); renderToolOpts(); }; wrap.append(b);
      }
      box.append(wrap);
      box.append(lbl('Kích thước (m)', stepper(o.icon.size, 2, 5, (v) => { o.icon.size = v; saveOpts(); })));
      box.append(lbl('Cách mặt đất (m)', stepper(o.icon.elev ?? 4, 0, 1, (v) => { o.icon.elev = v; saveOpts(); })));
      { const c1 = h(`<label class="chk"><input type="checkbox" ${o.icon.showLabel !== false ? 'checked' : ''}> Hiện nhãn</label>`); c1.querySelector('input').onchange = (e) => { o.icon.showLabel = e.target.checked; saveOpts(); }; box.append(c1);
        const c2 = h(`<label class="chk"><input type="checkbox" ${o.icon.askInk ? 'checked' : ''}> Viết nhãn bằng bút ngay khi đặt</label>`); c2.querySelector('input').onchange = (e) => { o.icon.askInk = e.target.checked; saveOpts(); }; box.append(c2); }
      colorChips(box, o.icon.color, (c) => { o.icon.color = c; saveOpts(); renderToolOpts(); }, true);
      hint('Chạm vào bản vẽ để đặt biểu tượng · chọn biểu tượng rồi kéo để di chuyển');
      break;
    }
    case 'tour': {
      title('Tour route · lộ trình tham quan');
      box.append(lbl('Tốc độ (km/h)', stepper(o.tour.speed, 1, 1, (v) => { o.tour.speed = v; saveOpts(); })));
      box.append(lbl('Tầm mắt (m)', stepper(o.tour.eye, 0.5, 0.1, (v) => { o.tour.eye = Math.round(v * 10) / 10; saveOpts(); })));
      const ts = S.doc ? S.doc.items.filter((i) => i.props && i.props.tour) : [];
      ts.forEach((t, k) => { const b = h(`<button class="chip">▶ ${esc(t.props.label || 'Tour route')} ${ts.length > 1 ? k + 1 : ''} · ${G.fmtNum(tourLen(t.pts))} m</button>`); b.onclick = () => startTour(t); box.append(b); });
      hint('Vẽ một tuyến bằng bút (tuyến đi bộ, tham quan) · chạm vào tuyến đã vẽ để đi theo lộ trình ở góc nhìn người đi bộ');
      break;
    }
    case 'cloud': title('Vùng mây'); box.append(h('<span class="muted" style="font-size:13px">Khoanh giai đoạn đầu tư, ranh giải phóng mặt bằng</span>')); break;
    case 'measure': {
      title('Thước đo');
      const mo = o.measure;
      const md = h('<div class="seg ms-mode"></div>');
      for (const [k, n] of [['line', '⟷ Hai điểm'], ['pline', '⤳ Nhiều điểm (cộng dồn)']]) { const b = h(`<button class="${(mo.mode || 'line') === k ? 'on' : ''}">${n}</button>`); b.onclick = () => { mo.mode = k; S.measure = null; saveOpts(); renderToolOpts(); requestRender('ov'); }; md.append(b); }
      const un = h('<div class="seg ms-unit"></div>');
      for (const k of Object.keys(PEN.UNITS)) { const b = h(`<button class="${(mo.unit || 'm') === k ? 'on' : ''}" data-unit="${k}">${k}</button>`); b.onclick = () => { mo.unit = k; saveOpts(); renderToolOpts(); requestRender('ov'); }; un.append(b); }
      box.append(md, lbl('Đơn vị', un));
      const m = S.measure;
      if (m && m.pts.length >= 2) {
        const L = measureLen(m);
        box.append(h(`<span class="ms-res"><b>${PEN.fmtLen(L, mo.unit)}</b>${m.pts.length > 2 ? ` · ${m.pts.length - 1} đoạn` : ''}${m.pts.length >= 3 ? ` · diện tích khép kín ${G.fmtArea(G.area(m.pts))}` : ''}</span>`));
        const cl = h('<button class="chip">✕ Xoá số đo</button>'); cl.onclick = () => { S.measure = null; renderToolOpts(); requestRender('ov'); }; box.append(cl);
        if ((mo.mode || 'line') === 'pline') { const dn = h('<button class="chip">✓ Đo lần mới</button>'); dn.onclick = () => { if (S.measure) S.measure.done = true; renderToolOpts(); }; box.append(dn); }
      }
      hint((mo.mode || 'line') === 'pline' ? 'Chạm lần lượt các điểm (hoặc kéo từng đoạn): cộng dồn chiều dài · điểm tự bắt vào đỉnh, trung điểm, tâm' : 'Kéo bút từ điểm đầu tới điểm cuối để đo · điểm tự bắt vào đỉnh, trung điểm, tâm');
      break;
    }
    case 'cover': {
      title('Vật liệu phủ');
      const co = o.cover; const by = co.by || 'mat';
      const sg = h('<div class="seg"></div>');
      for (const [k, n] of [['mat', 'Vật liệu mẫu'], ['color', 'Màu đơn']]) { const b = h(`<button class="${by === k ? 'on' : ''}">${n}</button>`); b.onclick = () => { co.by = k; saveOpts(); renderToolOpts(); }; sg.append(b); }
      box.append(sg);
      if (by === 'color') colorChips(box, co.color, (c) => { co.color = c; saveOpts(); renderToolOpts(); });
      else {
        const grid = h('<div class="mat-grid"></div>');
        for (const m of MT.allMats(S.doc)) {
          const b = h(`<button class="mat ${co.mat === m.id ? 'on' : ''}" title="${esc(m.name)}"><span class="sw" style="background:${m.color || '#ccc'}"></span><span>${esc(m.name)}</span></button>`);
          const th = MT.matThumb(S.doc, m.id); if (th) b.querySelector('.sw').style.backgroundImage = `url(${th})`;
          b.onclick = () => { co.mat = m.id; saveOpts(); renderToolOpts(); };
          if (m.user) { const x = h('<i class="mat-x" title="Bỏ mẫu này">✕</i>'); x.onclick = (e) => { e.stopPropagation(); if (!confirmMatDelete(m)) return; }; b.append(x); }
          grid.append(b);
        }
        const add = h('<button class="mat add"><span class="sw">＋</span><span>Thêm ảnh mẫu</span></button>'); add.onclick = () => addMatFromPhoto(); grid.append(add);
        box.append(grid);
        const m = MT.findMat(S.doc, co.mat);
        box.append(lbl('Tỉ lệ mẫu (m mỗi ô)', stepper(co.scale || (m && m.scale) || 1, 0.1, 0.1, (v) => { co.scale = Math.round(v * 100) / 100; saveOpts(); })));
        box.append(lbl('Xoay mẫu (°)', stepper(co.ang || 0, -360, 15, (v) => { co.ang = v; saveOpts(); })));
      }
      hint('Chạm bút vào một vùng khép kín (giới hạn bởi đường, ô đất, công trình, nét nháp…) để phủ cả vùng; hoặc khoanh một vùng bằng bút · chạm vào vùng đã phủ để thay vật liệu');
      break;
    }
  }
  if (S.tool === 'cover' || (S.tool === 'land' && M.LAND_CLOSED[S.opts.land.style || 'row'])) box.append(gapRow());
  if (S.mode === '3d') hint('Vẽ bằng bút lên mặt đất · ngón tay: xoay/kéo/thu phóng · chuột phải: xoay');
  if (DRAW_TOOLS.has(S.tool) && !penOn()) { const c = h('<button class="chip" data-act="openpen">✎ Kiểu nét, hình, bắt điểm, trục vẽ: mở Cọ vẽ</button>'); c.onclick = () => togglePenBar(true); box.append(c); }
  panelChrome(box, 'opts', (box.querySelector('.title') || {}).textContent || 'Tuỳ chọn công cụ');
  requestAnimationFrame(fitOpts);
}
// bảng tuỳ chọn bên phải: dừng phía trên bảng Chỉ tiêu quy hoạch
function fitOpts() {
  const o = $('#toolOpts'), m = $('#hud'); if (!o || !o.offsetParent) return;
  if (dimsOf(PANEL.opts || {}, 'opts').h) return;
  if (!portrait()) { o.style.maxHeight = ''; return; }
  const or = o.getBoundingClientRect(), mr = m && m.offsetParent ? m.getBoundingClientRect() : null;
  o.style.maxHeight = mr && mr.width && mr.left < or.right && mr.right > or.left && mr.top > or.top ? Math.max(140, mr.top - or.top - 10) + 'px' : '';
}
if (window.ResizeObserver) new ResizeObserver(() => fitOpts()).observe($('#hud'));
window.addEventListener('resize', () => requestAnimationFrame(fitOpts));

// ---------------- Bảng nổi: thu gọn + kéo di chuyển ----------------
// bảng tuỳ chọn công cụ: cỡ kéo giãn nhớ riêng cho iPad dọc và iPad ngang
function dimsOf(st, key) { return key === 'opts' && !portrait() ? st.L || (st.L = {}) : st; }
function panelState(el, st) {
  el.classList.toggle('collapsed', !!st.min);
  // nút mở lại luôn hiện khi thu gọn (không phụ thuộc cấu trúc bên trong bảng)
  let ro = el.querySelector(':scope > .preopen');
  if (st.min && !ro) { ro = h(`<button class="preopen">▴ ${esc(el.dataset.title || 'Mở lại')}</button>`); ro.onclick = (e) => { e.stopPropagation(); st.min = false; savePanels(); panelState(el, st); }; el.append(ro); }
  if (!st.min && ro) ro.remove();
  const mn = el.querySelector('.pmin'); if (mn) { mn.textContent = st.min ? '▴' : '▾'; mn.title = st.min ? 'Mở rộng' : 'Thu gọn'; }
  const dm = dimsOf(st, el.dataset.pkey);
  if (dm.w) el.style.width = dm.w + 'px'; else el.style.width = '';
  if (dm.h) { el.style.height = dm.h + 'px'; } else el.style.height = '';
  placeRz(el);
  if (st.x != null && el.offsetParent && el.dataset.pkey !== 'opts') {
    const pr = el.offsetParent.getBoundingClientRect();
    el.style.left = Math.max(0, Math.min(pr.width - 60, st.x)) + 'px'; el.style.top = Math.max(0, Math.min(pr.height - 40, st.y)) + 'px';
    el.style.right = 'auto'; el.style.bottom = 'auto';
    if (el.id === 'props' || el.id === 'pop') el.style.maxHeight = st.h ? 'none' : Math.max(160, pr.height - parseFloat(el.style.top) - 10) + 'px';
  } else { el.style.left = el.style.top = el.style.right = el.style.bottom = ''; el.style.maxHeight = dm.h ? 'none' : ''; }
}
// Kéo giãn bảng / hộp thoại ở cạnh trái, phải, dưới (bút lại gần cạnh: hiện biểu tượng co kéo)
const RZ_ICON = { e: '<path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4"/>', w: '<path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4"/>', s: '<path d="M12 4v16M8 8l4-4 4 4M8 16l4 4 4-4"/>', se: '<path d="M6 6l12 12M6 12V6h6M18 12v6h-6"/>', sw: '<path d="M18 6L6 18M18 12V6h-6M6 12v6h6"/>' };
function rzTip(x, y, z) {
  let t = document.getElementById('rzTip');
  if (!z) { if (t) t.hidden = true; return; }
  if (!t) { t = h('<div id="rzTip"></div>'); document.body.append(t); }
  t.innerHTML = `<svg viewBox="0 0 24 24">${RZ_ICON[z]}</svg>`; t.hidden = false; t.style.left = x + 'px'; t.style.top = y + 'px';
}
function portrait() { return matchMedia('(orientation: portrait)').matches; }
// nút co kéo luôn hiện ở góc dưới (góc trái khi bảng bám mép phải)
const RZ_HOLD_MS = 280;
const RZ_ARMED_SVG = '<svg class="i1" viewBox="0 0 24 24"><path d="M7 7l10 10M7 7h5M7 7v5M17 17h-5M17 17v-5"/></svg>';
const rzIcon = (sw) => `<svg class="i0" viewBox="0 0 24 24">${sw ? '<path d="M8 8v8h8M8 16l8-8"/>' : '<path d="M16 8v8H8M16 16L8 8"/>'}</svg>`;
// tay cầm luôn ở đúng góc dưới của hộp (kể cả khi hộp kéo cao hơn nội dung)
function placeRz(el) {
  const z = el.querySelector(':scope > .rzh'); if (!z) return;
  z.style.marginTop = '';
  if (!el.style.height) return;
  const pb = parseFloat(getComputedStyle(el).paddingBottom) || 0, gap = el.clientHeight - pb - z.offsetTop;
  if (gap > 1) z.style.marginTop = gap + 'px';
}
function addRzHandle(el, key) {
  el.querySelectorAll(':scope > .rzh').forEach((n) => n.remove());
  const sw = key === 'opts' && portrait();
  const hz = h(`<div class="rzh ${sw ? 'sw' : ''}"><b title="Chạm và giữ rồi kéo để đổi kích thước">${rzIcon(sw)}${RZ_ARMED_SVG}</b></div>`);
  // Safari iPad: chặn cuộn / phóng to trang và menu chạm-giữ khi ngón tay đặt trên tay cầm
  for (const t of ['touchstart', 'touchmove']) hz.firstChild.addEventListener(t, (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });
  hz.firstChild.addEventListener('contextmenu', (e) => e.preventDefault());
  el.append(hz);
}
addEventListener('orientationchange', () => setTimeout(() => { if (S.doc) { renderToolOpts(); renderProps(); } }, 300));
function enableResize(el, key) {
  addRzHandle(el, key);
  if (el.dataset.rzBound) return; el.dataset.rzBound = '1';
  const zoneAt = (e) => {
    if (el.classList.contains('collapsed')) return '';
    const r = el.getBoundingClientRect(), m = e.pointerType === 'touch' ? 16 : 12;
    if (e.clientX < r.left - 2 || e.clientX > r.right + 2 || e.clientY < r.top || e.clientY > r.bottom + 2) return '';
    const L = e.clientX - r.left < m, R = r.right - e.clientX < m, B = r.bottom - e.clientY < m;
    if (key === 'opts' && portrait()) return B && L ? 'sw' : L ? 'w' : B ? 's' : ''; // bảng tuỳ chọn bám mép phải: chỉ giãn cạnh trái / dưới
    return B && R ? 'se' : B && L ? 'sw' : R ? 'e' : L ? 'w' : B ? 's' : '';
  };
  let rz = null;
  el.addEventListener('pointermove', (e) => {
    if (rz) return;
    const z = zoneAt(e); if ((el.dataset.rz || '') !== z) { if (z) el.dataset.rz = z; else delete el.dataset.rz; }
    rzTip(e.clientX, e.clientY, e.pointerType === 'touch' ? '' : z);
  });
  el.addEventListener('pointerleave', () => { if (!rz) { delete el.dataset.rz; rzTip(0, 0, ''); } });
  let hold = null;
  const armRz = () => {
    if (!hold || rz) return;
    const hd = hold; el.dataset.rzarm = '1';
    start({ preventDefault() {}, stopPropagation() {}, clientX: hd.x0, clientY: hd.y0, pointerId: hd.id }, hd.z);
    if (hd.x !== hd.x0 || hd.y !== hd.y0) el.dispatchEvent(new PointerEvent('pointermove', { clientX: hd.x, clientY: hd.y, pointerId: hd.id, pointerType: hd.pt, bubbles: true }));
  };
  const start = (e, z) => {
    e.preventDefault(); e.stopPropagation();
    const st = PANEL[key] || (PANEL[key] = {}), r = el.getBoundingClientRect(), pr = el.offsetParent.getBoundingClientRect();
    if (key !== 'opts' && st.x == null) { st.x = Math.round(r.left - pr.left); st.y = Math.round(r.top - pr.top); }
    rz = { z, x0: e.clientX, y0: e.clientY, w0: r.width, h0: r.height, l0: st.x, st };
    el.dataset.rz = z; try { el.setPointerCapture(e.pointerId); } catch {}
  };
  el.addEventListener('pointerdown', (e) => {
    const hb = e.target.closest && e.target.closest('.rzh b');
    if (hb && el.contains(hb)) { // QP-21: tay cầm góc: chạm và giữ -> tay cầm hoá nút tròn ⤡, rồi di bút / ngón tay để co kéo
      e.preventDefault(); e.stopPropagation();
      const z = hb.parentNode.classList.contains('sw') ? 'sw' : 'se';
      if (hold) clearTimeout(hold.t);
      hold = { hb, z, id: e.pointerId, pt: e.pointerType, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
      hold.t = setTimeout(() => armRz(), RZ_HOLD_MS);
      try { el.setPointerCapture(e.pointerId); } catch {}
      return;
    }
    if (e.pointerType === 'touch') return;
    const z = zoneAt(e); if (!z || e.button > 0) return;
    start(e, z);
  }, true);
  el.addEventListener('pointermove', (e) => {
    if (hold && !rz && e.pointerId === hold.id) { // chưa giữ đủ lâu
      hold.x = e.clientX; hold.y = e.clientY; e.stopPropagation(); e.preventDefault();
      if (Math.hypot(hold.x - hold.x0, hold.y - hold.y0) > 6) { clearTimeout(hold.t); if (hold.pt === 'touch') { hold = null; } else armRz(); } // bút / chuột di luôn cũng co kéo được; ngón tay phải giữ
      return;
    }
    if (!rz) return;
    const dx = e.clientX - rz.x0, dy = e.clientY - rz.y0, st = rz.st, dm = dimsOf(st, key);
    if (rz.z.includes('e')) dm.w = Math.max(220, Math.round(rz.w0 + dx));
    if (rz.z.includes('w')) { dm.w = Math.max(220, Math.round(rz.w0 - dx)); if (key !== 'opts') st.x = Math.round(rz.l0 + rz.w0 - dm.w); }
    if (rz.z.includes('s')) dm.h = Math.max(120, Math.round(rz.h0 + dy));
    panelState(el, st); rzTip(e.clientX, e.clientY, e.pointerType === 'touch' ? '' : rz.z);
    e.stopPropagation();
  }, true);
  const end = (e) => {
    if (hold) { clearTimeout(hold.t); hold = null; }
    delete el.dataset.rzarm;
    if (!rz) return; rz = null; savePanels(); delete el.dataset.rz; rzTip(0, 0, ''); e.stopPropagation(); };
  el.addEventListener('pointerup', end, true); el.addEventListener('pointercancel', end, true);
}
function panelChrome(el, key, title, host = null) {
  const st = PANEL[key] || (PANEL[key] = {});
  el.classList.add('pnl'); el.dataset.title = title;
  el.querySelectorAll('.pgrip, .pmin').forEach((n) => n.remove());
  if (key === 'opts') { delete st.x; delete st.y; } // bảng tuỳ chọn công cụ luôn ở bên phải
  enableResize(el, key);
  const grip = h('<button class="pgrip" title="Kéo để di chuyển · chạm đúp: về chỗ cũ" aria-label="Di chuyển bảng"><svg viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg></button>');
  const min = h('<button class="pmin" aria-label="Thu gọn">▾</button>');
  if (host) { host.prepend(grip); const x = host.querySelector('.ibtn, .x'); x ? host.insertBefore(min, x) : host.append(min); } else if (key === 'opts') el.append(min); else { el.prepend(grip); el.append(min); }
  min.onclick = (e) => { e.stopPropagation(); st.min = !st.min; savePanels(); panelState(el, st); };
  // bảng đang thu gọn: chạm vào bất kỳ chỗ nào trên thanh để mở lại
  if (!el.dataset.tapOpen) { el.dataset.tapOpen = '1'; el.addEventListener('click', (e) => { const k = el.dataset.pkey; if (!el.classList.contains('collapsed') || e.target.closest('.pgrip, .pmin, .ibtn, .x') || !PANEL[k]) return; PANEL[k].min = false; savePanels(); panelState(el, PANEL[k]); }); }
  el.dataset.pkey = key;
  let o = null, last = 0;
  // kéo bằng nút ⠿ hoặc bằng cả thanh tiêu đề (trừ các nút trên thanh)
  const bind = (hd, isGrip, rowOnly = false) => {
    hd.addEventListener('pointerdown', (e) => {
      if (!isGrip && (e.target.closest('button, input, select, textarea, a, label, .seg, [contenteditable], canvas, video, .chip, .lu-row, .lu-pal, .chk-row, [role=button], [onclick]') || e.button > 0)) return;
      // bút / chuột: kéo được từ bất kỳ chỗ trống nào của hộp thoại; ngón tay: chỉ dải trên cùng (để ngón tay còn cuộn nội dung)
      const anywhere = rowOnly && (e.pointerType === 'pen' || e.pointerType === 'mouse');
      if (rowOnly === 'body' && !anywhere) return;
      if (anywhere && (el.classList.contains('collapsed') || (e.target !== el && e.target.closest('.pnl') !== el))) return;
      if (rowOnly && !anywhere) { // chỉ dải ngang trên cùng (ngang hàng nút ⠿)
        const gp = el.querySelector(':scope > .pgrip');
        if (el.classList.contains('collapsed') || !gp) return;
        const gr = gp.getBoundingClientRect(), er = el.getBoundingClientRect();
        if (e.clientY < er.top || e.clientY > Math.max(gr.bottom + 6, er.top + 8)) return;
      }
      e.preventDefault(); e.stopPropagation();
      if (isGrip && Date.now() - last < 350) { delete st.x; delete st.y; delete st.w; delete st.h; savePanels(); panelState(el, st); last = 0; return; }
      if (isGrip) last = Date.now();
      const r = el.getBoundingClientRect(), pr = el.offsetParent.getBoundingClientRect();
      o = { dx: e.clientX - r.left, dy: e.clientY - r.top, pr, sx: e.clientX, sy: e.clientY, hd }; try { hd.setPointerCapture(e.pointerId); } catch {}
    });
    hd.addEventListener('pointermove', (e) => {
      if (!o || o.hd !== hd || Math.hypot(e.clientX - o.sx, e.clientY - o.sy) < 3) return;
      const cs = PANEL[el.dataset.pkey] || st;
      cs.x = Math.round(e.clientX - o.pr.left - o.dx); cs.y = Math.round(e.clientY - o.pr.top - o.dy); panelState(el, cs);
    });
    const end = () => { if (o && o.hd === hd) { o = null; savePanels(); } };
    hd.addEventListener('pointerup', end); hd.addEventListener('pointercancel', end);
  };
  bind(grip, true);
  if (host && !host.dataset.dragBound) { host.dataset.dragBound = '1'; host.style.touchAction = 'none'; host.style.cursor = 'grab'; bind(host, false); }
  if (host && !el.dataset.bodyDrag) { el.dataset.bodyDrag = '1'; bind(el, false, 'body'); } // bút chạm chỗ trống trong thân hộp thoại cũng kéo được
  // bảng không có thanh tiêu đề riêng (thanh tuỳ chọn công cụ, thanh Hiển thị 3D): chạm chỗ trống trên cả dải trên cùng để kéo
  if (!host && key !== 'opts' && !el.dataset.rowDrag) { el.dataset.rowDrag = '1'; el.classList.add('pnl-rowdrag'); bind(el, false, true); }
  panelState(el, st);
}
{ // thanh hiển thị 3D: thu thành dải mỏng sát đáy màn hình, kéo để di chuyển
  const b3 = $('#bar3d'); b3.prepend(h('<span class="ptitle">▴ Hiển thị 3D (Khối đặc, Đường sinh, Nét, bóng đổ…)</span>'));
  panelChrome(b3, 'bar3d', 'Hiển thị 3D');
  b3.addEventListener('click', (e) => { if (b3.classList.contains('collapsed') && !e.target.closest('.pmin')) { PANEL.bar3d.min = false; savePanels(); panelState(b3, PANEL.bar3d); } });
}
window.addEventListener('resize', () => { for (const [k, sel] of [['opts', '#toolOpts'], ['props', '#props'], ['bar3d', '#bar3d'], ['pop', '#pop']]) if (PANEL[k] && $(sel)) panelState($(sel), PANEL[k]); });

function presetIcon(type) {
  const s = M.presetShape(type, { ...M.PRESETS[type].params });
  const all = s.outer; const b = G.bbox(all); const k = 26 / Math.max(b.x1 - b.x0, b.y1 - b.y0);
  const P = (pts) => pts.map((p) => `${(17 + p[0] * k).toFixed(1)},${(17 + p[1] * k).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 34 34"><polygon points="${P(s.outer)}" fill="#dbe5f1" stroke="#16325c" stroke-width="1.5"/>${s.holes.map((hh) => `<polygon points="${P(hh)}" fill="#fff" stroke="#16325c" stroke-width="1.5"/>`).join('')}</svg>`;
}

// ---------------- Tạo đối tượng từ nét vẽ ----------------
function newItem(kind, pts, props, extra = {}) {
  const al = S.doc && S.doc.settings.activeLayer;
  const layer = al && S.doc.layers.some((l) => l.id === al) ? al : M.KIND_LAYER[kind];
  const it = { id: M.uid(), kind, layer, pts, props, ...extra };
  if (kind === 'building' && props && !props.color && S.opts.building.color) props.color = S.opts.building.color; // màu khối mới
  if (S.iso && kind !== 'facet' && props && typeof props === 'object') props.grp = S.iso; // đang «Khóa khối»: đối tượng mới thuộc khối
  return it;
}
function bldShape() { return penShape() === 'organic' ? 'organic' : 'auto'; }
function closeRing(p) { return G.dist(p[0], p[p.length - 1]) < 1e-6 ? p.slice(0, -1) : p; }

// Đường: lưu đỉnh (PI) + bán kính, toạ độ tuyến sinh từ đó
function setRoadGeometry(it) {
  const pr = it.props;
  if (pr.pis && pr.pis.length >= 2) {
    it.pts = SH.roadGeometry(pr.pis, pr.radii || []);
    pr.radiiEff = SH.effectiveRadii(pr.pis, pr.radii || []);
  } else if (pr.ctrl && pr.ctrl.length >= 2) it.pts = pr.ctrl.length > 2 ? G.catmullRom(pr.ctrl, 10, false) : pr.ctrl.map((q) => q.slice());
}
// ---------------- Cọ đường (QP-17): tạo theo nét, cắt đường, góc giao lộ ----------------
function roadTap(w, sc) {
  const o = S.opts.road;
  if (o.fromLine) { // chạm một nét line / polyline (nét CAD, DXF đã nhập, nét nháp): nét làm tim đường
    const e = RO.nearestEdge(S.doc, w, 14 / sc, ['cad', 'sketch']);
    if (!e) { toast('Chạm đúng vào một nét line / polyline (nét CAD, DXF hoặc nét nháp)'); return; }
    if (M.isLocked(S.doc, e.it)) { lockedToast(); return; }
    let P = e.it.pts.map((q) => [q[0], q[1]]);
    if (e.closed && G.dist(P[0], P[P.length - 1]) > 1e-6) P.push(P[0].slice());
    P = P.filter((q, i) => i === 0 || G.dist(q, P[i - 1]) > 0.01);
    if (P.length < 2 || G.length(P) < 1) { toast('Nét quá ngắn'); return; }
    const closed = G.dist(P[0], P[P.length - 1]) < 1e-6;
    const ends = closed ? P : snapRoadEnds(P, sc);
    const it = makeRoad(ends, ends.slice(2).map(() => 0), RO.roadClass(o.cls) && RO.roadClass(o.cls).ped ? { ped: true, sidewalk: 0 } : {});
    checkpoint(); S.doc.items.push(it); changed();
    const cn = RO.roadClass(o.cls);
    toast(`Đã tạo ${cn ? cn.name.toLowerCase() : 'đường'} theo nét (dài ${G.fmtNum(G.length(it.pts), 0)} m, lòng ${G.fmtNum(it.props.width)} m, vỉa hè ${G.fmtNum(it.props.sidewalk)} m)`);
    return;
  }
}
// Góc vát, bán kính: khoanh giao lộ -> hộp thoại phóng to giao lộ với các ô V / R
function startJunctionPick() {
  pickLasso((poly) => {
    const bb = G.bbox(poly), pts = RO.junctionPoints(S.doc, { x0: bb.x0 - 1, y0: bb.y0 - 1, x1: bb.x1 + 1, y1: bb.y1 + 1 }).filter((q) => G.pointInPolygon(q, poly));
    if (!pts.length) { toast('Vùng khoanh chưa có giao lộ (chỗ các tim đường cắt / chạm nhau). Khoanh lại quanh giao lộ'); return; }
    const c0 = G.centroid(poly); pts.sort((a, b) => G.dist(a, c0) - G.dist(b, c0));
    const c = pts[0];
    if (RO.junctionArms(S.doc, c).length < 2) { toast('Chỗ này chỉ có một nhánh đường, chưa thành giao lộ'); return; }
    let j = S.doc.items.find((i) => i.kind === 'junction' && G.dist(i.pts[0], c) < 2);
    openJunctionDialog(j || { kind: 'junction', pts: [c], props: { V: 0, R: 0, cs: [] }, _new: true });
  }, 'Khoanh một giao lộ bằng bút');
}
function openJunctionDialog(j) {
  const c = j.pts[0];
  openPop(`<div style="width:min(440px,86vw)"><h3>Góc vát, bán kính giao lộ</h3>
    <div class="note">V: góc vát vỉa hè (m) · R: bán kính bó vỉa lòng đường (m). Ô ở tâm: áp dụng cho mọi góc. Ô ở góc: chỉ góc đó.</div>
    <div class="jx-stage"><canvas></canvas></div></div>`, (pop) => {
    const stage = pop.querySelector('.jx-stage'), cv = stage.querySelector('canvas');
    const W = stage.clientWidth || 400, H = W;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
    const arms = RO.junctionArms(S.doc, c), ht = Math.max(8, ...arms.map((a) => a.ht));
    const v = new View(); Object.assign(v, { cx: c[0], cy: c[1], rot: S.view.rot || 0, w: W, h: H, scale: W / (ht * 5.2) });
    const draw = () => { const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.fillStyle = '#f4f1ea'; x.fillRect(0, 0, W, H); renderScene(x, S.doc, v, { ...sceneOpts(), selectedId: null, multiIds: [] }); };
    const commit = (fn) => {
      checkpoint();
      if (j._new) { delete j._new; Object.assign(j, newItem('junction', [c.slice()], j.props)); S.doc.items.push(j); }
      fn(j.props); carveJunction(j); changed(); draw(); place();
    };
    const circ = (pos, val, onSet, center) => {
      const el = h(`<div class="jx-c ${center ? 'center' : ''}" style="left:${pos[0]}px;top:${pos[1]}px"><label>V: <input inputmode="decimal" class="jv" value="${G.fmtNum(val.V)}">m</label><span class="jx-hr"></span><label>R: <input inputmode="decimal" class="jr" value="${G.fmtNum(val.R)}">m</label></div>`);
      const rd = (inp) => Math.max(0, parseFloat(inp.value.replace(',', '.')) || 0);
      el.querySelector('.jv').onchange = (e) => onSet('V', rd(e.target));
      el.querySelector('.jr').onchange = (e) => onSet('R', rd(e.target));
      stage.append(el);
    };
    const place = () => {
      stage.querySelectorAll('.jx-c').forEach((e) => e.remove());
      circ(v.toScreen(c), { V: j.props.V || 0, R: j.props.R || 0 }, (f, x) => commit((p) => { p[f] = x; p.cs = (p.cs || []).map((q) => ({ ...q, [f]: undefined })).filter((q) => q.V != null || q.R != null); }), true);
      for (const cor of RO.junctionCorners(S.doc, j)) {
        const d = Math.max(ht * 1.25, 10), q = v.toScreen([c[0] + cor.bis[0] * d * 1.35, c[1] + cor.bis[1] * d * 1.35]);
        const k = [Math.min(W - 52, Math.max(52, q[0])), Math.min(H - 52, Math.max(52, q[1]))];
        circ(k, { V: cor.V, R: cor.R }, (f, x) => commit((p) => {
          p.cs = p.cs || [];
          let e = p.cs.find((y) => Math.abs(Math.atan2(Math.sin(y.ang - cor.bisAng), Math.cos(y.ang - cor.bisAng))) < 0.35);
          if (!e) { e = { ang: cor.bisAng }; p.cs.push(e); }
          e[f] = x;
        }));
      }
    };
    draw(); place();
  });
}
// Cọ đường chế độ nắn mượt: giữ dáng nét tay, làm trơn bằng đường cong qua các điểm điều khiển
function smoothRoad(pts, sc, extra) {
  const sm = G.chaikin(G.rdp(G.resample(pts, 3 / sc), 1.5 / sc), 2, false);
  let ctrl = G.rdp(sm, 7 / sc);
  if (ctrl.length < 2) return null;
  ctrl = snapRoadEnds(ctrl, sc);
  const o = S.opts.road;
  const it = newItem('road', [], { width: o.width, sidewalk: o.sidewalk, name: '', ctrl, smooth: true, ...(extra.ped ? {} : roadClsProps()), ...extra });
  setRoadGeometry(it);
  return it;
}
function pedProps() { return { ped: true, width: S.opts.footpath.width, sidewalk: 0 }; }
// loại đường đang chọn (Phân loại đường): ghi vào đường mới; đường đi bộ thành đường dạo
function roadClsProps() { const c = RO.roadClass(S.opts.road.cls); return c ? (c.ped ? { cls: c.id, ped: true, sidewalk: 0 } : { cls: c.id }) : {}; }
function makeRoad(pis, radii, extra = {}) {
  const o = S.opts.road;
  const it = newItem('road', [], { width: o.width, sidewalk: o.sidewalk, name: '', pis, radii, ...(extra.ped ? {} : roadClsProps()), ...extra });
  setRoadGeometry(it);
  return it;
}

function finishStroke(raw, sc, snap, toolAs) {
  const pts = raw.map((p) => [p[0], p[1]]);
  const o = S.opts;
  const tool = toolAs || S.tool;
  // Hình chuẩn khi giữ bút
  if (snap) {
    const sp = SH.snapPts(snap);
    const closedShape = snap.type === 'circle' || snap.type === 'poly';
    if (snap.type === 'open' && (tool === 'road' || tool === 'footpath')) { // nét mở của Cọ vẽ làm tim đường
      const ex = tool === 'footpath' ? pedProps() : {};
      if (snap.pis) return makeRoad(snapRoadEnds(snap.pis, sc), snap.radii, ex);
      if (snap.ctrl) { const ctrl = snapRoadEnds(snap.ctrl, sc); const it = newItem('road', [], { width: tool === 'footpath' ? o.footpath.width : o.road.width, sidewalk: o.road.sidewalk, name: '', ctrl, smooth: true, ...(ex.ped ? {} : roadClsProps()), ...ex }); setRoadGeometry(it); return it; }
      const P = snapRoadEnds(sp, sc); return makeRoad(P, P.slice(2).map(() => 0), ex);
    }
    switch (tool) {
      case 'footpath':
        if (snap.type === 'line') return makeRoad(snapRoadEnds([snap.a, snap.b], sc), [], pedProps());
        if (snap.type === 'circle') return newItem('road', sp.concat([sp[0]]), { ...pedProps(), name: '', ring: { c: snap.c, r: snap.r } });
        return makeRoad(sp.concat([sp[0]]), sp.map(() => (snap.pen ? 0 : o.footpath.minR || 3)).slice(0, sp.length - 1), pedProps());
      case 'road':
        if (snap.type === 'line') return makeRoad(snapRoadEnds([snap.a, snap.b], sc), []);
        if (snap.type === 'circle') { const it = newItem('road', sp.concat([sp[0]]), { width: o.road.width, sidewalk: o.road.sidewalk, name: '', ring: { c: snap.c, r: snap.r } }); return it; }
        return makeRoad(sp.concat([sp[0]]), sp.map(() => (snap.pen ? 0 : o.road.minR || 15)).slice(0, sp.length - 1));
      case 'building': if (!closedShape) return null; return newItem('building', sp, { floors: o.building.floors, floorH: 3.3 });
      case 'water':
        if (!closedShape) return newItem('water', sp, { mode: 'river', width: o.water.width, setback: o.water.setback, name: '' });
        return newItem('water', sp, { mode: 'lake', setback: o.water.setback, name: '' });
      case 'park': return closedShape ? newItem('park', sp, { name: '' }) : null;
      case 'cover': return closedShape ? newItem('cover', sp, coverProps()) : null;
      case 'zone': return closedShape ? newZone(sp) : null;
      case 'cloud': return closedShape ? newItem('cloud', sp, { label: '' }) : null;
      case 'land': { const st = o.land.style || 'row'; if (M.LAND_CLOSED[st]) return closedShape ? newItem('land', sp, landProps(st)) : null; return newItem('land', closedShape ? sp.concat([sp[0]]) : sp, landProps('row')); }
      case 'arrow': case 'flow': return newItem(tool, closedShape ? sp.concat([sp[0]]) : sp, { label: '', color: o[tool].color, width: o[tool].width });
      case 'tour': return newTour(closedShape ? sp.concat([sp[0]]) : sp);
      case 'sketch': return newItem('sketch', (closedShape ? sp.concat([sp[0]]) : sp).map((p) => [p[0], p[1], 0.5]), { color: o.sketch.color, width: 2 / sc });
    }
    return null;
  }
  if (tool === 'land' && (o.land.style || 'row') === 'tree') return newItem('land', [pts[0]], landProps('tree'));
  if (pts.length < 2 || G.length(pts) < 8 / sc) return null;
  const closed = G.isClosedStroke(pts, 40, sc);
  // giữ sát nét tay: sai số đơn giản hoá nhỏ, làm mượt nhẹ
  const asPoly = (eps) => closeRing(G.rdp(pts, eps / sc));
  switch (tool) {
    case 'road': {
      if (penShape() === 'smooth') return smoothRoad(pts, sc, {});
      const f = SH.fitRoad(pts, sc, o.road.minR || 15);
      if (!f) return null;
      return makeRoad(snapRoadEnds(f.pis, sc), f.radii);
    }
    case 'footpath': {
      if (penShape() === 'smooth') return smoothRoad(pts, sc, pedProps());
      const f = SH.fitRoad(pts, sc, o.footpath.minR || 3);
      if (!f) return null;
      return makeRoad(snapRoadEnds(f.pis, sc), f.radii, pedProps());
    }
    case 'building': {
      const mode = bldShape();
      let p;
      if (mode === 'organic') { p = asPoly(2); if (p.length < 3) return null; p = G.chaikin(p, 2, true); }
      else if (mode === 'ortho') { p = asPoly(4); if (p.length < 3) return null; p = G.orthogonalize(p); }
      else {
        const f = SH.fitPolygon(pts, sc);
        if (!f) return null;
        // đa giác tự do: luôn lồi, cạnh thẳng
        p = mode === 'auto' && f.rightAngles ? G.orthogonalize(f.pts) : G.convexHull(f.pts);
      }
      if (G.area(p) < 20) return null;
      return newItem('building', p, { floors: o.building.floors, floorH: 3.3 });
    }
    case 'water': {
      if (closed) {
        const p = asPoly(2.5);
        if (p.length < 3) return null;
        return newItem('water', G.catmullRom(p, 4, true), { mode: 'lake', setback: o.water.setback, name: '' });
      }
      return newItem('water', G.catmullRom(G.rdp(pts, 2.5 / sc), 4, false), { mode: 'river', width: o.water.width, setback: o.water.setback, name: '' });
    }
    case 'park': { const p = asPoly(2); if (p.length < 3) return null; return newItem('park', axisOn('park') ? p : G.chaikin(p, 1, true), { name: '' }); }
    case 'cover': { if (!closed) return null; const p = asPoly(1.5); if (p.length < 3 || G.area(p) < 1) return null; return newItem('cover', p, coverProps()); }
    case 'zone': { const p = asPoly(2.5); if (p.length < 3 || G.area(p) < 50) return null; return newZone(p); }
    case 'cloud': { const p = asPoly(3); if (p.length < 3) return null; return newItem('cloud', p, { label: '' }); }
    case 'land': {
      const st = o.land.style || 'row';
      if (M.LAND_CLOSED[st]) { if (!closed) return null; const p = asPoly(2); if (p.length < 3) return null; return newItem('land', st === 'plaza' ? p : G.chaikin(p, 1, true), landProps(st)); }
      return newItem('land', G.catmullRom(G.rdp(pts, 2.5 / sc), 4, false), landProps('row'));
    }
    case 'arrow': case 'flow': return newItem(tool, G.catmullRom(G.rdp(G.resample(pts, 2 / sc), 3 / sc), 5, false), { label: '', color: o[tool].color, width: o[tool].width });
    case 'tour': return newTour(G.catmullRom(G.rdp(G.resample(pts, 2 / sc), 3 / sc), 5, false));
    case 'sketch': {
      const pr = raw.map((p) => [p[0], p[1], p[2] ?? 0.5]);
      const simp = G.rdp(pr, 0.6 / sc).map((p) => [p[0], p[1], p[2] ?? 0.5]);
      return newItem('sketch', simp, { color: o.sketch.color, width: o.sketch.width / sc });
    }
  }
  return null;
}
function newZone(p) {
  const code = S.opts.zone.code, lu = M.LANDUSE[code];
  return newItem('zone', p, { code, label: '', maxMdxd: lu.mdxd, maxFar: lu.far, maxFloors: lu.floors, setback: lu.cat === 'cx' || lu.cat === 'mn' || lu.cat === 'gt' ? 0 : S.opts.zone.setback });
}

// ---------------- Cọ SDĐ: cơ bản / chia / nhập ----------------
const zonesFree = () => S.doc.items.filter((i) => i.kind === 'zone' && !M.isLocked(S.doc, i));
const bbHit = (a, b, pad = 0) => a.x1 + pad >= b.x0 && a.x0 - pad <= b.x1 && a.y1 + pad >= b.y0 && a.y0 - pad <= b.y1;
const cloneZone = (z, pts) => ({ ...z, id: M.uid(), pts, holes: undefined, props: { ...z.props, name: '' } });
const zOps = (z, add = true) => [{ pts: z.pts, add }, ...(z.holes || []).map((hh) => ({ pts: hh, add: !add }))];
const setZonePoly = (z, q) => { z.pts = q.slice(); if (q.holes && q.holes.length) z.holes = q.holes; else delete z.holes; };
// mặt cản (đường, sông, hồ) dạng đa giác quanh một khung
function barrierPolys(bb) {
  const out = [];
  for (const it of S.doc.items) {
    if (it.kind === 'road') { const hw = M.roadTotalWidth(it) / 2; if (bbHit(G.bbox(it.pts), bb, hw)) out.push(G.bandPolygon(it.pts, hw)); }
    else if (it.kind === 'water') {
      if (it.props.mode === 'river') { if (bbHit(G.bbox(it.pts), bb, it.props.width)) out.push(G.bandPolygon(it.pts, it.props.width / 2)); }
      else if (bbHit(G.bbox(it.pts), bb)) out.push(it.pts);
    }
  }
  return out;
}
// Trừ một vùng khỏi các ô đất khác (vùng mới phủ lên): ô bị phủ gần hết thì xoá
function carveOthers(region, keepIds) {
  const rb = G.bbox(region); let removed = 0;
  for (const z of zonesFree()) {
    if (keepIds.includes(z.id) || !bbHit(G.bbox(z.pts), rb)) continue;
    if (!z.pts.some((q) => G.pointInPolygon(q, region)) && !region.some((q) => G.pointInPolygon(q, z.pts))) continue;
    const a0 = Math.abs(G.area(z.pts));
    const rest = ZO.booleanPolys([...zOps(z), { pts: region, add: false }]);
    const tot = rest.reduce((s2, q) => s2 + q.net, 0);
    if (tot > a0 * 0.995) continue;
    const idx = S.doc.items.indexOf(z);
    if (!rest.length || tot < a0 * 0.03) { S.doc.items.splice(idx, 1); removed++; continue; }
    setZonePoly(z, rest[0]);
    for (const q of rest.slice(1)) if (q.net > 20) { const c = cloneZone(z, q); setZonePoly(c, q); S.doc.items.push(c); }
  }
  return removed;
}
function zoneStroke(raw, sc, snap) {
  const o = S.opts.zone; const brush = o.brush || 'basic', form = 'free';
  const pts = raw.map((q) => [q[0], q[1]]);
  if (!snap && (pts.length < 2 || G.length(pts) < 8 / sc)) return false;
  const closed = snap ? snap.type === 'circle' || snap.type === 'poly' : G.isClosedStroke(pts, 40, sc);
  let shp = snap ? (snap.type === 'line' ? [snap.a, snap.b] : SH.snapPts(snap)) : ZO.shapeStroke(pts, form, sc, closed);
  if (closed && shp.length < 3) return false;
  if (axisOn('zone') && !(snap && (snap.type === 'circle' || (snap.pen && CURVED_PEN.has(snap.pen))))) { const q = AX.axisSnapPts(closed ? G.rdp(shp.concat([shp[0]]), 3 / sc).slice(0, -1) : G.rdp(shp, 3 / sc), closed, axisRad(), S.opts.axis.step || 90); if (q.length >= (closed ? 3 : 2)) shp = q; }
  if (brush === 'split') return splitStroke(closed ? shp.concat([shp[0]]) : shp, sc);
  if (brush === 'merge') return mergeStroke(shp, closed, sc);
  // ---- cọ cơ bản ----
  if (closed) {
    const bb = G.bbox(shp);
    const ops = [{ pts: shp, add: true }, ...barrierPolys(bb).map((q) => ({ pts: q, add: false }))];
    const parts = ZO.booleanPolys(ops, edgeSources(S.doc, [], bb));
    let poly = parts[0];
    if (poly && axisOn('zone')) { const q = poly.filter((v, i) => G.dist(v, poly[(i + 1) % poly.length]) > 0.3); if (q.length >= 3) poly = q; } // bỏ đỉnh trùng sát nhau sau phép cắt
    if (!poly || Math.abs(G.area(poly)) < 50) { toast('Vùng khoanh nằm hết trên đường hoặc mặt nước'); return true; }
    checkpoint();
    const it = newZone(poly); setZonePoly(it, poly); S.doc.items.push(it); carveAllJunctions(it);
    const rm = carveOthers(poly, [it.id]);
    S.selectedId = it.id; changed();
    toast(`Đã phủ ${M.luLabel(it.props.code)} (${G.fmtArea(M.itemArea(it))})${parts.length > 1 ? ' · đã cắt bỏ phần đường / sông' : ''}${rm ? ` · thay ${rm} ô cũ` : ''}`);
    return true;
  }
  // nét hở: dùng nét làm ranh tạm, cùng đường / ô đất khác khép thành vùng; lấy vùng nhỏ hơn
  const all = M.liveItems(S.doc).filter((i) => ['road', 'water', 'zone', 'cad'].includes(i.kind)).flatMap((i) => i.pts).concat(shp);
  const b = G.bbox(all); const span = Math.max(b.x1 - b.x0, b.y1 - b.y0) + 100;
  const off = Math.max(1.5 / sc, span / 260);
  const L = G.length(shp); const cands = [];
  for (const f of [0.5, 0.3, 0.7, 0.15, 0.85]) {
    let d = L * f, k = 1; while (k < shp.length - 1 && d > G.dist(shp[k - 1], shp[k])) { d -= G.dist(shp[k - 1], shp[k]); k++; }
    const a = shp[k - 1], c = shp[k], sl = G.dist(a, c) || 1, t = Math.min(1, d / sl);
    const m = [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t], nx = -(c[1] - a[1]) / sl, ny = (c[0] - a[0]) / sl;
    for (const sg of [1, -1]) {
      const seed = [m[0] + nx * off * sg, m[1] + ny * off * sg];
      if (S.doc.items.some((i) => i.kind === 'zone' && G.pointInPolygon(seed, i.pts))) continue;
      const poly = fillRegionAt(S.doc, seed, [shp], { gap: gapTol() });
      if (poly && !cands.some((q) => Math.abs(Math.abs(G.area(q)) - Math.abs(G.area(poly))) < 1)) cands.push(poly);
    }
    if (cands.length >= 2) break;
  }
  if (!cands.length) { toast('Nét hở cần nối hai đầu vào đường hoặc ranh giới để khép vùng'); return true; }
  cands.sort((p1, p2) => Math.abs(G.area(p1)) - Math.abs(G.area(p2)));
  checkpoint();
  const it = newZone(cands[0]); S.doc.items.push(it); carveAllJunctions(it); S.selectedId = it.id; changed();
  toast(`Đã phủ ${M.luLabel(it.props.code)} (${G.fmtArea(M.itemArea(it))}) – vùng khép bởi nét vẽ và đường`);
  return true;
}
function splitStroke(path, sc) {
  const ext = ZO.extendPath(path, 10 / sc);
  const pb = G.bbox(ext); let n = 0, cp = false;
  for (const z of zonesFree()) {
    if (!bbHit(G.bbox(z.pts), pb)) continue;
    const pieces = ZO.splitPolygon(z.pts, ext);
    if (pieces.length < 2) continue;
    if (!cp) { checkpoint(); cp = true; }
    pieces.sort((a, b) => Math.abs(G.area(b)) - Math.abs(G.area(a)));
    const holes = z.holes || [];
    const hz = (q) => holes.filter((hh) => G.pointInPolygon(G.centroid(hh), q));
    z.pts = pieces[0]; if (hz(pieces[0]).length) z.holes = hz(pieces[0]); else delete z.holes;
    for (const q of pieces.slice(1)) { const c = cloneZone(z, q); if (hz(q).length) c.holes = hz(q); S.doc.items.push(c); }
    n += pieces.length - 1;
  }
  if (!n) { toast('Nét cắt phải đi xuyên qua ô đất, từ mép này sang mép kia'); return true; }
  S.selectedId = null; changed(); renderProps();
  toast(`Đã chia thêm ${n} ô đất – số hiệu lô được đánh lại tự động`);
  return true;
}
function mergeStroke(shp, closed, sc) {
  const zs = zonesFree();
  const at = (q) => zs.slice().reverse().find((z) => G.pointInPolygon(q, z.pts));
  const Z = at(shp[0]) || shp.map(at).find(Boolean);
  if (!Z) { toast('Bắt đầu nét từ bên trong ô đất cần mở rộng'); return true; }
  const end = at(shp[shp.length - 1]);
  const ring = shp;
  const enclosed = ring.length >= 3 ? Math.abs(G.area(ring)) : 0;
  // kéo nét từ ô này sang ô khác (không khoanh vùng đáng kể): nhập hai ô
  if (!closed && end && end !== Z && enclosed < Math.abs(G.area(Z.pts)) * 0.05) {
    const u = ZO.booleanPolys([...zOps(Z), ...zOps(end)]);
    if (u.length !== 1) { toast('Hai ô đất không liền kề (đang cách nhau bởi đường hoặc khe hở) nên không nhập được'); return true; }
    checkpoint();
    setZonePoly(Z, u[0]); S.doc.items.splice(S.doc.items.indexOf(end), 1);
    S.selectedId = Z.id; changed(); toast(`Đã nhập 2 ô đất thành một (${G.fmtArea(M.itemArea(Z))})`); return true;
  }
  if (enclosed < 4) { toast('Khoanh phần đất cần thêm vào ô (nét bắt đầu trong ô đất)'); return true; }
  const u = ZO.booleanPolys([...zOps(Z), { pts: ring, add: true }]);
  if (u.length !== 1) { toast('Vùng khoanh phải chạm vào ô đất cần mở rộng'); return true; }
  checkpoint();
  const a0 = M.itemArea(Z);
  setZonePoly(Z, u[0]);
  const rm = carveOthers(ring, [Z.id]);
  S.selectedId = Z.id; changed();
  toast(`Đã mở rộng ô đất thêm ${G.fmtArea(Math.max(0, M.itemArea(Z) - a0))}${rm ? ` · đã nhập ${rm} ô bên cạnh` : ''}`);
  return true;
}

// Gắn đầu mút đường vào tim đường gần nhất để tạo nút giao liền mạch
function snapRoadEnds(p, sc) {
  const roads = S.doc.items.filter((i) => i.kind === 'road');
  const snap = (q) => {
    let best = null;
    for (const r of roads) {
      const d = G.distToPolyline(q, r.pts);
      const tol = M.roadTotalWidth(r) / 2 + 12 / sc;
      if (d.d < tol && (!best || d.d < best.d)) best = d;
      for (const e of [r.pts[0], r.pts[r.pts.length - 1]]) if (G.dist(q, e) < tol * 1.2 && (!best || G.dist(q, e) < best.d)) best = { d: G.dist(q, e), q: e };
    }
    return best ? best.q.slice() : q;
  };
  p = p.map((q) => q.slice());
  p[0] = snap(p[0]); p[p.length - 1] = snap(p[p.length - 1]);
  return p;
}

// ---------- Xếp khối tự động vào ô đất ----------
function autoLayAt(w) {
  const z = S.doc.items.filter((i) => i.kind === 'zone' && i.pts.length > 2).reverse().find((i) => G.pointInPolygon(w, i.pts) && !(i.holes || []).some((hh) => G.pointInPolygon(w, hh)));
  if (!z) { toast('Chạm vào bên trong một ô đất (vẽ bằng công cụ SDĐ) để xếp khối'); return; }
  if (M.isLocked(S.doc, z)) { lockedToast(); return; }
  runAutoLayout(z);
}
function rerunAuto() {
  if (!S.autoZone) return;
  const z = S.doc.items.find((i) => i.id === S.autoZone) || (S.autoSrc && S.autoSrc.id === S.autoZone ? S.autoSrc.zone : null);
  if (z) runAutoLayout(z, true);
}
// Gỡ mọi thứ đã tạo khi xếp ô zid (khối, đường, thửa mới, công viên) và trả lại ô đất gốc nếu đã được chia
function clearAuto(zid) {
  S.doc.items = S.doc.items.filter((i) => !(i.props && i.props.auto === zid));
  const src = S.autoSrc && S.autoSrc.id === zid ? S.autoSrc : null;
  if (src && !S.doc.items.some((i) => i.id === zid)) { const z = JSON.parse(JSON.stringify(src.zone)); S.doc.items.splice(Math.min(src.idx, S.doc.items.length), 0, z); return z; }
  return S.doc.items.find((i) => i.id === zid) || null;
}
function runAutoLayout(z0, again = false) {
  let z = z0;
  const ao = S.opts.autolay, lu = M.LANDUSE[z.props.code] || M.LANDUSE.ODT;
  const ty = ao.type === 'auto' ? AL.defaultType(z.props.code, lu) : ao.type;
  if (!ty) { toast(`Ô ${M.luLabel(z.props.code)} (${lu.name}) không bố trí công trình – chọn loại hình ở thanh trên nếu vẫn muốn xếp`); return; }
  const P = { ...AL.TYPES[ty].defaults, ...((ao.p || {})[ty] || {}) };
  const roads = S.doc.items.filter((i) => i.kind === 'road' && i.pts.length > 1).map((r) => ({ pts: r.pts, half: M.roadTotalWidth(r) / 2 }));
  const limits = { mdxd: z.props.maxMdxd || lu.mdxd, far: z.props.maxFar || lu.far, floors: z.props.maxFloors || lu.floors };
  checkpoint();
  const zid = z.id;
  z = clearAuto(zid) || z;
  let res;
  S.doc.items = S.doc.items.filter((i) => {
    if (i.kind !== 'building') return true;
    if (i.props.auto === zid) return false;
    if (ao.replace !== false && !i.props.existing && M.layerOf(i) !== M.EXIST_LAYER && C.zoneOf(S.doc, i) === z && !M.isLocked(S.doc, i)) return false;
    return true;
  });
  // nét trên mặt khối đã xoá
  const ids = new Set(S.doc.items.map((i) => i.id));
  S.doc.items = S.doc.items.filter((i) => i.kind !== 'facet' || !i.props.parent || ids.has(i.props.parent));
  const COL = { factory: '#cfd6de', aux: '#e8e2d4' };
  const put = (r) => {
    for (const pk of r.parks || []) { const it = newItem('park', pk.pts.map((q) => q.slice()), { name: 'Công viên', auto: zid }); it.layer = M.KIND_LAYER.park; S.doc.items.push(it); }
    for (const pc of r.pieces) S.doc.items.push(newItem('building', pc.pts.map((q) => q.slice()), { floors: pc.floors, floorH: pc.floorH || 3.3, auto: zid, autoType: ty, ...(COL[pc.role] ? { color: COL[pc.role] } : {}) })); };
  // Công nghiệp: lưới đường chia ô thành các thửa mới, thửa giữa làm công viên, rồi xếp xưởng từng thửa
  const grid = (ty === 'cn' || ((ty === 'cc' || ty === 'hh') && (P.form || 'san') === 'san')) && P.grid > 0 ? AL.industrialGrid(z, P, roads, ty === 'cn') : null;
  if (grid) {
    const idx = S.doc.items.indexOf(z);
    S.autoSrc = { id: zid, zone: JSON.parse(JSON.stringify(z)), idx };
    S.doc.items = S.doc.items.filter((i) => i !== z);
    const rw = Math.max(6, P.roadW || 25), sw = Math.min(5, Math.max(1, rw * 0.2));
    const newRoads = [];
    for (const ln of grid.roads) {
      const it = newItem('road', [], { width: Math.max(3, rw - 2 * sw), sidewalk: sw, name: '', pis: ln, radii: [], auto: zid });
      setRoadGeometry(it); it.layer = M.KIND_LAYER.road; S.doc.items.push(it); newRoads.push({ pts: it.pts, half: rw / 2 });
    }
    if (grid.park) { const pk = newItem('park', grid.park, { name: 'Công viên', auto: zid }); pk.layer = M.KIND_LAYER.park; S.doc.items.push(pk); }
    const all = { pieces: [], notes: [], foot: 0, gfa: 0, zarea: 0 };
    // chung cư, hỗn hợp: quỹ đất công viên (khoảng 10% cả ô) dồn vào thửa giữa nhất
    const zA = G.area(z.pts), cz = G.centroid(z.pts);
    let mid = -1, md = Infinity; grid.plots.forEach((q, i) => { const d = G.dist(G.centroid(q), cz); if (d < md) { md = d; mid = i; } });
    let parkA = 0;
    for (const [pi, pts] of grid.plots.entries()) {
      const pz = newItem('zone', pts, { ...JSON.parse(JSON.stringify(z.props)), name: '', label: '', auto: zid }); pz.layer = M.KIND_LAYER.zone;
      S.doc.items.push(pz);
      const PP = ty === 'cn' ? P : { ...P, park: pi === mid && P.park > 0 ? Math.min(100, (P.park * zA) / G.area(pts)) : 0 };
      const r = AL.layout(pz, ty, PP, { roads: roads.concat(newRoads), limits });
      put(r);
      all.pieces.push(...r.pieces); all.parks = (all.parks || 0) + (r.parks || []).length; all.foot += r.foot; all.gfa += r.gfa; all.zarea += r.zarea;
      parkA += (r.parks || []).reduce((s2, q) => s2 + G.area(q.pts), 0);
      for (const n of r.notes) if (/^Nhà thu/.test(n)) all.thin = true; else if (!/^(HSSDĐ|MĐXD|Mật độ|\d+ nhóm)/.test(n) && !all.notes.includes(n)) all.notes.push(n);
    }
    if (all.thin) all.notes.push(`Thu mỏng nhà để mật độ khoảng ${P.dens}%`);
    if (parkA) all.notes.unshift(`Công viên ${G.fmtArea(parkA)} (khoảng ${Math.round((parkA / zA) * 100)}% ô đất)`);
    if (limits.far > 0 && all.gfa / all.zarea > limits.far + 0.005) all.notes.push(`HSSDĐ ${(all.gfa / all.zarea).toFixed(2)} vượt ${limits.far}`);
    if (limits.mdxd > 0 && (all.foot / all.zarea) * 100 > limits.mdxd + 0.05) all.notes.push(`MĐXD ${((all.foot / all.zarea) * 100).toFixed(1)}% vượt ${limits.mdxd}% cho phép`);
    res = { ...all, mdxd: all.zarea ? (all.foot / all.zarea) * 100 : 0, far: all.zarea ? all.gfa / all.zarea : 0, maxFloors: Math.max(0, ...all.pieces.map((x) => x.floors)), grid: { roads: grid.roads.length, plots: grid.plots.length, park: !!grid.park || all.parks > 0 } };
  } else {
    if (!(S.autoSrc && S.autoSrc.id === zid)) S.autoSrc = null;
    res = AL.layout(z, ty, P, { roads, limits });
    put(res);
  }
  S.autoZone = zid; S.autoRes = res; S.selectedId = null;
  changed(); renderToolOpts();
  if (!again) toast(res.pieces.length ? `${res.grid ? `Đã tạo ${res.grid.roads} đường, ${res.grid.plots} thửa${res.grid.park ? ', 1 công viên' : ''} · ` : ''}Đã xếp ${res.pieces.length} khối ${AL.TYPES[ty].name.toLowerCase()} vào lô ${M.lotName(S.metrics, z)}${res.notes.length ? ' · ' + res.notes[0] : ''}` : res.notes[0] || 'Không xếp được khối', 4500);
}

// Đặt khối mẫu: tự xoay song song lộ giới và lùi đúng khoảng lùi, không lấn chỉ giới
function placePreset(at) {
  const o = S.opts.preset;
  const params = { ...M.PRESETS[o.type].params };
  const s = M.presetShape(o.type, params);
  const b = G.bbox(s.outer); const depth = b.y1 - b.y0;
  let cx = at[0], cy = at[1], rot = 0, fitted = false;
  let best = null;
  for (const r of S.doc.items.filter((i) => i.kind === 'road')) {
    const d = G.distToPolyline(at, r.pts);
    const half = M.roadTotalWidth(r) / 2;
    if (d.d - half < depth / 2 + o.setback + 25 && (!best || d.d < best.d)) best = { ...d, r, half };
  }
  if (best) {
    const a = best.r.pts[best.i], c = best.r.pts[best.i + 1];
    const ang = Math.atan2(c[1] - a[1], c[0] - a[0]);
    const nx = -Math.sin(ang), ny = Math.cos(ang);
    const side = Math.sign((at[0] - best.q[0]) * nx + (at[1] - best.q[1]) * ny) || 1;
    const off = best.half + o.setback + depth / 2;
    cx = best.q[0] + nx * side * off; cy = best.q[1] + ny * side * off;
    rot = side > 0 ? ang : ang + Math.PI;
    fitted = true;
  }
  const it = newItem('building', [], { floors: S.opts.building.floors, floorH: 3.3, preset: { type: o.type, params, cx, cy, rot } });
  M.applyPreset(it);
  const ok = C.pushInside(S.doc, it);
  checkpoint(); S.doc.items.push(it); S.selectedId = it.id;
  changed();
  if (!ok) toast('Khối lớn hơn phạm vi chỉ giới xây dựng của ô đất – hãy thu nhỏ khối');
  else toast(fitted ? `Đã đặt khối ${M.PRESETS[o.type].name} song song đường, lùi ${o.setback} m` : `Đã đặt khối ${M.PRESETS[o.type].name}`);
}

// ---------------- Bộ máy công cụ (dùng chung cho 2D và 3D) ----------------
const pointers = new Map();
let gesture = null; // theo dõi chạm nhiều ngón: undo/redo
let pinch = null;
let drag = null;
let penSeen = 0;
let holdTimer = 0;
const HOLD_MS = 550;

function isDrawPointer(e) {
  if (e.pointerType === 'pen') return true;
  if (e.pointerType === 'mouse') return e.button === 0 && !e.altKey;
  if (e.pointerType === 'touch') return S.opts.fingerDraw && Date.now() - penSeen > 2000 && touchCount() === 0;
  return false;
}
const touchCount = () => [...pointers.values()].filter((p) => p.type === 'touch').length;
function local(e) { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

// p: toạ độ màn hình, w: toạ độ thế giới (m), sc: số điểm ảnh / mét tại vị trí đó
function toolDown(e, p, w, sc, in3d = false) {
  if (S.baseEdit && !in3d) { baseDown(e, p, w); return; }
  const base = { pointerId: e.pointerId, pointerType: e.pointerType, start: p, startW: w, sc, in3d };
  if (S.axisPick && S.tool !== 'facet') { if (w) axisPickAt(w, sc); return; }
  if (S.tool === 'facet') { if (!in3d) toast('Chia mặt khối dùng trong chế độ 3D'); return; }
  const op = penOp();
  if (op && op !== 'erase') { drag = { ...base, kind: 'tap', penOp: op }; return; }
  if (S.tool === 'measure' && !op) { if (w) measureDown(base, w, sc); return; }
  if (penOn() && !op && (penShape() ? !penLayerTool() : DRAW_TOOLS.has(S.tool) && !penLayerTool())) { // Cọ vẽ khi không có lớp vẽ (hoặc lớp chưa tích Chỉnh sửa): nét vào Cọ nháp
    drag = { ...base, kind: 'stroke', lastP: p, asTool: 'sketch' };
    S.stroke = { pts: [[w[0], w[1], e.pressure || 0.5]], screen: [p], snap: null, sc };
    return;
  }
  switch (op === 'erase' ? 'eraser' : S.tool) {
    case 'select': {
      const pick = S.opts.selPick || 'top';
      if (pick === 'box') {
        const h0 = (in3d && e.hitId && S.doc.items.find((i) => i.id === e.hitId)) || hitIso(S.doc, w, sc);
        const grp = S.multi.length > 1 ? S.multi : [];
        if (h0 && grp.includes(h0.id) && !M.isLocked(S.doc, h0)) { startGroupMove(base, grp); return; }
        drag = { ...base, kind: 'box', cx0: e.clientX, cy0: e.clientY, cx1: e.clientX, cy1: e.clientY, p1: p, hit: h0 ? h0.id : null };
        return;
      }
      if (pick === 'list') {
        const list = [];
        if (in3d && e.allIds) for (const id of e.allIds) { const it = S.doc.items.find((i) => i.id === id); if (it && inIso(it) && !list.includes(it)) list.push(it); }
        for (const it of hitsAt(w, sc, false)) if (!list.includes(it)) list.push(it);
        if (list.length >= 2) { drag = { ...base, kind: 'choose', list }; return; }
      }
      S.multi = [];
      const sel = S.doc.items.find((i) => i.id === S.selectedId);
      if (sel && !in3d) {
        const hp = M.isLocked(S.doc, sel) ? [] : handlePoints(sel);
        const idx = hp.findIndex((q) => G.dist(S.view.toScreen(q), p) < 16);
        if (idx >= 0) { drag = { ...base, kind: 'vertex', id: sel.id, idx, snap: snapItems() }; return; }
      }
      const hit = (in3d && e.hitId && S.doc.items.find((i) => i.id === e.hitId)) || hitIso(S.doc, w, sc);
      S.selectedId = hit ? hit.id : null;
      renderProps(); requestRender(); if (in3d) schedule3D();
      if (hit && M.isLocked(S.doc, hit)) { lockedToast(); return; }
      if (hit) {
        const rot = S.opts.selMode === 'rotate' && hit.kind === 'building';
        drag = { ...base, kind: rot ? 'rotate' : 'move', id: hit.id, snap: snapItems(), orig: JSON.stringify(hit), c: G.centroid(hit.pts), moved: false, zone: hit.kind === 'building' ? C.zoneOf(S.doc, hit) : null };
      }
      return;
    }
    case 'move': {
      let hit = (in3d && e.hitId && S.doc.items.find((i) => i.id === e.hitId)) || hitMovable(w, sc);
      if (hit && M.isLocked(S.doc, hit)) { lockedToast(); hit = null; }
      S.selectedId = hit ? hit.id : null;
      renderProps(); requestRender(); if (in3d) schedule3D();
      if (hit) drag = { ...base, kind: 'move', id: hit.id, snap: snapItems(), orig: JSON.stringify(hit), c: G.centroid(hit.pts), moved: false, zone: hit.kind === 'building' ? C.zoneOf(S.doc, hit) : null };
      return;
    }
    case 'eraser': {
      drag = { ...base, kind: 'erase', snap: snapItems(), removed: 0 };
      if (in3d) { const r = eraseFaceLine(e, sc); if (r) { drag.faceOnly = true; return; } }
      const all = hitsAt(w, sc, true).filter((i) => penOp() !== 'erase' || canEdit(i));
      if (all.length >= 2) { drag.pending = all; return; } // trùng chỗ: chờ nhấc bút, nếu là chạm thì hỏi xoá đối tượng nào
      eraseAt(w, sc); return;
    }
    case 'check': {
      const hit = (in3d && e.hitId && S.doc.items.find((i) => i.id === e.hitId)) || topBuildingAt(w);
      const b = hit && rootOf(hit);
      if (b && b.kind === 'building') { const vi = S.metrics.viol && S.metrics.viol[b.id]; toast(vi ? '⚠ Vi phạm: ' + vi.join(' · ') : '✓ Công trình đạt chỉ tiêu'); }
      return;
    }
    case 'preset': case 'icon': case 'autolay': drag = { ...base, kind: 'tap' }; return;
    case 'push': {
      let hit = (in3d && e.hitId && S.doc.items.find((i) => i.id === e.hitId)) || topBuildingAt(w);
      const negMode = S.opts.push && S.opts.push.mode === 'neg';
      if (in3d && hit && S.isoFace && S.facetSel && !inIsoFace(hit) && hit.id !== S.facetSel.parent) { toast('Đang «Khóa mặt»: chỉ kéo được mặt đang chọn và các mảng của nó'); return; }
      if (negMode && !in3d) { toast('Kéo âm dùng trong chế độ 3D: nhấn vào mặt khối cần ấn lõm'); return; }
      if (negMode && hit && (hit.kind === 'building' || (hit.kind === 'facet' && Math.abs(hit.props.depth || 0) > 0.05))) { // kéo âm một mặt: mặt chưa chia thì tạo một mảng phủ kín mặt
        const root = rootOf(hit);
        if (root && M.isLocked(S.doc, root)) { lockedToast(); return; }
        const fc = pickFaceAt(v3, e.clientX, e.clientY);
        if (!fc) { toast('Nhấn vào mái hoặc mặt đứng của khối'); return; }
        if (!faceIsoOk(fc)) { toast('Đang «Khóa mặt»: chỉ thao tác trên mặt đang chọn'); return; }
        const F = frameFor(fc); if (!F) return;
        const mine = FA.faceFacets(S.doc, fc.parent, fc.face);
        const snap0 = snapItems();
        if (mine.length) { const q = faceLocal(v3, fc, e.clientX, e.clientY) || [NaN, NaN]; hit = mine.find((f) => G.pointInPolygon(q, f.props.poly) && !(f.props.holes || []).some((hh) => G.pointInPolygon(q, hh))) || null; if (!hit) { toast('Mặt đã chia: nhấn vào mảng cần ấn lõm'); return; } }
        else {
          hit = newItem('facet', [], { parent: fc.parent, face: fc.face, poly: F.base.map((q) => q.slice()), depth: -0.1 }); hit.layer = (root || {}).layer;
          if (F.holes.length) hit.props.holes = F.holes.map((hh) => hh.map((q) => q.slice()));
          hit.pts = FA.footprint(F, hit);
          S.doc.items.push(hit);
        }
        S.selectedId = hit.id; renderProps(); schedule3D();
        drag = { ...base, kind: 'extrude', id: hit.id, y: e.clientY, floors: 0, d0: hit.props.depth || 0, snap: snap0 };
        return;
      }
      if (!hit) { toast('Nhấn vào một công trình rồi kéo lên / xuống'); return; }
      if (M.isLocked(S.doc, hit)) { lockedToast(); return; }
      S.selectedId = hit.id; renderProps(); requestRender(); if (in3d) schedule3D();
      drag = { ...base, kind: 'extrude', id: hit.id, y: e.clientY, floors: hit.props.floors, d0: hit.props.depth || 0, snap: snapItems() };
      return;
    }
    case 'circle': S.circleDraft = { c: w, r: S.opts.circle.radius }; drag = { ...base, kind: 'circle' }; redrawLive(); return;
    case 'tour': { const t = w && hitAll(S.doc, w, sc).find((i) => i.props && i.props.tour); if (t) { S.selectedId = t.id; renderProps(); startTour(t); return; } }
    // fallthrough
    case 'road': if (S.tool === 'road' && (S.opts.road.sub || 'type') === 'type' && S.opts.road.fromLine) { drag = { ...base, kind: 'tap' }; return; } // tạo đường theo nét / cắt đường: chạm
    // fallthrough: vẽ tuyến mới
    default:
      drag = { ...base, kind: 'stroke', tapFill: S.tool === 'zone' || S.tool === 'face' || S.tool === 'cover', lastP: p };
      if (S.tool === 'face') { drag.parent = (in3d && e.hitId) || (topBuildingAt(w) || {}).id || null; if (in3d) drag.planeH = e.planeH; }
      S.stroke = { pts: [[w[0], w[1], e.pressure || 0.5]], screen: [p], snap: null, sc };
      if (!penShape()) armHold();
  }
}
// Công trình trên cùng (khối chồng cao nhất) tại một điểm
function topBuildingAt(w) {
  const byId = new Map(S.doc.items.map((i) => [i.id, i]));
  let best = null, bh = -1;
  for (const b of S.doc.items) if (b.kind === 'building' && G.pointInPolygon(w, b.pts)) { const top = M.bldElev(b, byId) + M.bldHeight(b); if (top > bh) { bh = top; best = b; } }
  return best;
}
function stackOn(parent, pts) {
  const byId = new Map(S.doc.items.map((i) => [i.id, i]));
  const it = newItem('building', pts, { floors: S.opts.building.floors, floorH: parent.props.floorH || 3.3, on: parent.id });
  if (parent.props.color) it.props.color = parent.props.color;
  checkpoint(); S.doc.items.push(it); S.selectedId = it.id; changed(); renderProps();
  toast(`Khối ${it.props.floors} tầng đặt trên mái ở cao độ ${G.fmtNum(M.bldElev(parent, byId) + M.bldHeight(parent))} m`);
}
// Công cụ Di chuyển: ưu tiên công trình nằm dưới điểm chạm, rồi mới tới đối tượng khác (trừ ô đất)
function hitMovable(w, sc) {
  const b = S.doc.items.filter((i) => i.kind === 'building' && !M.isLocked(S.doc, i)).reverse().find((i) => G.pointInPolygon(w, i.pts));
  if (b) return b;
  const hit = hitIso(S.doc, w, sc, true);
  return hit && hit.kind !== 'zone' && hit.kind !== 'cad' ? hit : null;
}
function armHold() {
  clearTimeout(holdTimer);
  holdTimer = setTimeout(() => {
    if (!drag || drag.kind !== 'stroke' || !S.stroke || S.stroke.snap) return;
    const raw = S.stroke.pts;
    if (raw.length < 4 || G.length(raw.map((q) => [q[0], q[1]])) < 25 / S.stroke.sc) return;
    S.stroke.snap = SH.snapShape(raw, S.stroke.sc);
    if (S.stroke.snap) {
      navigator.vibrate && navigator.vibrate(15);
      toast(S.stroke.snap.type === 'line' ? 'Đường thẳng – kéo tiếp để chỉnh điểm cuối' : S.stroke.snap.type === 'circle' ? `Đường tròn R = ${S.stroke.snap.r} m – kéo để chỉnh bán kính` : 'Đa giác cạnh thẳng');
      redrawLive();
    }
  }, HOLD_MS);
}

function toolMove(e, p, w, samples) {
  if (!drag) return;
  if (drag.kind === 'base') { baseMove(w); return; }
  if (drag.kind === 'measure') { if (w) measureMove(w, drag.sc); return; }
  if (drag.kind === 'stroke') {
    for (const sm of samples) { S.stroke.pts.push([sm.w[0], sm.w[1], sm.pressure]); S.stroke.screen.push(sm.p); }
    if (S.stroke.snap) SH.updateSnap(S.stroke.snap, w);
    else if (G.dist(p, drag.lastP) > 4 && !penShape()) { drag.lastP = p; armHold(); }
    if (penOn() && S.opts.pen.osnap && w) { // dấu bắt điểm khi bút đến gần
      const pr = S.stroke.pts.length > 8 ? S.stroke.pts[S.stroke.pts.length - 8] : null;
      S.osnapHint = AX.osnap(M.liveItems(S.doc).filter((i) => i.kind !== 'facet'), w, 16 / drag.sc, pr);
    }
    redrawLive();
    return;
  }
  const it = drag.id && S.doc.items.find((i) => i.id === drag.id);
  if (drag.kind === 'extrude') {
    if (!it) return;
    if (it.kind === 'facet') { facetDepthDrag(it, e); return; }
    const f = Math.max(1, Math.round(drag.floors + (drag.y - e.clientY) / 12));
    if (f !== it.props.floors) { it.props.floors = f; drag.moved = true; toast(`${f} tầng · cao ${G.fmtNum(f * (it.props.floorH || 3.3))} m`); changed({ save: false, light: true }); }
    return;
  }
  if (drag.kind === 'move') {
    if (G.dist(p, drag.start) > 4) drag.moved = true;
    if (!drag.moved || !it) return;
    Object.assign(it, JSON.parse(drag.orig));
    C.translateItem(it, w[0] - drag.startW[0], w[1] - drag.startW[1]);
    if (it.kind === 'building') {
      if (S.opts.snapMove) { const v = C.snapVector(S.doc, it, 12 / drag.sc); if (v) C.translateItem(it, v[0], v[1]); }
      C.pushInside(S.doc, it, drag.zone);
    }
    if (it.kind === 'road' && it.props.pis) it.props.pis = G.translatePts(JSON.parse(drag.orig).props.pis, w[0] - drag.startW[0], w[1] - drag.startW[1]);
    if (it.kind === 'road' && it.props.ctrl) it.props.ctrl = G.translatePts(JSON.parse(drag.orig).props.ctrl, w[0] - drag.startW[0], w[1] - drag.startW[1]);
    if (it.kind === 'building') { // khối chồng trên mái đi theo khối đỡ
      if (!drag.kids) { const ids = new Set([it.id]); drag.kids = []; let grow = true; while (grow) { grow = false; for (const k of S.doc.items) if (((k.kind === 'building' && k.props.on && ids.has(k.props.on)) || (k.kind === 'facet' && ids.has(k.props.parent)) || (k.props && k.props.grp && ids.has(k.props.grp))) && !ids.has(k.id)) { ids.add(k.id); drag.kids.push([k, JSON.stringify(k)]); grow = true; } } }
      if (drag.kids.length) { const c = G.centroid(it.pts), dx = c[0] - drag.c[0], dy = c[1] - drag.c[1]; for (const [k, o] of drag.kids) { Object.assign(k, JSON.parse(o)); C.translateItem(k, dx, dy); } }
    }
    changed({ save: false, light: true });
  } else if (drag.kind === 'rotate') {
    if (G.dist(p, drag.start) > 4) drag.moved = true;
    if (!drag.moved || !it) return;
    Object.assign(it, JSON.parse(drag.orig));
    const a = Math.atan2(w[1] - drag.c[1], w[0] - drag.c[0]) - Math.atan2(drag.startW[1] - drag.c[1], drag.startW[0] - drag.c[0]);
    C.rotateItem(it, a, drag.c);
    let par = false;
    if (S.opts.snapParallel) { const d = C.parallelDelta(S.doc, it, 6); if (d != null && Math.abs(d) > 1e-6) { C.rotateItem(it, d, drag.c); par = true; } else if (d != null) par = true; }
    C.pushInside(S.doc, it, drag.zone);
    drag.par = par;
    changed({ save: false, light: true });
  } else if (drag.kind === 'vertex') {
    if (!it) return;
    if (it.kind === 'circle') {
      if (drag.idx === 0) it.pts[0] = w; else it.props.radius = Math.max(5, Math.round(G.dist(w, it.pts[0])));
    } else if (it.kind === 'road' && it.props.pis) { it.props.pis[drag.idx] = w; setRoadGeometry(it); }
    else if (it.kind === 'road' && it.props.ctrl) { it.props.ctrl[drag.idx] = w; setRoadGeometry(it); }
    else {
      it.pts[drag.idx] = w;
      if (it.kind === 'building') { const z = C.zoneOf(S.doc, it); const bl = z && C.buildLine(z); if (bl && !G.pointInPolygon(w, bl)) it.pts[drag.idx] = G.distToPolyline(w, bl, true).q; }
    }
    drag.moved = true; changed({ save: false, light: true });
  } else if (drag.kind === 'erase') {
    if (drag.in3d && eraseFaceLine(e, drag.sc)) { drag.faceOnly = true; drag.pending = null; return; }
    if (drag.faceOnly) return; // đang quét xoá nét trên mặt khối: không xoá cả khối
    if (drag.pending) { if (G.dist(p, drag.start) < 8) return; drag.pending = null; }
    eraseAt(w, drag.sc);
  }
  else if (drag.kind === 'box') { drag.cx1 = e.clientX; drag.cy1 = e.clientY; drag.p1 = p; showSelBox(drag); }
  else if (drag.kind === 'gmove') groupMove(w);
  else if (drag.kind === 'circle') {
    const r = G.dist(w, S.circleDraft.c);
    if (r * drag.sc > 15) S.circleDraft.r = Math.round(r / 10) * 10;
    redrawLive();
  }
}

function toolUp(e, p, w, cancelled) {
  clearTimeout(holdTimer);
  if (!drag) return;
  if (drag.kind === 'base') { drag = null; changed(); renderToolOpts(); return; }
  const d = drag; drag = null;
  if (cancelled && d.kind === 'stroke') { S.stroke = null; redrawLive(); return; }
  if (cancelled && (d.kind === 'facetStroke' || d.kind === 'faceDraw')) { if (S.mode === '3d' && v3) draw3DOverlay(); return; } // ngón thứ hai chạm vào: bỏ nét đang vẽ trên mặt
  const tap = p && d.start ? G.dist(p, d.start) < 6 : false;
  switch (d.kind) {
    case 'stroke': {
      const st = S.stroke; S.stroke = null;
      const raw = st ? st.pts : [];
      S.osnapHint = null;
      const pg = !(st && st.snap) && penShape() && raw.length >= 2 ? penGeomFor(raw, d.sc) : null;
      if (st && pg) st.snap = pg;
      if (d.asTool) {
        const it = pg ? shapeByAxis(finishStroke(raw, d.sc, pg, 'sketch'), d.sc, 'pen', { circle: CURVED_PEN.has(pg.pen), pen: true }) : raw.length >= 2 && G.length(raw.map((q) => [q[0], q[1]])) > 6 / d.sc ? finishStroke(raw, d.sc, null, 'sketch') : null;
        if (it) { checkpoint(); S.doc.items.push(it); changed(); } else { redrawLive(); if (raw.length > 3) toast('Nét quá ngắn'); }
        break;
      }
      if (penShape() && !pg && !d.tapFill) { redrawLive(); if (raw.length > 3) toast('Nét quá ngắn'); break; }
      if (d.tapFill && !(st && st.snap) && (raw.length < 4 || G.length(raw.map((q) => [q[0], q[1]])) < 12 / d.sc)) {
        redrawLive();
        if (S.tool === 'face') { const par = S.doc.items.find((i) => i.id === d.parent); if (par) stackOn(par, par.pts.map((q) => [q[0], q[1]])); else toast('Chạm hoặc vẽ trên mái một công trình'); }
        else if (S.tool === 'cover') tapCover(d.startW, d.sc);
        else tapZone(d.startW);
        break;
      }
      if (S.tool === 'face') {
        const sh = finishStroke(raw, d.sc, st && st.snap, 'building');
        const par = S.doc.items.find((i) => i.id === d.parent) || (sh && topBuildingAt(G.centroid(sh.pts)));
        if (!sh || !par) { redrawLive(); toast(sh ? 'Hãy vẽ trên mái một công trình' : 'Hãy vẽ nét bao khép kín'); break; }
        if (M.isLocked(S.doc, par)) { redrawLive(); lockedToast(); break; }
        stackOn(par, sh.pts); break;
      }
      if (S.tool === 'zone') { if (!zoneStroke(raw, d.sc, st && st.snap)) { redrawLive(); if (raw.length > 3) toast('Nét quá ngắn'); } break; }
      const it = shapeByAxis(finishStroke(raw, d.sc, st && st.snap), d.sc, S.tool, { circle: st && st.snap && (st.snap.type === 'circle' || (st.snap.pen && CURVED_PEN.has(st.snap.pen))), pen: !!pg });
      S.osnapHint = null;
      if (it) {
        let clipped = false;
        if (it.kind === 'building') clipped = C.clipInside(S.doc, it);
        checkpoint(); S.doc.items.push(it); changed();
        if (clipped) toast('Công trình đã được giữ trong chỉ giới xây dựng');
      } else {
        redrawLive();
        if (['building', 'park', 'zone', 'cloud', 'land', 'cover'].includes(S.tool) && raw.length > 3) toast(pg && !PEN.geomClosed(pg) ? 'Lớp này cần hình khép kín: chọn hình (chữ nhật, tròn…) hoặc vẽ nét khép kín' : 'Hãy vẽ nét bao khép kín');
      }
      break;
    }
    case 'move': case 'vertex': case 'rotate':
      if (d.moved) {
        S.undo.push(d.snap); S.redo = [];
        const it = S.doc.items.find((i) => i.id === d.id);
        if (it && d.kind === 'vertex' && it.kind === 'building' && it.props.preset) { delete it.props.preset; toast('Khối mẫu đã chuyển thành hình tự do'); }
        if (it && d.kind === 'rotate' && d.par) toast('Đã xoay song song với đường');
        changed();
      }
      break;
    case 'extrude': if (d.moved) { S.undo.push(d.snap); S.redo = []; changed(); } break;
    case 'erase':
      if (d.pending && tap) { chooseItem(d.pending, 'Chọn đối tượng cần xoá', '🗑', (it) => { checkpoint(); S.doc.items = S.doc.items.filter((i) => i !== it); if (S.selectedId === it.id) S.selectedId = null; S.multi = S.multi.filter((x) => x !== it.id); changed(); renderProps(); toast('Đã xoá ' + itemDesc(it).name.toLowerCase()); }); break; }
      if (d.removed) { S.undo.push(d.snap); S.redo = []; changed(); } break;
    case 'choose': if (tap) chooseItem(d.list, 'Chọn đối tượng', '↖', (it) => { S.multi = []; S.selectedId = it.id; renderProps(); requestRender(); if (S.mode === '3d') schedule3D(); toast('Đã chọn ' + itemDesc(it).name.toLowerCase()); }); break;
    case 'box': hideSelBox(); finishBox(d, tap); break;
    case 'gmove': if (d.moved) { S.undo.push(d.snap); S.redo = []; changed(); } break;
    case 'measure': measureUp(tap); break;
    case 'tap': if (tap && d.penOp) { penTap(d.penOp, d.startW, d.sc); break; } if (tap) { if (S.tool === 'icon') placeIcon(d.startW); else if (S.tool === 'autolay') autoLayAt(d.startW); else if (S.tool === 'road') roadTap(d.startW, d.sc); else placePreset(d.startW); } break;
    case 'circle': {
      const it = newItem('circle', [S.circleDraft.c], { radius: S.circleDraft.r, label: '', color: S.opts.circle.color, width: S.opts.circle.width });
      S.circleDraft = null; checkpoint(); S.doc.items.push(it); S.selectedId = it.id; changed();
      break;
    }
  }
}

function placeIcon(w) {
  const o = S.opts.icon;
  const it = newItem('icon', [[w[0], w[1]]], { sym: o.sym, size: o.size, color: o.color || '', label: '', elev: o.elev ?? 4, showLabel: o.showLabel !== false });
  checkpoint(); S.doc.items.push(it); S.selectedId = it.id; changed(); renderProps();
  if (o.askInk) openInkPad(it);
}
// Vẽ lại nét đang vẽ (2D: vẽ cả cảnh; 3D: lớp phủ)
function redrawLive() { if (S.mode === '3d') draw3DOverlay(); else requestRender('ov'); }
function liveShapePts() {
  if (!S.stroke) return null;
  if (S.stroke.snap) { const sp = SH.snapPts(S.stroke.snap); return (S.stroke.snap.type === 'line' || S.stroke.snap.type === 'open' ? sp : sp.concat([sp[0]])).map((q) => [q[0], q[1], 0.6]); }
  const k = penShape();
  if (k && ['line', 'pline', 'circle', 'tri', 'rect', 'ellipse', 'penta', 'curve', 'organic'].includes(k) && S.stroke.pts.length >= 2) {
    const g = penGeomFor(S.stroke.pts, S.stroke.sc);
    if (g) { const sp = PEN.geomPts(g); return (PEN.geomClosed(g) ? sp.concat([sp[0]]) : sp).map((q) => [q[0], q[1], 0.6]); }
  }
  return S.stroke.pts;
}

// ---------------- Sự kiện 2D ----------------
canvas.addEventListener('pointerdown', (e) => {
  if (!S.doc) return;
  try { canvas.setPointerCapture(e.pointerId); } catch {}
  const p = local(e);
  if (e.pointerType === 'pen') penSeen = Date.now();
  closePop();
  if (e.pointerType === 'touch') {
    if (drag && drag.pointerType === 'touch') { clearTimeout(holdTimer); drag = null; S.stroke = null; S.circleDraft = null; }
    pointers.set(e.pointerId, { x: p[0], y: p[1], type: 'touch' });
    const n = touchCount();
    if (!gesture || n === 1) gesture = { t0: performance.now(), max: n, moved: false };
    gesture.max = Math.max(gesture.max, n);
    if (n === 2) startPinch();
    if (!(n === 1 && (S.baseEdit || (S.opts.fingerDraw && Date.now() - penSeen > 2000)))) { requestRender(); return; }
  } else {
    pointers.set(e.pointerId, { x: p[0], y: p[1], type: e.pointerType });
    if (e.pointerType === 'mouse' && (e.button === 1 || e.button === 2 || e.altKey)) { drag = { kind: 'pan', last: p, pointerId: e.pointerId, start: p }; return; }
    if (!isDrawPointer(e)) return;
  }
  toolDown(e, p, S.view.toWorld(p[0], p[1]), S.view.scale);
});

canvas.addEventListener('pointermove', (e) => {
  if (!S.doc) return;
  const p = local(e);
  const pt = pointers.get(e.pointerId);
  if (pt && pt.type === 'touch' && !(drag && drag.pointerId === e.pointerId)) {
    const dx = p[0] - pt.x, dy = p[1] - pt.y;
    pt.x = p[0]; pt.y = p[1];
    if (gesture && Math.hypot(dx, dy) > 2) gesture.moved = true;
    const n = touchCount();
    if (n === 1) { S.view.panBy(dx, dy); requestRender('view'); }
    else if (n >= 2) updatePinch();
    return;
  }
  if (!drag || drag.pointerId !== e.pointerId) return;
  if (pt) { pt.x = p[0]; pt.y = p[1]; }
  if (drag.kind === 'pan') { S.view.panBy(p[0] - drag.last[0], p[1] - drag.last[1]); drag.last = p; requestRender('view'); return; }
  const evs = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
  const samples = (evs.length ? evs : [e]).map((ce) => { const q = local(ce); return { p: q, w: S.view.toWorld(q[0], q[1]), pressure: ce.pressure || 0.5 }; });
  toolMove(e, p, S.view.toWorld(p[0], p[1]), samples);
});

function endPointer(e) {
  const pt = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  if (pt && pt.type === 'touch' && !(drag && drag.pointerId === e.pointerId)) {
    if (touchCount() < 2) pinch = null;
    if (touchCount() === 0 && gesture) {
      const dt = performance.now() - gesture.t0;
      if (!gesture.moved && dt < 350) {
        if (gesture.max === 2) undo(); else if (gesture.max === 3) redo();
        else if (gesture.max === 1 && S.axisPick && S.tool !== 'facet') { const p = local(e); axisPickAt(S.view.toWorld(p[0], p[1]), S.view.scale); }
        else if (gesture.max === 1 && S.tool === 'cover') { const p = local(e); tapCover(S.view.toWorld(p[0], p[1]), S.view.scale); }
        else if (gesture.max === 1 && S.tool === 'autolay') { const p = local(e); autoLayAt(S.view.toWorld(p[0], p[1])); } // chạm ngón tay cũng xếp khối
        else if (gesture.max === 1 && (S.tool === 'select' || S.tool === 'move')) {
          const p = local(e), w = S.view.toWorld(p[0], p[1]);
          const hit = S.tool === 'move' ? hitMovable(w, S.view.scale) : hitIso(S.doc, w, S.view.scale);
          S.selectedId = hit ? hit.id : null; renderProps(); requestRender();
        }
      }
      gesture = null;
    }
    return;
  }
  if (!drag || drag.pointerId !== e.pointerId) return;
  if (drag.kind === 'pan') { drag = null; scheduleViewSave(); return; }
  const p = local(e);
  toolUp(e, p, S.view.toWorld(p[0], p[1]), e.type === 'pointercancel');
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('gesturechange', (e) => e.preventDefault());
// Chặn Safari phóng to cả trang: chạm 2 ngón không bao giờ được thu phóng trang (vùng vẽ tự xử lý chụm ngón)
const blockMulti = (e) => { if (e.touches && e.touches.length > 1) e.preventDefault(); };
document.addEventListener('touchstart', blockMulti, { passive: false, capture: true });
document.addEventListener('touchmove', blockMulti, { passive: false, capture: true });
// Nếu trang lỡ bị phóng to thì tự đưa về 100%; nếu Safari đặt cỡ chữ trang (AA) khác 100% thì nhắc cách sửa
(() => {
  const vv = window.visualViewport; const meta = document.querySelector('meta[name=viewport]');
  if (!vv || !meta) return;
  const base = meta.content; let t = 0, bar = null;
  const iPad = /iPad|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document;
  const reset = () => {
    meta.content = base.replace('initial-scale=1', 'initial-scale=1.0001').replace('maximum-scale=1', 'maximum-scale=1.0001');
    setTimeout(() => { meta.content = base; window.scrollTo(0, 0); }, 60);
  };
  const banner = (msg, btn) => {
    if (!bar) { bar = document.createElement('div'); bar.className = 'zoombar'; document.body.append(bar); }
    bar.innerHTML = msg + (btn ? ' <button class="btn">Về 100%</button>' : '') + ' <button class="btn x">✕</button>';
    bar.querySelector('.x').onclick = () => { bar.remove(); bar = null; bar_off = Date.now(); };
    if (btn) bar.querySelector('.btn:not(.x)').onclick = () => { reset(); setTimeout(check, 400); };
  };
  let bar_off = 0;
  const check = () => {
    const zoomed = vv.scale > 1.02 || window.scrollX > 0 || window.scrollY > 0 || vv.offsetLeft > 1 || vv.offsetTop > 1;
    const pageZoom = iPad && Math.abs((window.devicePixelRatio || 2) - 2) > 0.05 ? Math.round(((window.devicePixelRatio || 2) / 2) * 100) : 0;
    if (zoomed) reset();
    if (Date.now() - bar_off < 60000) return;
    if (pageZoom) banner(`Safari đang phóng to trang ${pageZoom}%. Bấm <b>AA</b> trên thanh địa chỉ rồi bấm chữ <b>A</b> nhỏ cho tới khi về <b>100%</b>.`, false);
    else if (vv.scale > 1.02) banner('Trang đang bị phóng to.', true);
    else if (bar) { bar.remove(); bar = null; }
  };
  const fix = () => { clearTimeout(t); t = setTimeout(check, 300); };
  vv.addEventListener('resize', fix); vv.addEventListener('scroll', fix); window.addEventListener('resize', fix); window.addEventListener('scroll', fix);
  setTimeout(check, 1500);
  document.addEventListener('focusout', () => setTimeout(() => { if (!document.activeElement || document.activeElement === document.body) window.scrollTo(0, 0); }, 100));
})();
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

// 2 ngón: chụm/xoè = thu phóng; 2 ngón cùng dịch chuyển (khoảng cách không đổi) = kéo màn hình
function startPinch() {
  const t = [...pointers.values()].filter((p) => p.type === 'touch');
  const d = Math.hypot(t[0].x - t[1].x, t[0].y - t[1].y), m = [(t[0].x + t[1].x) / 2, (t[0].y + t[1].y) / 2];
  const a = Math.atan2(t[1].y - t[0].y, t[1].x - t[0].x);
  pinch = { d, m, d0: d, m0: m, mode: null, a, a0: a, rotOn: false };
}
function updatePinch() {
  const t = [...pointers.values()].filter((p) => p.type === 'touch');
  if (t.length < 2) return;
  if (!pinch) startPinch();
  const d = Math.hypot(t[0].x - t[1].x, t[0].y - t[1].y);
  const m = [(t[0].x + t[1].x) / 2, (t[0].y + t[1].y) / 2];
  const a = Math.atan2(t[1].y - t[0].y, t[1].x - t[0].x);
  const angDiff = (x, y) => { let r = x - y; while (r > Math.PI) r -= Math.PI * 2; while (r < -Math.PI) r += Math.PI * 2; return r; };
  const dd = Math.abs(d - pinch.d0), dm = Math.hypot(m[0] - pinch.m0[0], m[1] - pinch.m0[1]);
  // xoay bản vẽ 2D: hai ngón vặn quanh nhau quá 12° thì bắt đầu xoay (kèm thu phóng, kéo)
  if (S.mode !== '3d' && !pinch.rotOn && Math.abs(angDiff(a, pinch.a0)) > 0.21 && pinch.d0 > 60) { pinch.rotOn = true; pinch.a = a; if (!pinch.mode) { pinch.mode = 'zoom'; pinch.d = d; pinch.m = m; } }
  if (gesture && (dd > 6 || dm > 6)) gesture.moved = true;
  // nhận dạng cử chỉ ở đầu thao tác, sau đó giữ nguyên để không bị phóng to lẫn khi đang kéo
  if (!pinch.mode) {
    if (dd > Math.max(16, pinch.d0 * 0.1)) pinch.mode = 'zoom';
    else if (dm > 14 && dd < 10) pinch.mode = 'pan';
    if (pinch.mode) { pinch.d = pinch.d0; pinch.m = pinch.m0; } // áp cả đoạn đã di chuyển trước khi nhận dạng
  } else if (pinch.mode === 'pan' && dd > Math.max(40, pinch.d0 * 0.3)) pinch.mode = 'zoom';
  if (pinch.mode) {
    S.view.panBy(m[0] - pinch.m[0], m[1] - pinch.m[1]);
    if (pinch.mode === 'zoom' && pinch.d > 0) S.view.zoomAt(m[0], m[1], d / pinch.d);
    if (pinch.rotOn) {
      pinch.raw = (pinch.raw ?? S.view.rot) + angDiff(a, pinch.a);
      // hút về hướng Bắc lên trên và các góc vuông khi gần (±4°)
      const q = Math.round(pinch.raw / (Math.PI / 2)) * (Math.PI / 2);
      const target = Math.abs(pinch.raw - q) < 0.07 ? q : pinch.raw;
      S.view.rotateAt(m[0], m[1], angDiff(target, S.view.rot));
      syncNorthBtn();
    }
  }
  pinch.d = d; pinch.m = m; pinch.a = a;
  requestRender('view'); scheduleViewSave();
}
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const p = local(e);
  if (e.ctrlKey || Math.abs(e.deltaY) > Math.abs(e.deltaX) * 2 && !e.shiftKey) S.view.zoomAt(p[0], p[1], Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
  else S.view.panBy(-e.deltaX, -e.deltaY);
  requestRender('view'); scheduleViewSave();
}, { passive: false });
let viewTimer; function scheduleViewSave() { clearTimeout(viewTimer); viewTimer = setTimeout(() => S.doc && Store.putDrawing({ ...S.doc, view: { cx: S.view.cx, cy: S.view.cy, scale: S.view.scale, rot: S.view.rot || 0 } }, { markDirty: false }), heavyDelay(1500)); }

let lockToastAt = 0;
function lockedToast() { if (Date.now() - lockToastAt > 2500) { lockToastAt = Date.now(); toast('🔒 Đối tượng thuộc lớp đang khoá – mở khoá trong Quản lý lớp để sửa hoặc xoá'); } }
// Công cụ Xoá trong 3D: chạm / quét qua nét vẽ trên mặt khối thì xoá nét đó (không xoá khối).
// Trả về 'line' khi đã xoá một nét, 'face' khi đang ở mặt đang chọn (chế độ chọn mặt) mà không có nét gần đó.
function eraseFaceLine(e, sc) {
  if (!v3 || S.mode !== '3d') return null;
  const fc = pickFaceAt(v3, e.clientX, e.clientY); if (!fc) return null;
  const onSel = S.facetSel && sameFace(fc, S.facetSel);
  const sk = skOf(fc); const q = sk && faceLocal(v3, fc, e.clientX, e.clientY);
  if (sk && q) {
    const owner = S.doc.items.find((i) => i.id === fc.parent);
    const root = owner && rootOf(owner);
    if (FA.nearestEdge(sk, q, 14 / Math.max(0.05, sc))) {
      if (root && M.isLocked(S.doc, root)) { lockedToast(); return 'face'; }
      if (FA.eraseAt(sk, q, 14 / Math.max(0.05, sc))) {
        delete sk._sig; S.skSel = null; drag.removed++;
        changed({ save: false }); draw3DOverlay(); toast('Đã xoá nét trên mặt khối');
        return 'line';
      }
    }
  }
  return onSel ? 'face' : null; // chế độ chọn mặt: chạm trên mặt đang chọn chỉ xoá nét, không xoá cả khối
}
function eraseAt(w, sc) {
  const hit = penOp() === 'erase' ? hitsAt(w, sc, true).find(canEdit) || null : hitIso(S.doc, w, sc, true);
  if (!hit) { const any = hitIso(S.doc, w, sc); const ne = penOp() === 'erase' && hitsAt(w, sc, true).find((i) => !canEdit(i)); if (ne) { if (Date.now() - lockToastAt > 2500) { lockToastAt = Date.now(); noEditToast(ne); } } else if (any) lockedToast(); }
  if (hit) {
    S.doc.items = S.doc.items.filter((i) => i !== hit);
    if (S.selectedId === hit.id) S.selectedId = null;
    drag.removed++; changed({ save: false });
  }
}

// Tô ô đất: chạm (hoặc thả mã SDĐ) vào vùng khép kín giữa đường / ranh giới
function tapZone(w, code = S.opts.zone.code) {
  const lu = M.LANDUSE[code];
  const z = S.doc.items.filter((i) => i.kind === 'zone').reverse().find((i) => G.pointInPolygon(w, i.pts) && !(i.holes || []).some((hh) => G.pointInPolygon(w, hh)));
  if (z) {
    checkpoint();
    Object.assign(z.props, { code, maxMdxd: lu.mdxd, maxFar: lu.far, maxFloors: lu.floors });
    S.selectedId = z.id; changed(); toast(`Đã đổi ô đất thành ${M.luLabel(code)} – ${lu.name}`); return;
  }
  const poly = fillRegionAt(S.doc, w, [], { gap: gapTol() });
  if (!poly) { toast('Vùng này chưa được khép kín bởi đường hoặc ranh giới. Hãy khoanh vùng bằng bút.'); return; }
  const prev = S.opts.zone.code; S.opts.zone.code = code;
  const it = newZone(poly.map((q) => [q[0], q[1]])); S.opts.zone.code = prev;
  if (poly.holes && poly.holes.length) it.holes = poly.holes;
  checkpoint(); S.doc.items.push(it); carveAllJunctions(it); S.selectedId = it.id; changed();
  toast(`Đã phủ ${M.luLabel(code)} – ${lu.name} (${G.fmtArea(M.itemArea(it))})${it.holes ? ` · chừa ${it.holes.length} vùng kín bên trong` : ''}`);
}

function landProps(st) { const o = S.opts.land; return { style: st, spacing: o.spacing, size: o.size, tree: o.tree || 'round', vary: !!o.vary, name: '' }; }
// Chọn mẫu cây: mẫu có sẵn + mẫu nhập từ file
function treeLibChips(box, cur, onPick) {
  box.append(h('<span class="muted" style="font-size:12.5px">Mẫu cây:</span>'));
  for (const [k, t] of Object.entries(M.TREE_TYPES)) { const c = h(`<button class="chip ${cur === k ? 'on' : ''}">${t.name}</button>`); c.onclick = () => onPick(k); box.append(c); }
  for (const t of S.doc.settings.treeLib || []) { const c = h(`<button class="chip ${cur === t.id ? 'on' : ''}" title="Mẫu nhập từ file">📦 ${esc(t.name)}</button>`); c.onclick = () => onPick(t.id); box.append(c); }
  const add = h('<button class="chip add">＋ Nhập mẫu cây (.glb .gltf .obj)</button>');
  add.onclick = () => importTreeModel(onPick); box.append(add);
}
function importTreeModel(onPick) {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.glb,.gltf,.obj,model/gltf-binary,model/gltf+json';
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    if (f.size > 8 * 1048576) { toast('File mẫu cây quá lớn (tối đa 8 MB)'); return; }
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    if (!['glb', 'gltf', 'obj'].includes(ext)) { toast('Chỉ nhận file .glb, .gltf (nhúng sẵn ảnh) hoặc .obj'); return; }
    const data = await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(f); });
    const lib = S.doc.settings.treeLib || (S.doc.settings.treeLib = []);
    const id = 'lib_' + M.uid();
    lib.push({ id, name: f.name.replace(/\.[^.]+$/, '').slice(0, 30), fmt: ext === 'obj' ? 'obj' : 'gltf', data });
    changed(); toast('Đã thêm mẫu cây «' + f.name + '» vào thư viện của bản vẽ');
    onPick(id);
  };
  inp.click();
}
// Kéo thả kiểu cảnh quan (sân lát, thảm cỏ, bồn hoa, cụm cây) vào vùng khép kín
function landChipDrag(chip, style) {
  chip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const ghost = h(`<div class="chip on" style="position:fixed;z-index:80;pointer-events:none;left:${e.clientX}px;top:${e.clientY}px;transform:translate(-50%,-140%)"><span class="sw" style="background:${M.LAND_COLORS[style]}"></span>${M.LAND_STYLES[style].name}</div>`);
    let moved = false;
    const mv = (ev) => { if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) > 8 && !moved) { moved = true; document.body.append(ghost); } ghost.style.left = ev.clientX + 'px'; ghost.style.top = ev.clientY + 'px'; };
    const up = (ev) => {
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); ghost.remove();
      if (!moved) { S.opts.land.style = style; saveOpts(); renderToolOpts(); return; }
      const w = worldAtClient(ev.clientX, ev.clientY);
      if (w) landFillAt(w, style);
    };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  });
}
function landFillAt(w, style) {
  const poly = fillRegionAt(S.doc, w, [], { land: true, gap: gapTol() });
  if (!poly) { toast('Vùng này chưa khép kín (bởi đường, công trình, mép ô đất hoặc cảnh quan khác)'); return; }
  const it = newItem('land', poly, landProps(style));
  checkpoint(); S.doc.items.push(it); S.selectedId = it.id; changed();
  toast(`Đã phủ ${M.LAND_STYLES[style].name} (${G.fmtArea(M.itemArea(it))})`);
}

// Kéo thả mã SDĐ từ thanh công cụ vào vùng khép kín
function chipDrag(chip, code) {
  chip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const ghost = h(`<div class="chip on" style="position:fixed;z-index:80;pointer-events:none;left:${e.clientX}px;top:${e.clientY}px;transform:translate(-50%,-140%)"><span class="sw" style="background:${M.LANDUSE[code].color}"></span>${esc(M.luLabel(code))}</div>`);
    let moved = false, held = false;
    // nhấn giữ 0,6 giây: mở bảng đổi màu, tên, chỉ tiêu của mã này
    const hold = setTimeout(() => { if (moved) return; held = true; window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); ghost.remove(); openLanduseDialog(code); }, 600);
    const mv = (ev) => { if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) > 8 && !moved) { moved = true; clearTimeout(hold); document.body.append(ghost); } ghost.style.left = ev.clientX + 'px'; ghost.style.top = ev.clientY + 'px'; };
    const up = (ev) => {
      clearTimeout(hold); if (held) return;
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); ghost.remove();
      if (!moved) { S.opts.zone.code = code; saveOpts(); renderToolOpts(); return; }
      const w = worldAtClient(ev.clientX, ev.clientY);
      if (w) tapZone(w, code);
    };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  });
}
function worldAtClient(x, y) {
  const r = $('#stage').getBoundingClientRect();
  if (x < r.left || y < r.top || x > r.right || y > r.bottom) return null;
  if (S.mode === '3d') return v3 ? v3.groundAt(x, y) : null;
  return S.view.toWorld(x - r.left, y - r.top);
}

// ---------------- Sự kiện 3D: vẽ trực tiếp trên mặt đất ----------------
const touch3d = new Set();
let tap3d = null;
function bind3DInput(v) {
  const el = $('#v3d');
  const opt = { capture: true };
  // «Nhìn thẳng mặt»: chụm / mở hai ngón để thu phóng (tự xử lý, vì ngón đầu thường chạm trúng khối), không xoay
  const pin = new Map(); let pd0 = 0;
  const pdist = () => { const [a, b] = [...pin.values()]; return Math.hypot(a[0] - b[0], a[1] - b[1]); };
  el.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'touch') return; pin.set(e.pointerId, [e.clientX, e.clientY]); if (pin.size === 2) pd0 = pdist(); }, opt);
  el.addEventListener('pointermove', (e) => {
    if (!pin.has(e.pointerId)) return;
    pin.set(e.pointerId, [e.clientX, e.clientY]);
    if (!S.lookLock || pin.size !== 2 || !pd0) return;
    const d1 = pdist(); if (d1 < 4) return;
    const t = v.controls.target, c = v.camera.position, k = pd0 / d1, cur = c.distanceTo(t);
    const nd = Math.min(5000, Math.max(0.8, cur * k));
    c.sub(t).setLength(nd).add(t); v.controls.update(); pd0 = d1;
    e.stopPropagation();
  }, opt);
  const pinUp = (e) => { pin.delete(e.pointerId); if (pin.size < 2) pd0 = 0; };
  el.addEventListener('pointerup', pinUp, opt); el.addEventListener('pointercancel', pinUp, opt);
  const loc = (e) => { const r = el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  el.addEventListener('pointerdown', (e) => {
    if (S.mode !== '3d' || !S.doc) return;
    if (e.pointerType === 'pen') penSeen = Date.now();
    if (e.pointerType === 'touch') {
      touch3d.add(e.pointerId);
      tap3d = touch3d.size === 1 ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() } : null;
      // Vẽ bằng ngón tay: 1 ngón vẽ; ngón thứ 2 chạm vào thì huỷ nét và chuyển sang xoay
      const pushHit = (S.tool === 'push' || S.tool === 'facet') && touch3d.size === 1 && v.pickBuilding(e.clientX, e.clientY);
      if (!pushHit && !(S.opts.fingerDraw && touch3d.size === 1 && Date.now() - penSeen > 2000)) {
        if (drag && drag.in3d && drag.touch) toolUp(e, drag.start, drag.startW, true);
        return;
      }
    } else if (!isDrawPointer(e)) return; // chuột phải: xoay, kéo, thu phóng
    closePop();
    const p = loc(e);
    const w = v.groundAt(e.clientX, e.clientY);
    if (S.tool === 'facet') {
      const hitF = pickFaceAt(v, e.clientX, e.clientY);
      let fc = hitF, alt = null;
      // ưu tiên mặt đang chọn khi nét bắt đầu trên/sát mặt đó (trừ khi chạm vào mặt của mảng lồng bên trong); mặt trúng dưới điểm đầu nét làm phương án dự phòng
      const drawMode = facetMode() !== 'stroke';
      if (S.facetSel && !sameFace(hitF, S.facetSel) && !(hitF && insideFace(hitF, S.facetSel)) && !(drawMode && hitF && !S.isoFace)) {
        const F = frameFor(S.facetSel);
        const q0 = F && faceLocal(v, S.facetSel, e.clientX, e.clientY);
        if (q0) {
          const bb = G.bbox(F.base), w0 = F.pt(q0, 0.08), mg = (S.isoFace ? 4000 : 40) / v.pxPerMeter([w0[0], w0[2]], Math.max(0.02, w0[1]));
          if (q0[0] > bb.x0 - mg && q0[0] < bb.x1 + mg && q0[1] > bb.y0 - mg && q0[1] < bb.y1 + mg) { alt = S.isoFace ? null : hitF; fc = { ...S.facetSel, point: w0, facetId: hitF && sameFace(hitF, S.facetSel) ? hitF.facetId : regionAt(S.facetSel, q0) }; }
        }
      }
      if (!fc) { if (e.pointerType !== 'mouse') toast('Chạm vào mái hoặc mặt đứng của một công trình'); return; }
      if (S.isoFace && S.facetSel && !sameFace(fc, S.facetSel)) { toast('Đang «Khóa mặt»: bỏ tích để chọn mặt khác'); return; }
      e.stopPropagation(); e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch {}
      const pw = v.groundAt(e.clientX, e.clientY);
      const sc0 = fc.point ? v.pxPerMeter([fc.point[0], fc.point[2]], Math.max(0.02, fc.point[1])) : pw ? v.pxPerMeter(pw) : 4;
      if (penOn() && S.opts.pen.op === 'offset') { S.facetSel = { parent: fc.parent, face: fc.face }; facetOffset(S.opts.pen.D ?? 1); renderToolOpts(); draw3DOverlay(); return; }
      if (facetMode() !== 'stroke') { faceToolDown(v, e, fc, sc0); return; }
      const q = facetSnap(fc, faceLocal(v, fc, e.clientX, e.clientY), sc0, null);
      const qa = alt && faceLocal(v, alt, e.clientX, e.clientY);
      drag = { kind: 'facetStroke', pointerId: e.pointerId, in3d: true, fc, hit: hitF, alt, altPts: qa ? [qa] : [], pts: q ? [q] : [], x0: e.clientX, y0: e.clientY, t0: performance.now(), sc: sc0, touch: e.pointerType === 'touch' };
      if (!S.facetSel) { S.facetSel = { parent: fc.parent, face: fc.face }; renderToolOpts(); }
      draw3DOverlay(); return;
    }
    if (S.tool === 'select' || S.tool === 'move') {
      let hitId = v.pickBuilding(e.clientX, e.clientY);
      if (hitId && !inIsoFace(S.doc.items.find((i) => i.id === hitId))) { toast('Đang «Khóa mặt»: chỉ chọn được mảng trên mặt đang chọn'); hitId = null; }
      if (hitId && (S.tool === 'move' || S.subTool === 'selbld')) { const hi = S.doc.items.find((i) => i.id === hitId); if (hi && hi.kind === 'facet') hitId = rootOf(hi).id; }
      const pick3 = S.tool === 'select' ? S.opts.selPick || 'top' : 'top';
      if (pick3 === 'list') e.allIds = v.pickAll(e.clientX, e.clientY);
      if (!hitId && e.pointerType === 'mouse' && pick3 !== 'box') { if (S.selectedId || S.multi.length) { S.selectedId = null; S.multi = []; renderProps(); schedule3D(); } return; } // chuột trái vào nền: xoay
      e.stopPropagation(); e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch {}
      if (hitId && e.pointerType === 'pen' && S.tool === 'select' && pick3 === 'top') {
        const it = S.doc.items.find((i) => i.id === hitId);
        S.selectedId = hitId; renderProps();
        drag = { kind: 'extrude', pointerId: e.pointerId, id: hitId, y: e.clientY, floors: it.props.floors, d0: it.props.depth || 0, sc: w ? v.pxPerMeter(w) : 4, snap: snapItems(), start: p, in3d: true };
        schedule3D(); return;
      }
      if (!w) { if (pick3 === 'box') toolDown(Object.assign(e, { hitId }), p, [0, 0], 4, true); return; }
      toolDown(Object.assign(e, { hitId }), p, w, v.pxPerMeter(w), true);
      return;
    }
    e.stopPropagation(); e.preventDefault();
    let ww = w;
    if (S.tool === 'face' || S.tool === 'push') {
      let hitId = v.pickBuilding(e.clientX, e.clientY);
      if (hitId && S.tool === 'push' && !inIsoFace(S.doc.items.find((i) => i.id === hitId))) { toast('Đang «Khóa mặt»: chỉ kéo được mảng trên mặt đang chọn'); return; }
      if (hitId && S.tool === 'face') { const hi = S.doc.items.find((i) => i.id === hitId); if (hi && hi.kind === 'facet') hitId = rootOf(hi).id; }
      e.hitId = hitId;
      if (hitId && S.tool === 'face') {
        const byId = new Map(S.doc.items.map((i) => [i.id, i])); const b = byId.get(hitId);
        e.planeH = M.bldElev(b, byId) + M.bldHeight(b);
        ww = v.planeAt(e.clientX, e.clientY, e.planeH) || w;
      }
    }
    if (!ww) return;
    try { el.setPointerCapture(e.pointerId); } catch {}
    toolDown(e, p, ww, v.pxPerMeter(ww), true);
    if (drag) drag.touch = e.pointerType === 'touch';
  }, opt);
  const untouch = (e) => {
    touch3d.delete(e.pointerId);
    // chạm nhanh 1 ngón vào khối: chọn công trình để đổi tầng cao
    if (e.type === 'pointerup' && tap3d && tap3d.id === e.pointerId && performance.now() - tap3d.t < 350 && Math.hypot(e.clientX - tap3d.x, e.clientY - tap3d.y) < 10 && S.mode === '3d') {
      if (S.tool === 'autolay') { const w = v.groundAt(e.clientX, e.clientY); if (w) autoLayAt(w); tap3d = null; return; }
      if (S.tool === 'cover' || (S.axisPick && S.tool !== 'facet')) { const w = v.groundAt(e.clientX, e.clientY); if (w) { if (S.axisPick) axisPickAt(w, v.pxPerMeter(w)); else tapCover(w, v.pxPerMeter(w)); } tap3d = null; return; }
      const id = v.pickBuilding(e.clientX, e.clientY);
      if (id || S.selectedId) { S.selectedId = id || null; renderProps(); schedule3D(); if (id) toast('Đã chọn công trình · đổi số tầng ở bảng bên phải'); }
    }
    tap3d = null;
  };
  el.addEventListener('pointerup', untouch, opt); el.addEventListener('pointercancel', untouch, opt);
  el.addEventListener('pointermove', (e) => {
    if (!drag && S.tool === 'facet' && S.faceDraft && e.pointerType !== 'touch') { const q = faceLocal(v, S.faceDraft.fc, e.clientX, e.clientY); if (q) { const w0 = frameFor(S.faceDraft.fc).pt(q); S.faceHover = facetSnap(S.faceDraft.fc, q, v.pxPerMeter([w0[0], w0[2]]), null, draftAnchor()); draw3DOverlay(); } return; }
    if (!drag || drag.pointerId !== e.pointerId || !drag.in3d) return;
    e.stopPropagation();
    if (drag.kind === 'faceDraw') { faceToolMove(v, e); return; }
    if (drag.kind === 'facetStroke') { drag.maxD = Math.max(drag.maxD || 0, Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0)); const q = facetSnap(drag.fc, faceLocal(v, drag.fc, e.clientX, e.clientY), drag.sc, drag); if (q) drag.pts.push(q); if (drag.alt) { const qa = faceLocal(v, drag.alt, e.clientX, e.clientY); if (qa) drag.altPts.push(qa); } draw3DOverlay(); return; }
    if (drag.kind === 'extrude') {
      const it = S.doc.items.find((i) => i.id === drag.id); if (!it) return;
      if (it.kind === 'facet') { facetDepthDrag(it, e); return; }
      const f = Math.max(1, Math.round(drag.floors + (drag.y - e.clientY) / 12));
      if (f !== it.props.floors) { it.props.floors = f; drag.moved = true; toast(`${f} tầng · cao ${G.fmtNum(f * (it.props.floorH || 3.3))} m`); changed({ save: false, light: true }); }
      return;
    }
    const p = loc(e);
    const gat = (x, y) => (drag.planeH != null ? v.planeAt(x, y, drag.planeH) : v.groundAt(x, y));
    const w = gat(e.clientX, e.clientY); if (!w) return;
    const evs = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
    const samples = (evs.length ? evs : [e]).map((ce) => { const r = el.getBoundingClientRect(); const q = [ce.clientX - r.left, ce.clientY - r.top]; return { p: q, w: gat(ce.clientX, ce.clientY) || w, pressure: ce.pressure || 0.5 }; });
    toolMove(e, p, w, samples);
  }, opt);
  const end = (e) => {
    if (!drag || drag.pointerId !== e.pointerId || !drag.in3d) return;
    e.stopPropagation();
    if (drag.kind === 'extrude') { const d = drag; drag = null; if (d.moved) { S.undo.push(d.snap); S.redo = []; changed(); } return; }
    if (drag.kind === 'facetStroke') { const d = drag; drag = null; finishFacetStroke(v, d, e); return; }
    if (drag.kind === 'faceDraw') { const d = drag; drag = null; faceToolUp(v, d, e); return; }
    const p = loc(e);
    const w = (drag.planeH != null ? v.planeAt(e.clientX, e.clientY, drag.planeH) : v.groundAt(e.clientX, e.clientY)) || drag.startW;
    toolUp(e, p, w, e.type === 'pointercancel');
  };
  el.addEventListener('pointerup', end, opt);
  el.addEventListener('pointercancel', end, opt);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}
// ---------------- Chia mặt khối (3D) ----------------
// ---------------- Mặt khối: chọn mặt, vẽ nét trên mặt, chỉnh riêng khối / mặt ----------------
const docById = () => new Map(S.doc.items.map((i) => [i.id, i]));
function frameFor(fc) { return fc && S.doc ? FA.frameOf(docById(), fc.parent, fc.face) : null; }
function rootOf(it, byId = docById()) { let r = it, k = 0; while (r && r.kind === 'facet' && k++ < 40) r = byId.get(r.props.parent); return r || it; }
const sameFace = (a, b) => !!(a && b && a.parent === b.parent && a.face === b.face);
function faceLabel(fc) {
  const p = S.doc.items.find((i) => i.id === fc.parent); if (!p) return '';
  if (p.kind === 'facet') return fc.face === 'top' ? 'mặt đầu của mảng' : 'mặt bên ' + (fc.face + 1) + ' của mảng';
  return fc.face === 'top' ? 'mái' : 'mặt đứng ' + (fc.face + 1);
}
// mặt fc nằm trên một mảng (lồng nhiều cấp) thuộc mặt sel
function insideFace(fc, sel) {
  if (!fc || !sel) return false;
  const byId = docById(); let p = byId.get(fc.parent), k = 0;
  while (p && p.kind === 'facet' && k++ < 40) { if (sameFace({ parent: p.props.parent, face: p.props.face }, sel)) return true; p = byId.get(p.props.parent); }
  return false;
}
function regionAt(fc, q) {
  if (!q) return null;
  const f = FA.faceFacets(S.doc, fc.parent, fc.face).find((x) => G.pointInPolygon(q, x.props.poly) && !(x.props.holes || []).some((hh) => G.pointInPolygon(q, hh)));
  return f ? f.id : null;
}
// «Khóa khối»: chỉ chọn / thao tác với khối đang chỉnh và các đối tượng thuộc khối đó
let ISO_C = null;
function isoSet() {
  const items = S.doc.items;
  if (ISO_C && ISO_C.iso === S.iso && ISO_C.items === items && ISO_C.n === items.length) return ISO_C.set;
  const byId = new Map(items.map((i) => [i.id, i])), memo = new Map();
  const ok = (it) => {
    if (memo.has(it.id)) return memo.get(it.id);
    let r = it, k = 0, res = false;
    while (r && k++ < 40) {
      if (r.id === S.iso || (r.props && r.props.grp === S.iso)) { res = true; break; }
      if (memo.has(r.id) && r !== it) { res = memo.get(r.id); break; }
      if (r.kind === 'facet') r = byId.get(r.props.parent);
      else if (r.kind === 'building' && r.props.on) r = byId.get(r.props.on);
      else break;
    }
    memo.set(it.id, res); return res;
  };
  const set = new Set(); for (const it of items) if (ok(it)) set.add(it.id);
  ISO_C = { iso: S.iso, items, n: items.length, set };
  return set;
}
function inIso(it) {
  if (!S.iso || !it) return true;
  return isoSet().has(it.id);
}
// «Khóa mặt»: chỉ các mảng nằm trên mặt đang chọn
function inIsoFace(it) {
  if (!S.isoFace || !S.facetSel) return true;
  if (!it || it.kind !== 'facet') return false;
  const byId = docById(); let f = it, k = 0;
  while (f && f.kind === 'facet' && k++ < 40) { if (sameFace({ parent: f.props.parent, face: f.props.face }, S.facetSel)) return true; f = byId.get(f.props.parent); }
  return false;
}
const faceIsoOk = (fc) => !S.isoFace || !S.facetSel || sameFace(fc, S.facetSel) || insideFace(fc, S.facetSel);
function hitIso(doc, w, sc, x) { const r = hitTest(doc, w, sc, x); return r && inIso(r) ? r : null; }
function setIso(id) {
  const was = S.iso;
  S.iso = id || null; ISO_C = null;
  if (!S.iso) S.isoFace = false;
  if (S.iso && !was) { // nhớ khung nhìn trước khi khóa
    S.isoPrev = { v: { cx: S.view.cx, cy: S.view.cy, scale: S.view.scale, rot: S.view.rot || 0 }, c: v3 ? { p: v3.camera.position.clone(), t: v3.controls.target.clone() } : null };
  }
  build3D(); renderProps(); renderToolOpts(); requestRender(); syncIsoBar();
  if (S.iso) focusIso();
  else if (was && S.isoPrev) { // thoát: trả lại khung nhìn cũ
    const P = S.isoPrev; S.isoPrev = null;
    Object.assign(S.view, P.v); requestRender(); scheduleViewSave();
    if (P.c && v3 && !S.lookLock) { v3.camera.position.copy(P.c.p); v3.controls.target.copy(P.c.t); v3.controls.update(); }
  }
  toast(S.iso ? 'Khóa khối: chỉ chọn và sửa được khối này, đối tượng khác mờ đi; đối tượng vẽ mới thuộc khối' : 'Đã bỏ khóa khối');
}
// đưa khung nhìn (2D và 3D) về khối đang khóa
function focusIso() {
  const ids = isoSet(), its = S.doc.items.filter((i) => ids.has(i.id) && i.pts && i.pts.length);
  const b = S.doc.items.find((i) => i.id === S.iso); if (!b) return;
  const bb = G.robustBBox(its.map((i) => i.pts)) || G.bbox(b.pts);
  const c = [(bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2], w = Math.max(6, bb.x1 - bb.x0), hgt = Math.max(6, bb.y1 - bb.y0);
  // vùng nhìn còn trống (trừ thanh công cụ trái và bảng thuộc tính bên phải nếu đang mở)
  const cr = $('#c2d').getBoundingClientRect(), tb = $('#toolbar').getBoundingClientRect(), pr = $('#props');
  const L = Math.max(0, tb.right - cr.left), Rr = pr && !pr.hidden && pr.offsetWidth ? Math.max(L + 200, pr.getBoundingClientRect().left - cr.left) : S.view.w;
  const aw = Math.max(200, Rr - L);
  S.view.cx = c[0]; S.view.cy = c[1];
  S.view.scale = Math.min(40, Math.min((aw * 0.6) / w, (S.view.h * 0.55) / hgt));
  { const want = S.view.toWorld((L + Rr) / 2, S.view.h / 2); S.view.cx += c[0] - want[0]; S.view.cy += c[1] - want[1]; }
  requestRender(); scheduleViewSave();
  if (v3 && !S.lookLock) {
    let top = 0; for (const i of its) if (i.kind === 'building') top = Math.max(top, M.bldElev(i, docById()) + M.bldHeight(i));
    v3.focusOn(c, Math.hypot(w, hgt) / 2, top || 10);
  }
}
function syncIsoBar() {
  let bar = document.getElementById('isoBar');
  const on = S.doc && (S.iso || (S.isoFace && S.facetSel) || S.lookLock);
  if (!on) { if (bar) bar.hidden = true; return; }
  if (!bar) { bar = h('<div id="isoBar" class="iso-bar"><span></span><button class="chip">Thoát</button></div>'); $('#editor').append(bar); bar.querySelector('button').onclick = () => { setLookLock(false); if (S.iso) setIso(null); else { S.isoFace = false; renderToolOpts(); requestRender(); syncIsoBar(); } }; }
  bar.hidden = false;
  const b = S.iso && S.doc.items.find((i) => i.id === S.iso);
  bar.querySelector('span').innerHTML = [b ? (S.isoFace || S.lookLock ? `🔒 <b>${b.props.floors || ''}T</b>` : `🔒 Khóa khối <b>${b.props.floors || ''}T</b>`) : '', S.isoFace && S.facetSel ? `▣ <b>${faceLabel(S.facetSel)}</b>` : '', S.lookLock ? '👁' : ''].filter(Boolean).join(' · ');
}
function setIsoFace(on) {
  S.isoFace = !!on && !!S.facetSel; syncIsoBar(); renderToolOpts();
  toast(S.isoFace ? 'Khóa mặt: chỉ thao tác trên mặt này và các mảng của nó' : 'Đã bỏ khóa mặt');
}
// «Nhìn thẳng mặt» bật / tắt: bật thì nút xanh, camera luôn nhìn thẳng mặt, chỉ phóng to / thu nhỏ, không xoay
function lookBtn() {
  const b = h(`<button class="chip ${S.lookLock ? 'on look-on' : ''}">👁 Nhìn thẳng mặt</button>`);
  b.onclick = () => { if (S.lookLock) setLookLock(false); else if (S.facetSel) setLookLock(true); };
  return b;
}
function setLookLock(on) {
  const was = !!S.lookLock;
  S.lookLock = on && S.facetSel ? { ...S.facetSel } : null;
  if (v3) lockControls(v3);
  if (S.lookLock) {
    if (S.mode !== '3d') setMode('3d').then(() => lookAtFace(S.lookLock)); else lookAtFace(S.lookLock);
    if (!was) toast('Nhìn thẳng mặt: chỉ phóng to / thu nhỏ; bấm lại nút để xoay tự do');
  } else if (was) toast('Đã tắt nhìn thẳng mặt');
  syncIsoBar(); renderToolOpts();
}
// Nhìn thẳng mặt: chặn xoay / kéo lệch; cảm ứng hai ngón do bind3DInput tự thu phóng; con lăn chuột vẫn thu phóng
function lockControls(v) {
  const L = !!S.lookLock;
  v.controls.enableRotate = !L; v.controls.enablePan = !L;
  v.controls.touches = L ? { ONE: null, TWO: null } : { ONE: 0, TWO: 2 } // THREE.TOUCH.ROTATE, DOLLY_PAN;
}
// đang Nhìn thẳng mặt mà chọn sang mặt khác: nhìn thẳng mặt mới
function syncLookLock() {
  if (S.lookLock && S.facetSel && !sameFace(S.lookLock, S.facetSel)) { S.lookLock = { ...S.facetSel }; lookAtFace(S.lookLock); syncIsoBar(); }
}
// đặt camera nhìn thẳng vào mặt
function lookAtFace(fc) {
  const F = frameFor(fc); if (!F || !v3) return;
  const bb = G.bbox(F.base), c = [(bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2], C = F.pt(c, 0);
  const dist = Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0) * 1.3 + 8;
  const up = Math.abs(F.N[1]) > 0.9 ? 0.02 : 0;
  v3.camera.position.set(C[0] + F.N[0] * dist - F.V[0] * dist * up, C[1] + F.N[1] * dist, C[2] + F.N[2] * dist - F.V[2] * dist * up);
  v3.controls.target.set(C[0], C[1], C[2]); v3.controls.update();
  setTimeout(draw3DOverlay, 30);
}
// Mặt khối dưới con trỏ: { parent (công trình hoặc mảng), face: 'top' | chỉ số cạnh, facetId?, point }
function pickFaceAt(v, cx, cy) {
  const r = v.pickFace(cx, cy); if (!r || !r.id) return null;
  const byId = docById(); const it = byId.get(r.id); if (!it) return null;
  const root = rootOf(it, byId);
  if (!root || root.kind !== 'building') return null;
  if (M.isLocked(S.doc, root)) { lockedToast(); return null; }
  if (!inIso(it)) return null;
  const n = r.n || [0, r.ny, 0];
  const nearest = (P, q) => { let best = 0, bd = Infinity; for (let i = 0; i < P.length; i++) { const d = G.distToSegment(q, P[i], P[(i + 1) % P.length]).d; if (d < bd) { bd = d; best = i; } } return best; };
  if (it.kind === 'facet') {
    const d = it.props.depth || 0;
    if (Math.abs(d) < 0.05) return { parent: it.props.parent, face: it.props.face, facetId: it.id, point: r.point };
    const F0 = FA.frameOf(byId, it.props.parent, it.props.face); if (!F0) return null;
    if (Math.abs(n[0] * F0.N[0] + n[1] * F0.N[1] + n[2] * F0.N[2]) > 0.7) return { parent: it.id, face: 'top', facetId: it.id, point: r.point };
    return { parent: it.id, face: nearest(it.props.poly, F0.loc(r.point)), facetId: it.id, point: r.point };
  }
  const y0 = M.bldElev(it, byId), H = M.bldHeight(it);
  if (Math.abs(n[1]) > 0.7) return r.point[1] > y0 + H / 2 ? { parent: it.id, face: 'top', point: r.point } : null;
  return { parent: it.id, face: nearest(it.pts, [r.point[0], r.point[2]]), point: r.point };
}
// toạ độ trên mặt -> [x, cao, y] trong không gian
function faceWorld(fc, _b, q) { const F = frameFor(fc); return F ? F.pt(q, 0.08) : [0, 0, 0]; }
// điểm con trỏ chiếu lên mặt phẳng của mặt khối -> toạ độ trên mặt
function faceLocal(v, fc, cx, cy) { const F = frameFor(fc); if (!F) return null; const P = v.rayPlane(cx, cy, F.N, F.o); return P ? F.loc(P) : null; }
const skOf = (fc, create) => { const p = fc && S.doc.items.find((i) => i.id === fc.parent); return p ? FA.getSk(p, fc.face, create) : null; };
const skId = () => Math.random().toString(36).slice(2, 8);
// Đường dóng + góc vuông: hút điểm về đỉnh, trung điểm, cạnh có sẵn; gióng theo hoành độ / tung độ; góc 90° theo điểm neo
function facetSnap(fc, q, sc, d, anchor) {
  if (!q) return q;
  if (d) d.guides = [];
  const F = frameFor(fc); if (!F) return q;
  const tol = 14 / Math.max(0.05, sc);
  const rings = [F.base, ...F.holes, ...FA.faceFacets(S.doc, fc.parent, fc.face).map((f) => f.props.poly)];
  const pts = [], segs = [];
  for (const P of rings) for (let i = 0; i < P.length; i++) { const a = P[i], c = P[(i + 1) % P.length]; pts.push(a, [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2]); segs.push([a, c]); }
  const sk = skOf(fc);
  for (const e of (sk && sk._edges) || []) { pts.push(e.a, e.b, [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2]); segs.push([e.a, e.b]); }
  if (S.faceDraft && S.faceDraft.pts) pts.push(...S.faceDraft.pts);
  const guides = S.opts.facet.guides !== false;
  if (anchor && axisOn('facet') && ['line', 'pline'].includes(facetMode())) { // trục vẽ trên mặt: hướng 90° / 45° theo cạnh mặt + góc xoay trục
    const a0 = FA.axisAngle(F) + axisRad(), step = ((S.opts.axis.step || 90) * Math.PI) / 180;
    const dv = [q[0] - anchor[0], q[1] - anchor[1]], L = Math.hypot(dv[0], dv[1]);
    const k = Math.round((Math.atan2(dv[1], dv[0]) - a0) / step), dir = a0 + k * step, ux = Math.cos(dir), uy = Math.sin(dir);
    const t = dv[0] * ux + dv[1] * uy;
    if (L < 1e-9 || (S.opts.axis.step || 90) !== 90 || Math.abs(k) % 1 !== 0) { if (L < 1e-9) return q; if ((S.opts.axis.step || 90) !== 90 || (((k % 2) + 2) % 2 === 1) === false) { /* hướng 45° hoặc trục: không gióng thêm */ } }
    if ((S.opts.axis.step || 90) !== 90) return [anchor[0] + ux * t, anchor[1] + uy * t];
    const a = a0; const r = FA.rot([ux * t, uy * t], -a);
    const hor = Math.abs(r[0]) >= Math.abs(r[1]); if (hor) r[1] = 0; else r[0] = 0;
    if (guides) { // gióng đầu mút theo đỉnh có sẵn
      const ra = FA.rot(anchor, -a); let best = null, bd = tol;
      for (const p of pts) { const rp = FA.rot(p, -a), dd = hor ? Math.abs(ra[0] + r[0] - rp[0]) : Math.abs(ra[1] + r[1] - rp[1]); if (dd < bd) { bd = dd; best = rp; } }
      if (best) { if (hor) r[0] = best[0] - ra[0]; else r[1] = best[1] - ra[1]; if (d) d.guides.push({ pt: FA.rot(best, a) }); }
    }
    const b = FA.rot(r, a); return [anchor[0] + b[0], anchor[1] + b[1]];
  }
  if (!guides) return q;
  let best = null, bd = tol;
  for (const p of pts) { const dd = G.dist(p, q); if (dd < bd) { bd = dd; best = p; } }
  if (best) { if (d) d.guides.push({ pt: best }); return best.slice(); }
  const ref = d && d.pts && d.pts.length ? pts.concat([d.pts[0]]) : pts;
  let bx = null, bxd = tol * 0.8, by = null, byd = tol * 0.8;
  for (const p of ref) { const dx = Math.abs(p[0] - q[0]), dy = Math.abs(p[1] - q[1]); if (dx < bxd) { bxd = dx; bx = p[0]; } if (dy < byd) { byd = dy; by = p[1]; } }
  const o = q.slice();
  if (bx != null) { o[0] = bx; d && d.guides.push({ x: bx }); }
  if (by != null) { o[1] = by; d && d.guides.push({ y: by }); }
  if (bx == null && by == null) { // bám vào cạnh có sẵn
    let bs = null, bsd = tol * 0.7;
    for (const [a, c] of segs) { const r = G.distToSegment(q, a, c); if (r.d < bsd) { bsd = r.d; bs = r; } }
    if (bs && bs.q) { if (d) d.guides.push({ pt: bs.q }); return bs.q.slice(); }
  }
  return o;
}
// Ghi thay đổi nét vẽ của một mặt (có hoàn tác); trả về số mảng tạo thêm
function skCommit(fc, fn) {
  const snap = snapItems(); const n0 = Math.max(1, FA.faceFacets(S.doc, fc.parent, fc.face).length);
  const sk = skOf(fc, true); if (fn(sk) === false) return null; delete sk._sig;
  S.undo.push(snap); if (S.undo.length > 100) S.undo.shift(); S.redo = [];
  changed(); renderToolOpts(); renderProps(); draw3DOverlay();
  return Math.max(0, FA.faceFacets(S.doc, fc.parent, fc.face).length - n0);
}
const madeMsg = (n) => (n > 0 ? ` · tạo thêm ${n} mảng (chạm mảng rồi «Kéo khối» để kéo dương / âm)` : ' · nét chưa khép kín thành mảng');
function addLine(fc, a, b, ext) {
  let id; const n = skCommit(fc, (sk) => { const l = { id: skId(), a, b, ext }; id = l.id; sk.lines.push(l); FA.resolveSegs(frameFor(fc), sk); const parts = FA.splitLines(sk); if (parts[id]) id = parts[id]; });
  S.skSel = { parent: fc.parent, face: fc.face, src: 'l:' + id }; renderProps(); draw3DOverlay();
  toast('Đã vẽ đoạn thẳng' + madeMsg(n));
}
function addShape(fc, sh) {
  sh.id = skId(); const n = skCommit(fc, (sk) => { sk.shapes.push(sh); });
  S.skSel = { parent: fc.parent, face: fc.face, src: 's:' + sh.id }; renderProps(); draw3DOverlay();
  toast((sh.curve ? (sh.curve === 'curve' ? 'Đã vẽ đường cong' : 'Đã vẽ nét tự do') + (sh.type === 'poly' ? ' khép kín' : '') : { rect: 'Đã vẽ hình chữ nhật', circle: 'Đã vẽ đường tròn', poly: 'Đã vẽ đa giác' }[sh.type]) + (n > 0 ? madeMsg(n) : ''));
}
function closePline() {
  const df = S.faceDraft; if (!df || df.kind !== 'pline' || df.pts.length < 3) return;
  S.faceDraft = null; S.faceHover = null; addShape(df.fc, { type: 'poly', pts: df.pts.map((q) => q.slice()) }); renderToolOpts();
}
const draftAnchor = () => { const df = S.faceDraft; if (!df) return null; return df.kind === 'line' ? df.a : df.pts[df.pts.length - 1]; };
// Các điểm co kéo được của nét trên mặt khối
function skVertices(sk, onlySrc) {
  const out = [];
  if (!sk) return out;
  for (const l of sk.lines || []) {
    const src = 'l:' + l.id; if (onlySrc && src !== onlySrc) continue;
    const ends = l.ext && l.r ? l.r : [l.a, l.b];
    out.push({ src, k: 0, q: ends[0] }, { src, k: 1, q: ends[1] });
  }
  for (const sh of sk.shapes || []) {
    const src = 's:' + sh.id; if (onlySrc && src !== onlySrc) continue;
    if (sh.type === 'circle') { out.push({ src, k: 'r', q: [sh.cx + sh.r, sh.cy] }); continue; }
    if (sh.curve) { const P = sh.pts || []; if (P.length) { out.push({ src, k: 0, q: P[0] }); if (sh.type === 'path') out.push({ src, k: P.length - 1, q: P[P.length - 1] }); } continue; } // nét cong / tự do: chỉ hai đầu
    FA.shapePoly(sh).forEach((q, k) => out.push({ src, k, q }));
  }
  return out;
}
// điểm gần chỗ chạm nhất; ưu tiên điểm của nét đang chọn
function nearestSkVertex(sk, q, tol, prefer) {
  let best = null, bd = tol;
  for (const v of skVertices(sk)) { const d = G.dist(v.q, q) - (prefer && v.src === prefer ? tol * 0.3 : 0); if (d < bd) { bd = d; best = v; } }
  return best;
}
function moveVertex(el, o, v, q) {
  if (el.a) { // đoạn thẳng: đoạn kéo dài tới cạnh thì đổi thành đoạn thường đi qua hai đầu mút hiện có
    const ends = o.ext && o.r ? o.r : [o.a, o.b];
    const a = v.k === 0 ? q : ends[0], b = v.k === 1 ? q : ends[1];
    el.a = [a[0], a[1]]; el.b = [b[0], b[1]]; if (o.ext) { el.ext = false; delete el.r; }
    return;
  }
  if (o.type === 'circle') { el.r = Math.max(0.1, Math.round(G.dist([o.cx, o.cy], q) * 100) / 100); return; }
  if (o.type === 'rect') { // góc hình chữ nhật: góc đối diện đứng yên
    const P = FA.shapePoly(o), opp = P[(v.k + 2) % 4], a = o.ang || 0;
    const r0 = FA.rot(opp, -a), r1 = FA.rot(q, -a);
    const c = FA.rot([(r0[0] + r1[0]) / 2, (r0[1] + r1[1]) / 2], a);
    el.cx = c[0]; el.cy = c[1]; el.w = Math.max(0.1, Math.round(Math.abs(r1[0] - r0[0]) * 100) / 100); el.h = Math.max(0.1, Math.round(Math.abs(r1[1] - r0[1]) * 100) / 100);
    return;
  }
  if (el.pts) { el.pts = o.pts.map((p, i) => (i === v.k ? [q[0], q[1]] : p.slice())); }
}
function moveEl(el, o, dx, dy) {
  if (o.a) { el.a = [o.a[0] + dx, o.a[1] + dy]; el.b = [o.b[0] + dx, o.b[1] + dy]; }
  else if (o.pts) el.pts = o.pts.map((q) => [q[0] + dx, q[1] + dy]);
  else { el.cx = o.cx + dx; el.cy = o.cy + dy; }
}
function selectFace(fc) {
  S.facetSel = { parent: fc.parent, face: fc.face }; S.selectedId = fc.facetId || null; S.skSel = null; S.faceDraft = null; syncLookLock();
  renderProps(); schedule3D(); renderToolOpts(); draw3DOverlay(); syncIsoBar();
  toast(`Đã chọn ${faceLabel(fc)} · vẽ trên mặt này`);
}
function faceToolDown(v, e, fc, sc) {
  const mode = facetMode();
  if (!S.facetSel || !sameFace(fc, S.facetSel)) { selectFace(fc); return; }
  const q0r = faceLocal(v, fc, e.clientX, e.clientY); if (!q0r) return;
  if (S.axisPick) { // căn trục vẽ theo cạnh mặt / nét gần chỗ chạm
    S.axisPick = false; const F = frameFor(fc), sk = skOf(fc);
    const segs = []; for (const P of [F.base, ...(F.holes || [])]) for (let i = 0; i < P.length; i++) segs.push([P[i], P[(i + 1) % P.length]]);
    for (const ed of (sk && sk._edges) || []) segs.push([ed.a, ed.b]);
    let best = null, bd = 16 / sc; for (const [a, b] of segs) { const r = G.distToSegment(q0r, a, b); if (r.d < bd && G.dist(a, b) > 1e-6) { bd = r.d; best = Math.atan2(b[1] - a[1], b[0] - a[0]); } }
    if (best == null) toast('Không có cạnh nào gần chỗ chạm');
    else { S.opts.axis.ang = Math.round((AX.normAxis(best - FA.axisAngle(F), S.opts.axis.step || 90) * 180 / Math.PI) * 100) / 100; saveOpts(); toast(`Trục vẽ đã căn theo cạnh: ${G.fmtNum(S.opts.axis.ang, 1)}°`); }
    renderToolOpts(); draw3DOverlay(); return;
  }
  const q0 = ['erase', 'trim', 'select'].includes(mode) ? q0r : facetSnap(fc, q0r, sc, null, draftAnchor());
  drag = { kind: 'faceDraw', pointerId: e.pointerId, in3d: true, fc: { parent: fc.parent, face: fc.face }, facetId: fc.facetId, mode, sc, x0: e.clientX, y0: e.clientY, q0, q0r, q: q0, pts: [q0], maxD: 0, touch: e.pointerType === 'touch', guides: [] };
  if (mode === 'select') {
    const sk = skOf(fc);
    const vx = nearestSkVertex(sk, q0r, 16 / sc, S.skSel && sameFace(S.skSel, fc) ? S.skSel.src : null);
    if (vx) { // co kéo một điểm (đầu mút đoạn thẳng, đỉnh đa giác, góc hình chữ nhật)
      S.skSel = { parent: fc.parent, face: fc.face, src: vx.src }; drag.vert = vx; drag.moveSrc = vx.src; drag.orig = JSON.stringify(FA.findSrc(sk, vx.src)); drag.snap = snapItems(); S.selectedId = null; renderProps(); draw3DOverlay(); return;
    }
    const ed = FA.nearestEdge(sk, q0r, 14 / sc);
    if (ed) { const src = ed.srcs[0]; S.skSel = { parent: fc.parent, face: fc.face, src }; drag.moveSrc = src; drag.orig = JSON.stringify(FA.findSrc(sk, src)); drag.snap = snapItems(); S.selectedId = null; renderProps(); }
  }
  draw3DOverlay();
}
function faceToolMove(v, e) {
  const d = drag; d.maxD = Math.max(d.maxD, Math.hypot(e.clientX - d.x0, e.clientY - d.y0));
  const qr = faceLocal(v, d.fc, e.clientX, e.clientY); if (!qr) return;
  if (d.mode === 'select') {
    if (!d.moveSrc || d.maxD < 6) return;
    const sk = skOf(d.fc), el = FA.findSrc(sk, d.moveSrc); if (!el) return;
    const q = facetSnap(d.fc, qr, d.sc, d, null);
    if (d.vert) moveVertex(el, JSON.parse(d.orig), d.vert, q); else moveEl(el, JSON.parse(d.orig), q[0] - d.q0r[0], q[1] - d.q0r[1]);
    delete sk._sig; d.moved = true;
    changed({ save: false, light: true }); draw3DOverlay(); return;
  }
  if (['erase', 'trim'].includes(d.mode)) return;
  if (d.mode === 'curve' || d.mode === 'free') { const last = d.pts[d.pts.length - 1]; if (G.dist(last, qr) > 3 / d.sc) d.pts.push(qr); d.q = qr; draw3DOverlay(); return; }
  d.q = facetSnap(d.fc, qr, d.sc, d, S.faceDraft ? draftAnchor() : d.mode === 'line' ? d.q0 : null);
  draw3DOverlay();
}
function faceToolUp(v, d, e) {
  if (e.type === 'pointercancel') { draw3DOverlay(); return; }
  const tap = d.maxD < 10, fc = d.fc, F = frameFor(fc); if (!F) return;
  const tol = 14 / d.sc, ang = FA.axisAngle(F) + (axisOn('facet') ? axisRad() : 0), o = S.opts.facet;
  switch (d.mode) {
    case 'curve': case 'free': {
      let P = d.pts.slice(); if (P.length < 2 || tap) { toast(d.mode === 'curve' ? 'Vẽ một nét để tạo đường cong' : 'Vẽ một nét tự do'); draw3DOverlay(); return; }
      const end = facetSnap(fc, P[P.length - 1], d.sc, null, null); P[P.length - 1] = end;
      const closed = P.length > 4 && G.dist(P[0], P[P.length - 1]) < Math.max(tol, G.length(P) * 0.08);
      if (closed) P.pop();
      if (d.mode === 'curve') { P = G.rdp(closed ? P.concat([P[0]]) : P, 2.5 / d.sc); if (closed) P.pop(); P = G.catmullRom(P, 6, closed); }
      else { P = G.rdp(closed ? P.concat([P[0]]) : P, 0.8 / d.sc); if (closed) P.pop(); }
      P = P.map((q) => [Math.round(q[0] * 1000) / 1000, Math.round(q[1] * 1000) / 1000]);
      if (closed && P.length >= 3) addShape(fc, { type: 'poly', pts: P, curve: d.mode });
      else if (P.length >= 2) addShape(fc, { type: 'path', pts: P, curve: d.mode });
      return;
    }
    case 'select':
      if (d.moveSrc) { if (d.moved) { S.undo.push(d.snap); S.redo = []; changed(); } renderProps(); draw3DOverlay(); return; }
      if (tap) { S.skSel = null; S.selectedId = d.facetId || regionAt(fc, d.q0r) || null; renderProps(); schedule3D(); draw3DOverlay(); if (S.selectedId) toast('Đã chọn mảng · dùng «Kéo khối» hoặc ô «Độ nhô»'); }
      return;
    case 'line': {
      const df = S.faceDraft;
      if (df && df.kind === 'line' && sameFace(df.fc, fc)) { S.faceDraft = null; S.faceHover = null; if (G.dist(df.a, d.q) < tol / 2) { draw3DOverlay(); return; } addLine(fc, df.a, d.q, o.ext !== false); return; }
      if (!tap) { addLine(fc, d.q0, d.q, o.ext !== false); return; }
      S.faceDraft = { kind: 'line', fc, a: d.q0 }; draw3DOverlay(); toast('Chạm điểm cuối của đoạn thẳng'); return;
    }
    case 'pline': {
      const df = S.faceDraft, q = d.q;
      if (!df || df.kind !== 'pline' || !sameFace(df.fc, fc)) { S.faceDraft = { kind: 'pline', fc, pts: [q] }; renderToolOpts(); draw3DOverlay(); toast('Chạm tiếp các đỉnh · chạm lại đỉnh đầu để khép kín'); return; }
      if (df.pts.length >= 3 && G.dist(q, df.pts[0]) < tol) { closePline(); return; }
      if (G.dist(q, df.pts[df.pts.length - 1]) > tol / 3) df.pts.push(q);
      renderToolOpts(); draw3DOverlay(); return;
    }
    case 'rect': {
      if (tap && o.rw > 0 && o.rh > 0) { addShape(fc, { type: 'rect', cx: d.q0[0], cy: d.q0[1], w: o.rw, h: o.rh, ang }); return; }
      if (tap) { toast('Kéo chéo để vẽ hình chữ nhật, hoặc nhập Rộng và Cao rồi chạm'); return; }
      const r0 = FA.rot(d.q0, -ang), r1 = FA.rot(d.q, -ang), w = Math.abs(r1[0] - r0[0]), hh = Math.abs(r1[1] - r0[1]);
      if (w < 0.1 || hh < 0.1) { toast('Hình chữ nhật quá nhỏ'); draw3DOverlay(); return; }
      const c = FA.rot([(r0[0] + r1[0]) / 2, (r0[1] + r1[1]) / 2], ang);
      addShape(fc, { type: 'rect', cx: c[0], cy: c[1], w: Math.round(w * 100) / 100, h: Math.round(hh * 100) / 100, ang }); return;
    }
    case 'circle': {
      const r = tap ? o.cr : G.dist(d.q0, d.q);
      if (!(r >= 0.1)) { toast(tap ? 'Kéo từ tâm ra để vẽ, hoặc nhập Bán kính rồi chạm' : 'Đường tròn quá nhỏ'); draw3DOverlay(); return; }
      addShape(fc, { type: 'circle', cx: d.q0[0], cy: d.q0[1], r: Math.round(r * 100) / 100 }); return;
    }
    case 'erase': case 'trim': {
      const sk = skOf(fc); if (!sk) { toast('Mặt này chưa có nét vẽ'); return; }
      const snap = snapItems();
      const ok = d.mode === 'erase' ? FA.eraseAt(sk, d.q0r, tol) : FA.trimAt(F, sk, d.q0r, tol);
      if (!ok) { toast('Không có nét nào gần chỗ chạm'); return; }
      delete sk._sig; S.undo.push(snap); S.redo = []; S.skSel = null;
      changed(); renderToolOpts(); renderProps(); draw3DOverlay(); toast(d.mode === 'erase' ? 'Đã xoá nét' : 'Đã cắt đoạn nét'); return;
    }
  }
}
// Bảng thuộc tính của nét đang chọn: kích thước, khoảng cách tới các cạnh của mặt, dời thêm
function renderSkProps(box) {
  const ss = S.skSel, sk = skOf(ss), el = FA.findSrc(sk, ss.src), F = frameFor(ss);
  if (!el || !F) { S.skSel = null; return false; }
  $('#editor').classList.add('props-open'); box.hidden = false; box.innerHTML = '';
  const kind = ss.src[0] === 'l' ? 'line' : el.type;
  const head = h(`<h3>${({ line: 'Đoạn thẳng', rect: 'Hình chữ nhật', circle: 'Đường tròn', poly: el.curve ? 'Nét khép kín' : 'Đa giác', path: el.curve === 'curve' ? 'Đường cong' : 'Nét tự do' }[kind] || 'Nét')} trên mặt<button class="ibtn x" aria-label="Đóng"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></h3>`);
  head.querySelector('.x').onclick = () => { S.skSel = null; renderProps(); draw3DOverlay(); };
  box.append(head);
  const ang = el.type === 'rect' ? el.ang || 0 : FA.axisAngle(F);
  const toA = (q) => FA.rot(q, -ang), fromA = (q) => FA.rot(q, ang);
  const bb = G.bbox(F.base.map(toA));
  const edit = (fn) => { checkpoint(); fn(); delete sk._sig; changed({ light: true }); renderProps(); draw3DOverlay(); };
  const field = (label, node) => { const f = h(`<div class="field"><span>${label}</span></div>`); f.append(node); box.append(f); return f; };
  const kv = (rows) => { const k = h('<div class="kv"></div>'); for (const [a, b] of rows) k.append(h(`<span>${a}</span>`), h(`<b>${b}</b>`)); box.append(k); };
  const r2 = (x) => Math.round(x * 100) / 100;
  const shiftA = (dxA, dyA) => { const dv = fromA([dxA, dyA]); moveEl(el, JSON.parse(JSON.stringify(el)), dv[0], dv[1]); };
  // khoảng cách tới cạnh: đọc lại vị trí hiện tại lúc nhập (tránh dời hai lần)
  const ext4 = () => { if (kind === 'line') { const [a, b] = el.ext && el.r ? el.r : [el.a, el.b]; return G.bbox([toA(a), toA(b)]); } return G.bbox(FA.shapePoly(el).map(toA)); };
  const SIDES = { left: [(e) => e.x0 - bb.x0, 1, 0], right: [(e) => bb.x1 - e.x1, -1, 0], bottom: [(e) => e.y0 - bb.y0, 0, 1], top: [(e) => bb.y1 - e.y1, 0, -1] };
  const NAMES = { left: 'Cách cạnh trái (m)', right: 'Cách cạnh phải (m)', bottom: 'Cách cạnh dưới (m)', top: 'Cách cạnh trên (m)' };
  const dist = (side) => { const [get, sx, sy] = SIDES[side]; field(NAMES[side], numInput(r2(get(ext4())), (v) => edit(() => { const dlt = v - get(ext4()); shiftA(sx * dlt, sy * dlt); }), -1e6)); };
  if (kind === 'line') {
    const [a, b] = el.ext && el.r ? el.r : [el.a, el.b];
    const ra = toA(a), rb = toA(b);
    kv([['Thuộc mặt', faceLabel(ss)], ['Chiều dài', G.fmtNum(G.dist(a, b), 2) + ' m']]);
    const c = h(`<button class="chip ${el.ext ? 'on' : ''}" style="margin:4px 0">⟷ Kéo dài tới cạnh</button>`); c.onclick = () => edit(() => { if (el.ext && el.r) { el.a = el.r[0]; el.b = el.r[1]; } el.ext = !el.ext; }); box.append(c);
    if (Math.abs(ra[1] - rb[1]) < 0.01) { dist('bottom'); dist('top'); }
    else if (Math.abs(ra[0] - rb[0]) < 0.01) { dist('left'); dist('right'); }
    else box.append(h('<div class="note">Đoạn xiên: dời bằng ô «Dời thêm» hoặc kéo tay (chế độ ↖ Chọn)</div>'));
  } else {
    const P = FA.shapePoly(el);
    kv([['Thuộc mặt', faceLabel(ss)], kind === 'path' ? ['Chiều dài', G.fmtNum(G.length(P), 2) + ' m'] : ['Diện tích', G.fmtArea(Math.abs(G.area(P)))]]);
    if (kind === 'rect') { field('Rộng (m)', numInput(r2(el.w), (v) => edit(() => (el.w = Math.max(0.1, v))))); field('Cao (m)', numInput(r2(el.h), (v) => edit(() => (el.h = Math.max(0.1, v))))); }
    if (kind === 'circle') field('Bán kính (m)', numInput(r2(el.r), (v) => edit(() => (el.r = Math.max(0.1, v)))));
    dist('left'); dist('right'); dist('bottom'); dist('top');
  }
  const mx = numInput(0, () => {}, -1e6), my = numInput(0, () => {}, -1e6);
  const mv = h('<button class="btn">Dời</button>');
  mv.onclick = () => { const dx = parseFloat(String(mx.value).replace(',', '.')) || 0, dy = parseFloat(String(my.value).replace(',', '.')) || 0; if (dx || dy) edit(() => shiftA(dx, dy)); };
  const row = h('<div class="mvbox"><span>Dời thêm ngang / dọc (m)</span><span class="mv-row"></span></div>'); row.querySelector('.mv-row').append(mx, my, mv); box.append(row);
  box.append(h('<div class="note">Kéo tay ở chế độ <b>↖ Chọn</b> để dời tự do. Khoảng cách đo theo trục của mặt (mặt đứng: trái, phải theo chiều ngang, dưới, trên theo chiều cao).</div>'));
  const del = h('<button class="btn danger" style="width:100%;margin-top:6px">Xoá nét</button>');
  del.onclick = () => edit(() => { const id = ss.src.slice(2); if (ss.src[0] === 'l') sk.lines = sk.lines.filter((l) => l.id !== id); else sk.shapes = sk.shapes.filter((x) => x.id !== id); S.skSel = null; });
  box.append(del);
  return true;
}
// Offset từ cạnh bao vào trong: mảng đang chọn (hoặc cả mặt) -> thêm đa giác lõi, phần còn lại thành viền
function facetOffset(dist) {
  const fc = S.facetSel; if (!fc) return toast('Chạm chọn một mặt khối trước');
  const F = frameFor(fc); if (!F) return;
  const root = rootOf(S.doc.items.find((i) => i.id === fc.parent));
  if (root && M.isLocked(S.doc, root)) return lockedToast();
  const mine = FA.faceFacets(S.doc, fc.parent, fc.face);
  const sel = mine.find((f) => f.id === S.selectedId);
  if (mine.length && !sel) return toast('Mặt đã được chia: chạm chọn mảng cần offset');
  const src = sel ? sel.props.poly : F.base;
  const A = Math.abs(G.area(src));
  let inner = G.offsetPolygon(src, -dist);
  if (!(Math.abs(G.area(inner)) < A)) inner = G.offsetPolygon(src, dist);
  const ai = Math.abs(G.area(inner));
  if (!(ai > 0.05 && ai < A) || !inner.every((p) => G.pointInPolygon(p, src))) return toast('Khoảng offset quá lớn so với mặt / mảng này');
  skCommit(fc, (sk) => { sk.shapes.push({ id: skId(), type: 'poly', pts: inner }); });
  const ip = FA.interiorPoint(inner); S.selectedId = regionAt(fc, ip); S.skSel = null;
  renderProps(); schedule3D(); draw3DOverlay();
  toast(`Đã tạo viền offset ${G.fmtNum(dist, 2)} m: phần lõi đang được chọn, đùn bằng «Độ nhô» hoặc «Kéo khối»`);
}
// Độ sâu tối đa được ấn lõm vào một mặt
function facetMaxIn(f) {
  const byId = docById(); const p = byId.get(f.props.parent); if (!p) return 0;
  if (p.kind === 'building') { if (f.props.face === 'top') return Math.max(0, M.bldHeight(p) - 0.5); const bb = G.bbox(p.pts); return Math.max(0.5, 0.9 * Math.min(bb.x1 - bb.x0, bb.y1 - bb.y0)); }
  const d = p.props.depth || 0;
  if (f.props.face === 'top') return d > 0 ? Math.max(0.1, d - 0.05) : Math.max(0.1, facetMaxIn(p) + d);
  const bb = G.bbox(p.props.poly); return Math.max(0.3, 0.9 * Math.min(bb.x1 - bb.x0, bb.y1 - bb.y0));
}
function facetDepthDrag(it, e) {
  const neg = S.opts.push && S.opts.push.mode === 'neg' && S.tool === 'push';
  let d = Math.round((drag.d0 + (drag.y - e.clientY) / Math.max(1, drag.sc || 4)) * 10) / 10;
  d = neg ? Math.max(-facetMaxIn(it), Math.min(0, d)) : Math.max(S.tool === 'push' ? 0 : -facetMaxIn(it), d);
  if (d !== (it.props.depth || 0)) { it.props.depth = d; drag.moved = true; toast(d < 0 ? `Mảng lõm vào ${G.fmtNum(-d, 1)} m` : `Mảng nhô ra ${G.fmtNum(d, 1)} m`); changed({ save: false, light: true }); }
}
// nắn nét chia: thẳng theo trục mặt (ngang/dọc khi gần), gấp khúc hoặc tự do
function shapeFacetPath(pts, form, sc, closed) {
  let p = ZO.shapeStroke(pts, form === 'axis' ? 'poly' : form, sc, closed);
  if (form === 'axis') {
    p = p.map((q) => q.slice());
    const n = p.length, k = Math.tan((14 * Math.PI) / 180);
    for (let i = 1; i < (closed ? n + 1 : n); i++) {
      const a = p[i - 1], b = p[i % n]; const dx = b[0] - a[0], dy = b[1] - a[1];
      if (Math.abs(dy) <= Math.abs(dx) * k) b[1] = a[1]; else if (Math.abs(dx) <= Math.abs(dy) * k) b[0] = a[0];
    }
  }
  return p;
}
function finishFacetStroke(v, d, e) {
  if (e.type === 'pointercancel') { draw3DOverlay(); return; }
  const tap = (d.maxD || 0) < 12 || d.pts.length < 3;
  if (tap) { selectFace(d.hit || d.fc); return; }
  // thử lần lượt mặt đang chọn và mặt trúng dưới điểm đầu nét; mặt nào cho kết quả hợp lệ thì dùng
  const cands = [{ fc: d.fc, pts: d.pts }];
  if (d.alt) cands.push({ fc: d.alt, pts: d.altPts });
  const raw0 = (c) => c.pts.filter((q, i) => !i || G.dist(q, c.pts[i - 1]) > 0.02);
  const inFrac = (c) => { const F = frameFor(c.fc); if (!F) return 0; const r = raw0(c); return r.filter((q) => G.pointInPolygon(q, F.base)).length / Math.max(1, r.length); };
  if (cands.length > 1 && inFrac(cands[1]) > inFrac(cands[0]) + 0.25) cands.reverse();
  for (const c of cands) {
    const plan = planFacetStroke(c.fc, raw0(c), Math.max(0.2, d.sc));
    if (!plan.ok) { if (c === cands[cands.length - 1]) { toast(plan.msg || 'Nét chia cần cắt ngang qua mặt'); draw3DOverlay(); } continue; }
    S.facetSel = { parent: c.fc.parent, face: c.fc.face };
    const n = skCommit(c.fc, (sk) => { if (plan.poly) sk.shapes.push({ id: skId(), type: 'poly', pts: plan.poly }); else for (let i = 1; i < plan.path.length; i++) sk.lines.push({ id: skId(), a: plan.path[i - 1], b: plan.path[i], ext: false }); });
    const cnt = FA.faceFacets(S.doc, c.fc.parent, c.fc.face).length;
    toast(plan.poly ? `Đã tạo mảng ${G.fmtArea(Math.abs(G.area(plan.poly)))} · chỉnh «Độ nhô» để đùn ra` : n > 0 ? `Đã chia ${faceLabel(c.fc)} thành ${cnt} mảng · chạm mảng để chọn và đùn` : 'Nét chưa cắt ngang qua mặt: đã giữ lại nét, vẽ tiếp để khép kín');
    if (plan.poly) { S.selectedId = regionAt(c.fc, FA.interiorPoint(plan.poly)); renderProps(); schedule3D(); }
    return;
  }
}
function planFacetStroke(fc, raw, sc) {
  const F = frameFor(fc); if (!F || raw.length < 2) return { ok: false };
  const len = G.length(raw);
  if (len * sc < 30) return { ok: false, msg: 'Nét quá ngắn' };
  // hình khép kín phải đủ lớn trên màn hình, tránh nét kéo vội thành tam giác lạ
  const closed = raw.length >= 6 && len * sc > 80 && G.dist(raw[0], raw[raw.length - 1]) < Math.max(0.18 * len, 16 / sc) && Math.abs(G.area(raw)) * sc * sc > 900;
  if (closed) {
    const poly = shapeFacetPath(raw, S.opts.facet.form, sc, true);
    if (poly.length < 3 || Math.abs(G.area(poly)) < 0.3 || !G.pointInPolygon(G.centroid(poly), F.base)) return { ok: false, msg: 'Hình khép kín cần nằm trên mặt khối' };
    return { ok: true, poly };
  }
  const path = ZO.extendPath(shapeFacetPath(raw, S.opts.facet.form, sc, false), 14 / sc);
  if (!path.some((q, i) => G.pointInPolygon(q, F.base) || (i && G.pointInPolygon([(q[0] + path[i - 1][0]) / 2, (q[1] + path[i - 1][1]) / 2], F.base)))) return { ok: false, msg: 'Nét chia cần nằm trên mặt khối' };
  return { ok: true, path };
}
// Vẽ lên lớp phủ 3D: mặt đang chọn, đường dóng, nét đang vẽ, nét đang chọn
function drawFaceOverlay(ox) {
  const sel = S.facetSel; if (!sel) return;
  const F = frameFor(sel); if (!F) return;
  const P = (q, F2 = F) => { const w = F2.pt(q, 0.08); return v3.toScreen([w[0], w[2]], w[1]); };
  const path = (pts, close, F2) => { ox.beginPath(); pts.forEach((q, i) => { const s = P(q, F2); i ? ox.lineTo(s[0], s[1]) : ox.moveTo(s[0], s[1]); }); if (close) ox.closePath(); };
  ox.strokeStyle = '#9333ea'; ox.lineWidth = 3; ox.setLineDash([10, 6]); path(F.base, true); ox.stroke(); ox.setLineDash([]);
  ox.fillStyle = 'rgba(147,51,234,.08)'; ox.fill();
  const d = drag && (drag.kind === 'facetStroke' || drag.kind === 'faceDraw') ? drag : null;
  if (d && d.guides && d.guides.length) {
    const bb = G.bbox(F.base);
    ox.strokeStyle = '#0891b2'; ox.lineWidth = 1.5; ox.setLineDash([6, 5]);
    for (const gd of d.guides) {
      if (gd.pt) { const q = P(gd.pt); ox.beginPath(); ox.arc(q[0], q[1], 6, 0, 7); ox.stroke(); continue; }
      const a = P(gd.x != null ? [gd.x, bb.y0] : [bb.x0, gd.y]), c = P(gd.x != null ? [gd.x, bb.y1] : [bb.x1, gd.y]);
      ox.beginPath(); ox.moveTo(a[0], a[1]); ox.lineTo(c[0], c[1]); ox.stroke();
    }
    ox.setLineDash([]);
  }
  if (drag && drag.kind === 'facetStroke' && drag.pts.length > 1) { const F2 = frameFor(drag.fc) || F; ox.strokeStyle = '#9333ea'; ox.lineWidth = 3; path(drag.pts, false, F2); ox.stroke(); }
  // nét đang chọn
  if (S.skSel && sameFace(S.skSel, sel)) {
    const sk = skOf(sel);
    ox.strokeStyle = '#f97316'; ox.lineWidth = 4;
    for (const e of (sk && sk._edges) || []) if (e.srcs.includes(S.skSel.src)) { path([e.a, e.b]); ox.stroke(); }
    // chấm tròn ở các điểm co kéo được
    for (const v of skVertices(sk, S.skSel.src)) { const sp = P(v.q); ox.beginPath(); ox.arc(sp[0], sp[1], 7, 0, 7); ox.fillStyle = '#fff'; ox.fill(); ox.lineWidth = 2.5; ox.strokeStyle = '#f97316'; ox.stroke(); }
  }
  // nét nháp
  ox.strokeStyle = '#ea580c'; ox.fillStyle = '#ea580c'; ox.lineWidth = 2.5;
  const dot = (q) => { const s = P(q); ox.beginPath(); ox.arc(s[0], s[1], 4, 0, 7); ox.fill(); };
  const df = S.faceDraft;
  if (df && sameFace(df.fc, sel)) {
    const pts = df.kind === 'line' ? [df.a, (d && d.q) || S.faceHover || df.a] : [...df.pts, (d && d.q) || S.faceHover].filter(Boolean);
    ox.setLineDash([6, 4]); path(pts); ox.stroke(); ox.setLineDash([]); pts.forEach(dot);
  }
  if (d && d.kind === 'faceDraw' && d.maxD >= 10 && !df) {
    const ang = FA.axisAngle(F);
    if (d.mode === 'line') { path([d.q0, d.q]); ox.stroke(); }
    if (d.mode === 'rect') { const r0 = FA.rot(d.q0, -ang), r1 = FA.rot(d.q, -ang); path([[r0[0], r0[1]], [r1[0], r0[1]], [r1[0], r1[1]], [r0[0], r1[1]]].map((q) => FA.rot(q, ang)), true); ox.stroke(); }
    if (d.mode === 'circle') { path(FA.shapePoly({ type: 'circle', cx: d.q0[0], cy: d.q0[1], r: G.dist(d.q0, d.q) }), true); ox.stroke(); }
    if (d.mode === 'curve' || d.mode === 'free') { path(d.pts); ox.stroke(); }
  }
}
function draw3DOverlay() {
  if (!v3) return;
  const oc = v3.overlay, ox = oc.getContext('2d');
  const d = Math.min(3, window.devicePixelRatio || 1);
  const r = $('#v3d').getBoundingClientRect();
  if (oc.width !== Math.round(r.width * d)) { oc.width = Math.round(r.width * d); oc.height = Math.round(r.height * d); }
  ox.setTransform(d, 0, 0, d, 0, 0); ox.clearRect(0, 0, r.width, r.height);
  const pts = liveShapePts();
  const col = TOOL_COLORS[S.tool] || '#16325c';
  ox.lineCap = 'round'; ox.lineJoin = 'round';
  if (pts && pts.length > 1) {
    ox.strokeStyle = S.tool === 'sketch' ? S.opts.sketch.color : col;
    for (let i = 1; i < pts.length; i++) {
      const ph = drag && drag.planeH;
      const a = v3.toScreen(pts[i - 1], ph || v3.gy(pts[i - 1])), b = v3.toScreen(pts[i], ph || v3.gy(pts[i]));
      ox.lineWidth = 1.5 + 4 * (pts[i][2] ?? 0.5);
      ox.beginPath(); ox.moveTo(a[0], a[1]); ox.lineTo(b[0], b[1]); ox.stroke();
    }
  }
  if (S.tool === 'facet') drawFaceOverlay(ox);
  if (S.circleDraft) {
    const cp = SH.circlePts(S.circleDraft.c, S.circleDraft.r, 72).map((q) => v3.toScreen(q));
    ox.strokeStyle = '#7b3fe4'; ox.lineWidth = 2; ox.setLineDash([8, 6]);
    ox.beginPath(); cp.forEach((q, i) => (i ? ox.lineTo(q[0], q[1]) : ox.moveTo(q[0], q[1]))); ox.closePath(); ox.stroke(); ox.setLineDash([]);
  }
}

// Phím tắt trên PC
window.addEventListener('keydown', (e) => {
  if (!S.doc || $('#editor').hidden || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && S.multi.length > 1) { deleteMulti(); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && S.selectedId) { deleteSelected(); }
  else if (e.key === 'Escape' && tour) { stopTour(); return; }
  else if (e.key === 'Escape') { if (S.multi.length) { S.multi = []; renderProps(); requestRender(); } if (S.faceDraft) { S.faceDraft = null; draw3DOverlay(); return; } if (hudBig) { hudBig = false; renderHUD(); } S.selectedId = null; closePop(); renderProps(); requestRender(); }
});

// ---------------- Bảng thuộc tính ----------------
// ---- chọn / xoá khi nhiều đối tượng trùng chỗ, chọn theo vùng, dời nhóm ----
function hitsAt(w, sc, skipLocked) { return w ? hitAll(S.doc, w, sc, skipLocked).filter((it) => inIso(it)) : []; }
function itemDesc(it) {
  const P = it.props || {}; let name = M.KIND_NAMES[it.kind] || it.kind, det = '';
  if (it.kind === 'building') det = (P.on ? '+' : '') + P.floors + ' tầng' + (P.preset ? ' · khối mẫu' : '');
  else if (it.kind === 'zone') det = (P.code || '') + (P.name ? ' · ' + P.name : '');
  else if (it.kind === 'road') det = 'lòng ' + G.fmtNum(P.width || 0) + ' m';
  else if (it.kind === 'icon') { name = 'Biểu tượng ' + ((IC[P.sym] || {}).name || '').toLowerCase(); det = P.label || (P.ink ? 'nhãn viết tay' : ''); }
  else if (it.kind === 'facet') det = 'mảng mặt khối';
  else if (P.tour) { name = 'Tour route'; det = P.label && P.label !== 'Tour route' ? P.label : ''; }
  else if (P.label) det = P.label;
  else if (P.name) det = P.name;
  const layName = M.layerName(S.doc, M.layerOf(it));
  const col = P.color || (it.kind === 'zone' && M.LANDUSE[P.code] ? M.LANDUSE[P.code].color : it.kind === 'icon' ? (IC[P.sym] || IC.pin).color : it.kind === 'road' ? '#5b6573' : it.kind === 'water' ? '#6fb7e3' : it.kind === 'building' ? '#f7f7f5' : '#94a3b8');
  return { name, det, layer: 'Lớp: ' + layName, col };
}
function chooseItem(list, titleTxt, ic, onPick) {
  openPop(`<div><h3>${titleTxt}</h3><div class="note">Có ${list.length} đối tượng ở chỗ vừa chạm (trên cùng ở đầu danh sách). Chạm để chọn.</div><div class="pick-list"></div></div>`, (pop) => {
    const box = pop.querySelector('.pick-list');
    list.forEach((it) => {
      const d = itemDesc(it);
      const b = h(`<button class="pick-row"><span class="sw" style="background:${d.col}"></span><span class="nm"><b>${esc(d.name)}</b>${d.det ? ' · ' + esc(d.det) : ''}<small>${esc(d.layer)}</small></span><span class="ic">${ic}</span></button>`);
      b.onpointerenter = () => { S.hoverId = it.id; requestRender(); };
      b.onclick = () => { closePop(); S.hoverId = null; onPick(it); };
      box.append(b);
    });
  });
}
function showSelBox(d) {
  let el = document.getElementById('selBox'); if (!el) { el = document.createElement('div'); el.id = 'selBox'; document.body.append(el); }
  el.hidden = false;
  Object.assign(el.style, { left: Math.min(d.cx0, d.cx1) + 'px', top: Math.min(d.cy0, d.cy1) + 'px', width: Math.abs(d.cx1 - d.cx0) + 'px', height: Math.abs(d.cy1 - d.cy0) + 'px' });
}
function hideSelBox() { const el = document.getElementById('selBox'); if (el) el.hidden = true; }
function itemScreenPts(it) {
  const P = it.props || {};
  let pts = it.pts;
  if (it.kind === 'circle') { const c = it.pts[0], r = P.radius || 0; pts = [[c[0] - r, c[1] - r], [c[0] + r, c[1] + r], [c[0] - r, c[1] + r], [c[0] + r, c[1] - r]]; }
  if (it.kind === 'building' && P.preset && (!pts || !pts.length)) return [];
  if (S.mode === '3d' && v3) { const r = $('#v3d').getBoundingClientRect(); return pts.map((q) => { const s = v3.toScreen(q, v3.gy(q)); return [s[0] + r.left, s[1] + r.top]; }); }
  const r = canvas.getBoundingClientRect(); return pts.map((q) => { const s = S.view.toScreen(q); return [s[0] + r.left, s[1] + r.top]; });
}
function finishBox(d, tap) {
  if (tap || Math.abs(d.cx1 - d.cx0) < 8 || Math.abs(d.cy1 - d.cy0) < 8) { // chạm: chọn đối tượng trên cùng
    S.multi = []; S.selectedId = d.hit || null; renderProps(); requestRender(); if (S.mode === '3d') schedule3D(); return;
  }
  const x0 = Math.min(d.cx0, d.cx1), x1 = Math.max(d.cx0, d.cx1), y0 = Math.min(d.cy0, d.cy1), y1 = Math.max(d.cy0, d.cy1);
  const vis = Object.fromEntries(S.doc.layers.map((l) => [l.id, l.visible]));
  const ids = [];
  for (const it of S.doc.items) {
    if (it.kind === 'facet' || !it.pts || !it.pts.length || !inIso(it)) continue;
    if (vis[M.layerOf(it)] === false || M.isLocked(S.doc, it)) continue;
    const sp = itemScreenPts(it); if (!sp.length) continue;
    if (sp.every(([x, y]) => x >= x0 && x <= x1 && y >= y0 && y <= y1)) ids.push(it.id);
  }
  S.multi = ids.length > 1 ? ids : []; S.selectedId = ids.length === 1 ? ids[0] : null;
  renderProps(); requestRender(); if (S.mode === '3d') schedule3D();
  toast(ids.length ? `Đã chọn ${ids.length} đối tượng nằm trong khung` : 'Không có đối tượng nào nằm trọn trong khung');
}
function startGroupMove(base, ids) {
  const set = new Set(ids); let grow = true;
  while (grow) { grow = false; for (const k of S.doc.items) if (!set.has(k.id) && k.props && ((k.kind === 'facet' && set.has(k.props.parent)) || (k.kind === 'building' && k.props.on && set.has(k.props.on)) || (k.props.grp && set.has(k.props.grp)))) { set.add(k.id); grow = true; } }
  const list = S.doc.items.filter((i) => set.has(i.id) && !M.isLocked(S.doc, i));
  drag = { ...base, kind: 'gmove', snap: snapItems(), list: list.map((i) => [i, JSON.stringify(i)]), moved: false };
}
function groupMove(w) {
  const d = drag; if (!w) return;
  const dx = w[0] - d.startW[0], dy = w[1] - d.startW[1];
  if (!d.moved && Math.hypot(dx, dy) * d.sc < 4) return; d.moved = true;
  for (const [it, o] of d.list) {
    const O = JSON.parse(o); Object.assign(it, O); C.translateItem(it, dx, dy);
    if (it.kind === 'road' && O.props.pis) it.props.pis = G.translatePts(O.props.pis, dx, dy);
    if (it.kind === 'road' && O.props.ctrl) it.props.ctrl = G.translatePts(O.props.ctrl, dx, dy);
  }
  changed({ save: false, light: true });
}
function deleteMulti() {
  const set = new Set(S.multi.filter((id) => { const it = S.doc.items.find((i) => i.id === id); return it && !M.isLocked(S.doc, it); }));
  if (!set.size) { lockedToast(); return; }
  checkpoint(); const n0 = S.doc.items.length;
  S.doc.items = S.doc.items.filter((i) => !set.has(i.id) && !(i.kind === 'facet' && set.has(i.props.parent)));
  S.multi = []; S.selectedId = null; changed(); renderProps(); toast(`Đã xoá ${n0 - S.doc.items.length} đối tượng`);
}
function renderMultiProps(box) {
  const items = S.multi.map((id) => S.doc.items.find((i) => i.id === id)).filter(Boolean);
  if (items.length < 2) { S.multi = []; renderProps(); return; }
  $('#editor').classList.add('props-open');
  box.hidden = false; box.innerHTML = '';
  const head = h(`<h3>Đã chọn ${items.length} đối tượng<button class="ibtn x" aria-label="Đóng"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></h3>`);
  head.querySelector('.x').onclick = () => { S.multi = []; renderProps(); changed({ save: false }); };
  box.append(head);
  const cnt = {}; for (const it of items) cnt[M.KIND_NAMES[it.kind]] = (cnt[M.KIND_NAMES[it.kind]] || 0) + 1;
  box.append(h(`<div class="kv">${Object.entries(cnt).map(([k, n]) => `<span>${esc(k)}</span><b>${n}</b>`).join('')}</div>`));
  const edit = (fn) => { checkpoint(); fn(); changed({ light: true }); renderProps(); };
  const blds = items.filter((i) => i.kind === 'building');
  if (blds.length) {
    const f0 = blds[0].props.floors;
    box.append(h(`<div class="field"><span>Số tầng (${blds.length} công trình)</span></div>`));
    box.append(stepper(blds.every((b) => b.props.floors === f0) ? f0 : f0, 1, 1, (v) => edit(() => blds.forEach((b) => (b.props.floors = v)))));
  }
  const colorable = items.filter((i) => ['building', 'arrow', 'flow', 'circle', 'cloud', 'icon', 'sketch'].includes(i.kind));
  if (colorable.length) {
    box.append(h(`<div class="field"><span>Màu (${colorable.length} đối tượng)</span></div>`));
    const ch = h('<div class="chips"></div>'); box.append(ch);
    colorChips(ch, '', (c) => edit(() => colorable.forEach((i) => { if (c) i.props.color = c; else delete i.props.color; })), true);
    if (blds.length) { const g = h('<div class="tone-grid"></div>'); for (const c of TONES) { const b = h(`<button style="background:${c}" aria-label="Màu ${c}"></button>`); b.onclick = () => edit(() => blds.forEach((x) => (x.props.color = c))); g.append(b); } box.append(g); }
  }
  box.append(h('<div class="note">Kéo một đối tượng đang chọn (chế độ chọn theo vùng) để dời cả nhóm.</div>'));
  const act = h('<div class="actions"></div>');
  const del = h(`<button class="btn danger">Xoá ${items.length} đối tượng</button>`); del.onclick = deleteMulti;
  const un = h('<button class="btn">Bỏ chọn</button>'); un.onclick = () => { S.multi = []; renderProps(); changed({ save: false }); };
  act.append(un, del); box.append(act);
}
// Viết nhãn biểu tượng bằng bút: lưu nét vẽ tay (không cần nhận dạng chữ)
function openInkPad(it) {
  openPop(`<div><h3>Viết nhãn bằng bút</h3><div class="note">Viết bằng Apple Pencil (hoặc ngón tay, chuột) vào khung. Nét viết giữ nguyên làm nhãn của biểu tượng.</div><canvas class="ink-pad" width="1040" height="360"></canvas><div class="grid2"><button class="btn" id="inkClr">Xoá viết lại</button><button class="btn primary" id="inkOk">Xong</button></div></div>`, (pop) => {
    const cv = pop.querySelector('.ink-pad'), x = cv.getContext('2d'); const strokes = []; let cur = null;
    const col = it.props.color || (IC[it.props.sym] || IC.pin).color;
    const redraw = () => { x.clearRect(0, 0, cv.width, cv.height); x.strokeStyle = '#cbd5e1'; x.lineWidth = 2; x.setLineDash([10, 8]); x.beginPath(); x.moveTo(30, 270); x.lineTo(cv.width - 30, 270); x.stroke(); x.setLineDash([]); drawInk(x, { w: cv.width, h: cv.height, s: strokes, lw: 9 }, cv.width / 2, 0, cv.height, col); };
    if (it.props.ink && it.props.ink.s) { const k = 200 / Math.max(1, it.props.ink.h), ox = (cv.width - it.props.ink.w * k) / 2; for (const s0 of it.props.ink.s) strokes.push(s0.map((v, i) => (i % 2 ? 80 + v * k : ox + v * k))); }
    redraw();
    const pt = (e) => { const r = cv.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * cv.width, ((e.clientY - r.top) / r.height) * cv.height]; };
    cv.onpointerdown = (e) => { e.preventDefault(); try { cv.setPointerCapture(e.pointerId); } catch (_) { /* bút đã nhấc */ } cur = pt(e); strokes.push(cur); redraw(); };
    cv.onpointermove = (e) => { if (!cur) return; const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e]; for (const ev of evs) cur.push(...pt(ev)); redraw(); };
    cv.onpointerup = cv.onpointercancel = () => { cur = null; };
    pop.querySelector('#inkClr').onclick = () => { strokes.length = 0; redraw(); };
    pop.querySelector('#inkOk').onclick = () => {
      closePop();
      if (!strokes.length) { if (it.props.ink) { checkpoint(); delete it.props.ink; changed(); renderProps(); } return; }
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const s0 of strokes) for (let i = 0; i < s0.length; i += 2) { x0 = Math.min(x0, s0[i]); x1 = Math.max(x1, s0[i]); y0 = Math.min(y0, s0[i + 1]); y1 = Math.max(y1, s0[i + 1]); }
      const pad = 10, W = x1 - x0 + 2 * pad, H = Math.max(y1 - y0 + 2 * pad, 120), oy = y0 - pad - (H - (y1 - y0 + 2 * pad)) / 2;
      const ink = { w: Math.round(W), h: Math.round(H), lw: 9, s: strokes.map((s0) => s0.map((v, i) => Math.round(i % 2 ? v - oy : v - x0 + pad))) };
      checkpoint(); it.props.ink = ink; if (it.props.showLabel === false) it.props.showLabel = true; changed(); renderProps(); toast('Đã lưu nhãn viết tay');
    };
  });
}
// ---- Tour route: đi dọc tuyến ở tầm mắt người ----
function newTour(pts) { const o = S.opts.tour; return newItem('flow', pts, { label: 'Tour route', color: o.color, width: 3, tour: true }); }
function tourLen(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += G.dist(pts[i - 1], pts[i]); return L; }
let tour = null;
async function startTour(it) {
  if (!it || it.pts.length < 2) return;
  stopTour(true);
  if (S.mode !== '3d') await setMode('3d');
  const v = await ensure3D(); if (!v) return;
  let pts = G.resample(it.pts, 1); { const e0 = it.pts[it.pts.length - 1]; if (G.dist(pts[pts.length - 1], e0) > 0.01) pts.push(e0); } if (it.props.rev) pts = pts.slice().reverse();
  const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + G.dist(pts[i - 1], pts[i]));
  const L = cum[cum.length - 1]; if (L < 1) return;
  const at = (s) => { s = Math.max(0, Math.min(L, s)); let lo = 0, hi = cum.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; } const t = (s - cum[lo]) / Math.max(1e-9, cum[hi] - cum[lo]); return [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * t, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * t]; };
  const cam = v.camera, ctl = v.controls;
  tour = { it, s: 0, L, at, paused: false, last: performance.now(), keep: { pos: cam.position.clone(), tgt: ctl.target.clone(), fov: cam.fov, maxP: ctl.maxPolarAngle }, look: null, speed: it.props.speed || S.opts.tour.speed, eye: it.props.eye || S.opts.tour.eye };
  ctl.enabled = false; cam.fov = 62; cam.updateProjectionMatrix(); ctl.maxPolarAngle = Math.PI * 0.53;
  document.body.classList.add('touring');
  let bar = document.getElementById('tourBar');
  if (!bar) { bar = h('<div id="tourBar" class="tour-bar"><span class="tt"></span><div class="tprog"><i></i></div><button class="chip" data-a="slow">－</button><span class="sp"></span><button class="chip" data-a="fast">＋</button><button class="chip" data-a="pause">⏸ Tạm dừng</button><button class="chip stop" data-a="stop">■ Dừng</button></div>'); $('#editor').append(bar);
    bar.onclick = (e) => { const a = e.target.dataset && e.target.dataset.a; if (!a || !tour) return; if (a === 'stop') stopTour(); else if (a === 'pause') { tour.paused = !tour.paused; tour.last = performance.now(); e.target.textContent = tour.paused ? '▶ Tiếp tục' : '⏸ Tạm dừng'; } else { tour.speed = Math.max(1, Math.min(60, tour.speed + (a === 'fast' ? 2 : -2))); bar.querySelector('.sp').textContent = tour.speed + ' km/h'; } };
    // kéo trên màn hình để nhìn sang trái / phải trong khi đi
    let lx = null; const cv = v.renderer.domElement;
    cv.addEventListener('pointerdown', (e) => { if (tour) { lx = e.clientX; e.stopPropagation(); } }, true);
    cv.addEventListener('pointermove', (e) => { if (tour && lx != null) { tour.yaw = (tour.yaw || 0) + (e.clientX - lx) * 0.006; lx = e.clientX; } }, true);
    cv.addEventListener('pointerup', () => { lx = null; }, true);
  }
  bar.hidden = false; bar.querySelector('[data-a="pause"]').textContent = '⏸ Tạm dừng';
  bar.querySelector('.tt').textContent = '🚶 ' + (it.props.label || 'Tour route');
  bar.querySelector('.sp').textContent = tour.speed + ' km/h';
  closePop(); $('#props').hidden = true;
  const step = () => {
    if (!tour) return;
    const now = performance.now(), dt = Math.min(0.1, (now - tour.last) / 1000); tour.last = now;
    if (!tour.paused) tour.s += (tour.speed / 3.6) * dt * (tour.fastFwd || 1);
    const p = at(tour.s), ahead = at(tour.s + 12);
    let dir = [ahead[0] - p[0], ahead[1] - p[1]]; const dl = Math.hypot(dir[0], dir[1]) || 1; dir = [dir[0] / dl, dir[1] / dl];
    if (!tour.look) tour.look = dir; else { const k = Math.min(1, dt * 2.5); tour.look = [tour.look[0] + (dir[0] - tour.look[0]) * k, tour.look[1] + (dir[1] - tour.look[1]) * k]; const n = Math.hypot(...tour.look) || 1; tour.look = [tour.look[0] / n, tour.look[1] / n]; }
    const ya = tour.yaw || 0, lx2 = tour.look[0] * Math.cos(ya) - tour.look[1] * Math.sin(ya), ly2 = tour.look[0] * Math.sin(ya) + tour.look[1] * Math.cos(ya);
    const gz = M.groundAt(p[0], p[1]); cam.position.set(p[0], gz + tour.eye, p[1]); ctl.target.set(p[0] + lx2 * 10, gz + tour.eye - 0.35, p[1] + ly2 * 10);
    cam.lookAt(ctl.target);
    const pr = document.querySelector('#tourBar .tprog i'); if (pr) pr.style.width = Math.min(100, (tour.s / L) * 100) + '%';
    if (tour.s >= L) { tour.paused = true; const b = document.querySelector('#tourBar [data-a="pause"]'); if (b) b.textContent = '↺ Đi lại'; if (b) b.onclick = () => { if (tour) { tour.s = 0; tour.paused = false; tour.last = performance.now(); b.onclick = null; b.textContent = '⏸ Tạm dừng'; } }; }
    tour.raf = requestAnimationFrame(step);
  };
  tour.raf = requestAnimationFrame(step);
  toast('Đang đi theo Tour route · kéo ngang màn hình để nhìn sang hai bên');
}
function stopTour(silent) {
  if (!tour) return;
  cancelAnimationFrame(tour.raf);
  const v = v3; if (v) { v.camera.position.copy(tour.keep.pos); v.controls.target.copy(tour.keep.tgt); v.camera.fov = tour.keep.fov; v.camera.updateProjectionMatrix(); v.controls.maxPolarAngle = tour.keep.maxP; v.controls.enabled = true; v.controls.update(); }
  tour = null; document.body.classList.remove('touring');
  const bar = document.getElementById('tourBar'); if (bar) bar.hidden = true;
  if (!silent) renderProps();
}
function deleteSelected() {
  const it = S.doc.items.find((i) => i.id === S.selectedId);
  if (!it) return;
  if (M.isLocked(S.doc, it)) { lockedToast(); return; }
  checkpoint(); S.doc.items = S.doc.items.filter((i) => i.id !== S.selectedId); S.selectedId = null; changed();
}
let propsLastId = null;
function renderProps() {
  const box = $('#props');
  if (S.skSel && S.tool === 'facet' && renderSkProps(box)) return;
  if (S.doc && S.multi.length > 1) { renderMultiProps(box); return; }
  const it = S.doc && S.doc.items.find((i) => i.id === S.selectedId);
  if (it && it.id !== propsLastId && PANEL.props && PANEL.props.min) { PANEL.props.min = false; savePanels(); } // chọn đối tượng khác: mở lại bảng thuộc tính
  propsLastId = it ? it.id : null;
  $('#editor').classList.toggle('props-open', !!it); // bảng thuộc tính che chỗ bảng chỉ tiêu
  if (!it) { box.hidden = true; return; }
  box.hidden = false; box.innerHTML = '';
  const head = h(`<h3>${it.props && it.props.tour ? 'Tour route' : M.KIND_NAMES[it.kind]}<button class="ibtn x" aria-label="Đóng"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></h3>`);
  head.querySelector('.x').onclick = () => { S.selectedId = null; renderProps(); changed({ save: false }); };
  box.append(head);
  const edit = (fn) => { checkpoint(); fn(); changed({ light: true }); };
  const field = (label, node) => { const f = h(`<div class="field"><span>${label}</span></div>`); f.append(node); box.append(f); return f; };
  const kv = (rows) => { const k = h('<div class="kv"></div>'); for (const [a, b, cls] of rows) k.append(h(`<span>${a}</span>`), h(`<b class="${cls || ''}">${b}</b>`)); box.append(k); return k; };
  const textField = (label, key, ph = '') => {
    const inp = h(`<input type="text" data-hw="text" placeholder="${ph}" value="${esc(it.props[key] || '')}">`);
    inp.onchange = () => edit(() => (it.props[key] = inp.value.trim()));
    const wrap = h('<span class="txt-hw"></span>');
    const hb = h('<button class="hw-btn" title="Viết tay, máy tự nhận thành chữ">✍</button>');
    hb.onclick = () => openTextHW(inp);
    wrap.append(inp, hb); field(label, wrap);
  };
  const area = M.itemArea(it);

  switch (it.kind) {
    case 'road':
      if (it.props.ped) {
        box.append(h('<div class="note">Đường đi bộ (không có vỉa hè)</div>'));
        kv([['Chiều dài', G.fmtNum(G.length(it.pts), 0) + ' m'], ['Bề rộng', G.fmtNum(it.props.width) + ' m'], ['Diện tích', G.fmtArea(area)]]);
        field('Bề rộng (m)', numInput(it.props.width, (v) => edit(() => (it.props.width = Math.max(0.5, v)))));
      } else {
      kv([['Chiều dài', G.fmtNum(G.length(it.pts), 0) + ' m'], ['Lộ giới', G.fmtNum(M.roadTotalWidth(it)) + ' m'], ['Diện tích', G.fmtArea(area)]]);
      field('Lòng đường (m)', numInput(it.props.width, (v) => edit(() => (it.props.width = v))));
      field('Vỉa hè mỗi bên (m)', numInput(it.props.sidewalk, (v) => edit(() => (it.props.sidewalk = v))));
      }
      { // loại đường: đổi loại thì mặt cắt theo loại
        const sel = h(`<select style="max-width:230px"><option value="">— Chưa phân loại —</option>${RO.ROAD_CLASSES.map((c) => `<option value="${c.id}" ${it.props.cls === c.id ? 'selected' : ''}>${c.id}. ${c.name}</option>`).join('')}</select>`);
        sel.onchange = () => { const c = RO.roadClass(+sel.value); edit(() => { if (!c) { delete it.props.cls; return; } it.props.cls = c.id; it.props.width = c.width; it.props.sidewalk = c.sidewalk; if (c.ped) it.props.ped = true; else delete it.props.ped; }); renderProps(); };
        field('Loại đường', sel);
      }
      textField('Tên đường', 'name', 'VD: Đường D1');
      if (it.props.pis && it.props.pis.length > 2 && it.props.pis.length <= 30 && (it.props.radii || []).some((r) => r > 0)) {
        const eff = it.props.radiiEff || it.props.radii;
        box.append(h(`<div class="note">Tuyến gồm ${it.props.pis.length - 1} đoạn thẳng và ${it.props.pis.length - 2} đường cong (kéo chấm tròn để dời đỉnh)</div>`));
        it.props.radii.forEach((r, k) => {
          const f = field(`Cong ${k + 1}: R (m)`, numInput(r, (v) => edit(() => { it.props.radii[k] = Math.max(0, v); setRoadGeometry(it); })));
          if (eff && eff[k] < r) f.append(h(`<small class="muted" title="Không đủ chỗ cho bán kính này">tối đa ${eff[k]}</small>`));
        });
      } else if (it.props.ring) box.append(h(`<div class="note">Đường vòng tròn R = ${it.props.ring.r} m</div>`));
      break;
    case 'junction': {
      const cs = RO.junctionCorners(S.doc, it);
      kv([['Số góc', String(cs.length)], ['V chung', G.fmtNum(it.props.V || 0) + ' m'], ['R chung', G.fmtNum(it.props.R || 0) + ' m']]);
      const b = h('<button class="btn primary" style="width:100%">Sửa góc vát, bán kính</button>'); b.onclick = () => openJunctionDialog(it); box.append(b);
      break;
    }
    case 'facet': {
      const par = S.doc.items.find((i) => i.id === it.props.parent);
      const poly = it.props.poly || [];
      kv([['Thuộc mặt', faceLabel({ parent: it.props.parent, face: it.props.face })], ['Diện tích mảng', G.fmtArea(Math.abs(G.area(poly)) - (it.props.holes || []).reduce((s2, hh) => s2 + Math.abs(G.area(hh)), 0))], [(it.props.depth || 0) < 0 ? 'Lõm vào' : 'Độ nhô', G.fmtNum(Math.abs(it.props.depth || 0), 1) + ' m']]);
      field('Độ nhô ra (m)', stepper(it.props.depth || 0, -facetMaxIn(it), 0.5, (v) => edit(() => (it.props.depth = Math.max(-facetMaxIn(it), v)))));
      box.append(h('<div class="note">Số dương: đùn ra theo pháp tuyến của mặt (mái: đùn lên; mặt đứng: nhô ra ngoài). Số âm: ấn lõm vào trong khối (khoét hốc). 0 = chỉ là đường chia trên mặt.</div>'));
      colorRow(it, edit);
      if (par) { const b = h('<button class="btn" style="width:100%;margin-top:6px">Chọn khối chứa mảng</button>'); b.onclick = () => { S.selectedId = rootOf(it).id; renderProps(); changed({ save: false }); }; box.append(b); }
      { const rt = rootOf(it); if (rt && rt.kind === 'building') { const iso = h(`<label class="chk iso-chk"><input type="checkbox" ${S.iso === rt.id ? 'checked' : ''}> Khóa khối chứa mảng</label>`); iso.querySelector('input').onchange = (e) => setIso(e.target.checked ? rt.id : null); box.append(iso); } }
      break;
    }
    case 'building': {
      { const iso = h(`<label class="chk iso-chk"><input type="checkbox" ${S.iso === it.id ? 'checked' : ''}> Khóa khối</label>`); iso.querySelector('input').onchange = (e) => setIso(e.target.checked ? it.id : null); box.append(iso); }
      const z = S.doc.items.find((i) => i.kind === 'zone' && G.pointInPolygon(G.centroid(it.pts), i.pts));
      const f = it.props.floors;
      const over = z && z.props.maxFloors > 0 && f > z.props.maxFloors;
      kv([['Diện tích chiếm đất', G.fmtArea(area)], ['Tổng sàn (GFA)', G.fmtArea(area * f)], ['Chiều cao', G.fmtNum(f * (it.props.floorH || 3.3)) + ' m'],
        ['Thuộc ô đất', z ? M.lotName(S.metrics, z) : '—'], ...(z ? [['Tầng cao khống chế', z.props.maxFloors + ' tầng', over ? 'over' : '']] : [])]);
      field('Số tầng', stepper(f, 1, 1, (v) => edit(() => (it.props.floors = v))));
      {
        const chips = h('<div class="chips"></div>');
        const w = h(`<button class="chip ${!it.props.color ? 'on' : ''}">Mặc định</button>`);
        w.onclick = () => edit(() => delete it.props.color); chips.append(w);
        const grid = h('<div class="tone-grid"></div>');
        for (const c of TONES) {
          const b = h(`<button class="${(it.props.color || '') === c ? 'on' : ''}" style="background:${c}" aria-label="Màu ${c}"></button>`);
          b.onclick = () => edit(() => (it.props.color = c)); grid.append(b);
        }
        const pick = h(`<input type="color" value="${it.props.color || '#ffffff'}" aria-label="Chọn màu khác" style="width:40px;height:34px;border:0;background:none">`);
        pick.onchange = () => edit(() => (it.props.color = pick.value));
        chips.append(pick);
        field('Màu công trình', h(`<span class="swatch" style="background:${it.props.color || '#f7f7f5'}"></span>`)); box.append(chips, grid);
      }
      if (z) {
        const lot = S.metrics.lots.find((l) => l.zone.id === z.id);
        if (lot) {
          const lv = (v, lim) => (lim <= 0 ? '' : v > lim + 1e-6 ? 'over' : v > lim * 0.9 ? 'warn' : '');
          box.append(h(`<div class="note">Thửa đất <b>${esc(M.lotName(S.metrics, z))}</b> (cập nhật theo tầng cao)</div>`));
          kv([['MĐXD thửa', G.fmtNum(lot.mdxd) + ' %' + (z.props.maxMdxd ? ' / ' + z.props.maxMdxd + ' %' : ''), lv(lot.mdxd, z.props.maxMdxd)],
            ['HSSDĐ thửa', G.fmtNum(lot.far, 2) + (z.props.maxFar ? ' / ' + z.props.maxFar : ''), lv(lot.far, z.props.maxFar)],
            ['Tổng sàn thửa', G.fmtArea(lot.gfa)]]);
        }
      }
      field('Chiều cao tầng (m)', numInput(it.props.floorH || 3.3, (v) => edit(() => (it.props.floorH = Math.max(2, v)))));
      if (it.props.preset) {
        const pr = it.props.preset;
        box.append(h(`<div class="note">Khối mẫu: <b>${M.PRESETS[pr.type].name}</b> – kéo thanh trượt để co kéo</div>`));
        for (const [k, v] of Object.entries(pr.params)) {
          const r = h(`<input type="range" min="${k === 't' ? 6 : 6}" max="${k === 't' ? 40 : 200}" step="1" value="${v}">`);
          const out = h(`<b>${v} m</b>`);
          r.oninput = () => { pr.params[k] = +r.value; out.textContent = r.value + ' m'; M.applyPreset(it); changed({ save: false, light: true }); };
          r.onchange = () => { changed(); };
          r.onpointerdown = () => checkpoint();
          const f2 = field(M.PARAM_NAMES[k], out); f2.after(r);
        }
        const rot = h(`<input type="range" min="-180" max="180" step="1" value="${Math.round(((pr.rot || 0) * 180) / Math.PI)}">`);
        const ro = h(`<b>${Math.round(((pr.rot || 0) * 180) / Math.PI)}°</b>`);
        rot.onpointerdown = () => checkpoint();
        rot.oninput = () => { pr.rot = (+rot.value * Math.PI) / 180; ro.textContent = rot.value + '°'; M.applyPreset(it); changed({ save: false, light: true }); };
        rot.onchange = () => changed();
        field('Góc xoay', ro).after(rot);
      }
      {
        const rr = h('<div class="actions"></div>');
        const rot = (deg) => edit(() => { C.rotateItem(it, (deg * Math.PI) / 180); C.pushInside(S.doc, it); });
        const b1 = h('<button class="btn">⟲ 15°</button>'); b1.onclick = () => rot(-15);
        const b2 = h('<button class="btn">⟳ 15°</button>'); b2.onclick = () => rot(15);
        const b3 = h('<button class="btn">∥ Theo đường</button>');
        b3.onclick = () => { const d = C.parallelDelta(S.doc, it, 90, true); if (d == null) return toast('Không có đường nào gần'); edit(() => { C.rotateItem(it, d); C.pushInside(S.doc, it); }); toast('Đã xoay song song đường gần nhất'); };
        rr.append(b1, b2, b3); box.append(rr);
        if (S.metrics.outside && S.metrics.outside.includes(it.id)) box.append(h('<div class="alert over">Công trình đang lấn ra ngoài chỉ giới xây dựng</div>'));
      }
      quickInput(it, edit);
      break;
    }
    case 'zone': {
      const lot = S.metrics.lots.find((l) => l.zone.id === it.id) || { mdxd: 0, far: 0, fp: 0, gfa: 0, maxFloors: 0 };
      const lv = (v, lim) => (lim <= 0 ? (v > 0 ? 'over' : '') : v > lim + 1e-6 ? 'over' : v > lim * 0.9 ? 'warn' : '');
      kv([['Diện tích', G.fmtArea(area)], ['MĐXD thực tế', G.fmtNum(lot.mdxd) + ' %', lv(lot.mdxd, it.props.maxMdxd)], ['Hệ số SDĐ thực tế', G.fmtNum(lot.far, 2), lv(lot.far, it.props.maxFar)],
        ['Tầng cao lớn nhất', lot.maxFloors ? lot.maxFloors + ' tầng' : '—', it.props.maxFloors > 0 && lot.maxFloors > it.props.maxFloors ? 'over' : ''], ['Tổng sàn', G.fmtArea(lot.gfa)]]);
      const chips = h('<div class="chips"></div>');
      chips.classList.add('lu-grid');
      { const cl = M.LANDUSE[it.props.code], cg = cl ? cl.lbl + '|' + cl.name + '|' + cl.color : '';
        for (const k of M.luChoices()) {
          const lu = M.LANDUSE[k];
          const c = h(`<button class="chip ${lu.lbl + '|' + lu.name + '|' + lu.color === cg ? 'on' : ''}" title="${esc(lu.name)}"><span class="sw" style="background:${lu.color}"></span>${esc(lu.lbl)}</button>`);
          c.onclick = () => edit(() => Object.assign(it.props, { code: k, maxMdxd: lu.mdxd, maxFar: lu.far, maxFloors: lu.floors }));
          chips.append(c);
        } }
      { const add = h('<button class="chip add">＋ Chức năng / màu</button>'); add.onclick = openLanduseDialog; chips.append(add); }
      box.append(h(`<div class="note"><b>${esc(M.luLabel(it.props.code))}</b> – ${esc(M.LANDUSE[it.props.code]?.name || '')}</div>`), chips);
      box.append(h(`<div class="note">Số hiệu tự động: <b>${esc(M.lotName({ lotNames: S.metrics.lotNames }, { props: { code: it.props.code } , id: it.id }))}</b> (đánh số từ trên xuống, trái qua phải theo từng ký hiệu)</div>`));
      textField('Tên lô riêng (để trống = tự động)', 'name', 'VD: A1');
      { // HSSDĐ = MĐXD × Tầng cao: tích một giá trị làm hằng số, sửa giá trị khác thì giá trị còn lại tự tính
        const lock = it.props.indLock || 'mdxd';
        const wrap = h('<div class="indgrid"><div class="ind-head"><span>Chỉ tiêu tối đa</span><span>Cố định</span></div></div>');
        for (const [k, n] of [['mdxd', 'MĐXD tối đa (%)'], ['far', 'Hệ số SDĐ tối đa'], ['floors', 'Tầng cao tối đa']]) {
          const row = h(`<div class="ind-row ${lock === k ? 'locked' : ''}"><span>${n}</span></div>`);
          row.append(numInput(it.props[M.IND_KEYS[k]], (v) => { let tg; edit(() => { tg = M.setIndicator(it.props, k, v); }); renderProps(); const nm = { mdxd: 'MĐXD', far: 'Hệ số SDĐ', floors: 'Tầng cao' }[tg]; if (nm) toast(`${nm} tự tính lại theo HSSDĐ = MĐXD × Tầng cao`); }));
          const rb = h(`<label class="ind-lock" title="Giữ cố định giá trị này"><input type="radio" name="indLock" ${lock === k ? 'checked' : ''}><span>${lock === k ? '🔒' : ''}</span></label>`);
          rb.querySelector('input').onchange = () => { edit(() => (it.props.indLock = k)); renderProps(); };
          row.append(rb); wrap.append(row);
        }
        box.append(wrap);
        box.append(h(`<div class="note">HSSDĐ = MĐXD × Tầng cao. Giá trị đánh dấu <b>Cố định</b> giữ nguyên; sửa một trong hai giá trị còn lại thì giá trị kia tự tính theo công thức.</div>`));
      }
      field('Khoảng lùi (m)', numInput(it.props.setback || 0, (v) => edit(() => (it.props.setback = v))));
      if ((it.props.setback || 0) > 0) box.append(h('<div class="note">Đường đỏ nét chấm gạch là chỉ giới xây dựng. Công trình đặt vào ô này không được lấn ra ngoài.</div>'));
      quickInput(it, edit);
      break;
    }
    case 'water':
      kv([['Loại', it.props.mode === 'river' ? 'Sông / suối' : 'Hồ'], ['Diện tích mặt nước', G.fmtArea(area)]]);
      if (it.props.mode === 'river') field('Bề rộng (m)', numInput(it.props.width, (v) => edit(() => (it.props.width = v))));
      field('Hành lang bảo vệ (m)', numInput(it.props.setback || 0, (v) => edit(() => (it.props.setback = v))));
      textField('Tên', 'name');
      break;
    case 'park': kv([['Diện tích', G.fmtArea(area)]]); textField('Tên', 'name', 'VD: Công viên trung tâm'); break;
    case 'land': {
      const st = it.props.style;
      kv([['Kiểu', (M.LAND_STYLES[st] || {}).name || st], ...(M.LAND_CLOSED[st] ? [['Diện tích', G.fmtArea(area)]] : []), ...(st !== 'tree' && !M.LAND_CLOSED[st] || st === 'grove' ? [['Số cây', String(M.landTrees(it).length)]] : [])]);
      if (st === 'row' || st === 'grove') field('Khoảng cách cây (m)', stepper(it.props.spacing || 8, 2, 1, (v) => edit(() => (it.props.spacing = v))));
      if (st === 'row' || st === 'grove' || st === 'tree') field('Tán cây (m)', stepper(it.props.size || 6, 2, 1, (v) => edit(() => (it.props.size = v))));
      if (st === 'row' || st === 'grove') { const c = h(`<label class="chk" style="font-weight:400;font-size:14px"><input type="checkbox" ${it.props.vary ? 'checked' : ''}> Cây to nhỏ khác nhau</label>`); c.querySelector('input').onchange = (e) => edit(() => (it.props.vary = e.target.checked)); box.append(c); }
      if (st === 'row' || st === 'grove' || st === 'tree') { const ch = h('<div class="chips"></div>'); box.append(ch); treeLibChips(ch, it.props.tree || 'round', (k) => { edit(() => (it.props.tree = k)); renderProps(); }); }
      if (M.LAND_CLOSED[st]) textField('Tên', 'name', 'VD: Quảng trường trung tâm');
      break;
    }
    case 'circle':
      field('Bán kính (m)', numInput(it.props.radius, (v) => edit(() => (it.props.radius = Math.max(5, v)))));
      { const chips = h('<div class="chips"></div>'); for (const r of [300, 500, 800, 1000]) { const c = h(`<button class="chip">${r} m</button>`); c.onclick = () => edit(() => (it.props.radius = r)); chips.append(c); } box.append(chips); }
      textField('Nhãn', 'label', 'VD: Trung tâm');
      colorRow(it, edit);
      field('Độ dày nét (px)', stepper(it.props.width || 2, 0.5, 1, (v) => edit(() => (it.props.width = v))));
      { const c = h(`<label class="chk" style="font-weight:400;font-size:14px"><input type="checkbox" ${it.props.dash !== false ? 'checked' : ''}> Nét đứt</label>`); c.querySelector('input').onchange = (e) => edit(() => (it.props.dash = e.target.checked)); box.append(c); }
      break;
    case 'arrow': case 'flow':
      if (it.props.tour) {
        const go = h('<button class="btn primary" style="width:100%;margin:4px 0 8px">▶ Đi theo lộ trình (góc nhìn người)</button>'); go.onclick = () => startTour(it); box.append(go);
        kv([['Chiều dài tuyến', G.fmtNum(tourLen(it.pts)) + ' m'], ['Thời gian đi', G.fmtNum(tourLen(it.pts) / ((it.props.speed || S.opts.tour.speed) / 3.6) / 60, 1) + ' phút']]);
        field('Tốc độ (km/h)', stepper(it.props.speed || S.opts.tour.speed, 1, 1, (v) => edit(() => (it.props.speed = v))));
        field('Tầm mắt (m)', stepper(it.props.eye || S.opts.tour.eye, 0.5, 0.1, (v) => edit(() => (it.props.eye = Math.round(v * 10) / 10))));
        { const c = h(`<label class="chk"><input type="checkbox" ${it.props.rev ? 'checked' : ''}> Đi theo chiều ngược lại</label>`); c.querySelector('input').onchange = (e) => edit(() => (it.props.rev = e.target.checked)); box.append(c); }
        textField('Tên tuyến', 'label', 'VD: Tour route ven hồ'); colorRow(it, edit);
        break;
      }
      textField('Nhãn', 'label', 'VD: Hướng gió Đông Nam'); colorRow(it, edit);
      field('Độ dày (m)', stepper(it.props.width || (it.kind === 'arrow' ? 8 : 3), 0.5, it.kind === 'arrow' ? 2 : 1, (v) => edit(() => (it.props.width = v))));
      break;
    case 'icon': {
      const wrap = h('<div class="icon-grid small"></div>');
      for (const k of ICON_KEYS) {
        const b = h(`<button class="${it.props.sym === k ? 'on' : ''}" title="${IC[k].name}"><canvas width="40" height="40"></canvas></button>`);
        drawIconAt(b.querySelector('canvas').getContext('2d'), k, 20, 20, 32, it.props.color || '');
        b.onclick = () => edit(() => (it.props.sym = k)); wrap.append(b);
      }
      box.append(wrap);
      field('Kích thước (m)', stepper(it.props.size || 20, 2, 5, (v) => edit(() => (it.props.size = v))));
      field('Cách mặt đất (m)', stepper(it.props.elev ?? 4, 0, 1, (v) => edit(() => (it.props.elev = v))));
      { const c = h(`<label class="chk"><input type="checkbox" ${it.props.showLabel !== false ? 'checked' : ''}> Hiện nhãn trên màn hình</label>`); c.querySelector('input').onchange = (e) => edit(() => (it.props.showLabel = e.target.checked)); box.append(c); }
      textField('Nhãn chữ', 'label', 'VD: Bãi đỗ xe');
      { const row = h('<div class="ink-row"></div>');
        if (it.props.ink && it.props.ink.s && it.props.ink.s.length) { const cv = h('<canvas class="ink-prev" width="240" height="56"></canvas>'); const x = cv.getContext('2d'); drawInk(x, it.props.ink, 120, 6, 44, it.props.color || (IC[it.props.sym] || IC.pin).color); row.append(cv); }
        const b = h(`<button class="btn">✎ ${it.props.ink ? 'Viết lại nhãn bằng bút' : 'Viết nhãn bằng bút'}</button>`); b.onclick = () => openInkPad(it); row.append(b);
        if (it.props.ink) { const d = h('<button class="btn">Bỏ nhãn viết tay</button>'); d.onclick = () => edit(() => delete it.props.ink); row.append(d); }
        box.append(row); }
      { const ch = h('<div class="chips"></div>'); box.append(ch); colorChips(ch, it.props.color, (c) => edit(() => (it.props.color = c)), true); }
      break;
    }
    case 'cloud': textField('Nhãn', 'label', 'VD: Giai đoạn 1'); colorRow(it, edit); break;
    case 'sketch': colorRow(it, edit); field('Độ dày (m)', numInput(+(it.props.width || 1).toFixed(2), (v) => edit(() => (it.props.width = Math.max(0.05, v))))); break;
    case 'cad': kv([['Số điểm', it.pts.length]]); break;
  }
  const act = h('<div class="actions"></div>');
  const dup = h('<button class="btn">Nhân bản</button>');
  dup.onclick = () => {
    const c = JSON.parse(JSON.stringify(it)); c.id = M.uid();
    const off = 20 / S.view.scale * 2;
    c.pts = G.translatePts(c.pts, off, off); if (c.holes) c.holes = c.holes.map((hh) => G.translatePts(hh, off, off));
    if (c.props.preset) { c.props.preset.cx += off; c.props.preset.cy += off; }
    if (c.props.pis) c.props.pis = G.translatePts(c.props.pis, off, off);
    if (c.props.ctrl) c.props.ctrl = G.translatePts(c.props.ctrl, off, off);
    checkpoint(); S.doc.items.push(c); S.selectedId = c.id; changed();
  };
  const del = h('<button class="btn danger">Xoá</button>'); del.onclick = deleteSelected;
  act.append(dup, del);
  if (S.doc.layers.some((l) => l.id >= 100) || it.kind === 'building') { // đưa đối tượng vào lớp tự tạo / lớp Công trình hiện trạng
    const cur = it.layer >= 100 || (it.layer === 9 && it.kind === 'building') ? it.layer : '';
    const sel = h(`<select class="num" style="width:100%"><option value="">Mặc định: ${esc(M.layerName(S.doc, M.KIND_LAYER[it.kind] ?? 4))}</option>${it.kind === 'building' ? `<option value="9" ${cur === 9 ? 'selected' : ''}>${esc(M.layerName(S.doc, 9))}</option>` : ''}${S.doc.layers.filter((l) => l.id >= 100).map((l) => `<option value="${l.id}" ${cur === l.id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>`);
    sel.onchange = () => { checkpoint(); const v = sel.value ? +sel.value : null; for (const k of [it, ...S.doc.items.filter((q) => q.kind === 'facet' && q.props.parent === it.id)]) k.layer = v || (M.KIND_LAYER[k.kind] ?? 4); changed(); };
    box.append(lbl('Lớp', sel));
  }
  box.append(act);
  panelChrome(box, 'props', M.KIND_NAMES[it.kind] || 'Thuộc tính', head);
  if (M.isLocked(S.doc, it)) {
    box.querySelectorAll('input, select, textarea, button:not(.x):not(.pgrip):not(.pmin)').forEach((el) => (el.disabled = true));
    del.remove(); dup.disabled = false;
    head.after(h(`<div class="note lock-note">🔒 Lớp «${esc(M.layerName(S.doc, M.layerOf(it)))}» đang khoá: không thể sửa, di chuyển hoặc xoá đối tượng này.</div>`));
  }
}
// Bảng màu công trình: 12 sắc độ × 5 tông (nhạt → đậm) + dải xám
const TONES = (() => {
  const hsl = (hh, s, l) => { s /= 100; l /= 100; const k = (n) => (n + hh / 30) % 12, a = s * Math.min(l, 1 - l); const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))).toString(16).padStart(2, '0'); return '#' + f(0) + f(8) + f(4); };
  const out = [];
  for (const [s, l] of [[70, 90], [65, 80], [60, 68], [55, 55], [50, 40]]) for (const hh of [0, 18, 32, 45, 60, 90, 140, 175, 200, 220, 260, 320]) out.push(hsl(hh, s, l));
  for (const l of [100, 93, 85, 74, 62, 50, 40, 32, 25, 18, 12, 6]) out.push(hsl(210, 8, l));
  return out;
})();
const CAT_OPTS = Object.entries(M.CAT_NAMES);
// Bảng màu quy hoạch gợi ý (màu nền ô đất thường dùng)
const LU_PAL = ['#f6d36b', '#f3e3a1', '#ffe599', '#fff2cc', '#f2b84b', '#e7a07a', '#f4b183', '#ef8f8f', '#f4b6b6', '#e5606b', '#c0392b', '#f29d5a', '#e8738f', '#d77ac0', '#c9a0dc', '#b39ddb', '#8e7cc3', '#a8774a', '#c8a27a', '#d9ead3', '#9fd27a', '#86c96a', '#5fa85a', '#2e7d32', '#cfe2f3', '#8ec9ec', '#4a90d9', '#b3b3b3', '#cfcfcf', '#d9d9d9', '#7f7f7f', '#ffffff'];
const LU_KEY = 'qp.landuse.default';
const isHex = (c) => /^#[0-9a-f]{6}$/i.test(c || '');
// Bộ màu / chức năng đã lưu làm mặc định cho bản vẽ mới
function savedLanduse() { try { const v = JSON.parse(localStorage.getItem(LU_KEY) || 'null'); return v && typeof v === 'object' ? v : null; } catch { return null; } }
function cleanLanduse(src) {
  const out = {};
  for (const [k0, v] of Object.entries(src || {})) {
    const k = String(k0).toUpperCase().replace(/[^A-Z0-9Đ]/g, '').slice(0, 10);
    if (!k || !v || typeof v !== 'object') continue;
    const e = {};
    if (isHex(v.color)) e.color = v.color.toLowerCase();
    if (typeof v.name === 'string' && v.name.trim()) e.name = v.name.trim().slice(0, 60);
    if (v.cat && M.CAT_NAMES[v.cat]) e.cat = v.cat;
    for (const f of ['mdxd', 'far', 'floors']) if (Number.isFinite(+v[f]) && v[f] !== '' && v[f] != null) e[f] = +v[f];
    if (!M.isDefaultLanduse(k) && !(e.name && e.color)) continue;
    if (Object.keys(e).length) out[k] = e;
  }
  return out;
}
function openLanduseDialog(focus) {
  const lu = (S.doc.settings.landuse = S.doc.settings.landuse || {});
  let open = typeof focus === 'string' ? focus : null;
  openPop(`<div><h3>Chức năng sử dụng đất</h3>
    <div class="note">Chạm vào một chức năng để đổi màu (bảng màu, mã HEX), tên, chỉ tiêu. Mẹo: nhấn giữ chip mã ở hộp SDĐ để mở thẳng chức năng đó.</div>
    <div id="luRows" class="lu-rows"></div>
    <div class="lu-tools">
      <button class="btn" id="luReset">↺ Về màu chuẩn tất cả</button>
      <button class="btn" id="luSaveDef">★ Lưu làm mặc định cho bản vẽ mới</button>
      <button class="btn" id="luApplyDef" ${savedLanduse() ? '' : 'hidden'}>⇩ Dùng bộ mặc định đã lưu</button>
      <button class="btn" id="luExport">Xuất bộ màu (.json)</button>
      <button class="btn" id="luImport">Nhập bộ màu</button>
    </div>
    <h4>Thêm chức năng mới</h4>
    <div class="field"><span>Ký hiệu</span><input id="luCode" class="num" style="width:110px;text-transform:uppercase" placeholder="VD: DL"></div>
    <div class="field"><span>Tên chức năng</span><input id="luName" type="text" style="width:170px" placeholder="VD: Đất du lịch"></div>
    <div class="field"><span>Nhóm thống kê</span><select id="luCat">${CAT_OPTS.map(([k, n]) => `<option value="${k}" ${k === 'k' ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    <div class="field"><span>Màu</span><input id="luColor" type="color" value="#7fc8c0" style="width:48px;height:34px;border:0;background:none"></div>
    <div class="field"><span>MĐXD tối đa (%)</span><input id="luMd" class="num" inputmode="decimal" value="40"></div>
    <div class="field"><span>Hệ số SDĐ tối đa</span><input id="luFar" class="num" inputmode="decimal" value="1.5"></div>
    <div class="field"><span>Tầng cao tối đa</span><input id="luFl" class="num" inputmode="decimal" value="5"></div>
    <button class="btn primary" id="luAdd" style="width:100%;margin-top:8px">＋ Thêm chức năng</button></div>`, (pop) => {
    const rows = pop.querySelector('#luRows');
    const apply = () => { M.applyLanduse(S.doc); changed(); renderToolOpts(); renderProps(); };
    const setF = (k, f, v) => {
      const d = M.isDefaultLanduse(k) ? M.LANDUSE_DEFAULT_OF(k) : null;
      const e = { ...(lu[k] || {}) };
      if (d && d[f] === v) delete e[f]; else e[f] = v;
      if (Object.keys(e).length) lu[k] = e; else delete lu[k];
      apply();
    };
    const draw = () => {
      rows.innerHTML = '';
      for (const [k, v] of Object.entries(M.LANDUSE)) {
        const mod = !!lu[k] && M.isDefaultLanduse(k);
        const r = h(`<div class="lu-row ${open === k ? 'open' : ''}"><span class="lu-sw" style="background:${v.color}"></span><b>${esc(v.lbl || k)}</b><span>${esc(v.name)}${mod ? ' <i class="muted">· đã đổi</i>' : ''}</span><span class="lu-arr">${open === k ? '▴' : '▾'}</span></div>`);
        r.onclick = () => { open = open === k ? null : k; draw(); };
        rows.append(r);
        if (open !== k) continue;
        const ed = h(`<div class="lu-edit">
          <div class="lu-pal"></div>
          <div class="field"><span>Mã màu</span><input class="lu-hex num" style="width:100px" value="${v.color}" maxlength="7"><input type="color" class="lu-pick" value="${v.color}"></div>
          <div class="field"><span>Tên</span><input class="lu-name" type="text" style="width:190px" value="${esc(v.name)}"></div>
          <div class="field"><span>MĐXD tối đa (%)</span><input class="lu-md num" inputmode="decimal" value="${v.mdxd}"></div>
          <div class="field"><span>Hệ số SDĐ tối đa</span><input class="lu-far num" inputmode="decimal" value="${v.far}"></div>
          <div class="field"><span>Tầng cao tối đa</span><input class="lu-fl num" inputmode="decimal" value="${v.floors}"></div>
          <div class="note">Chỉ tiêu mới áp cho ô đất tô sau này; ô đã có giữ chỉ tiêu riêng (sửa trong bảng thuộc tính ô).</div>
          <div class="lu-act"></div></div>`);
        const pal = ed.querySelector('.lu-pal');
        for (const c of LU_PAL) {
          const sw = h(`<button class="lu-swb ${c === v.color.toLowerCase() ? 'on' : ''}" style="background:${c}" aria-label="Màu ${c}"></button>`);
          sw.onclick = () => { setF(k, 'color', c); draw(); };
          pal.append(sw);
        }
        const hex = ed.querySelector('.lu-hex');
        hex.onchange = () => { let c = hex.value.trim(); if (!c.startsWith('#')) c = '#' + c; if (/^#[0-9a-f]{3}$/i.test(c)) c = '#' + [...c.slice(1)].map((x) => x + x).join(''); if (!isHex(c)) { toast('Mã màu dạng #RRGGBB, ví dụ #f6d36b'); hex.value = v.color; return; } setF(k, 'color', c.toLowerCase()); draw(); };
        ed.querySelector('.lu-pick').onchange = (e) => { setF(k, 'color', e.target.value); draw(); };
        ed.querySelector('.lu-name').onchange = (e) => { const t = e.target.value.trim(); if (!t) return; setF(k, 'name', t); draw(); };
        const numF = (sel, f, round) => { ed.querySelector(sel).onchange = (e) => { const x = parseFloat(e.target.value.replace(',', '.')); if (!Number.isFinite(x) || x < 0) return; setF(k, f, round ? Math.round(x) : x); draw(); }; };
        numF('.lu-md', 'mdxd'); numF('.lu-far', 'far'); numF('.lu-fl', 'floors', true);
        const act = ed.querySelector('.lu-act');
        if (mod) { const b = h('<button class="btn">↺ Về mặc định của mã này</button>'); b.onclick = () => { delete lu[k]; apply(); draw(); }; act.append(b); }
        if (v.custom) {
          const b = h('<button class="btn danger">✕ Xoá chức năng</button>');
          b.onclick = () => {
            if (S.doc.items.some((i) => i.kind === 'zone' && i.props.code === k)) { toast(`Còn ô đất dùng ${k} – đổi các ô đó sang chức năng khác trước khi xoá`); return; }
            delete lu[k]; open = null; apply(); draw();
          };
          act.append(b);
        }
        rows.append(ed);
      }
      const o = rows.querySelector('.lu-row.open'); if (o && typeof focus === 'string') { o.scrollIntoView({ block: 'nearest' }); focus = null; }
    };
    draw();
    pop.querySelector('#luReset').onclick = () => {
      for (const k of Object.keys(lu)) if (M.isDefaultLanduse(k) && lu[k]) { delete lu[k].color; if (!Object.keys(lu[k]).length) delete lu[k]; }
      apply(); draw(); toast('Đã đưa các mã có sẵn về màu chuẩn');
    };
    pop.querySelector('#luSaveDef').onclick = () => {
      try { localStorage.setItem(LU_KEY, JSON.stringify(cleanLanduse(lu))); pop.querySelector('#luApplyDef').hidden = false; toast('Đã lưu bộ màu, chức năng làm mặc định: bản vẽ mới sẽ dùng bộ này'); } catch { toast('Không lưu được trên thiết bị này'); }
    };
    pop.querySelector('#luApplyDef').onclick = () => {
      const d = savedLanduse(); if (!d) return;
      S.doc.settings.landuse = { ...cleanLanduse(d) }; Object.assign(lu, {}); closePop(); M.applyLanduse(S.doc); changed(); renderToolOpts(); renderProps(); openLanduseDialog(open); toast('Đã dùng bộ màu mặc định đã lưu');
    };
    pop.querySelector('#luExport').onclick = () => {
      const all = {};
      for (const [k, v] of Object.entries(M.LANDUSE)) all[k] = { name: v.name, color: v.color, cat: v.cat, mdxd: v.mdxd, far: v.far, floors: v.floors };
      X.download('BoMau-SDD.json', JSON.stringify({ app: 'QuickPlan', landuse: all }, null, 1), 'application/json');
    };
    pop.querySelector('#luImport').onclick = () => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
      inp.onchange = async () => {
        const f = inp.files && inp.files[0]; if (!f) return;
        try {
          const j = JSON.parse(await f.text());
          const src = cleanLanduse(j.landuse || j);
          if (!Object.keys(src).length) { toast('File không có bộ màu chức năng SDĐ hợp lệ'); return; }
              for (const [k, e] of Object.entries(src)) {
            const d = M.isDefaultLanduse(k) ? M.LANDUSE_DEFAULT_OF(k) : null;
            const x = { ...e }; if (d) for (const f2 of Object.keys(x)) if (d[f2] === x[f2]) delete x[f2];
            if (Object.keys(x).length) lu[k] = x; else delete lu[k];
          }
          apply(); draw(); toast(`Đã nhập ${Object.keys(src).length} chức năng`);
        } catch (err) { toast('Không đọc được file: ' + err.message); }
      };
      inp.click();
    };
    pop.querySelector('#luAdd').onclick = () => {
      const code = pop.querySelector('#luCode').value.trim().toUpperCase().replace(/[^A-Z0-9Đ]/g, '');
      const name = pop.querySelector('#luName').value.trim();
      if (!code || !name) { toast('Nhập ký hiệu và tên chức năng'); return; }
      if (M.LANDUSE[code] && !M.LANDUSE[code].custom) { toast(`Ký hiệu ${code} đã có sẵn`); return; }
      const num = (id) => parseFloat(pop.querySelector(id).value.replace(',', '.')) || 0;
      checkpoint();
      lu[code] = { name, color: pop.querySelector('#luColor').value, cat: pop.querySelector('#luCat').value, mdxd: num('#luMd'), far: num('#luFar'), floors: Math.round(num('#luFl')) };
      M.applyLanduse(S.doc); S.opts.zone.code = code; saveOpts(); changed(); renderToolOpts(); renderProps(); draw();
      toast(`Đã thêm chức năng ${code} – ${name}`);
      pop.querySelector('#luCode').value = ''; pop.querySelector('#luName').value = '';
    };
  });
}
function colorRow(it, edit) {
  const chips = h('<div class="chips"></div>');
  colorChips(chips, it.props.color, (c) => edit(() => (it.props.color = c)));
  $('#props').append(chips);
}
// Gõ nhanh ký hiệu: "ODT 15" → chức năng ODT, 15 tầng
function quickInput(it, edit) {
  const inp = h(`<input type="text" placeholder="Gõ nhanh: ODT 15, CX, 9…">`);
  inp.onchange = () => {
    const q = M.parseQuick(inp.value); inp.value = '';
    edit(() => {
      if (it.kind === 'zone') {
        if (q.code) { const lu = M.LANDUSE[q.code]; Object.assign(it.props, { code: q.code, maxMdxd: lu.mdxd, maxFar: lu.far, maxFloors: lu.floors }); }
        if (q.num != null) M.setIndicator(it.props, 'floors', q.num);
      } else {
        if (q.num != null) it.props.floors = Math.max(1, Math.round(q.num));
        if (q.code) {
          const z = S.doc.items.find((i) => i.kind === 'zone' && G.pointInPolygon(G.centroid(it.pts), i.pts));
          if (z) { const lu = M.LANDUSE[q.code]; Object.assign(z.props, { code: q.code, maxMdxd: lu.mdxd, maxFar: lu.far, maxFloors: lu.floors }); }
        }
      }
    });
  };
  const f = h('<div class="field"><span>Gõ nhanh</span></div>'); f.append(inp); $('#props').append(f);
}

// ---------------- Bảng chỉ tiêu (HUD) ----------------
let hudMin = false, hudBig = false;
// Vành khuyên: segs = [{v, color, title}]
function donutSVG(rings, size, center = '') {
  const c = size / 2;
  let out = `<svg class="donut" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img">`;
  for (const { segs, r, w } of rings) {
    const tot = segs.reduce((s, x) => s + x.v, 0), L = 2 * Math.PI * r;
    out += `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="#eef2f6" stroke-width="${w}"/>`;
    let acc = 0;
    if (tot > 0) for (const x of segs) {
      const len = (x.v / tot) * L; if (len <= 0) continue;
      const gap = segs.length > 1 ? Math.min(1.5, len / 3) : 0;
      out += `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${x.color}" stroke-width="${w}" stroke-dasharray="${Math.max(0.01, len - gap)} ${L}" stroke-dashoffset="${-acc}" transform="rotate(-90 ${c} ${c})"><title>${esc(x.title || '')}</title></circle>`;
      acc += len;
    }
  }
  return out + (center ? `<foreignObject x="0" y="0" width="${size}" height="${size}"><div class="donut-c">${center}</div></foreignObject>` : '') + '</svg>';
}
// Cơ cấu chi tiết theo ký hiệu đất (ô đất) + giao thông, cây xanh, mặt nước ngoài ô
function landuseByCode(m) {
  const by = new Map();
  for (const z of S.doc.items.filter((i) => i.kind === 'zone')) {
    const code = M.LANDUSE[z.props.code] ? z.props.code : 'ODT', lu = M.LANDUSE[code], g = lu.lbl + '|' + lu.name + '|' + lu.color; // mã theo XD: gộp các mã TN cùng ký hiệu
    const e = by.get(g) || { code: lu.lbl, name: lu.name, color: lu.color, cat: lu.cat, v: 0 }; e.v += M.itemArea(z); by.set(g, e);
  }
  const rows = [...by.values()];
  rows.sort((x, y) => y.v - x.v);
  if (m.cats.gt > 0) rows.push({ code: 'GT', name: 'Đất giao thông', color: M.CAT_COLORS.gt, cat: 'gt', v: m.cats.gt });
  const zoneCx = rows.filter((r) => r.cat === 'cx').reduce((s, r) => s + r.v, 0);
  if (m.cats.cx - zoneCx > 0.5) rows.push({ code: 'CX', name: 'Cây xanh (ngoài ô đất)', color: M.CAT_COLORS.cx, cat: 'cx', v: m.cats.cx - zoneCx });
  if (m.cats.mn > 0) rows.push({ code: 'MN', name: 'Mặt nước', color: M.CAT_COLORS.mn, cat: 'mn', v: m.cats.mn });
  return rows;
}
function renderHUD() {
  const m = S.metrics, hud = $('#hud');
  if (!m) return;
  const pct = (v) => (m.total ? (v / m.total) * 100 : 0);
  const cats = Object.entries(m.cats).filter(([, v]) => v > 0);
  const lotName = (z) => M.lotName(m, z);
  const overLots = m.lots.filter((l) => m.alerts[l.zone.id]);
  const overB = S.doc.items.filter((i) => i.kind === 'building' && m.alerts[i.id]);
  const catSegs = cats.map(([k, v]) => ({ v, color: M.CAT_COLORS[k], title: `${M.CAT_NAMES[k]}: ${G.fmtArea(v)} (${G.fmtNum(pct(v))}%)` }));
  const indic = `
      <div class="row"><span>Mật độ xây dựng</span><b>${G.fmtNum(m.mdxd)} %</b></div>
      <div class="row"><span>Hệ số sử dụng đất</span><b>${G.fmtNum(m.far, 2)}</b></div>
      <div class="row"><span>Tổng diện tích sàn</span><b>${G.fmtArea(m.gfa)}</b></div>
      <div class="row"><span>Dân số ước tính</span><b>${m.people >= 1 ? G.fmtNum(m.people, 0) + ' người' : '—'}</b></div>
      <div class="row"><span>Cây xanh / người</span><b>${m.greenPerCap != null ? G.fmtNum(m.greenPerCap) + ' m²' : '—'}</b></div>`;
  const alerts = `
      ${overLots.slice(0, hudBig ? 50 : 3).map((l) => `<div class="alert ${m.alerts[l.zone.id]}">${m.alerts[l.zone.id] === 'over' ? '⚠ Vượt' : '• Sắp chạm'} chỉ tiêu lô ${esc(lotName(l.zone))}: MĐXD ${G.fmtNum(l.mdxd)}%/${l.zone.props.maxMdxd}%, HSSDĐ ${G.fmtNum(l.far, 2)}/${l.zone.props.maxFar}</div>`).join('')}
      ${overLots.length > (hudBig ? 50 : 3) ? `<div class="alert warn">… và ${overLots.length - (hudBig ? 50 : 3)} lô khác vượt hoặc sắp chạm chỉ tiêu${hudBig ? ' (xem bảng chỉ tiêu từng lô)' : ' (bấm ⤢ để xem)'}</div>` : ''}
      ${overB.length ? `<div class="alert over">⚠ ${overB.length} công trình vượt tầng cao khống chế hoặc lấn chỉ giới</div>` : ''}`;
  const empty = '<span class="muted">Vẽ ô đất, đường, cây xanh để tính cơ cấu</span>';
  hud.className = 'hud' + (hudMin && !hudBig ? ' min' : '') + (hudBig ? ' big' : '');
  if (!hudBig) {
    hud.innerHTML = `
    <h3>Chỉ tiêu quy hoạch<button id="hudBig" class="hb-ic" title="Phóng to bảng chỉ tiêu" aria-label="Phóng to">⤢</button><button id="hudToggle" class="hb-ic" title="${hudMin ? 'Mở' : 'Thu gọn'}">${hudMin ? '▴' : '▾'}</button></h3>
    <div class="hud-body">
      <div class="row"><span>Tổng diện tích</span><span class="big">${m.total ? G.fmtArea(m.total) : '—'}</span></div>
      <div class="hud-pie">
        ${donutSVG([{ segs: catSegs, r: 30, w: 14 }], 78)}
        <div class="legend one">${cats.map(([k, v]) => `<span><i style="background:${M.CAT_COLORS[k]}"></i>${M.CAT_NAMES[k]} <b>${G.fmtNum(pct(v))}%</b></span>`).join('') || empty}</div>
      </div>
      ${indic}${alerts}
    </div>`;
    $('#hudToggle').onclick = () => { hudMin = !hudMin; renderHUD(); };
    $('#hudBig').onclick = () => { hudBig = true; renderHUD(); };
    return;
  }
  // Chế độ phóng to
  const codes = landuseByCode(m);
  const codeSegs = codes.map((r) => ({ v: r.v, color: r.color, title: `${r.code} – ${r.name}: ${G.fmtArea(r.v)} (${G.fmtNum(pct(r.v))}%)` }));
  // vành trong: nhóm (sắp theo thứ tự xuất hiện ở vành ngoài để hai vành khớp nhau)
  const catOrder = [...new Set(codes.map((r) => r.cat))];
  const innerSegs = catOrder.map((k) => ({ v: codes.filter((r) => r.cat === k).reduce((s, r) => s + r.v, 0), color: M.CAT_COLORS[k], title: M.CAT_NAMES[k] }));
  const lots = m.lots.slice().sort((x, y) => (x.zone.props.code || '').localeCompare(y.zone.props.code || '') || lotName(x.zone).localeCompare(lotName(y.zone), 'vi', { numeric: true }));
  hud.innerHTML = `
    <h3>Chỉ tiêu quy hoạch<span class="hb-exp"><button id="hudXlsx" title="Xuất bảng chỉ tiêu ra Excel">⬇ Excel</button><button id="hudPdf" title="Xuất bảng chỉ tiêu ra PDF">⬇ PDF</button></span><button id="hudClose" title="Thu nhỏ">✕ Đóng</button></h3>
    <div class="hud-big-body">
      <div class="hb-top">
        ${donutSVG([{ segs: codeSegs, r: 104, w: 34 }, { segs: innerSegs, r: 74, w: 16 }], 260, `<div><small>Tổng diện tích</small><b>${m.total ? G.fmtArea(m.total) : '—'}</b></div>`)}
        <div class="hb-side">
          <h4>Cơ cấu sử dụng đất</h4>
          <table class="hb-tab"><thead><tr><th></th><th>Ký hiệu</th><th>Loại đất</th><th class="n">Diện tích</th><th class="n">Tỷ lệ</th></tr></thead><tbody>
          ${codes.map((r) => `<tr><td><i style="background:${r.color}"></i></td><td><b>${esc(r.code)}</b></td><td>${esc(r.name)}</td><td class="n">${G.fmtArea(r.v)}</td><td class="n"><b>${G.fmtNum(pct(r.v))}%</b></td></tr>`).join('') || `<tr><td colspan="5">${empty}</td></tr>`}
          </tbody><tfoot><tr><td></td><td colspan="2">Tổng</td><td class="n">${G.fmtArea(m.total)}</td><td class="n">100%</td></tr></tfoot></table>
          <div class="legend">${cats.map(([k, v]) => `<span><i style="background:${M.CAT_COLORS[k]}"></i>${M.CAT_NAMES[k]} <b>${G.fmtNum(pct(v))}%</b></span>`).join('')}</div>
          <p class="muted small">Vành ngoài: từng loại đất · vành trong: nhóm đất</p>
        </div>
      </div>
      <div class="hb-grid">
        <div><h4>Chỉ tiêu chung</h4>${indic}</div>
        <div><h4>Chỉ tiêu từng lô</h4>
          <table class="hb-tab"><thead><tr><th>Loại đất</th><th>Lô</th><th class="n">Diện tích</th><th class="n">MĐXD</th><th class="n">HSSDĐ</th><th class="n">Tầng</th></tr></thead><tbody>
          ${lots.map((l) => `<tr class="${m.alerts[l.zone.id] || ''}"><td class="lt"><i style="background:${(M.LANDUSE[l.zone.props.code] || M.LANDUSE.ODT).color}"></i>${esc((M.LANDUSE[l.zone.props.code] || M.LANDUSE.ODT).name)}</td><td><b>${esc(lotName(l.zone))}</b></td><td class="n">${G.fmtArea(l.area)}</td><td class="n">${G.fmtNum(l.mdxd)}%${l.zone.props.maxMdxd ? ' / ' + l.zone.props.maxMdxd + '%' : ''}</td><td class="n">${G.fmtNum(l.far, 2)}${l.zone.props.maxFar ? ' / ' + l.zone.props.maxFar : ''}</td><td class="n">${l.maxFloors || '—'}${l.zone.props.maxFloors ? ' / ' + l.zone.props.maxFloors : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Chưa có ô đất</td></tr>'}
          </tbody></table>
        </div>
      </div>
      ${alerts}
    </div>`;
  $('#hudClose').onclick = () => { hudBig = false; renderHUD(); };
  $('#hudXlsx').onclick = () => exportIndicators('xlsx');
  $('#hudPdf').onclick = () => exportIndicators('pdf');
}
// Dữ liệu bảng chỉ tiêu dùng cho xuất Excel / PDF
function indicatorData() {
  const m = S.metrics; const pct = (v) => (m.total ? (v / m.total) * 100 : 0);
  const codes = landuseByCode(m).map((r) => ({ ...r, pct: pct(r.v) }));
  const lots = m.lots.slice().sort((x, y) => (x.zone.props.code || '').localeCompare(y.zone.props.code || '') || M.lotName(m, x.zone).localeCompare(M.lotName(m, y.zone), 'vi', { numeric: true }))
    .map((l) => { const lu = M.LANDUSE[l.zone.props.code] || M.LANDUSE.ODT; return { type: lu.name, color: lu.color, name: M.lotName(m, l.zone), area: l.area, mdxd: +(l.mdxd || 0).toFixed(2), maxMdxd: l.zone.props.maxMdxd, far: +(l.far || 0).toFixed(2), maxFar: l.zone.props.maxFar, floors: l.maxFloors, maxFloors: l.zone.props.maxFloors, alert: m.alerts[l.zone.id] || '' }; });
  const general = [['Tổng diện tích', +(m.total / 10000).toFixed(4), 'ha'], ['Mật độ xây dựng', +(m.mdxd || 0).toFixed(2), '%'], ['Hệ số sử dụng đất', +(m.far || 0).toFixed(2), 'lần'], ['Tổng diện tích sàn', Math.round(m.gfa || 0), 'm²'],
    ['Dân số ước tính', m.people >= 1 ? Math.round(m.people) : '—', 'người'], ['Cây xanh / người', m.greenPerCap != null ? +m.greenPerCap.toFixed(2) : '—', 'm²']];
  for (const [k, v] of Object.entries(m.cats)) if (v > 0) general.push(['Tỷ lệ ' + M.CAT_NAMES[k].toLowerCase(), +pct(v).toFixed(2), '%']);
  return { title: S.doc.name || 'QuickPlan', total: m.total || 0, codes, lots, general };
}
async function exportIndicators(fmt) {
  if (!S.metrics) return;
  try {
    const HX = await import('./hudexport.js');
    const d = indicatorData();
    const base = (S.doc.name || 'QuickPlan').replace(/[^\p{L}\p{N}_ -]+/gu, '').trim().replace(/\s+/g, '_') || 'QuickPlan';
    const name = base + '_ChiTieu.' + fmt;
    const blob = fmt === 'xlsx' ? HX.toXLSX(d) : await HX.toPDF(d);
    odQueueExport(name, blob);
    if (exportTarget === 'pc') {
      try { const r = await Store.sendExportToPC(name, blob); toast('Đã lưu về PC: ' + r.path); return; }
      catch { toast('Không kết nối được PC, đang lưu trên thiết bị…'); }
    }
    X.download(name, blob);
  } catch (err) { console.error(err); toast('Xuất bảng chỉ tiêu lỗi: ' + err.message); }
}

// ---------------- Lớp ----------------
function openPop(html, onBuild) {
  const pop = $('#pop'); pop.innerHTML = ''; pop.hidden = false;
  const el = h(html); pop.append(el);
  const x = h('<button class="ibtn" aria-label="Đóng"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>');
  x.onclick = closePop; pop.querySelector('h3').append(x);
  onBuild && onBuild(pop);
  if (PANEL.pop) PANEL.pop.min = false; // hộp thoại mới luôn mở đầy đủ
  panelChrome(pop, 'pop', pop.querySelector('h3').textContent, pop.querySelector('h3'));
}
function closePop() { $('#pop').hidden = true; }

$('#btnLayers').onclick = () => openLayers();
function openLayers() {
  const keepScroll = $('#pop').hidden ? 0 : $('#pop').scrollTop;
  setTimeout(() => { $('#pop').scrollTop = keepScroll; }, 0);
  openPop('<div><h3>Quản lý lớp</h3><div class="layer-head"><span>Hiện</span><span>Lớp (trên cùng che lớp dưới)</span><span>Khoá</span><span>Độ rõ</span></div><div id="layerRows"></div><button class="btn" id="lyAdd" style="width:100%;margin-top:8px">＋ Tạo lớp mới</button><h4>Nhãn ô đất hiển thị</h4><div id="zlRows" class="chips"></div><div class="note">Dùng <b>▲ ▼</b> để đổi thứ tự lớp: lớp ở trên che lớp ở dưới. Lớp bị khoá (🔒) vẫn hiển thị và chọn xem được, nhưng không thể xoá, sửa hay di chuyển đối tượng. Lớp tự tạo: bấm <b>✎</b> để đổi tên, <b>Vẽ vào</b> để các nét vẽ mới vào lớp đó; muốn đưa đối tượng có sẵn vào lớp, chọn đối tượng rồi chọn lớp trong bảng thuộc tính.</div></div>', (pop) => {
    M.upgradeDoc(S.doc);
    const box = pop.querySelector('#layerRows');
    const order = M.layerOrder(S.doc);
    const act = S.doc.settings.activeLayer;
    order.slice().reverse().forEach((id, k) => {
      const st = S.doc.layers.find((l) => l.id === id);
      const nm = M.layerName(S.doc, id);
      const n = S.doc.items.filter((i) => M.layerOf(i) === id).length;
      const custom = id >= 100;
      const row = h(`<div class="layer-row ${custom ? 'custom' : ''}"><input type="checkbox" ${st.visible ? 'checked' : ''} aria-label="Hiện lớp"><span class="lname">${esc(nm)} <small class="muted">(${n})</small></span><span class="lyord"><button class="ibtn up" aria-label="Lên trên" ${k === 0 ? 'disabled' : ''}>▲</button><button class="ibtn dn" aria-label="Xuống dưới" ${k === order.length - 1 ? 'disabled' : ''}>▼</button></span><button class="lockbtn ${st.locked ? 'on' : ''}" aria-label="Khoá lớp">${st.locked ? '🔒' : '🔓'}</button><input type="range" min="0" max="1" step="0.05" value="${st.opacity}">${custom ? `<span class="lycust"><button class="chip ${act === id ? 'on' : ''} lyact">${act === id ? '✓ Đang vẽ vào' : 'Vẽ vào'}</button><button class="chip lyren">✎ Đổi tên</button><button class="chip lydel">🗑 Xoá lớp</button></span>` : ''}</div>`);
      row.querySelector('input[type=checkbox]').onchange = (e) => { st.visible = e.target.checked; changed(); };
      row.querySelector('input[type=range]').oninput = (e) => { st.opacity = +e.target.value; changed({ light: true }); };
      const lk = row.querySelector('.lockbtn');
      lk.onclick = () => { st.locked = !st.locked; lk.classList.toggle('on', st.locked); lk.textContent = st.locked ? '🔒' : '🔓'; renderProps(); changed(); toast(st.locked ? `Đã khoá lớp ${nm}` : `Đã mở khoá lớp ${nm}`); };
      const move = (dir) => { const o = M.layerOrder(S.doc); const i = o.indexOf(id), j = i + dir; if (j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; S.doc.layerOrder = o; changed(); openLayers(); };
      row.querySelector('.up').onclick = () => move(1);
      row.querySelector('.dn').onclick = () => move(-1);
      if (custom) {
        row.querySelector('.lyact').onclick = () => { S.doc.settings.activeLayer = act === id ? null : id; changed(); openLayers(); toast(S.doc.settings.activeLayer ? `Nét vẽ mới sẽ vào lớp «${nm}»` : 'Nét vẽ mới vào lớp mặc định theo loại'); };
        row.querySelector('.lyren').onclick = () => { const v = prompt('Tên lớp', nm); if (v && v.trim()) { st.name = v.trim(); changed(); openLayers(); } };
        row.querySelector('.lydel').onclick = () => {
          if (!confirm(`Xoá lớp «${nm}»? Các đối tượng trong lớp được trả về lớp mặc định theo loại.`)) return;
          checkpoint();
          for (const it of S.doc.items) if (it.layer === id) it.layer = M.KIND_LAYER[it.kind] ?? 4;
          S.doc.layers = S.doc.layers.filter((l) => l.id !== id); S.doc.layerOrder = M.layerOrder(S.doc);
          if (S.doc.settings.activeLayer === id) S.doc.settings.activeLayer = null;
          changed(); openLayers();
        };
      }
      box.append(row);
      if (id === 0 && S.doc.items.some((i) => i.kind === 'cad')) { // nét DXF / CAD: chỉ để nhìn, hay tác động tới vẽ
        const view = !!st.cadView, sub = h(`<div class="layer-sub"><span>Nét DXF / CAD:</span><div class="seg"><button class="${view ? 'on' : ''}" data-cv="1">👁 Chỉ để nhìn</button><button class="${view ? '' : 'on'}" data-cv="0">✎ Tác động khi vẽ</button></div><small class="muted">${view ? 'Không bắt điểm, không chọn được, không làm ranh giới phủ màu SDĐ, cắt, tạo đường theo line' : 'Bắt điểm, làm ranh giới phủ màu SDĐ, giới hạn cắt, tạo đường theo line…'}</small></div>`);
        sub.querySelectorAll('[data-cv]').forEach((b) => (b.onclick = () => { st.cadView = b.dataset.cv === '1'; changed(); openLayers(); toast(st.cadView ? 'Nét DXF chỉ để nhìn: không tác động tới thao tác vẽ' : 'Nét DXF tác động tới vẽ: bắt điểm, phủ màu SDĐ, cắt…'); }));
        box.append(sub);
      }
    });
    pop.querySelector('#lyAdd').onclick = () => {
      const nm = prompt('Tên lớp mới', 'Lớp ' + (S.doc.layers.filter((l) => l.id >= 100).length + 1));
      if (!nm || !nm.trim()) return;
      const id = Math.max(99, ...S.doc.layers.map((l) => l.id)) + 1;
      S.doc.layers.push({ id, name: nm.trim(), visible: true, opacity: 1 });
      const o = M.layerOrder(S.doc); S.doc.layerOrder = o; // lớp mới nằm trên cùng
      S.doc.settings.activeLayer = id;
      changed(); openLayers(); toast(`Đã tạo lớp «${nm.trim()}» – nét vẽ mới sẽ vào lớp này`);
    };
    const zl = S.doc.settings.zoneLabel;
    const zb = pop.querySelector('#zlRows');
    for (const [k, nme] of [['code', 'Số hiệu lô'], ['area', 'Diện tích'], ['mdxd', 'Mật độ XD'], ['far', 'Hệ số SDĐ'], ['floors', 'Tầng cao']]) {
      const c = h(`<button class="chip ${zl[k] !== false ? 'on' : ''}">${zl[k] !== false ? '✓ ' : ''}${nme}</button>`);
      c.onclick = () => { zl[k] = zl[k] === false; c.classList.toggle('on', zl[k]); c.textContent = (zl[k] ? '✓ ' : '') + nme; changed(); };
      zb.append(c);
    }
  });
}

// ---------------- Nền bản đồ / CAD ----------------
$('#btnImport').onclick = () => {
  const s = S.doc.settings, b = S.doc.base;
  openPop(`<div><h3>Nền bản đồ</h3>
  <h4>Ảnh vệ tinh / bản đồ theo toạ độ</h4>
  <div class="seg" id="bmSrc" style="width:100%"><button data-s="sat" class="on" style="flex:1">Vệ tinh</button><button data-s="osm" style="flex:1">Bản đồ OSM</button></div>
  <div id="bmProvBox" class="bm-prov">
    <div class="field"><span>Tỉnh / thành phố</span></div>
    <div class="seg" id="bmEra" style="width:100%"><button data-e="new" class="${(s.vn2000 || {}).era !== 'old' ? 'on' : ''}" style="flex:1">Sau sáp nhập (34)</button><button data-e="old" class="${(s.vn2000 || {}).era === 'old' ? 'on' : ''}" style="flex:1">Trước sáp nhập (63)</button></div>
    <select id="bmProv" style="width:100%;margin-top:6px"></select>
    <div class="field"><span>Kinh tuyến trục VN-2000</span><input id="bmKtt" style="width:110px" value="${s.vn2000 ? VN.fmtKTT(s.vn2000.lon0) : ''}" placeholder="VD: 105°45'"></div>
    <div class="field"><span>Tâm: X (Bắc) VN-2000</span><input class="num" style="width:130px" id="bmVX" inputmode="decimal"></div>
    <div class="field"><span>Tâm: Y (Đông) VN-2000</span><input class="num" style="width:130px" id="bmVY" inputmode="decimal"></div>
    <label class="chk" style="font-weight:400;font-size:13.5px"><input type="checkbox" id="bmGrid" ${s.vn2000 ? 'checked' : ''}> Nắn ảnh theo lưới VN-2000 của kinh tuyến trục (bản vẽ và file DXF xuất ra dùng toạ độ VN-2000)</label>
    <div class="note" id="bmProvNote" style="margin-top:4px">${s.vn2000 ? `Bản vẽ đang đặt theo VN-2000, KTT ${VN.fmtKTT(s.vn2000.lon0)}${s.vn2000.prov ? ' (' + esc(s.vn2000.prov) + ')' : ''}` : 'Chọn tỉnh để lấy tâm và kinh tuyến trục. Kinh tuyến trục sau sáp nhập lấy theo số liệu tham khảo đang công bố, hãy kiểm tra lại với văn bản chính thức; có thể sửa trực tiếp ô kinh tuyến trục.'}</div>
  </div>
  <div class="field"><span>Vĩ độ tâm</span><input class="num" style="width:130px" id="bmLat" inputmode="decimal" value="${s.lat}"></div>
  <div class="field"><span>Kinh độ tâm</span><input class="num" style="width:130px" id="bmLon" inputmode="decimal" value="${s.lon}"></div>
  <div class="chips"><button class="chip" id="bmGps">📍 GPS hiện tại</button>${s.georef ? '<button class="chip" id="bmCenter">Tâm màn hình</button>' : ''}</div>
  <div class="field"><span>Phạm vi quanh tâm</span></div>
  <div class="seg" id="bmSize" style="width:100%">${[500, 1000, 2000, 4000, 8000, 16000].map((m) => `<button data-m="${m}" class="${m === 1000 ? 'on' : ''}" style="flex:1">${m >= 1000 ? m / 1000 + ' km' : m + ' m'}</button>`).join('')}</div>
  <button class="btn primary" id="bmGo" style="width:100%;margin-top:10px">Tải ảnh nền quanh tâm</button>
  ${s.georef || s.vn2000 ? `<div class="field" style="margin-top:10px"><span>Hoặc tải theo vùng bạn chọn (bản vẽ đã có vị trí)</span></div>
  <div class="field"><span>Mở rộng thêm mỗi phía</span></div>
  <div class="seg" id="bmPad" style="width:100%">${[0, 200, 500, 1000, 2000].map((m) => `<button data-m="${m}" class="${m === 200 ? 'on' : ''}" style="flex:1">${m >= 1000 ? m / 1000 + ' km' : m + ' m'}</button>`).join('')}</div>
  <div class="grid2" style="margin-top:6px"><button class="btn" id="bmArea">▢ Bao khu vẽ</button><button class="btn" id="bmDrag">✎ Khoanh vùng trên bản vẽ</button></div>${S.doc.terrain ? '<button class="btn" id="bmTerr" style="width:100%;margin-top:6px">⛰ Trùng vùng địa hình đã tải</button>' : ''}
  ${S.doc.base ? '<button class="btn" id="bmExpand" style="width:100%;margin-top:6px">⤢ Mở rộng ảnh nền hiện có</button>' : ''}
  <div class="muted" style="font-size:12px;margin-top:4px">Bao khu vẽ: lấy ảnh phủ hết các đối tượng đã vẽ và nét CAD. Khoanh vùng: kéo một khung chữ nhật trên mặt bằng 2D. Mở rộng: tải lại ảnh lớn hơn ảnh đang có. Vùng càng rộng thì ảnh càng kém nét (tối đa khoảng 30 km).</div>` : ''}
  <div class="note">Ảnh vệ tinh Esri World Imagery hoặc bản đồ OpenStreetMap, tải qua máy tính đang chạy QuickPlan và được lưu lại để dùng khi mất mạng. Google Earth không cho phép tải ảnh tự động; nếu muốn dùng ảnh Google Earth, hãy chụp màn hình rồi chèn ở mục dưới.</div>
  <h4>Ảnh có sẵn (ảnh chụp Google Earth, bản đồ…)</h4>
  <div class="field"><span>Chiều ngang ảnh (m)</span><input class="num" id="baseW" inputmode="decimal" value="${b ? Math.round(b.w) : 500}"></div>
  <label class="chk" style="font-weight:400;font-size:14px"><input type="checkbox" id="baseGeo"> Đặt tâm ảnh tại toạ độ ở trên</label>
  <div class="grid2" style="margin-top:8px"><button class="btn" id="pickBase">Chọn ảnh</button><button class="btn danger" id="rmBase" ${b ? '' : 'disabled'}>Bỏ ảnh nền</button></div>
  ${b ? '<button class="btn" id="editBase" style="width:100%;margin-top:8px">⤡ Co kéo, di chuyển ảnh nền</button>' : ''}
  ${b ? `<h4>Điều chỉnh ảnh nền</h4>
  <div class="field"><span>Độ rõ</span><b id="vOp">${Math.round((b.opacity ?? 1) * 100)}%</b></div><input type="range" id="baseOp" min="0.1" max="1" step="0.05" value="${b.opacity ?? 1}">
  <div class="field"><span>Làm nhạt (mờ trắng)</span><b id="vFade">${b.fade || 0}%</b></div><input type="range" id="baseFade" min="0" max="85" step="5" value="${b.fade || 0}">
  <div class="field"><span>Độ sáng</span><b id="vBr">${b.brightness || 0}</b></div><input type="range" id="baseBr" min="-60" max="60" step="5" value="${b.brightness || 0}">
  <div class="field"><span>Đen trắng</span><input type="checkbox" id="baseGray" ${b.gray ? 'checked' : ''} style="width:22px;height:22px"></div>` : ''}
  <h4>Ranh giới CAD / GIS</h4>
  <div class="note">Nhập file DXF (AutoCAD) hoặc GeoJSON từ Files/iCloud Drive. Nét được đưa vào lớp <b>Nền CAD</b>; ảnh nền nằm ở lớp riêng <b>Ảnh nền</b> (bật/tắt, khoá, độ rõ độc lập trong Quản lý lớp).</div>
  <div class="grid2"><button class="btn" id="pickCad">Nhập DXF / GeoJSON</button><button class="btn danger" id="rmCad">Xoá nét CAD</button></div>
  <h4>Công trình hiện trạng</h4>
  <div class="note">Tự dựng khối nhà hiện trạng từ dữ liệu nhà của <b>OpenStreetMap</b> trong khu vẽ (hoặc khung đang nhìn nếu chưa vẽ gì). Bản vẽ cần đặt vị trí trước; máy tính chạy QuickPlan cần có Internet. Số tầng lấy theo dữ liệu nếu có, nếu không lấy số tầng mặc định bên dưới; sửa từng nhà sau được. Nhà được đưa vào lớp <b>Công trình hiện trạng</b>.</div>
  <div class="field"><span>Số tầng mặc định</span><input class="num" id="osmFl" inputmode="numeric" value="${S.opts.osmFloors || 2}" style="width:70px"></div>
  <div class="grid2"><button class="btn primary" id="osmGo">Tải nhà hiện trạng</button><button class="btn danger" id="osmDel">Xoá nhà hiện trạng</button></div>
  <div class="muted" style="font-size:12px;margin-top:4px">Dữ liệu © OpenStreetMap contributors (giấy phép ODbL): được dùng thương mại, cần ghi nguồn. Ở Việt Nam dữ liệu nhà chưa phủ kín, nhiều khu chỉ có một phần nhà.</div>
  <h4>Tỷ lệ xem</h4>
  <div class="chips">${[500, 1000, 2000, 5000].map((r) => `<button class="chip" data-r="${r}">1:${r}</button>`).join('')}<button class="chip" id="fitAll">Toàn bộ</button></div>
  </div>`, (pop) => {
    let src = 'sat', size = 1000;
    const segSel = (id, attr, set) => pop.querySelectorAll(`#${id} button`).forEach((x) => (x.onclick = () => { pop.querySelectorAll(`#${id} button`).forEach((y) => y.classList.toggle('on', y === x)); set(x.dataset[attr]); }));
    segSel('bmSrc', 's', (v) => (src = v)); segSel('bmSize', 'm', (v) => (size = +v));
    const latI = pop.querySelector('#bmLat'), lonI = pop.querySelector('#bmLon');
    pop.querySelector('#bmGps').onclick = () => getGPS((la, lo) => { latI.value = la; lonI.value = lo; });
    const ctr = pop.querySelector('#bmCenter');
    if (ctr) ctr.onclick = () => { const ll = X.toLonLat([S.view.cx, S.view.cy], s.lat, s.lon, s.vn2000); latI.value = ll[1]; lonI.value = ll[0]; syncVN(); };
    // ---- tỉnh thành + VN-2000 ----
    let era = (s.vn2000 || {}).era === 'old' ? 'old' : 'new', prov = (s.vn2000 || {}).prov || '';
    const provSel = pop.querySelector('#bmProv'), kttI = pop.querySelector('#bmKtt'), vxI = pop.querySelector('#bmVX'), vyI = pop.querySelector('#bmVY'), gridC = pop.querySelector('#bmGrid');
    const list = () => (era === 'old' ? VN.PROV_OLD : VN.PROV_NEW);
    const fillProv = () => { provSel.innerHTML = '<option value="">— Chọn tỉnh / thành phố —</option>' + list().map((p, i) => `<option value="${i}" ${p[0] === prov ? 'selected' : ''}>${esc(p[0])} · KTT ${VN.fmtKTT(p[1])}${p[4] ? ' · gồm ' + esc(p[4]) : ''}</option>`).join(''); };
    const syncVN = () => { const k = VN.parseKTT(kttI.value), la = parseFloat(latI.value), lo = parseFloat(lonI.value); if (!isFinite(k) || !isFinite(la) || !isFinite(lo)) { vxI.value = vyI.value = ''; return; } const r = VN.llToVN(la, lo, k); vxI.value = r[0].toFixed(1); vyI.value = r[1].toFixed(1); };
    const fromVN = () => { const k = VN.parseKTT(kttI.value), x = parseFloat(vxI.value), y = parseFloat(vyI.value); if (!isFinite(k) || !isFinite(x) || !isFinite(y)) return; const ll = VN.vnToLL(x, y, k); latI.value = ll[0].toFixed(6); lonI.value = ll[1].toFixed(6); };
    fillProv(); syncVN();
    pop.querySelectorAll('#bmEra button').forEach((x) => (x.onclick = () => { era = x.dataset.e; pop.querySelectorAll('#bmEra button').forEach((y) => y.classList.toggle('on', y === x)); fillProv(); }));
    provSel.onchange = () => { const p = list()[+provSel.value]; if (!p) return; prov = p[0]; kttI.value = VN.fmtKTT(p[1]); latI.value = p[2]; lonI.value = p[3]; gridC.checked = true; syncVN(); pop.querySelector('#bmProvNote').textContent = `${p[0]}: kinh tuyến trục ${VN.fmtKTT(p[1])}, tâm ảnh đặt tại trung tâm hành chính – sửa toạ độ tâm (kinh/vĩ độ hoặc X, Y VN-2000) nếu cần.`; };
    latI.addEventListener('change', syncVN); lonI.addEventListener('change', syncVN); kttI.addEventListener('change', syncVN);
    vxI.onchange = fromVN; vyI.onchange = fromVN;
    pop.querySelectorAll('#bmSrc button').forEach((x) => x.addEventListener('click', () => (pop.querySelector('#bmProvBox').hidden = x.dataset.s !== 'sat')));
    pop.querySelector('#bmGo').onclick = async () => {
      const la = parseFloat(latI.value), lo = parseFloat(lonI.value);
      if (!isFinite(la) || !isFinite(lo)) return toast('Toạ độ chưa đúng');
      const btn = pop.querySelector('#bmGo'); btn.disabled = true; btn.textContent = 'Đang tải ảnh…';
      try {
        const k = VN.parseKTT(kttI.value);
        if (gridC.checked && src === 'sat' && isFinite(k) && k > 100 && k < 112) {
          const keep = JSON.stringify({ vn2000: s.vn2000, lat: s.lat, lon: s.lon, georef: s.georef });
          setVN2000(k, prov, era, [la, lo]);
          btn.onRestore = () => { const o = JSON.parse(keep); if (o.vn2000 === undefined) delete s.vn2000; Object.assign(s, o.vn2000 === undefined ? { lat: o.lat, lon: o.lon, georef: o.georef } : o); };
          const c = X.fromLonLat([lo, la], s.lat, s.lon, s.vn2000), hs = size / 2;
          const img = await BM.downloadGridBasemap(src, [c[0] - hs, c[1] - hs, c[0] + hs, c[1] + hs], (p) => { const ll = X.toLonLat(p, s.lat, s.lon, s.vn2000); return [ll[1], ll[0]]; }, (a, n) => (btn.textContent = `Đang tải ảnh… ${a}/${n}`));
          const old = S.doc.base || {};
          S.doc.base = { image: img.dataURL, x: img.x, y: img.y, w: img.wM, h: img.hM, opacity: old.opacity ?? 1, fade: old.fade || 0, brightness: old.brightness || 0, gray: !!old.gray, src, lat: la, lon: lo, grid: 'vn2000' };
          await loadBaseImage(); changed(); closePop(); fitBase();
          toast(`Đã thêm ảnh vệ tinh ${prov || ''} ${size >= 1000 ? size / 1000 + ' km' : size + ' m'} · lưới VN-2000, KTT ${VN.fmtKTT(k)}`);
          return;
        }
        const img = await BM.downloadBasemap(src, la, lo, size, (k, n) => (btn.textContent = `Đang tải ảnh… ${k}/${n}`));
        placeGeoImage(img.dataURL, la, lo, img.wM, img.hM, src);
        closePop(); toast(`Đã thêm ảnh ${src === 'sat' ? 'vệ tinh' : 'bản đồ OSM'} ${size >= 1000 ? size / 1000 + ' km' : size + ' m'}`);
      } catch (err) { console.error(err); if (btn.onRestore) { btn.onRestore(); btn.onRestore = null; } toast('Không tải được ảnh: ' + err.message); btn.disabled = false; btn.textContent = 'Tải ảnh nền'; }
    };
    let pad = 200;
    if (pop.querySelector('#bmPad')) {
      segSel('bmPad', 'm', (v) => (pad = +v));
      const padBox = (b) => [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad];
      pop.querySelector('#bmArea').onclick = () => { const b = TR.drawnBBox(S.doc, true); if (!b) return toast('Chưa có đối tượng nào: vẽ hoặc nhập DXF trước, hoặc dùng Khoanh vùng'); downloadBaseBox(src, padBox(b), pop.querySelector('#bmArea')); };
      pop.querySelector('#bmDrag').onclick = () => { const sv = src; closePop(); pickBaseRect((b) => downloadBaseBox(sv, padBox(b), null)); };
      const bt = pop.querySelector('#bmTerr'); if (bt) bt.onclick = () => downloadBaseBox(src, terrainBox(S.doc.terrain), bt);
      const ex = pop.querySelector('#bmExpand'); if (ex) ex.onclick = () => { const b = S.doc.base, m = Math.max(pad, 200); downloadBaseBox(b.src === 'osm' ? 'osm' : 'sat', [b.x - m, b.y - m, b.x + b.w + m, b.y + b.h + m], ex); };
    }
    pop.querySelector('#pickBase').onclick = () => { baseGeoPending = pop.querySelector('#baseGeo').checked ? [parseFloat(latI.value), parseFloat(lonI.value)] : null; $('#fileBase').click(); };
    { const eb = pop.querySelector('#editBase'); if (eb) eb.onclick = () => { closePop(); startBaseEdit(false); }; }
    pop.querySelector('#rmBase').onclick = () => { S.baseEdit = null; $('#hud').style.display = ''; S.doc.base = null; S.images.base = S.images.baseProc = null; changed(); closePop(); };
    pop.querySelector('#baseW').onchange = (e) => {
      if (!S.doc.base) return; const w = parseFloat(e.target.value) || 500; const bb = S.doc.base;
      const cx = bb.x + bb.w / 2, cy = bb.y + bb.h / 2, k = w / bb.w;
      bb.w = w; bb.h *= k; bb.x = cx - bb.w / 2; bb.y = cy - bb.h / 2; changed();
    };
    const adj = (id, key, out, fmt) => { const r = pop.querySelector(id); if (!r) return; r.oninput = () => { S.doc.base[key] = +r.value; pop.querySelector(out).textContent = fmt(+r.value); processBase(); changed({ light: true }); }; };
    adj('#baseOp', 'opacity', '#vOp', (v) => Math.round(v * 100) + '%');
    adj('#baseFade', 'fade', '#vFade', (v) => v + '%');
    adj('#baseBr', 'brightness', '#vBr', (v) => String(v));
    const gray = pop.querySelector('#baseGray'); if (gray) gray.onchange = () => { S.doc.base.gray = gray.checked; processBase(); changed({ light: true }); };
    pop.querySelector('#pickCad').onclick = () => $('#fileCad').click();
    pop.querySelector('#osmGo').onclick = () => { const f = Math.max(1, Math.min(60, Math.round(+pop.querySelector('#osmFl').value || 2))); S.opts.osmFloors = f; loadOSMBuildings(f, pop.querySelector('#osmGo')); };
    pop.querySelector('#osmDel').onclick = () => { const n = S.doc.items.filter((i) => i.props && i.props.osmId).length; if (!n) return toast('Chưa có nhà hiện trạng tải từ OpenStreetMap'); checkpoint(); const ids = new Set(S.doc.items.filter((i) => i.props && i.props.osmId).map((i) => i.id)); S.doc.items = S.doc.items.filter((i) => !ids.has(i.id) && !(i.kind === 'facet' && ids.has(i.props.parent))); changed(); toast(`Đã xoá ${n} nhà hiện trạng`); };
    pop.querySelector('#rmCad').onclick = () => { checkpoint(); S.doc.items = S.doc.items.filter((i) => i.kind !== 'cad'); changed(); };
    pop.querySelectorAll('[data-r]').forEach((x) => (x.onclick = () => { S.view.setRatio(+x.dataset.r); requestRender(); }));
    pop.querySelector('#fitAll').onclick = fitView;
  });
};
// Nhà hiện trạng từ OpenStreetMap (qua máy tính chạy QuickPlan)
async function loadOSMBuildings(floorsDef, btn) {
  const s = S.doc.settings;
  if (!(s.georef || s.vn2000)) return toast('Bản vẽ chưa đặt vị trí: tải ảnh nền theo toạ độ hoặc nhập DXF VN-2000 trước', 5000);
  let bb = TR.drawnBBox(S.doc, true);
  const vw = S.view.worldBox();
  if (!bb || Math.max(bb[2] - bb[0], bb[3] - bb[1]) > 15000) bb = vw;
  if (Math.max(bb[2] - bb[0], bb[3] - bb[1]) > 15000) return toast('Khu vực quá rộng (trên 15 km): phóng to vào khu cần lấy nhà rồi thử lại', 5000);
  const m = 30, cs = [[bb[0] - m, bb[1] - m], [bb[2] + m, bb[1] - m], [bb[0] - m, bb[3] + m], [bb[2] + m, bb[3] + m]].map((p) => X.toLonLat(p, s.lat, s.lon, s.vn2000));
  const W = Math.min(...cs.map((c) => c[0])), E = Math.max(...cs.map((c) => c[0])), So = Math.min(...cs.map((c) => c[1])), N = Math.max(...cs.map((c) => c[1]));
  const old = btn.textContent; btn.disabled = true; btn.textContent = 'Đang tải dữ liệu nhà…';
  try {
    const r = await PC.fetchOSMBuildings(So, W, N, E);
    if (!r.ok) throw new Error((await r.text()).trim() || 'lỗi ' + r.status);
    const js = await r.json();
    const have = new Set(S.doc.items.filter((i) => i.props && i.props.osmId).map((i) => i.props.osmId));
    const add = [];
    const lv = (t) => { const v = parseFloat(t['building:levels']); if (v > 0) return Math.round(v); const h = parseFloat(t.height); return h > 0 ? Math.max(1, Math.round(h / 3.3)) : floorsDef; };
    for (const el of js.elements || []) {
      const t = el.tags || {}; if (!t.building || t.building === 'no') continue;
      const rings = el.type === 'way' ? [el.geometry] : el.type === 'relation' ? (el.members || []).filter((mb) => mb.role === 'outer' && mb.geometry).map((mb) => mb.geometry) : [];
      rings.forEach((g, k) => {
        if (!g || g.length < 4) return;
        const id = el.type[0] + el.id + (k ? '_' + k : ''); if (have.has(id)) return;
        let pts = g.map((q) => X.fromLonLat([q.lon, q.lat], s.lat, s.lon, s.vn2000));
        if (G.dist(pts[0], pts[pts.length - 1]) < 0.01) pts = pts.slice(0, -1);
        if (pts.length < 3 || Math.abs(G.area(pts)) < 6) return;
        const props = { floors: lv(t), floorH: 3.3, existing: true, osmId: id, color: '#d6d0c4' };
        if (t.name) props.name = t.name;
        add.push({ id: M.uid(), kind: 'building', layer: M.EXIST_LAYER, pts, props });
      });
    }
    if (!add.length) { toast(have.size ? 'Không có nhà mới: các nhà trong khu này đã được tải' : 'OpenStreetMap chưa có dữ liệu nhà ở khu này', 5000); return; }
    checkpoint(); S.doc.items.push(...add); changed();
    if (!S.doc.credits) S.doc.credits = {}; S.doc.credits.osm = '© OpenStreetMap contributors (ODbL)';
    toast(`Đã dựng ${add.length} nhà hiện trạng từ OpenStreetMap`, 4000);
  } catch (err) { console.error(err); toast('Không tải được dữ liệu nhà: ' + err.message, 6000); }
  finally { btn.disabled = false; btn.textContent = old; }
}
let baseGeoPending = null;

// Đặt ảnh có toạ độ: nếu bản vẽ chưa định vị, lấy tâm màn hình hiện tại làm vị trí của toạ độ này
// Đặt bản vẽ theo VN-2000 (kinh tuyến trục lon0): giữ nguyên vị trí các nét đã có
function setVN2000(lon0, prov, era, centerLL) {
  const s = S.doc.settings, old = s.vn2000;
  let e0, n0;
  if (old && old.e0 != null) { const o = VN.vnToLL(old.n0, old.e0, old.lon0); const r = VN.llToVN(o[0], o[1], lon0); n0 = r[0]; e0 = r[1]; if (Math.abs(old.lon0 - lon0) < 1e-9) { n0 = old.n0; e0 = old.e0; } }
  else if (s.cadOffset) { e0 = s.cadOffset[0]; n0 = -s.cadOffset[1]; } // nét CAD nhập từ DXF VN-2000: giữ đúng toạ độ gốc
  else if (s.georef) { const r = VN.llToVN(s.lat, s.lon, lon0); n0 = r[0]; e0 = r[1]; }
  else { const r = VN.llToVN(centerLL[0], centerLL[1], lon0); e0 = Math.round(r[1] - S.view.cx); n0 = Math.round(r[0] + S.view.cy); }
  s.vn2000 = { lon0, e0, n0, prov: prov || '', era: era || 'new' };
  const o = VN.vnToLL(n0, e0, lon0); s.lat = +o[0].toFixed(6); s.lon = +o[1].toFixed(6); s.georef = true;
}
// Tải ảnh nền phủ đúng một khung (toạ độ bản vẽ) – bản vẽ đã có vị trí (toạ độ địa lý hoặc VN-2000)
async function downloadBaseBox(src, box, btn) {
  const s = S.doc.settings;
  const side = Math.max(box[2] - box[0], box[3] - box[1]);
  if (side > 30000) return toast('Vùng quá rộng (trên 30 km): khoanh vùng nhỏ hơn', 5000);
  const old0 = btn && btn.textContent; if (btn) btn.disabled = true;
  const prog = (a, n) => { const t = `Đang tải ảnh… ${a}/${n}`; if (btn) btn.textContent = t; else toast(t, 60000); };
  try {
    prog(0, '?');
    const img = await BM.downloadGridBasemap(src, box, (p) => { const ll = X.toLonLat(p, s.lat, s.lon, s.vn2000); return [ll[1], ll[0]]; }, prog);
    const old = S.doc.base || {}, c = X.toLonLat([(box[0] + box[2]) / 2, (box[1] + box[3]) / 2], s.lat, s.lon, s.vn2000);
    checkpoint();
    S.doc.base = { image: img.dataURL, x: img.x, y: img.y, w: img.wM, h: img.hM, opacity: old.opacity ?? 1, fade: old.fade || 0, brightness: old.brightness || 0, gray: !!old.gray, src, lat: c[1], lon: c[0], grid: s.vn2000 ? 'vn2000' : 'local' };
    await loadBaseImage(); changed(); closePop();
    toast(`Đã tải ảnh ${src === 'osm' ? 'bản đồ OSM' : 'vệ tinh'} ${G.fmtNum((box[2] - box[0]) / 1000, 1)} × ${G.fmtNum((box[3] - box[1]) / 1000, 1)} km`, 4000);
  } catch (err) { console.error(err); toast('Không tải được ảnh: ' + err.message, 5000); }
  finally { if (btn) { btn.disabled = false; btn.textContent = old0; } }
}
// Khoanh một khung chữ nhật trên mặt bằng 2D (bút, ngón tay hoặc chuột)
async function pickBaseRect(done) {
  if (S.mode !== '2d') await setMode('2d');
  const stage = $('#stage'), r0 = stage.getBoundingClientRect();
  const ov = h('<div style="position:absolute;inset:0;z-index:40;touch-action:none;cursor:crosshair;background:rgba(22,50,92,.06)"><div class="pick-tip" style="position:absolute;left:50%;top:10px;transform:translateX(-50%);background:#16325c;color:#fff;border-radius:10px;padding:8px 14px;font-size:14px;display:flex;gap:10px;align-items:center">Kéo một khung để chọn vùng tải ảnh nền<button class="btn" style="min-height:30px;padding:2px 10px">Huỷ</button></div><div class="pick-box" style="position:absolute;border:2px dashed #f97316;background:rgba(249,115,22,.12);display:none"></div></div>');
  stage.append(ov);
  const box = ov.querySelector('.pick-box'); let a = null;
  ov.querySelector('button').onclick = (e) => { e.stopPropagation(); ov.remove(); };
  ov.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; a = [e.clientX - r0.left, e.clientY - r0.top]; try { ov.setPointerCapture(e.pointerId); } catch {} });
  ov.addEventListener('pointermove', (e) => {
    if (!a) return; const b = [e.clientX - r0.left, e.clientY - r0.top];
    Object.assign(box.style, { display: 'block', left: Math.min(a[0], b[0]) + 'px', top: Math.min(a[1], b[1]) + 'px', width: Math.abs(b[0] - a[0]) + 'px', height: Math.abs(b[1] - a[1]) + 'px' });
  });
  ov.addEventListener('pointerup', (e) => {
    if (!a) return; const b = [e.clientX - r0.left, e.clientY - r0.top];
    if (Math.abs(b[0] - a[0]) < 12 || Math.abs(b[1] - a[1]) < 12) { a = null; box.style.display = 'none'; return; }
    const p = S.view.toWorld(a[0], a[1]), q = S.view.toWorld(b[0], b[1]); ov.remove();
    done([Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[0], q[0]), Math.max(p[1], q[1])]);
  });
}
function placeGeoImage(dataURL, lat, lon, wM, hM, src) {
  const s = S.doc.settings;
  if (!s.georef) {
    const o = X.toLonLat([-S.view.cx, -S.view.cy], lat, lon);
    s.lon = o[0]; s.lat = o[1]; s.georef = true;
  }
  const c = X.fromLonLat([lon, lat], s.lat, s.lon, s.vn2000);
  const old = S.doc.base || {};
  S.doc.base = { image: dataURL, x: c[0] - wM / 2, y: c[1] - hM / 2, w: wM, h: hM, opacity: old.opacity ?? 1, fade: old.fade || 0, brightness: old.brightness || 0, gray: !!old.gray, src: src || 'image', lat, lon };
  loadBaseImage().then(() => changed());
}

function getGPS(cb) {
  if (!navigator.geolocation) return toast('Thiết bị không hỗ trợ GPS');
  if (!window.isSecureContext) return toast('Cần mở QuickPlan qua địa chỉ https để dùng GPS');
  navigator.geolocation.getCurrentPosition((p) => cb(+p.coords.latitude.toFixed(6), +p.coords.longitude.toFixed(6)),
    (err) => toast('Không lấy được vị trí: ' + err.message), { enableHighAccuracy: true, timeout: 15000 });
}

// Xử lý ảnh nền: làm nhạt, độ sáng, đen trắng
function processBase() {
  const b = S.doc && S.doc.base, img = S.images.base;
  S.images.baseProc = null;
  if (!b || !img || (!b.fade && !b.brightness && !b.gray)) { S.images.baseVer = (S.images.baseVer || 0) + 1; return; }
  const c = document.createElement('canvas'); c.width = img.naturalWidth || img.width; c.height = img.naturalHeight || img.height;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height), a = d.data;
  const br = (b.brightness || 0) * 2.55, f = (b.fade || 0) / 100, g = !!b.gray;
  for (let i = 0; i < a.length; i += 4) {
    let r = a[i], gg = a[i + 1], bb = a[i + 2];
    if (g) { const l = 0.3 * r + 0.59 * gg + 0.11 * bb; r = gg = bb = l; }
    r += br; gg += br; bb += br;
    a[i] = r + (255 - r) * f; a[i + 1] = gg + (255 - gg) * f; a[i + 2] = bb + (255 - bb) * f;
  }
  x.putImageData(d, 0, 0);
  S.images.baseProc = c; S.images.baseVer = (S.images.baseVer || 0) + 1;
}

$('#fileBase').onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  const img = await loadImage(URL.createObjectURL(f));
  const max = 4096; const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const data = c.toDataURL('image/jpeg', 0.85);
  const w = parseFloat(($('#baseW') || {}).value) || 500;
  const hgt = w * (c.height / c.width);
  if (baseGeoPending && baseGeoPending.every(isFinite)) { placeGeoImage(data, baseGeoPending[0], baseGeoPending[1], w, hgt, 'image'); closePop(); toast('Đã thêm ảnh nền theo toạ độ'); return; }
  const old = S.doc.base || {};
  S.doc.base = { image: data, x: S.view.cx - w / 2, y: S.view.cy - hgt / 2, w, h: hgt, opacity: old.opacity ?? 1, fade: old.fade || 0, brightness: old.brightness || 0, gray: !!old.gray };
  await loadBaseImage(); changed(); closePop(); fitBase(); startBaseEdit(true);
};
$('#fileCad').onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const text = await f.text();
    let shapes, dropped = 0;
    if (/\.dxf$/i.test(f.name) || /^\s*0\s*[\r\n]+\s*SECTION/.test(text)) {
      shapes = X.parseDXF(text); dropped = shapes.dropped || 0;
      if (!shapes.length) return toast('Không tìm thấy nét nào trong file');
      const ans = await askDxfCoords(shapes, f.name); if (!ans) return;
      if (ans.mode === 'vn') shapes = placeDxfVN(shapes, ans);
      else {
        const rc = X.recenterShapes(shapes); shapes = rc.shapes;
        if (rc.offset[0] || rc.offset[1]) S.doc.settings.cadOffset = rc.offset;
      }
    } else {
      const r = X.parseGeoJSON(text, S.doc.settings); shapes = r.shapes;
      if (r.setGeo) { Object.assign(S.doc.settings, r.setGeo, { georef: true }); }
    }
    if (!shapes.length) return toast('Không tìm thấy nét nào trong file');
    checkpoint(); S.doc.items.unshift(...X.shapesToItems(shapes)); changed(); fitView(); closePop();
    toast(`Đã nhập ${shapes.length} nét từ ${f.name} (đơn vị: mét)` + (dropped ? ` · bỏ ${dropped} nét nằm lạc rất xa khu vẽ` : ''), dropped ? 6000 : undefined);
  } catch (err) { console.error(err); toast('Không đọc được file: ' + err.message); }
};
// Nhập DXF: khai báo hệ toạ độ (VN-2000 + kinh tuyến trục theo tỉnh, hoặc toạ độ tự do)
function askDxfCoords(shapes, fname) {
  const s = S.doc.settings, vn = s.vn2000;
  let e0 = Infinity, e1 = -Infinity, n0 = Infinity, n1 = -Infinity;
  for (const sh of shapes) for (const q of sh.pts) { if (q[0] < e0) e0 = q[0]; if (q[0] > e1) e1 = q[0]; if (-q[1] < n0) n0 = -q[1]; if (-q[1] > n1) n1 = -q[1]; }
  const looksVN = n0 > 900000 && n1 < 2700000 && e0 > 150000 && e1 < 850000;
  const fm = (v) => G.fmtNum(v, 0);
  return new Promise((resolve) => {
    let done = false; const fin = (v) => { if (done) return; done = true; resolve(v); };
    openPop(`<div><h3>Toạ độ của file DXF</h3>
    <div class="note"><b>${esc(fname)}</b>: ${shapes.length} nét · X (Bắc) ${fm(n0)} – ${fm(n1)} · Y (Đông) ${fm(e0)} – ${fm(e1)}${looksVN ? ' · <b>có dạng toạ độ VN-2000</b>' : ''} · đơn vị: <b>mét</b> (1 đơn vị CAD = 1 m)${shapes.dropped ? ` · bỏ ${shapes.dropped} nét nằm lạc rất xa khu vẽ` : ''}</div>
    <div class="seg" id="dxMode" style="width:100%"><button data-m="vn" class="${looksVN ? 'on' : ''}" style="flex:1">Toạ độ VN-2000</button><button data-m="free" class="${looksVN ? '' : 'on'}" style="flex:1">Toạ độ tự do</button></div>
    <div id="dxVN" ${looksVN ? '' : 'hidden'}>
      <div class="field"><span>Tỉnh / thành phố của khu vực</span></div>
      <div class="seg" id="dxEra" style="width:100%"><button data-e="new" class="${(vn || {}).era !== 'old' ? 'on' : ''}" style="flex:1">Sau sáp nhập (34)</button><button data-e="old" class="${(vn || {}).era === 'old' ? 'on' : ''}" style="flex:1">Trước sáp nhập (63)</button></div>
      <select id="dxProv" style="width:100%;margin-top:6px"></select>
      <div class="field"><span>Kinh tuyến trục</span><input id="dxKtt" style="width:110px" value="${vn ? VN.fmtKTT(vn.lon0) : ''}" placeholder="VD: 105°45'"></div>
      <div class="field"><span>Múi chiếu</span><b>3°</b></div>
      <div class="note" id="dxNote">${vn ? `Bản vẽ đang đặt theo VN-2000, KTT ${VN.fmtKTT(vn.lon0)}${vn.prov ? ' (' + esc(vn.prov) + ')' : ''}. Nếu file DXF dùng kinh tuyến trục khác, các nét được chuyển đổi về lưới của bản vẽ.` : 'Chọn tỉnh để lấy kinh tuyến trục, hoặc gõ trực tiếp. Bản vẽ sẽ được định vị theo toạ độ của file: ảnh vệ tinh, địa hình tải sau sẽ khớp đúng vị trí.'}</div>
      <div class="note" id="dxCheck"></div>
    </div>
    <div class="note" id="dxFree" ${looksVN ? 'hidden' : ''}>Toạ độ tự do: các nét được đưa về giữa màn hình, giữ nguyên kích thước và hình dạng (bản vẽ chưa định vị).</div>
    <div class="grid2" style="margin-top:10px"><button class="btn" id="dxCancel">Huỷ</button><button class="btn primary" id="dxOk">Nhập</button></div></div>`, (pop) => {
      let mode = looksVN ? 'vn' : 'free', era = (vn || {}).era === 'old' ? 'old' : 'new', prov = (vn || {}).prov || '';
      const sel = pop.querySelector('#dxProv'), ktt = pop.querySelector('#dxKtt');
      const list = () => (era === 'old' ? VN.PROV_OLD : VN.PROV_NEW);
      const fill = () => { sel.innerHTML = '<option value="">— Chọn tỉnh / thành phố —</option>' + list().map((q, i) => `<option value="${i}" ${q[0] === prov ? 'selected' : ''}>${esc(q[0])} · KTT ${VN.fmtKTT(q[1])}${q[4] ? ' · gồm ' + esc(q[4]) : ''}</option>`).join(''); };
      const check = () => { // vị trí tâm file theo KTT đang chọn → tỉnh gần nhất (để phát hiện chọn nhầm)
        const k = VN.parseKTT(ktt.value), el = pop.querySelector('#dxCheck');
        if (!isFinite(k)) { el.textContent = ''; return; }
        const ll = VN.vnToLL((n0 + n1) / 2, (e0 + e1) / 2, k);
        let best = null, bd = Infinity; for (const q of VN.PROV_NEW) { const d = Math.hypot(q[2] - ll[0], (q[3] - ll[1]) * Math.cos((ll[0] * Math.PI) / 180)); if (d < bd) { bd = d; best = q; } }
        el.innerHTML = `Tâm file: vĩ độ ${ll[0].toFixed(5)}, kinh độ ${ll[1].toFixed(5)}${best ? ` · gần <b>${esc(best[0])}</b> (khoảng ${G.fmtNum(bd * 111, 0)} km)` : ''}` + (bd * 111 > 150 ? ' · <span style="color:#b45309">⚠ khá xa trung tâm tỉnh đã chọn, kiểm tra lại kinh tuyến trục</span>' : '');
      };
      fill(); check();
      pop.querySelectorAll('#dxMode button').forEach((b) => (b.onclick = () => { mode = b.dataset.m; pop.querySelectorAll('#dxMode button').forEach((x) => x.classList.toggle('on', x === b)); pop.querySelector('#dxVN').hidden = mode !== 'vn'; pop.querySelector('#dxFree').hidden = mode === 'vn'; }));
      pop.querySelectorAll('#dxEra button').forEach((b) => (b.onclick = () => { era = b.dataset.e; pop.querySelectorAll('#dxEra button').forEach((x) => x.classList.toggle('on', x === b)); fill(); }));
      sel.onchange = () => { const q = list()[+sel.value]; if (!q) return; prov = q[0]; ktt.value = VN.fmtKTT(q[1]); check(); };
      ktt.addEventListener('input', check);
      pop.querySelector('#dxCancel').onclick = () => { closePop(); fin(null); };
      pop.querySelector('#dxOk').onclick = () => {
        if (mode === 'free') { fin({ mode }); return; }
        const k = VN.parseKTT(ktt.value);
        if (!isFinite(k) || k < 100 || k > 112) { toast('Chọn tỉnh hoặc nhập kinh tuyến trục (VD: 105°45\')'); return; }
        fin({ mode, lon0: k, prov, era, cN: (n0 + n1) / 2, cE: (e0 + e1) / 2 });
      };
      const x = pop.querySelector('h3 .ibtn'); if (x) x.addEventListener('click', () => fin(null));
    });
  });
}
// Đặt nét DXF VN-2000 vào bản vẽ: định vị bản vẽ (nếu chưa), chuyển lưới khi khác kinh tuyến trục
function placeDxfVN(shapes, a) {
  const s = S.doc.settings;
  if (!s.vn2000 || s.vn2000.e0 == null) {
    if (s.georef) setVN2000(a.lon0, a.prov, a.era);
    else {
      const e0 = Math.round(a.cE), n0 = Math.round(a.cN);
      s.vn2000 = { lon0: a.lon0, e0, n0, prov: a.prov || '', era: a.era || 'new' };
      const o = VN.vnToLL(n0, e0, a.lon0); s.lat = +o[0].toFixed(6); s.lon = +o[1].toFixed(6); s.georef = true;
    }
  }
  const vn = s.vn2000, same = Math.abs(vn.lon0 - a.lon0) < 1e-9;
  if (!vn.prov && a.prov) vn.prov = a.prov;
  const tf = same ? (q) => [q[0] - vn.e0, q[1] + vn.n0]
    : (q) => { const ll = VN.vnToLL(-q[1], q[0], a.lon0), r = VN.llToVN(ll[0], ll[1], vn.lon0); return [r[1] - vn.e0, -(r[0] - vn.n0)]; };
  return shapes.map((sh) => ({ ...sh, pts: sh.pts.map(tf) }));
}
function loadImage(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }
async function loadBaseImage() {
  S.images.base = null; S.images.baseProc = null;
  if (S.doc && S.doc.base && S.doc.base.image) { S.images.base = await loadImage(S.doc.base.image); processBase(); requestRender(); }
}

// ---------------- Nhập số bằng viết tay ----------------
// Chạm bút (hoặc ngón tay) vào ô số → vùng viết tay, tự nhận dạng chữ số
document.addEventListener('pointerdown', (e) => {
  const inp = e.target.closest && e.target.closest('input[inputmode="decimal"], input[inputmode="numeric"]');
  if (!inp || inp.disabled || inp.readOnly || inp.dataset.kb) return;
  if (!(e.pointerType === 'pen' || (e.pointerType === 'touch' && S.opts.handNum))) return;
  e.preventDefault(); e.stopPropagation();
  import('./handwrite.js').then((HW) => HW.openPad(inp, {
    keyboard: () => { inp.dataset.kb = '1'; inp.focus(); inp.addEventListener('blur', () => delete inp.dataset.kb, { once: true }); },
  }));
}, true);

// Ô chữ (tên, nhãn): chạm bút → vùng viết chữ tay, máy tự nhận thành chữ (có dấu tiếng Việt)
function openTextHW(inp) {
  import('./handwrite-text.js').then((T) => T.openTextPad(inp, {
    keyboard: () => { inp.dataset.kb = '1'; inp.focus(); inp.addEventListener('blur', () => delete inp.dataset.kb, { once: true }); },
  }));
}
document.addEventListener('pointerdown', (e) => {
  const inp = e.target.closest && e.target.closest('input[data-hw="text"]');
  if (!inp || inp.disabled || inp.readOnly || inp.dataset.kb) return;
  if (!(e.pointerType === 'pen' || (e.pointerType === 'touch' && S.opts.handNum))) return;
  e.preventDefault(); e.stopPropagation();
  openTextHW(inp);
}, true);

// ---------------- Cài đặt ----------------
$('#btnSettings').onclick = () => {
  const s = S.doc.settings;
  openPop(`<div><h3>Cài đặt bản vẽ</h3>
    <h4>Vị trí khu đất (cho bóng đổ & xuất GIS)</h4>
    <div class="field"><span>Vĩ độ</span><input class="num" style="width:120px" id="sLat" inputmode="decimal" value="${s.lat}"></div>
    <div class="field"><span>Kinh độ</span><input class="num" style="width:120px" id="sLon" inputmode="decimal" value="${s.lon}"></div>
    <button class="btn" id="gps" style="width:100%">📍 Lấy vị trí GPS hiện tại</button>
    <label class="chk" style="margin-top:10px"><input type="checkbox" id="sGeo" ${s.georef ? 'checked' : ''}> Định vị bản vẽ (xuất GeoJSON theo kinh/vĩ độ)</label>
    <h4>Ước tính dân số</h4>
    <div class="field"><span>m² sàn ở / người</span><input class="num" id="sPpl" inputmode="decimal" value="${s.peoplePerM2}"></div>
    <h4>Nhập số</h4>
    <label class="chk"><input type="checkbox" id="sHand" ${S.opts.handNum ? 'checked' : ''}> Chạm ngón tay vào ô số: mở vùng viết tay (Apple Pencil luôn mở vùng viết tay)</label>
    <h4>Thông tin</h4>
    <div class="note">QuickPlan phiên bản ${M.APP_VERSION}<br>Thiết kế: ${M.DESIGNER}</div>
    <div class="note">Mẹo: chạm 2 ngón = hoàn tác, chạm 3 ngón = làm lại. Trên PC: chuột trái vẽ, chuột phải kéo bản đồ, lăn chuột thu phóng.</div>
  </div>`, (pop) => {
    pop.querySelector('#sLat').onchange = (e) => { s.lat = parseFloat(e.target.value) || s.lat; touch(); update3DSun(); };
    pop.querySelector('#sLon').onchange = (e) => { s.lon = parseFloat(e.target.value) || s.lon; touch(); };
    pop.querySelector('#sGeo').onchange = (e) => { s.georef = e.target.checked; touch(); };
    pop.querySelector('#sHand').onchange = (e) => { S.opts.handNum = e.target.checked; saveOpts(); };
    pop.querySelector('#sPpl').onchange = (e) => { s.peoplePerM2 = Math.max(5, parseFloat(e.target.value) || 40); changed(); };
    pop.querySelector('#gps').onclick = () => {
      if (!navigator.geolocation) return toast('Thiết bị không hỗ trợ GPS');
      if (!window.isSecureContext) return toast('Cần mở QuickPlan qua địa chỉ https để dùng GPS');
      navigator.geolocation.getCurrentPosition((p) => {
        s.lat = +p.coords.latitude.toFixed(6); s.lon = +p.coords.longitude.toFixed(6); s.georef = true;
        pop.querySelector('#sLat').value = s.lat; pop.querySelector('#sLon').value = s.lon; pop.querySelector('#sGeo').checked = true;
        touch(); update3DSun(); toast('Đã lấy vị trí GPS');
      }, (err) => toast('Không lấy được vị trí: ' + err.message), { enableHighAccuracy: true, timeout: 15000 });
    };
  });
};

// ---------------- Xuất file ----------------
let exportTarget = 'pc';
$('#btnExport').onclick = () => openPop(`<div><h3>Xuất file</h3>
  <div class="seg" id="exTarget" style="width:100%"><button data-t="pc" class="${exportTarget === 'pc' ? 'on' : ''}" style="flex:1">Gửi về PC</button><button data-t="dev" class="${exportTarget === 'dev' ? 'on' : ''}" style="flex:1">Lưu trên thiết bị này</button></div>
  <h4>2D / GIS</h4>
  <div class="grid2">
    <button class="btn" data-x="geojson">GeoJSON<small>QGIS, ArcGIS</small></button>
    <button class="btn" data-x="dxf">DXF<small>AutoCAD, Civil 3D</small></button>
    <button class="btn" data-x="svg">SVG<small>Illustrator, in ấn</small></button>
    <button class="btn" data-x="png">PNG<small>Ảnh mặt bằng</small></button>
  </div>
  <h4>Mô hình 3D</h4>
  <div class="grid2">
    <button class="btn" data-x="obj">OBJ<small>SketchUp, Rhino</small></button>
    <button class="btn" data-x="glb">GLB (glTF)<small>Blender, web</small></button>
    <button class="btn" data-x="usdz">USDZ<small>Xem AR trên iPad</small></button>
    <button class="btn" data-x="png3d">PNG 3D<small>Ảnh phối cảnh</small></button>
  </div>
  <div class="note">“Gửi về PC” lưu vào thư mục <b>QuickPlan-DuLieu/XuatFile</b> trên máy tính.</div>
  </div>`, (pop) => {
  pop.querySelectorAll('#exTarget button').forEach((b) => (b.onclick = () => { exportTarget = b.dataset.t; pop.querySelectorAll('#exTarget button').forEach((x) => x.classList.toggle('on', x === b)); }));
  pop.querySelectorAll('[data-x]').forEach((b) => (b.onclick = () => doExport(b.dataset.x)));
});

async function doExport(kind) {
  const base = (S.doc.name || 'QuickPlan').replace(/[^\p{L}\p{N}_ -]+/gu, '').trim().replace(/\s+/g, '_') || 'QuickPlan';
  let name, blob;
  try {
    toast('Đang xuất…');
    switch (kind) {
      case 'geojson': name = base + '.geojson'; blob = new Blob([X.toGeoJSON(S.doc, S.metrics)], { type: 'application/geo+json' }); break;
      case 'dxf': name = base + '.dxf'; blob = new Blob([X.toDXF(S.doc)], { type: 'application/dxf' }); break;
      case 'svg': name = base + '.svg'; blob = new Blob([X.toSVG(S.doc)], { type: 'image/svg+xml' }); break;
      case 'png': name = base + '.png'; blob = await new Promise((r) => canvas.toBlob(r, 'image/png')); break;
      default: {
        const v = await ensure3D();
        v.build(S.doc, S.metrics, null, S.images);
        if (kind === 'png3d') { if (S.mode !== '3d') v.frame(); name = base + '_3D.png'; blob = await (await fetch(v.snapshot())).blob(); break; }
        const { exportModel } = await import('./export3d.js');
        const r = await exportModel(kind, v.exportGroup());
        name = base + '.' + kind; blob = r;
        if (S.mode === '3d') build3D();
      }
    }
    odQueueExport(name, blob);
    if (exportTarget === 'pc') {
      try { const r = await Store.sendExportToPC(name, blob); toast('Đã lưu về PC: ' + r.path); return; }
      catch { toast('Không kết nối được PC, đang lưu trên thiết bị…'); }
    }
    X.download(name, blob);
  } catch (err) { console.error(err); toast('Xuất file lỗi: ' + err.message); }
}

// ---------------- 3D ----------------
let v3 = null, v3Timer = 0;
let sunDoy = 172, sunHour = 9, sunManual = false, sunAz = 135, sunEl = 45;
async function ensure3D() {
  if (!v3) {
    const { View3D } = await import('./view3d.js');
    v3 = new View3D($('#v3d'));
    bind3DInput(v3);
    v3.onAsset = () => { if (S.mode === '3d') schedule3D(); };
    v3.onLost = () => toast('Bộ nhớ đồ hoạ của máy bị đầy, 3D tạm dừng. Đang chờ dựng lại; nếu vẫn trắng, hãy tắt bớt lớp nét CAD hoặc địa hình.', 8000);
    v3.onRestored = () => { if (S.mode === '3d') { build3D(); toast('Đã dựng lại 3D'); } };
    v3.controls.addEventListener('change', () => { if (S.stroke || S.circleDraft) draw3DOverlay(); });
    // viền mặt khối đang chọn vẽ lại cùng khung hình 3D để bám khối ngay khi xoay, thu phóng
    { let last = ''; v3.onFrame = () => { if (S.tool !== 'facet' || !S.facetSel) { if (last) { last = ''; draw3DOverlay(); } return; } const k = v3.camera.matrixWorld.elements.join(',') + v3.camera.projectionMatrix.elements[0] + (drag ? drag.pts && drag.pts.length : 0); if (k !== last) { last = k; draw3DOverlay(); } }; }
    update3DSun();
  }
  return v3;
}
function build3D() { if (v3) { M.setGroundFn(TR.groundSampler(S.doc)); v3.isoFn = S.iso ? inIso : null; v3.isoKey = S.iso; v3.checkMode = S.tool === 'check'; v3.build(S.doc, S.metrics, S.multi.length > 1 ? new Set(S.multi) : S.selectedId, S.images); } syncIsoBar(); }
function schedule3D() { clearTimeout(v3Timer); v3Timer = setTimeout(() => { build3D(); draw3DOverlay(); }, 60); }
const AZ_NAMES = ['Bắc', 'Đông Bắc', 'Đông', 'Đông Nam', 'Nam', 'Tây Nam', 'Tây', 'Tây Bắc'];
function update3DSun() {
  if (!v3) return;
  if (sunManual) {
    v3.setSunDir(sunAz, sunEl);
    $('#sunAzV').textContent = `${sunAz}° (${AZ_NAMES[Math.round(sunAz / 45) % 8]})`;
    $('#sunElV').textContent = `${sunEl}°`;
    return;
  }
  const r = v3.setSun(S.doc ? S.doc.settings.lat : 21, sunDoy, sunHour);
  const hh = Math.floor(sunHour), mm = Math.round((sunHour - hh) * 60);
  $('#sunTime').textContent = `${hh}:${String(mm).padStart(2, '0')}`;
  $('#sunTime').title = `Mặt trời: cao ${r.elevation.toFixed(0)}°, phương vị ${r.azimuth.toFixed(0)}°`;
}
// ---------------- Co kéo ảnh nền ----------------
// Kéo trong ảnh: di chuyển · kéo chấm góc: co giãn (giữ tỷ lệ nếu bật) · kéo chấm cạnh: kéo giãn một chiều
function baseHandles() {
  const b = S.doc.base, x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h, xm = (x0 + x1) / 2, ym = (y0 + y1) / 2;
  return [
    { k: 'nw', p: [x0, y0], ax: [x1, y1] }, { k: 'ne', p: [x1, y0], ax: [x0, y1] }, { k: 'se', p: [x1, y1], ax: [x0, y0] }, { k: 'sw', p: [x0, y1], ax: [x1, y0] },
    { k: 'n', p: [xm, y0], ax: [xm, y1] }, { k: 'e', p: [x1, ym], ax: [x0, ym] }, { k: 's', p: [xm, y1], ax: [xm, y0] }, { k: 'w', p: [x0, ym], ax: [x1, ym] },
  ];
}
function drawBaseHandles() {
  const b = S.doc.base, v = S.view, a = v.toScreen([b.x, b.y]);
  ctx.save();
  const im = S.images.baseProc || S.images.base;
  if (im) { ctx.globalAlpha = 0.6 * (b.opacity ?? 1); ctx.drawImage(im, a[0], a[1], b.w * v.scale, b.h * v.scale); ctx.globalAlpha = 1; }
  ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 2; ctx.setLineDash([10, 6]);
  ctx.strokeRect(a[0], a[1], b.w * v.scale, b.h * v.scale); ctx.setLineDash([]);
  for (const hd of baseHandles()) {
    const q = v.toScreen(hd.p), corner = hd.k.length === 2;
    ctx.beginPath();
    if (corner) ctx.rect(q[0] - 9, q[1] - 9, 18, 18); else ctx.arc(q[0], q[1], 8, 0, 7);
    ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 2.5; ctx.stroke();
  }
  const c = v.toScreen([b.x + b.w / 2, b.y + b.h / 2]);
  ctx.font = '600 13px system-ui'; ctx.textAlign = 'center';
  const txt = `${G.fmtNum(b.w, 1)} × ${G.fmtNum(b.h, 1)} m`;
  const tw = ctx.measureText(txt).width + 16;
  ctx.fillStyle = 'rgba(37,99,235,.92)'; ctx.fillRect(c[0] - tw / 2, c[1] - 13, tw, 26);
  ctx.fillStyle = '#fff'; ctx.fillText(txt, c[0], c[1] + 5);
  ctx.restore();
}
function startBaseEdit(fresh = false) {
  if (!S.doc || !S.doc.base) return;
  { const L = S.doc.layers.find((l) => l.id === M.BASE_LAYER); if (L && L.locked && !fresh) { toast('🔒 Lớp Ảnh nền đang khoá – mở khoá trong Quản lý lớp để co kéo, di chuyển ảnh'); return; } }
  if (S.mode !== '2d') setMode('2d');
  if (S.view.rot) { S.view.rotateAt(S.view.w / 2, S.view.h / 2, -S.view.rot); S.view.rot = 0; syncNorthBtn(); } // chỉnh ảnh nền ở hướng Bắc lên trên
  S.baseEdit = { orig: JSON.stringify(baseGeom()), hist: [], fresh };
  $('#hud').style.display = 'none';
  S.stroke = null; drag = null;
  renderToolOpts(); requestRender();
  toast(fresh ? 'Đã thêm ảnh nền · kéo để đặt ảnh, kéo chấm góc/cạnh để co kéo cho khớp' : 'Co kéo ảnh nền: kéo ảnh để di chuyển, kéo chấm góc/cạnh để co giãn');
}
function baseGeom() { const b = S.doc.base; return { x: b.x, y: b.y, w: b.w, h: b.h }; }
function endBaseEdit(keep = true) {
  if (!S.baseEdit) return;
  if (!keep && S.doc && S.doc.base) Object.assign(S.doc.base, JSON.parse(S.baseEdit.orig));
  S.baseEdit = null; drag = null; $('#hud').style.display = '';
  if (S.doc) { changed(); renderToolOpts(); requestRender(); }
}
function fitBase() {
  const b = S.doc.base; if (!b) return;
  // chừa chỗ cho thanh công cụ (trái) và thanh tuỳ chọn (trên)
  const L = 110, T = 230, R = 40, B = 50, v = S.view;
  v.scale = Math.min((v.w - L - R) / b.w, (v.h - T - B) / b.h);
  const sx = (L + v.w - R) / 2, sy = (T + v.h - B) / 2;
  v.cx = b.x + b.w / 2 - (sx - v.w / 2) / v.scale; v.cy = b.y + b.h / 2 - (sy - v.h / 2) / v.scale;
  requestRender();
}
function baseDown(e, p, w) {
  const b = S.doc.base; if (!b) return;
  const tol = (e.pointerType === 'touch' ? 26 : 18);
  let hit = null;
  for (const hd of baseHandles()) { const q = S.view.toScreen(hd.p); const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < tol && (!hit || d < hit.d)) hit = { ...hd, d }; }
  const inside = w[0] >= b.x && w[0] <= b.x + b.w && w[1] >= b.y && w[1] <= b.y + b.h;
  if (!hit && !inside) return; // ngoài ảnh: không làm gì
  S.baseEdit.hist.push(JSON.stringify(baseGeom()));
  drag = { kind: 'base', pointerId: e.pointerId, pointerType: e.pointerType, start: p, startW: w, h: hit, g0: baseGeom() };
}
function baseMove(w) {
  const b = S.doc.base, d = drag, g = d.g0, hd = d.h;
  if (!hd) { b.x = g.x + w[0] - d.startW[0]; b.y = g.y + w[1] - d.startW[1]; requestRender(); return; }
  const ax = hd.ax, MIN = 1;
  let x0 = g.x, y0 = g.y, x1 = g.x + g.w, y1 = g.y + g.h;
  if (hd.k.length === 2) {
    let nw = Math.max(MIN, Math.abs(w[0] - ax[0])), nh = Math.max(MIN, Math.abs(w[1] - ax[1]));
    if (S.opts.baseKeepRatio !== false) { const k = Math.max(nw / g.w, nh / g.h); nw = g.w * k; nh = g.h * k; }
    const sx = hd.k.includes('e') ? 1 : -1, sy = hd.k.includes('s') ? 1 : -1;
    x0 = sx > 0 ? ax[0] : ax[0] - nw; x1 = x0 + nw;
    y0 = sy > 0 ? ax[1] : ax[1] - nh; y1 = y0 + nh;
  } else if (hd.k === 'e') x1 = Math.max(x0 + MIN, w[0]);
  else if (hd.k === 'w') x0 = Math.min(x1 - MIN, w[0]);
  else if (hd.k === 's') y1 = Math.max(y0 + MIN, w[1]);
  else if (hd.k === 'n') y0 = Math.min(y1 - MIN, w[1]);
  Object.assign(b, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  requestRender();
}
function renderBaseEditOpts(box) {
  const b = S.doc.base;
  box.append(h('<span class="title">Co kéo ảnh nền</span>'));
  const keep = h(`<button class="chip ${S.opts.baseKeepRatio !== false ? 'on' : ''}">🔒 Giữ tỷ lệ</button>`);
  keep.onclick = () => { S.opts.baseKeepRatio = S.opts.baseKeepRatio === false; saveOpts(); renderToolOpts(); };
  box.append(keep);
  box.append(lbl('Ngang (m)', numInput(Math.round(b.w * 10) / 10, (v) => { if (!v) return; S.baseEdit.hist.push(JSON.stringify(baseGeom())); const cx = b.x + b.w / 2, cy = b.y + b.h / 2, k = v / b.w; b.w = v; if (S.opts.baseKeepRatio !== false) b.h *= k; b.x = cx - b.w / 2; b.y = cy - b.h / 2; changed({ light: true }); renderToolOpts(); }, 1)));
  box.append(lbl('Dọc (m)', numInput(Math.round(b.h * 10) / 10, (v) => { if (!v) return; S.baseEdit.hist.push(JSON.stringify(baseGeom())); const cx = b.x + b.w / 2, cy = b.y + b.h / 2, k = v / b.h; b.h = v; if (S.opts.baseKeepRatio !== false) b.w *= k; b.x = cx - b.w / 2; b.y = cy - b.h / 2; changed({ light: true }); renderToolOpts(); }, 1)));
  const op = h(`<label>Độ rõ <input type="range" min="0.2" max="1" step="0.05" value="${b.opacity ?? 1}" style="width:110px"></label>`);
  op.querySelector('input').oninput = (e) => { b.opacity = +e.target.value; changed({ light: true }); };
  box.append(op);
  const un = h('<button class="chip">↶ Lùi bước</button>');
  un.onclick = () => { const g = S.baseEdit.hist.pop(); if (g) { Object.assign(b, JSON.parse(g)); changed({ light: true }); renderToolOpts(); } };
  const reset = h('<button class="chip">Huỷ thay đổi</button>');
  reset.onclick = () => { S.baseEdit.hist.push(JSON.stringify(baseGeom())); Object.assign(b, JSON.parse(S.baseEdit.orig)); changed({ light: true }); renderToolOpts(); };
  const done = h('<button class="btn primary sm">✓ Xong</button>');
  done.onclick = () => { endBaseEdit(true); toast('Đã cố định ảnh nền'); };
  box.append(un, reset, done);
  box.append(h('<span class="muted" style="font-size:12.5px;flex-basis:100%">Kéo trong ảnh để di chuyển · kéo chấm góc để co giãn · kéo chấm cạnh để kéo giãn một chiều · 2 ngón tay để xem quanh. Trong lúc căn, ảnh hiện mờ phía trên bản vẽ để dễ khớp.</span>'));
}

async function setMode(m) {
  if (m !== '3d' && tour) stopTour(true);
  S.mode = m;
  $('#btn2d').classList.toggle('on', m === '2d'); $('#btn3d').classList.toggle('on', m === '3d');
  $('#v3d').hidden = m !== '3d'; $('#c2d').style.visibility = m === '3d' ? 'hidden' : 'visible';
  sync3DBar(); syncNorthBtn();
  closePop();
  if (m === '3d' && S.baseEdit) endBaseEdit(true);
  S.stroke = null; drag = null; S.circleDraft = null;
  if (m === '3d') {
    try {
      const v = await ensure3D();
      build3D();
      if (!v.framed) { v.framed = true; if (S.iso) focusIso(); else v.frame(); }
      lockControls(v);
      v.start(); update3DSun(); draw3DOverlay();
      $('#bldByUse').checked = !!S.doc.settings.bldColorByUse;
    } catch (err) {
      console.error(err);
      toast('Không mở được 3D trên thiết bị này: ' + (err && err.message ? err.message : err), 8000);
      return setMode('2d');
    }
  } else if (v3) { v3.stop(); requestRender(); }
  renderToolOpts();
}
$('#btn2d').onclick = () => setMode('2d');
$('#btn3d').onclick = () => setMode('3d');
$$('#renderModes button').forEach((b) => (b.onclick = () => {
  $$('#renderModes button').forEach((x) => x.classList.toggle('on', x === b));
  v3.setMode(b.dataset.mode); build3D();
}));
$('#bldByUse').onchange = (e) => { if (!S.doc) return; S.doc.settings.bldColorByUse = e.target.checked; changed(); };
$('#sunOn').onchange = (e) => { v3.sunOn = e.target.checked; v3.updateSunShadowBox(); };
$('#sunSlider').oninput = (e) => { sunHour = +e.target.value; update3DSun(); };
$$('#sunDates button').forEach((b) => (b.onclick = () => {
  sunDoy = +b.dataset.doy; $$('#sunDates button').forEach((x) => x.classList.toggle('on', x === b)); $('#sunDate').value = ''; update3DSun();
}));
$('#sunDate').onchange = (e) => {
  const d = new Date(e.target.value); if (isNaN(d)) return;
  sunDoy = Math.round((d - new Date(d.getFullYear(), 0, 0)) / 864e5);
  $$('#sunDates button').forEach((x) => x.classList.remove('on')); update3DSun();
};
$$('#sunModeSeg button').forEach((b) => (b.onclick = () => {
  sunManual = b.dataset.m === 'manual';
  $$('#sunModeSeg button').forEach((x) => x.classList.toggle('on', x === b));
  $('#sunAuto').hidden = sunManual; $('#sunMan').hidden = !sunManual; update3DSun();
}));
$('#sunAz').oninput = (e) => { sunAz = +e.target.value; update3DSun(); };
$('#sunEl').oninput = (e) => { sunEl = +e.target.value; update3DSun(); };
$('#btnFrame').onclick = () => frame3D();
// Toàn cảnh 3D: đang Nhìn thẳng mặt → về mặt đó; đang Khóa khối → khung khối; không thì cả bản vẽ
function frame3D() {
  if (!v3) return;
  if (S.lookLock) lookAtFace(S.lookLock); else if (S.iso) focusIso(); else { v3.frame(); v3.controls.update(); }
}
// Nút phóng to / thu nhỏ / toàn cảnh (2D và 3D)
function zoomStep(f) {
  if (S.mode === '3d' && v3) { const c = v3.camera.position, t = v3.controls.target; c.sub(t).multiplyScalar(1 / f).add(t); v3.controls.update(); return; }
  S.view.zoomAt(S.view.w / 2, S.view.h / 2, f); requestRender('view'); scheduleViewSave();
}
$('#zoomIn').onclick = () => zoomStep(1.5);
// Nút la bàn: hiện khi bản vẽ 2D đang xoay, chạm để đưa hướng Bắc về phía trên
function syncNorthBtn() {
  const b = $('#zoomNorth'); if (!b) return;
  const r = S.view.rot || 0;
  b.hidden = S.mode === '3d' || Math.abs(r) < 1e-4;
  b.querySelector('svg').style.transform = `rotate(${(r * 180) / Math.PI}deg)`;
}
$('#zoomNorth').onclick = () => { S.view.rotateAt(S.view.w / 2, S.view.h / 2, -S.view.rot); S.view.rot = 0; syncNorthBtn(); requestRender(); scheduleViewSave(); };
$('#zoomOut').onclick = () => zoomStep(1 / 1.5);
$('#zoomFit').onclick = () => { if (S.mode === '3d' && v3) frame3D(); else if (S.iso) focusIso(); else { fitView(); scheduleViewSave(); } };
let renderUrl = null;
const RENDER_KINDS = {
  view: ['Chụp khung nhìn', 'Ảnh y như khung nhìn 3D đang hiển thị (chế độ Khối đặc, Đường sinh, X-Ray, màu, bóng…), độ phân giải cao. Gần như tức thì.'],
  fast: ['Render nhanh', 'Ảnh phối cảnh như bản cũ: bầu trời, bóng đổ mịn, mặt đứng có cửa sổ theo tầng. Vài giây.'],
  real: ['Render ảnh thật', 'Ảnh đẹp như thật, chất lượng cao: bầu trời có mây, ánh sáng ngoài trời, kính và mặt nước phản chiếu, bóng mềm như nắng thật, khử răng cưa nhiều lượt. Chờ lâu hơn (khoảng 10–60 giây tuỳ máy).'],
};
$('#btnRender').onclick = () => openPop(`<div><h3>Xuất ảnh 3D</h3>
  <div class="seg" id="rdKind" style="width:100%">${Object.entries(RENDER_KINDS).map(([k, [n]]) => `<button data-k="${k}" class="${k === 'fast' ? 'on' : ''}" style="flex:1">${n}</button>`).join('')}</div>
  <div class="note" id="rdNote">${RENDER_KINDS.fast[1]}</div>
  <div class="field"><span>Độ phân giải</span></div>
  <div class="seg" id="rdRes" style="width:100%"><button data-w="1600" style="flex:1">Nhanh 1600</button><button data-w="2400" class="on" style="flex:1">Đẹp 2400</button><button data-w="3600" style="flex:1">Rất nét 3600</button></div>
  <button class="btn primary" id="rdGo" style="width:100%;margin-top:10px">Dựng ảnh</button>
  <div id="rdOut"></div></div>`, (pop) => {
  let wpx = 2400, kind = 'fast';
  // dựng thử rất nhỏ ngay khi mở hộp thoại để chuẩn bị sẵn bộ dựng (lần dựng thật nhanh hơn)
  setTimeout(async () => { try { const v = await ensure3D(); if (!v.realR) { await v.renderRealistic(S.doc, S.metrics, S.images, 64, 'warm'); build3D(); } } catch {} }, 150);
  pop.querySelectorAll('#rdRes button').forEach((b) => (b.onclick = () => { wpx = +b.dataset.w; pop.querySelectorAll('#rdRes button').forEach((x) => x.classList.toggle('on', x === b)); }));
  pop.querySelectorAll('#rdKind button').forEach((b) => (b.onclick = () => { kind = b.dataset.k; pop.querySelectorAll('#rdKind button').forEach((x) => x.classList.toggle('on', x === b)); pop.querySelector('#rdNote').textContent = RENDER_KINDS[kind][1]; }));
  pop.querySelector('#rdGo').onclick = async () => {
    const go = pop.querySelector('#rdGo'); go.disabled = true; go.textContent = 'Đang dựng ảnh…';
    const out = pop.querySelector('#rdOut');
    try {
      const v = await ensure3D();
      const t0 = performance.now();
      let blob;
      if (kind === 'view') { if (S.mode !== '3d') await setMode('3d'); blob = await v.captureView(wpx); }
      else {
        blob = await v.renderRealistic(S.doc, S.metrics, S.images, wpx, 'jpeg', kind === 'real' ? { hq: true, onProgress: (f) => { go.textContent = `Đang dựng ảnh thật… ${Math.round(f * 100)}%`; } } : {});
        build3D();
      }
      if (renderUrl) URL.revokeObjectURL(renderUrl);
      renderUrl = URL.createObjectURL(blob);
      const base = (S.doc.name || 'QuickPlan').replace(/[^\p{L}\p{N}_ -]+/gu, '').trim().replace(/\s+/g, '_') || 'QuickPlan';
      const name = base + { view: '_KhungNhin', fast: '_PhoiCanh', real: '_AnhThat' }[kind] + '.jpg';
      out.innerHTML = `<img src="${renderUrl}" alt="${RENDER_KINDS[kind][0]}" style="width:100%;border-radius:10px;margin-top:10px;box-shadow:0 2px 10px rgba(0,0,0,.15)"><div class="muted" style="font-size:12px;margin:4px 0">${RENDER_KINDS[kind][0]} · ${G.fmtNum((performance.now() - t0) / 1000, 1)} giây · ${(blob.size / 1048576).toFixed(1)} MB</div><div class="grid2"><button class="btn" id="rdSave">Lưu ảnh</button><button class="btn" id="rdPc">Gửi về PC</button></div>`;
      out.querySelector('#rdSave').onclick = () => { X.download(name, blob); odQueueExport(name, blob); };
      out.querySelector('#rdPc').onclick = async () => { odQueueExport(name, blob); try { const r = await Store.sendExportToPC(name, blob); toast('Đã lưu về PC: ' + r.path); } catch { toast('Không kết nối được PC'); } };
    } catch (err) { console.error(err); toast('Dựng ảnh lỗi: ' + err.message); build3D(); }
    go.disabled = false; go.textContent = 'Dựng lại';
  };
});

// ---------------- Địa hình từ DEM trên mạng ----------------
$('#btnTerrain').onclick = () => {
  const s = S.doc.settings, t = S.doc.terrain;
  const geo = !!(s.georef || s.vn2000 || (S.doc.base && S.doc.base.lat));
  openPop(`<div><h3>⛰ Địa hình (DEM)</h3>
  <div class="note">Tạo địa hình 3D đúng vị trí bản vẽ từ mô hình số độ cao lấy trên mạng (máy tính chạy QuickPlan cần có Internet). Toạ độ theo vị trí đã đặt cho bản vẽ (ảnh nền theo toạ độ, VN-2000 hoặc Cài đặt → Vĩ độ/Kinh độ).</div>
  ${geo ? '' : '<div class="note" style="color:#b45309">⚠ Bản vẽ chưa đặt vị trí: vào <b>Ảnh nền</b> → tải ảnh theo toạ độ (hoặc Cài đặt → Vĩ độ, Kinh độ) trước, nếu không địa hình sẽ lấy theo vị trí mặc định.</div>'}
  <div class="field"><span>Vùng tải địa hình</span></div>
  <div class="seg" id="trArea" style="width:100%"><button data-v="auto" style="flex:1">Phủ hết bản vẽ + CAD</button><button data-v="lasso" style="flex:1">✍ Khoanh vùng bằng bút</button><button data-v="size" style="flex:1">Theo cỡ</button></div>
  <div class="seg" id="trSize" style="width:100%;margin-top:6px">${[[1000, '1 km'], [2000, '2 km'], [4000, '4 km'], [8000, '8 km']].map(([v, n]) => `<button data-v="${v}" class="${(t ? t.size : 2000) === v ? 'on' : ''}" style="flex:1">${n}</button>`).join('')}</div>
  <div class="muted" id="trAreaNote" style="font-size:12px;margin-top:4px"></div>
  <label class="chk"><input type="checkbox" id="trSat" ${geo ? 'checked' : ''}> Tải ảnh vệ tinh trùng đúng vùng địa hình (thay ảnh nền hiện có)</label>
  <div class="field"><span>Phóng đại chiều cao</span></div>
  <div class="seg" id="trEx" style="width:100%">${[1, 1.5, 2, 3].map((v) => `<button data-v="${v}" class="${(t ? t.exag || 1 : 1) === v ? 'on' : ''}" style="flex:1">×${String(v).replace('.', ',')}</button>`).join('')}</div>
  <label class="chk"><input type="checkbox" id="trFlat" ${t && t.flat !== false ? 'checked' : ''}> San nền khu vẽ về một cao độ (bỏ tích: giữ địa hình thật cả trong khu vẽ, công trình, cây, đường đặt theo dốc)</label>
  ${t ? `<label class="chk"><input type="checkbox" id="trOn" ${t.on !== false ? 'checked' : ''}> Hiện địa hình</label>` : ''}
  <div class="field"><span>Màu địa hình</span><input type="color" id="trCol" value="${(t && t.color) || '#e9e4d6'}" style="width:52px;height:34px;padding:0;border:1px solid var(--line);border-radius:8px"></div>
  <div class="seg" id="trCm" style="width:100%"><button data-v="plain" class="${!t || t.cmode !== 'elev' ? 'on' : ''}" style="flex:1">Một màu</button><button data-v="elev" class="${t && t.cmode === 'elev' ? 'on' : ''}" style="flex:1">Tô theo cao độ</button></div>
  <div id="trLeg" style="margin-top:6px"></div>
  <label class="chk"><input type="checkbox" id="trCt" ${!t || t.contours !== false ? 'checked' : ''}> Đường đồng mức (mảnh mỗi 5 m, đậm mỗi 25 m)</label>
  <button class="btn primary" id="trGo" style="width:100%;margin-top:10px">${t ? 'Tải lại địa hình' : 'Tải địa hình'}</button>
  ${t ? '<button class="btn" id="trDel" style="width:100%;margin-top:6px">Xoá địa hình</button>' : ''}
  <div class="muted" id="trInfo" style="font-size:12px;margin-top:8px">${t ? `Đã có: ${G.fmtNum((t.nx - 1) * t.step / 1000, 1)} × ${G.fmtNum((t.ny - 1) * t.step / 1000, 1)} km, lưới ${t.step} m · cao độ khu vẽ ≈ ${G.fmtNum(t.ref, 0)} m · thấp nhất ${G.fmtNum(t.hmin, 0)} m, cao nhất ${G.fmtNum(t.hmax, 0)} m<br>` : ''}${TR.DEM_CREDIT}. Dữ liệu mở, được dùng cho mục đích thương mại, cần ghi nguồn. Độ phân giải khoảng 30 m (SRTM) nên phù hợp xem địa hình chung, không thay bản đồ địa hình đo đạc.</div></div>`, (pop) => {
    let size = t ? t.size || 2000 : 2000, exag = t ? t.exag || 1 : 1, cmode = t && t.cmode === 'elev' ? 'elev' : 'plain';
    const legend = () => { // chú giải màu theo cao độ
      const el = pop.querySelector('#trLeg'), T = S.doc.terrain;
      if (cmode !== 'elev') { el.innerHTML = ''; return; }
      const lo = T ? Math.max(0, T.hmin) : 0, hi = T ? T.hmax : 1000;
      el.innerHTML = `<div style="height:12px;border-radius:6px;background:linear-gradient(90deg,${TR.ELEV_STOPS.map(([u, c]) => c + ' ' + u * 100 + '%').join(',')})"></div><div class="muted" style="display:flex;justify-content:space-between;font-size:12px"><span>${G.fmtNum(lo, 0)} m</span><span>${G.fmtNum((lo + hi) / 2, 0)} m</span><span>${G.fmtNum(hi, 0)} m</span></div>${T && T.hmin < 0 ? `<div class="muted" style="font-size:12px"><span style="display:inline-block;width:12px;height:12px;border-radius:3px;vertical-align:-2px;background:${TR.SEA_COLOR}"></span> dưới 0 m (biển, sông hồ)</div>` : ''}${T ? '' : '<div class="muted" style="font-size:12px">Khoảng cao độ lấy theo địa hình sau khi tải</div>'}`;
    };
    legend();
    const segSel = (id, fn) => pop.querySelectorAll(id + ' button').forEach((b) => (b.onclick = () => { pop.querySelectorAll(id + ' button').forEach((x) => x.classList.toggle('on', x === b)); fn(+b.dataset.v); }));
    const apply = () => { if (!S.doc.terrain) return; checkpoint(); Object.assign(S.doc.terrain, termStyle(), { exag, flat: pop.querySelector('#trFlat').checked, on: pop.querySelector('#trOn') ? pop.querySelector('#trOn').checked : true }); changed(); schedule3D(); };
    function termStyle() { return { cmode, color: pop.querySelector('#trCol').value, contours: pop.querySelector('#trCt').checked }; }
    segSel('#trCm', () => {}); pop.querySelectorAll('#trCm button').forEach((b) => b.addEventListener('click', () => { cmode = b.dataset.v; legend(); apply(); }));
    pop.querySelector('#trCol').addEventListener('change', () => { if (cmode !== 'plain') { cmode = 'plain'; pop.querySelectorAll('#trCm button').forEach((x) => x.classList.toggle('on', x.dataset.v === 'plain')); legend(); } apply(); });
    pop.querySelector('#trCt').onchange = apply;
    segSel('#trSize', (v) => (size = v));
    let area = (t && t.area) || (S.opts.trArea || 'auto');
    const syncArea = () => {
      pop.querySelectorAll('#trArea button').forEach((x) => x.classList.toggle('on', x.dataset.v === area));
      pop.querySelector('#trSize').hidden = area !== 'size';
      const bb = TR.drawnBBox(S.doc, true);
      pop.querySelector('#trAreaNote').textContent = area === 'auto' ? (bb ? `Tự tính khung phủ hết các nét đã vẽ và bản CAD đã nhập (${G.fmtNum((bb[2] - bb[0] + 400) / 1000, 2)} × ${G.fmtNum((bb[3] - bb[1] + 400) / 1000, 2)} km, thêm lề 200 m)` : 'Chưa có nét nào: sẽ lấy 1 km quanh màn hình') : area === 'lasso' ? 'Bấm «Tải địa hình», rồi dùng bút khoanh một vòng trên mặt bằng 2D quanh vùng cần tải; địa hình chỉ hiện trong vùng khoanh' : 'Khung vuông quanh khu vẽ theo cỡ chọn';
    };
    pop.querySelectorAll('#trArea button').forEach((x) => (x.onclick = () => { area = x.dataset.v; S.opts.trArea = area; saveOpts(); syncArea(); }));
    syncArea();
    segSel('#trEx', (v) => { exag = v; apply(); });
    pop.querySelector('#trFlat').onchange = apply;
    if (pop.querySelector('#trOn')) pop.querySelector('#trOn').onchange = apply;
    if (pop.querySelector('#trDel')) pop.querySelector('#trDel').onclick = () => { checkpoint(); delete S.doc.terrain; changed(); schedule3D(); closePop(); toast('Đã xoá địa hình'); };
    pop.querySelector('#trGo').onclick = async () => {
      const opt = { style: termStyle(), flat: pop.querySelector('#trFlat').checked, exag, size, area, sat: pop.querySelector('#trSat').checked };
      if (area === 'lasso') { closePop(); pickLasso((poly) => runTerrain({ ...opt, clip: poly }), 'Dùng bút khoanh một vòng quanh vùng cần tải địa hình'); return; }
      const go = pop.querySelector('#trGo'); go.disabled = true;
      const ok = await runTerrain(opt, (txt) => (go.textContent = txt));
      if (ok) closePop(); else { go.disabled = false; go.textContent = 'Thử lại'; }
    };
  });
};

// Tải địa hình theo vùng: auto (phủ hết nét vẽ + CAD), size (khung vuông theo cỡ), lasso (vùng khoanh bằng bút)
async function runTerrain(opt, prog) {
  const s = S.doc.settings;
  const say = prog || ((t) => toast(t, 60000));
  try {
    const bbAll = TR.drawnBBox(S.doc, true), bbDraw = TR.drawnBBox(S.doc) || bbAll || [S.view.cx - 50, S.view.cy - 50, S.view.cx + 50, S.view.cy + 50];
    let box;
    if (opt.clip) { const b = G.bbox(opt.clip); box = [b.x0, b.y0, b.x1, b.y1]; }
    else if (opt.area === 'auto') { const b = bbAll || [S.view.cx - 500, S.view.cy - 500, S.view.cx + 500, S.view.cy + 500]; const pad = 200; box = [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad]; }
    else { const c = [(bbDraw[0] + bbDraw[2]) / 2, (bbDraw[1] + bbDraw[3]) / 2], half = Math.max(opt.size, Math.max(bbDraw[2] - bbDraw[0], bbDraw[3] - bbDraw[1]) + 400) / 2; box = [c[0] - half, c[1] - half, c[0] + half, c[1] + half]; }
    const side = Math.max(box[2] - box[0], box[3] - box[1]);
    if (side > 30000) { toast('Vùng quá rộng (trên 30 km): khoanh vùng nhỏ hơn', 5000); return false; }
    const step = Math.max(10, Math.ceil(side / 240));
    const toLL = (p) => { const ll = X.toLonLat(p, s.lat, s.lon, s.vn2000); return [ll[1], ll[0]]; };
    say('Đang tải độ cao…');
    const D = await TR.downloadDEM(box, toLL, step, (a, n) => say(`Đang tải độ cao… ${a}/${n}`));
    // cao độ chuẩn = trung vị độ cao trong khu vẽ
    const bb = bbDraw, inside = [];
    for (let j = 0; j < D.ny; j++) for (let i = 0; i < D.nx; i++) { const x = D.x0 + i * step, y = D.y0 + j * step; if (x >= bb[0] && x <= bb[2] && y >= bb[1] && y <= bb[3]) inside.push(D.h[j * D.nx + i]); }
    if (!inside.length) inside.push(D.h[Math.floor(D.ny / 2) * D.nx + Math.floor(D.nx / 2)]);
    inside.sort((a, b) => a - b); const ref = Math.round(inside[Math.floor(inside.length / 2)] * 10) / 10;
    let hmin = Infinity, hmax = -Infinity; for (const v of D.h) { if (v < hmin) hmin = v; if (v > hmax) hmax = v; }
    checkpoint();
    S.doc.terrain = { ...opt.style, on: true, flat: opt.flat, exag: opt.exag, size: opt.size, area: opt.clip ? 'lasso' : opt.area, x0: D.x0, y0: D.y0, nx: D.nx, ny: D.ny, step, ref, hmin: Math.round(hmin), hmax: Math.round(hmax), zoom: D.z, src: 'aws-terrarium', d: TR.encodeHeights(D.h, ref) };
    if (opt.clip) S.doc.terrain.clip = opt.clip.map((q) => [Math.round(q[0] * 100) / 100, Math.round(q[1] * 100) / 100]);
    changed();
    const wkm = G.fmtNum(((D.nx - 1) * step) / 1000, 2), hkm = G.fmtNum(((D.ny - 1) * step) / 1000, 2);
    if (opt.sat) { // ảnh vệ tinh trùng đúng khung địa hình
      say('Đang tải ảnh vệ tinh cùng vùng…');
      await downloadBaseBox('sat', terrainBox(S.doc.terrain), null, true);
    }
    if (S.mode !== '3d') await setMode('3d'); else schedule3D();
    toast(`Đã tạo địa hình ${wkm} × ${hkm} km · cao độ ${Math.round(hmin)}–${Math.round(hmax)} m${opt.sat ? ' · kèm ảnh vệ tinh cùng vùng' : ''}`, 4500);
    return true;
  } catch (err) { console.error(err); toast('Không tải được địa hình: ' + err.message, 5000); return false; }
}
const terrainBox = (t) => [t.x0, t.y0, t.x0 + (t.nx - 1) * t.step, t.y0 + (t.ny - 1) * t.step];
// Khoanh vùng bằng bút (hoặc ngón tay / chuột) trên mặt bằng 2D: trả về đa giác (toạ độ bản vẽ)
async function pickLasso(done, tip) {
  if (S.mode !== '2d') await setMode('2d');
  const stage = $('#stage'), r0 = stage.getBoundingClientRect();
  const ov = h(`<div class="lasso-ov" style="position:absolute;inset:0;z-index:40;touch-action:none;cursor:crosshair;background:rgba(22,50,92,.06)"><div class="pick-tip" style="position:absolute;left:50%;top:10px;transform:translateX(-50%);background:#16325c;color:#fff;border-radius:10px;padding:8px 14px;font-size:14px;display:flex;gap:10px;align-items:center;white-space:nowrap">${esc(tip || 'Khoanh một vòng quanh vùng cần chọn')}<button class="chip" style="background:#fff;color:#16325c">Huỷ</button></div><svg style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none"><path fill="rgba(37,99,235,.12)" stroke="#2563eb" stroke-width="2.5" stroke-dasharray="8 5" stroke-linejoin="round"/></svg></div>`);
  stage.append(ov);
  const path = ov.querySelector('path'); let P = null, pid = null;
  ov.querySelector('button').onclick = (e) => { e.stopPropagation(); ov.remove(); };
  const draw = () => path.setAttribute('d', P && P.length ? 'M' + P.map((q) => q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join('L') + 'Z' : '');
  ov.addEventListener('pointerdown', (e) => { if (e.target.closest('button') || P) return; pid = e.pointerId; P = [[e.clientX - r0.left, e.clientY - r0.top]]; try { ov.setPointerCapture(e.pointerId); } catch {} draw(); });
  ov.addEventListener('pointermove', (e) => { if (!P || e.pointerId !== pid) return; const q = [e.clientX - r0.left, e.clientY - r0.top], l = P[P.length - 1]; if (Math.hypot(q[0] - l[0], q[1] - l[1]) > 3) { P.push(q); draw(); } });
  const up = (e) => {
    if (!P || e.pointerId !== pid) return;
    const pts = P; P = null; draw();
    const bb = G.bbox(pts);
    if (pts.length < 6 || bb.x1 - bb.x0 < 30 || bb.y1 - bb.y0 < 30) { toast('Vùng khoanh quá nhỏ: khoanh lại một vòng lớn hơn'); return; }
    ov.remove();
    const W = pts.map((q) => S.view.toWorld(q[0], q[1]));
    done(G.rdp(W.concat([W[0]]), 2 / S.view.scale).slice(0, -1));
  };
  ov.addEventListener('pointerup', up); ov.addEventListener('pointercancel', up);
}

// ---------------- Thông báo ----------------
let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), ms);
}
// Lỗi bất ngờ: hiện lên màn hình để người dùng chụp lại báo lỗi
window.addEventListener('error', (e) => { if (e && e.message && !/ResizeObserver|Script error/.test(e.message)) toast('Lỗi: ' + e.message, 8000); });
window.addEventListener('unhandledrejection', (e) => { const r = e && e.reason; toast('Lỗi: ' + (r && r.message ? r.message : r), 8000); });

// Bắt đầu
showHome();
window.QP = { S, M, G, changed, snapItems: () => snapItems(), autoLayAt: (w) => autoLayAt(w), render, renderProps: () => renderProps(), fit: fitView, build3D, setTool, openDrawing, setMode, bigDemoDrawing, async openDoc(d) { await Store.putDrawing(d); await openDrawing(d.id); }, get v3() { return v3; }, get drag() { return drag; }, FA, frameFor: (fc) => frameFor(fc), pickFaceAt: (x, y) => pickFaceAt(v3, x, y), faceLocal: (fc, x, y) => faceLocal(v3, fc, x, y) }; // để kiểm thử
