// Không gian 3D: dựng khối, 4 chế độ hiển thị, bóng đổ theo vị trí mặt trời.
import { drawIconAt, drawInk, inkSize } from './icons.js';
import * as THREE from '../vendor/three/build/three.module.min.js';
import { OrbitControls } from '../vendor/three/jsm/controls/OrbitControls.js';
import { mergeGeometries } from '../vendor/three/jsm/utils/BufferGeometryUtils.js';
import * as G from './geom.js';
import { booleanPolys } from './zoneops.js';
import { frameOf, edgeNormal } from './faces.js';
import { displayHeights, groundSampler, decodeHeights, elevColor } from './terrain.js';
import { renderScene, View } from './render2d.js';
import { matImage, findMat } from './materials.js';
import { junctionCorners, medianPieces, capsulePolygon } from './roadops.js';
import { LANDUSE, roadTotalWidth, bldElev, bldHeight, landTrees, landTreeSize, LAND_CLOSED, LAND_COLORS, layerOf, layerOrder, facetNormal } from './model.js';

// Thế giới 2D (x Đông, y Nam) -> three (x Đông, y lên, z Nam)
// GZ: độ cao mặt đất theo địa hình thật (null = mặt đất phẳng ở cao độ 0)
let GZ = null;
const v3 = (p, h = 0) => new THREE.Vector3(p[0], h + (GZ ? GZ(p[0], p[1]) : 0), p[1]);
// chia nhỏ đường để bám theo địa hình (không cắt xuyên qua đồi)
const dens = (pts, step = 4) => { if (!GZ || pts.length < 2) return pts; const out = [pts[0]]; for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], n = Math.min(200, Math.ceil(G.dist(a, b) / step)); for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]); } return out; };

// Nét trên mặt khối: kéo nhẹ về phía camera theo tỉ lệ khoảng cách (≈0,4% khoảng cách) nên không bị mặt khối che,
// kể cả khi nhìn xa; mặt khác che phía trước thì vẫn che bình thường.
const _flm = new Map();
function faceLineMat(color) {
  if (_flm.has(color)) return _flm.get(color);
  const m = new THREE.LineBasicMaterial({ color });
  m.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n  gl_Position.z -= 0.008;'); };
  m.customProgramCacheKey = () => 'faceLine';
  _flm.set(color, m); return m;
}

