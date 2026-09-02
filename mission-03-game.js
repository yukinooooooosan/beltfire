import { GRID } from "./src/content/mission-01.js";
import {
  MISSION_03_INVENTORY,
  createBoiler,
  createMission03Machines,
  createTurbine,
} from "./src/content/mission-03.js";
import {
  buildBeltsFromPath,
  connectedBrokenNetwork,
} from "./src/core/construction.js";
import { MAX_CLEANUPS } from "./src/core/failure.js";
import { inBounds, inRect, key, sameCell } from "./src/core/grid.js";
import {
  cellHasSteamResourceOrTransit,
  createSteamSimulationState,
  resetSteamSimulation,
  updateSteamSimulation,
} from "./src/core/steam-simulation.js";
import { createPhaserRenderer } from "./src/render/phaser-renderer.js";

const FACILITY_META = {
  boiler: { label: "ボイラー", icon: "♨️" },
  turbine: { label: "タービン", icon: "🌀" },
};
const LONG_PRESS_MS = 520;
const LONG_PRESS_MOVE_PX = 10;

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
const facilityTool = document.querySelector("#facility-tool");
const facilityToolIcon = document.querySelector("#facility-tool-icon");
const facilityToolLabel = document.querySelector("#facility-tool-label");
const facilityToolCount = document.querySelector("#facility-tool-count");
const facilityPicker = document.querySelector("#facility-picker");
const boilerCount = document.querySelector("#boiler-count");
const turbineCount = document.querySelector("#turbine-count");
const facilityOptions = [...document.querySelectorAll(".facility-option")];
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

document.title = "BELT FIRE — ランプに灯りをつけよう";
document.body.classList.add("steam-mission");
missionLabel.textContent = "MISSION 03";
missionTitle.textContent = "ランプに灯りをつけよう";
resourceStatIcon.textContent = "💡";
cleanupStat.hidden = false;
cleanupStat.title = "施設・故障ネットワークの撤去可能数";
cleanupCount.textContent = MAX_CLEANUPS;
facilityTool.hidden = false;
toolbar.classList.add("four-tools");
clearResourceIcon.textContent = "💡";
clearTitle.textContent = "ランプが点灯しました！";
clearDetail.textContent = "火と水から作った電気がランプへ届きました。";
nextMissionButton.hidden = true;
deliveredCount.textContent = "0";
document.querySelector(".stat-fire span:last-child").textContent = "/1";

const { lamp, generators } = createMission03Machines();
const simulation = createSteamSimulationState();
const renderer = createPhaserRenderer({ canvas, boardWrap });

let belts = new Map();
let machines = [];
let inventory = { ...MISSION_03_INVENTORY };
let cleanupUses = MAX_CLEANUPS;
let nextMachineId = 1;
let selectedFacility = "boiler";
let tool = "facility";
let drag = null;
let lastFrame = performance.now();
let cleared = false;
let toastTimer = null;
let paused = true;
let autoPaused = false;
let facilityPress = null;

function machineContainsCell(machine, cell) {
  return machine.cells.some((item) => sameCell(item, cell));
}

function placedMachineAt(cell) {
  return machines.find((machine) => machineContainsCell(machine, cell)) || null;
}

function fixedDeviceAt(cell) {
  if (inRect(cell, lamp)) return lamp;
  return generators.find((generator) => inRect(cell, generator)) || null;
}

function deviceAt(cell) {
  return fixedDeviceAt(cell) || placedMachineAt(cell);
}

function isDeviceCell(cell) {
  return Boolean(deviceAt(cell));
}

function sourceAt(cell) {
  const generator = generators.find((item) => (
    cell.y === item.y && (cell.x === item.x || cell.x === item.x + 1)
  ));
  if (generator) {
    return {
      device: generator,
      sourcePort: cell.x - generator.x,
      first: { x: cell.x, y: generator.y - 1 },
    };
  }
  const machine = machines.find((item) => (
    item.state === "normal" && sameCell(item.outputPort.sourceCell, cell)
  ));
  if (!machine) return null;
  return {
    device: machine,
    sourcePort: 0,
    first: { ...machine.outputPort.approach },
  };
}

function inputTargetAt(cell) {
  if (
    cell.y === lamp.y + lamp.h - 1
    && (cell.x === lamp.x || cell.x === lamp.x + 1)
  ) {
    return {
      device: lamp,
      approach: { x: cell.x, y: lamp.y + lamp.h },
      targetCell: { ...cell },
    };
  }
  for (const machine of machines) {
    if (machine.state !== "normal") continue;
    const port = machine.inputPorts.find((item) => sameCell(item.targetCell, cell));
    if (port) {
      return {
        device: machine,
        approach: { ...port.approach },
        targetCell: { ...port.targetCell },
      };
    }
  }
  return null;
}

