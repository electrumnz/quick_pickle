/**
 * Build the demo database image.
 *
 *   npm run demo:build-image        # always builds
 *   npm run build                   # builds only when HALF_SOUR_DEMO=1
 *
 * Wired to `prebuild` so a deployment that has demo mode switched on gets the
 * image without anyone remembering to make it, and a deployment that does not
 * pays nothing: with the variable unset this script prints one line and exits 0
 * without loading PGlite at all.
 */

import process from "node:process";

import { DEMO_ENV_VAR, isDemoMode } from "../mode.ts";

const forced = process.argv.includes("--force");

if (!forced && !isDemoMode()) {
  process.stdout.write(
    `demo image: skipped (${DEMO_ENV_VAR} is not 1; pass --force to build anyway)\n`,
  );
  process.exit(0);
}

const { writeDemoImage } = await import("../build.ts");

try {
  const built = await writeDemoImage();
  const mib = (built.bytes.byteLength / (1024 * 1024)).toFixed(2);
  process.stdout.write(
    `demo image: ${built.path}\n` +
      `  ${String(built.migrations.length)} migrations + supabase/seed.sql\n` +
      `  ${mib} MiB gzipped, built in ${String(built.milliseconds)} ms\n`,
  );
} catch (cause) {
  process.stderr.write(
    `demo image: FAILED — ${cause instanceof Error ? cause.message : String(cause)}\n`,
  );
  process.exit(1);
}