export class View3D {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    // iPad hết bộ nhớ đồ hoạ: WebGL bị thu hồi -> báo và dựng lại khi được trả lại (thay vì màn hình trắng im lặng)
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; if (this.onLost) this.onLost(); });
    this.renderer.domElement.addEventListener('webglcontextrestored', () => { this.lost = false; this._dirty = true; if (this.onRestored) this.onRestored(); });
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#dfe8f0');
    this.camera = new THREE.PerspectiveCamera(45, 1, 1, 20000);
    this.camera.position.set(250, 300, 350);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    // khi xoay / thu phóng: dời hộp đổ bóng theo chỗ đang nhìn (chỉ khi lệch đáng kể)
    this.controls.addEventListener('change', () => {
      if (!this.sunOn || this._realBusy || !this._shR) return;
      const t = this.controls.target, d = this.camera.position.distanceTo(t), want = Math.max(60, d * 1.3);
      if (Math.hypot(t.x - this._shC[0], t.z - this._shC[1]) > this._shR * 0.35 || want < this._shR * 0.6 || (want > this._shR * 1.6 && this._shR < (this.bounds ? this.bounds.size * 1.2 : 1e9))) this.updateSunShadowBox();
    });
    this.controls.enableDamping = false; // dừng ngay khi thả tay, không trôi quán tính
    this.controls.maxPolarAngle = Math.PI * 0.495;
    // 1 ngón xoay, 2 ngón kéo + chụm thu phóng (đúng đề cương)
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    // chuột trái dành cho vẽ khi đang dùng cọ; chuột phải xoay, chuột giữa kéo
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    this.overlay = document.createElement('canvas');
    Object.assign(this.overlay.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' });
    container.appendChild(this.overlay);
    this.ray = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0xb9c4cf, 0.9);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 1.2;
    this.scene.add(this.sun, this.sun.target);
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.mode = 'solid';
    this.sunOn = true;
    this.buildings = [];
    this.running = false;
    new ResizeObserver(() => this.resize()).observe(container);
  }

  resize() {
    if (window.ResizeObserver && !this._ro) { this._ro = new ResizeObserver(() => { if (this.running) this.resize(); }); this._ro.observe(this.container); }
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px'; this.renderer.domElement.style.height = h + 'px';
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this._dirty = true;
  }
  // QP-24: chẩn đoán khi 3D trống (iPad): kích thước, camera, số lệnh vẽ, WebGL
  diag() {
    const gl = this.renderer.getContext(), c = this.renderer.domElement, cam = this.camera.position, t = this.controls.target, inf = this.renderer.info.render;
    let meshes = 0; this.scene.traverse((o) => { if (o.isMesh || o.isLine || o.isLineSegments) meshes++; });
    let gpu = ''; try { const ext = gl.getExtension('WEBGL_debug_renderer_info'); gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); } catch {}
    return { box: [this.container.clientWidth, this.container.clientHeight], canvas: [c.width, c.height], buf: [gl.drawingBufferWidth, gl.drawingBufferHeight], lost: gl.isContextLost(), flagLost: !!this.lost, running: !!this.running,
      cam: [cam.x, cam.y, cam.z].map((v) => Math.round(v)), target: [t.x, t.y, t.z].map((v) => Math.round(v)), near: +this.camera.near.toFixed(2), far: Math.round(this.camera.far), aspect: +this.camera.aspect.toFixed(3),
      bounds: this.bounds && [this.bounds.cx, this.bounds.cy, this.bounds.size].map((v) => Math.round(v)), objects: meshes, calls: inf.calls, tris: inf.triangles, gpu, maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE) };
  }
  // camera hỏng (NaN / vô cực) thì nhìn lại toàn cảnh, thay vì chỉ thấy màu nền
  _camOk() { const p = this.camera.position, t = this.controls.target; return [p.x, p.y, p.z, t.x, t.y, t.z, this.camera.near, this.camera.far, this.camera.aspect].every(Number.isFinite); }

  start() {
    if (this.running) return;
    this.running = true; this.resize();
    // vẽ lại đủ nhịp khi đang thao tác / camera đang chuyển động; đứng yên > 1,2 s thì chỉ vẽ ~4 hình/giây
    // (cảnh nặng không bắt iPad vẽ liên tục 60 hình/giây khi không ai chạm, máy mát và không bị treo)
    if (!this._actBound) {
      this._actBound = true; this._act = performance.now();
      const mark = () => { this._act = performance.now(); };
      for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'keydown', 'input', 'change', 'click']) document.addEventListener(ev, mark, { capture: true, passive: true });
    }
    let lastKey = '', lastDraw = 0;
    const loop = (ts = performance.now()) => {
      if (!this.running) return;
      this.controls.update(); this.fitClip();
      if (!this._camOk()) { this.bounds = this.bounds && [this.bounds.cx, this.bounds.cy, this.bounds.size].every(Number.isFinite) ? this.bounds : null; this.frame(); this.resize(); if (!Number.isFinite(this.camera.aspect)) { this.camera.aspect = 1; this.camera.updateProjectionMatrix(); } this._dirty = true; this.camFix = (this.camFix || 0) + 1; }
      const c = this.camera, t = this.controls.target, key = c.position.x.toFixed(3) + ',' + c.position.y.toFixed(3) + ',' + c.position.z.toFixed(3) + ',' + t.x.toFixed(3) + ',' + t.z.toFixed(3) + ',' + c.fov;
      if (key !== lastKey) { lastKey = key; this._act = ts; }
      if (!this.lost && (this._dirty || ts - this._act < 1200 || ts - lastDraw > 250)) { this._dirty = false; lastDraw = ts; this.renderer.render(this.scene, this.camera); }
      if (this.onFrame) this.onFrame();
      requestAnimationFrame(loop);
    };
    loop();
  }
  stop() { this.running = false; }
  // mặt phẳng cắt gần/xa theo khoảng cách nhìn: giữ độ chính xác chiều sâu cao nhất, tránh chớp giữa các lớp mặt phẳng
  fitClip() {
    const d = this.camera.position.distanceTo(this.controls.target), size = (this.bounds || { size: 300 }).size;
    const near = Math.min(Math.max(0.3, d / 150), 50), far = Math.max(d * 6, size * 6) + d;
    const c = this.camera;
    if (Math.abs(c.near - near) / near > 0.15 || Math.abs(c.far - far) / far > 0.15) { c.near = near; c.far = far; c.updateProjectionMatrix(); }
  }

  _ndc(cx, cy) { const r = this.renderer.domElement.getBoundingClientRect(); return new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1); }
  // Điểm trên mặt đất dưới con trỏ -> toạ độ bản vẽ [x, y]
  groundAt(cx, cy) {
    this.ray.setFromCamera(this._ndc(cx, cy), this.camera);
    if (GZ && this.terrainMesh) { const hit = this.ray.intersectObject(this.terrainMesh, false)[0]; if (hit) return this._tooFar(hit.point) ? null : [hit.point.x, hit.point.z]; } // vẽ trên mặt địa hình
    const p = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(this.plane, p) || this._tooFar(p)) return null;
    return [p.x, p.z];
  }
  // chạm sát đường chân trời: tia cắt mặt đất ở rất xa (hàng trăm km) → bỏ, tránh tạo đường dài vô lý
  _tooFar(p) {
    const t = this.controls.target, cam = this.camera.position;
    const lim = Math.max(400, 5 * cam.distanceTo(t));
    return Math.hypot(p.x - t.x, p.z - t.z) > lim;
  }
  planeAt(cx, cy, h) {
    this.ray.setFromCamera(this._ndc(cx, cy), this.camera);
    const p = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -h), p) || this._tooFar(p)) return null;
    return [p.x, p.z];
  }
  // mọi công trình / mảng dưới con trỏ, từ gần đến xa
  pickAll(cx, cy) {
    this.ray.setFromCamera(this._ndc(cx, cy), this.camera);
    const out = [];
    for (const hit of this.ray.intersectObjects(this.buildings, false)) {
      const u = hit.object.userData; let id = u.id;
      if (!id && u.starts) { const vi = hit.face ? hit.face.a : hit.faceIndex * 3; let lo = 0, hi = u.starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (u.starts[mid] <= vi) lo = mid; else hi = mid - 1; } id = u.ids[lo]; }
      if (id && !out.includes(id)) out.push(id);
    }
    return out;
  }
  pickBuilding(cx, cy) {
    this.ray.setFromCamera(this._ndc(cx, cy), this.camera);
    const hit = this.ray.intersectObjects(this.buildings, false)[0];
    if (!hit) return null;
    const u = hit.object.userData;
    if (u.id) return u.id;
    // lưới gộp: tìm công trình theo chỉ số đỉnh của tam giác trúng
    const vi = hit.face ? hit.face.a : hit.faceIndex * 3;
    let lo = 0, hi = u.starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (u.starts[mid] <= vi) lo = mid; else hi = mid - 1; }
    return u.ids[lo];
  }
  // Trúng khối / mảng nào, tại điểm nào (để chọn mặt khối)
  pickFace(cx, cy) {
    this.ray.setFromCamera(this._ndc(cx, cy), this.camera);
    const hit = this.ray.intersectObjects(this.buildings, false)[0];
    if (!hit) return null;
    const id = this.pickBuilding(cx, cy);
    let ny = 0, nv = [0, 1, 0];
    if (hit.face) { const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld); ny = n.y; nv = [n.x, n.y, n.z]; }
    return { id, point: [hit.point.x, hit.point.y, hit.point.z], ny, n: nv };
  }
  // Giao tia với mặt phẳng (pháp tuyến n, qua điểm p) -> [x, y(cao), z]
  rayPlane(cx, cy, n, p) {
    this.ray.setFromCamera(this._ndc(cx, cy), this.camera);
    const nn = new THREE.Vector3(n[0], n[1], n[2]).normalize();
    const pl = new THREE.Plane().setFromNormalAndCoplanarPoint(nn, new THREE.Vector3(p[0], p[1], p[2]));
    const o = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(pl, o)) return null;
    return [o.x, o.y, o.z];
  }
  toScreen(w, hgt = 0) {
    const v = new THREE.Vector3(w[0], hgt, w[1]).project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return [((v.x + 1) / 2) * r.width, ((1 - v.y) / 2) * r.height];
  }
  // như toScreen, kèm cờ «ở trước camera» (để bỏ nhãn nằm sau lưng)
  toScreenZ(w, hgt = 0) {
    const v = new THREE.Vector3(w[0], hgt, w[1]).project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return [((v.x + 1) / 2) * r.width, ((1 - v.y) / 2) * r.height, v.z < 1 && v.z > -1];
  }
  // độ cao mặt đất (địa hình thật) tại điểm w; 0 khi mặt đất phẳng
  gy(w) { return GZ ? GZ(w[0], w[1]) : 0; }
  pxPerMeter(w, h = 0) {
    const g0 = h > 0.01 ? 0 : this.gy(w);
    const a = this.toScreen(w, h + g0), b = this.toScreen([w[0] + 1, w[1]], h + g0), c = this.toScreen([w[0], w[1] + 1], h + g0), d = this.toScreen(w, h + g0 + 1);
    if (h > 0.01) return Math.max(0.01, Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]), Math.hypot(c[0] - a[0], c[1] - a[1]), Math.hypot(d[0] - a[0], d[1] - a[1])));
    return Math.max(0.01, (Math.hypot(b[0] - a[0], b[1] - a[1]) + Math.hypot(c[0] - a[0], c[1] - a[1])) / 2);
  }

  build(doc, metrics, selectedId, images = {}, real = false) {
    const isSel = (id) => (selectedId instanceof Set ? selectedId.has(id) : id === selectedId);
    const g = this.group;
    for (const c of [...g.children]) { g.remove(c); c.traverse((o) => { o.geometry && !o.userData.keepGeo && o.geometry.dispose(); o.material && [].concat(o.material).forEach((m) => { if (m.map && (o.userData.keepTex || o.userData.keepMap)) m.map = null; m.dispose(); }); }); }
    this.buildings = [];
    const lay = Object.fromEntries(doc.layers.map((l) => [l.id, l]));
    const alerts = (metrics && metrics.alerts) || {};
    const mode = this.mode;
    const vis = (id) => (!real || (id !== 4 && id !== 5)) && lay[id] && lay[id].visible && lay[id].opacity > 0; // ảnh phối cảnh: bỏ sơ đồ phân tích, nét nháp
    const okP = (P) => P && P.length && P.every((q) => Number.isFinite(q[0]) && Number.isFinite(q[1]));
    this.badItems = doc.items.filter((i) => i.pts && i.pts.length && !okP(i.pts)).length;
    if (this.badItems) doc = { ...doc, items: doc.items.filter((i) => !i.pts || !i.pts.length || okP(i.pts)) }; // đối tượng có toạ độ hỏng: không dựng (tránh 3D trống)
    let bb = G.robustBBox(doc.items.map((i) => (i.kind === 'circle' ? null : i.pts)));
    if (!bb || ![bb.x0, bb.y0, bb.x1, bb.y1].every(Number.isFinite)) bb = { x0: -200, y0: -200, x1: 200, y1: 200 };
    const cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2;
    const size = Math.max(200, bb.x1 - bb.x0, bb.y1 - bb.y0);
    this.bounds = { cx, cy, size };
    // «Khóa khối»: chỉ dựng lại khối đang khóa (và đối tượng thuộc khối); khối khác gộp một lần thành bóng mờ, không dựng lại khi sửa
    if (this.isoFn && !real) { this.syncGhost(doc); doc = { ...doc, items: doc.items.filter((i) => this.isoFn(i)) }; } else this.dropGhost();

    const mat = (color, opts = {}) => {
      const { xrayOpacity, ...rest } = opts;
      const m = new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, side: THREE.DoubleSide, ...rest });
      if (mode === 'xray') { m.transparent = true; m.opacity = xrayOpacity ?? 0.22; m.depthWrite = false; }
      return m;
    };
    const showFaces = mode !== 'wire';
    const showEdges = mode !== 'solid';
    const edgeCol = mode === 'wire' ? 0x1d2a3a : 0x2b3a4a;
    const addEdges = (geo, parent, col = edgeCol) => {
      if (!showEdges) return;
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), new THREE.LineBasicMaterial({ color: col, transparent: mode === 'xray', opacity: mode === 'xray' ? 0.8 : 1 }));
      e.position.copy(parent.position); e.rotation.copy(parent.rotation); g.add(e);
    };
    // Gộp hình học cùng màu/độ cao thành một lưới (bản vẽ lớn: hàng nghìn đối tượng -> vài chục lệnh vẽ)
    GZ = groundSampler(doc); this.terrainMesh = null;
    const drape = !!GZ; // địa hình thật: ô đất, đường, cảnh quan, ảnh nền phủ lên mặt địa hình bằng ảnh
    const flatBuckets = new Map();
    // y = cao độ theo thứ tự lớp; mỗi bậc còn được đẩy lên bằng polygonOffset để không chớp (z-fighting) khi xoay, nhìn xa
    const flat = (pts, holes, y, color, layerOpacity = 1) => {
      if (pts.length < 3 || drape) return;
      const geo = new THREE.ShapeGeometry(toShape(pts, holes));
      geo.rotateX(Math.PI / 2); // (x, y) -> (x, 0, y)
      geo.translate(0, y, 0);
      const level = Math.max(0, Math.round((y - 0.05) / 0.03));
      const k = color + '|' + layerOpacity + '|' + level;
      let a = flatBuckets.get(k); if (!a) flatBuckets.set(k, (a = { color, layerOpacity, level, geos: [] }));
      a.geos.push(geo.index ? geo : geo);
    };
    const flushFlat = () => {
      for (const { color, layerOpacity, level, geos } of flatBuckets.values()) {
        const geo = mergeAll(geos); if (!geo) continue;
        const m = mat(color, { xrayOpacity: 0.35 * layerOpacity, polygonOffset: true, polygonOffsetFactor: -1 - level * 0.5, polygonOffsetUnits: -4 - level * 4 });
        if (layerOpacity < 1 && mode !== 'xray') { m.transparent = true; m.opacity = layerOpacity; }
        const mesh = new THREE.Mesh(geo, m); mesh.receiveShadow = true;
        if (showFaces) g.add(mesh);
        if (mode === 'wire') addEdges(geo, mesh, 0x8a99a8);
      }
    };

    // mặt đất
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(size * (real ? 14 : 4), size * (real ? 14 : 4)), mat(real ? '#c9cdbf' : '#f2efe8', { xrayOpacity: 0.5 }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(cx, 0, cy); ground.receiveShadow = true;
    // địa hình (DEM): lưới độ cao quanh khu vẽ; mặt đất phẳng hạ xuống dưới điểm thấp nhất
    const T = doc.terrain && doc.terrain.on !== false && doc.terrain.d ? doc.terrain : null;
    const TH = T && displayHeights(doc);
    if (TH) {
      let hmin = Infinity; for (const v of TH) if (v < hmin) hmin = v;
      ground.position.y = Math.min(0, hmin) - 0.6;
      const { nx, ny, step, x0, y0 } = T, pos = new Float32Array(nx * ny * 3), uv = new Float32Array(nx * ny * 2);
      const W0 = (nx - 1) * step, H0 = (ny - 1) * step;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const k = j * nx + i; pos[k * 3] = x0 + i * step; pos[k * 3 + 1] = TH[k] - 0.02; pos[k * 3 + 2] = y0 + j * step; uv[k * 2] = (i * step) / W0; uv[k * 2 + 1] = (j * step) / H0; }
      // vùng khoanh bằng bút: chỉ giữ các ô lưới có tâm nằm trong vùng
      const cellIn = T.clip && T.clip.length > 2 ? new Uint8Array((nx - 1) * (ny - 1)) : null;
      if (cellIn) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) cellIn[j * (nx - 1) + i] = G.pointInPolygon([x0 + (i + 0.5) * step, y0 + (j + 0.5) * step], T.clip) ? 1 : 0;
      let idx = new Uint32Array((nx - 1) * (ny - 1) * 6), q = 0;
      for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) { if (cellIn && !cellIn[j * (nx - 1) + i]) continue; const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1; idx.set([a, c, b, b, c, d], q); q += 6; }
      if (q < idx.length) idx = idx.slice(0, q);
      const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); tg.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); tg.setIndex(new THREE.BufferAttribute(idx, 1)); tg.computeVertexNormals();
      const elevCol = T.cmode === 'elev';
      if (elevCol) { // tô màu theo cao độ thật (thấp xanh lá → vàng → nâu → trắng; dưới 0 m: xanh nước)
        const hr = decodeHeights(T), col = new Float32Array(nx * ny * 3), c = new THREE.Color();
        for (let k = 0; k < nx * ny; k++) { elevColor(hr[k] + (T.ref || 0), T.hmin, T.hmax, c); col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b; }
        tg.setAttribute('color', new THREE.BufferAttribute(col, 3));
      }
      const tm = new THREE.Mesh(tg, mat(elevCol ? '#ffffff' : T.color || (real ? '#c9cdbf' : '#e9e4d6'), { xrayOpacity: 0.5, roughness: 0.95, vertexColors: elevCol }));
      tm.receiveShadow = true; tm.castShadow = false; tm.userData.terrain = true; this.terrainMesh = tm;
      this.farMin = Math.max(nx, ny) * step * 4;
      if (drape) { // phủ mặt bằng 2D (ô đất, đường, cảnh quan, ảnh nền, chỉ giới) lên địa hình
        const kinds = new Set(['zone', 'road', 'land', 'park', 'water', 'cover']);
        const fl = doc.items.filter((i) => kinds.has(i.kind));
        const bbP = fl.flatMap((i) => (i.kind === 'road' ? G.bandPolygon(i.pts, roadTotalWidth(i) / 2) : i.pts));
        if (doc.base && vis(8)) bbP.push([doc.base.x, doc.base.y], [doc.base.x + doc.base.w, doc.base.y + doc.base.h]);
        if (bbP.length) {
          const B = G.bbox(bbP), m = 6, X0 = B.x0 - m, Y0 = B.y0 - m, Wd = B.x1 - B.x0 + 2 * m, Hd = B.y1 - B.y0 + 2 * m;
          const sc = Math.min(8, 3584 / Wd, 3584 / Hd), cw = Math.max(2, Math.round(Wd * sc)), ch = Math.max(2, Math.round(Hd * sc));
          const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
          const vw = new View(); vw.cx = X0 + Wd / 2; vw.cy = Y0 + Hd / 2; vw.scale = sc; vw.w = cw; vw.h = ch;
          renderScene(cv.getContext('2d'), { ...doc, items: fl }, vw, { metrics, images });
          const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 4;
          let st = Math.max(1.5, Math.min(step / 2, Math.max(Wd, Hd) / 300));
          while ((Math.ceil(Wd / st) + 1) * (Math.ceil(Hd / st) + 1) > 260000) st *= 1.2; // giới hạn ~26 vạn điểm: iPad không cạn bộ nhớ đồ hoạ
          const mx = Math.ceil(Wd / st) + 1, my = Math.ceil(Hd / st) + 1;
          const dp = new Float32Array(mx * my * 3), du = new Float32Array(mx * my * 2);
          for (let j = 0; j < my; j++) for (let i = 0; i < mx; i++) { const k = j * mx + i, x = X0 + Math.min(Wd, i * st), y = Y0 + Math.min(Hd, j * st); dp[k * 3] = x; dp[k * 3 + 1] = GZ(x, y) + 0.12; dp[k * 3 + 2] = y; du[k * 2] = (x - X0) / Wd; du[k * 2 + 1] = 1 - (y - Y0) / Hd; }
          const di = new Uint32Array((mx - 1) * (my - 1) * 6); let r = 0;
          for (let j = 0; j < my - 1; j++) for (let i = 0; i < mx - 1; i++) { const a = j * mx + i, b2 = a + 1, c2 = a + mx, d2 = c2 + 1; di.set([a, c2, b2, b2, c2, d2], r); r += 6; }
          const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(dp, 3)); dg.setAttribute('uv', new THREE.BufferAttribute(du, 2)); dg.setIndex(new THREE.BufferAttribute(di, 1)); dg.computeVertexNormals();
          const dm = new THREE.MeshLambertMaterial({ map: tx, transparent: true, alphaTest: 0.02, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
          const dmesh = new THREE.Mesh(dg, dm); dmesh.receiveShadow = true; if (showFaces) g.add(dmesh);
        }
      } // không đổ bóng: tránh vằn bóng trên ô đất nằm sát mặt địa hình
      if (showFaces) g.add(tm);
      if (!real && T.contours !== false) { // đường đồng mức mảnh (mỗi 5 m, đậm mỗi 25 m) để dễ đọc địa hình
        const ex = T.exag || 1, iv = Math.max(1, (T.ci || 5)) * ex, seg = [], segB = [];
        const P = (k) => [pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]];
        for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
          if (cellIn && !cellIn[j * (nx - 1) + i]) continue;
          const ks = [j * nx + i, j * nx + i + 1, (j + 1) * nx + i + 1, (j + 1) * nx + i];
          const hs = ks.map((k) => TH[k]); const lo = Math.min(...hs), hi = Math.max(...hs);
          if (hi - lo < 1e-3) continue;
          for (let L = Math.ceil(lo / iv) * iv; L <= hi; L += iv) {
            if (Math.abs(L) < 1e-6 && hi - lo < 0.05) continue;
            const pts = [];
            for (let e = 0; e < 4; e++) { const a = hs[e], b = hs[(e + 1) % 4]; if ((a - L) * (b - L) < 0) { const t = (L - a) / (b - a), A = P(ks[e]), B = P(ks[(e + 1) % 4]); pts.push(A[0] + (B[0] - A[0]) * t, L + 0.05, A[2] + (B[2] - A[2]) * t); } }
            const big = Math.abs(Math.round(L / iv)) % 5 === 0;
            if (pts.length >= 6) (big ? segB : seg).push(...pts.slice(0, 6));
          }
        }
        for (const [arr, col] of [[seg, '#b6a98a'], [segB, '#8c7c5c']]) if (arr.length) { const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); g.add(new THREE.LineSegments(bg, new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: real ? 0.45 : 0.8 }))); }
      }
    }
    if (showFaces) g.add(ground);
    if (mode !== 'solid') {
      const grid = new THREE.GridHelper(size * 4, Math.round(size * 4 / 20), 0xb7c2cc, 0xd6dde3);
      grid.position.set(cx, 0.05, cy); g.add(grid);
    }

    const iv = (it) => vis(layerOf(it)), op = (it) => lay[layerOf(it)].opacity;
    const rank = new Map(layerOrder(doc).map((id, i) => [id, i]));
    // mặt phẳng theo thứ tự lớp: lớp trên nằm cao hơn; mỗi lớp 6 bậc, mỗi bậc 3 cm, mỗi loại mặt một bậc riêng để không chồng trùng
    const Y = (it, k = 0) => 0.05 + 0.03 * ((rank.get(layerOf(it)) || 0) * 6 + k); // k: bậc trong lớp (0..5)
    // ảnh nền
    const bimg = images.baseProc || images.base;
    if (vis(8) && doc.base && bimg && mode !== 'wire' && !drape) {
      if (!this._tex || this._texSrc !== bimg || this._texVer !== images.baseVer) {
        this._tex && this._tex.dispose();
        this._tex = bimg instanceof HTMLCanvasElement ? new THREE.CanvasTexture(bimg) : new THREE.Texture(bimg);
        this._tex.needsUpdate = true; this._tex.colorSpace = THREE.SRGBColorSpace;
        this._texSrc = bimg; this._texVer = images.baseVer;
      }
      const bb = doc.base;
      const op = (bb.opacity ?? 1) * (lay[8] || lay[0]).opacity;
      const pm = new THREE.MeshLambertMaterial({ map: this._tex, transparent: op < 1 || mode === 'xray', opacity: mode === 'xray' ? op * 0.5 : op, depthWrite: !(op < 1 || mode === 'xray'), polygonOffset: true, polygonOffsetFactor: -0.5, polygonOffsetUnits: -2 });
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(bb.w, bb.h), pm);
      pl.rotation.x = -Math.PI / 2; pl.position.set(bb.x + bb.w / 2, 0.03 + 0.18 * (rank.get(8) || 0), bb.y + bb.h / 2);
      pl.receiveShadow = true; pl.userData.keepTex = true;
      g.add(pl);
    }
    // chỉ giới xây dựng
    if (doc.settings.showBuildLine !== false && !drape) {
      const seg = [];
      for (const z of doc.items.filter((i) => i.kind === 'zone' && i.props.setback > 0 && iv(i))) {
        const inner = G.offsetPolygon(z.pts, -z.props.setback);
        for (let i = 0; i < inner.length; i++) { const a = inner[i], b = inner[(i + 1) % inner.length]; seg.push(a[0], 0.45, a[1], b[0], 0.45, b[1]); }
      }
      if (seg.length) {
        const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
        const ln = new THREE.LineSegments(bg, new THREE.LineDashedMaterial({ color: 0xd0312d, dashSize: 4, gapSize: 2 }));
        ln.computeLineDistances(); g.add(ln);
      }
    }
    // nét nháp
    for (const it of doc.items.filter((i) => i.kind === 'sketch' && iv(i))) {
      const pts = dens(it.pts).map((p) => v3(p, 0.8));
      if (pts.length > 1) g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: it.props.color || '#111827' })));
    }
    for (const z of doc.items.filter((i) => i.kind === 'zone' && iv(i))) flat(z.pts, z.holes || [], Y(z), (LANDUSE[z.props.code] || LANDUSE.ODT).color, op(z));
    // vật liệu phủ: mẫu vật liệu lặp theo tỉ lệ (toạ độ UV = mét), chưa có ảnh thì tô màu đại diện
    for (const c of doc.items.filter((i) => i.kind === 'cover' && iv(i))) {
      const m = c.props.mat ? findMat(doc, c.props.mat) : null;
      const img = m && !drape && mode !== 'wire' ? matImage(doc, c.props.mat, () => this.onAsset && this.onAsset()) : null;
      const yy = Y(c, 1);
      if (!img) { flat(c.pts, c.holes || [], yy, (m && m.color) || c.props.color || '#d9cdb4', op(c)); continue; }
      const sc = c.props.scale || m.scale || 1, key = c.props.mat + '|' + sc + '|' + (c.props.ang || 0);
      let tex = matTex.get(key);
      if (!tex) {
        tex = img instanceof HTMLCanvasElement ? new THREE.CanvasTexture(img) : new THREE.Texture(img);
        tex.needsUpdate = true; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
        const asp = img.width / Math.max(1, img.height); tex.repeat.set(1 / (sc * Math.max(1, asp)), 1 / (sc * Math.max(1, 1 / asp)));
        tex.rotation = ((c.props.ang || 0) * Math.PI) / 180;
        if (matTex.size > 60) matTex.clear();
        matTex.set(key, tex);
      }
      const geo = new THREE.ShapeGeometry(toShape(c.pts, c.holes || [])); geo.rotateX(Math.PI / 2); geo.translate(0, yy, 0);
      const mt = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -10 });
      if (mode === 'xray') { mt.transparent = true; mt.opacity = 0.35; mt.depthWrite = false; } else if (op(c) < 1) { mt.transparent = true; mt.opacity = op(c); }
      const mesh = new THREE.Mesh(geo, mt); mesh.receiveShadow = true; mesh.userData.keepMap = true; g.add(mesh);
    }
    const treePos = [];
    for (const it of doc.items.filter((i) => i.kind === 'land' && iv(i))) {
      const st = it.props.style;
      if (LAND_CLOSED[st]) flat(it.pts, [], Y(it, { plaza: 0, lawn: 1, flower: 2, grove: 3 }[st] ?? 1), LAND_COLORS[st], op(it));
      if (!LAND_CLOSED[st] || st === 'grove') { const ty = it.props.tree || 'round'; for (const q of landTrees(it, Math.max(0, 30000 - treePos.length))) treePos.push([q[0], q[1], landTreeSize(it, q) / 5.6, ty]); }
    }
    for (const p of doc.items.filter((i) => i.kind === 'park' && iv(i))) {
      flat(p.pts, [], Y(p, 4), '#8fd17a', op(p));
      treePos.push(...treePositions(p.pts, Math.max(0, 30000 - treePos.length)));
    }
    addTrees(g, treePos, mode, doc, () => this.onAsset && this.onAsset());
    for (const w of doc.items.filter((i) => i.kind === 'water' && iv(i))) {
      const poly = w.props.mode === 'river' ? G.bandPolygon(w.pts, w.props.width / 2) : w.pts;
      flat(poly, [], Y(w), '#6fb7e3', op(w));
    }
    for (const r of doc.items.filter((i) => i.kind === 'road' && iv(i))) {
      if (r.props.ped) { flat(G.bandPolygon(r.pts, r.props.width / 2), [], Y(r, 2), '#e8d9b5', op(r)); continue; }
      flat(G.bandPolygon(r.pts, roadTotalWidth(r) / 2), [], Y(r, 1), '#e3ded3', op(r));
      flat(G.bandPolygon(r.pts, r.props.width / 2), [], Y(r, 3), '#5b636d', op(r));
      if (r.props.median > 0) for (const pc of medianPieces(doc, r)) flat(capsulePolygon(pc.pts, pc.half), [], Y(r, 6), '#7cc46a', op(r)); // dải phân cách giữa
    }
    for (const j of doc.items.filter((i) => i.kind === 'junction' && iv(i))) { // giao lộ: góc vát vỉa hè, bo lòng đường
      for (const c of junctionCorners(doc, j)) {
        if (c.chamfer) flat(c.chamfer, [], Y(j, 2), '#e3ded3', op(j));
        if (c.fillet) flat(c.fillet, [], Y(j, 4), '#5b636d', op(j));
      }
    }
    flushFlat();
    const violLab = []; // Kiểm tra chỉ tiêu: nhãn vi phạm trên công trình
    {
      // công trình gộp theo màu; công trình đang chọn để riêng để tô nổi
      const byId = new Map(doc.items.map((i) => [i.id, i]));
      const zoneOf = metrics && metrics.zoneOf ? (b) => metrics.zoneOf[b.id] : (b) => doc.items.find((i) => i.kind === 'zone' && G.pointInPolygon(G.centroid(b.pts), i.pts));
      const buckets = new Map(), edgeGeos = [], floorSeg = [];
      // mảng kéo âm theo khối và theo mặt: Map(id khối -> Map(mặt -> [mảng]))
      const negFacets = negFacetMap(doc, iv);
      for (const b of doc.items) {
        if (b.kind !== 'building' || b.pts.length < 3 || !iv(b)) continue;
        if (this.isoFn && !this.isoFn(b) && !real) { // «Chỉnh riêng khối»: khối khác hiện mờ, không chọn được
          const H0 = bldHeight(b), gy = new THREE.ExtrudeGeometry(toShape(b.pts, b.holes), { depth: H0, bevelEnabled: false }); gy.rotateX(Math.PI / 2); gy.translate(0, H0 + bldElev(b, byId), 0);
          g.add(new THREE.Mesh(gy, new THREE.MeshBasicMaterial({ color: '#cbd5e1', transparent: true, opacity: 0.18, depthWrite: false })));
          continue;
        }
        const floors = b.props.floors || 1, fh = b.props.floorH || 3.3;
        const H = floors * fh, y0 = bldElev(b, byId);
        const z = zoneOf(b);
        let color = b.props.color || (doc.settings.bldColorByUse && z ? lighten((LANDUSE[z.props.code] || LANDUSE.ODT).color, 0.45) : '#f7f7f5');
        const vio = this.checkMode && !real && metrics && metrics.viol ? metrics.viol[b.id] : null;
        if (this.checkMode && !real) { if (vio) { color = '#ef4444'; violLab.push({ b, y: y0 + H, lines: vio }); } }
        else if (alerts[b.id] === 'over' && !b.props.color && !real) color = '#f08a8a';
        let geo;
        if (negFacets.has(b.id)) geo = cutPrismGeo(byId, b, negFacets.get(b.id)); // có mảng kéo âm: dựng khối có khoét
        else { geo = new THREE.ExtrudeGeometry(toShape(b.pts, b.holes), { depth: H, bevelEnabled: false }); geo.rotateX(Math.PI / 2); geo.translate(0, H + y0, 0); } // đùn lên theo trục Y
        if (real) { // phối cảnh: mặt đứng có cửa sổ theo tầng, mái riêng
          let k = buckets.get(color + '|' + fh); if (!k) buckets.set(color + '|' + fh, (k = { geos: [], roofs: [], ids: [], starts: [], n: 0, color, fh, y0 }));
          k.geos.push(groupPart(geo, 1)); k.roofs.push(groupPart(geo, 0)); continue;
        }
        if (isSel(b.id)) { // đang chọn: giữ màu công trình, ánh xanh nhẹ + viền xanh
          const m = mat(color, { roughness: 0.75, emissive: new THREE.Color('#2563eb'), emissiveIntensity: 0.22 });
          { const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), new THREE.LineBasicMaterial({ color: 0x2563eb })); g.add(e); }
          const mesh = new THREE.Mesh(geo, m); mesh.castShadow = mode !== 'xray'; mesh.receiveShadow = true;
          mesh.userData = { id: b.id, floors }; this.buildings.push(mesh);
          if (showFaces) g.add(mesh); else { mesh.visible = false; g.add(mesh); }
          addEdges(geo, mesh);
        } else {
          let k = buckets.get(color); if (!k) buckets.set(color, (k = { geos: [], ids: [], starts: [], n: 0 }));
          k.ids.push(b.id); k.starts.push(k.n); k.n += geo.attributes.position.count; k.geos.push(geo);
          if (showEdges) edgeGeos.push(new THREE.EdgesGeometry(geo, 25));
        }
        if (mode === 'iso') for (let i = 1; i < floors; i++) for (let j = 0; j < b.pts.length; j++) {
          const p = b.pts[j], q = b.pts[(j + 1) % b.pts.length], hh = y0 + i * fh;
          floorSeg.push(p[0], hh, p[1], q[0], hh, q[1]);
        }
      }
      if (real) {
        const roofGeo = mergeAll([...buckets.values()].flatMap((k) => k.roofs));
        if (roofGeo) { const rm = new THREE.Mesh(roofGeo, new THREE.MeshStandardMaterial({ color: '#b9bec4', roughness: 0.85, side: THREE.DoubleSide })); rm.castShadow = rm.receiveShadow = true; g.add(rm); }
        for (const k of buckets.values()) {
          const geo = mergeAll(k.geos); if (!geo) continue;
          const tex = facadeTexture(k.color); const t = tex.clone(); t.needsUpdate = true; t.repeat.set(1 / 4.2, 1 / k.fh); t.offset.set(0, -1 / k.fh);
          const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: t, roughness: 0.55, metalness: 0.08, side: THREE.DoubleSide, envMapIntensity: 0.9 }));
          mesh.castShadow = mesh.receiveShadow = true; mesh.userData.keepTex = true; g.add(mesh);
        }
        buckets.clear();
      }
      for (const [color, k] of buckets) {
        const geo = mergeAll(k.geos); if (!geo) continue;
        const m = mat(color, { roughness: 0.75 });
        if (lay[6].opacity < 1 && mode !== 'xray') { m.transparent = true; m.opacity = lay[6].opacity; }
        const mesh = new THREE.Mesh(geo, m);
        mesh.castShadow = mode !== 'xray'; mesh.receiveShadow = true;
        mesh.userData = { ids: k.ids, starts: k.starts };
        this.buildings.push(mesh);
        if (showFaces) g.add(mesh); else { mesh.visible = false; g.add(mesh); }
      }
      if (edgeGeos.length) {
        const eg = mergeAll(edgeGeos);
        g.add(new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: edgeCol, transparent: mode === 'xray', opacity: mode === 'xray' ? 0.8 : 1 })));
      }
      if (floorSeg.length) {
        const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(floorSeg, 3));
        g.add(new THREE.LineSegments(bg, new THREE.LineBasicMaterial({ color: 0x8091a3 })));
      }
    }
    for (const L of violLab) {
      const t = violTexture(L.lines), hgt = 0.042 * (0.3 + 0.7 * L.lines.length); // cỡ chữ cố định trên màn hình
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t.t, depthTest: false, transparent: true, sizeAttenuation: false }));
      sp.center.set(0.5, 0); sp.scale.set(hgt * t.a, hgt, 1); { const c = G.centroid(L.b.pts); sp.position.set(c[0], L.y + 1.5, c[1]); } sp.renderOrder = 7; g.add(sp);
    }
    { // mảng mặt khối: chia trên mái / mặt đứng / mặt của mảng khác, mỗi mảng đùn ra hoặc ấn lõm độc lập
      const byId = new Map(doc.items.map((i) => [i.id, i]));
      const negFacets = negFacetMap(doc, iv);
      const edgeG = [];
      for (const f of doc.items) {
        if (f.kind !== 'facet' || !iv(f)) continue;
        if (this.isoFn && !this.isoFn(f) && !real) continue;
        const F0 = frameOf(byId, f.props.parent, f.props.face); if (!F0) continue;
        const poly = f.props.poly, holes = f.props.holes || [];
        if (!poly || poly.length < 3) continue;
        const dd = f.props.depth || 0, d = Math.max(0, dd);
        let geo;
        if (negFacets.has(f.id) && Math.abs(dd) > 0.05) geo = cutPrismGeo(byId, f, negFacets.get(f.id)); // có mảng con kéo âm
        else {
          if (dd < -0.05) geo = recessGeo(poly, dd, F0.base, holes); // kéo âm: hốc lõm vào trong (đáy + thành hốc)
          else if (d > 0.05) geo = new THREE.ExtrudeGeometry(toShape(poly, holes), { depth: d, bevelEnabled: false });
          else { const nh = negFacets.has(f.id) ? [...negFacets.get(f.id).values()].flat().map((c) => c.props.poly) : []; geo = new THREE.ShapeGeometry(toShape(poly, holes.concat(nh))); geo.translate(0, 0, 0.05); }
          geo.applyMatrix4(frameMatrix(F0));
        }
        geo.computeVertexNormals();
        const par = byId.get(f.props.parent);
        let root = par; for (let k = 0; root && root.kind === 'facet' && k < 20; k++) root = byId.get(root.props.parent);
        const sel = isSel(f.id);
        const col = sel ? '#9ec5ff' : f.props.color || (par && par.kind === 'facet' && par.props.color) || (root && root.props.color) || '#f7f7f5';
        const flat = d <= 0.05 && dd >= -0.05;
        const m = new THREE.MeshStandardMaterial({ color: col, roughness: 0.75, side: THREE.DoubleSide, polygonOffset: flat, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
        if (mode === 'xray') { m.transparent = true; m.opacity = 0.35; m.depthWrite = false; }
        const mesh = new THREE.Mesh(geo, m); mesh.castShadow = !flat && mode !== 'xray'; mesh.receiveShadow = true;
        mesh.userData = { id: f.id };
        this.buildings.push(mesh); g.add(mesh);
        edgeG.push(new THREE.EdgesGeometry(geo, 25));
      }
      // nét vẽ trên mặt khối (đoạn thẳng, hình): luôn hiện (cả khi nhìn xa, khi xuất ảnh), đè nhẹ lên mặt khối
      {
        const solid = [], dang = [];
        for (const it of doc.items) {
          if (!it.props || !it.props.sk || !iv(it)) continue;
          for (const k of Object.keys(it.props.sk)) {
            const sk = it.props.sk[k]; if (!sk || !sk._edges || !sk._edges.length) continue;
            const F = frameOf(byId, it.id, k === 'top' ? 'top' : +k); if (!F) continue;
            for (const e of sk._edges) { const A = F.pt(e.a, 0.12), B = F.pt(e.b, 0.12); (e.dang ? dang : solid).push(...A, ...B); }
          }
        }
        for (const [arr, col] of [[solid, '#111827'], [dang, '#3b4a5e']]) if (arr.length) { const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); const ln = new THREE.LineSegments(bg, faceLineMat(col)); ln.renderOrder = 3; g.add(ln); }
      }
      if (edgeG.length) { const eg = mergeAll(edgeG); if (eg) { const ln = new THREE.LineSegments(eg, faceLineMat('#1f2937')); ln.renderOrder = 3; g.add(ln); } }
    }
    for (const it of doc.items) {
      if (!iv(it)) continue;
      if (it.kind === 'flow' && it.props.tour) { // Tour route: dải mảnh sát mặt đất, chấm đầu tuyến, mũi tên cuối tuyến
        const col = it.props.color || '#7c3aed', pts = dens(it.pts).map((p) => v3(p, 0.35));
        g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Math.max(8, pts.length * 3), 0.35, 6), new THREE.MeshBasicMaterial({ color: col })));
        const st = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.3, 20), new THREE.MeshBasicMaterial({ color: col })); st.position.copy(v3(it.pts[0], 0.35)); g.add(st);
        const n = it.pts.length, a = it.pts[Math.max(0, n - 2)], b = it.pts[n - 1];
        const cone = new THREE.Mesh(new THREE.ConeGeometry(1.2, 3, 12), new THREE.MeshBasicMaterial({ color: col })); cone.position.copy(v3(b, 0.6));
        cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(b[0] - a[0], 0, b[1] - a[1]).normalize()); g.add(cone);
        continue;
      }
      if (it.kind === 'arrow' || it.kind === 'flow') {
        const pts = dens(it.pts, 8).map((p) => v3(p, 3));
        const col = it.props.color || (it.kind === 'arrow' ? '#d9381e' : '#1f7a3a');
        const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Math.max(8, pts.length * 2), Math.max(0.4, (it.props.width || (it.kind === 'arrow' ? 8 : 3)) * (it.kind === 'arrow' ? 0.275 : 0.33)), 6);
        const hk = (it.props.width || (it.kind === 'arrow' ? 8 : 3)) / (it.kind === 'arrow' ? 8 : 3);
        g.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: col })));
        const n = it.pts.length, a = it.pts[Math.max(0, n - 2)], b = it.pts[n - 1];
        const cone = new THREE.Mesh(new THREE.ConeGeometry((it.kind === 'arrow' ? 6 : 3.5) * hk, (it.kind === 'arrow' ? 14 : 9) * hk, 12), new THREE.MeshBasicMaterial({ color: col }));
        cone.position.copy(v3(b, 3));
        cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(b[0] - a[0], 0, b[1] - a[1]).normalize());
        g.add(cone);
      } else if (it.kind === 'circle') {
        const ring = new THREE.Mesh(new THREE.RingGeometry(Math.max(0.1, it.props.radius - 0.6 * (it.props.width || 2)), it.props.radius, 96), new THREE.MeshBasicMaterial({ color: it.props.color || '#7b3fe4', side: THREE.DoubleSide }));
        ring.rotation.x = -Math.PI / 2; ring.position.copy(v3(it.pts[0], 2)); g.add(ring);
      } else if (it.kind === 'icon') {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconTexture(it.props.sym, it.props.color), depthTest: false, transparent: true }));
        const sz = it.props.size || 20, el = it.props.elev ?? 4; sp.scale.set(sz, sz, 1); sp.position.copy(v3(it.pts[0], el + sz / 2)); sp.renderOrder = 5; g.add(sp);
        if (el > 0.5) g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([v3(it.pts[0], 0), v3(it.pts[0], el)]), new THREE.LineBasicMaterial({ color: it.props.color || '#475569' }))); // cột chỉ cao độ
        const lt = it.props.showLabel !== false && labelTexture(it);
        if (lt) { const ls = new THREE.Sprite(new THREE.SpriteMaterial({ map: lt.t, depthTest: false, transparent: true })); const lh = sz * 0.42; ls.scale.set(lh * lt.a, lh, 1); ls.position.copy(v3(it.pts[0], el + sz + lh / 2 + 1)); ls.renderOrder = 6; g.add(ls); }
      } else if (it.kind === 'cloud') {
        const pts = it.pts.concat([it.pts[0]]).map((p) => v3(p, 2));
        g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: it.props.color || '#c2410c' })));
      }
    }
    { // nét CAD: gộp tất cả thành một lưới đoạn thẳng (một lần vẽ) cho bản CAD lớn
      const seg = [];
      // trên địa hình: chia nét theo bước lưới địa hình, tổng số điểm có giới hạn (trước chia 4 m -> hàng triệu điểm, iPad trắng màn hình)
      let dstep = 4;
      if (GZ) {
        let L = 0; for (const it of doc.items) if (it.kind === 'cad' && iv(it)) { const P = it.pts; for (let k = 1; k < P.length; k++) L += Math.hypot(P[k][0] - P[k - 1][0], P[k][1] - P[k - 1][1]); }
        dstep = Math.max(4, (T && T.step) || 4, L / 350000);
      }
      for (const it of doc.items) {
        if (it.kind !== 'cad' || !iv(it)) continue;
        const P = dens(it.closed ? it.pts.concat([it.pts[0]]) : it.pts, dstep);
        let prev = v3(P[0], 0.2);
        for (let k = 1; k < P.length; k++) { const q = v3(P[k], 0.2); seg.push(prev.x, prev.y, prev.z, q.x, q.y, q.z); prev = q; }
      }
      if (seg.length) { const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3)); g.add(new THREE.LineSegments(bg, new THREE.LineBasicMaterial({ color: 0x6b7c8f }))); }
    }
    this.updateSunShadowBox();
    // cảnh rất nặng: giảm độ nét điểm ảnh (màn Retina vẽ 4 lần số điểm) để xoay vẫn mượt
    let nv = 0; g.traverse((o) => { if (o.geometry && o.geometry.attributes && o.geometry.attributes.position) nv += o.geometry.attributes.position.count; });
    this.vertCount = nv;
    const pr = Math.min(nv > 1500000 ? 1.25 : nv > 600000 ? 1.5 : 2, window.devicePixelRatio || 1);
    if (Math.abs(this.renderer.getPixelRatio() - pr) > 1e-3) { this.renderer.setPixelRatio(pr); this.resize(); }
    this._dirty = true;
  }

  // bóng mờ các khối khác khi «Khóa khối»: một lưới gộp, đặt ngoài nhóm chính, chỉ dựng lại khi đổi khối khóa hoặc số đối tượng
  syncGhost(doc) {
    const key = this.isoKey + '|' + doc.items.length;
    if (this.ghost && this.ghostKey === key) return;
    this.dropGhost(); this.ghostKey = key;
    const byId = new Map(doc.items.map((i) => [i.id, i])), geos = [];
    const lay = Object.fromEntries(doc.layers.map((l) => [l.id, l]));
    for (const b of doc.items) {
      if (b.kind !== 'building' || b.pts.length < 3 || this.isoFn(b)) continue;
      const L = lay[layerOf(b)]; if (L && !L.visible) continue;
      const H0 = bldHeight(b), gy = new THREE.ExtrudeGeometry(toShape(b.pts, b.holes), { depth: H0, bevelEnabled: false, curveSegments: 4 });
      gy.rotateX(Math.PI / 2); gy.translate(0, H0 + bldElev(b, byId), 0); geos.push(gy);
    }
    const geo = mergeAll(geos); geos.forEach((g) => g !== geo && g.dispose());
    if (!geo) return;
    this.ghost = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#cbd5e1', transparent: true, opacity: 0.16, depthWrite: false }));
    this.ghost.renderOrder = 1; this.scene.add(this.ghost);
  }
  dropGhost() {
    if (!this.ghost) return;
    this.scene.remove(this.ghost); this.ghost.geometry.dispose(); this.ghost.material.dispose(); this.ghost = null; this.ghostKey = null;
  }
  // đưa camera về một vùng (giữ hướng nhìn hiện tại): c = [x, y] tâm, r = bán kính mặt bằng, top = độ cao đỉnh
  focusOn(c, r, top = 10, base = null) {
    const t = this.controls.target, dir = this.camera.position.clone().sub(t);
    if (dir.length() < 1e-3) dir.set(0.6, 0.75, 0.9);
    dir.normalize(); if (dir.y < 0.3) { dir.y = 0.45; dir.normalize(); }
    const gz = base != null ? base : GZ ? GZ(c[0], c[1]) : 0;
    t.set(c[0], gz + top * 0.4, c[1]);
    const fov = (this.camera.fov * Math.PI) / 180, R = Math.max(8, Math.hypot(r, top / 2));
    this.camera.position.copy(t).addScaledVector(dir, (R / Math.sin(fov / 2)) * 1.25);
    this.controls.update(); this.fitClip(); this.updateSunShadowBox();
  }

  frame() {
    const { cx, cy, size } = this.bounds || { cx: 0, cy: 0, size: 300 };
    this.controls.target.set(cx, 0, cy);
    this.camera.position.set(cx + size * 0.6, size * 0.75, cy + size * 0.9);
    if (GZ) { const h = GZ(cx, cy); this.controls.target.y = h; this.camera.position.y += h; }
    this.camera.near = Math.max(1, size / 300); this.camera.far = Math.max(size * 20, this.farMin || 0); this.camera.updateProjectionMatrix();
  }

  setMode(m) { this.mode = m; }

  // Vị trí mặt trời (công thức thiên văn rút gọn), giờ là giờ mặt trời địa phương
  setSun(lat, dayOfYear, hour) {
    const d2r = Math.PI / 180;
    const decl = 23.44 * d2r * Math.sin(((2 * Math.PI) / 365) * (dayOfYear - 81));
    const H = (hour - 12) * 15 * d2r;
    const phi = lat * d2r;
    const sinEl = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(H);
    const el = Math.asin(sinEl);
    let az = Math.atan2(-Math.sin(H) * Math.cos(decl), Math.cos(phi) * Math.sin(decl) - Math.sin(phi) * Math.cos(decl) * Math.cos(H));
    // az: góc phương vị tính từ Bắc theo chiều kim đồng hồ
    const east = Math.sin(az) * Math.cos(el), north = Math.cos(az) * Math.cos(el), up = Math.sin(el);
    this.sunDir = new THREE.Vector3(east, up, -north).normalize();
    this.sunEl = el / d2r; this.sunAz = ((az / d2r) + 360) % 360;
    this.sun.intensity = el > 0 ? 0.6 + 2.0 * Math.min(1, sinEl * 2) : 0.0;
    this.hemi.intensity = el > 0 ? 0.9 : 0.5;
    this.updateSunShadowBox();
    return { elevation: this.sunEl, azimuth: this.sunAz };
  }

  // Hướng mặt trời tự chọn: phương vị (độ, từ Bắc theo chiều kim đồng hồ) và độ cao (độ)
  setSunDir(azDeg, elDeg) {
    const d2r = Math.PI / 180, az = azDeg * d2r, el = elDeg * d2r;
    const east = Math.sin(az) * Math.cos(el), north = Math.cos(az) * Math.cos(el), up = Math.sin(el);
    this.sunDir = new THREE.Vector3(east, up, -north).normalize();
    this.sunEl = elDeg; this.sunAz = azDeg;
    this.sun.intensity = 0.6 + 2.0 * Math.min(1, Math.sin(el) * 2); this.hemi.intensity = 0.9;
    this.updateSunShadowBox();
    return { elevation: elDeg, azimuth: azDeg };
  }

  // Hộp đổ bóng bám theo chỗ đang nhìn (không phủ cả khu đồ án lớn) để bóng sắc nét, sát chân công trình
  updateSunShadowBox(full = false, k = 1.3) {
    const { cx, cy, size } = this.bounds || { cx: 0, cy: 0, size: 300 };
    const dir = this.sunDir || new THREE.Vector3(0.3, 0.8, 0.3).normalize();
    const t = this.controls.target, dist = this.camera.position.distanceTo(t);
    const Rall = size * 1.2, R = full ? Rall : Math.min(Rall, Math.max(60, dist * k));
    const ox = R < Rall ? t.x : cx, oz = R < Rall ? t.z : cy, oy = R < Rall ? t.y : 0;
    this.sun.position.set(ox + dir.x * R * 2, oy + dir.y * R * 2, oz + dir.z * R * 2);
    this.sun.target.position.set(ox, oy, oz); this.sun.target.updateMatrixWorld();
    const c = this.sun.shadow.camera;
    c.left = -R; c.right = R; c.top = R; c.bottom = -R; c.near = 1; c.far = R * 5;
    c.updateProjectionMatrix();
    // độ lệch bóng theo cỡ điểm ảnh bóng: đủ chống vằn mà bóng không tách khỏi chân khối
    const texel = (2 * R) / this.sun.shadow.mapSize.x;
    this.sun.shadow.normalBias = Math.min(1.2, Math.max(0.02, texel * 0.7)); this.sun.shadow.bias = -0.0003;
    this._shR = R; this._shC = [ox, oz];
    this.sun.castShadow = this.sunOn && this.mode !== 'wire';
  }

  snapshot() { this.renderer.render(this.scene, this.camera); return this.renderer.domElement.toDataURL('image/png'); }

  // Ảnh phối cảnh chân thực: dựng riêng ở độ phân giải cao (ánh sáng môi trường, bầu trời, bóng đổ mịn, mặt đứng có cửa sổ)
  // Chụp khung nhìn: ảnh y như đang hiển thị (chế độ hiển thị, màu, bóng hiện tại), độ phân giải cao
  async captureView(width = 2400) {
    const r = this.renderer, cv = r.domElement, w0 = cv.clientWidth, h0 = cv.clientHeight, pr = r.getPixelRatio();
    const aspect = w0 / Math.max(1, h0) || 1.5; width = Math.min(width, 4096); const height = Math.round(width / aspect);
    try {
      r.setPixelRatio(1); r.setSize(width, height, false);
      this.camera.aspect = aspect; this.camera.updateProjectionMatrix();
      r.render(this.scene, this.camera);
      return await new Promise((ok) => cv.toBlob(ok, 'image/jpeg', 0.94));
    } finally { r.setPixelRatio(pr); r.setSize(w0, h0, false); r.render(this.scene, this.camera); }
  }
  async renderRealistic(doc, metrics, images, width = 2400, fmt = 'jpeg', opt = {}) {
    const T = [performance.now()];
    const cv = this.renderer.domElement; const aspect = cv.clientWidth / Math.max(1, cv.clientHeight) || 1.5;
    width = Math.min(width, 4096); const height = Math.round(width / aspect);
    // bộ dựng ảnh, môi trường bầu trời và chương trình đổ bóng được giữ lại cho các lần dựng sau (nhanh hơn nhiều)
    let R = this.realR;
    if (!R) {
      const { RoomEnvironment } = await import('../vendor/three/jsm/environments/RoomEnvironment.js');
      const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      r.setPixelRatio(1);
      r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.85; r.outputColorSpace = THREE.SRGBColorSpace;
      r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
      const pm = new THREE.PMREMGenerator(r); const env = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose();
      R = this.realR = { r, env, sky: skyTexture() };
    }
    const hq = !!opt.hq;
    if (hq && !R.skyEnv) { // môi trường bầu trời ngoài trời cho phản chiếu và ánh sáng tán xạ
      const pm = new THREE.PMREMGenerator(R.r); R.skyEnv = pm.fromScene(skyScene(), 0.02).texture; pm.dispose();
      R.skyHQ = skyTexture(true);
    }
    const r = R.r; r.setSize(width, height, false);
    T.push(performance.now());
    const keep = { bg: this.scene.background, env: this.scene.environment, fog: this.scene.fog, ms: this.sun.shadow.mapSize.clone(), si: this.sun.intensity, hi: this.hemi.intensity, cs: this.sun.castShadow, mode: this.mode };
    try {
      this.mode = 'solid';
      this.build(doc, metrics, null, images, true);
      T.push(performance.now());
      const { size } = this.bounds || { size: 500 };
      this.scene.background = hq ? R.skyHQ : R.sky; this.scene.environment = hq ? R.skyEnv : R.env; this.scene.environmentIntensity = hq ? 0.75 : 0.4;
      if (hq) tuneRealMaterials(this.scene);
      this.scene.fog = new THREE.Fog(hq ? '#d3e0ec' : '#d7e3ee', size * (hq ? 0.9 : 1.2), size * (hq ? 3.8 : 4.5));
      const sm = width > 2600 ? 4096 : 3072;
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
      this.sun.shadow.mapSize.set(hq ? 4096 : sm, hq ? 4096 : sm); this.sun.castShadow = true; this.sun.intensity = hq ? 2.9 : 3.2; this.hemi.intensity = hq ? 0.18 : 0.25;
      if (hq) { this.sun.shadow.radius = 1; this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.6; }
      this.updateSunShadowBox(false, 3); this.sun.castShadow = true;
      const cam = this.camera.clone(); cam.aspect = width / height; cam.updateProjectionMatrix();
      if (hq) { // nhiều lượt dựng: mặt trời lệch nhẹ (bóng mềm như thật) + lệch dưới điểm ảnh (khử răng cưa), cộng dồn trung bình
        const N = opt.frames || (width > 2600 ? 20 : 28);
        const acc = document.createElement('canvas'); acc.width = width; acc.height = height; const ax = acc.getContext('2d');
        const sp = this.sun.position.clone(), st = this.sun.target.position.clone(), dir = sp.clone().sub(st), dist = dir.length();
        const u = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize(); if (!isFinite(u.x) || u.lengthSq() < 0.5) u.set(1, 0, 0);
        const v = new THREE.Vector3().crossVectors(u, dir).normalize();
        const spread = Math.tan((1.1 * Math.PI) / 180) * dist;
        for (let k = 0; k < N; k++) {
          const a = k * 2.399963, rr = Math.sqrt((k + 0.5) / N) * spread; // xoắn ốc Fibonacci trên đĩa mặt trời
          this.sun.position.copy(sp).addScaledVector(u, Math.cos(a) * rr).addScaledVector(v, Math.sin(a) * rr);
          this.sun.updateMatrixWorld(); this.sun.shadow.needsUpdate = true;
          const jx = ((k * 0.618034) % 1) - 0.5, jy = ((k * 0.414214) % 1) - 0.5;
          cam.setViewOffset(width, height, jx, jy, width, height);
          r.render(this.scene, cam);
          ax.globalAlpha = 1 / (k + 1); ax.drawImage(r.domElement, 0, 0);
          if (opt.onProgress) opt.onProgress((k + 1) / N);
          await new Promise((ok) => setTimeout(ok, 0));
        }
        cam.clearViewOffset(); this.sun.position.copy(sp); this.sun.updateMatrixWorld();
        T.push(performance.now());
        const blob = await new Promise((ok) => acc.toBlob(ok, fmt === 'png' ? 'image/png' : 'image/jpeg', 0.94));
        T.push(performance.now());
        this.lastRenderTimes = T.slice(1).map((t, i) => Math.round(t - T[i]));
        return blob;
      }
      r.render(this.scene, cam);
      T.push(performance.now());
      if (fmt === 'warm') { r.getContext().finish && r.getContext().finish(); return null; }
      // JPEG mã hoá nhanh hơn PNG nhiều lần và file nhỏ hơn
      const blob = await new Promise((ok) => r.domElement.toBlob(ok, fmt === 'png' ? 'image/png' : 'image/jpeg', 0.93));
      T.push(performance.now());
      this.lastRenderTimes = T.slice(1).map((t, i) => Math.round(t - T[i]));
      return blob;
    } finally {
      this.scene.background = keep.bg; this.scene.environment = keep.env; this.scene.environmentIntensity = 1; this.scene.fog = keep.fog;
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
      this.sun.shadow.radius = 1; this.sun.shadow.normalBias = 0;
      this.sun.shadow.mapSize.copy(keep.ms); this.sun.intensity = keep.si; this.hemi.intensity = keep.hi; this.sun.castShadow = keep.cs; this.mode = keep.mode;
      this.updateSunShadowBox(); this.sun.castShadow = keep.cs;
    }
  }
  exportGroup() { return this.group; }
}

