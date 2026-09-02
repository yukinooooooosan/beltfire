import Phaser from "phaser";
import { DIRS, GRID, TIMING } from "../content/mission-01.js";
import { buildBeltsFromPath } from "../core/construction.js";
import { FAILURE_TIMING } from "../core/failure.js";
import { inBounds, incomingBeltDirections, key, sameCell } from "../core/grid.js";

const COLORS = {
  background: 0x10151d,
  grid: 0xffffff,
  belt: 0x303944,
  beltEdge: 0x657180,
  beltTrack: 0x151a21,
  beltArrow: 0x92a0ad,
  burning: 0x5f251c,
  burningEdge: 0xff6842,
  ash: 0x17191d,
  ashEdge: 0x454039,
  machineTop: 0x434954,
  machineBottom: 0x242a33,
  generatorTop: 0x59606a,
  generatorBottom: 0x303640,
  orange: 0xff8a2a,
  orangeSoft: 0xffc166,
  cyan: 0x65e2ef,
  danger: 0xff4e3e,
};

function computeLayout(width, height) {
  const pad = Math.max(10, Math.min(20, width * 0.035));
  const cell = Math.min(
    (width - pad * 2) / GRID.cols,
    (height - pad * 2) / GRID.rows,
  );
  return {
    cell,
    width: cell * GRID.cols,
    height: cell * GRID.rows,
    left: (width - cell * GRID.cols) / 2,
    top: (height - cell * GRID.rows) / 2,
    viewportWidth: width,
    viewportHeight: height,
  };
}

function traceBoilerSilhouette(graphics, machine, layout) {
  const left = layout.left + machine.x * layout.cell + 2;
  const top = layout.top + machine.y * layout.cell + 2;
  const columnRight = layout.left + (machine.x + 1) * layout.cell - 2;
  const lowerTop = layout.top + (machine.y + 1) * layout.cell + 2;
  const right = layout.left + (machine.x + 2) * layout.cell - 2;
  const bottom = layout.top + (machine.y + 2) * layout.cell - 2;
  graphics.beginPath();
  graphics.moveTo(left, top);
  graphics.lineTo(columnRight, top);
  graphics.lineTo(columnRight, lowerTop);
  graphics.lineTo(right, lowerTop);
  graphics.lineTo(right, bottom);
  graphics.lineTo(left, bottom);
  graphics.closePath();
}

function drawUnifiedSteamMachineBody(
  graphics,
  machine,
  layout,
  bodyColor,
  edgeColor,
  glowAlpha,
) {
  if (machine.type === "boiler") {
    graphics.lineStyle(Math.max(4, layout.cell * 0.1), edgeColor, glowAlpha);
    traceBoilerSilhouette(graphics, machine, layout);
    graphics.strokePath();
    graphics.fillStyle(bodyColor, 1);
    traceBoilerSilhouette(graphics, machine, layout);
    graphics.fillPath();
    graphics.lineStyle(2, edgeColor, 1);
    traceBoilerSilhouette(graphics, machine, layout);
    graphics.strokePath();
    return;
  }

  const x = layout.left + machine.x * layout.cell + 2;
  const y = layout.top + machine.y * layout.cell + 2;
  const width = machine.w * layout.cell - 4;
  const height = machine.h * layout.cell - 4;
  graphics.fillStyle(edgeColor, glowAlpha);
  graphics.fillRoundedRect(
    x - layout.cell * 0.05,
    y - layout.cell * 0.05,
    width + layout.cell * 0.1,
    height + layout.cell * 0.1,
    layout.cell * 0.16,
  );
  graphics.fillStyle(bodyColor, 1);
  graphics.fillRoundedRect(x, y, width, height, layout.cell * 0.14);
  graphics.lineStyle(2, edgeColor, 1);
  graphics.strokeRoundedRect(x, y, width, height, layout.cell * 0.14);
}

function cloneEventPayload(payload = {}) {
  return {
    ...payload,
    belt: payload.belt ? { ...payload.belt } : undefined,
    belts: payload.belts?.map((belt) => ({ ...belt })),
    fire: payload.fire ? { ...payload.fire } : undefined,
    furnace: payload.furnace ? { ...payload.furnace } : undefined,
    generator: payload.generator ? { ...payload.generator } : undefined,
    lamp: payload.lamp ? { ...payload.lamp } : undefined,
    machine: payload.machine ? { ...payload.machine } : undefined,
    origin: payload.origin ? { ...payload.origin } : undefined,
    pump: payload.pump ? { ...payload.pump } : undefined,
    resource: payload.resource ? { ...payload.resource } : undefined,
    tank: payload.tank ? { ...payload.tank } : undefined,
  };
}

function supportsWebGL() {
  try {
    const probe = document.createElement("canvas");
    return Boolean(
      window.WebGLRenderingContext
      && (probe.getContext("webgl") || probe.getContext("experimental-webgl")),
    );
  } catch {
    return false;
  }
}

