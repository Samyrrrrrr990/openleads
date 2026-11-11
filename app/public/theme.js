/* Apply the saved theme before first paint (no flash). An external file because the
   server's Content-Security-Policy is script-src 'self'. The key is shared with the
   classic dashboard, so both always agree. */
(function () {
  try {
    var t = localStorage.getItem("ol-theme");
    var dark = t === "dark" || (t !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
  } catch (e) { /* storage unavailable: follow the OS */ }
})();
