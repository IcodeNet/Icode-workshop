// Stage 3 (A7): notifications from the course, Epic config and a bounded feed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { activeNotifications, muteNotification, readMuted, fetchFeed, clearFeedCache } from "./notifications.mjs";
import { nativeCourse } from "./test-support/workspace-course.mjs";

const feedResponse = (body, { status = 200, headers = {} } = {}) => async (url, init) => {
  feedResponse.calls.push({ url, init });
  if (body instanceof Error) throw body;
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
};
feedResponse.calls = [];

test("active notifications: expiry, de-duplication, mute persistence and Markdown through the sanitiser", async () => {
  clearFeedCache();
  const root = await nativeCourse({
    course: {
      notifications: [
        { id: "a", title: "A", message: "**bold** <img src=x onerror=alert(1)> [x](javascript:alert(1))", type: "info" },
        { id: "old", title: "Old", message: "gone", expiresAt: "2001-01-01" },
        { id: "a", title: "Duplicate", message: "dup" },
      ],
      notificationsFeed: "https://feed.test/n.json",
    },
  });
  const fetchImpl = feedResponse({ notifications: [{ id: "f1", title: "From feed", message: "feed", type: "danger" }, { id: "evil", title: "x", message: "y", link: "javascript:alert(1)" }] });
  const { notifications } = await activeNotifications(root, { fetchImpl, now: Date.parse("2026-11-28") });
  assert.deepEqual(notifications.map((n) => n.id), ["a", "f1"]);
  assert.match(notifications[0].html, /<strong>bold<\/strong>/);
  assert.doesNotMatch(notifications[0].html, /onerror|javascript:/);
  assert.equal(notifications[1].source, "feed");
  const init = feedResponse.calls.at(-1).init;
  assert.equal(init.redirect, "error");
  assert.equal(init.credentials, "omit");
  await muteNotification(root, "a");
  await muteNotification(root, "a");
  assert.deepEqual(await readMuted(root), ["a"]);
  assert.deepEqual(JSON.parse(await readFile(join(root, ".workshop", "notifications.json"), "utf8")), { muted: ["a"] });
  assert.deepEqual((await activeNotifications(root, { fetchImpl })).notifications.map((n) => n.id), ["f1"]);
  await assert.rejects(muteNotification(root, "../../etc"), /Invalid notification id/);
  await assert.rejects(muteNotification(root, { id: "a" }), /Invalid notification id/);
});

test("the feed is optional, offline-safe, bounded, cached and can be disabled", async () => {
  clearFeedCache();
  const url = "https://feed.test/a.json";
  assert.deepEqual(await fetchFeed(url, { fetchImpl: feedResponse(new Error("offline")) }), []);
  const good = await fetchFeed(url, { fetchImpl: feedResponse([{ id: "x", title: "X", message: "m" }]), now: 1000 });
  assert.deepEqual(good.map((n) => n.id), ["x"]);
  // Cached for an hour; after it, a failure keeps the last good copy.
  assert.deepEqual((await fetchFeed(url, { fetchImpl: feedResponse(new Error("no")), now: 2000 })).map((n) => n.id), ["x"]);
  assert.deepEqual((await fetchFeed(url, { fetchImpl: feedResponse(new Error("no")), now: 2000 + 3600_001 })).map((n) => n.id), ["x"]);
  clearFeedCache();
  assert.deepEqual(await fetchFeed(url, { fetchImpl: feedResponse("x".repeat(70 * 1024)) }), [], "oversized feed refused");
  assert.deepEqual(await fetchFeed(url, { fetchImpl: feedResponse("{", {}) }), [], "invalid JSON ignored");
  assert.deepEqual(await fetchFeed(url, { fetchImpl: feedResponse([], { status: 500 }) }), []);
  assert.deepEqual(await fetchFeed(url, { fetchImpl: feedResponse(Array.from({ length: 80 }, (_, i) => ({ id: "n" + i, title: "t", message: "m" }))) }).then((l) => l.length), 50);
  process.env.ICODE_NOTIFICATIONS_FEED = "0";
  try {
    clearFeedCache();
    const calls = feedResponse.calls.length;
    assert.deepEqual(await fetchFeed(url, { fetchImpl: feedResponse([{ id: "x", title: "X", message: "m" }]) }), []);
    assert.equal(feedResponse.calls.length, calls, "no request when disabled");
  } finally {
    delete process.env.ICODE_NOTIFICATIONS_FEED;
  }
});
