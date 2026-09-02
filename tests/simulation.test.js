import test from "node:test";
import assert from "node:assert/strict";

import { createMissionMachines } from "../src/content/mission-01.js";
import { createMission02Machines, createPump } from "../src/content/mission-02.js";
import {
  createBoiler,
  createMission03Machines,
  createTurbine,
} from "../src/content/mission-03.js";
import {
  buildBeltsFromPath,
  connectedBrokenNetwork,
} from "../src/core/construction.js";
import { key } from "../src/core/grid.js";
import {
  createSimulationState,
  updateSimulation,
} from "../src/core/simulation.js";
import {
  createWaterSimulationState,
  updateWaterSimulation,
} from "../src/core/water-simulation.js";
import {
  createSteamSimulationState,
  updateSteamSimulation,
} from "../src/core/steam-simulation.js";

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

test("空のポンプは火も受け入れ、誤投入として💀故障する", () => {
  const { tank, generator } = createMission02Machines();
  const pump = createPump("wrong-input-pump", generator.x, 6);
  const inputCell = { x: pump.x, y: pump.y + pump.h };
  const belts = beltMap(buildBeltsFromPath(
    [inputCell],
    0,
    { x: pump.x, y: pump.y + pump.h - 1 },
  ));
  const simulation = createWaterSimulationState();
  simulation.resources.push({
    id: simulation.nextResourceId,
    type: "fire",
    x: inputCell.x,
    y: inputCell.y,
    prevX: inputCell.x,
    prevY: inputCell.y,
    stalledMs: 0,
    ejecting: false,
    ejectProgress: 1,
  });
  simulation.nextResourceId += 1;
  const machineEvents = [];

  for (let elapsed = 0; elapsed < 3000; elapsed += 50) {
    updateWaterSimulation(simulation, 50, {
      belts,
      generator,
      pumps: [pump],
      tank,
      callbacks: {
        onMachineFailureStart(machine, resource) {
          machineEvents.push(`start:${machine.id}:${resource.type}`);
        },
        onMachineBroken(machine, failureType) {
          machineEvents.push(`broken:${machine.id}:${failureType}`);
        },
      },
    });
  }

  assert.equal(simulation.resources.length, 0);
  assert.equal(pump.storedElectricity, 0);
  assert.equal(pump.failureType, "fire");
  assert.equal(pump.containedResourceType, "fire");
  assert.equal(pump.state, "broken");
  assert.deepEqual(machineEvents, [
    "start:wrong-input-pump:fire",
    "broken:wrong-input-pump:fire",
  ]);
  assert.equal([...belts.values()][0].state, "normal");
});

test("💀ポンプが入出力側の💀ベルトを一つの故障ネットワークにまとめる", () => {
  const pump = createPump("network-pump", 3, 6);
  pump.state = "broken";
  pump.failureType = "fire";
  const outputBelt = buildBeltsFromPath(
    [{ x: pump.x, y: pump.y - 1 }],
    0,
    null,
  )[0];
  const inputBelt = buildBeltsFromPath(
    [{ x: pump.x, y: pump.y + pump.h }],
    0,
    { x: pump.x, y: pump.y + pump.h - 1 },
  )[0];
  outputBelt.state = "broken";
  inputBelt.state = "broken";
  const belts = beltMap([outputBelt, inputBelt]);

  const network = connectedBrokenNetwork(
    { x: pump.x, y: pump.y },
    belts,
    [pump],
  );

  assert.deepEqual(network.devices.map((device) => device.id), ["network-pump"]);
  assert.equal(network.belts.length, 2);
  assert.deepEqual(
    new Set(network.belts.map((belt) => key(belt.x, belt.y))),
    new Set([key(outputBelt.x, outputBelt.y), key(inputBelt.x, inputBelt.y)]),
  );
});

