// Adds the per-process session token (x-icode-session) to every mutating
// /api request made by the UI. Imported first by main.jsx.
const nativeFetch = window.fetch.bind(window);
let token;
const session = () =>
  (token ??= nativeFetch("/api/session")
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error("No workshop session"))))
    .then((d) => d.token)
    .catch((e) => {
      token = undefined;
      throw e;
    }));
window.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = (init.method || (typeof input === "object" && input.method) || "GET").toUpperCase();
  const local = url.startsWith("/api/") || url.startsWith(location.origin + "/api/");
  if (!local || method === "GET" || method === "HEAD") return nativeFetch(input, init);
  const headers = new Headers(init.headers || (typeof input === "object" ? input.headers : undefined));
  headers.set("x-icode-session", await session());
  return nativeFetch(input, { ...init, headers });
};