function beltFeedsDevice(belt) {
  if (belt?.outDir !== "U") return false;
  if (
    belt.y === lamp.y + lamp.h
    && (belt.x === lamp.x || belt.x === lamp.x + 1)
  ) return true;
  return machines.some((machine) => machine.inputPorts.some((port) => (
    sameCell(port.approach, belt)
  )));
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
  const source = sourceAt(cell);
  if (source) {
    if (!isPathCellAvailable(source.first)) {
      showToast("この出口にはすでにベルトがあります");
      return;
    }
    drag = {
      pointerId: event.pointerId,
      path: [source.first],
      sourcePort: source.sourcePort,
      sourceDevice: source.device,
      targetDevice: null,
    };
  } else if (belts.has(key(cell.x, cell.y))) {
    const belt = belts.get(key(cell.x, cell.y));
    if (!isTerminalBelt(belt)) {
      showToast("延長するときはベルトの終端からドラッグしてください");
      return;
    }
    if (cellHasSteamResourceOrTransit(simulation, cell.x, cell.y)) {
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
    showToast("発生装置か施設の上側出口からドラッグしてください");
    return;
  }
  canvas.setPointerCapture(event.pointerId);
}

function placementCells(type, cell) {
  if (type === "boiler") {
    return [cell, { x: cell.x, y: cell.y + 1 }, { x: cell.x + 1, y: cell.y + 1 }];
  }
  return [cell, { x: cell.x, y: cell.y + 1 }];
}

function placementPorts(type, cell) {
  if (type === "boiler") {
    return [
      { x: cell.x, y: cell.y - 1 },
      { x: cell.x, y: cell.y + 2 },
      { x: cell.x + 1, y: cell.y + 2 },
    ];
  }
  return [
    { x: cell.x, y: cell.y - 1 },
    { x: cell.x, y: cell.y + 2 },
  ];
}

function canPlaceFacility(type, cell) {
  const occupied = placementCells(type, cell);
  const ports = placementPorts(type, cell);
  if ([...occupied, ...ports].some((item) => !inBounds(item.x, item.y))) return false;
  if (occupied.some((item) => isDeviceCell(item) || belts.has(key(item.x, item.y)))) return false;
  return ports.every((item) => !isDeviceCell(item) && !belts.has(key(item.x, item.y)));
}

function placeSelectedFacility(cell) {
  const meta = FACILITY_META[selectedFacility];
  if (inventory[selectedFacility] <= 0) {
    showToast(`${meta.label}を使い切りました。施設ボタンを長押しして切り替えてください`);
    return;
  }
  if (!canPlaceFacility(selectedFacility, cell)) {
    showToast(selectedFacility === "boiler"
      ? "ボイラーは上1・下2のL字と入出力スペースが必要です"
      : "タービンは上下に接続できる縦2マスへ置いてください");
    return;
  }
  const id = `mission-${selectedFacility}-${nextMachineId}`;
  nextMachineId += 1;
  const machine = selectedFacility === "boiler"
    ? createBoiler(id, cell.x, cell.y)
    : createTurbine(id, cell.x, cell.y);
  machines.push(machine);
  inventory[selectedFacility] -= 1;
  renderer.emitEvent("machine-place", { machine });
  updateFacilityPalette();
  setTool("belt");
  if (selectedFacility === "boiler" && inventory.turbine > 0) {
    showToast("ボイラーを配置しました。施設を長押ししてタービンへ切り替えられます");
  }
  updateGuide();
}

function consumeCleanup() {
  cleanupUses -= 1;
  cleanupCount.textContent = cleanupUses;
}

function removeAt(cell) {
  const machine = placedMachineAt(cell);
  if (machine) {
    if (machine.state === "failing") {
      showToast("故障が進行している間は撤去できません");
      return;
    }
    if (machine.state === "broken") {
      removeBrokenNetwork(cell);
      return;
    }
    if (cleanupUses <= 0) {
      showToast("施設の撤去可能回数を使い切りました");
      return;
    }
    const discarded = machine.storedResources.length;
    renderer.emitEvent("machine-remove", { machine });
    machines = machines.filter((item) => item.id !== machine.id);
    inventory[machine.type] = Math.min(
      MISSION_03_INVENTORY[machine.type],
      inventory[machine.type] + 1,
    );
    consumeCleanup();
    updateFacilityPalette();
    showToast(discarded
      ? `${machine.label}を回収し、内部の素材${discarded}個を破棄しました`
      : `${machine.label}を施設パレットへ戻しました`);
    updateGuide();
    return;
  }
  if (fixedDeviceAt(cell)) {
    showToast("固定設備は撤去できません");
    return;
  }
  const belt = belts.get(key(cell.x, cell.y));
  if (!belt) {
    showToast("撤去する施設やベルトがありません");
    return;
  }
  if (belt.state === "failing") {
    showToast("故障が進行している間は撤去できません");
    return;
  }
  if (belt.state === "broken") {
    removeBrokenNetwork(cell);
    return;
  }
  if (cellHasSteamResourceOrTransit(simulation, cell.x, cell.y)) {
    showToast("資源が載っているベルトは撤去できません");
    return;
  }
  renderer.emitEvent("remove", { kind: "normal", belts: [belt], origin: cell });
  belts.delete(key(cell.x, cell.y));
  showToast("ベルトを撤去しました");
  updateGuide();
}

function removeBrokenNetwork(cell) {
  if (cleanupUses <= 0) {
    showToast("一括撤去を使い切りました");
    return;
  }
  const network = connectedBrokenNetwork(cell, belts, machines);
  if (!network.belts.length && !network.devices.length) return;
  renderer.emitEvent("remove", {
    kind: "broken",
    belts: network.belts,
    origin: network.belts[0] || cell,
  });
  for (const belt of network.belts) belts.delete(key(belt.x, belt.y));
  for (const machine of network.devices) renderer.emitEvent("machine-remove", { machine });
  const removedIds = new Set(network.devices.map((machine) => machine.id));
  for (const machine of network.devices) {
    inventory[machine.type] = Math.min(
      MISSION_03_INVENTORY[machine.type],
      inventory[machine.type] + 1,
    );
  }
  machines = machines.filter((machine) => !removedIds.has(machine.id));
  consumeCleanup();
  updateFacilityPalette();
  const deviceText = network.devices.length ? `設備${network.devices.length}台と` : "";
  showToast(`${deviceText}故障ベルト${network.belts.length}個を一括撤去しました`);
  updateGuide();
}

function handlePointerDown(event) {
  if (cleared) return;
  renderer.unlockAudio();
  const cell = renderer.cellFromEvent(event);
  if (!cell) return;
  event.preventDefault();
  closeFacilityPicker();
  if (tool === "facility") {
    placeSelectedFacility(cell);
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
    && cellHasSteamResourceOrTransit(simulation, drag.path[0].x, drag.path[0].y)
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

function setTool(nextTool) {
  tool = nextTool;
  beltTool.classList.toggle("active", tool === "belt");
  facilityTool.classList.toggle("active", tool === "facility");
  removeTool.classList.toggle("active", tool === "remove");
  beltTool.setAttribute("aria-pressed", String(tool === "belt"));
  facilityTool.setAttribute("aria-pressed", String(tool === "facility"));
  removeTool.setAttribute("aria-pressed", String(tool === "remove"));
  canvas.style.cursor = tool === "belt" ? "crosshair" : "pointer";
  updateGuide();
}

function selectFacility(type) {
  selectedFacility = type;
  updateFacilityPalette();
  closeFacilityPicker();
  setTool("facility");
  showToast(`${FACILITY_META[type].label}へ切り替えました`);
}

function updateFacilityPalette() {
  const meta = FACILITY_META[selectedFacility];
  facilityToolIcon.textContent = meta.icon;
  facilityToolLabel.textContent = meta.label;
  facilityToolCount.textContent = inventory[selectedFacility];
  boilerCount.textContent = inventory.boiler;
  turbineCount.textContent = inventory.turbine;
  for (const option of facilityOptions) {
    const type = option.dataset.facility;
    option.classList.toggle("selected", type === selectedFacility);
    option.disabled = inventory[type] <= 0;
    option.setAttribute("aria-current", type === selectedFacility ? "true" : "false");
  }
}

function openFacilityPicker() {
  facilityPicker.hidden = false;
  facilityTool.setAttribute("aria-expanded", "true");
  facilityTool.classList.remove("holding");
  showToast("設置する施設を選んでください");
}

function closeFacilityPicker() {
  facilityPicker.hidden = true;
  facilityTool.setAttribute("aria-expanded", "false");
}

function cancelFacilityHold() {
  if (!facilityPress) return;
  window.clearTimeout(facilityPress.timer);
  facilityTool.classList.remove("holding");
}

function handleFacilityPointerDown(event) {
  event.preventDefault();
  cancelFacilityHold();
  facilityTool.setPointerCapture?.(event.pointerId);
  facilityTool.classList.add("holding");
  facilityPress = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    longPressed: false,
    cancelled: false,
    timer: window.setTimeout(() => {
      if (!facilityPress || facilityPress.cancelled) return;
      facilityPress.longPressed = true;
      openFacilityPicker();
      navigator.vibrate?.(25);
    }, LONG_PRESS_MS),
  };
}

function handleFacilityPointerMove(event) {
  if (!facilityPress || facilityPress.pointerId !== event.pointerId) return;
  const distance = Math.hypot(
    event.clientX - facilityPress.x,
    event.clientY - facilityPress.y,
  );
  if (distance <= LONG_PRESS_MOVE_PX) return;
  facilityPress.cancelled = true;
  cancelFacilityHold();
}

function handleFacilityPointerUp(event) {
  if (!facilityPress || facilityPress.pointerId !== event.pointerId) return;
  event.preventDefault();
  const wasLongPress = facilityPress.longPressed;
  const wasCancelled = facilityPress.cancelled;
  cancelFacilityHold();
  facilityPress = null;
  if (!wasLongPress && !wasCancelled) {
    closeFacilityPicker();
    setTool("facility");
  }
}

function machineHasOutput(machine) {
  const belt = belts.get(key(machine.outputPort.approach.x, machine.outputPort.approach.y));
  return machine.state === "normal" && belt?.state === "normal";
}

function updateGuide() {
  const hasFailing = [...belts.values()].some((belt) => belt.state === "failing");
  const hasBroken = [...belts.values()].some((belt) => belt.state === "broken");
  const hasFailingMachine = machines.some((machine) => machine.state === "failing");
  const hasBrokenMachine = machines.some((machine) => machine.state === "broken");
  const contaminatedMachine = machines.find((machine) => (
    machine.state === "normal" && machine.contaminationType
  ));
  const jammedBoiler = machines.find((machine) => (
    machine.type === "boiler"
    && machine.storedResources.length === 2
    && new Set(machine.storedResources).size === 1
  ));
  const blockedMachine = machines.find((machine) => (
    machine.storedResources.length > 0 && !machineHasOutput(machine)
  ));
  if (hasFailingMachine) {
    guideIcon.textContent = "🚨";
    guideText.textContent = "対応していない素材が入り、施設が故障しています";
  } else if (hasBrokenMachine || hasBroken) {
    guideIcon.textContent = "🔨";
    guideText.textContent = "撤去ツールで、つながった💀設備とベルトを一括撤去できます";
  } else if (contaminatedMachine) {
    guideIcon.textContent = contaminatedMachine.contaminationWarning ? "🚨" : "⚠️";
    guideText.textContent = `対応外の素材が${contaminatedMachine.label}の入力ブロック内で滞留中です`;
  } else if (hasFailing) {
    guideIcon.textContent = "🚨";
    guideText.textContent = "滞留した資源がベルトを故障させています";
  } else if (jammedBoiler) {
    guideIcon.textContent = "🔨";
    guideText.textContent = `${jammedBoiler.storedResources[0] === "fire" ? "火" : "水"}が2個入り、ボイラーが詰まりました。撤去して置き直せます`;
  } else if (blockedMachine) {
    guideIcon.textContent = "☁️";
    guideText.textContent = `${blockedMachine.label}の上側出口へベルトをつないでください`;
  } else if (!machines.some((machine) => machine.type === "boiler")) {
    guideIcon.textContent = "♨️";
    guideText.textContent = "ボイラーを配置し、下の2入口へ火と水を1個ずつ送ります";
  } else if (!machines.some((machine) => machine.type === "turbine")) {
    guideIcon.textContent = "👆";
    guideText.textContent = "施設ボタンを長押しして、タービンへ切り替えてください";
  } else if (!belts.size) {
    guideIcon.textContent = "☝️";
    guideText.textContent = "火＋水→ボイラー→タービン→ランプの順につなぎます";
  } else if (paused) {
    guideIcon.textContent = "▶️";
    guideText.textContent = "準備ができたら、右上の再生ボタンで工場を稼働";
  } else {
    guideIcon.textContent = "💡";
    guideText.textContent = "蒸気をタービンへ送り、作った電気をランプへ届けよう";
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
  lamp.received = lamp.target;
  deliveredCount.textContent = lamp.target;
  updatePauseUI();
  const used = MAX_CLEANUPS - cleanupUses;
  clearDetail.textContent = "火と水から作った電気がランプへ届きました。";
  if (used > 0) clearDetail.textContent += ` 撤去は${used}回使用しました。`;
  clearPanel.hidden = false;
}

function resetMission() {
  belts = new Map();
  machines = [];
  inventory = { ...MISSION_03_INVENTORY };
  resetSteamSimulation(simulation);
  lamp.received = 0;
  lamp.counterPulseMs = 0;
  for (const generator of generators) generator.portFlashMs = [0, 0];
  cleanupUses = MAX_CLEANUPS;
  nextMachineId = 1;
  selectedFacility = "boiler";
  drag = null;
  cleared = false;
  paused = true;
  autoPaused = false;
  deliveredCount.textContent = "0";
  cleanupCount.textContent = MAX_CLEANUPS;
  clearPanel.hidden = true;
  closeFacilityPicker();
  renderer.emitEvent("reset");
  renderer.setPaused(true);
  updateFacilityPalette();
  setTool("facility");
  updatePauseUI();
  updateGuide();
  showToast("ミッションを最初からやり直しました");
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2300);
}

const simulationCallbacks = {
  onSpawn(resource, generator) {
    renderer.emitEvent("spawn", { resource, generator });
  },
  onMachineInput(machine, resource) {
    renderer.emitEvent("machine-input", { machine, resource });
    updateGuide();
  },
  onMachineOutput(machine, resource) {
    renderer.emitEvent("machine-output", { machine, resource });
    updateGuide();
  },
  onDelivery(machine, resource) {
    deliveredCount.textContent = machine.target;
    renderer.emitEvent("delivery", { lamp: machine, resource });
  },
  onFailureStart(belt, failureType) {
    renderer.emitEvent("failure-start", { belt, failureType });
    showToast("資源が滞留して、ベルトが故障し始めました！");
    updateGuide();
  },
  onBroken(belt, failureType) {
    renderer.emitEvent("broken", { belt, failureType });
    updateGuide();
  },
  onMachineFailureStart(machine, resource) {
    renderer.emitEvent("machine-failure-start", {
      machine,
      resource,
      failureType: resource.type,
    });
    showToast(`滞留した異物により、${machine.label}が故障し始めました！`);
    updateGuide();
  },
  onMachineContamination(machine, resource) {
    renderer.emitEvent("machine-contamination", {
      machine,
      resource,
      failureType: resource.type,
    });
    showToast(`${machine.label}が対応外の素材を取り込みました`);
    updateGuide();
  },
  onMachineContaminationWarning(machine, failureType) {
    renderer.emitEvent("machine-contamination-warning", { machine, failureType });
    showToast(`${machine.label}内の異物が危険な状態です！`);
    updateGuide();
  },
  onMachineBroken(machine, failureType) {
    renderer.emitEvent("machine-broken", { machine, failureType });
    updateGuide();
  },
  onComplete() {
    renderer.emitEvent("complete", { lamp });
    completeMission();
  },
};

function update(deltaMs) {
  if (cleared || paused) return;
  updateSteamSimulation(simulation, deltaMs, {
    belts,
    generators,
    machines,
    lamp,
    callbacks: simulationCallbacks,
  });
}

function frame(now) {
  const delta = Math.min(50, now - lastFrame);
  lastFrame = now;
  update(delta);
  renderer.render({
    missionType: "steam",
    belts,
    resources: simulation.resources,
    generator: generators[0],
    generators,
    machines,
    lamp,
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
facilityTool.addEventListener("pointerdown", handleFacilityPointerDown);
facilityTool.addEventListener("pointermove", handleFacilityPointerMove);
facilityTool.addEventListener("pointerup", handleFacilityPointerUp);
facilityTool.addEventListener("pointercancel", () => {
  cancelFacilityHold();
  facilityPress = null;
});
facilityTool.addEventListener("contextmenu", (event) => event.preventDefault());
facilityTool.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") setTool("facility");
  if (event.key === "ArrowUp") openFacilityPicker();
});
for (const option of facilityOptions) {
  option.addEventListener("click", () => selectFacility(option.dataset.facility));
}
removeTool.addEventListener("click", () => setTool("remove"));
resetButton.addEventListener("click", resetMission);
replayButton.addEventListener("click", resetMission);
pauseButton.addEventListener("click", () => setPaused(!paused));
document.addEventListener("pointerdown", (event) => {
  if (!facilityPicker.contains(event.target) && !facilityTool.contains(event.target)) {
    closeFacilityPicker();
  }
});
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
updateFacilityPalette();
setTool("facility");
updatePauseUI();
updateGuide();
requestAnimationFrame(frame);
