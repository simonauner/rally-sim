import * as THREE from 'three/webgpu';

/**
 * A car model from Blender (blender/export.py): the 'body' shell and loose details, with one material
 * per vertex. Material names are looked up in the car's palette in carMesh.ts.
 */
export interface ModelPart {
  name: string;
  /** The part's origin in car coordinates. */
  at: [number, number, number];
  /** Base64: positions in mm (int16, relative to `at`), material index (uint8) and triangles (uint16). */
  pos: string;
  mat: string;
  index: string;
}

export interface ModelData {
  materials: string[];
  parts: ModelPart[];
}

function bytes(b64: string): ArrayBuffer {
  const s = atob(b64);
  const a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
  return a.buffer;
}

/** The part's geometry with the attribute 'mat' (material index) and 'rest' (rest position, for colour fields that should follow dents). */
export function partGeometry(p: ModelPart): THREE.BufferGeometry {
  const mm = new Int16Array(bytes(p.pos));
  const pos = new Float32Array(mm.length);
  for (let i = 0; i < mm.length; i++) pos[i] = mm[i]! / 1000;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('rest', new THREE.BufferAttribute(pos.slice(), 3));
  g.setAttribute('mat', new THREE.BufferAttribute(Float32Array.from(new Uint8Array(bytes(p.mat))), 1));
  g.setIndex(new THREE.BufferAttribute(new Uint16Array(bytes(p.index)), 1));
  g.computeVertexNormals();
  return g;
}
