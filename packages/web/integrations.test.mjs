import test from "node:test";
import assert from "node:assert/strict";
import { integrationStatus, readIntegration } from "./integrations.mjs";
test("service integrations are opt-in, bounded, read-only and return only selected fields", async () => {
  assert.ok(integrationStatus({}).every((item) => !item.enabled));
  await assert.rejects(
    readIntegration("cosmos", { env: {} }),
    /not configured/,
  );
  let query, auth;
  const env = {
    WORKSHOP_LANGFUSE_URL: "https://langfuse.example",
    WORKSHOP_LANGFUSE_PUBLIC_KEY: "public-fixture",
    WORKSHOP_LANGFUSE_SECRET_KEY: "secret-fixture",
    WORKSHOP_COSMOS_ENDPOINT: "https://cosmos.example",
    WORKSHOP_COSMOS_KEY: "key-fixture",
    WORKSHOP_COSMOS_DATABASE: "db",
    WORKSHOP_COSMOS_CONTAINER: "docs",
  };
  const observations = await readIntegration("langfuse", {
    env,
    fetcher: async (url, options) => {
      assert.equal(url.pathname, "/api/public/v2/observations");
      assert.equal(url.searchParams.get("limit"), "20");
      assert.ok(url.searchParams.get("fromStartTime"));
      auth = options.headers.authorization;
      return {
        ok: true,
        json: async () => ({
          data: [{ id: "1", name: "test", input: "must not expose input" }],
        }),
      };
    },
  });
  assert.ok(auth.startsWith("Basic "));
  assert.equal(observations.rows[0].input, undefined);
  const cosmos = await readIntegration("cosmos", {
    env,
    makeCosmos: () => ({
      database: () => ({
        container: () => ({
          items: {
            query: (spec) => {
              query = spec.query;
              return {
                fetchAll: async () => ({
                  resources: [
                    {
                      id: "1",
                      status: "approved",
                      body: "must not expose body",
                    },
                  ],
                }),
              };
            },
          },
        }),
      }),
    }),
  });
  assert.match(query, /TOP 20/);
  assert.deepEqual(cosmos.rows[0], {
    id: "1",
    status: "approved",
    category: undefined,
  });
  await assert.rejects(
    readIntegration("langfuse", {
      env,
      fetcher: async () => {
        throw new Error("secret-fixture");
      },
    }),
    (error) => !error.message.includes("secret-fixture"),
  );
});
