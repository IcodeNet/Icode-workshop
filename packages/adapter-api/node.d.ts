import type { RuntimeContext, RuntimeSession, RunResult } from "./index.d.ts";
export function startProcess(
  command: string,
  args: string[],
  context: RuntimeContext,
): RuntimeSession;
export function execute(
  command: string,
  args: string[],
  context: RuntimeContext,
): Promise<RunResult>;
export function fileExists(root: string, name: string): Promise<boolean>;
