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
    // A test never sees the mail settings of the machine it runs on. One
    // that needs a provider, a key, a secret or an address hands in its own,
    // with a fake `fetch` beside it: no test can reach the real mail
    // provider, and none is let in by a secret it did not set.
    env: {
      MAIL_PROVIDER: "",
      RESEND_API_KEY: "",
      MAIL_FROM: "",
      RESEND_WEBHOOK_SECRET: "",
      MAIL_INBOUND_SECRET: "",
      MAIL_TOKEN_SECRET: "",
    },
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["e2e/**", "node_modules/**", ".next/**"],
    // Most files open their own Postgres in the process and run every
    // migration on it before the first test. That takes a second or two on
    // a quiet machine and well over the default ten on a busy one (a build
    // running beside the tests, a slow CI runner), which showed as a whole
    // file failing in its set-up for no reason of its own.
    hookTimeout: 60_000,
  },
});
