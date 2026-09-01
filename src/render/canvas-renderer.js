import { DIRS, GRID, TIMING } from "../content/mission-01.js";
import { buildBeltsFromPath } from "../core/construction.js";
import { FAILURE_TIMING } from "../core/failure.js";
import { inBounds, incomingBeltDirections, key } from "../core/grid.js";

export function createCanvasRenderer({ canvas, boardWrap }) {
  const context = canvas.getContext("2d");
  canvas.dataset.renderer = "canvas";
  let layout = { cell: 40, left: 0, top: 0, width: 320, height: 520 };
  let frameState = null;

  function resize() {
    const rect = boardWrap.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    const pad = Math.max(10, Math.min(20, rect.width * 0.035));
    const cell = Math.min(
      (rect.width - pad * 2) / GRID.cols,
      (rect.height - pad * 2) / GRID.rows,
    );
    layout = {
      cell,
      width: cell * GRID.cols,
      height: cell * GRID.rows,
      left: (rect.width - cell * GRID.cols) / 2,
      top: (rect.height - cell * GRID.rows) / 2,
    };
  }

  function cellFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const x = Math.floor((px - layout.left) / layout.cell);
    const y = Math.floor((py - layout.top) / layout.cell);
    if (!inBounds(x, y)) return null;
    return { x, y };
  }

  function cellCenter(x, y) {
    return {
      x: layout.left + (x + 0.5) * layout.cell,
      y: layout.top + (y + 0.5) * layout.cell,
    };
  }

  function roundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function drawGrid() {
    context.save();
    context.fillStyle = "#10151d";
    context.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);

    const gradient = context.createRadialGradient(
      layout.left + layout.width / 2,
      layout.top + layout.height * 0.75,
      10,
      layout.left + layout.width / 2,
      layout.top + layout.height * 0.55,
      layout.height * 0.65,
    );
    gradient.addColorStop(0, "rgba(255, 120, 36, 0.06)");
    gradient.addColorStop(1, "rgba(16, 21, 29, 0)");
    context.fillStyle = gradient;
    context.fillRect(layout.left, layout.top, layout.width, layout.height);

    context.strokeStyle = "rgba(255,255,255,0.055)";
    context.lineWidth = 1;
    for (let x = 0; x <= GRID.cols; x += 1) {
      const px = layout.left + x * layout.cell;
      context.beginPath();
      context.moveTo(px, layout.top);
      context.lineTo(px, layout.top + layout.height);
      context.stroke();
    }
    for (let y = 0; y <= GRID.rows; y += 1) {
      const py = layout.top + y * layout.cell;
      context.beginPath();
      context.moveTo(layout.left, py);
      context.lineTo(layout.left + layout.width, py);
      context.stroke();
    }
    context.restore();
  }

  function drawMachine(rect, type) {
    const x = layout.left + rect.x * layout.cell + 2;
    const y = layout.top + rect.y * layout.cell + 2;
    const width = rect.w * layout.cell - 4;
    const height = rect.h * layout.cell - 4;
    const isFurnace = type === "furnace";
    const furnaceProgress = isFurnace ? Math.min(1, rect.received / rect.target) : 0;
    const counterPulse = isFurnace ? Math.min(1, rect.counterPulseMs / 300) : 0;

    context.save();
    context.shadowColor = isFurnace
      ? `rgba(255,89,30,${0.24 + furnaceProgress * 0.38 + counterPulse * 0.2})`
      : "rgba(255,142,40,0.25)";
    context.shadowBlur = isFurnace ? 12 + furnaceProgress * 14 + counterPulse * 7 : 16;
    roundedRect(context, x, y, width, height, layout.cell * 0.18);
    const machineGradient = context.createLinearGradient(x, y, x, y + height);
    machineGradient.addColorStop(0, isFurnace ? "#434954" : "#59606a");
    machineGradient.addColorStop(1, isFurnace ? "#242a33" : "#303640");
    context.fillStyle = machineGradient;
    context.fill();
    context.shadowBlur = 0;
    context.strokeStyle = isFurnace ? "#6d737c" : "#7a8089";
    context.lineWidth = 2;
    context.stroke();

    if (isFurnace) {
      context.fillStyle = "rgba(6, 8, 12, 0.55)";
      roundedRect(
        context,
        x + width * 0.18,
        y + height * 0.18,
        width * 0.64,
        height * 0.42,
        layout.cell * 0.12,
      );
      context.fill();
    } else {
      for (let port = 0; port < 2; port += 1) {
        const chamberX = x + width * (0.08 + port * 0.5);
        const chamberY = y + height * 0.12;
        const chamberWidth = width * 0.34;
        const chamberHeight = height * 0.47;
        const flash = Math.min(1, rect.portFlashMs[port] / TIMING.ejectMs);
        roundedRect(
          context,
          chamberX,
          chamberY,
          chamberWidth,
          chamberHeight,
          layout.cell * 0.1,
        );
        context.fillStyle = flash > 0
          ? `rgba(72, 25, 10, ${0.74 + flash * 0.2})`
          : "rgba(6, 8, 12, 0.62)";
        context.fill();
        context.strokeStyle = `rgba(255, 127, 36, ${0.18 + flash * 0.7})`;
        context.lineWidth = Math.max(1, layout.cell * 0.025);
        context.stroke();

        const chamberCenterX = chamberX + chamberWidth / 2;
        const chamberCenterY = chamberY + chamberHeight * 0.55;
        context.fillStyle = `rgba(255, 104, 24, ${0.38 + flash * 0.62})`;
        context.shadowColor = "rgba(255, 90, 20, 0.9)";
        context.shadowBlur = layout.cell * (0.06 + flash * 0.28);
        context.beginPath();
        context.arc(
          chamberCenterX,
          chamberCenterY,
          layout.cell * (0.055 + flash * 0.035),
          0,
          Math.PI * 2,
        );
        context.fill();
        context.shadowBlur = 0;
      }
    }

    context.textAlign = "center";
    context.textBaseline = "middle";
    if (isFurnace) {
      context.globalAlpha = 0.62 + furnaceProgress * 0.38;
      context.shadowColor = `rgba(255,91,24,${0.25 + furnaceProgress * 0.65})`;
      context.shadowBlur = layout.cell * (0.12 + furnaceProgress * 0.34);
      context.font = `${layout.cell * (0.56 + furnaceProgress * 0.08)}px sans-serif`;
      context.fillText("🔥", x + width / 2, y + height * 0.38);
    }
    context.globalAlpha = 1;
    context.shadowBlur = 0;

    if (isFurnace) {
      const panelWidth = width * 0.66;
      const panelHeight = height * 0.23;
      const panelY = y + height * 0.66;
      context.save();
      context.translate(x + width / 2, panelY + panelHeight / 2);
      context.scale(1 + counterPulse * 0.09, 1 + counterPulse * 0.09);
      roundedRect(
        context,
        -panelWidth / 2,
        -panelHeight / 2,
        panelWidth,
        panelHeight,
        layout.cell * 0.09,
      );
      context.fillStyle = rect.received >= rect.target ? "#402414" : "rgba(7, 10, 14, 0.82)";
      context.fill();
      context.strokeStyle = rect.received >= rect.target
        ? "rgba(255,183,76,0.95)"
        : `rgba(255,149,55,${0.25 + counterPulse * 0.7})`;
      context.lineWidth = Math.max(1, layout.cell * 0.025);
      context.stroke();
      context.fillStyle = rect.received >= rect.target ? "#ffd78d" : "#f5f1e8";
      context.shadowColor = counterPulse > 0 ? "rgba(255,126,38,0.9)" : "transparent";
      context.shadowBlur = counterPulse * 10;
      context.font = `900 ${Math.max(9, layout.cell * 0.21)}px sans-serif`;
      context.fillText(`🔥 ${rect.received}/${rect.target}`, 0, 0);
      context.restore();
    } else {
      context.fillStyle = "#e7e9ed";
      context.font = `800 ${Math.max(9, layout.cell * 0.22)}px sans-serif`;
      context.fillText("炎発生装置", x + width / 2, y + height * 0.76);
    }
    context.restore();

    if (isFurnace) drawFurnacePorts();
    else drawGeneratorPorts();
  }

  function drawPortArrow(centerX, centerY, active, inward = false) {
    const pulse = 0.82 + Math.sin(performance.now() / 320) * 0.12;
    context.save();
    context.translate(centerX, centerY);
    context.globalAlpha = active ? 1 : 0.72;
    context.fillStyle = active ? "#ffae42" : "#d4dae2";
    context.shadowColor = active ? "rgba(255,128,30,0.8)" : "transparent";
    context.shadowBlur = active ? 9 : 0;
    context.beginPath();
    context.moveTo(0, -layout.cell * 0.22 * pulse);
    context.lineTo(layout.cell * 0.16, layout.cell * 0.02);
    context.lineTo(layout.cell * 0.06, layout.cell * 0.02);
    context.lineTo(layout.cell * 0.06, layout.cell * 0.2);
    context.lineTo(-layout.cell * 0.06, layout.cell * 0.2);
    context.lineTo(-layout.cell * 0.06, layout.cell * 0.02);
    context.lineTo(-layout.cell * 0.16, layout.cell * 0.02);
    context.closePath();
    context.fill();
    if (inward) {
      context.fillStyle = "rgba(101,226,239,0.95)";
      context.beginPath();
      context.arc(0, -layout.cell * 0.32, layout.cell * 0.045, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  function drawGeneratorPorts() {
    const { belts, generator } = frameState;
    for (let i = 0; i < 2; i += 1) {
      const x = generator.x + i;
      const connected = belts.get(key(x, generator.y - 1))?.state === "normal";
      const center = cellCenter(x, generator.y);
      drawPortArrow(center.x, layout.top + generator.y * layout.cell + 5, connected);
    }
  }

  function drawFurnacePorts() {
    const { belts, furnace } = frameState;
    for (let i = 0; i < 2; i += 1) {
      const x = furnace.x + i;
      const below = belts.get(key(x, furnace.y + furnace.h));
      const connected = below?.outDir === "U";
      const edgeY = layout.top + (furnace.y + furnace.h) * layout.cell - 5;
      drawPortArrow(cellCenter(x, 0).x, edgeY, connected, true);
    }
  }

  function beltConnections(belt, preview = false) {
    const dirs = preview && belt.previewInDir
      ? [belt.previewInDir]
      : incomingBeltDirections(belt, frameState.belts, frameState.generator);
    if (belt.outDir && !dirs.includes(belt.outDir)) dirs.push(belt.outDir);
    return dirs;
  }

  function drawBelt(belt, preview = false) {
    const center = cellCenter(belt.x, belt.y);
    const size = layout.cell;
    const state = belt.state || "normal";

    context.save();
    context.translate(center.x, center.y);
    context.globalAlpha = preview ? 0.55 : 1;
    if (state === "failing") {
      context.shadowColor = belt.failureType === "electricity"
        ? "rgba(255,220,99,0.9)"
        : "rgba(255,73,30,0.9)";
      context.shadowBlur = size * 0.4;
    }

    roundedRect(context, -size * 0.43, -size * 0.43, size * 0.86, size * 0.86, size * 0.11);
    context.fillStyle = state === "broken"
      ? "#17191d"
      : state === "failing" ? belt.failureType === "electricity" ? "#514b20" : "#5f251c" : "#303944";
    context.fill();
    context.strokeStyle = state === "broken"
      ? "#454039"
      : state === "failing" ? belt.failureType === "electricity" ? "#ffdc63" : "#ff6842" : "#657180";
    context.lineWidth = Math.max(1.2, size * 0.045);
    context.stroke();
    context.shadowBlur = 0;

    const connections = beltConnections(belt, preview);
    context.strokeStyle = state === "broken"
      ? "#2b2b29"
      : state === "failing" ? belt.failureType === "electricity" ? "#765f19" : "#d9482f" : "#151a21";
    context.lineWidth = size * 0.38;
    context.lineCap = "butt";
    for (const dir of connections) {
      const delta = DIRS[dir];
      context.beginPath();
      context.moveTo(0, 0);
      context.lineTo(delta.x * size * 0.47, delta.y * size * 0.47);
      context.stroke();
    }

    context.fillStyle = state === "broken"
      ? "#34332f"
      : state === "failing" ? belt.failureType === "electricity" ? "#ffdc63" : "#ff6842" : "#232b34";
    context.beginPath();
    context.arc(0, 0, size * 0.21, 0, Math.PI * 2);
    context.fill();

    if (state === "normal" || preview) {
      drawBeltArrow(belt.outDir, size);
    } else if (state === "broken") {
      context.globalAlpha = 0.92;
      context.font = `${size * 0.52}px sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.shadowColor = "rgba(0, 0, 0, 0.75)";
      context.shadowBlur = size * 0.1;
      context.fillText("💀", 0, 0);
      context.shadowBlur = 0;
    }

    if (state === "failing") {
      context.font = `${size * 0.56}px sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      const failureIcon = belt.failureType === "electricity"
        ? "⚡"
        : belt.failureType === "water" ? "💧" : "🔥";
      context.fillText(failureIcon, 0, -size * 0.13 + Math.sin(performance.now() / 80) * 2);
    }
    context.restore();
  }

  function drawBeltArrow(direction, size) {
    if (!direction) return;
    const rotation = { U: -Math.PI / 2, R: 0, D: Math.PI / 2, L: Math.PI }[direction];
    context.save();
    context.rotate(rotation);
    context.fillStyle = "#92a0ad";
    context.beginPath();
    context.moveTo(size * 0.18, 0);
    context.lineTo(-size * 0.07, -size * 0.13);
    context.lineTo(-size * 0.07, size * 0.13);
    context.closePath();
    context.fill();
    context.restore();
  }

  function drawFire(fire) {
    const progress = fire.ejecting
      ? Math.min(1, fire.ejectProgress)
      : Math.min(1, frameState.movementAccumulator / TIMING.stepMs);
    const from = cellCenter(fire.prevX ?? fire.x, fire.prevY ?? fire.y);
    const to = cellCenter(fire.x, fire.y);
    const center = {
      x: from.x + (to.x - from.x) * progress,
      y: from.y + (to.y - from.y) * progress,
    };
    const warning = Math.min(1, fire.stalledMs / FAILURE_TIMING.warningMs);
    const pulse = 1 + Math.sin(performance.now() / 95) * 0.06 * warning;
    const ejectScale = fire.ejecting ? 0.64 + progress * 0.36 : 1;

    context.save();
    context.translate(center.x, center.y);
    context.globalAlpha = fire.ejecting ? 0.58 + progress * 0.42 : 1;
    if (fire.stalledMs >= FAILURE_TIMING.warningMs) {
      const danger = (fire.stalledMs - FAILURE_TIMING.warningMs)
        / (FAILURE_TIMING.triggerMs - FAILURE_TIMING.warningMs);
      context.strokeStyle = `rgba(255, 66, 42, ${0.35 + danger * 0.55})`;
      context.lineWidth = Math.max(2, layout.cell * 0.07);
      context.beginPath();
      context.arc(0, 0, layout.cell * (0.34 + Math.sin(performance.now() / 80) * 0.03), 0, Math.PI * 2);
      context.stroke();
    }
    context.scale(pulse * ejectScale, pulse * ejectScale);
    context.shadowColor = "rgba(255, 94, 20, 0.8)";
    context.shadowBlur = layout.cell * (0.12 + warning * 0.25);
    context.font = `${layout.cell * 0.56}px sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("🔥", 0, 0);
    context.restore();
  }

  function drawPreview() {
    const { drag } = frameState;
    if (!drag || !drag.path.length) return;
    const previewBelts = buildBeltsFromPath(drag.path, drag.sourcePort, drag.targetFurnace);
    for (const belt of previewBelts) drawBelt(belt, true);

    if (drag.targetFurnace) {
      const center = cellCenter(drag.targetFurnace.x, drag.targetFurnace.y);
      context.save();
      context.strokeStyle = "rgba(101,226,239,0.95)";
      context.lineWidth = Math.max(2, layout.cell * 0.06);
      context.strokeRect(
        center.x - layout.cell * 0.43,
        center.y - layout.cell * 0.43,
        layout.cell * 0.86,
        layout.cell * 0.86,
      );
      context.restore();
    }
  }

  function render(state) {
    frameState = state;
    drawGrid();
    for (const belt of state.belts.values()) drawBelt(belt);
    drawMachine(state.furnace, "furnace");
    drawMachine(state.generator, "generator");
    for (const fire of state.fires) drawFire(fire);
    drawPreview();
  }

  return {
    kind: "canvas",
    cellFromEvent,
    destroy() {},
    emitEvent() {},
    render,
    resize,
    setPaused() {},
    unlockAudio() {},
  };
}