// Ma trận đưa hệ toạ độ của một mặt (trục x = U, y = V, z = pháp tuyến N) ra không gian
function frameMatrix(F) {
  const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
  return new THREE.Matrix4().makeBasis(V(F.U), V(F.V), V(F.N)).setPosition(F.o[0], F.o[1], F.o[2]);
}
// Mảng kéo âm theo đối tượng cha và theo mặt: Map(id cha -> Map(mặt -> [mảng])); mảng âm trên mảng phẳng (độ nhô 0) khoét luôn mặt bên dưới
function negFacetMap(doc, iv) {
  const byId = new Map(doc.items.map((i) => [i.id, i])), out = new Map();
  const put = (pid, face, f) => { let m = out.get(pid); if (!m) out.set(pid, (m = new Map())); (m.get(face) || m.set(face, []).get(face)).push(f); };
  for (const f of doc.items) if (f.kind === 'facet' && (f.props.depth || 0) < -0.05 && iv(f)) {
    put(f.props.parent, f.props.face, f);
    let p = byId.get(f.props.parent), face = f.props.face, k = 0;
    while (p && p.kind === 'facet' && face === 'top' && Math.abs(p.props.depth || 0) <= 0.05 && k++ < 20) { put(p.props.parent, p.props.face, f); face = p.props.face; p = byId.get(p.props.parent); }
  }
  for (const [pid, m] of out) for (const [k, arr] of m) arr.allOnFace = doc.items.filter((f) => f.kind === 'facet' && f.props.parent === pid && f.props.face === k);
  return out;
}
// đoạn p-q nằm trên một cạnh của đa giác base (thành hốc trùng mặt khối bên cạnh thì bỏ, vì mặt đó đã được khoét)
function onBoundary(p, q, base, tol = 0.06) {
  for (let i = 0; i < base.length; i++) {
    const a = base[i], b = base[(i + 1) % base.length];
    if (G.distToSegment(p, a, b).d < tol && G.distToSegment(q, a, b).d < tol) return i;
  }
  return -1;
}
// Hốc kéo âm: đáy hốc ở z = d (< 0) và các thành hốc nối mép mảng với đáy (không có nắp ở mặt khối)
function recessGeo(poly, d, base, holes = []) {
  const back = new THREE.ShapeGeometry(toShape(poly, holes)); back.translate(0, 0, d);
  const pos = [];
  const wall = (p, q) => pos.push(p[0], p[1], 0, q[0], q[1], 0, q[0], q[1], d, p[0], p[1], 0, q[0], q[1], d, p[0], p[1], d);
  for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; if (base && onBoundary(p, q, base) >= 0) continue; wall(p, q); } // hốc chạm mép mặt: để hở
  for (const h of holes) for (let i = 0; i < h.length; i++) wall(h[i], h[(i + 1) % h.length]);
  const b2 = back.toNonIndexed(); b2.deleteAttribute('normal'); back.dispose();
  if (!pos.length) return b2;
  const walls = new THREE.BufferGeometry(); walls.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  walls.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0), 2));
  return mergeGeometries([b2, walls]);
}
// Trừ các vùng khoét khỏi một mặt (toạ độ của mặt); kết quả là các đa giác (có lỗ) – có bộ nhớ đệm vì phép trừ khá nặng
const _cutCache = new Map();
const matTex = new Map(); // vân vật liệu phủ dùng lại giữa các lần dựng
function subtractPolys(base, cuts) {
  const key = JSON.stringify([base, cuts]);
  if (_cutCache.has(key)) return _cutCache.get(key);
  let out;
  try { out = booleanPolys([{ pts: base, add: true }, ...cuts.map((c) => ({ pts: c, add: false }))]); } catch { out = null; }
  if (!out) out = [Object.assign(base.slice(), { holes: cuts })];
  if (_cutCache.size > 300) _cutCache.clear();
  _cutCache.set(key, out);
  return out;
}
// Khối (công trình hoặc mảng đã kéo) có mảng con kéo âm: dựng lại vỏ khối, bỏ phần mặt bị khoét
// (hốc chạm mép thì khoét luôn phần mái / mặt bên cạnh). Nhóm 0: mái + đáy, nhóm 1: tường (giống ExtrudeGeometry)
function cutPrismGeo(byId, item, neg) {
  const isB = item.kind === 'building';
  const P = isB ? item.pts : item.props.poly, holesP = (isB ? item.holes : item.props.holes) || [], n = P.length;
  const d = isB ? bldHeight(item) : item.props.depth || 0, H = Math.abs(d), recess = d < 0;
  const caps = [], walls = [];
  const Ls = P.map((p, i) => G.dist(p, P[(i + 1) % n]));
  const tan = (i) => { const a = P[i], c = P[(i + 1) % n], L = Ls[i] || 1; return [(c[0] - a[0]) / L, (c[1] - a[1]) / L]; };
  const cuts = new Map(); const addCut = (k, poly) => { (cuts.get(k) || cuts.set(k, []).get(k)).push(poly); };
  const rect = (u0, u1, v0, v1) => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  for (const [face, list] of neg) for (const f of list) {
    const D = -(f.props.depth || 0);
    let poly = f.props.poly;
    if (f.props.parent !== item.id) { // mảng âm nằm trên mảng phẳng của mặt này: cùng hệ toạ độ
      addCut(face, poly); continue;
    }
    if (face === 'top') {
      addCut('top', poly);
      if (recess) continue;
      for (let j = 0; j < poly.length; j++) { // hốc trên mặt đầu chạm mép: khoét phần mặt bên tương ứng
        const e = onBoundary(poly[j], poly[(j + 1) % poly.length], P); if (e < 0) continue;
        const t = tan(e), u = (q) => (q[0] - P[e][0]) * t[0] + (q[1] - P[e][1]) * t[1];
        const ua = Math.max(0, Math.min(u(poly[j]), u(poly[(j + 1) % poly.length]))), ub = Math.min(Ls[e], Math.max(u(poly[j]), u(poly[(j + 1) % poly.length])));
        if (ub - ua > 0.05) addCut(e, rect(ua, ub, Math.max(0, H - D), H));
      }
    } else {
      addCut(face, poly);
      if (recess) continue;
      const bb = G.bbox(poly), L = Ls[face], t = tan(face), inw = edgeNormal(P, face).map((v) => -v), a = P[face];
      if (bb.y1 >= H - 0.06) { const at = (u, k) => [a[0] + t[0] * u + inw[0] * k, a[1] + t[1] * u + inw[1] * k]; addCut('top', [at(bb.x0, 0), at(bb.x1, 0), at(bb.x1, D), at(bb.x0, D)]); } // hốc chạm mép trên: khoét mặt đầu
      if (bb.x0 <= 0.06) { // chạm góc đầu cạnh: khoét mặt bên trước đó
        const j = (face - 1 + n) % n, tj = tan(j), c = [P[face][0] + inw[0] * D, P[face][1] + inw[1] * D];
        const uc = (c[0] - P[j][0]) * tj[0] + (c[1] - P[j][1]) * tj[1];
        if (Ls[j] - uc > 0.05) addCut(j, rect(Math.max(0, uc), Ls[j], bb.y0, bb.y1));
      }
      if (bb.x1 >= L - 0.06) { // chạm góc cuối cạnh: khoét mặt bên tiếp theo
        const k = (face + 1) % n, tk = tan(k), c = [P[k][0] + inw[0] * D, P[k][1] + inw[1] * D];
        const uc = (c[0] - P[k][0]) * tk[0] + (c[1] - P[k][1]) * tk[1];
        if (uc > 0.05) addCut(k, rect(0, Math.min(Ls[k], uc), bb.y0, bb.y1));
      }
    }
  }
  // phần còn lại của một mặt sau khi khoét
  const remainder = (base, face, holes = []) => {
    const own = (neg.get(face) || []).filter((f) => f.props.parent === item.id), cs = cuts.get(face) || [];
    const all = own.allOnFace || (neg.get(face) || {}).allOnFace || [], A = Math.abs(G.area(base));
    if (!holes.length && all.length && cs.length === own.length && cs.length === (neg.get(face) || []).length) {
      const net = (f) => Math.abs(G.area(f.props.poly)) - (f.props.holes || []).reduce((s2, h) => s2 + Math.abs(G.area(h)), 0);
      if (Math.abs(all.reduce((s2, f) => s2 + net(f), 0) - A) < A * 0.01) return all.filter((f) => (f.props.depth || 0) >= -0.05).map((f) => new THREE.ShapeGeometry(toShape(f.props.poly, f.props.holes || []))); // các mảng phủ kín mặt
    }
    return subtractPolys(base, cs.concat(holes)).map((pl) => new THREE.ShapeGeometry(toShape(pl, pl.holes || [])));
  };
  const capF = frameOf(byId, item.id, 'top');
  if (isB) { const y0 = bldElev(item, byId); const g = new THREE.ShapeGeometry(toShape(P, holesP)); g.rotateX(Math.PI / 2); g.translate(0, y0, 0); caps.push(g); } // đáy công trình
  for (const g of cuts.has('top') ? remainder(P, 'top', holesP) : [new THREE.ShapeGeometry(toShape(P, holesP))]) { g.applyMatrix4(frameMatrix(capF)); caps.push(g); }
  for (let i = 0; i < n; i++) {
    const Fw = frameOf(byId, item.id, i); if (!Fw) continue;
    const base = rect(0, Ls[i], 0, H);
    if (recess && onBoundary(P[i], P[(i + 1) % n], frameOf(byId, item.props.parent, item.props.face).base) >= 0) continue; // thành hốc trùng mép mặt: để hở
    for (const g of cuts.has(i) ? remainder(base, i) : [new THREE.ShapeGeometry(toShape(base))]) { g.applyMatrix4(frameMatrix(Fw)); walls.push(g); }
  }
  // thành quanh lỗ (sân trong / lỗ của mảng): không khoét
  const F0 = isB ? null : frameOf(byId, item.props.parent, item.props.face), y0 = isB ? bldElev(item, byId) : 0;
  const W = (q, h) => (isB ? [q[0], y0 + h, q[1]] : F0.pt(q, recess ? -h : h));
  const hp = [];
  for (const hl of holesP) for (let i = 0; i < hl.length; i++) { const a = hl[i], b = hl[(i + 1) % hl.length]; hp.push(...W(a, 0), ...W(b, 0), ...W(b, H), ...W(a, 0), ...W(b, H), ...W(a, H)); }
  if (hp.length) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(hp, 3)); walls.push(g); }
  const flatten = (arr) => mergeGeometries(arr.map((g) => { const m = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(m.attributes)) if (!['position', 'uv'].includes(k)) m.deleteAttribute(k); if (!m.attributes.uv) m.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(m.attributes.position.count * 2).fill(0), 2)); return m; }));
  const empty = () => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([], 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute([], 2)); return g; };
  const out = mergeGeometries([caps.length ? flatten(caps) : empty(), walls.length ? flatten(walls) : empty()], true);
  out.computeVertexNormals();
  return out;
}
function toShape(pts, holes = []) {
  // ShapeGeometry dùng (x, y); xoay +90° quanh X đưa (x, y, 0) -> (x, 0, y)
  const s = new THREE.Shape(pts.map((p) => new THREE.Vector2(p[0], p[1])));
  for (const h of holes || []) s.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p[0], p[1]))));
  return s;
}

