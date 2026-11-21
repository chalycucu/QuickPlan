// Lưu song song bản vẽ và file xuất lên một thư mục OneDrive (Microsoft Graph, đăng nhập OAuth PKCE kiểu chuyển trang).
// Chạy độc lập với lưu về PC: iPad (IndexedDB) -> PC (khi chung Wi-Fi) và -> OneDrive (khi có mạng).
const K = { cid: 'qp.od.cid', folder: 'qp.od.folder', tok: 'qp.od.tok', pkce: 'qp.od.pkce', paths: 'qp.od.paths', on: 'qp.od.on' };
const AUTH = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const SCOPE = 'Files.ReadWrite offline_access User.Read';
export const DEFAULT_CLIENT_ID = ''; // điền khi đã có đăng ký ứng dụng Azure; người dùng cũng dán được trong hộp OneDrive
const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };
const jget = (k, d) => { try { return JSON.parse(ls.get(k) || '') || d; } catch { return d; } };

export const od = {
  get clientId() { return (ls.get(K.cid) || DEFAULT_CLIENT_ID || '').trim(); },
  set clientId(v) { ls.set(K.cid, (v || '').trim() || null); },
  get folder() { return (ls.get(K.folder) || 'QuickPlan').replace(/^\/+|\/+$/g, '') || 'QuickPlan'; },
  set folder(v) { ls.set(K.folder, (v || '').trim().replace(/^\/+|\/+$/g, '') || null); },
  get enabled() { return ls.get(K.on) === '1' && !!this.clientId; },
  set enabled(v) { ls.set(K.on, v ? '1' : null); },
  get signedIn() { const t = jget(K.tok, null); return !!(t && t.refresh); },
  get account() { const t = jget(K.tok, null); return (t && t.user) || ''; },
  state: 'off', // off | need-login | syncing | ok | offline | error
  msg: '',
  listeners: new Set(),
  set(s, msg = '') { this.state = s; this.msg = msg; this.listeners.forEach((f) => f(s)); },
};
export const redirectUri = () => location.origin + location.pathname.replace(/[^/]*$/, '');
export const supported = () => /^https:/.test(location.protocol) || location.hostname === 'localhost';

