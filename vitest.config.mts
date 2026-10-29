import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDirectory = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(rootDirectory, "src"),
      "server-only": resolve(rootDirectory, "src/test/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    restoreMocks: true,
  },
});
