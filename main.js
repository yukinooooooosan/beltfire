const mission = new URLSearchParams(window.location.search).get("mission");

if (mission === "3") {
  import("./mission-03-game.js");
} else if (mission === "2") {
  import("./mission-02-game.js");
} else {
  import("./game.js");
}
