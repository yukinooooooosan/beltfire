const mission = new URLSearchParams(window.location.search).get("mission");

if (mission === "2") {
  import("./mission-02-game.js");
} else {
  import("./game.js");
}
