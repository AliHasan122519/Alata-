/* Runs in <head> before first paint so the page never flashes the wrong theme. */
(function () {
  try {
    var s = localStorage.getItem("alataa-theme");
    var dark = s === "dark" || (s !== "light" && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
    if (dark) document.documentElement.classList.add("dark");
  } catch (e) {}
})();
