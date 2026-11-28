// Mermaid renderer: opaque-origin sandboxed frame on the sandbox server, no
// network (CSP connect-src 'none'), securityLevel "strict". Receives diagram
// source from the workshop UI and reports its size back.
(function () {
  var UI = "%ICODE_UI_ORIGIN%";
  var box = document.getElementById("d");
  var err = document.getElementById("e");
  var n = 0;
  function report(ok, id) {
    var h = Math.ceil(box.getBoundingClientRect().height + err.getBoundingClientRect().height) + 4;
    window.parent.postMessage({ type: "icode:mermaid", ok: ok, id: id, height: Math.min(Math.max(h, 20), 4000) }, UI);
  }
  window.addEventListener("message", function (event) {
    // Only the embedding workshop page may drive the renderer.
    if (event.source !== window.parent || event.origin !== UI) return;
    var data = event.data || {};
    if (data.type !== "icode:mermaid-render" || typeof data.source !== "string" || data.source.length > 51200) return;
    var theme = data.theme === "dark" ? "dark" : "default";
    try {
      window.mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: theme, htmlLabels: false, flowchart: { htmlLabels: false } });
      window.mermaid
        .render("icode-mermaid-" + n++, data.source)
        .then(function (result) {
          box.innerHTML = result.svg;
          err.textContent = "";
          report(true, data.id);
        })
        .catch(function (e) {
          box.textContent = "";
          err.textContent = "Diagram error: " + String((e && e.message) || e).slice(0, 500);
          report(false, data.id);
        });
    } catch (e) {
      err.textContent = "Diagram error: " + String((e && e.message) || e).slice(0, 500);
      report(false, data.id);
    }
  });
  window.parent.postMessage({ type: "icode:mermaid", ready: true }, UI);
})();
