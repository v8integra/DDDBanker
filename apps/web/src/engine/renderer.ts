import * as THREE from 'three';
import type { Settings } from '../settings/settings';
import { allMaterials } from './materials';

const QUALITY = {
  low: { pixelRatioCap: 1, shadows: false, shadowMapSize: 512 },
  medium: { pixelRatioCap: 1.5, shadows: true, shadowMapSize: 1024 },
  high: { pixelRatioCap: 2, shadows: true, shadowMapSize: 2048 },
} as const;

export function createRenderer(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoft was removed in r18x
  return renderer;
}

/** Apply a graphics quality level. Safe to call whenever the setting changes. */
export function applyQuality(
  renderer: THREE.WebGLRenderer,
  sun: THREE.DirectionalLight,
  quality: Settings['graphics'],
) {
  const q = QUALITY[quality];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatioCap));

  const shadowsChanged = renderer.shadowMap.enabled !== q.shadows;
  renderer.shadowMap.enabled = q.shadows;
  sun.castShadow = q.shadows;
  if (sun.shadow.mapSize.x !== q.shadowMapSize) {
    sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
  }
  // Toggling shadows changes shader code, so materials must recompile.
  if (shadowsChanged) for (const material of allMaterials()) material.needsUpdate = true;
}

export function resizeToDisplay(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera) {
  const canvas = renderer.domElement;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const size = renderer.getSize(new THREE.Vector2());
  if (size.x === width && size.y === height) return false;
  renderer.setSize(width, height, false);
  camera.aspect = width / Math.max(1, height);
  camera.updateProjectionMatrix();
  return true;
}
