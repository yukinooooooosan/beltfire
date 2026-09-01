import { DIRS, OPPOSITE } from "../content/mission-01.js";
import {
  beltIsConnected,
  directionBetween,
  inBounds,
  isDeviceCell,
  key,
  sameCell,
} from "./grid.js";

export function buildBeltsFromPath(path, sourcePort, targetFurnace) {
  return path.map((cell, index) => {
    const previous = path[index - 1];
    const next = path[index + 1];
    const startsAtGenerator = sourcePort !== null && sourcePort !== undefined;
    const previewInDir = previous
      ? OPPOSITE[directionBetween(previous, cell)]
      : startsAtGenerator ? "D" : null;
    let outDir = next ? directionBetween(cell, next) : null;
    if (!outDir && targetFurnace) outDir = "U";
    if (!outDir && previous) outDir = directionBetween(previous, cell);
    if (!outDir && startsAtGenerator) outDir = "U";
    return {
      x: cell.x,
      y: cell.y,
      previewInDir,
      outDir,
      state: "normal",
      burnMs: 0,
      spreadMs: 0,
    };
  });
}

export function isPathCellAvailable(cell, belts, furnace, generator, currentPath = []) {
  if (!inBounds(cell.x, cell.y) || isDeviceCell(cell, furnace, generator)) return false;
  if (belts.has(key(cell.x, cell.y))) return false;
  return !currentPath.some((item) => sameCell(item, cell));
}

export function connectedAshComponent(start, belts) {
  const startBelt = belts.get(key(start.x, start.y));
  if (!startBelt || startBelt.state !== "ash") return [];
  const found = [];
  const queue = [startBelt];
  const visited = new Set();

  while (queue.length) {
    const current = queue.shift();
    const currentKey = key(current.x, current.y);
    if (visited.has(currentKey)) continue;
    visited.add(currentKey);
    found.push(current);

    for (const dir of Object.keys(DIRS)) {
      const delta = DIRS[dir];
      const neighbor = belts.get(key(current.x + delta.x, current.y + delta.y));
      if (neighbor?.state === "ash" && beltIsConnected(current, neighbor)) queue.push(neighbor);
    }
  }
  return found;
}