export function createPhaserRenderer({ canvas, boardWrap }) {
  const initialRect = boardWrap.getBoundingClientRect();
  let layout = computeLayout(Math.max(1, initialRect.width), Math.max(1, initialRect.height));
  let latestState = null;
  let scene = null;
  let paused = true;
  let visualTime = 0;
  let lastTrailAt = 0;
  const furnaceZoom = { remainingMs: 0, durationMs: 0, strength: 0 };
  const pendingEvents = [];
  const fireViews = new Map();
  const beltStateViews = new Map();
  const pumpViews = new Map();
  const sourceViews = new Map();
  const demolitionViews = new Set();
  const demolitionTimers = new Set();

  let gridGraphics;
  let beltGraphics;
  let machineGraphics;
  let furnaceGraphics;
  let warningGraphics;
  let previewGraphics;
  let generatorLabel;
  let furnaceIcon;
  let furnaceCounter;
  let sparkEmitter;
  let smokeEmitter;
  let waterEmitter;
  let metalEmitter;
  let ashEmitter;
  let demolitionSparkEmitter;
  let demolitionSmokeEmitter;

  function cellCenter(x, y) {
    return {
      x: layout.left + (x + 0.5) * layout.cell,
      y: layout.top + (y + 0.5) * layout.cell,
    };
  }

  function createParticleTexture(targetScene, textureKey, color, size) {
    if (targetScene.textures.exists(textureKey)) return;
    const graphics = targetScene.make.graphics({ x: 0, y: 0, add: false });
    graphics.fillStyle(color, 1);
    graphics.fillCircle(size / 2, size / 2, size / 2);
    graphics.generateTexture(textureKey, size, size);
    graphics.destroy();
  }

  function createFragmentTexture(targetScene, textureKey, color, width, height) {
    if (targetScene.textures.exists(textureKey)) return;
    const graphics = targetScene.make.graphics({ x: 0, y: 0, add: false });
    graphics.fillStyle(color, 1);
    graphics.fillRoundedRect(0, 0, width, height, Math.min(width, height) * 0.24);
    graphics.generateTexture(textureKey, width, height);
    graphics.destroy();
  }

  function createLayers(targetScene) {
    gridGraphics = targetScene.add.graphics().setDepth(0);
    beltGraphics = targetScene.add.graphics().setDepth(10);
    machineGraphics = targetScene.add.graphics().setDepth(20);
    furnaceGraphics = targetScene.add.graphics().setDepth(20);
    warningGraphics = targetScene.add.graphics().setDepth(35);
    previewGraphics = targetScene.add.graphics().setDepth(60);

    generatorLabel = targetScene.add.text(0, 0, "炎発生装置", {
      color: "#e7e9ed",
      fontFamily: "Inter, Hiragino Sans, Yu Gothic UI, sans-serif",
      fontStyle: "bold",
    }).setOrigin(0.5).setDepth(24);

    furnaceIcon = targetScene.add.text(0, 0, "🔥", {
      fontFamily: "sans-serif",
    }).setOrigin(0.5).setDepth(24);
    furnaceIcon.setShadow(0, 0, "#ff5b18", 12, true, true);

    furnaceCounter = targetScene.add.text(0, 0, "🔥 0/10", {
      color: "#f5f1e8",
      backgroundColor: "rgba(7, 10, 14, 0.88)",
      fontFamily: "Inter, Hiragino Sans, Yu Gothic UI, sans-serif",
      fontStyle: "bold",
      padding: { x: 9, y: 5 },
    }).setOrigin(0.5).setDepth(25);

    createParticleTexture(targetScene, "beltfire-spark", 0xffa23d, 8);
    createParticleTexture(targetScene, "beltfire-smoke", 0x5e6670, 14);
    createParticleTexture(targetScene, "beltfire-water", 0x65e2ef, 9);
    createFragmentTexture(targetScene, "beltfire-metal", 0x8793a0, 8, 5);
    createFragmentTexture(targetScene, "beltfire-ash", 0x34332f, 7, 6);

    sparkEmitter = targetScene.add.particles(0, 0, "beltfire-spark", {
      emitting: false,
      lifespan: { min: 220, max: 620 },
      speed: { min: 24, max: 92 },
      angle: { min: 205, max: 335 },
      gravityY: 46,
      scale: { start: 0.9, end: 0 },
      alpha: { start: 1, end: 0 },
      blendMode: Phaser.BlendModes.ADD,
    }).setDepth(50);
    sparkEmitter.stop();

    smokeEmitter = targetScene.add.particles(0, 0, "beltfire-smoke", {
      emitting: false,
      lifespan: { min: 520, max: 1100 },
      speedX: { min: -16, max: 16 },
      speedY: { min: -44, max: -18 },
      scale: { start: 0.65, end: 1.7 },
      alpha: { start: 0.34, end: 0 },
      tint: [0x69717b, 0x3f464e, 0x252a30],
    }).setDepth(49);
    smokeEmitter.stop();

    waterEmitter = targetScene.add.particles(0, 0, "beltfire-water", {
      emitting: false,
      lifespan: { min: 240, max: 520 },
      speed: { min: 18, max: 62 },
      angle: { min: 205, max: 335 },
      gravityY: 70,
      scale: { start: 0.72, end: 0.18 },
      alpha: { start: 0.88, end: 0 },
      tint: [0xa9f3f7, 0x65e2ef, 0x3aaabe],
    }).setDepth(50);
    waterEmitter.stop();

    metalEmitter = targetScene.add.particles(0, 0, "beltfire-metal", {
      emitting: false,
      lifespan: { min: 260, max: 480 },
      speed: { min: 48, max: 112 },
      angle: { min: 205, max: 335 },
      gravityY: 230,
      rotate: { min: -220, max: 220 },
      scale: { start: 0.9, end: 0.35 },
      alpha: { start: 1, end: 0 },
      tint: [0xaab4bf, 0x74808c, 0x4e5964],
    }).setDepth(72);
    metalEmitter.stop();

    demolitionSparkEmitter = targetScene.add.particles(0, 0, "beltfire-spark", {
      emitting: false,
      lifespan: { min: 150, max: 340 },
      speed: { min: 42, max: 105 },
      angle: { min: 200, max: 340 },
      gravityY: 90,
      scale: { start: 0.72, end: 0 },
      alpha: { start: 0.9, end: 0 },
      blendMode: Phaser.BlendModes.ADD,
    }).setDepth(73);
    demolitionSparkEmitter.stop();

    ashEmitter = targetScene.add.particles(0, 0, "beltfire-ash", {
      emitting: false,
      lifespan: { min: 320, max: 680 },
      speedX: { min: -54, max: 54 },
      speedY: { min: -36, max: 18 },
      gravityY: 150,
      rotate: { min: -160, max: 160 },
      scale: { start: 0.85, end: 0.22 },
      alpha: { start: 0.92, end: 0 },
      tint: [0x4c4943, 0x34332f, 0x1d1e1e],
    }).setDepth(72);
    ashEmitter.stop();

    demolitionSmokeEmitter = targetScene.add.particles(0, 0, "beltfire-smoke", {
      emitting: false,
      lifespan: { min: 480, max: 900 },
      speedX: { min: -13, max: 13 },
      speedY: { min: -38, max: -16 },
      scale: { start: 0.45, end: 1.3 },
      alpha: { start: 0.25, end: 0 },
      tint: [0x555b62, 0x353a40, 0x24282d],
    }).setDepth(71);
    demolitionSmokeEmitter.stop();
  }

  function drawGrid() {
    if (!gridGraphics) return;
    gridGraphics.clear();
    gridGraphics.fillStyle(COLORS.background, 1);
    gridGraphics.fillRect(0, 0, layout.viewportWidth, layout.viewportHeight);
    gridGraphics.fillStyle(COLORS.orange, 0.025);
    gridGraphics.fillCircle(
      layout.left + layout.width / 2,
      layout.top + layout.height * 0.68,
      layout.width * 0.65,
    );
    gridGraphics.lineStyle(1, COLORS.grid, 0.055);
    for (let x = 0; x <= GRID.cols; x += 1) {
      const px = layout.left + x * layout.cell;
      gridGraphics.lineBetween(px, layout.top, px, layout.top + layout.height);
    }
    for (let y = 0; y <= GRID.rows; y += 1) {
      const py = layout.top + y * layout.cell;
      gridGraphics.lineBetween(layout.left, py, layout.left + layout.width, py);
    }
  }

  function drawDirectionArrow(graphics, center, direction, size, alpha = 1, offset = 0) {
    if (!direction) return;
    const delta = DIRS[direction];
    const perpendicular = { x: -delta.y, y: delta.x };
    const cx = center.x + delta.x * offset;
    const cy = center.y + delta.y * offset;
    const tip = { x: cx + delta.x * size * 0.18, y: cy + delta.y * size * 0.18 };
    const back = { x: cx - delta.x * size * 0.1, y: cy - delta.y * size * 0.1 };
    graphics.fillStyle(COLORS.beltArrow, alpha);
    graphics.fillTriangle(
      tip.x,
      tip.y,
      back.x + perpendicular.x * size * 0.13,
      back.y + perpendicular.y * size * 0.13,
      back.x - perpendicular.x * size * 0.13,
      back.y - perpendicular.y * size * 0.13,
    );
  }

  function destroyDemolitionView(view) {
    if (!view) return;
    scene?.tweens.killTweensOf(view);
    demolitionViews.delete(view);
    view.destroy(true);
  }

  function scheduleDemolition(callback, delayMs) {
    let timer;
    timer = scene.time.delayedCall(delayMs, () => {
      demolitionTimers.delete(timer);
      callback();
    });
    demolitionTimers.add(timer);
  }

  function createBeltGhost(belt, kind) {
    const center = cellCenter(belt.x, belt.y);
    const size = layout.cell;
    const container = scene.add.container(center.x, center.y).setDepth(66);
    const graphics = scene.add.graphics();
    const isBroken = kind === "broken";

    graphics.fillStyle(isBroken ? COLORS.ash : COLORS.belt, 1);
    graphics.fillRoundedRect(-size * 0.43, -size * 0.43, size * 0.86, size * 0.86, size * 0.11);
    graphics.lineStyle(
      Math.max(1.2, size * 0.045),
      isBroken ? COLORS.ashEdge : COLORS.beltEdge,
      1,
    );
    graphics.strokeRoundedRect(-size * 0.43, -size * 0.43, size * 0.86, size * 0.86, size * 0.11);

    const direction = DIRS[belt.outDir] || DIRS.U;
    graphics.lineStyle(size * 0.38, isBroken ? 0x2b2b29 : COLORS.beltTrack, 1);
    graphics.lineBetween(
      -direction.x * size * 0.45,
      -direction.y * size * 0.45,
      direction.x * size * 0.45,
      direction.y * size * 0.45,
    );
    graphics.fillStyle(isBroken ? 0x34332f : 0x232b34, 1);
    graphics.fillCircle(0, 0, size * 0.21);

    if (!isBroken) {
      drawDirectionArrow(graphics, { x: 0, y: 0 }, belt.outDir, size);
      graphics.fillStyle(0xaab4bf, 0.8);
      graphics.fillCircle(-size * 0.29, -size * 0.29, size * 0.035);
      graphics.fillCircle(size * 0.29, size * 0.29, size * 0.035);
      container.add(graphics);
    } else {
      const skull = scene.add.text(0, 0, "💀", {
        fontFamily: "sans-serif",
        fontSize: `${Math.max(13, Math.round(size * 0.5))}px`,
      }).setOrigin(0.5);
      container.add([graphics, skull]);
    }

    demolitionViews.add(container);
    return container;
  }

  function showHammer(origin) {
    const center = cellCenter(origin.x, origin.y);
    const size = layout.cell;
    const hammer = scene.add.text(
      center.x - size * 0.27,
      center.y - size * 0.38,
      "🔨",
      { fontFamily: "sans-serif", fontSize: `${Math.max(18, Math.round(size * 0.54))}px` },
    ).setOrigin(0.5).setAngle(-38).setDepth(78);
    demolitionViews.add(hammer);
    scene.tweens.add({
      targets: hammer,
      x: center.x - size * 0.04,
      y: center.y - size * 0.06,
      angle: 12,
      duration: 72,
      ease: "Quad.easeIn",
      onComplete: () => {
        scene.tweens.add({
          targets: hammer,
          y: center.y - size * 0.2,
          alpha: 0,
          duration: 105,
          ease: "Quad.easeOut",
          onComplete: () => destroyDemolitionView(hammer),
        });
      },
    });
  }

  function collapseBeltGhost(view, kind, index, isLast) {
    const x = view.x;
    const y = view.y;
    const size = layout.cell;
    if (kind === "normal") {
      metalEmitter?.explode(7, x, y);
      demolitionSparkEmitter?.explode(4, x, y);
      playTone(720, 80, { endFrequency: 430, volume: 0.026, type: "square" });
      playTone(170, 140, { endFrequency: 92, volume: 0.026, type: "triangle" });
    } else {
      ashEmitter?.explode(7, x, y);
      demolitionSmokeEmitter?.explode(3, x, y);
      if (index === 0 || isLast) {
        playTone(index === 0 ? 118 : 86, 145, {
          endFrequency: 62,
          volume: 0.018,
          type: "triangle",
        });
      }
    }

    scene.tweens.add({
      targets: view,
      y: y + size * (kind === "normal" ? 0.08 : 0.2),
      scaleX: kind === "normal" ? 1.12 : 1.06,
      scaleY: kind === "normal" ? 0.18 : 0.08,
      angle: kind === "normal" ? 4 : (index % 2 === 0 ? -5 : 5),
      alpha: 0,
      duration: kind === "normal" ? 175 : 205,
      ease: "Quad.easeIn",
      onComplete: () => destroyDemolitionView(view),
    });
  }

  function playRemoveEffect(payload) {
    const kind = payload.kind === "broken" ? "broken" : "normal";
    const belts = payload.belts || [];
    if (!belts.length) return;
    const origin = payload.origin || belts[0];
    const ghosts = belts.map((belt) => createBeltGhost(belt, kind));
    const interval = kind === "broken" && ghosts.length > 1
      ? Math.min(48, 360 / (ghosts.length - 1))
      : 0;

    showHammer(origin);
    ghosts.forEach((view, index) => {
      scheduleDemolition(
        () => collapseBeltGhost(view, kind, index, index === ghosts.length - 1),
        68 + interval * index,
      );
    });
  }

  function clearDemolitionEffects() {
    for (const timer of demolitionTimers) timer.remove(false);
    demolitionTimers.clear();
    for (const view of [...demolitionViews]) destroyDemolitionView(view);
    metalEmitter?.killAll();
    ashEmitter?.killAll();
    demolitionSparkEmitter?.killAll();
    demolitionSmokeEmitter?.killAll();
  }

  function beltConnections(belt, state, preview = false) {
    const directions = preview && belt.previewInDir
      ? [belt.previewInDir]
      : incomingBeltDirections(belt, state.belts, state.generator);
    for (const generator of state.generators || []) {
      if (
        belt.y === generator.y - 1
        && (belt.x === generator.x || belt.x === generator.x + 1)
        && !directions.includes("D")
      ) directions.push("D");
    }
    if (
      state.pumps?.some((pump) => belt.x === pump.x && belt.y === pump.y - 1)
      && !directions.includes("D")
    ) {
      directions.push("D");
    }
    if (
      state.machines?.some((machine) => (
        machine.state === "normal" && sameCell(machine.outputPort?.approach, belt)
      ))
      && !directions.includes("D")
    ) directions.push("D");
    if (belt.outDir && !directions.includes(belt.outDir)) directions.push(belt.outDir);
    return directions;
  }

  function drawBelt(graphics, belt, state, preview = false) {
    const center = cellCenter(belt.x, belt.y);
    const size = layout.cell;
    const beltState = belt.state || "normal";
    const alpha = preview ? 0.52 : 1;
    const fill = beltState === "broken"
      ? COLORS.ash
      : beltState === "failing"
        ? belt.failureType === "electricity" ? 0x514b20 : COLORS.burning
        : COLORS.belt;
    const edge = beltState === "broken"
      ? COLORS.ashEdge
      : beltState === "failing"
        ? belt.failureType === "electricity" ? 0xffdc63 : COLORS.burningEdge
        : COLORS.beltEdge;
    const track = beltState === "broken"
      ? 0x2b2b29
      : beltState === "failing"
        ? belt.failureType === "electricity" ? 0x765f19 : 0xd9482f
        : COLORS.beltTrack;

    if (beltState === "failing") {
      const glow = belt.failureType === "electricity" ? 0xffdc63 : COLORS.danger;
      graphics.fillStyle(glow, 0.09 + Math.sin(visualTime / 95) * 0.025);
      graphics.fillCircle(center.x, center.y, size * 0.54);
    }
    graphics.fillStyle(fill, alpha);
    graphics.fillRoundedRect(
      center.x - size * 0.43,
      center.y - size * 0.43,
      size * 0.86,
      size * 0.86,
      size * 0.11,
    );
    graphics.lineStyle(Math.max(1.2, size * 0.045), edge, alpha);
    graphics.strokeRoundedRect(
      center.x - size * 0.43,
      center.y - size * 0.43,
      size * 0.86,
      size * 0.86,
      size * 0.11,
    );

    graphics.lineStyle(size * 0.38, track, alpha);
    for (const direction of beltConnections(belt, state, preview)) {
      const delta = DIRS[direction];
      graphics.lineBetween(
        center.x,
        center.y,
        center.x + delta.x * size * 0.47,
        center.y + delta.y * size * 0.47,
      );
    }
    graphics.fillStyle(
      beltState === "broken"
        ? 0x34332f
        : beltState === "failing"
          ? belt.failureType === "electricity" ? 0xffdc63 : COLORS.burningEdge
          : 0x232b34,
      alpha,
    );
    graphics.fillCircle(center.x, center.y, size * 0.21);

    if (beltState === "normal" || preview) {
      const motion = paused ? 0 : ((visualTime % 520) / 520 - 0.5) * size * 0.14;
      drawDirectionArrow(graphics, center, belt.outDir, size, alpha, motion);
    }
  }

  function syncBeltStateViews(state) {
    const activeKeys = new Set();
    for (const belt of state.belts.values()) {
      const beltKey = key(belt.x, belt.y);
      if (belt.state !== "failing" && belt.state !== "broken") continue;
      activeKeys.add(beltKey);
      let view = beltStateViews.get(beltKey);
      if (!view) {
        view = scene.add.text(0, 0, "", { fontFamily: "sans-serif" })
          .setOrigin(0.5)
          .setDepth(32);
        beltStateViews.set(beltKey, view);
      }
      const center = cellCenter(belt.x, belt.y);
      const failureIcon = belt.failureType === "electricity"
        ? "⚡"
        : belt.failureType === "water" ? "💧" : belt.failureType === "steam" ? "☁️" : "🔥";
      view.setPosition(center.x, center.y - (belt.state === "failing" ? layout.cell * 0.11 : 0));
      view.setText(belt.state === "failing" ? failureIcon : "💀");
      view.setFontSize(Math.max(13, Math.round(layout.cell * (belt.state === "failing" ? 0.56 : 0.5))));
      view.setAlpha(belt.state === "failing" ? 0.9 + Math.sin(visualTime / 80) * 0.1 : 0.92);
      if (belt.state === "failing") {
        const shadow = belt.failureType === "electricity"
          ? "#ffe06b"
          : belt.failureType === "water" ? "#65e2ef" : "#ff5e14";
        view.setShadow(0, 0, shadow, 10, true, true);
      } else {
        view.setShadow(0, 0, "#000000", 5, true, true);
      }
    }
    for (const [beltKey, view] of beltStateViews) {
      if (activeKeys.has(beltKey)) continue;
      view.destroy();
      beltStateViews.delete(beltKey);
    }
  }

  function drawBelts(state) {
    beltGraphics.clear();
    for (const belt of state.belts.values()) drawBelt(beltGraphics, belt, state);
    syncBeltStateViews(state);
  }

  function drawPortArrow(
    graphics,
    x,
    y,
    active,
    inward = false,
    activeColor = COLORS.orangeSoft,
  ) {
    const size = layout.cell;
    const pulse = 0.88 + Math.sin(visualTime / 320) * 0.1;
    const color = active ? activeColor : 0xd4dae2;
    const alpha = active ? 1 : 0.72;
    graphics.fillStyle(color, alpha);
    graphics.fillTriangle(
      x,
      y - size * 0.22 * pulse,
      x + size * 0.16,
      y + size * 0.02,
      x - size * 0.16,
      y + size * 0.02,
    );
    graphics.fillRect(x - size * 0.06, y, size * 0.12, size * 0.2);
    if (inward) {
      graphics.fillStyle(COLORS.cyan, 0.95);
      graphics.fillCircle(x, y - size * 0.31, size * 0.045);
    }
  }

  function drawFireMachines(state) {
    machineGraphics.clear();
    furnaceGraphics.clear();
    const { furnace, generator, belts } = state;
    const furnaceWidth = furnace.w * layout.cell - 4;
    const furnaceHeight = furnace.h * layout.cell - 4;
    const furnaceCenter = {
      x: layout.left + furnace.x * layout.cell + 2 + furnaceWidth / 2,
      y: layout.top + furnace.y * layout.cell + 2 + furnaceHeight / 2,
    };
    const furnaceX = -furnaceWidth / 2;
    const furnaceY = -furnaceHeight / 2;
    const progress = Math.min(1, furnace.received / furnace.target);
    const counterPulse = Math.min(1, furnace.counterPulseMs / 300);
    const zoomProgress = furnaceZoom.remainingMs > 0
      ? 1 - furnaceZoom.remainingMs / furnaceZoom.durationMs
      : 1;
    const furnaceScale = furnaceZoom.remainingMs > 0
      ? 1 + Math.sin(zoomProgress * Math.PI) * furnaceZoom.strength
      : 1;

    furnaceGraphics
      .setPosition(furnaceCenter.x, furnaceCenter.y)
      .setScale(furnaceScale);

    furnaceGraphics.fillStyle(COLORS.orange, 0.06 + progress * 0.12 + counterPulse * 0.08);
    furnaceGraphics.fillRoundedRect(
      furnaceX - layout.cell * 0.09,
      furnaceY - layout.cell * 0.09,
      furnaceWidth + layout.cell * 0.18,
      furnaceHeight + layout.cell * 0.18,
      layout.cell * 0.22,
    );
    furnaceGraphics.fillStyle(COLORS.machineTop, 1);
    furnaceGraphics.fillRoundedRect(furnaceX, furnaceY, furnaceWidth, furnaceHeight, layout.cell * 0.18);
    furnaceGraphics.fillStyle(COLORS.machineBottom, 0.7);
    furnaceGraphics.fillRoundedRect(
      furnaceX + 2,
      furnaceY + furnaceHeight * 0.47,
      furnaceWidth - 4,
      furnaceHeight * 0.51,
      layout.cell * 0.15,
    );
    furnaceGraphics.lineStyle(2, 0x6d737c, 1);
    furnaceGraphics.strokeRoundedRect(furnaceX, furnaceY, furnaceWidth, furnaceHeight, layout.cell * 0.18);
    furnaceGraphics.fillStyle(0x06080c, 0.58);
    furnaceGraphics.fillRoundedRect(
      furnaceX + furnaceWidth * 0.18,
      furnaceY + furnaceHeight * 0.14,
      furnaceWidth * 0.64,
      furnaceHeight * 0.44,
      layout.cell * 0.12,
    );
    furnaceGraphics.fillStyle(COLORS.orange, 0.18 + progress * 0.48);
    furnaceGraphics.fillRoundedRect(
      furnaceX + furnaceWidth * 0.2,
      furnaceY + furnaceHeight * (0.56 - progress * 0.36),
      furnaceWidth * 0.6,
      furnaceHeight * 0.36 * progress,
      layout.cell * 0.08,
    );

    furnaceIcon
      .setPosition(
        furnaceCenter.x,
        furnaceCenter.y + (furnaceY + furnaceHeight * 0.37) * furnaceScale,
      )
      .setFontSize(Math.max(22, Math.round(layout.cell * 0.6)))
      .setScale((1 + progress * 0.08 + counterPulse * 0.11) * furnaceScale)
      .setAlpha(0.64 + progress * 0.36);
    furnaceCounter
      .setPosition(
        furnaceCenter.x,
        furnaceCenter.y + (furnaceY + furnaceHeight * 0.78) * furnaceScale,
      )
      .setText(`🔥 ${furnace.received}/${furnace.target}`)
      .setFontSize(Math.max(9, Math.round(layout.cell * 0.2)))
      .setScale((1 + counterPulse * 0.09) * furnaceScale)
      .setColor(furnace.received >= furnace.target ? "#ffd78d" : "#f5f1e8");

    for (let port = 0; port < 2; port += 1) {
      const x = furnace.x + port;
      const below = belts.get(key(x, furnace.y + furnace.h));
      drawPortArrow(
        furnaceGraphics,
        (port - 0.5) * layout.cell,
        layout.cell - 5,
        below?.outDir === "U",
        true,
      );
    }

    const generatorX = layout.left + generator.x * layout.cell + 2;
    const generatorY = layout.top + generator.y * layout.cell + 2;
    const generatorWidth = generator.w * layout.cell - 4;
    const generatorHeight = generator.h * layout.cell - 4;
    machineGraphics.fillStyle(COLORS.orange, 0.055);
    machineGraphics.fillRoundedRect(
      generatorX - layout.cell * 0.08,
      generatorY - layout.cell * 0.08,
      generatorWidth + layout.cell * 0.16,
      generatorHeight + layout.cell * 0.16,
      layout.cell * 0.21,
    );
    machineGraphics.fillStyle(COLORS.generatorTop, 1);
    machineGraphics.fillRoundedRect(generatorX, generatorY, generatorWidth, generatorHeight, layout.cell * 0.18);
    machineGraphics.fillStyle(COLORS.generatorBottom, 0.7);
    machineGraphics.fillRoundedRect(
      generatorX + 2,
      generatorY + generatorHeight * 0.5,
      generatorWidth - 4,
      generatorHeight * 0.48,
      layout.cell * 0.15,
    );
    machineGraphics.lineStyle(2, 0x7a8089, 1);
    machineGraphics.strokeRoundedRect(generatorX, generatorY, generatorWidth, generatorHeight, layout.cell * 0.18);

    for (let port = 0; port < 2; port += 1) {
      const chamberX = generatorX + generatorWidth * (0.08 + port * 0.5);
      const chamberY = generatorY + generatorHeight * 0.12;
      const chamberWidth = generatorWidth * 0.34;
      const chamberHeight = generatorHeight * 0.47;
      const flash = Math.min(1, generator.portFlashMs[port] / TIMING.ejectMs);
      machineGraphics.fillStyle(0x06080c, 0.66 + flash * 0.16);
      machineGraphics.fillRoundedRect(
        chamberX,
        chamberY,
        chamberWidth,
        chamberHeight,
        layout.cell * 0.1,
      );
      machineGraphics.lineStyle(Math.max(1, layout.cell * 0.025), COLORS.orange, 0.2 + flash * 0.78);
      machineGraphics.strokeRoundedRect(
        chamberX,
        chamberY,
        chamberWidth,
        chamberHeight,
        layout.cell * 0.1,
      );
      machineGraphics.fillStyle(0xff6818, 0.38 + flash * 0.62);
      machineGraphics.fillCircle(
        chamberX + chamberWidth / 2,
        chamberY + chamberHeight * 0.55,
        layout.cell * (0.055 + flash * 0.035),
      );
    }

    generatorLabel
      .setPosition(generatorX + generatorWidth / 2, generatorY + generatorHeight * 0.78)
      .setFontSize(Math.max(9, Math.round(layout.cell * 0.21)));

    for (let port = 0; port < 2; port += 1) {
      const x = generator.x + port;
      const connected = belts.get(key(x, generator.y - 1))?.state === "normal";
      drawPortArrow(
        machineGraphics,
        cellCenter(x, generator.y).x,
        layout.top + generator.y * layout.cell + 5,
        connected,
      );
    }
  }

  function clearPumpViews(activeIds = new Set()) {
    for (const [pumpId, view] of pumpViews) {
      if (activeIds.has(pumpId)) continue;
      view.icon.destroy();
      view.label.destroy();
      for (const slot of view.slots || []) slot.destroy();
      pumpViews.delete(pumpId);
    }
  }

  function clearSourceViews(activeIds = new Set()) {
    for (const [sourceId, view] of sourceViews) {
      if (activeIds.has(sourceId)) continue;
      view.icon.destroy();
      view.label.destroy();
      sourceViews.delete(sourceId);
    }
  }

  function resourceIcon(type) {
    if (type === "electricity") return "⚡";
    if (type === "water") return "💧";
    if (type === "steam") return "☁️";
    return "🔥";
  }

  function resourceColor(type) {
    if (type === "electricity") return 0xffdc63;
    if (type === "water") return COLORS.cyan;
    if (type === "steam") return 0xcceef5;
    return COLORS.orange;
  }

  function drawSteamMachines(state) {
    machineGraphics.clear();
    furnaceGraphics.clear();
    generatorLabel.setVisible(false);
    const { lamp, generators = [], machines = [], belts } = state;

    const lampWidth = lamp.w * layout.cell - 4;
    const lampHeight = lamp.h * layout.cell - 4;
    const lampCenter = {
      x: layout.left + lamp.x * layout.cell + 2 + lampWidth / 2,
      y: layout.top + lamp.y * layout.cell + 2 + lampHeight / 2,
    };
    const lampX = -lampWidth / 2;
    const lampY = -lampHeight / 2;
    const lit = lamp.received > 0;
    const counterPulse = Math.min(1, lamp.counterPulseMs / 420);
    const zoomProgress = furnaceZoom.remainingMs > 0
      ? 1 - furnaceZoom.remainingMs / furnaceZoom.durationMs
      : 1;
    const lampScale = furnaceZoom.remainingMs > 0
      ? 1 + Math.sin(zoomProgress * Math.PI) * furnaceZoom.strength
      : 1;

    furnaceGraphics.setPosition(lampCenter.x, lampCenter.y).setScale(lampScale);
    furnaceGraphics.fillStyle(0xffdf72, lit ? 0.24 + counterPulse * 0.12 : 0.045);
    furnaceGraphics.fillCircle(0, -layout.cell * 0.1, layout.cell * (lit ? 1.02 : 0.72));
    furnaceGraphics.fillStyle(lit ? 0x5b543d : 0x3d4650, 1);
    furnaceGraphics.fillRoundedRect(lampX, lampY, lampWidth, lampHeight, layout.cell * 0.18);
    furnaceGraphics.fillStyle(lit ? 0x322f24 : 0x202831, 0.92);
    furnaceGraphics.fillRoundedRect(
      lampX + 2,
      lampY + lampHeight * 0.48,
      lampWidth - 4,
      lampHeight * 0.5,
      layout.cell * 0.15,
    );
    furnaceGraphics.lineStyle(2, lit ? 0xffdc63 : 0x6f7b87, 1);
    furnaceGraphics.strokeRoundedRect(lampX, lampY, lampWidth, lampHeight, layout.cell * 0.18);

    furnaceIcon
      .setVisible(true)
      .setText("💡")
      .setPosition(lampCenter.x, lampCenter.y - layout.cell * 0.16 * lampScale)
      .setFontSize(Math.max(24, Math.round(layout.cell * 0.66)))
      .setScale((1 + counterPulse * 0.14) * lampScale)
      .setAlpha(lit ? 1 : 0.46);
    furnaceIcon.setShadow(0, 0, lit ? "#ffe06b" : "#687580", lit ? 22 : 4, true, true);
    furnaceCounter
      .setVisible(true)
      .setPosition(lampCenter.x, lampCenter.y + layout.cell * 0.53 * lampScale)
      .setText(`⚡ ${lamp.received}/${lamp.target}`)
      .setFontSize(Math.max(9, Math.round(layout.cell * 0.2)))
      .setScale((1 + counterPulse * 0.09) * lampScale)
      .setColor(lit ? "#ffe693" : "#eef4f6");

    for (let port = 0; port < 2; port += 1) {
      const x = lamp.x + port;
      const below = belts.get(key(x, lamp.y + lamp.h));
      drawPortArrow(
        furnaceGraphics,
        (port - 0.5) * layout.cell,
        layout.cell - 5,
        below?.outDir === "U",
        true,
        0xffdc63,
      );
    }

    const activeSourceIds = new Set();
    for (const generator of generators) {
      activeSourceIds.add(generator.id);
      const x = layout.left + generator.x * layout.cell + 2;
      const y = layout.top + generator.y * layout.cell + 2;
      const width = generator.w * layout.cell - 4;
      const height = generator.h * layout.cell - 4;
      const color = resourceColor(generator.resourceType);
      machineGraphics.fillStyle(color, 0.065);
      machineGraphics.fillRoundedRect(
        x - layout.cell * 0.08,
        y - layout.cell * 0.08,
        width + layout.cell * 0.16,
        height + layout.cell * 0.16,
        layout.cell * 0.21,
      );
      machineGraphics.fillStyle(generator.resourceType === "water" ? 0x405665 : COLORS.generatorTop, 1);
      machineGraphics.fillRoundedRect(x, y, width, height, layout.cell * 0.18);
      machineGraphics.fillStyle(generator.resourceType === "water" ? 0x233741 : COLORS.generatorBottom, 0.86);
      machineGraphics.fillRoundedRect(
        x + 2,
        y + height * 0.5,
        width - 4,
        height * 0.48,
        layout.cell * 0.15,
      );
      machineGraphics.lineStyle(2, generator.resourceType === "water" ? 0x6f92a1 : 0x7a8089, 1);
      machineGraphics.strokeRoundedRect(x, y, width, height, layout.cell * 0.18);

      for (let port = 0; port < 2; port += 1) {
        const chamberX = x + width * (0.08 + port * 0.5);
        const chamberY = y + height * 0.12;
        const chamberWidth = width * 0.34;
        const chamberHeight = height * 0.47;
        const flash = Math.min(1, generator.portFlashMs[port] / TIMING.ejectMs);
        machineGraphics.fillStyle(0x06090d, 0.66 + flash * 0.14);
        machineGraphics.fillRoundedRect(
          chamberX,
          chamberY,
          chamberWidth,
          chamberHeight,
          layout.cell * 0.1,
        );
        machineGraphics.lineStyle(Math.max(1, layout.cell * 0.025), color, 0.24 + flash * 0.7);
        machineGraphics.strokeRoundedRect(
          chamberX,
          chamberY,
          chamberWidth,
          chamberHeight,
          layout.cell * 0.1,
        );
      }

      let view = sourceViews.get(generator.id);
      if (!view) {
        view = {
          icon: scene.add.text(0, 0, resourceIcon(generator.resourceType), { fontFamily: "sans-serif" })
            .setOrigin(0.5).setDepth(24),
          label: scene.add.text(0, 0, generator.label, {
            color: "#e7eef1",
            fontFamily: "Inter, Hiragino Sans, Yu Gothic UI, sans-serif",
            fontStyle: "bold",
          }).setOrigin(0.5).setDepth(24),
        };
        sourceViews.set(generator.id, view);
      }
      const flash = Math.max(...generator.portFlashMs) / TIMING.ejectMs;
      view.icon
        .setText(resourceIcon(generator.resourceType))
        .setPosition(x + width / 2, y + height * 0.37)
        .setFontSize(Math.max(19, Math.round(layout.cell * 0.49)))
        .setScale(1 + flash * 0.12);
      view.label
        .setText(generator.label)
        .setPosition(x + width / 2, y + height * 0.78)
        .setFontSize(Math.max(7, Math.round(layout.cell * 0.16)));

      for (let port = 0; port < 2; port += 1) {
        const portX = generator.x + port;
        const connected = belts.get(key(portX, generator.y - 1))?.state === "normal";
        drawPortArrow(
          machineGraphics,
          cellCenter(portX, generator.y).x,
          layout.top + generator.y * layout.cell + 5,
          connected,
          false,
          color,
        );
      }
    }
    clearSourceViews(activeSourceIds);

    const activeMachineIds = new Set();
    for (const machine of machines) {
      activeMachineIds.add(machine.id);
      const failing = machine.state === "failing";
      const broken = machine.state === "broken";
      const contaminated = machine.state === "normal" && Boolean(machine.contaminationType);
      const contaminationDanger = contaminated
        ? Phaser.Math.Clamp(
          (machine.contaminationMs - FAILURE_TIMING.warningMs)
            / (FAILURE_TIMING.triggerMs - FAILURE_TIMING.warningMs),
          0,
          1,
        )
        : 0;
      const pulse = Math.min(1, machine.inputPulseMs / 320);
      const outputPulse = Math.min(1, machine.outputPulseMs / 320);
      const accent = machine.type === "boiler" ? COLORS.orange : 0xbfeaf2;
      const failureColor = resourceColor(machine.failureType || machine.contaminationType);
      const bodyColor = broken
        ? COLORS.ash
        : failing ? 0x4b3030 : machine.type === "boiler" ? 0x51483e : 0x40515b;
      const edgeColor = broken
        ? COLORS.ashEdge
        : failing || contaminationDanger > 0
          ? failureColor
          : machine.type === "boiler" ? 0x9a7658 : 0x7596a1;
      const glowAlpha = failing
        ? 0.12 + Math.sin(visualTime / 90) * 0.04
        : 0.05 + pulse * 0.1 + contaminationDanger * 0.09;
      drawUnifiedSteamMachineBody(
        machineGraphics,
        machine,
        layout,
        bodyColor,
        edgeColor,
        glowAlpha,
      );

      for (const port of machine.inputPorts) {
        const inputCenter = cellCenter(port.targetCell.x, port.targetCell.y);
        machineGraphics.fillStyle(broken ? 0x111317 : 0x202930, 0.76);
        machineGraphics.fillRoundedRect(
          inputCenter.x - layout.cell * 0.31,
          inputCenter.y - layout.cell * 0.31,
          layout.cell * 0.62,
          layout.cell * 0.62,
          layout.cell * 0.11,
        );
        machineGraphics.lineStyle(1, edgeColor, broken ? 0.35 : 0.62);
        machineGraphics.strokeRoundedRect(
          inputCenter.x - layout.cell * 0.31,
          inputCenter.y - layout.cell * 0.31,
          layout.cell * 0.62,
          layout.cell * 0.62,
          layout.cell * 0.11,
        );
      }

      if (contaminationDanger > 0 && machine.contaminationPortIndex !== null) {
        const contaminatedCell = machine.inputPorts[machine.contaminationPortIndex].targetCell;
        const warningCenter = cellCenter(contaminatedCell.x, contaminatedCell.y);
        machineGraphics.lineStyle(
          Math.max(2, layout.cell * 0.055),
          failureColor,
          0.38 + contaminationDanger * 0.5 + Math.sin(visualTime / 85) * 0.08,
        );
        machineGraphics.strokeRoundedRect(
          warningCenter.x - layout.cell * 0.45,
          warningCenter.y - layout.cell * 0.45,
          layout.cell * 0.9,
          layout.cell * 0.9,
          layout.cell * 0.14,
        );
      }

      for (const port of machine.inputPorts) {
        const below = belts.get(key(port.approach.x, port.approach.y));
        drawPortArrow(
          machineGraphics,
          cellCenter(port.approach.x, 0).x,
          layout.top + port.approach.y * layout.cell - 5,
          machine.state === "normal" && below?.outDir === "U",
          true,
          machine.type === "boiler" ? COLORS.orangeSoft : 0xcceef5,
        );
      }
      const above = belts.get(key(machine.outputPort.approach.x, machine.outputPort.approach.y));
      drawPortArrow(
        machineGraphics,
        cellCenter(machine.outputPort.approach.x, 0).x,
        layout.top + machine.y * layout.cell + 5,
        machine.state === "normal" && above?.state === "normal",
        false,
        machine.type === "boiler" ? 0xcceef5 : 0xffdc63,
      );

      let view = pumpViews.get(machine.id);
      if (!view) {
        view = {
          icon: scene.add.text(0, 0, "", { fontFamily: "sans-serif" })
            .setOrigin(0.5).setDepth(24),
          label: scene.add.text(0, 0, machine.label, {
            color: "#dfe8ec",
            fontFamily: "Inter, Hiragino Sans, Yu Gothic UI, sans-serif",
            fontStyle: "bold",
          }).setOrigin(0.5).setDepth(24),
          slots: machine.inputPorts.map(() => (
            scene.add.text(0, 0, "", { fontFamily: "sans-serif" })
              .setOrigin(0.5).setDepth(25)
          )),
        };
        pumpViews.set(machine.id, view);
      }
      const icon = broken
        ? "💀"
        : failing ? resourceIcon(machine.failureType) : machine.type === "boiler" ? "♨️" : "🌀";
      const centerX = cellCenter(machine.x, machine.y).x;
      const centerY = cellCenter(machine.x, machine.y).y;
      view.icon
        .setText(icon)
        .setPosition(centerX, centerY - layout.cell * 0.12)
        .setFontSize(Math.max(14, Math.round(layout.cell * 0.42)))
        .setScale(failing ? 1 + Math.sin(visualTime / 80) * 0.1 : 1 + pulse * 0.12 + outputPulse * 0.1);
      view.label
        .setText(
          broken
            ? "故障"
            : failing ? "故障中" : contaminationDanger > 0 ? "異物滞留" : machine.label,
        )
        .setColor(
          broken
            ? "#9a9a9a"
            : failing || contaminationDanger > 0 ? "#ffd1c4" : "#dfe8ec",
        )
        .setPosition(centerX, centerY + layout.cell * 0.25)
        .setFontSize(Math.max(7, Math.round(layout.cell * 0.15)));
      for (let index = 0; index < view.slots.length; index += 1) {
        const slot = view.slots[index];
        const targetCell = machine.inputPorts[index].targetCell;
        const storedType = machine.storedSlots[index];
        const slotCenter = cellCenter(targetCell.x, targetCell.y);
        slot
          .setVisible(!broken && Boolean(storedType))
          .setText(storedType ? resourceIcon(storedType) : "")
          .setPosition(slotCenter.x, slotCenter.y)
          .setFontSize(Math.max(16, Math.round(layout.cell * 0.46)))
          .setScale(
            1 + pulse * 0.15
              + (index === machine.contaminationPortIndex ? contaminationDanger * 0.1 : 0),
          );
        if (storedType) {
          const shadow = storedType === "fire"
            ? "#ff5e14"
            : storedType === "water" ? "#65e2ef" : storedType === "steam" ? "#d8f5f8" : "#ffe06b";
          slot.setShadow(0, 0, shadow, 9, true, true);
        }
      }
    }
    clearPumpViews(activeMachineIds);
  }

  function drawWaterMachines(state) {
    machineGraphics.clear();
    furnaceGraphics.clear();
    const { tank, generator, pumps = [], belts } = state;
    const tankWidth = tank.w * layout.cell - 4;
    const tankHeight = tank.h * layout.cell - 4;
    const tankCenter = {
      x: layout.left + tank.x * layout.cell + 2 + tankWidth / 2,
      y: layout.top + tank.y * layout.cell + 2 + tankHeight / 2,
    };
    const tankX = -tankWidth / 2;
    const tankY = -tankHeight / 2;
    const progress = Math.min(1, tank.received / tank.target);
    const counterPulse = Math.min(1, tank.counterPulseMs / 300);
    const zoomProgress = furnaceZoom.remainingMs > 0
      ? 1 - furnaceZoom.remainingMs / furnaceZoom.durationMs
      : 1;
    const tankScale = furnaceZoom.remainingMs > 0
      ? 1 + Math.sin(zoomProgress * Math.PI) * furnaceZoom.strength
      : 1;

    furnaceGraphics
      .setPosition(tankCenter.x, tankCenter.y)
      .setScale(tankScale);
    furnaceGraphics.fillStyle(COLORS.cyan, 0.055 + progress * 0.13 + counterPulse * 0.08);
    furnaceGraphics.fillRoundedRect(
      tankX - layout.cell * 0.09,
      tankY - layout.cell * 0.09,
      tankWidth + layout.cell * 0.18,
      tankHeight + layout.cell * 0.18,
      layout.cell * 0.22,
    );
    furnaceGraphics.fillStyle(0x3f5360, 1);
    furnaceGraphics.fillRoundedRect(tankX, tankY, tankWidth, tankHeight, layout.cell * 0.18);
    furnaceGraphics.fillStyle(0x23333e, 0.86);
    furnaceGraphics.fillRoundedRect(
      tankX + 2,
      tankY + tankHeight * 0.47,
      tankWidth - 4,
      tankHeight * 0.51,
      layout.cell * 0.15,
    );
    furnaceGraphics.lineStyle(2, 0x6f8d9b, 1);
    furnaceGraphics.strokeRoundedRect(tankX, tankY, tankWidth, tankHeight, layout.cell * 0.18);
    furnaceGraphics.fillStyle(0x071016, 0.65);
    furnaceGraphics.fillRoundedRect(
      tankX + tankWidth * 0.18,
      tankY + tankHeight * 0.13,
      tankWidth * 0.64,
      tankHeight * 0.45,
      layout.cell * 0.12,
    );
    furnaceGraphics.fillStyle(COLORS.cyan, 0.2 + progress * 0.52);
    furnaceGraphics.fillRoundedRect(
      tankX + tankWidth * 0.2,
      tankY + tankHeight * (0.56 - progress * 0.36),
      tankWidth * 0.6,
      tankHeight * 0.36 * progress,
      layout.cell * 0.08,
    );

    furnaceIcon
      .setText("💧")
      .setPosition(
        tankCenter.x,
        tankCenter.y + (tankY + tankHeight * 0.37) * tankScale,
      )
      .setFontSize(Math.max(22, Math.round(layout.cell * 0.58)))
      .setScale((1 + progress * 0.07 + counterPulse * 0.1) * tankScale)
      .setAlpha(0.68 + progress * 0.32);
    furnaceIcon.setShadow(0, 0, "#65e2ef", 12, true, true);
    furnaceCounter
      .setPosition(
        tankCenter.x,
        tankCenter.y + (tankY + tankHeight * 0.78) * tankScale,
      )
      .setText(`💧 ${tank.received}/${tank.target}`)
      .setFontSize(Math.max(9, Math.round(layout.cell * 0.2)))
      .setScale((1 + counterPulse * 0.09) * tankScale)
      .setColor(tank.received >= tank.target ? "#bdf7fa" : "#eefbfc");

    for (let port = 0; port < 2; port += 1) {
      const x = tank.x + port;
      const below = belts.get(key(x, tank.y + tank.h));
      drawPortArrow(
        furnaceGraphics,
        (port - 0.5) * layout.cell,
        layout.cell - 5,
        below?.outDir === "U",
        true,
        COLORS.cyan,
      );
    }

    const generatorX = layout.left + generator.x * layout.cell + 2;
    const generatorY = layout.top + generator.y * layout.cell + 2;
    const generatorWidth = generator.w * layout.cell - 4;
    const generatorHeight = generator.h * layout.cell - 4;
    machineGraphics.fillStyle(0xffd65b, 0.055);
    machineGraphics.fillRoundedRect(
      generatorX - layout.cell * 0.08,
      generatorY - layout.cell * 0.08,
      generatorWidth + layout.cell * 0.16,
      generatorHeight + layout.cell * 0.16,
      layout.cell * 0.21,
    );
    machineGraphics.fillStyle(0x56616d, 1);
    machineGraphics.fillRoundedRect(generatorX, generatorY, generatorWidth, generatorHeight, layout.cell * 0.18);
    machineGraphics.fillStyle(0x303b47, 0.82);
    machineGraphics.fillRoundedRect(
      generatorX + 2,
      generatorY + generatorHeight * 0.5,
      generatorWidth - 4,
      generatorHeight * 0.48,
      layout.cell * 0.15,
    );
    machineGraphics.lineStyle(2, 0x7f8b98, 1);
    machineGraphics.strokeRoundedRect(generatorX, generatorY, generatorWidth, generatorHeight, layout.cell * 0.18);

    for (let port = 0; port < 2; port += 1) {
      const chamberX = generatorX + generatorWidth * (0.08 + port * 0.5);
      const chamberY = generatorY + generatorHeight * 0.12;
      const chamberWidth = generatorWidth * 0.34;
      const chamberHeight = generatorHeight * 0.47;
      const flash = Math.min(1, generator.portFlashMs[port] / TIMING.ejectMs);
      machineGraphics.fillStyle(0x080b10, 0.68 + flash * 0.14);
      machineGraphics.fillRoundedRect(
        chamberX,
        chamberY,
        chamberWidth,
        chamberHeight,
        layout.cell * 0.1,
      );
      machineGraphics.lineStyle(Math.max(1, layout.cell * 0.025), 0xffd65b, 0.2 + flash * 0.78);
      machineGraphics.strokeRoundedRect(
        chamberX,
        chamberY,
        chamberWidth,
        chamberHeight,
        layout.cell * 0.1,
      );
      machineGraphics.fillStyle(0xffdc63, 0.42 + flash * 0.58);
      machineGraphics.fillCircle(
        chamberX + chamberWidth / 2,
        chamberY + chamberHeight * 0.55,
        layout.cell * (0.05 + flash * 0.035),
      );
    }

    generatorLabel
      .setText("電気発生装置")
      .setPosition(generatorX + generatorWidth / 2, generatorY + generatorHeight * 0.78)
      .setFontSize(Math.max(8, Math.round(layout.cell * 0.19)));

    for (let port = 0; port < 2; port += 1) {
      const x = generator.x + port;
      const connected = belts.get(key(x, generator.y - 1))?.state === "normal";
      drawPortArrow(
        machineGraphics,
        cellCenter(x, generator.y).x,
        layout.top + generator.y * layout.cell + 5,
        connected,
        false,
        0xffd65b,
      );
    }

    const activePumpIds = new Set();
    for (const pump of pumps) {
      activePumpIds.add(pump.id);
      const x = layout.left + pump.x * layout.cell + 2;
      const y = layout.top + pump.y * layout.cell + 2;
      const width = pump.w * layout.cell - 4;
      const height = pump.h * layout.cell - 4;
      const chargePulse = Math.min(1, pump.chargePulseMs / 320);
      const outputPulse = Math.min(1, pump.outputPulseMs / 320);
      const charged = pump.storedElectricity > 0;
      const storedType = pump.contaminationType || (charged ? "electricity" : null);
      const failing = pump.state === "failing";
      const broken = pump.state === "broken";
      const contaminated = pump.state === "normal" && Boolean(pump.contaminationType);
      const contaminationDanger = contaminated
        ? Phaser.Math.Clamp(
          (pump.contaminationMs - FAILURE_TIMING.warningMs)
            / (FAILURE_TIMING.triggerMs - FAILURE_TIMING.warningMs),
          0,
          1,
        )
        : 0;
      const activeFailureType = pump.failureType || pump.contaminationType;
      const failureColor = activeFailureType === "electricity"
        ? 0xffdc63
        : activeFailureType === "water" ? COLORS.cyan : activeFailureType === "steam" ? 0xcceef5 : COLORS.danger;

      machineGraphics.fillStyle(
        broken
          ? COLORS.ashEdge
          : failing || contaminationDanger > 0 ? failureColor : charged ? 0xffd65b : COLORS.cyan,
        failing
          ? 0.12 + Math.sin(visualTime / 90) * 0.04
          : 0.04 + chargePulse * 0.12 + contaminationDanger * 0.09,
      );
      machineGraphics.fillRoundedRect(
        x - layout.cell * 0.06,
        y - layout.cell * 0.06,
        width + layout.cell * 0.12,
        height + layout.cell * 0.12,
        layout.cell * 0.16,
      );
      machineGraphics.fillStyle(broken ? COLORS.ash : failing ? 0x4b3030 : 0x43515c, 1);
      machineGraphics.fillRoundedRect(x, y, width, height, layout.cell * 0.14);
      machineGraphics.fillStyle(broken ? 0x111317 : failing ? 0x24181a : 0x222e37, 0.9);
      machineGraphics.fillRoundedRect(
        x + width * 0.16,
        y + height * 0.14,
        width * 0.68,
        height * 0.48,
        layout.cell * 0.1,
      );
      machineGraphics.lineStyle(
        2,
        broken ? COLORS.ashEdge : failing ? failureColor : charged ? 0xd6ba55 : 0x66818e,
        1,
      );
      machineGraphics.strokeRoundedRect(x, y, width, height, layout.cell * 0.14);
      if (contaminationDanger > 0) {
        const inputCenter = cellCenter(pump.x, pump.y + pump.h - 1);
        machineGraphics.lineStyle(
          Math.max(2, layout.cell * 0.055),
          failureColor,
          0.38 + contaminationDanger * 0.5 + Math.sin(visualTime / 85) * 0.08,
        );
        machineGraphics.strokeRoundedRect(
          inputCenter.x - layout.cell * 0.43,
          inputCenter.y - layout.cell * 0.43,
          layout.cell * 0.86,
          layout.cell * 0.86,
          layout.cell * 0.13,
        );
      }
      machineGraphics.fillStyle(
        broken ? 0x282a2e : failing ? failureColor : charged ? 0xffd65b : 0x17232b,
        charged || failing ? 0.86 : 0.9,
      );
      machineGraphics.fillCircle(x + width / 2, y + height * 0.36, layout.cell * 0.12);

      const pumpInputCenter = cellCenter(pump.x, pump.y + pump.h - 1);
      const inputColor = storedType ? resourceColor(storedType) : 0x7d8d99;
      machineGraphics.fillStyle(
        broken ? 0x111317 : storedType ? inputColor : 0x17232b,
        broken ? 0.72 : storedType ? 0.18 : 0.88,
      );
      machineGraphics.fillRoundedRect(
        pumpInputCenter.x - layout.cell * 0.34,
        pumpInputCenter.y - layout.cell * 0.34,
        layout.cell * 0.68,
        layout.cell * 0.68,
        layout.cell * 0.12,
      );
      machineGraphics.lineStyle(
        Math.max(1.5, layout.cell * 0.04),
        inputColor,
        broken ? 0.35 : storedType ? 0.9 : 0.58,
      );
      machineGraphics.strokeRoundedRect(
        pumpInputCenter.x - layout.cell * 0.34,
        pumpInputCenter.y - layout.cell * 0.34,
        layout.cell * 0.68,
        layout.cell * 0.68,
        layout.cell * 0.12,
      );

      const below = belts.get(key(pump.x, pump.y + pump.h));
      const above = belts.get(key(pump.x, pump.y - 1));
      drawPortArrow(
        machineGraphics,
        cellCenter(pump.x, 0).x,
        layout.top + (pump.y + pump.h) * layout.cell - 5,
        pump.state === "normal" && below?.outDir === "U",
        true,
        0xffd65b,
      );
      drawPortArrow(
        machineGraphics,
        cellCenter(pump.x, 0).x,
        layout.top + pump.y * layout.cell + 5,
        pump.state === "normal" && above?.state === "normal",
        false,
        COLORS.cyan,
      );

      let view = pumpViews.get(pump.id);
      if (!view) {
        view = {
          icon: scene.add.text(0, 0, "⚙️", { fontFamily: "sans-serif" })
            .setOrigin(0.5)
            .setDepth(24),
          label: scene.add.text(0, 0, "ポンプ", {
            color: "#dfe8ec",
            fontFamily: "Inter, Hiragino Sans, Yu Gothic UI, sans-serif",
            fontStyle: "bold",
          }).setOrigin(0.5).setDepth(24),
          slots: [
            scene.add.text(0, 0, "", { fontFamily: "sans-serif" })
              .setOrigin(0.5).setDepth(25),
          ],
        };
        pumpViews.set(pump.id, view);
      }
      const failureIcon = pump.failureType === "electricity"
        ? "⚡"
        : pump.failureType === "water" ? "💧" : "🔥";
      const icon = broken
        ? "💀"
        : failing ? failureIcon : outputPulse > 0 ? "💧" : "⚙️";
      view.icon
        .setText(icon)
        .setPosition(cellCenter(pump.x, pump.y).x, cellCenter(pump.x, pump.y).y - layout.cell * 0.1)
        .setFontSize(Math.max(15, Math.round(layout.cell * 0.42)))
        .setScale(
          failing
            ? 1 + Math.sin(visualTime / 80) * 0.1
            : 1 + chargePulse * 0.16 + outputPulse * 0.1,
        );
      view.label
        .setText(
          broken
            ? "故障"
            : failing ? "故障中" : contaminationDanger > 0 ? "異物滞留" : "ポンプ",
        )
        .setColor(
          broken
            ? "#9a9a9a"
            : failing || contaminationDanger > 0 ? "#ffd1c4" : "#dfe8ec",
        )
        .setPosition(cellCenter(pump.x, pump.y).x, cellCenter(pump.x, pump.y).y + layout.cell * 0.25)
        .setFontSize(Math.max(7, Math.round(layout.cell * 0.16)));
      const storedCenter = cellCenter(pump.x, pump.y + pump.h - 1);
      view.slots[0]
        .setVisible(!broken && Boolean(storedType))
        .setText(storedType ? resourceIcon(storedType) : "")
        .setPosition(storedCenter.x, storedCenter.y)
        .setFontSize(Math.max(18, Math.round(layout.cell * 0.56)))
        .setScale(1 + chargePulse * 0.15 + contaminationDanger * 0.1);
      if (storedType) {
        const storedShadow = storedType === "fire"
          ? "#ff5e14"
          : storedType === "water" ? "#65e2ef" : storedType === "steam" ? "#d8f5f8" : "#ffe06b";
        view.slots[0].setShadow(0, 0, storedShadow, 9, true, true);
      }
    }
    clearPumpViews(activePumpIds);
  }

  function drawMachines(state) {
    if (state.missionType === "steam" || state.lamp) {
      drawSteamMachines(state);
    } else if (state.missionType === "water" || state.tank) {
      generatorLabel.setVisible(true);
      clearSourceViews();
      drawWaterMachines(state);
    } else {
      clearPumpViews();
      clearSourceViews();
      generatorLabel.setVisible(true);
      generatorLabel.setText("炎発生装置");
      furnaceIcon.setText("🔥");
      furnaceIcon.setShadow(0, 0, "#ff5b18", 12, true, true);
      drawFireMachines(state);
    }
  }

  function syncResources(state) {
    warningGraphics.clear();
    const activeIds = new Set();
    const resources = state.resources || state.fires || [];
    for (const resource of resources) {
      const resourceType = resource.type || "fire";
      activeIds.add(resource.id);
      let view = fireViews.get(resource.id);
      if (!view) {
        view = scene.add.text(0, 0, "", { fontFamily: "sans-serif" })
          .setOrigin(0.5)
          .setDepth(42);
        fireViews.set(resource.id, view);
      }
      const icon = resourceIcon(resourceType);
      const shadow = resourceType === "electricity"
        ? "#ffe06b"
        : resourceType === "water" ? "#65e2ef" : resourceType === "steam" ? "#d8f5f8" : "#ff5e14";
      view.setText(icon);
      view.setShadow(0, 0, shadow, resourceType === "water" ? 7 : 10, true, true);

      const progress = resource.ejecting
        ? Math.min(1, resource.ejectProgress)
        : Math.min(1, state.movementAccumulator / TIMING.stepMs);
      const from = cellCenter(resource.prevX ?? resource.x, resource.prevY ?? resource.y);
      const to = cellCenter(resource.x, resource.y);
      const x = Phaser.Math.Linear(from.x, to.x, progress);
      const y = Phaser.Math.Linear(from.y, to.y, progress);
      const warning = Math.min(1, resource.stalledMs / FAILURE_TIMING.warningMs);
      const pulse = 1 + Math.sin(visualTime / 95) * 0.06 * warning;
      const ejectScale = resource.ejecting ? 0.64 + progress * 0.36 : 1;
      const fontRatio = resourceType === "electricity"
        ? 0.48
        : resourceType === "water" ? 0.5 : resourceType === "steam" ? 0.52 : 0.56;
      view
        .setPosition(x, y)
        .setFontSize(Math.max(17, Math.round(layout.cell * fontRatio)))
        .setScale(pulse * ejectScale)
        .setAlpha(resource.ejecting ? 0.58 + progress * 0.42 : 1);

      if (resource.stalledMs >= FAILURE_TIMING.warningMs) {
        const danger = Phaser.Math.Clamp(
          (resource.stalledMs - FAILURE_TIMING.warningMs)
            / (FAILURE_TIMING.triggerMs - FAILURE_TIMING.warningMs),
          0,
          1,
        );
        const warningColor = resourceType === "electricity"
          ? 0xffdc63
          : resourceType === "water" ? COLORS.cyan : resourceType === "steam" ? 0xcceef5 : COLORS.danger;
        warningGraphics.lineStyle(
          Math.max(2, layout.cell * 0.065),
          warningColor,
          0.35 + danger * 0.55,
        );
        warningGraphics.strokeCircle(
          x,
          y,
          layout.cell * (0.34 + Math.sin(visualTime / 80) * 0.03),
        );
      }

      if (
        resourceType === "electricity"
        && resource.stalledMs >= FAILURE_TIMING.warningMs
        && !paused
        && visualTime - lastTrailAt > 72
      ) {
        sparkEmitter?.emitParticleAt(x, y, 2);
      }

      if (
        resourceType === "fire"
        && !paused
        && visualTime - lastTrailAt > 72
        && (resource.ejecting || progress < 0.88)
      ) {
        sparkEmitter?.emitParticleAt(x, y + layout.cell * 0.12, 1);
      }
    }
    if (!paused && visualTime - lastTrailAt > 72) lastTrailAt = visualTime;

    for (const [resourceId, view] of fireViews) {
      if (activeIds.has(resourceId)) continue;
      view.destroy();
      fireViews.delete(resourceId);
    }
  }

  function drawPreview(state) {
    previewGraphics.clear();
    if (!state.drag?.path?.length) return;
    const previewBelts = buildBeltsFromPath(
      state.drag.path,
      state.drag.sourcePort,
      state.drag.targetFurnace || state.drag.targetDevice?.targetCell,
    );
    for (const belt of previewBelts) drawBelt(previewGraphics, belt, state, true);
    const targetCell = state.drag.targetFurnace || state.drag.targetDevice?.targetCell;
    if (targetCell) {
      const center = cellCenter(targetCell.x, targetCell.y);
      previewGraphics.lineStyle(Math.max(2, layout.cell * 0.06), COLORS.cyan, 0.95);
      previewGraphics.strokeRect(
        center.x - layout.cell * 0.43,
        center.y - layout.cell * 0.43,
        layout.cell * 0.86,
        layout.cell * 0.86,
      );
    }
  }

  function syncScene(state, deltaMs) {
    if (!state || !scene) return;
    if (!paused) {
      visualTime += deltaMs;
      furnaceZoom.remainingMs = Math.max(0, furnaceZoom.remainingMs - deltaMs);
    }
    drawBelts(state);
    drawMachines(state);
    syncResources(state);
    drawPreview(state);
  }

  function playTone(frequency, durationMs, options = {}) {
    const context = scene?.sound?.context;
    if (!context || context.state !== "running") return;
    const start = context.currentTime + (options.delayMs || 0) / 1000;
    const end = start + durationMs / 1000;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = options.type || "sine";
    oscillator.frequency.setValueAtTime(frequency, start);
    if (options.endFrequency) {
      oscillator.frequency.exponentialRampToValueAtTime(options.endFrequency, end);
    }
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(options.volume || 0.035, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(end + 0.02);
  }

  function eventPosition(type, payload) {
    if (type === "spawn") {
      const resource = payload.fire || payload.resource;
      return cellCenter(
        payload.generator.x + resource.sourcePort,
        payload.generator.y,
      );
    }
    if (type === "delivery") {
      const resource = payload.fire || payload.resource;
      const target = payload.furnace || payload.tank || payload.lamp;
      return {
        x: cellCenter(resource.x, 0).x,
        y: layout.top + target.y * layout.cell + target.h * layout.cell,
      };
    }
    if (type === "pump-charge") {
      return cellCenter(payload.pump.x, payload.pump.y + payload.pump.h - 0.2);
    }
    if (type === "pump-output") {
      return cellCenter(payload.pump.x, payload.pump.y - 0.1);
    }
    if (payload.machine) {
      return cellCenter(
        payload.machine.x + (payload.machine.w - 1) / 2,
        payload.machine.y + (payload.machine.h - 1) / 2,
      );
    }
    if (payload.belt) return cellCenter(payload.belt.x, payload.belt.y);
    const target = payload.furnace || payload.tank || payload.lamp;
    if (target) {
      return cellCenter(
        target.x + (target.w - 1) / 2,
        target.y + (target.h - 1) / 2,
      );
    }
    return { x: layout.viewportWidth / 2, y: layout.viewportHeight / 2 };
  }

  function dispatchEvent(type, payload = {}) {
    if (!scene) {
      pendingEvents.push({ type, payload: cloneEventPayload(payload) });
      return;
    }
    if (type === "remove") {
      playRemoveEffect(payload);
      return;
    }
    const position = eventPosition(type, payload);
    const camera = scene.cameras.main;
    if (type === "machine-place") {
      metalEmitter?.explode(5, position.x, position.y + layout.cell * 0.25);
      playTone(260, 90, { endFrequency: 390, volume: 0.018, type: "triangle" });
      return;
    }
    if (type === "machine-remove") {
      showHammer(payload.machine);
      metalEmitter?.explode(9, position.x, position.y);
      demolitionSparkEmitter?.explode(5, position.x, position.y);
      playTone(190, 150, { endFrequency: 88, volume: 0.03, type: "triangle" });
      return;
    }
    if (type === "machine-contamination") {
      const failureType = payload.failureType || payload.resource?.type || "unknown";
      if (failureType === "water" || failureType === "steam") {
        waterEmitter?.explode(8, position.x, position.y);
      } else {
        sparkEmitter?.explode(8, position.x, position.y);
      }
      playTone(230, 120, { endFrequency: 170, volume: 0.018, type: "triangle" });
      return;
    }
    if (type === "machine-contamination-warning") {
      const failureType = payload.failureType || "unknown";
      if (failureType === "water" || failureType === "steam") {
        waterEmitter?.explode(12, position.x, position.y);
      } else {
        sparkEmitter?.explode(13, position.x, position.y);
      }
      smokeEmitter?.explode(4, position.x, position.y);
      playTone(430, 190, { endFrequency: 180, volume: 0.028, type: "square" });
      return;
    }
    if (type === "machine-failure-start") {
      const failureType = payload.failureType || payload.resource?.type || "fire";
      if (failureType === "water") waterEmitter?.explode(22, position.x, position.y);
      else sparkEmitter?.explode(failureType === "electricity" ? 28 : 22, position.x, position.y);
      smokeEmitter?.explode(failureType === "fire" ? 11 : 6, position.x, position.y);
      camera.shake(210, 0.009);
      playTone(
        failureType === "electricity" ? 720 : 150,
        300,
        {
          endFrequency: failureType === "electricity" ? 120 : 65,
          volume: 0.045,
          type: failureType === "electricity" ? "square" : "sawtooth",
        },
      );
      return;
    }
    if (type === "machine-broken") {
      smokeEmitter?.explode(10, position.x, position.y);
      playTone(105, 180, { endFrequency: 58, volume: 0.025, type: "triangle" });
      return;
    }
    if (type === "spawn") {
      const resource = payload.fire || payload.resource;
      if (resource.type === "water") waterEmitter?.explode(6, position.x, position.y - layout.cell * 0.1);
      else sparkEmitter?.explode(6, position.x, position.y - layout.cell * 0.1);
      playTone(
        resource.type === "electricity" ? 410 : 280,
        70,
        { endFrequency: resource.type === "electricity" ? 620 : 420, volume: 0.012, type: "triangle" },
      );
      return;
    }
    if (type === "machine-input" || type === "machine-output") {
      const resource = payload.resource;
      if (resource?.type === "water" || resource?.type === "steam") {
        waterEmitter?.explode(7, position.x, position.y);
      } else {
        sparkEmitter?.explode(7, position.x, position.y);
      }
      playTone(
        type === "machine-input" ? 330 : 510,
        90,
        { endFrequency: type === "machine-input" ? 420 : 650, volume: 0.018, type: "triangle" },
      );
      return;
    }
    if (type === "pump-charge") {
      sparkEmitter?.explode(9, position.x, position.y);
      playTone(360, 95, { endFrequency: 540, volume: 0.022, type: "square" });
      return;
    }
    if (type === "pump-output") {
      waterEmitter?.explode(7, position.x, position.y);
      playTone(520, 90, { endFrequency: 390, volume: 0.018, type: "sine" });
      return;
    }
    if (type === "delivery") {
      const resource = payload.fire || payload.resource;
      if (resource.type === "water") waterEmitter?.explode(15, position.x, position.y);
      else sparkEmitter?.explode(15, position.x, position.y);
      furnaceZoom.remainingMs = 260;
      furnaceZoom.durationMs = 260;
      furnaceZoom.strength = 0.075;
      playTone(620, 105, { endFrequency: 880, volume: 0.028, type: "triangle" });
      return;
    }
    if (type === "failure-start" || type === "ignite") {
      const failureType = payload.failureType || payload.belt?.failureType || "fire";
      if (failureType === "water") waterEmitter?.explode(22, position.x, position.y);
      else sparkEmitter?.explode(failureType === "electricity" ? 30 : 24, position.x, position.y);
      smokeEmitter?.explode(failureType === "electricity" ? 5 : 9, position.x, position.y);
      camera.shake(180, 0.008);
      if (failureType === "electricity") {
        playTone(760, 210, { endFrequency: 120, volume: 0.04, type: "square" });
      } else {
        playTone(145, 330, { endFrequency: 70, volume: 0.045, type: "sawtooth" });
      }
      return;
    }
    if (type === "broken" || type === "ash") {
      smokeEmitter?.explode(7, position.x, position.y);
      playTone(110, 130, { endFrequency: 75, volume: 0.018, type: "triangle" });
      return;
    }
    if (type === "complete") {
      if (payload.tank) waterEmitter?.explode(48, position.x, position.y);
      else sparkEmitter?.explode(48, position.x, position.y);
      camera.shake(260, 0.006);
      furnaceZoom.remainingMs = 420;
      furnaceZoom.durationMs = 420;
      furnaceZoom.strength = 0.12;
      playTone(523.25, 180, { volume: 0.035, type: "triangle" });
      playTone(659.25, 180, { delayMs: 105, volume: 0.035, type: "triangle" });
      playTone(783.99, 260, { delayMs: 210, volume: 0.04, type: "triangle" });
      return;
    }
    if (type === "reset") {
      clearDemolitionEffects();
      furnaceZoom.remainingMs = 0;
      sparkEmitter?.killAll();
      smokeEmitter?.killAll();
      waterEmitter?.killAll();
      camera.resetFX();
      scene.tweens.killTweensOf(camera);
      camera.setZoom(1);
    }
  }

  const game = new Phaser.Game({
    type: supportsWebGL() ? Phaser.WEBGL : Phaser.CANVAS,
    canvas,
    width: layout.viewportWidth,
    height: layout.viewportHeight,
    backgroundColor: COLORS.background,
    // The existing DOM canvas is sized in CSS pixels. Keeping Phaser's logical
    // resolution at 1 preserves one world unit per pointer-coordinate pixel.
    resolution: 1,
    antialias: true,
    render: {
      antialias: true,
      pixelArt: false,
      powerPreference: "high-performance",
    },
    scene: {
      create() {
        scene = this;
        this.cameras.main.setBackgroundColor(COLORS.background);
        createLayers(this);
        drawGrid();
        sparkEmitter.timeScale = paused ? 0 : 1;
        smokeEmitter.timeScale = paused ? 0 : 1;
        waterEmitter.timeScale = paused ? 0 : 1;
        canvas.dataset.renderer = "phaser";
        for (const queued of pendingEvents.splice(0)) {
          dispatchEvent(queued.type, queued.payload);
        }
      },
      update(_time, deltaMs) {
        syncScene(latestState, Math.min(deltaMs, 50));
      },
    },
  });

  function resize() {
    const rect = boardWrap.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    layout = computeLayout(width, height);
    game.scale.resize(width, height);
    if (scene) {
      scene.cameras.main.setSize(width, height);
      drawGrid();
    }
  }

  function cellFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    const localX = (event.clientX - rect.left) * (layout.viewportWidth / rect.width);
    const localY = (event.clientY - rect.top) * (layout.viewportHeight / rect.height);
    const point = scene
      ? scene.cameras.main.getWorldPoint(localX, localY)
      : { x: localX, y: localY };
    const x = Math.floor((point.x - layout.left) / layout.cell);
    const y = Math.floor((point.y - layout.top) / layout.cell);
    if (!inBounds(x, y)) return null;
    return { x, y };
  }

  function render(state) {
    latestState = state;
  }

  function setPaused(nextPaused) {
    paused = nextPaused;
    if (sparkEmitter) sparkEmitter.timeScale = paused ? 0 : 1;
    if (smokeEmitter) smokeEmitter.timeScale = paused ? 0 : 1;
    if (waterEmitter) waterEmitter.timeScale = paused ? 0 : 1;
  }

  function unlockAudio() {
    if (!scene?.sound) return;
    if (scene.sound.locked) scene.sound.unlock();
    const context = scene.sound.context;
    if (context?.state === "suspended") context.resume().catch(() => {});
  }

  function destroy() {
    game.destroy(false);
  }

  return {
    kind: "phaser",
    cellFromEvent,
    destroy,
    emitEvent: dispatchEvent,
    render,
    resize,
    setPaused,
    unlockAudio,
  };
}
