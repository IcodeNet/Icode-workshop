/** Versioned runtime adapter registry. Adapters are trusted code registered explicitly by the host. */
export const ADAPTER_API_VERSION = 1;
const idPattern = /^[a-z][a-z0-9-]{0,63}$/;

export function validateAdapter(adapter) {
  if (!adapter || typeof adapter !== "object")
    throw new TypeError("Adapter must be an object");
  if (typeof adapter.id !== "string" || !idPattern.test(adapter.id))
    throw new TypeError("Invalid adapter id");
  if (adapter.apiVersion !== ADAPTER_API_VERSION)
    throw new Error("Unsupported adapter API version: " + adapter.apiVersion);
  for (const method of ["detect", "prepare", "run"]) {
    if (typeof adapter[method] !== "function")
      throw new TypeError(
        "Adapter " + adapter.id + " requires " + method + "()",
      );
  }
  if (adapter.start !== undefined && typeof adapter.start !== "function")
    throw new TypeError("Adapter start must be a function");
  if (adapter.stop !== undefined && typeof adapter.stop !== "function")
    throw new TypeError("Adapter stop must be a function");
  return adapter;
}

export function createAdapterRegistry() {
  const adapters = new Map();
  return Object.freeze({
    register(adapter) {
      validateAdapter(adapter);
      if (adapters.has(adapter.id))
        throw new Error("Duplicate adapter: " + adapter.id);
      adapters.set(adapter.id, adapter);
      return adapter;
    },
    get(id) {
      return adapters.get(id);
    },
    list() {
      return [...adapters.keys()];
    },
    require(id) {
      const adapter = adapters.get(id);
      if (!adapter) throw new Error("Adapter not registered: " + id);
      return adapter;
    },
  });
}

/** Load only host-selected, already installed modules. Never called with manifest input. */
export async function loadAdapters(
  registry,
  specifiers,
  importer = (specifier) => import(specifier),
) {
  if (
    !Array.isArray(specifiers) ||
    specifiers.some((s) => typeof s !== "string" || !s)
  )
    throw new TypeError("Adapter module list required");
  const adapters = [];
  for (const specifier of specifiers) {
    const module = await importer(specifier);
    adapters.push(validateAdapter(module.default));
  }
  const ids = new Set(registry.list());
  for (const adapter of adapters) {
    if (ids.has(adapter.id))
      throw new Error("Duplicate adapter: " + adapter.id);
    ids.add(adapter.id);
  }
  for (const adapter of adapters) registry.register(adapter);
}

/** Shared author conformance check; execution is explicit and uses a disposable fixture. */
export async function checkAdapter(adapter, context) {
  validateAdapter(adapter);
  const diagnostics = await adapter.detect(context);
  if (!Array.isArray(diagnostics))
    throw new TypeError("detect must return diagnostics");
  if (diagnostics.some((d) => d.level === "error")) return { diagnostics };
  await adapter.prepare(context);
  const result = await adapter.run("test", context);
  if (
    !result ||
    !(Number.isInteger(result.exitCode) || result.exitCode === null)
  )
    throw new TypeError("Invalid execution result");
  return { diagnostics, result };
}
