/* ================================================================= */
/*  DECK ENGINE  —  slide navigation, entrance animation, fullscreen.*/
/*  You do NOT need to edit this file to rebrand or edit slides.     */
/*  It just makes the arrow keys / buttons work.                     */
/* ================================================================= */
(function () {
  const slides = Array.from(document.querySelectorAll(".slide"));
  const counter = document.getElementById("counter");
  const progress = document.getElementById("progress");
  let index = 0;   // which slide is showing (0-based)

  function render() {
    // The active slide (and its .fragment elements) animate in via pure CSS,
    // keyed off the .is-active class — see styles.css. Nothing ever looks blank.
    slides.forEach((s, i) => s.classList.toggle("is-active", i === index));
    counter.textContent = `${index + 1} / ${slides.length}`;
    progress.style.width = `${((index + 1) / slides.length) * 100}%`;
    location.hash = `slide-${index + 1}`;
  }

  function next() { if (index < slides.length - 1) { index++; render(); } }
  function prev() { if (index > 0) { index--; render(); } }
  function goTo(i) { index = Math.max(0, Math.min(slides.length - 1, i)); render(); }

  // --- keyboard ---
  document.addEventListener("keydown", (e) => {
    if (["ArrowRight", "PageDown", " "].includes(e.key)) { e.preventDefault(); next(); }
    else if (["ArrowLeft", "PageUp"].includes(e.key)) { e.preventDefault(); prev(); }
    else if (e.key === "Home") goTo(0);
    else if (e.key === "End") goTo(slides.length - 1);
    else if (e.key === "f" || e.key === "F") toggleFullscreen();
  });

  // --- on-screen buttons ---
  document.getElementById("next").addEventListener("click", next);
  document.getElementById("prev").addEventListener("click", prev);
  document.getElementById("full").addEventListener("click", toggleFullscreen);

  // --- click/tap right or left half of the screen to move ---
  document.getElementById("deck").addEventListener("click", (e) => {
    if (e.target.closest("#ui")) return;
    (e.clientX > window.innerWidth / 2 ? next : prev)();
  });

  function toggleFullscreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  }

  // --- deep-link: index.html#slide-3 opens on slide 3 ---
  const m = location.hash.match(/slide-(\d+)/);
  if (m) index = Math.max(0, Math.min(slides.length - 1, parseInt(m[1], 10) - 1));

  render();
})();