test("火と水をボイラーとタービンで電気に変換し、ランプを点灯する", () => {
  const { lamp, generators } = createMission03Machines();
  const boiler = createBoiler("test-boiler", 3, 6);
  const turbine = createTurbine("test-turbine", 3, 3);
  const firePath = buildBeltsFromPath(
    [
      { x: 1, y: 9 },
      { x: 1, y: 8 },
      { x: 2, y: 8 },
      { x: 3, y: 8 },
    ],
    1,
    boiler.inputPorts[0].targetCell,
  );
  const waterPath = buildBeltsFromPath(
    [
      { x: 6, y: 9 },
      { x: 6, y: 8 },
      { x: 5, y: 8 },
      { x: 4, y: 8 },
    ],
    0,
    boiler.inputPorts[1].targetCell,
  );
  const steamPath = buildBeltsFromPath(
    [{ x: 3, y: 5 }],
    0,
    turbine.inputPorts[0].targetCell,
  );
  const electricPath = buildBeltsFromPath(
    [{ x: 3, y: 2 }],
    0,
    { x: lamp.x, y: lamp.y + lamp.h - 1 },
  );
  const belts = beltMap([...firePath, ...waterPath, ...steamPath, ...electricPath]);
  const simulation = createSteamSimulationState();
  let steamOutputs = 0;
  let electricOutputs = 0;
  let completions = 0;

  for (let elapsed = 0; elapsed < 30000 && !simulation.completed; elapsed += 50) {
    updateSteamSimulation(simulation, 50, {
      belts,
      generators,
      machines: [boiler, turbine],
      lamp,
      callbacks: {
        onMachineOutput(machine, resource) {
          if (machine.type === "boiler" && resource.type === "steam") steamOutputs += 1;
          if (machine.type === "turbine" && resource.type === "electricity") electricOutputs += 1;
        },
        onComplete() { completions += 1; },
      },
    });
  }

  assert.equal(lamp.received, 1);
  assert.equal(simulation.completed, true);
  assert.ok(steamOutputs >= 1);
  assert.ok(electricOutputs >= 1);
  assert.equal(completions, 1);
});

test("ボイラーは火を2個受け入れても壊れず、詰まったまま蒸気を作らない", () => {
  const { lamp, generators } = createMission03Machines();
  const boiler = createBoiler("jammed-boiler", 3, 6);
  const inputBelts = buildBeltsFromPath(
    [
      { x: 3, y: 8 },
      { x: 4, y: 8 },
    ],
    null,
    boiler.inputPorts[1].targetCell,
  );
  inputBelts[0].outDir = "U";
  inputBelts[1].outDir = "U";
  const belts = beltMap(inputBelts);
  const simulation = createSteamSimulationState();
  for (const port of boiler.inputPorts) {
    simulation.resources.push({
      id: simulation.nextResourceId,
      type: "fire",
      x: port.approach.x,
      y: port.approach.y,
      prevX: port.approach.x,
      prevY: port.approach.y,
      stalledMs: 0,
      ejecting: false,
      ejectProgress: 1,
    });
    simulation.nextResourceId += 1;
  }

  for (let elapsed = 0; elapsed < 1000; elapsed += 50) {
    updateSteamSimulation(simulation, 50, {
      belts,
      generators,
      machines: [boiler],
      lamp,
    });
  }

  assert.deepEqual(boiler.storedResources, ["fire", "fire"]);
  assert.equal(boiler.state, "normal");
  assert.equal(simulation.resources.some((resource) => resource.type === "steam"), false);
});

test("ボイラーへ電気を入れると誤投入として故障する", () => {
  const { lamp, generators } = createMission03Machines();
  const boiler = createBoiler("wrong-boiler", 3, 6);
  const inputCell = boiler.inputPorts[0].approach;
  const belt = buildBeltsFromPath(
    [inputCell],
    null,
    boiler.inputPorts[0].targetCell,
  )[0];
  const belts = beltMap([belt]);
  const simulation = createSteamSimulationState();
  simulation.resources.push({
    id: simulation.nextResourceId,
    type: "electricity",
    x: inputCell.x,
    y: inputCell.y,
    prevX: inputCell.x,
    prevY: inputCell.y,
    stalledMs: 0,
    ejecting: false,
    ejectProgress: 1,
  });

  for (let elapsed = 0; elapsed < 2500; elapsed += 50) {
    updateSteamSimulation(simulation, 50, {
      belts,
      generators,
      machines: [boiler],
      lamp,
    });
  }

  assert.equal(boiler.failureType, "electricity");
  assert.equal(boiler.state, "broken");
  assert.equal(simulation.resources.length, 0);
});
