import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      // `server-only` is a build-time marker: under Next's `react-server`
      // condition it resolves to an empty module, and anywhere else it throws
      // on import so that a server module pulled into a client bundle fails
      // loudly. Vitest is neither, so it is pointed at the same empty module
      // Next uses. The marker still does its job in `next build`.
      "server-only": fileURLToPath(
        new URL("./node_modules/server-only/empty.js", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["e2e/**", "node_modules/**", ".next/**"],
  },
});
