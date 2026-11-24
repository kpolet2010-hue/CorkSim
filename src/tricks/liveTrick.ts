import { RAD2DEG } from '../core/math';
import type { PlayerController } from '../player/PlayerController';

/**
 * Human-readable name of the trick in progress (shown live in the HUD while airborne or grinding). Pure read of
 * the simulation state. Owned by physics/tricks so the live name stays consistent with landing recognition.
 */
export function liveTrickLabel(p: PlayerController): string {
  if (p.state === 'AIRBORNE' && p.rotation.active) {
    const spin = Math.abs(p.rotation.spin * RAD2DEG);
    const total = p.rotation.total * RAD2DEG;
    const parts: string[] = [];
    if (p.rotation.inversions > 0 && spin > 120)
      parts.push(`${p.rotation.inversions > 1 ? 'Double ' : ''}Cork ${Math.round(total / 10) * 10}°`);
    else if (p.rotation.inversions > 0) parts.push(`${p.rotation.inversions > 1 ? 'Double ' : ''}Flip`);
    else if (spin > 90) parts.push(`${Math.round(spin / 10) * 10}°`);
    const cur = p.grabs.current;
    if (cur) parts.push(cur.name);
    for (const gr of p.grabs.completed) if (!cur || gr.id !== cur.id) parts.push(gr.name);
    return parts.join(' · ');
  }
  if (p.state === 'RAIL_GRINDING' && p.rails.grind) {
    const gr = p.rails.grind;
    let live =
      gr.press === 'nose'
        ? 'Nose Slide'
        : gr.press === 'tail'
          ? 'Tail Slide'
          : gr.stance === 'slide'
            ? 'Boardslide'
            : gr.stance === 'switchFifty'
              ? 'Switch 50-50'
              : '50-50';
    if (gr.entrySpinDeg > 0) live = `${gr.entrySpinDeg} On ${live}`;
    return live;
  }
  return '';
}
