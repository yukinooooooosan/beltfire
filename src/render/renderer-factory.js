import { createCanvasRenderer } from "./canvas-renderer.js";
import { createPhaserRenderer } from "./phaser-renderer.js";

export function createGameRenderer(options) {
  const requestedRenderer = new URLSearchParams(window.location.search).get("renderer");
  if (requestedRenderer === "canvas") {
    return createCanvasRenderer(options);
  }
  return createPhaserRenderer(options);
}
