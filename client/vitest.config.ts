import { configDefaults, defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

// .scratch — черновики сессий (не в git): там лежат и тесты-диагностики
// аудитов, которые нарочно воспроизводят дефекты. В `npm test` им не место.
export default mergeConfig(
  viteConfig,
  defineConfig({ test: { exclude: [...configDefaults.exclude, "**/.scratch/**"] } })
);
