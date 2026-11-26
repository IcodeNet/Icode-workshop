export type Diagnostic = {
  level: "info" | "warning" | "error";
  message: string;
};
export type RuntimeContext = {
  workspaceRoot: string;
  signal?: AbortSignal;
  env?: Record<string, string>;
  emit?(event: {
    type: "stdout" | "stderr" | "diagnostic";
    text: string;
  }): void;
};
export type RunResult = { exitCode: number | null; aborted?: boolean };
export type RuntimeSession = {
  id: string;
  previewUrl?: string;
  completion: Promise<RunResult>;
  stop(): Promise<void>;
};
export interface WorkshopAdapter {
  id: string;
  apiVersion: 1;
  detect(context: RuntimeContext): Promise<Diagnostic[]>;
  prepare(context: RuntimeContext): Promise<void>;
  run(
    command: "test" | "build" | "run",
    context: RuntimeContext,
  ): Promise<RunResult>;
  start?(context: RuntimeContext): Promise<RuntimeSession>;
  stop?(context: RuntimeContext): Promise<void>;
}
export interface AdapterRegistry {
  register(adapter: WorkshopAdapter): WorkshopAdapter;
  get(id: string): WorkshopAdapter | undefined;
  require(id: string): WorkshopAdapter;
  list(): string[];
}
export const ADAPTER_API_VERSION: 1;
export function validateAdapter(adapter: unknown): WorkshopAdapter;
export function createAdapterRegistry(): AdapterRegistry;
export function loadAdapters(
  registry: AdapterRegistry,
  specifiers: string[],
  importer?: (specifier: string) => Promise<{ default: WorkshopAdapter }>,
): Promise<void>;
export function checkAdapter(
  adapter: WorkshopAdapter,
  context: RuntimeContext,
): Promise<{ diagnostics: Diagnostic[]; result?: RunResult }>;
