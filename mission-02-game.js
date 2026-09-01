import { GRID } from "./src/content/mission-01.js";
import {
  MISSION_02_MAX_PUMPS,
  createMission02Machines,
  createPump,
} from "./src/content/mission-02.js";
import {
  buildBeltsFromPath,
  connectedBrokenComponent,
} from "./src/core/construction.js";
import { MAX_CLEANUPS } from "./src/core/failure.js";
import {
  inBounds,
  inRect,
  key,
  sameCell,
} from "./src/core/grid.js";
import {
  cellHasResourceOrTransit,
  createWaterSimulationState,
  resetWaterSimulation,
  updateWaterSimulation,
} from "./src/core/water-simulation.js";
import { createPhaserRenderer } from "./src/render/phaser-renderer.js";

const canvas = document.querySelector("#game-canvas");
const boardWrap = document.querySelector(".board-wrap");
const deliveredCount = document.querySelector("#delivered-count");
const cleanupCount = document.querySelector("#cleanup-count");
const cleanupStat = document.querySelector(".stat-cleanup");
const missionLabel = document.querySelector("#mission-label");
const missionTitle = document.querySelector("#mission-title");
const resourceStatIcon = document.querySelector("#resource-stat-icon");
const toolbar = document.querySelector(".toolbar");
const beltTool = document.querySelector("#belt-tool");
const pumpTool = document.querySelector("#pump-tool");
const pumpCount = document.querySelector("#pump-count");
const removeTool = document.querySelector("#remove-tool");
const resetButton = document.querySelector("#reset-button");
const replayButton = document.querySelector("#replay-button");
const nextMissionButton = document.querySelector("#next-mission-button");
const clearPanel = document.querySelector("#clear-panel");
const clearResourceIcon = document.querySelector("#clear-resource-icon");
const clearTitle = document.querySelector("#clear-title");
const clearDetail = document.querySelector("#clear-detail");
const guideText = document.querySelector("#guide-text");
const guideIcon = document.querySelector("#guide-icon");
const toast = document.querySelector("#toast");
const pauseState = document.querySelector("#pause-state");
const pauseButton = document.querySelector("#pause-button");
const pauseButtonIcon = document.querySelector("#pause-button-icon");

document.title = "BELT FIRE — 貯水タンクへ水を届けよう";
document.body.classList.add("water-mission");
missionLabel.textContent = "MISSION 02";
missionTitle.textContent = "貯水タンクへ水を届けよう";
resourceStatIcon.textContent = "💧";
cleanupStat.hidden = false;
cleanupStat.title = "故障ベルトの一括撤去可能数";
cleanupCount.textContent = MAX_CLEANUPS;
pumpTool.hidden = false;
toolbar.classList.add("four-tools");
clearResourceIcon.textContent = "💧";
clearTitle.textContent = "水を10個届けました！";
nextMissionButton.hidden = true;

const { tank, generator } = createMission02Machines();
const simulation = createWaterSimulationState();
const renderer = createPhaserRenderer({ canvas, boardWrap });

let belts = new Map();
let pumps = [];
let pumpInventory = MISSION_02_MAX_PUMPS;
let cleanupUses = MAX_CLEANUPS;
let nextPumpId = 1;
let tool = "pump";
let drag = null;
let lastFrame = performance.now();
let cleared = false;
let toastTimer = null;
let paused = true;
let autoPaused = false;

function deviceAt(cell) {
  if (inRect(cell, tank)) return tank;
  if (inRect(cell, generator)) return generator;
  return pumps.find((pump) => inRect(cell, pump)) || null;
}

function isDeviceCell(cell) {
  return Boolean(deviceAt(cell));
}

function isGeneratorOutput(cell) {
  return cell.y === generator.y
    && (cell.x === generator.x || cell.x === generator.x + 1);
}

function pumpOutputAt(cell) {
  return pumps.find((pump) => cell.x === pump.x && cell.y === pump.y) || null;
}

