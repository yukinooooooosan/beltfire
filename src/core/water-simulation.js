import { DIRS } from "../content/mission-01.js";
import { MISSION_02_TIMING } from "../content/mission-02.js";
import {
  removeResourcesOnFailedBelts,
  triggerStalledFailures,
  updateBeltFailures,
} from "./failure.js";
import { key } from "./grid.js";

export function createWaterSimulationState() {
  return {
    resources: [],
    nextResourceId: 1,
    movementAccumulator: 0,
    spawnAccumulator: [0, 0],
  };
}

export function resetWaterSimulation(state) {
  state.resources = [];
  state.nextResourceId = 1;
  state.movementAccumulator = 0;
  state.spawnAccumulator = [0, 0];
}

export function cellHasResourceOrTransit(state, x, y) {
  return state.resources.some((resource) => (
    (resource.x === x && resource.y === y)
    || (resource.prevX === x && resource.prevY === y)
  ));
}

function cellHasResource(state, x, y) {
  return state.resources.some((resource) => resource.x === x && resource.y === y);
}

function createResource(state, type, x, y, prevX, prevY, extra = {}) {
  const resource = {
    id: state.nextResourceId,
    type,
    x,
    y,
    prevX,
    prevY,
    stalledMs: 0,
    ejecting: true,
    ejectProgress: 0,
    ...extra,
  };
  state.nextResourceId += 1;
  return resource;
}

function trySpawnElectricity(state, portIndex, belts, generator, onSpawn) {
  const x = generator.x + portIndex;
  const y = generator.y - 1;
  const belt = belts.get(key(x, y));
  if (!belt || belt.state !== "normal" || cellHasResource(state, x, y)) return;
  generator.portFlashMs[portIndex] = MISSION_02_TIMING.ejectMs;
  const resource = createResource(
    state,
    "electricity",
    x,
    y,
    x,
    generator.y,
    { sourcePort: portIndex, sourceDevice: generator.id },
  );
  state.resources.push(resource);
  onSpawn?.(resource, generator);
}

function updateEjections(state, deltaMs) {
  for (const resource of state.resources) {
    if (!resource.ejecting) continue;
    resource.ejectProgress = Math.min(
      1,
      resource.ejectProgress + deltaMs / MISSION_02_TIMING.ejectMs,
    );
    if (resource.ejectProgress >= 1) {
      resource.ejecting = false;
      resource.prevX = resource.x;
      resource.prevY = resource.y;
    }
  }
}

function pumpAcceptingAt(x, y, direction, pumps) {
  if (direction !== "U") return null;
  return pumps.find((pump) => x === pump.x && y === pump.y + pump.h) || null;
}

function tankAccepts(x, y, direction, tank) {
  return direction === "U"
    && y === tank.y + tank.h
    && (x === tank.x || x === tank.x + 1);
}

function tryPumpOutputs(state, belts, pumps, callbacks) {
  for (const pump of pumps) {
    if (pump.storedElectricity <= 0) continue;
    const x = pump.x;
    const y = pump.y - 1;
    const outputBelt = belts.get(key(x, y));
    if (!outputBelt || outputBelt.state !== "normal" || cellHasResource(state, x, y)) continue;

    pump.storedElectricity -= 1;
    pump.outputPulseMs = 320;
    const water = createResource(
      state,
      "water",
      x,
      y,
      x,
      pump.y,
      { sourceDevice: pump.id },
    );
    state.resources.push(water);
    callbacks.onPumpOutput?.(pump, water);
  }
}

