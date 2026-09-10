import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    // Своя временная база каждому тестовому файлу — см. src/test/setupTempDb.ts.
    setupFiles: ["./src/test/setupTempDb.ts"],
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
