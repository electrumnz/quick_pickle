/**
 * Building the demo image.
 *
 * Boots an empty PGlite, stands up the parts of Supabase the migrations expect
 * the platform to provide, applies every migration in filename order, applies
 * `supabase/seed.sql`, and dumps the whole data directory to one gzipped tar.
 *
 * The dump exists to move that work from every cold start to one build step.
 * Measured on this machine: replaying the chain costs about 2.2 s (1.2 s to
 * boot an empty cluster, 0.6 s of migrations, 0.4 s of seed), while opening the
 * dump costs about 0.9 s. On a platform that starts a fresh instance whenever
 * it feels like it, that difference is the whole reason this file exists.
 *
 * Run by `npm run demo:build-image`, and by `prebuild` when `HALF_SOUR_DEMO=1`.
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

/**
 * Where the built image lands, relative to the repository root.
 *
 * Gitignored: it is 4.4 MB of binary rebuilt from files that are in the tree,
 * so committing it would be committing a cache.
 */
export const DEMO_IMAGE_RELATIVE_PATH = path.join(
  "lib",
  "demo",
  "generated",
  "demo-db.tar.gz",
);

/** Absolute path to the image for a given repository root. */
export function demoImagePath(root: string = process.cwd()): string {
  return path.join(root, DEMO_IMAGE_RELATIVE_PATH);
}

/**
 * The pieces of a Supabase project the migrations reference and PGlite does not
 * ship.
 *
 * Copied in shape from `tests/strategy/support/pglite.ts` and
 * `lib/commerce/testing/pglite.ts`, which have applied this chain for months:
 * the `auth` schema and `auth.users` for the foreign key on `operators`,
 * `auth.uid()` and `auth.jwt()` for the RLS predicates, and the three roles the
 * grant migration hands privileges to. `check_function_bodies` is off because
 * the foundation migration defines functions over tables that later migrations
 * create — which is exactly how Supabase's own migration runner applies them.
 *
 * None of it is a behaviour. The admin gate authenticates against
 * `ADMIN_PASSWORD_HASH`, not against Supabase auth, so `auth.uid()` returning
 * null here changes nothing about who can sign in.
 */
export const SUPABASE_PLATFORM_STUB = `
create schema if not exists auth;
create table if not exists auth.users (
  id         uuid primary key default gen_random_uuid(),
  email      text,
  created_at timestamptz not null default now()
);
create or replace function auth.uid() returns uuid language sql stable
  as $fn$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $fn$;
create or replace function auth.jwt() returns jsonb language sql stable
  as $fn$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $fn$;
do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit;
  end if;
end;
$roles$;
set check_function_bodies = off;
`;

export type DemoImageBuild = {
  readonly bytes: Uint8Array;
  /** Migration filenames applied, in the order they were applied. */
  readonly migrations: readonly string[];
  readonly seedPath: string;
  readonly milliseconds: number;
};

/**
 * Apply the whole chain to a fresh PGlite and dump it.
 *
 * The dump is gzipped: 4.4 MB against roughly 100 MB raw, and PGlite reads
 * either. Nothing about the schema or the data differs between them.
 */
export async function buildDemoImage(
  root: string = process.cwd(),
): Promise<DemoImageBuild> {
  const started = Date.now();
  // Dynamically imported so that importing this module — which the demo
  // provider's tests do — never loads the WASM build unless it is used.
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();

  try {
    await db.exec(SUPABASE_PLATFORM_STUB);

    const migrationsDir = path.join(root, "supabase", "migrations");
    const migrations = readdirSync(migrationsDir)
      .filter((file) => file.endsWith(".sql"))
      .sort();
    if (migrations.length === 0) {
      throw new Error(`No migrations found in ${migrationsDir}.`);
    }
    for (const file of migrations) {
      try {
        await db.exec(readFileSync(path.join(migrationsDir, file), "utf8"));
      } catch (cause) {
        throw new Error(
          `Migration ${file} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
    }

    const seedPath = path.join(root, "supabase", "seed.sql");
    try {
      await db.exec(readFileSync(seedPath, "utf8"));
    } catch (cause) {
      throw new Error(
        `supabase/seed.sql failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }

    const dump = await db.dumpDataDir("gzip");
    const bytes = new Uint8Array(await dump.arrayBuffer());
    return {
      bytes,
      migrations,
      seedPath,
      milliseconds: Date.now() - started,
    };
  } finally {
    await db.close();
  }
}

/** Build and write the image, creating its directory. */
export async function writeDemoImage(
  root: string = process.cwd(),
): Promise<DemoImageBuild & { readonly path: string }> {
  const build = await buildDemoImage(root);
  const target = demoImagePath(root);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, build.bytes);
  return { ...build, path: target };
}

/**
 * The image, built if it is not there yet.
 *
 * `npm run build` makes it when demo mode is on, so in a deployment this only
 * ever finds it. It builds on demand for the test suite and for a checkout
 * where nobody has run the build yet, so that a missing cache is a four-second
 * wait rather than a failure.
 */
export async function ensureDemoImage(
  root: string = process.cwd(),
): Promise<string> {
  const target = demoImagePath(root);
  if (existsSync(target)) return target;
  const built = await writeDemoImage(root);
  return built.path;
}