function moveResources(state, belts, pumps, tank, callbacks) {
  if (!state.resources.length) return;
  const occupied = new Set(state.resources.map((resource) => key(resource.x, resource.y)));
  const consumedIndexes = new Set();
  const order = [...state.resources.keys()].sort(
    (a, b) => state.resources[a].y - state.resources[b].y,
  );

  for (const index of order) {
    const resource = state.resources[index];
    if (resource.ejecting || consumedIndexes.has(index)) continue;
    const belt = belts.get(key(resource.x, resource.y));
    if (!belt || belt.state !== "normal" || !belt.outDir) {
      resource.prevX = resource.x;
      resource.prevY = resource.y;
      resource.stalledMs += MISSION_02_TIMING.stepMs;
      continue;
    }

    const pump = pumpAcceptingAt(resource.x, resource.y, belt.outDir, pumps);
    if (pump) {
      if (resource.type === "electricity" && pump.storedElectricity < pump.capacity) {
        occupied.delete(key(resource.x, resource.y));
        consumedIndexes.add(index);
        pump.storedElectricity += 1;
        pump.chargePulseMs = 320;
        callbacks.onPumpCharge?.(pump, resource);
      } else {
        resource.prevX = resource.x;
        resource.prevY = resource.y;
        resource.stalledMs += MISSION_02_TIMING.stepMs;
      }
      continue;
    }

    if (tankAccepts(resource.x, resource.y, belt.outDir, tank)) {
      if (resource.type === "water") {
        occupied.delete(key(resource.x, resource.y));
        consumedIndexes.add(index);
        tank.received += 1;
        tank.counterPulseMs = 300;
        callbacks.onDelivery?.(tank, resource);
      } else {
        resource.prevX = resource.x;
        resource.prevY = resource.y;
        resource.stalledMs += MISSION_02_TIMING.stepMs;
      }
      continue;
    }

    const delta = DIRS[belt.outDir];
    const next = { x: resource.x + delta.x, y: resource.y + delta.y };
    const nextBelt = belts.get(key(next.x, next.y));
    const canEnter = nextBelt
      && nextBelt.state === "normal"
      && !occupied.has(key(next.x, next.y));

    if (canEnter) {
      occupied.delete(key(resource.x, resource.y));
      resource.prevX = resource.x;
      resource.prevY = resource.y;
      resource.x = next.x;
      resource.y = next.y;
      resource.stalledMs = 0;
      occupied.add(key(resource.x, resource.y));
    } else {
      resource.prevX = resource.x;
      resource.prevY = resource.y;
      resource.stalledMs += MISSION_02_TIMING.stepMs;
    }
  }

  state.resources = state.resources.filter((_, index) => !consumedIndexes.has(index));
  state.resources = triggerStalledFailures(state.resources, belts, callbacks);
  if (tank.received >= tank.target) callbacks.onComplete?.();
}

export function updateWaterSimulation(state, deltaMs, options) {
  const { belts, generator, pumps, tank, callbacks = {} } = options;

  tank.counterPulseMs = Math.max(0, tank.counterPulseMs - deltaMs);
  for (const pump of pumps) {
    pump.chargePulseMs = Math.max(0, pump.chargePulseMs - deltaMs);
    pump.outputPulseMs = Math.max(0, pump.outputPulseMs - deltaMs);
  }
  for (let port = 0; port < 2; port += 1) {
    generator.portFlashMs[port] = Math.max(0, generator.portFlashMs[port] - deltaMs);
    state.spawnAccumulator[port] += deltaMs;
    if (state.spawnAccumulator[port] >= MISSION_02_TIMING.spawnMs) {
      state.spawnAccumulator[port] %= MISSION_02_TIMING.spawnMs;
      trySpawnElectricity(state, port, belts, generator, callbacks.onSpawn);
    }
  }

  updateEjections(state, deltaMs);
  tryPumpOutputs(state, belts, pumps, callbacks);
  state.movementAccumulator += deltaMs;
  while (state.movementAccumulator >= MISSION_02_TIMING.stepMs) {
    state.movementAccumulator -= MISSION_02_TIMING.stepMs;
    moveResources(state, belts, pumps, tank, callbacks);
    tryPumpOutputs(state, belts, pumps, callbacks);
  }
  updateBeltFailures(deltaMs, belts, callbacks);
  state.resources = removeResourcesOnFailedBelts(state.resources, belts);
}
