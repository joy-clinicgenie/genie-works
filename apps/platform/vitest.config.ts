import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // Component tests render JSX; the app's own tsconfig keeps jsx as "preserve" for Next, which Vitest cannot transform.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["src/**/*.test.ts"], fileParallelism: false, testTimeout: 30000 },
});
