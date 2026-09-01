import { createMissionMachines } from "./src/content/mission-01.js";
import {
  buildBeltsFromPath,
  connectedBrokenComponent,
  isPathCellAvailable,
} from "./src/core/construction.js";
import { MAX_CLEANUPS } from "./src/core/failure.js";
import {
  isDeviceCell,
  isFurnaceInput,
  isGeneratorPort,
  isTerminalBelt,
  key,
  sameCell,
} from "./src/core/grid.js";
import {
  cellHasFireOrTransit,
  createSimulationState,
  resetSimulation,
  updateSimulation,
} from "./src/core/simulation.js";
import { createGameRenderer } from "./src/render/renderer-factory.js";

const canvas = document.querySelector("#game-canvas");
const boardWrap = document.querySelector(".board-wrap");
const deliveredCount = document.querySelector("#delivered-count");
const cleanupCount = document.querySelector("#cleanup-count");
const beltTool = document.querySelector("#belt-tool");
const removeTool = document.querySelector("#remove-tool");
const resetButton = document.querySelector("#reset-button");
const replayButton = document.querySelector("#replay-button");
const nextMissionButton = document.querySelector("#next-mission-button");
const clearPanel = document.querySelector("#clear-panel");
const clearDetail = document.querySelector("#clear-detail");
const guideText = document.querySelector("#guide-text");
const guideIcon = document.querySelector("#guide-icon");
const toast = document.querySelector("#toast");
const pauseState = document.querySelector("#pause-state");
const pauseButton = document.querySelector("#pause-button");
const pauseButtonIcon = document.querySelector("#pause-button-icon");

const { furnace, generator } = createMissionMachines();
const simulation = createSimulationState();
const renderer = createGameRenderer({ canvas, boardWrap });

let belts = new Map();
let cleanupUses = MAX_CLEANUPS;
let tool = "belt";
let drag = null;
let lastFrame = performance.now();
let cleared = false;
let toastTimer = null;
let hasBuiltBelt = false;
let paused = true;
let autoPaused = false;

function extendPathToward(target) {
  if (!drag || !target) return;
  let last = drag.path[drag.path.length - 1];
  if (sameCell(last, target)) return;

  const secondLast = drag.path[drag.path.length - 2];
  if (secondLast && sameCell(secondLast, target)) {
    drag.path.pop();
    drag.targetFurnace = null;
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
    if (!isPathCellAvailable(candidate, belts, furnace, generator, drag.path)) break;
    drag.path.push(candidate);
    last = candidate;
  }
}

function startBeltDrag(event, cell) {
  if (isGeneratorPort(cell, generator)) {
    const first = { x: cell.x, y: generator.y - 1 };
    if (!isPathCellAvailable(first, belts, furnace, generator)) {
      showToast("この出口にはすでにベルトがあります");
      return;
    }
    drag = {
      pointerId: event.pointerId,
      path: [first],
      sourcePort: cell.x - generator.x,
      targetFurnace: null,
    };
  } else if (belts.has(key(cell.x, cell.y))) {
    const belt = belts.get(key(cell.x, cell.y));
    if (!isTerminalBelt(belt, belts, furnace)) {
      showToast("延長するときはベルトの終端からドラッグしてください");
      return;
    }
    if (cellHasFireOrTransit(simulation, cell.x, cell.y)) {
      showToast("火が通過中の終端は変更できません");
      return;
    }
    drag = {
      pointerId: event.pointerId,
      path: [{ ...cell }],
      sourcePort: null,
      targetFurnace: null,
      existingStart: key(cell.x, cell.y),
    };
  } else if (
    !isDeviceCell(cell, furnace, generator)
    && isPathCellAvailable(cell, belts, furnace, generator)
  ) {
    drag = {
      pointerId: event.pointerId,
      path: [{ ...cell }],
      sourcePort: null,
      targetFurnace: null,
    };
  } else {
    showToast("矢印のある出口からドラッグしてください");
    return;
  }
  canvas.setPointerCapture(event.pointerId);
}

function handlePointerDown(event) {
  if (cleared) return;
  renderer.unlockAudio();
  const cell = renderer.cellFromEvent(event);
  if (!cell) return;
  event.preventDefault();

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

  if (isFurnaceInput(rawCell, furnace)) {
    const approach = { x: rawCell.x, y: furnace.y + furnace.h };
    extendPathToward(approach);
    if (sameCell(drag.path[drag.path.length - 1], approach)) {
      drag.targetFurnace = { ...rawCell };
    }
    return;
  }

  if (!isDeviceCell(rawCell, furnace, generator)) {
    drag.targetFurnace = null;
    extendPathToward(rawCell);
  }
}

function handlePointerUp(event) {
  if (!drag || drag.pointerId !== event.pointerId) return;
  event.preventDefault();

  if (
    drag.existingStart
    && cellHasFireOrTransit(simulation, drag.path[0].x, drag.path[0].y)
  ) {
    drag = null;
    showToast("火が到達したため、終端の変更を中止しました");
    return;
  }

  const built = buildBeltsFromPath(drag.path, drag.sourcePort, drag.targetFurnace);
  if (drag.existingStart) {
    if (built.length > 1 || drag.targetFurnace) {
      const existing = belts.get(drag.existingStart);
      existing.outDir = built[0].outDir;
      for (const belt of built.slice(1)) belts.set(key(belt.x, belt.y), belt);
    }
  } else {
    for (const belt of built) belts.set(key(belt.x, belt.y), belt);
  }
  hasBuiltBelt = hasBuiltBelt || built.length > 0;
  drag = null;
  updateGuide();
}

