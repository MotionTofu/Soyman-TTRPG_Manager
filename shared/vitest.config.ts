import { defineConfig } from "vitest/config";

// Пакет общий с сервером и по правилам не знает ни React, ни DOM, поэтому
// окружение здесь — обычный node, а не jsdom.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
