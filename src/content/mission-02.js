export const MISSION_02_TARGET = 10;
export const MISSION_02_MAX_PUMPS = 2;

export const MISSION_02_TIMING = {
  stepMs: 320,
  spawnMs: 1000,
  ejectMs: 420,
};

export function createMission02Machines() {
  return {
    tank: {
      id: "mission-water-tank",
      type: "water-delivery-tank",
      x: 3,
      y: 1,
      w: 2,
      h: 2,
      acceptedResource: "water",
      received: 0,
      target: MISSION_02_TARGET,
      counterPulseMs: 0,
    },
    generator: {
      id: "mission-electric-generator",
      type: "electric-generator",
      x: 3,
      y: 10,
      w: 2,
      h: 2,
      portFlashMs: [0, 0],
    },
  };
}

export function createPump(id, x, y) {
  return {
    id,
    type: "pump",
    x,
    y,
    w: 1,
    h: 2,
    state: "normal",
    failureType: null,
    failureMs: 0,
    containedResourceType: null,
    contaminationType: null,
    contaminationMs: 0,
    contaminationWarning: false,
    contaminationPortIndex: null,
    connectionCells: [
      { x, y: y - 1 },
      { x, y: y + 2 },
    ],
    capacity: 1,
    storedElectricity: 0,
    chargePulseMs: 0,
    outputPulseMs: 0,
  };
}
