// Xuất mô hình 3D: OBJ, GLB, USDZ
import { OBJExporter } from '../vendor/three/jsm/exporters/OBJExporter.js';
import { GLTFExporter } from '../vendor/three/jsm/exporters/GLTFExporter.js';
import { USDZExporter } from '../vendor/three/jsm/exporters/USDZExporter.js';
import * as THREE from '../vendor/three/build/three.module.min.js';

// Chỉ lấy các khối có mặt (bỏ lưới, đường viền) và đặt tên dễ hiểu
function cleanCopy(group) {
  const g = new THREE.Group(); g.name = 'QuickPlan';
  group.updateMatrixWorld(true);
  let n = 0;
  group.traverse((o) => {
    if (o.isMesh && !o.isInstancedMesh && o.geometry && o.material && o.visible !== false) {
      const m = new THREE.Mesh(o.geometry, new THREE.MeshStandardMaterial({ color: o.material.color ? o.material.color.clone() : 0xffffff, roughness: 0.8 }));
      m.applyMatrix4(o.matrixWorld);
      m.name = (o.userData && o.userData.id ? 'CongTrinh_' : 'Mat_') + ++n;
      g.add(m);
    }
  });
  return g;
}

export async function exportModel(kind, group) {
  const g = cleanCopy(group);
  if (kind === 'obj') return new Blob([new OBJExporter().parse(g)], { type: 'text/plain' });
  if (kind === 'glb') {
    const buf = await new GLTFExporter().parseAsync(g, { binary: true });
    return new Blob([buf], { type: 'model/gltf-binary' });
  }
  if (kind === 'usdz') {
    // USDZ dùng đơn vị mét; thu nhỏ 1:500 để xem AR trên bàn
    g.scale.setScalar(1 / 500); g.updateMatrixWorld(true);
    const wrap = new THREE.Group(); wrap.add(g);
    const buf = await new USDZExporter().parseAsync(wrap);
    return new Blob([buf], { type: 'model/vnd.usdz+zip' });
  }
  throw new Error('Định dạng không hỗ trợ');
}
