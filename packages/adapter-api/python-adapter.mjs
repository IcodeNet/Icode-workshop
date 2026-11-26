import { execute } from "./node.mjs";
export function createPythonAdapter({
  executable = process.platform === "win32" ? "python" : "python3",
} = {}) {
  return {
    id: "python",
    apiVersion: 1,
    async detect(context) {
      try {
        const result = await execute(executable, ["--version"], context);
        return [
          {
            level: result.exitCode === 0 ? "info" : "error",
            message: "Python executable: " + executable,
          },
        ];
      } catch (error) {
        return [
          { level: "error", message: "Python unavailable: " + error.message },
        ];
      }
    },
    async prepare(context) {},
    async run(command, context) {
      if (command === "test")
        return execute(executable, ["-m", "pytest", "-q"], context);
      if (command === "run") return execute(executable, ["main.py"], context);
      throw new Error("Unsupported Python command: " + command);
    },
  };
}