// ---------- Đăng nhập (chuyển trang sang Microsoft rồi quay lại) ----------
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function randStr(n = 48) { const a = new Uint8Array(n); crypto.getRandomValues(a); return b64url(a); }
export async function login() {
  if (!od.clientId) throw new Error('Chưa có mã ứng dụng (Client ID)');
  const verifier = randStr(48), state = randStr(16);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  ls.set(K.pkce, JSON.stringify({ verifier, state, back: location.href }));
  const q = new URLSearchParams({ client_id: od.clientId, response_type: 'code', redirect_uri: redirectUri(), response_mode: 'query', scope: SCOPE, state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account' });
  location.href = `${AUTH}/authorize?${q}`;
}
export function logout() { ls.set(K.tok, null); ls.set(K.paths, null); od.set(od.enabled ? 'need-login' : 'off'); }
// Gọi khi trang mở: nếu đang quay về từ Microsoft thì đổi mã lấy token. Trả về true nếu vừa đăng nhập.
export async function handleRedirect() {
  const u = new URL(location.href), code = u.searchParams.get('code'), st = u.searchParams.get('state'), err = u.searchParams.get('error');
  if (!code && !err) return false;
  const p = jget(K.pkce, null);
  if (!p || p.state !== st) return false;
  ls.set(K.pkce, null);
  history.replaceState(null, '', redirectUri());
  if (err) { od.set('error', 'Đăng nhập OneDrive không thành công: ' + (u.searchParams.get('error_description') || err)); return false; }
  const r = await fetch(`${AUTH}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: od.clientId, grant_type: 'authorization_code', code, redirect_uri: redirectUri(), code_verifier: p.verifier, scope: SCOPE }) });
  const j = await r.json();
  if (!r.ok) { od.set('error', 'Đăng nhập OneDrive lỗi: ' + (j.error_description || j.error || r.status)); return false; }
  saveTok(j);
  try { const me = await gfetch('/me?$select=displayName,userPrincipalName'); if (me.ok) { const m = await me.json(); const t = jget(K.tok, {}); t.user = m.userPrincipalName || m.displayName || ''; ls.set(K.tok, JSON.stringify(t)); } } catch {}
  od.enabled = true;
  return true;
}
function saveTok(j) { const old = jget(K.tok, {}); ls.set(K.tok, JSON.stringify({ ...old, access: j.access_token, exp: Date.now() + (j.expires_in - 120) * 1000, refresh: j.refresh_token || old.refresh })); }
async function token() {
  const t = jget(K.tok, null);
  if (!t || !t.refresh) throw Object.assign(new Error('chưa đăng nhập OneDrive'), { login: true });
  if (t.access && t.exp > Date.now()) return t.access;
  const r = await fetch(`${AUTH}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: od.clientId, grant_type: 'refresh_token', refresh_token: t.refresh, scope: SCOPE }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { if (j.error === 'invalid_grant' || r.status === 400) { ls.set(K.tok, JSON.stringify({ user: t.user })); throw Object.assign(new Error('phiên đăng nhập OneDrive đã hết hạn'), { login: true }); } throw new Error('OneDrive token ' + r.status); }
  saveTok(j);
  return j.access_token;
}
async function gfetch(path, opts = {}) {
  const tk = await token();
  return fetch(path.startsWith('http') ? path : GRAPH + path, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + tk } });
}
const enc = (p) => p.split('/').map(encodeURIComponent).join('/');
// Tải một file lên thư mục OneDrive (đường dẫn tương đối trong thư mục QuickPlan); file > 4 MB dùng phiên tải lên
export async function upload(rel, blob) {
  const path = `${od.folder}/${rel}`;
  if (blob.size <= 4 * 1024 * 1024) {
    const r = await gfetch(`/me/drive/root:/${enc(path)}:/content?@microsoft.graph.conflictBehavior=replace`, { method: 'PUT', body: blob });
    if (!r.ok) throw new Error('OneDrive ' + r.status + ' ' + (await r.text()).slice(0, 160));
    return r.json();
  }
  const s = await gfetch(`/me/drive/root:/${enc(path)}:/createUploadSession`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }) });
  if (!s.ok) throw new Error('OneDrive phiên tải ' + s.status);
  const { uploadUrl } = await s.json();
  const CH = 320 * 1024 * 10; let last;
  for (let i = 0; i < blob.size; i += CH) {
    const part = blob.slice(i, Math.min(blob.size, i + CH));
    last = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Range': `bytes ${i}-${i + part.size - 1}/${blob.size}` }, body: part });
    if (!last.ok && last.status !== 202) throw new Error('OneDrive tải phần ' + last.status);
  }
  return last.json().catch(() => ({}));
}
export async function remove(rel) {
  const r = await gfetch(`/me/drive/root:/${enc(od.folder + '/' + rel)}`, { method: 'DELETE' });
  if (!r.ok && r.status !== 404) throw new Error('OneDrive xoá ' + r.status);
}
const safe = (s) => String(s || 'Bản vẽ').replace(/[\\/:*?"<>|#%]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Bản vẽ';
export const drawingPath = (d) => `BanVe/${safe(d.name)} (${String(d.id).slice(-6)}).json`;
export const exportPath = (name) => `XuatFile/${safe(name.replace(/\.[^.]+$/, ''))}${(name.match(/\.[^.]+$/) || [''])[0]}`;

// ---------- Đồng bộ: hàng đợi riêng cho OneDrive ----------
// getDirty(): [{id}]; getDrawing(id); clearDirty(id, updatedAt); nextExport(): {key, name, blob} | null; doneExport(key)
let running = false;
export async function syncNow(io) {
  if (!od.enabled) { od.set('off'); return; }
  if (!od.signedIn) { od.set('need-login'); return; }
  if (running) return; running = true;
  try {
    if (!navigator.onLine) { od.set('offline'); return; }
    od.set('syncing');
    const paths = jget(K.paths, {});
    let n = 0, bad = 0, lastErr = null;
    for (const { id } of await io.getDirty()) {
      try {
      const d = await io.getDrawing(id);
      if (!d) { await io.clearDirty(id, null); continue; }
      if (d.deleted) { if (paths[id]) await remove(paths[id]); delete paths[id]; }
      else {
        const p = drawingPath(d);
        await upload(p, new Blob([JSON.stringify(d)], { type: 'application/json' }));
        if (paths[id] && paths[id] !== p) await remove(paths[id]).catch(() => {}); // đổi tên bản vẽ: bỏ file tên cũ
        paths[id] = p;
      }
      ls.set(K.paths, JSON.stringify(paths));
      await io.clearDirty(id, d.updatedAt); n++;
      } catch (e) { if (e.login || !navigator.onLine) throw e; bad++; lastErr = e; console.warn('OneDrive bản vẽ', id, e); } // một file lỗi không chặn các file khác
    }
    const ex = []; for (let e = await io.nextExport(); e && !ex.includes(e.key); e = await io.nextExport()) { ex.push(e.key); try { await upload(exportPath(e.name), e.blob); await io.doneExport(e.key); n++; } catch (err) { if (err.login || !navigator.onLine) throw err; bad++; lastErr = err; break; } }
    if (bad) od.set('error', `${bad} file chưa lưu được lên OneDrive (${lastErr && lastErr.message}) · sẽ thử lại`);
    else od.set('ok', n ? `Đã lưu ${n} file lên OneDrive` : '');
  } catch (e) {
    console.warn('OneDrive', e);
    if (e.login) od.set('need-login', e.message);
    else od.set(navigator.onLine ? 'error' : 'offline', e.message);
  } finally { running = false; }
}