function lighten(hex, t) {
  const c = new THREE.Color(hex); c.lerp(new THREE.Color('#ffffff'), t); return '#' + c.getHexString();
}

function mergeAll(geos) {
  if (!geos.length) return null;
  if (geos.length === 1) return geos[0];
  const idx = geos.filter((g) => g.index), non = geos.filter((g) => !g.index);
  const norm = (g) => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); return g; };
  const parts = [];
  if (idx.length) parts.push(mergeGeometries(idx.map(norm)));
  if (non.length) parts.push(mergeGeometries(non.map(norm)));
  geos.forEach((g) => g.dispose());
  return parts.length === 1 ? parts[0] : mergeGeometries(parts.map((p) => p.index ? p.toNonIndexed() : p));
}

function treePositions(poly, max) {
  const bb = G.bbox(poly), step = 12, pos = [];
  for (let x = bb.x0 + step / 2; x < bb.x1 && pos.length < Math.min(400, max); x += step) for (let y = bb.y0 + step / 2; y < bb.y1; y += step) {
    const p = [x + ((x * 7.3 + y * 3.1) % 4) - 2, y + ((x * 2.9 + y * 5.7) % 4) - 2];
    if (G.pointInPolygon(p, poly)) pos.push(p);
    if (pos.length >= Math.min(400, max)) break;
  }
  return pos;
}
// Mẫu cây có sẵn: các phần (thân, tán) với hình học đặt tại gốc, cao khoảng 8 m khi k = 1
const TREE_PARTS = (() => {
  const sc = (geo, x, y, z) => { geo.scale(x, y, z); return geo; };
  return {
    round: [{ geo: new THREE.CylinderGeometry(0.3, 0.4, 3, 5), color: '#7a5a3a', y: 1.5 }, { geo: new THREE.SphereGeometry(2.8, 8, 6), color: '#4f9a45', y: 5 }],
    cone: [{ geo: new THREE.CylinderGeometry(0.25, 0.35, 2, 5), color: '#6b4f33', y: 1 }, { geo: new THREE.ConeGeometry(2.3, 7.5, 8), color: '#2f6f3a', y: 5.6 }],
    palm: [{ geo: new THREE.CylinderGeometry(0.17, 0.26, 8, 6), color: '#8a6a4a', y: 4 }, { geo: sc(new THREE.SphereGeometry(1, 9, 5), 3.2, 0.7, 3.2), color: '#5c9a3a', y: 8.2 }],
    column: [{ geo: new THREE.CylinderGeometry(0.25, 0.35, 2, 5), color: '#7a5a3a', y: 1 }, { geo: sc(new THREE.SphereGeometry(1, 8, 8), 1.7, 3.6, 1.7), color: '#3f8a3a', y: 5.4 }],
    shrub: [{ geo: sc(new THREE.SphereGeometry(1, 8, 5), 2.3, 1.3, 2.3), color: '#6aa84f', y: 1.1 }],
  };
})();
// Mẫu cây nhập từ file (.glb/.gltf/.obj): nạp một lần, chuẩn hoá cao 8 m, gốc ở chân cây
const treeModels = {};
function loadTreeModel(entry, onDone) {
  const st = treeModels[entry.id];
  if (st) return st.parts ? st : null;
  treeModels[entry.id] = { loading: true };
  (async () => {
    try {
      const res = await fetch(entry.data); const buf = await res.arrayBuffer();
      let root;
      if (entry.fmt === 'obj') { const { OBJLoader } = await import('../vendor/three/jsm/loaders/OBJLoader.js'); root = new OBJLoader().parse(new TextDecoder().decode(buf)); }
      else { const { GLTFLoader } = await import('../vendor/three/jsm/loaders/GLTFLoader.js'); root = (await new GLTFLoader().parseAsync(buf, '')).scene; }
      root.updateMatrixWorld(true);
      const parts = []; const box = new THREE.Box3();
      root.traverse((o) => { if (o.isMesh) { const geo = o.geometry.clone().applyMatrix4(o.matrixWorld); geo.computeBoundingBox(); box.union(geo.boundingBox); parts.push({ geo, mat: [].concat(o.material)[0] }); } });
      if (!parts.length) throw new Error('không có hình khối');
      const hgt = Math.max(0.01, box.max.y - box.min.y), k = 8 / hgt, cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
      for (const pt of parts) { pt.geo.translate(-cx, -box.min.y, -cz); pt.geo.scale(k, k, k); }
      treeModels[entry.id] = { parts };
    } catch (err) { console.warn('Mẫu cây lỗi', err); treeModels[entry.id] = { failed: true }; }
    onDone && onDone();
  })();
  return null;
}
export function treeModelFailed(id) { return !!(treeModels[id] && treeModels[id].failed); }
function addTrees(g, pos, mode, doc, onAsset) {
  if (!pos.length || mode === 'wire') return;
  const groups = new Map();
  for (const p of pos) { const t = p[3] || 'round'; (groups.get(t) || groups.set(t, []).get(t)).push(p); }
  const lib = (doc && doc.settings && doc.settings.treeLib) || [];
  const m = new THREE.Matrix4(), tmp = new THREE.Matrix4();
  for (const [type, list] of groups) {
    let parts = TREE_PARTS[type];
    if (!parts) {
      const entry = lib.find((x) => x.id === type);
      const md = entry && loadTreeModel(entry, onAsset);
      if (md) parts = md.parts.map((pt) => ({ geo: pt.geo, material: pt.mat, y: 0, shared: true }));
      else parts = TREE_PARTS.round; // đang nạp hoặc lỗi: tạm dùng cây tán tròn
    }
    for (const pt of parts) {
      const mat = pt.material ? pt.material.clone() : new THREE.MeshStandardMaterial({ color: pt.color, roughness: 1 });
      if (mode === 'xray') { mat.transparent = true; mat.opacity = 0.3; }
      const im = new THREE.InstancedMesh(pt.geo, mat, list.length);
      list.forEach((p, i) => { const k = p[2] || 1; m.makeScale(k, k, k).setPosition(p[0], (pt.y || 0) * k + (GZ ? GZ(p[0], p[1]) : 0), p[1]); im.setMatrixAt(i, m); });
      im.castShadow = true; im.userData.keepGeo = true; void tmp;
      g.add(im);
    }
  }
}

