import { DIRS, GRID, OPPOSITE } from "../content/mission-01.js";

export function key(x, y) {
  return `${x},${y}`;
}

export function sameCell(a, b) {
  return a && b && a.x === b.x && a.y === b.y;
}

export function directionBetween(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 1 && dy === 0) return "R";
  if (dx === -1 && dy === 0) return "L";
  if (dx === 0 && dy === 1) return "D";
  if (dx === 0 && dy === -1) return "U";
  return null;
}

export function inBounds(x, y) {
  return x >= 0 && x < GRID.cols && y >= 0 && y < GRID.rows;
}

export function inRect(cell, rect) {
  return cell.x >= rect.x
    && cell.x < rect.x + rect.w
    && cell.y >= rect.y
    && cell.y < rect.y + rect.h;
}

export function isDeviceCell(cell, furnace, generator) {
  return inRect(cell, furnace) || inRect(cell, generator);
}

export function isGeneratorPort(cell, generator) {
  return cell.y === generator.y && (cell.x === generator.x || cell.x === generator.x + 1);
}

export function isFurnaceInput(cell, furnace) {
  return cell.y === furnace.y + furnace.h - 1
    && (cell.x === furnace.x || cell.x === furnace.x + 1);
}

export function beltIsConnected(a, b) {
  const fromAToB = directionBetween(a, b);
  if (!fromAToB) return false;
  return a.outDir === fromAToB || b.outDir === OPPOSITE[fromAToB];
}

export function beltFeedsFurnace(belt, furnace) {
  return belt?.outDir === "U"
    && belt.y === furnace.y + furnace.h
    && (belt.x === furnace.x || belt.x === furnace.x + 1);
}

export function isTerminalBelt(belt, belts, furnace) {
  if (!belt || belt.state !== "normal") return false;
  if (!belt.outDir) return true;
  if (beltFeedsFurnace(belt, furnace)) return false;
  const delta = DIRS[belt.outDir];
  return !belts.has(key(belt.x + delta.x, belt.y + delta.y));
}

export function incomingBeltDirections(belt, belts, generator) {
  const dirs = [];
  for (const dir of Object.keys(DIRS)) {
    const delta = DIRS[dir];
    const neighbor = belts.get(key(belt.x + delta.x, belt.y + delta.y));
    if (neighbor && neighbor.outDir === OPPOSITE[dir]) dirs.push(dir);
  }
  if (
    belt.y === generator.y - 1
    && (belt.x === generator.x || belt.x === generator.x + 1)
  ) {
    dirs.push("D");
  }
  return dirs;
}
