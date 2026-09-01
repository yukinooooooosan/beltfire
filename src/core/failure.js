import { DIRS } from "../content/mission-01.js";
import { beltIsConnected, key } from "./grid.js";

export const MAX_CLEANUPS = 3;

export const FAILURE_TIMING = {
  warningMs: 1900,
  triggerMs: 3600,
  failingMs: 1650,
  spreadMs: 520,
};

function beginFailure(belt, failureType, onFailureStart) {
  if (!belt || belt.state !== "normal") return false;
  belt.state = "failing";
  belt.failureType = failureType;
  belt.failureMs = 0;
  belt.spreadMs = 0;
  onFailureStart?.(belt, failureType);
  return true;
}

export function triggerStalledFailures(resources, belts, callbacks = {}) {
  const survivors = [];
  for (const resource of resources) {
    if (resource.stalledMs < FAILURE_TIMING.triggerMs) {
      survivors.push(resource);
      continue;
    }
    const belt = belts.get(key(resource.x, resource.y));
    beginFailure(belt, resource.type || "fire", callbacks.onFailureStart);
  }
  return survivors;
}

export function updateBeltFailures(deltaMs, belts, callbacks = {}) {
  const failing = [...belts.values()].filter((belt) => belt.state === "failing");
  const toSpread = [];
  const becameBroken = [];

  for (const belt of failing) {
    belt.failureMs += deltaMs;
    belt.spreadMs += deltaMs;
    if (belt.spreadMs >= FAILURE_TIMING.spreadMs) {
      belt.spreadMs = 0;
      for (const direction of Object.keys(DIRS)) {
        const delta = DIRS[direction];
        const neighbor = belts.get(key(belt.x + delta.x, belt.y + delta.y));
        if (neighbor?.state === "normal" && beltIsConnected(belt, neighbor)) {
          toSpread.push({ belt: neighbor, failureType: belt.failureType });
        }
      }
    }
    if (belt.failureMs >= FAILURE_TIMING.failingMs) {
      belt.state = "broken";
      belt.failureMs = 0;
      belt.spreadMs = 0;
      becameBroken.push(belt);
    }
  }

  for (const item of toSpread) {
    beginFailure(item.belt, item.failureType, callbacks.onFailureStart);
  }
  for (const belt of becameBroken) callbacks.onBroken?.(belt, belt.failureType);
}

export function removeResourcesOnFailedBelts(resources, belts) {
  return resources.filter((resource) => (
    belts.get(key(resource.x, resource.y))?.state === "normal"
  ));
}
