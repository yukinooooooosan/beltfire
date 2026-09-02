export const MISSION_03_TARGET = 10;

export const MISSION_03_INVENTORY = {
  boiler: 1,
  turbine: 1,
};

export const MISSION_03_TIMING = {
  stepMs: 320,
  spawnMs: 1050,
  ejectMs: 420,
};

export function createMission03Machines() {
  return {
    lamp: {
      id: "mission-lamp",
      type: "lamp",
      x: 3,
      y: 0,
      w: 2,
      h: 2,
      acceptedResource: "electricity",
      received: 0,
      target: MISSION_03_TARGET,
      counterPulseMs: 0,
    },
    generators: [
      {
        id: "mission-fire-generator",
        type: "fire-generator",
        resourceType: "fire",
        label: "炎発生装置",
        x: 0,
        y: 10,
        w: 2,
        h: 2,
        portFlashMs: [0, 0],
      },
      {
        id: "mission-water-generator",
        type: "water-generator",
        resourceType: "water",
        label: "水発生装置",
        x: 6,
        y: 10,
        w: 2,
        h: 2,
        portFlashMs: [0, 0],
      },
    ],
  };
}

export function createBoiler(id, x, y) {
  return {
    id,
    type: "boiler",
    label: "ボイラー",
    x,
    y,
    w: 2,
    h: 2,
    cells: [
      { x, y },
      { x, y: y + 1 },
      { x: x + 1, y: y + 1 },
    ],
    inputPorts: [
      { approach: { x, y: y + 2 }, targetCell: { x, y: y + 1 } },
      { approach: { x: x + 1, y: y + 2 }, targetCell: { x: x + 1, y: y + 1 } },
    ],
    outputPort: {
      approach: { x, y: y - 1 },
      sourceCell: { x, y },
    },
    connectionCells: [
      { x, y: y - 1 },
      { x, y: y + 2 },
      { x: x + 1, y: y + 2 },
    ],
    acceptedResourceTypes: ["fire", "water"],
    capacity: 2,
    storedSlots: [null, null],
    storedResources: [],
    state: "normal",
    failureType: null,
    failureMs: 0,
    containedResourceType: null,
    contaminationType: null,
    contaminationMs: 0,
    contaminationWarning: false,
    contaminationPortIndex: null,
    inputPulseMs: 0,
    outputPulseMs: 0,
  };
}

export function createTurbine(id, x, y) {
  return {
    id,
    type: "turbine",
    label: "タービン",
    x,
    y,
    w: 1,
    h: 2,
    cells: [
      { x, y },
      { x, y: y + 1 },
    ],
    inputPorts: [
      { approach: { x, y: y + 2 }, targetCell: { x, y: y + 1 } },
    ],
    outputPort: {
      approach: { x, y: y - 1 },
      sourceCell: { x, y },
    },
    connectionCells: [
      { x, y: y - 1 },
      { x, y: y + 2 },
    ],
    acceptedResourceTypes: ["steam"],
    capacity: 1,
    storedSlots: [null],
    storedResources: [],
    state: "normal",
    failureType: null,
    failureMs: 0,
    containedResourceType: null,
    contaminationType: null,
    contaminationMs: 0,
    contaminationWarning: false,
    contaminationPortIndex: null,
    inputPulseMs: 0,
    outputPulseMs: 0,
  };
}
