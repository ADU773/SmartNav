/**
 * SmartNav360 — Connection Access Modes
 * How a visitor physically traverses a connection between two scenes.
 *
 * Must stay in sync with the `access` enum in backend/models/Scene.js and
 * ACCESS_MODES in backend/services/integrity.js. The route finder weights
 * every mode, and excludes the ones a visitor asks to avoid.
 */

export const ACCESS_MODES = [
  { value: 'flat', label: 'Flat floor' },
  { value: 'door', label: 'Door' },
  { value: 'ramp', label: 'Ramp' },
  { value: 'elevator', label: 'Elevator' },
  { value: 'escalator', label: 'Escalator' },
  { value: 'stairs', label: 'Stairs' },
];

export const DEFAULT_ACCESS_MODE = 'flat';

/** Modes a step-free route must exclude. */
export const STEP_FREE_EXCLUSIONS = ['stairs', 'escalator'];
