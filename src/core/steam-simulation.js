import { DIRS } from "../content/mission-01.js";
import { MISSION_03_TIMING } from "../content/mission-03.js";
import {
  beginMachineFailure,
  removeResourcesOnFailedBelts,
  triggerStalledFailures,
  updateBeltFailures,
  updateMachineFailures,
} from "./failure.js";
import { key } from "./grid.js";

export function createSteamSimulationState() {
  return {
    resources: [],
    nextResourceId: 1,
    movementAccumulator: 0,
    spawnAccumulators: new Map(),
    completed: false,
  };
}

export function resetSteamSimulation(state) {
  state.resources = [];
  state.nextResourceId = 1;
  state.movementAccumulator = 0;
  state.spawnAccumulators = new Map();
  state.completed = false;
}

export function cellHasSteamResourceOrTransit(state, x, y) {
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

function spawnAccumulatorKey(generator, portIndex) {
  return `${generator.id}:${portIndex}`;
}

function trySpawnResource(state, generator, portIndex, belts, callbacks) {
  const x = generator.x + portIndex;
  const y = generator.y - 1;
  const belt = belts.get(key(x, y));
  if (!belt || belt.state !== "normal" || cellHasResource(state, x, y)) return;

  generator.portFlashMs[portIndex] = MISSION_03_TIMING.ejectMs;
  const resource = createResource(
    state,
    generator.resourceType,
    x,
    y,
    x,
    generator.y,
    {
      sourcePort: portIndex,
      sourceDevice: generator.id,
    },
  );
  state.resources.push(resource);
  callbacks.onSpawn?.(resource, generator);
}

function updateEjections(state, deltaMs) {
  for (const resource of state.resources) {
    if (!resource.ejecting) continue;
    resource.ejectProgress = Math.min(
      1,
      resource.ejectProgress + deltaMs / MISSION_03_TIMING.ejectMs,
    );
    if (resource.ejectProgress >= 1) {
      resource.ejecting = false;
      resource.prevX = resource.x;
      resource.prevY = resource.y;
    }
  }
}

function machineAcceptingAt(x, y, direction, machines) {
  if (direction !== "U") return null;
  return machines.find((machine) => machine.inputPorts.some((port) => (
    port.approach.x === x && port.approach.y === y
  ))) || null;
}

function lampAcceptsAt(x, y, direction, lamp) {
  return direction === "U"
    && y === lamp.y + lamp.h
    && (x === lamp.x || x === lamp.x + 1);
}

function hasBoilerRecipe(machine) {
  return machine.type === "boiler"
    && machine.storedResources.length === 2
    && machine.storedResources.includes("fire")
    && machine.storedResources.includes("water");
}

function machineOutputType(machine) {
  if (hasBoilerRecipe(machine)) return "steam";
  if (machine.type === "turbine" && machine.storedResources[0] === "steam") {
    return "electricity";
  }
  return null;
}

function tryMachineOutputs(state, belts, machines, callbacks) {
  for (const machine of machines) {
    if (machine.state !== "normal") continue;
    const outputType = machineOutputType(machine);
    if (!outputType) continue;
    const { x, y } = machine.outputPort.approach;
    const outputBelt = belts.get(key(x, y));
    if (!outputBelt || outputBelt.state !== "normal" || cellHasResource(state, x, y)) continue;

    machine.storedResources = [];
    machine.outputPulseMs = 320;
    const output = createResource(
      state,
      outputType,
      x,
      y,
      machine.outputPort.sourceCell.x,
      machine.outputPort.sourceCell.y,
      { sourceDevice: machine.id },
    );
    state.resources.push(output);
    callbacks.onMachineOutput?.(machine, output);
  }
}

function stallResource(resource) {
  resource.prevX = resource.x;
  resource.prevY = resource.y;
  resource.stalledMs += MISSION_03_TIMING.stepMs;
}

function completeLamp(state, lamp, resource, callbacks) {
  lamp.received = lamp.target;
  lamp.counterPulseMs = 420;
  callbacks.onDelivery?.(lamp, resource);
  if (!state.completed) {
    state.completed = true;
    callbacks.onComplete?.();
  }
}

function moveResources(state, belts, machines, lamp, callbacks) {
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
      stallResource(resource);
      continue;
    }

    const machine = machineAcceptingAt(resource.x, resource.y, belt.outDir, machines);
    if (machine) {
      if (machine.state !== "normal" || machine.storedResources.length >= machine.capacity) {
        stallResource(resource);
        continue;
      }

      occupied.delete(key(resource.x, resource.y));
      consumedIndexes.add(index);
      if (machine.acceptedResourceTypes.includes(resource.type)) {
        machine.storedResources.push(resource.type);
        machine.inputPulseMs = 320;
        callbacks.onMachineInput?.(machine, resource);
      } else {
        machine.storedResources = [];
        beginMachineFailure(machine, resource, callbacks);
      }
      continue;
    }

    if (lampAcceptsAt(resource.x, resource.y, belt.outDir, lamp)) {
      if (resource.type === lamp.acceptedResource) {
        occupied.delete(key(resource.x, resource.y));
        consumedIndexes.add(index);
        completeLamp(state, lamp, resource, callbacks);
      } else {
        stallResource(resource);
      }
      continue;
    }

    const delta = DIRS[belt.outDir];
    const next = { x: resource.x + delta.x, y: resource.y + delta.y };
    const nextBelt = belts.get(key(next.x, next.y));
    if (nextBelt?.state === "normal" && !occupied.has(key(next.x, next.y))) {
      occupied.delete(key(resource.x, resource.y));
      resource.prevX = resource.x;
      resource.prevY = resource.y;
      resource.x = next.x;
      resource.y = next.y;
      resource.stalledMs = 0;
      occupied.add(key(resource.x, resource.y));
    } else {
      stallResource(resource);
    }
  }

  state.resources = state.resources.filter((_, index) => !consumedIndexes.has(index));
  state.resources = triggerStalledFailures(state.resources, belts, callbacks);
}

