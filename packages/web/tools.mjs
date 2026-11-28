/** Tool URLs are explicit lesson metadata; never fetched or proxied by the API. */
export function validateTools(tools = []) {
  if (!Array.isArray(tools) || tools.length > 10)
    throw new Error("Invalid tools list");
  return tools.map((tool) => {
    if (
      !tool ||
      typeof tool.id !== "string" ||
      !tool.id.match(/^[a-z][a-z0-9-]{0,40}$/) ||
      typeof tool.title !== "string" ||
      tool.title.length > 100
    )
      throw new Error("Invalid tool");
    const url = new URL(tool.url);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.username ||
      url.password ||
      ["4317", "5173", String(process.env.WORKSHOP_SANDBOX_PORT ?? 4318)].includes(url.port)
    )
      throw new Error("Tools require a separate loopback HTTP service");
    if (!["embed", "external"].includes(tool.mode))
      throw new Error("Invalid tool mode");
    return { id: tool.id, title: tool.title, url: url.href, mode: tool.mode };
  });
}
