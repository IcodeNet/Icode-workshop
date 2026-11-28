import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { APPS_FORMAT } from "./apps-layout.mjs";

// Explicit course opt-in. Discovery never imports or executes authored modules.
export function hostConfig(root) {
  const file = join(resolve(root), "workshop.json");
  if (!existsSync(file)) return {};
  const config = JSON.parse(readFileSync(file, "utf8"));
  if (config.schemaVersion !== 1 || !["native", APPS_FORMAT].includes(config.format))
    throw new Error("Unsupported workshop.json schema or format");
  return config;
}
export function discoverSteps(root) {
  root = resolve(root);
  const directory = join(root, "exercises");
  const entries = readdirSync(directory, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));
  const apps = hostConfig(root).format === APPS_FORMAT;
  const steps = [];
  for (const entry of entries) {
    if (!apps && /^\d{2}$/.test(entry.name)) {
      steps.push({
        id: entry.name,
        base: join(directory, entry.name),
        problem: join(directory, entry.name, "problem"),
        solution: join(directory, entry.name, "solution"),
      });
    } else if (apps && /^\d+\./.test(entry.name)) {
      const base = join(directory, entry.name);
      const children = readdirSync(base, { withFileTypes: true }).filter((e) =>
        e.isDirectory(),
      );
      for (const child of children
        .filter((e) => /^\d+\.problem\./.test(e.name))
        .sort((a, b) => a.name.localeCompare(b.name))) {
        const number = child.name.split(".")[0];
        const solutions = children.filter((e) =>
          e.name.startsWith(number + ".solution."),
        );
        if (solutions.length !== 1)
          throw new Error(
            `Expected exactly one solution for ${entry.name}/${child.name}`,
          );
        const ordinal = steps.length + 1;
        if (ordinal > 99)
          throw new Error("The apps layout supports at most 99 mapped steps");
        steps.push({
          id: String(ordinal).padStart(2, "0"),
          apps: true,
          base,
          module: entry.name,
          step: number,
          title: child.name.split(".").slice(2).join(" "),
          problem: join(base, child.name),
          solution: join(base, solutions[0].name),
        });
      }
    }
  }
  if (!steps.length)
    throw new Error(
      'No supported course steps found. Native courses need exercises/NN; apps-layout courses require workshop.json with schemaVersion: 1 and format: "apps".',
    );
  return steps;
}
export function stepLayout(root, id) {
  const step = discoverSteps(root).find((s) => s.id === id);
  if (!step) throw new Error("Unknown exercise: " + id);
  return step;
}
