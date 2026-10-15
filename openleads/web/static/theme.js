/* Apply the saved theme before first paint (no flash). CSP-safe: an external file. */
(function () {
  try {
    var t = localStorage.getItem("ol-theme");
    if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
    if (localStorage.getItem("ol-nav") === "collapsed") document.documentElement.classList.add("nav-pre-collapsed");
  } catch (e) { /* storage unavailable: follow the OS */ }
})();
