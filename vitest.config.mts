import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * Vitest does not read `paths` from tsconfig.json, so the `@/*` alias has to be
 * restated here or every test importing `@/lib/...` fails to resolve.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules/**", ".next/**"],
  },
});
