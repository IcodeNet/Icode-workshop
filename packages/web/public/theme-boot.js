// Stage 4 (G3): apply the stored theme before the UI renders, so the page
// never flashes the wrong colours. External file: the CSP allows 'self' only.
(function () {
  var theme = "dark";
  try {
    var stored = JSON.parse(localStorage.getItem("icode:preferences") || "{}");
    if (["system", "light", "dark", "high-contrast"].indexOf(stored.theme) !== -1) theme = stored.theme;
  } catch (e) {}
  if (theme === "system") {
    var mq = function (q) { return window.matchMedia && window.matchMedia(q).matches; };
    theme = mq("(prefers-contrast: more)") ? "high-contrast" : mq("(prefers-color-scheme: dark)") ? "dark" : "light";
  }
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.colorScheme = theme === "light" ? "light" : "dark";
})();