function inputTargetAt(cell) {
  if (
    cell.y === tank.y + tank.h - 1
    && (cell.x === tank.x || cell.x === tank.x + 1)
  ) {
    return {
      device: tank,
      approach: { x: cell.x, y: tank.y + tank.h },
      targetCell: { ...cell },
    };
  }
  const pump = pumps.find((item) => (
    cell.x === item.x && cell.y === item.y + item.h - 1
  ));
  if (!pump) return null;
  return {
    device: pump,
    approach: { x: pump.x, y: pump.y + pump.h },
    targetCell: { ...cell },
  };
}

function beltFeedsDevice(belt) {
  if (belt?.outDir !== "U") return false;
  if (
    belt.y === tank.y + tank.h
    && (belt.x === tank.x || belt.x === tank.x + 1)
  ) return true;
  return pumps.some((pump) => belt.x === pump.x && belt.y === pump.y + pump.h);
}

function isTerminalBelt(belt) {
  if (!belt || belt.state !== "normal") return false;
  if (!belt.outDir) return true;
  if (beltFeedsDevice(belt)) return false;
  const directions = {
    U: { x: 0, y: -1 },
    R: { x: 1, y: 0 },
    D: { x: 0, y: 1 },
    L: { x: -1, y: 0 },
  };
  const delta = directions[belt.outDir];
  return !belts.has(key(belt.x + delta.x, belt.y + delta.y));
}

function isPathCellAvailable(cell, currentPath = []) {
  if (!inBounds(cell.x, cell.y) || isDeviceCell(cell)) return false;
  if (belts.has(key(cell.x, cell.y))) return false;
  return !currentPath.some((item) => sameCell(item, cell));
}

function extendPathToward(target) {
  if (!drag || !target) return;
  let last = drag.path[drag.path.length - 1];
  if (sameCell(last, target)) return;

  const secondLast = drag.path[drag.path.length - 2];
  if (secondLast && sameCell(secondLast, target)) {
    drag.path.pop();
    drag.targetDevice = null;
    return;
  }

  const candidates = [];
  let cursor = { ...last };
  while (!sameCell(cursor, target)) {
    const dx = target.x - cursor.x;
    const dy = target.y - cursor.y;
    if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) {
      cursor = { x: cursor.x + Math.sign(dx), y: cursor.y };
    } else if (dy !== 0) {
      cursor = { x: cursor.x, y: cursor.y + Math.sign(dy) };
    }
    candidates.push({ ...cursor });
  }

  for (const candidate of candidates) {
    if (!isPathCellAvailable(candidate, drag.path)) break;
    drag.path.push(candidate);
    last = candidate;
  }
}

function startBeltDrag(event, cell) {
  const pumpSource = pumpOutputAt(cell);
  if (isGeneratorOutput(cell) || pumpSource) {
    const sourceX = pumpSource ? pumpSource.x : cell.x;
    const sourceY = pumpSource ? pumpSource.y : generator.y;
    const first = { x: sourceX, y: sourceY - 1 };
    if (!isPathCellAvailable(first)) {
      showToast("この出口にはすでにベルトがあります");
      return;
    }
    drag = {
      pointerId: event.pointerId,
      path: [first],
      sourcePort: pumpSource ? 0 : cell.x - generator.x,
      sourceDevice: pumpSource || generator,
      targetDevice: null,
    };
  } else if (belts.has(key(cell.x, cell.y))) {
    const belt = belts.get(key(cell.x, cell.y));
    if (!isTerminalBelt(belt)) {
      showToast("延長するときはベルトの終端からドラッグしてください");
      return;
    }
    if (cellHasResourceOrTransit(simulation, cell.x, cell.y)) {
      showToast("資源が通過中の終端は変更できません");
      return;
    }
    drag = {
      pointerId: event.pointerId,
      path: [{ ...cell }],
      sourcePort: null,
      sourceDevice: null,
      targetDevice: null,
      existingStart: key(cell.x, cell.y),
    };
  } else if (!isDeviceCell(cell) && isPathCellAvailable(cell)) {
    drag = {
      pointerId: event.pointerId,
      path: [{ ...cell }],
      sourcePort: null,
      sourceDevice: null,
      targetDevice: null,
    };
  } else {
    showToast("発電装置かポンプの上側出口からドラッグしてください");
    return;
  }
  canvas.setPointerCapture(event.pointerId);
}

