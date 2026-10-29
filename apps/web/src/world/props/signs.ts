import * as THREE from 'three';

export interface SignTextOptions {
  width: number;
  height: number;
  background: string;
  color: string;
  /** Lines of text; the first is drawn larger as a title. */
  lines: string[];
  pixelsPerMeter?: number;
}

/**
 * A flat sign face with text drawn on a canvas. Faces -Z (toward the street).
 * Used for plaques and small signs; big letters use blockFont instead.
 */
export function createSignFace({
  width,
  height,
  background,
  color,
  lines,
  pixelsPerMeter = 256,
}: SignTextOptions) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * pixelsPerMeter);
  canvas.height = Math.round(height * pixelsPerMeter);
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const border = canvas.height * 0.05;
  ctx.strokeStyle = color;
  ctx.lineWidth = border * 0.5;
  ctx.strokeRect(border, border, canvas.width - border * 2, canvas.height - border * 2);

  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // A single line (station signs, the gate) gets most of the height; plaques get a title + body.
  const titleSize = canvas.height * (lines.length === 1 ? 0.5 : 0.17);
  const bodySize = canvas.height * 0.105;
  const lineGap = bodySize * 1.35;
  const blockHeight = titleSize * 1.4 + (lines.length - 1) * lineGap;
  let y = (canvas.height - blockHeight) / 2 + titleSize * 0.6;
  lines.forEach((line, i) => {
    const size = i === 0 ? titleSize : bodySize;
    ctx.font = `${i === 0 ? 700 : 600} ${size}px "Atkinson Hyperlegible", system-ui, sans-serif`;
    ctx.fillText(line, canvas.width / 2, y, canvas.width - border * 4);
    y += i === 0 ? titleSize * 1.4 : lineGap;
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }),
  );
  mesh.rotation.y = Math.PI; // plane faces +Z by default
  return mesh;
}
