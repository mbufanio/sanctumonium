/**
 * Entry point. Mounts the Pixi world into #stage and the DOM overlays into
 * #overlay, then starts the game controller. Touch + mouse both work because
 * all interactions are tap/click on real DOM buttons (no hover dependency).
 */
import "./style.css";
import { Game } from "./game.ts";

const stage = document.getElementById("stage");
const overlay = document.getElementById("overlay");

if (!stage || !overlay) {
  throw new Error("Missing #stage or #overlay mount points in index.html");
}

const game = new Game(overlay);
game.start(stage).catch((err) => {
  console.error("Failed to start game:", err);
  overlay.innerHTML =
    '<div class="fatal">Failed to start. Check the console.</div>';
});
