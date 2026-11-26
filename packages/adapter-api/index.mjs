/** Versioned runtime adapter registry. Adapters are trusted code registered explicitly by the host. */
export const ADAPTER_API_VERSION = 1
const idPattern = /^[a-z][a-z0-9-]{0,63}$/

export function validateAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') throw new TypeError('Adapter must be an object')
  if (typeof adapter.id !== 'string' || !idPattern.test(adapter.id)) throw new TypeError('Invalid adapter id')
  if (adapter.apiVersion !== ADAPTER_API_VERSION) throw new Error('Unsupported adapter API version: ' + adapter.apiVersion)
  for (const method of ['detect', 'prepare', 'run']) {
    if (typeof adapter[method] !== 'function') throw new TypeError('Adapter ' + adapter.id + ' requires ' + method + '()')
  }
  if (adapter.stop !== undefined && typeof adapter.stop !== 'function') throw new TypeError('Adapter stop must be a function')
  return adapter
}

export function createAdapterRegistry() {
  const adapters = new Map()
  return Object.freeze({
    register(adapter) {
      validateAdapter(adapter)
      if (adapters.has(adapter.id)) throw new Error('Duplicate adapter: ' + adapter.id)
      adapters.set(adapter.id, adapter)
      return adapter
    },
    get(id) { return adapters.get(id) },
    list() { return [...adapters.keys()] },
    require(id) {
      const adapter = adapters.get(id)
      if (!adapter) throw new Error('Adapter not registered: ' + id)
      return adapter
    }
  })
}