function removeAt(cell) {
  const belt = belts.get(key(cell.x, cell.y));
  if (!belt) {
    showToast("撤去するベルトがありません");
    return;
  }
  if (belt.state === "failing") {
    showToast("故障が進行している間は撤去できません");
    return;
  }
  if (belt.state === "broken") {
    if (cleanupUses <= 0) {
      showToast("一括撤去を使い切りました");
      return;
    }
    const component = connectedBrokenComponent(cell, belts);
    renderer.emitEvent("remove", {
      kind: "broken",
      belts: component,
      origin: cell,
    });
    for (const item of component) belts.delete(key(item.x, item.y));
    hasBuiltBelt = belts.size > 0;
    cleanupUses -= 1;
    cleanupCount.textContent = cleanupUses;
    showToast(`故障ベルトを${component.length}個、一括撤去しました`);
    updateGuide();
    return;
  }
  if (cellHasFireOrTransit(simulation, cell.x, cell.y)) {
    showToast("火が載っているベルトは撤去できません");
    return;
  }
  renderer.emitEvent("remove", {
    kind: "normal",
    belts: [belt],
    origin: cell,
  });
  belts.delete(key(cell.x, cell.y));
  hasBuiltBelt = belts.size > 0;
  showToast("ベルトを撤去しました（回数消費なし）");
}

function updateGuide() {
  const hasFailing = [...belts.values()].some((belt) => belt.state === "failing");
  const hasBroken = [...belts.values()].some((belt) => belt.state === "broken");
  if (hasFailing) {
    guideIcon.textContent = "🚨";
    guideText.textContent = "火による故障が進行しています。最後は💀になります";
  } else if (hasBroken) {
    guideIcon.textContent = "🔨";
    guideText.textContent = "撤去ツールで、つながった💀故障ベルトを一括撤去できます";
  } else if (paused && hasBuiltBelt) {
    guideIcon.textContent = "▶️";
    guideText.textContent = "準備ができたら、右上の再生ボタンで工場を稼働";
  } else if (hasBuiltBelt) {
    guideIcon.textContent = "💡";
    guideText.textContent = "2本つなぐと、火を2倍の速さで届けられます";
  } else {
    guideIcon.textContent = "☝️";
    guideText.textContent = "炎発生装置の矢印から、炉の入口までドラッグ";
  }
}

function completeMission() {
  if (cleared) return;
  cleared = true;
  paused = true;
  updatePauseUI();
  furnace.received = furnace.target;
  deliveredCount.textContent = furnace.target;
  const used = MAX_CLEANUPS - cleanupUses;
  clearDetail.textContent = used === 0
    ? "事故を起こさず、炉が無事に点火しました。"
    : `一括撤去を${used}回使って、炉を点火しました。`;
  clearPanel.hidden = false;
  nextMissionButton.hidden = false;
}

function setTool(nextTool) {
  tool = nextTool;
  beltTool.classList.toggle("active", tool === "belt");
  removeTool.classList.toggle("active", tool === "remove");
  beltTool.setAttribute("aria-pressed", String(tool === "belt"));
  removeTool.setAttribute("aria-pressed", String(tool === "remove"));
  canvas.style.cursor = tool === "belt" ? "crosshair" : "pointer";
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
  if (notify) {
    showToast(paused ? "工場を一時停止しました。建設できます" : "工場を稼働しました");
  }
}

function togglePaused() {
  setPaused(!paused);
}

function resetMission() {
  belts = new Map();
  resetSimulation(simulation);
  furnace.received = 0;
  furnace.counterPulseMs = 0;
  generator.portFlashMs = [0, 0];
  renderer.emitEvent("reset");
  cleanupUses = MAX_CLEANUPS;
  drag = null;
  cleared = false;
  paused = true;
  renderer.setPaused(true);
  autoPaused = false;
  hasBuiltBelt = false;
  deliveredCount.textContent = "0";
  cleanupCount.textContent = MAX_CLEANUPS;
  clearPanel.hidden = true;
  setTool("belt");
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
  onSpawn(fire, machine) {
    renderer.emitEvent("spawn", { fire, generator: machine });
  },
  onDelivery(machine, fire) {
    deliveredCount.textContent = Math.min(machine.received, machine.target);
    renderer.emitEvent("delivery", { furnace: machine, fire });
  },
  onFailureStart(belt, failureType) {
    renderer.emitEvent("failure-start", { belt, failureType });
    showToast("火が滞留して、ベルトに燃え移りました！");
    updateGuide();
  },
  onBroken(belt, failureType) {
    renderer.emitEvent("broken", { belt, failureType });
    updateGuide();
  },
  onComplete() {
    renderer.emitEvent("complete", { furnace });
    completeMission();
  },
};

function update(deltaMs) {
  if (cleared || paused) return;
  updateSimulation(simulation, deltaMs, {
    belts,
    furnace,
    generator,
    callbacks: simulationCallbacks,
  });
}

function frame(now) {
  const delta = Math.min(50, now - lastFrame);
  lastFrame = now;
  update(delta);
  renderer.render({
    belts,
    fires: simulation.fires,
    furnace,
    generator,
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
removeTool.addEventListener("click", () => setTool("remove"));
resetButton.addEventListener("click", resetMission);
replayButton.addEventListener("click", resetMission);
nextMissionButton.addEventListener("click", () => {
  const url = new URL(window.location.href);
  url.searchParams.set("mission", "2");
  window.location.assign(url);
});
pauseButton.addEventListener("click", togglePaused);
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
renderer.setPaused(paused);
updatePauseUI();
updateGuide();
requestAnimationFrame(frame);
