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
      failureType: null,
      failureMs: 0,
    };
  });
}

export function isPathCellAvailable(cell, belts, furnace, generator, currentPath = []) {
  if (!inBounds(cell.x, cell.y) || isDeviceCell(cell, furnace, generator)) return false;
  if (belts.has(key(cell.x, cell.y))) return false;
  return !currentPath.some((item) => sameCell(item, cell));
}

export function connectedBrokenComponent(start, belts) {
  return connectedBrokenNetwork(start, belts).belts;
}

function deviceContainsCell(device, cell) {
  if (device.cells) {
    return device.cells.some((deviceCell) => sameCell(deviceCell, cell));
  }
  return cell.x >= device.x
    && cell.x < device.x + device.w
    && cell.y >= device.y
    && cell.y < device.y + device.h;
}

export function connectedBrokenNetwork(start, belts, devices = []) {
  const startBelt = belts.get(key(start.x, start.y));
  const startDevice = devices.find((device) => (
    device.state === "broken" && deviceContainsCell(device, start)
  ));
  if (startBelt?.state !== "broken" && !startDevice) {
    return { belts: [], devices: [] };
  }
  const foundBelts = [];
  const foundDevices = [];
  const queue = startDevice
    ? [{ kind: "device", value: startDevice }]
    : [{ kind: "belt", value: startBelt }];
  const visited = new Set();

  while (queue.length) {
    const current = queue.shift();
    const nodeKey = current.kind === "belt"
      ? `belt:${key(current.value.x, current.value.y)}`
      : `device:${current.value.id}`;
    if (visited.has(nodeKey)) continue;
    visited.add(nodeKey);

    if (current.kind === "belt") {
      const belt = current.value;
      foundBelts.push(belt);
      for (const dir of Object.keys(DIRS)) {
        const delta = DIRS[dir];
        const neighbor = belts.get(key(belt.x + delta.x, belt.y + delta.y));
        if (neighbor?.state === "broken" && beltIsConnected(belt, neighbor)) {
          queue.push({ kind: "belt", value: neighbor });
        }
      }
      for (const device of devices) {
        if (
          device.state === "broken"
          && device.connectionCells?.some((cell) => cell.x === belt.x && cell.y === belt.y)
        ) {
          queue.push({ kind: "device", value: device });
        }
      }
    } else {
      const device = current.value;
      foundDevices.push(device);
      for (const cell of device.connectionCells || []) {
        const belt = belts.get(key(cell.x, cell.y));
        if (belt?.state === "broken") queue.push({ kind: "belt", value: belt });
      }
    }
  }
  return { belts: foundBelts, devices: foundDevices };
}
