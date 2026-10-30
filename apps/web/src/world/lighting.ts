import * as THREE from 'three';
import { layout, palette } from '../theme';
import { LAMP_POSITIONS } from './street';

export type TimeOfDay = 'day' | 'evening';
export type Quality = 'low' | 'medium' | 'high';

/** Sky, fog and light settings for each time of day. */
export const LOOKS = {
  day: {
    sky: palette.sky,
    fog: palette.fog,
    hemiSky: palette.hemiSky,
    hemiGround: palette.hemiGround,
    hemi: 1.4,
    sun: palette.sun,
    sunIntensity: 2.4,
    lamps: 0,
  },
  evening: {
    sky: palette.eveningSky,
    fog: palette.eveningFog,
    hemiSky: palette.eveningHemiSky,
    hemiGround: palette.eveningHemiGround,
    hemi: 0.9,
    sun: palette.sunset,
    sunIntensity: 1.1,
    lamps: 14,
  },
} as const;

/**
 * Day or evening on the street. Evening dims the sky and sun to a sunset and,
 * above Low graphics, lights the street lamps for real. Lamps are only added
 * while needed, since each light costs a little on every frame.
 */
export class StreetLighting {
  private readonly lamps = new THREE.Group();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly hemi: THREE.HemisphereLight,
    private readonly sun: THREE.DirectionalLight,
  ) {
    this.lamps.name = 'street-lamps';
    scene.add(this.lamps);
  }

  apply(time: TimeOfDay, quality: Quality) {
    const look = LOOKS[time];
    this.scene.background = new THREE.Color(look.sky);
    (this.scene.fog as THREE.Fog).color.set(look.fog);
    this.hemi.color.set(look.hemiSky);
    this.hemi.groundColor.set(look.hemiGround);
    this.hemi.intensity = look.hemi;
    this.sun.color.set(look.sun);
    this.sun.intensity = look.sunIntensity;

    const wantLamps = look.lamps > 0 && quality !== 'low';
    if (wantLamps === this.lamps.children.length > 0) return;
    this.lamps.clear();
    if (!wantLamps) return;
    for (const { x, z } of LAMP_POSITIONS) {
      const light = new THREE.PointLight(palette.lampGlow, look.lamps, 11, 2);
      light.position.set(x, layout.sidewalkHeight + 4.1, z);
      this.lamps.add(light);
    }
  }
}
