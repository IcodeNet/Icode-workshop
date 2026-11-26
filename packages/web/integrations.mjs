import { CosmosClient } from "@azure/cosmos";
function endpoint(value) {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      ))
  )
    throw new Error("Integration endpoints require HTTPS or loopback HTTP");
  return url;
}
export function integrationStatus(env = process.env) {
  return [
    {
      id: "langfuse",
      title: "Langfuse observations",
      enabled: Boolean(
        env.WORKSHOP_LANGFUSE_URL &&
        env.WORKSHOP_LANGFUSE_PUBLIC_KEY &&
        env.WORKSHOP_LANGFUSE_SECRET_KEY,
      ),
    },
    {
      id: "cosmos",
      title: "Cosmos document status",
      enabled: Boolean(
        env.WORKSHOP_COSMOS_ENDPOINT &&
        env.WORKSHOP_COSMOS_KEY &&
        env.WORKSHOP_COSMOS_DATABASE &&
        env.WORKSHOP_COSMOS_CONTAINER,
      ),
    },
  ];
}
export async function readIntegration(
  id,
  {
    env = process.env,
    fetcher = fetch,
    makeCosmos = (options) => new CosmosClient(options),
  } = {},
) {
  if (!integrationStatus(env).find((item) => item.id === id)?.enabled)
    throw new Error("Integration is not configured");
  try {
    if (id === "langfuse") {
      const url = new URL(
        "/api/public/v2/observations",
        endpoint(env.WORKSHOP_LANGFUSE_URL),
      );
      url.searchParams.set("limit", "20");
      url.searchParams.set("fields", "core,basic");
      url.searchParams.set(
        "fromStartTime",
        new Date(Date.now() - 86400000).toISOString(),
      );
      url.searchParams.set("toStartTime", new Date().toISOString());
      const response = await fetcher(url, {
        headers: {
          authorization:
            "Basic " +
            Buffer.from(
              env.WORKSHOP_LANGFUSE_PUBLIC_KEY +
                ":" +
                env.WORKSHOP_LANGFUSE_SECRET_KEY,
            ).toString("base64"),
        },
        signal: AbortSignal.timeout(15000),
        redirect: "error",
      });
      if (!response.ok) throw new Error("Provider HTTP " + response.status);
      const body = await response.json();
      if (!Array.isArray(body.data))
        throw new Error("Unexpected observation response");
      return {
        title: "Observations from the last 24 hours (up to 20)",
        rows: body.data
          .slice(0, 20)
          .map(({ id, traceId, name, type, startTime, level }) => ({
            id,
            traceId,
            name,
            type,
            startTime,
            level,
          })),
      };
    }
    const client = makeCosmos({
      endpoint: endpoint(env.WORKSHOP_COSMOS_ENDPOINT).href,
      key: env.WORKSHOP_COSMOS_KEY,
      connectionPolicy: {
        requestTimeout: 15000,
        retryOptions: { maxRetryAttemptCount: 0 },
      },
    });
    try {
      const { resources } = await client
        .database(env.WORKSHOP_COSMOS_DATABASE)
        .container(env.WORKSHOP_COSMOS_CONTAINER)
        .items.query(
          { query: "SELECT TOP 20 c.id, c.status, c.category FROM c" },
          { maxItemCount: 20, abortSignal: AbortSignal.timeout(15000) },
        )
        .fetchAll();
      return {
        title: "Document status sample (up to 20)",
        rows: resources
          .slice(0, 20)
          .map(({ id, status, category }) => ({ id, status, category })),
      };
    } finally {
      client.dispose?.();
    }
  } catch {
    throw new Error(
      "Unable to read " +
        id +
        ". Check the service version, availability and server-side credentials.",
    );
  }
}
