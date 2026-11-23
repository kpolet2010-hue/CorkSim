/**
 * Grab catalogue. Grabs are data-driven: each grab is triggered by a combination of grab buttons and
 * describes which hand reaches for which part of which ski. Add entries here to extend the system.
 */
export type GrabButton = 'grab1' | 'grab2' | 'grab3' | 'grab4';

export interface GrabTarget {
  hand: 'left' | 'right';
  /** Which ski the hand grabs. */
  ski: 'left' | 'right';
  /** Position along the ski: -1 tail .. 0 binding .. +1 tip. */
  along: number;
  /** -1 inside edge .. +1 outside edge. */
  edge: number;
}

export interface GrabDefinition {
  id: string;
  name: string;
  /** Exact set of buttons that triggers the grab. */
  buttons: GrabButton[];
  targets: GrabTarget[];
  /** How much the knees tuck towards the chest (0..1). */
  tuck: number;
  /** Ski tweak angle in degrees (crossing / poking the skis for style). */
  tweak: number;
  /** Base score of the grab. */
  baseScore: number;
}

export const GRAB_DEFINITIONS: readonly GrabDefinition[] = [
  {
    id: 'mute',
    name: 'Mute',
    buttons: ['grab1'],
    targets: [{ hand: 'left', ski: 'right', along: 0.25, edge: 1 }],
    tuck: 0.8,
    tweak: 8,
    baseScore: 150,
  },
  {
    id: 'safety',
    name: 'Safety',
    buttons: ['grab2'],
    targets: [{ hand: 'right', ski: 'right', along: 0, edge: 1 }],
    tuck: 0.7,
    tweak: 0,
    baseScore: 110,
  },
  {
    id: 'tail',
    name: 'Tail Grab',
    buttons: ['grab3'],
    targets: [{ hand: 'right', ski: 'right', along: -0.85, edge: 0 }],
    tuck: 0.55,
    tweak: 0,
    baseScore: 140,
  },
  {
    id: 'method',
    name: 'Method',
    buttons: ['grab4'],
    targets: [{ hand: 'left', ski: 'left', along: -0.3, edge: 1 }],
    tuck: 0.9,
    tweak: 22,
    baseScore: 190,
  },
  {
    id: 'japan',
    name: 'Japan',
    buttons: ['grab1', 'grab2'],
    targets: [{ hand: 'left', ski: 'right', along: 0.45, edge: -1 }],
    tuck: 0.95,
    tweak: 30,
    baseScore: 220,
  },
  {
    id: 'nose',
    name: 'Nose Grab',
    buttons: ['grab1', 'grab3'],
    targets: [{ hand: 'right', ski: 'right', along: 0.9, edge: 0 }],
    tuck: 0.65,
    tweak: 0,
    baseScore: 170,
  },
  {
    id: 'truckdriver',
    name: 'Truck Driver',
    buttons: ['grab2', 'grab3'],
    targets: [
      { hand: 'left', ski: 'left', along: 0.1, edge: 1 },
      { hand: 'right', ski: 'right', along: 0.1, edge: 1 },
    ],
    tuck: 0.85,
    tweak: 0,
    baseScore: 210,
  },
  {
    id: 'luikang',
    name: 'Lui Kang',
    buttons: ['grab1', 'grab2', 'grab3'],
    targets: [{ hand: 'right', ski: 'right', along: 0.2, edge: 1 }],
    tuck: 0.4,
    tweak: 40,
    baseScore: 260,
  },
];

export function findGrab(buttons: ReadonlySet<GrabButton>): GrabDefinition | null {
  if (buttons.size === 0) return null;
  for (const g of GRAB_DEFINITIONS) {
    if (g.buttons.length === buttons.size && g.buttons.every((b) => buttons.has(b))) return g;
  }
  // Fallback: unknown combination → grab matching the first button pressed.
  for (const g of GRAB_DEFINITIONS) {
    if (g.buttons.length === 1 && buttons.has(g.buttons[0])) return g;
  }
  return null;
}

export function getGrabById(id: string): GrabDefinition | undefined {
  return GRAB_DEFINITIONS.find((g) => g.id === id);
}
