/* Embedded in the 5.5 app (an iframe at /classic/?embed=1): the app owns the sidebar,
   the command palette and the theme switch; this page follows. */
export const EMBED = document.documentElement.classList.contains("embed");

if (EMBED) {
  // Capture phase, so the app's palette opens instead of this page's own.
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      e.stopImmediatePropagation();
      window.parent.postMessage({ openleads: "palette" }, location.origin);
    }
  }, true);
}

// The theme is one setting for both dashboards; follow a change made in the other one.
window.addEventListener("storage", (e) => {
  if (e.key === "ol-theme" && (e.newValue === "light" || e.newValue === "dark")) {
    document.documentElement.setAttribute("data-theme", e.newValue);
  }
});
