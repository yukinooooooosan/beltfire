import test from "node:test";
import assert from "node:assert/strict";

import { createMissionMachines } from "../src/content/mission-01.js";
import { createMission02Machines, createPump } from "../src/content/mission-02.js";
import { buildBeltsFromPath } from "../src/core/construction.js";
import { key } from "../src/core/grid.js";
import {
  createSimulationState,
  updateSimulation,
} from "../src/core/simulation.js";
import {
  createWaterSimulationState,
  updateWaterSimulation,
} from "../src/core/water-simulation.js";

function beltMap(items) {
  return new Map(items.map((belt) => [key(belt.x, belt.y), belt]));
}

test("一本のベルトで火を10個納品し、Renderer用イベントを通知する", () => {
  const { furnace, generator } = createMissionMachines();
  const simulation = createSimulationState();
  const path = [];
  for (let y = generator.y - 1; y >= furnace.y + furnace.h; y -= 1) {
    path.push({ x: generator.x, y });
  }
  const belts = beltMap(buildBeltsFromPath(
    path,
    0,
    { x: furnace.x, y: furnace.y + furnace.h - 1 },
  ));
  const spawnedIds = [];
  const deliveredIds = [];
  let completed = 0;

  for (let elapsed = 0; elapsed < 30000 && furnace.received < furnace.target; elapsed += 50) {
    updateSimulation(simulation, 50, {
      belts,
      furnace,
      generator,
      callbacks: {
        onSpawn(fire) {
          spawnedIds.push(fire.id);
        },
        onDelivery(_machine, fire) {
          deliveredIds.push(fire.id);
        },
        onComplete() {
          completed += 1;
        },
      },
    });
  }

  assert.equal(furnace.received, 10);
  assert.equal(deliveredIds.length, 10);
  assert.equal(new Set(spawnedIds).size, spawnedIds.length);
  assert.ok(deliveredIds.every((id) => spawnedIds.includes(id)));
  assert.equal(completed, 1);
});

test("行き止まりの火が着火し、接続ベルトが燃え滓になる", () => {
  const { furnace, generator } = createMissionMachines();
  const simulation = createSimulationState();
  const belts = beltMap(buildBeltsFromPath(
    [
      { x: generator.x + 1, y: generator.y - 1 },
      { x: generator.x + 1, y: generator.y - 2 },
    ],
    1,
    null,
  ));
  const ignited = [];
  const ashes = [];

  for (let elapsed = 0; elapsed < 18000; elapsed += 50) {
    updateSimulation(simulation, 50, {
      belts,
      furnace,
      generator,
      callbacks: {
        onIgnite(belt) {
          ignited.push(key(belt.x, belt.y));
        },
        onAsh(belt) {
          ashes.push(key(belt.x, belt.y));
        },
      },
    });
  }

  assert.ok(ignited.length >= 1);
  assert.equal(new Set(ashes).size, 2);
  assert.ok([...belts.values()].every((belt) => belt.state === "ash"));
});

test("ポンプが電気を水へ変換し、貯水タンクへ10個納品する", () => {
  const { tank, generator } = createMission02Machines();
  const pump = createPump("test-pump", generator.x, 6);
  const inputBelts = buildBeltsFromPath(
    [
      { x: generator.x, y: generator.y - 1 },
      { x: generator.x, y: pump.y + pump.h },
    ],
    0,
    { x: pump.x, y: pump.y + pump.h - 1 },
  );
  const outputBelts = buildBeltsFromPath(
    [
      { x: pump.x, y: pump.y - 1 },
      { x: pump.x, y: pump.y - 2 },
      { x: pump.x, y: tank.y + tank.h },
    ],
    0,
    { x: tank.x, y: tank.y + tank.h - 1 },
  );
  const belts = beltMap([...inputBelts, ...outputBelts]);
  const simulation = createWaterSimulationState();
  let charged = 0;
  let output = 0;

  for (let elapsed = 0; elapsed < 30000 && tank.received < tank.target; elapsed += 50) {
    updateWaterSimulation(simulation, 50, {
      belts,
      generator,
      pumps: [pump],
      tank,
      callbacks: {
        onPumpCharge() { charged += 1; },
        onPumpOutput() { output += 1; },
      },
    });
  }

  assert.equal(tank.received, 10);
  assert.ok(charged >= 10);
  assert.ok(output >= 10);
});

test("水の出力ベルトがないポンプは電気を保持し、入力側を詰まらせる", () => {
  const { tank, generator } = createMission02Machines();
  const pump = createPump("blocked-pump", generator.x, 6);
  const belts = beltMap(buildBeltsFromPath(
    [
      { x: generator.x, y: generator.y - 1 },
      { x: generator.x, y: pump.y + pump.h },
    ],
    0,
    { x: pump.x, y: pump.y + pump.h - 1 },
  ));
  const simulation = createWaterSimulationState();

  for (let elapsed = 0; elapsed < 12000; elapsed += 50) {
    updateWaterSimulation(simulation, 50, {
      belts,
      generator,
      pumps: [pump],
      tank,
    });
  }

  assert.equal(pump.storedElectricity, 1);
  assert.equal(tank.received, 0);
  assert.ok(simulation.resources.filter((resource) => resource.type === "electricity").length >= 1);
  assert.equal(simulation.resources.some((resource) => resource.type === "water"), false);
});
