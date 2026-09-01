export const GRID = { cols: 8, rows: 13 };
export const TARGET = 10;
export const MAX_CLEANUPS = 3;

export const TIMING = {
  stepMs: 320,
  spawnMs: 1000,
  ejectMs: 420,
  warningMs: 1900,
  igniteMs: 3600,
  burnMs: 1650,
  spreadMs: 520,
};

export const DIRS = {
  U: { x: 0, y: -1 },
  R: { x: 1, y: 0 },
  D: { x: 0, y: 1 },
  L: { x: -1, y: 0 },
};

export const OPPOSITE = { U: "D", R: "L", D: "U", L: "R" };

export function createMissionMachines() {
  return {
    furnace: {
      id: "mission-furnace",
      type: "furnace",
      x: 3,
      y: 1,
      w: 2,
      h: 2,
      acceptedResource: "fire",
      received: 0,
      target: TARGET,
      counterPulseMs: 0,
    },
    generator: {
      id: "mission-fire-generator",
      type: "fire-generator",
      x: 3,
      y: 10,
      w: 2,
      h: 2,
      portFlashMs: [0, 0],
    },
  };
}