export function updateSteamSimulation(state, deltaMs, options) {
  const {
    belts,
    generators,
    machines,
    lamp,
    callbacks = {},
  } = options;

  lamp.counterPulseMs = Math.max(0, lamp.counterPulseMs - deltaMs);
  for (const machine of machines) {
    machine.inputPulseMs = Math.max(0, machine.inputPulseMs - deltaMs);
    machine.outputPulseMs = Math.max(0, machine.outputPulseMs - deltaMs);
  }
  updateMachineFailures(deltaMs, machines, callbacks);

  for (const generator of generators) {
    for (let port = 0; port < 2; port += 1) {
      generator.portFlashMs[port] = Math.max(0, generator.portFlashMs[port] - deltaMs);
      const accumulatorKey = spawnAccumulatorKey(generator, port);
      const elapsed = (state.spawnAccumulators.get(accumulatorKey) || 0) + deltaMs;
      if (elapsed >= MISSION_03_TIMING.spawnMs) {
        state.spawnAccumulators.set(accumulatorKey, elapsed % MISSION_03_TIMING.spawnMs);
        trySpawnResource(state, generator, port, belts, callbacks);
      } else {
        state.spawnAccumulators.set(accumulatorKey, elapsed);
      }
    }
  }

  updateEjections(state, deltaMs);
  tryMachineOutputs(state, belts, machines, callbacks);
  state.movementAccumulator += deltaMs;
  while (state.movementAccumulator >= MISSION_03_TIMING.stepMs) {
    state.movementAccumulator -= MISSION_03_TIMING.stepMs;
    moveResources(state, belts, machines, lamp, callbacks);
    tryMachineOutputs(state, belts, machines, callbacks);
  }
  updateBeltFailures(deltaMs, belts, callbacks);
  state.resources = removeResourcesOnFailedBelts(state.resources, belts);
}
