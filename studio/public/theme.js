/* Apply the saved theme before first paint (no flash). Shared with the OpenLeads
   app ("ol-theme"), so Studio always matches it. An external file because the
   server's Content-Security-Policy is script-src 'self'. */
(function () {
  try {
    var choice = localStorage.getItem('ol-theme');
    if (choice === 'light' || choice === 'dark') document.documentElement.setAttribute('data-theme', choice);
  } catch (e) { /* storage unavailable: follow the OS */ }
})();