function canPlacePump(topCell) {
  const occupiedCells = [topCell, { x: topCell.x, y: topCell.y + 1 }];
  const outputCell = { x: topCell.x, y: topCell.y - 1 };
  const inputCell = { x: topCell.x, y: topCell.y + 2 };
  if (
    topCell.y < 1
    || topCell.y + 1 >= GRID.rows
    || !inBounds(outputCell.x, outputCell.y)
    || !inBounds(inputCell.x, inputCell.y)
  ) return false;
  if (occupiedCells.some((cell) => isDeviceCell(cell) || belts.has(key(cell.x, cell.y)))) {
    return false;
  }
  return !isDeviceCell(outputCell) && !isDeviceCell(inputCell);
}

function placePump(cell) {
  if (pumpInventory <= 0) {
    showToast("配置できるポンプを使い切りました");
    return;
  }
  if (!canPlacePump(cell)) {
    showToast("ポンプは上下にベルトを接続できる空き2マスへ置いてください");
    return;
  }
  const pump = createPump(`mission-pump-${nextPumpId}`, cell.x, cell.y);
  nextPumpId += 1;
  pumps.push(pump);
  pumpInventory -= 1;
  renderer.emitEvent("machine-place", { machine: pump });
  updatePumpPalette();
  if (pumpInventory <= 0) setTool("belt");
  updateGuide();
}

function removeAt(cell) {
  const pump = pumps.find((item) => inRect(cell, item));
  if (pump) {
    renderer.emitEvent("machine-remove", { machine: pump });
    pumps = pumps.filter((item) => item.id !== pump.id);
    pumpInventory = Math.min(MISSION_02_MAX_PUMPS, pumpInventory + 1);
    updatePumpPalette();
    showToast(pump.storedElectricity > 0
      ? "ポンプを回収しました。内部の電気は失われました"
      : "ポンプをパレットへ戻しました");
    updateGuide();
    return;
  }
  if (inRect(cell, tank) || inRect(cell, generator)) {
    showToast("固定設備は撤去できません");
    return;
  }
  const belt = belts.get(key(cell.x, cell.y));
  if (!belt) {
    showToast("撤去する設備やベルトがありません");
    return;
  }
  if (belt.state === "failing") {
    showToast("ショートが進行している間は撤去できません");
    return;
  }
  if (belt.state === "broken") {
    if (cleanupUses <= 0) {
      showToast("一括撤去を使い切りました");
      return;
    }
    const component = connectedBrokenComponent(cell, belts);
    renderer.emitEvent("remove", { kind: "broken", belts: component, origin: cell });
    for (const item of component) belts.delete(key(item.x, item.y));
    cleanupUses -= 1;
    cleanupCount.textContent = cleanupUses;
    showToast(`故障ベルトを${component.length}個、一括撤去しました`);
    updateGuide();
    return;
  }
  if (cellHasResourceOrTransit(simulation, cell.x, cell.y)) {
    showToast("資源が載っているベルトは撤去できません");
    return;
  }
  renderer.emitEvent("remove", { kind: "normal", belts: [belt], origin: cell });
  belts.delete(key(cell.x, cell.y));
  showToast("ベルトを撤去しました");
  updateGuide();
}

function handlePointerDown(event) {
  if (cleared) return;
  renderer.unlockAudio();
  const cell = renderer.cellFromEvent(event);
  if (!cell) return;
  event.preventDefault();
  if (tool === "pump") {
    placePump(cell);
    return;
  }
  if (tool === "remove") {
    removeAt(cell);
    return;
  }
  startBeltDrag(event, cell);
}

function handlePointerMove(event) {
  if (!drag || drag.pointerId !== event.pointerId) return;
  event.preventDefault();
  const rawCell = renderer.cellFromEvent(event);
  if (!rawCell) return;

  const target = inputTargetAt(rawCell);
  if (target && target.device.id !== drag.sourceDevice?.id) {
    extendPathToward(target.approach);
    if (sameCell(drag.path[drag.path.length - 1], target.approach)) {
      drag.targetDevice = target;
    }
    return;
  }
  if (!isDeviceCell(rawCell)) {
    drag.targetDevice = null;
    extendPathToward(rawCell);
  }
}

