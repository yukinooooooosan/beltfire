import { DIRS, TIMING } from "../content/mission-01.js";
import {
  removeResourcesOnFailedBelts,
  triggerStalledFailures,
  updateBeltFailures,
} from "./failure.js";
import { key } from "./grid.js";

export function createSimulationState() {
  return {
    fires: [],
    nextFireId: 1,
    movementAccumulator: 0,
    spawnAccumulator: [0, 0],
  };
}

export function resetSimulation(state) {
  state.fires = [];
  state.nextFireId = 1;
  state.movementAccumulator = 0;
  state.spawnAccumulator = [0, 0];
}

export function cellHasFire(state, x, y) {
  return state.fires.some((fire) => fire.x === x && fire.y === y);
}

export function cellHasFireOrTransit(state, x, y) {
  return state.fires.some((fire) => (
    (fire.x === x && fire.y === y)
    || (fire.prevX === x && fire.prevY === y)
  ));
}

function trySpawn(state, portIndex, belts, generator, onSpawn) {
  const x = generator.x + portIndex;
  const y = generator.y - 1;
  const belt = belts.get(key(x, y));
  if (!belt || belt.state !== "normal" || cellHasFire(state, x, y)) return;
  generator.portFlashMs[portIndex] = TIMING.ejectMs;
  const fire = {
    id: state.nextFireId,
    type: "fire",
    x,
    y,
    prevX: x,
    prevY: generator.y,
    stalledMs: 0,
    ejecting: true,
    ejectProgress: 0,
    sourcePort: portIndex,
  };
  state.nextFireId += 1;
  state.fires.push(fire);
  onSpawn?.(fire, generator);
}

function updateEjections(state, deltaMs) {
  for (const fire of state.fires) {
    if (!fire.ejecting) continue;
    fire.ejectProgress = Math.min(1, fire.ejectProgress + deltaMs / TIMING.ejectMs);
    if (fire.ejectProgress >= 1) {
      fire.ejecting = false;
      fire.prevX = fire.x;
      fire.prevY = fire.y;
    }
  }
}

function furnaceAccepts(x, y, direction, furnace) {
  return direction === "U"
    && y === furnace.y + furnace.h
    && (x === furnace.x || x === furnace.x + 1);
}

function moveFires(state, belts, furnace, callbacks) {
  if (!state.fires.length) return;
  const occupied = new Set(state.fires.map((fire) => key(fire.x, fire.y)));
  const deliveredIndexes = new Set();
  const order = [...state.fires.keys()].sort((a, b) => state.fires[a].y - state.fires[b].y);

  for (const index of order) {
    const fire = state.fires[index];
    if (fire.ejecting) continue;
    const belt = belts.get(key(fire.x, fire.y));
    if (!belt || belt.state !== "normal" || !belt.outDir) {
      fire.prevX = fire.x;
      fire.prevY = fire.y;
      fire.stalledMs += TIMING.stepMs;
      continue;
    }

    const delta = DIRS[belt.outDir];
    const next = { x: fire.x + delta.x, y: fire.y + delta.y };
    if (furnaceAccepts(fire.x, fire.y, belt.outDir, furnace)) {
      occupied.delete(key(fire.x, fire.y));
      deliveredIndexes.add(index);
      furnace.received += 1;
      furnace.counterPulseMs = 300;
      callbacks.onDelivery?.(furnace, fire);
      continue;
    }

    const nextBelt = belts.get(key(next.x, next.y));
    const canEnter = nextBelt
      && nextBelt.state === "normal"
      && !occupied.has(key(next.x, next.y));

    if (canEnter) {
      occupied.delete(key(fire.x, fire.y));
      fire.prevX = fire.x;
      fire.prevY = fire.y;
      fire.x = next.x;
      fire.y = next.y;
      fire.stalledMs = 0;
      occupied.add(key(fire.x, fire.y));
    } else {
      fire.prevX = fire.x;
      fire.prevY = fire.y;
      fire.stalledMs += TIMING.stepMs;
    }
  }

  state.fires = state.fires.filter((_, index) => !deliveredIndexes.has(index));
  state.fires = triggerStalledFailures(state.fires, belts, callbacks);
  if (furnace.received >= furnace.target) callbacks.onComplete?.();
}

export function updateSimulation(state, deltaMs, options) {
  const { belts, furnace, generator, callbacks = {} } = options;

  furnace.counterPulseMs = Math.max(0, furnace.counterPulseMs - deltaMs);
  for (let port = 0; port < 2; port += 1) {
    generator.portFlashMs[port] = Math.max(0, generator.portFlashMs[port] - deltaMs);
    state.spawnAccumulator[port] += deltaMs;
    if (state.spawnAccumulator[port] >= TIMING.spawnMs) {
      state.spawnAccumulator[port] %= TIMING.spawnMs;
      trySpawn(state, port, belts, generator, callbacks.onSpawn);
    }
  }

  updateEjections(state, deltaMs);
  state.movementAccumulator += deltaMs;
  while (state.movementAccumulator >= TIMING.stepMs) {
    state.movementAccumulator -= TIMING.stepMs;
    moveFires(state, belts, furnace, callbacks);
  }
  updateBeltFailures(deltaMs, belts, callbacks);
  state.fires = removeResourcesOnFailedBelts(state.fires, belts);
}
