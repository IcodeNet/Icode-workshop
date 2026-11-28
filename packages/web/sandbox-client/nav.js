// Injected into workshop-served app pages (sandbox origin). Reports in-app
// navigation to the workshop UI and obeys back/forward/reload from it. It has
// no access to the UI or the API: messages go to the UI origin only.
(function () {
  var UI = "%ICODE_UI_ORIGIN%";
  window.__ICODE_UI_ORIGIN__ = UI;
  if (window.parent === window) return;
  function send() {
    try {
      window.parent.postMessage({ type: "icode:location", href: location.pathname + location.search + location.hash, title: String(document.title || "").slice(0, 200) }, UI);
    } catch (e) {}
  }
  ["pushState", "replaceState"].forEach(function (name) {
    var original = history[name];
    history[name] = function () {
      var r = original.apply(this, arguments);
      send();
      return r;
    };
  });
  addEventListener("popstate", send);
  addEventListener("hashchange", send);
  addEventListener("DOMContentLoaded", send);
  addEventListener("message", function (event) {
    if (event.origin !== UI || event.source !== window.parent) return;
    var data = event.data || {};
    if (data.type !== "icode:history") return;
    if (data.action === "back") history.back();
    else if (data.action === "forward") history.forward();
    else if (data.action === "reload") location.reload();
  });
  send();
})();