// Nhãn biểu tượng trong 3D: chữ và / hoặc nét viết tay trên nền trắng
const labelTex = {};
function violTexture(lines) {
  const key = 'V|' + lines.join('|'); if (labelTex[key]) return labelTex[key];
  const c = document.createElement('canvas'), x = c.getContext('2d'), F = '600 38px system-ui, sans-serif', LH = 50;
  x.font = F; const W = Math.ceil(Math.max(...lines.map((t) => x.measureText(t).width)) + 36), H = lines.length * LH + 20;
  c.width = W; c.height = H;
  x.fillStyle = 'rgba(185,28,28,.94)'; x.beginPath(); x.roundRect ? x.roundRect(0, 0, W, H, 14) : x.rect(0, 0, W, H); x.fill();
  x.font = F; x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
  lines.forEach((t, i) => x.fillText(t, W / 2, 10 + LH * i + LH / 2 + 2));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return (labelTex[key] = { t, a: W / H });
}
function labelTexture(it) {
  const txt = it.props.label || '', ink = it.props.ink && it.props.ink.s && it.props.ink.s.length ? it.props.ink : null;
  if (!txt && !ink) return null;
  const col = it.props.color || '#111827';
  const key = txt + '|' + col + '|' + (ink ? JSON.stringify(ink).length + ':' + ink.s.length + ':' + ink.w : '');
  if (labelTex[key]) return labelTex[key];
  const H = 64, c = document.createElement('canvas'), x = c.getContext('2d');
  x.font = '600 44px system-ui, sans-serif';
  const tw = txt ? x.measureText(txt).width : 0, iw = ink ? inkSize(ink, H - 16)[0] : 0;
  const W = Math.ceil(Math.max(tw, iw) + 28), HH = (txt ? H : 0) + (ink ? H : 0);
  c.width = W; c.height = HH;
  x.fillStyle = 'rgba(255,255,255,.9)'; x.beginPath(); x.roundRect ? x.roundRect(0, 0, W, HH, 14) : x.rect(0, 0, W, HH); x.fill();
  let y = 0;
  if (txt) { x.font = '600 44px system-ui, sans-serif'; x.fillStyle = col; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(txt, W / 2, H / 2 + 2); y = H; }
  if (ink) drawInk(x, ink, W / 2, y + 8, H - 16, col);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return (labelTex[key] = { t, a: W / HH });
}
const iconTex = {};
function iconTexture(sym, color) {
  const k = sym + '|' + (color || '');
  if (iconTex[k]) return iconTex[k];
  const c = document.createElement('canvas'); c.width = c.height = 128;
  drawIconAt(c.getContext('2d'), sym, 64, 64, 112, color);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return (iconTex[k] = t);
}

