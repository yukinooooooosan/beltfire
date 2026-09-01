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

test("行き止まりの火が故障を起こし、接続ベルトが💀になる", () => {
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
  const started = [];
  const broken = [];

  for (let elapsed = 0; elapsed < 18000; elapsed += 50) {
    updateSimulation(simulation, 50, {
      belts,
      furnace,
      generator,
      callbacks: {
        onFailureStart(belt, failureType) {
          started.push({ key: key(belt.x, belt.y), failureType });
        },
        onBroken(belt, failureType) {
          broken.push({ key: key(belt.x, belt.y), failureType });
        },
      },
    });
  }

  assert.ok(started.length >= 1);
  assert.equal(new Set(broken.map((item) => item.key)).size, 2);
  assert.ok(started.every((item) => item.failureType === "fire"));
  assert.ok(broken.every((item) => item.failureType === "fire"));
  assert.ok([...belts.values()].every((belt) => belt.state === "broken"));
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

test("満杯のポンプ手前で滞留した電気がベルトを故障させる", () => {
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
  const started = [];
  const broken = [];

  for (let elapsed = 0; elapsed < 12000; elapsed += 50) {
    updateWaterSimulation(simulation, 50, {
      belts,
      generator,
      pumps: [pump],
      tank,
      callbacks: {
        onFailureStart(belt, failureType) {
          started.push({ key: key(belt.x, belt.y), failureType });
        },
        onBroken(belt, failureType) {
          broken.push({ key: key(belt.x, belt.y), failureType });
        },
      },
    });
  }

  assert.equal(pump.storedElectricity, 1);
  assert.equal(tank.received, 0);
  assert.equal(simulation.resources.some((resource) => resource.type === "water"), false);
  assert.ok(started.length >= 1);
  assert.ok(broken.length >= 1);
  assert.ok(started.every((item) => item.failureType === "electricity"));
  assert.ok(broken.every((item) => item.failureType === "electricity"));
  assert.ok([...belts.values()].every((belt) => belt.state === "broken"));
});

test("行き止まりで滞留した水も共通ルールでベルトを故障させる", () => {
  const { tank, generator } = createMission02Machines();
  const pump = createPump("water-blocked-pump", generator.x, 6);
  pump.storedElectricity = 1;
  const belts = beltMap(buildBeltsFromPath(
    [{ x: pump.x, y: pump.y - 1 }],
    0,
    null,
  ));
  const simulation = createWaterSimulationState();
  const failureTypes = [];

  for (let elapsed = 0; elapsed < 9000; elapsed += 50) {
    updateWaterSimulation(simulation, 50, {
      belts,
      generator,
      pumps: [pump],
      tank,
      callbacks: {
        onFailureStart(_belt, failureType) {
          failureTypes.push(failureType);
        },
      },
    });
  }

  assert.ok(failureTypes.includes("water"));
  assert.equal([...belts.values()][0].state, "broken");
});
