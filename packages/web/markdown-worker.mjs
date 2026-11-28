// Worker for lesson rendering: pathological Markdown (for example quadratic
// emphasis runs) can take seconds; the parent terminates this worker on a
// timeout so the API event loop never blocks. See markdown.mjs#renderSafe.
import { parentPort } from "node:worker_threads";
import { renderLesson } from "./markdown.mjs";

parentPort.on("message", async ({ id, source, options }) => {
  try {
    parentPort.postMessage({ id, result: await renderLesson(source, options) });
  } catch (error) {
    parentPort.postMessage({ id, error: String(error?.message ?? error) });
  }
});