function handlePointerUp(event) {
  if (!drag || drag.pointerId !== event.pointerId) return;
  event.preventDefault();
  if (
    drag.existingStart
    && cellHasResourceOrTransit(simulation, drag.path[0].x, drag.path[0].y)
  ) {
    drag = null;
    showToast("資源が到達したため、終端の変更を中止しました");
    return;
  }

  const targetCell = drag.targetDevice?.targetCell || null;
  const built = buildBeltsFromPath(drag.path, drag.sourcePort, targetCell);
  if (drag.existingStart) {
    if (built.length > 1 || targetCell) {
      const existing = belts.get(drag.existingStart);
      existing.outDir = built[0].outDir;
      for (const belt of built.slice(1)) belts.set(key(belt.x, belt.y), belt);
    }
  } else {
    for (const belt of built) belts.set(key(belt.x, belt.y), belt);
  }
  drag = null;
  updateGuide();
}

function updatePumpPalette() {
  pumpCount.textContent = pumpInventory;
  pumpTool.disabled = pumpInventory <= 0;
  if (pumpInventory <= 0 && tool === "pump") setTool("belt");
}

function setTool(nextTool) {
  if (nextTool === "pump" && pumpInventory <= 0) return;
  tool = nextTool;
  beltTool.classList.toggle("active", tool === "belt");
  pumpTool.classList.toggle("active", tool === "pump");
  removeTool.classList.toggle("active", tool === "remove");
  beltTool.setAttribute("aria-pressed", String(tool === "belt"));
  pumpTool.setAttribute("aria-pressed", String(tool === "pump"));
  removeTool.setAttribute("aria-pressed", String(tool === "remove"));
  canvas.style.cursor = tool === "belt" ? "crosshair" : "pointer";
  updateGuide();
}

function pumpHasOutput(pump) {
  return belts.get(key(pump.x, pump.y - 1))?.state === "normal";
}

function updateGuide() {
  const hasFailing = [...belts.values()].some((belt) => belt.state === "failing");
  const hasBroken = [...belts.values()].some((belt) => belt.state === "broken");
  const blockedPump = pumps.find((pump) => pump.storedElectricity > 0 && !pumpHasOutput(pump));
  if (hasFailing) {
    guideIcon.textContent = "⚡";
    guideText.textContent = "滞留した電気がショートしています。最後は💀になります";
  } else if (hasBroken) {
    guideIcon.textContent = "🔨";
    guideText.textContent = "撤去ツールで、つながった💀故障ベルトを一括撤去できます";
  } else if (blockedPump) {
    guideIcon.textContent = "⚡";
    guideText.textContent = "ポンプが充電済みです。上側出口へ水用ベルトをつないでください";
  } else if (tool === "pump" && pumpInventory > 0) {
    guideIcon.textContent = "⚙️";
    guideText.textContent = "空いている縦2マスをタップしてポンプを配置";
  } else if (!pumps.length) {
    guideIcon.textContent = "⚙️";
    guideText.textContent = "施設パレットからポンプを配置してください";
  } else if (!belts.size) {
    guideIcon.textContent = "☝️";
    guideText.textContent = "発電装置→ポンプ下側、ポンプ上側→貯水タンクを接続";
  } else if (paused) {
    guideIcon.textContent = "▶️";
    guideText.textContent = "準備ができたら、右上の再生ボタンで工場を稼働";
  } else {
    guideIcon.textContent = "💡";
    guideText.textContent = "出口が詰まると、ポンプ内と入力ベルトに電気が溜まります";
  }
}

function updatePauseUI() {
  pauseButtonIcon.textContent = paused ? "▶" : "Ⅱ";
  pauseButton.setAttribute("aria-label", paused ? "工場を稼働する" : "工場を一時停止する");
  pauseButton.classList.toggle("running", !paused);
  pauseState.classList.toggle("running", !paused);
}

function setPaused(nextPaused, { notify = true } = {}) {
  if (cleared || paused === nextPaused) return;
  paused = nextPaused;
  renderer.setPaused(paused);
  updatePauseUI();
  updateGuide();
  if (notify) showToast(paused ? "工場を一時停止しました。建設できます" : "工場を稼働しました");
}

