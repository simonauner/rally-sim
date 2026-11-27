import * as THREE from 'three/webgpu';

/**
 * En bilmodell från Blender (blender/export.py): karossen 'body' och lösa detaljer, med ett material
 * per hörn. Materialens namn slås upp i bilens palett i carMesh.ts.
 */
export interface ModelPart {
  name: string;
  /** Delens origo i bilens koordinater. */
  at: [number, number, number];
  /** Base64: positioner i mm (int16, relativt `at`), materialindex (uint8) och trianglar (uint16). */
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

/** Delens geometri med attributet 'mat' (materialindex) och 'rest' (vilopositionen, för färgfält som ska följa bucklor). */
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