// Tách một nhóm mặt của ExtrudeGeometry (0: mái/đáy, 1: tường); dv dời UV dọc để cửa sổ khớp tầng
function groupPart(geo, gi, dv = 0) {
  const gr = geo.groups.filter((x) => x.materialIndex === gi);
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const a = geo.attributes[name]; if (!a) continue;
    let n = 0; for (const x of gr) n += x.count;
    const arr = new Float32Array(n * a.itemSize); let o = 0;
    for (const x of gr) { arr.set(a.array.subarray(x.start * a.itemSize, (x.start + x.count) * a.itemSize), o); o += x.count * a.itemSize; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  if (gi === 1 && dv && out.attributes.uv) { const u = out.attributes.uv.array; for (let i = 1; i < u.length; i += 2) u[i] += dv; }
  return out;
}
const facadeCache = {};
// Cảnh bầu trời (bán cầu trời xanh, chân trời sáng, mặt đất) để tạo bản đồ môi trường cho ảnh thật
function skyScene() {
  const sc = new THREE.Scene();
  const geo = new THREE.SphereGeometry(100, 48, 24), col = [], pos = geo.attributes.position;
  const top = new THREE.Color('#4a86cc'), hor = new THREE.Color('#dbe8f3'), gnd = new THREE.Color('#8c8f7c'), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) { const y = pos.getY(i) / 100; if (y >= 0) c.copy(hor).lerp(top, Math.pow(y, 0.6)); else c.copy(hor).lerp(gnd, Math.min(1, -y * 4)); col.push(c.r, c.g, c.b); }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  sc.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const sunM = new THREE.Mesh(new THREE.SphereGeometry(6, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 8.5, 7.5) })); sunM.position.set(50, 60, 40); sc.add(sunM);
  return sc;
}
// Ảnh thật: kính phản chiếu, mặt nước bóng, nền nhám
function tuneRealMaterials(scene) {
  scene.traverse((o) => {
    const m = o.material; if (!m || Array.isArray(m) || !m.isMeshStandardMaterial) return;
    if (o.userData.keepTex) { m.roughness = 0.38; m.metalness = 0.12; m.envMapIntensity = 1.25; m.needsUpdate = true; return; }
    const hex = m.color && m.color.getHexString();
    if (hex === 'c9cdbf' && !m.map) { m.color.set('#ffffff'); m.map = grassTexture(); m.roughness = 0.95; m.metalness = 0; m.envMapIntensity = 0.6; m.needsUpdate = true; return; }
    if (hex === '6fb7e3') { m.color.set('#4f8fbf'); m.roughness = 0.06; m.metalness = 0.25; m.envMapIntensity = 1.6; m.needsUpdate = true; }
  });
}
// nền cỏ/đất có vân nhẹ cho ảnh thật (lặp nhiều lần trên mặt đất)
let grassTex = null;
function grassTexture() {
  if (grassTex) return grassTex;
  const n = 256, c = document.createElement('canvas'); c.width = c.height = n; const x = c.getContext('2d');
  x.fillStyle = '#b3b898'; x.fillRect(0, 0, n, n);
  let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 900; i++) { const cx = rnd() * n, cy = rnd() * n, r = 4 + rnd() * 22, l = rnd(); x.fillStyle = l < 0.5 ? `rgba(90,105,60,${0.015 + rnd() * 0.03})` : `rgba(215,210,180,${0.015 + rnd() * 0.03})`; for (const ox of [-n, 0, n]) for (const oy of [-n, 0, n]) { x.beginPath(); x.arc(cx + ox, cy + oy, r, 0, 7); x.fill(); } }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(140, 140); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return (grassTex = t);
}
function facadeTexture(color) {
  if (facadeCache[color]) return facadeCache[color];
  const c = document.createElement('canvas'); c.width = 128; c.height = 128; const x = c.getContext('2d');
  x.fillStyle = color; x.fillRect(0, 0, 128, 128);
  // dải sàn
  x.fillStyle = 'rgba(0,0,0,0.10)'; x.fillRect(0, 118, 128, 10);
  // ô kính
  const gr = x.createLinearGradient(0, 22, 0, 104); gr.addColorStop(0, '#5d7892'); gr.addColorStop(0.55, '#3d566e'); gr.addColorStop(1, '#2a3d50');
  x.fillStyle = gr; x.fillRect(18, 22, 92, 84);
  x.fillStyle = 'rgba(255,255,255,0.16)'; x.beginPath(); x.moveTo(18, 22); x.lineTo(70, 22); x.lineTo(18, 70); x.closePath(); x.fill();
  x.fillStyle = color; x.fillRect(62, 22, 4, 84); // đố cửa
  x.fillStyle = 'rgba(255,255,255,0.35)'; x.fillRect(16, 106, 96, 3); // bậu cửa
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return (facadeCache[color] = t);
}
function skyTexture(hq) {
  const c = document.createElement('canvas'); c.width = hq ? 512 : 4; c.height = 256; const x = c.getContext('2d');
  const gr = x.createLinearGradient(0, 0, 0, 256);
  if (hq) { gr.addColorStop(0, '#3f7cc4'); gr.addColorStop(0.45, '#7fb0e2'); gr.addColorStop(0.8, '#c9dff1'); gr.addColorStop(1, '#eef3f6'); }
  else { gr.addColorStop(0, '#5f97d4'); gr.addColorStop(0.55, '#a9c9ea'); gr.addColorStop(1, '#e6eef5'); }
  x.fillStyle = gr; x.fillRect(0, 0, c.width, 256);
  if (hq) { // mây mỏng
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 70; i++) { const cx = rnd() * 512, cy = 30 + rnd() * 110, rw = 30 + rnd() * 90, rh = 6 + rnd() * 14; const g2 = x.createRadialGradient(cx, cy, 0, cx, cy, rw); g2.addColorStop(0, 'rgba(255,255,255,0.22)'); g2.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g2; x.save(); x.translate(cx, cy); x.scale(1, rh / rw); x.beginPath(); x.arc(0, 0, rw, 0, 7); x.fill(); x.restore(); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