function completeMission() {
  if (cleared) return;
  cleared = true;
  paused = true;
  tank.received = tank.target;
  deliveredCount.textContent = tank.target;
  updatePauseUI();
  clearDetail.textContent = pumps.length >= 2
    ? "2台のポンプで、貯水タンクを満たしました。"
    : "1台のポンプで、貯水タンクを満たしました。";
  const used = MAX_CLEANUPS - cleanupUses;
  if (used > 0) clearDetail.textContent += ` 一括撤去は${used}回使用しました。`;
  clearPanel.hidden = false;
}

function resetMission() {
  belts = new Map();
  pumps = [];
  resetWaterSimulation(simulation);
  tank.received = 0;
  tank.counterPulseMs = 0;
  generator.portFlashMs = [0, 0];
  pumpInventory = MISSION_02_MAX_PUMPS;
  cleanupUses = MAX_CLEANUPS;
  nextPumpId = 1;
  drag = null;
  cleared = false;
  paused = true;
  autoPaused = false;
  deliveredCount.textContent = "0";
  cleanupCount.textContent = MAX_CLEANUPS;
  clearPanel.hidden = true;
  renderer.emitEvent("reset");
  renderer.setPaused(true);
  updatePumpPalette();
  setTool("pump");
  updatePauseUI();
  updateGuide();
  showToast("ミッションを最初からやり直しました");
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2100);
}

const simulationCallbacks = {
  onSpawn(resource, machine) {
    renderer.emitEvent("spawn", { resource, generator: machine });
  },
  onPumpCharge(pump, resource) {
    renderer.emitEvent("pump-charge", { pump, resource });
    updateGuide();
  },
  onPumpOutput(pump, resource) {
    renderer.emitEvent("pump-output", { pump, resource });
    updateGuide();
  },
  onDelivery(machine, resource) {
    deliveredCount.textContent = Math.min(machine.received, machine.target);
    renderer.emitEvent("delivery", { tank: machine, resource });
  },
  onFailureStart(belt, failureType) {
    renderer.emitEvent("failure-start", { belt, failureType });
    showToast(failureType === "electricity"
      ? "電気が滞留して、ベルトがショートしました！"
      : "資源の滞留で、ベルトが故障しました！");
    updateGuide();
  },
  onBroken(belt, failureType) {
    renderer.emitEvent("broken", { belt, failureType });
    updateGuide();
  },
  onComplete() {
    renderer.emitEvent("complete", { tank });
    completeMission();
  },
};

function update(deltaMs) {
  if (cleared || paused) return;
  updateWaterSimulation(simulation, deltaMs, {
    belts,
    generator,
    pumps,
    tank,
    callbacks: simulationCallbacks,
  });
}

function frame(now) {
  const delta = Math.min(50, now - lastFrame);
  lastFrame = now;
  update(delta);
  renderer.render({
    missionType: "water",
    belts,
    resources: simulation.resources,
    generator,
    pumps,
    tank,
    movementAccumulator: simulation.movementAccumulator,
    drag,
  });
  requestAnimationFrame(frame);
}

canvas.addEventListener("pointerdown", handlePointerDown);
canvas.addEventListener("pointermove", handlePointerMove);
canvas.addEventListener("pointerup", handlePointerUp);
canvas.addEventListener("pointercancel", () => { drag = null; });
beltTool.addEventListener("click", () => setTool("belt"));
pumpTool.addEventListener("click", () => setTool("pump"));
removeTool.addEventListener("click", () => setTool("remove"));
resetButton.addEventListener("click", resetMission);
replayButton.addEventListener("click", resetMission);
pauseButton.addEventListener("click", () => setPaused(!paused));
document.addEventListener("visibilitychange", () => {
  if (document.hidden && !paused && !cleared) {
    autoPaused = true;
    setPaused(true, { notify: false });
  } else if (!document.hidden && autoPaused) {
    autoPaused = false;
    showToast("画面を離れたため、工場を一時停止しました");
  }
});
window.addEventListener("resize", renderer.resize);

renderer.resize();
renderer.setPaused(true);
updatePumpPalette();
setTool("pump");
updatePauseUI();
updateGuide();
requestAnimationFrame(frame);
