/**
 * The avatars, as SQL.
 *
 * Same discipline as `content/strategy/emit-seed.ts`: the migration's seed
 * block is generated from the typed avatars rather than hand-written, because a
 * hand-written INSERT is a second copy of the strategy that drifts the first
 * time somebody edits one and not the other.
 *
 *   UPDATE_AVATAR_SEED=1 npx vitest run tests/strategy/avatars.test.ts
 *
 * rewrites the block between the two markers in
 * `supabase/migrations/20260105000000_audience_avatars.sql` from
 * `content/strategy/avatars.ts`. Everything else in that migration — the table,
 * the constraints, the policies, the assertions — is hand-written and is not
 * touched.
 *
 * It lives in `lib/` rather than beside the other emitter because it projects
 * the avatars through `staticAvatars()`, which is the same projection the
 * static store and the parity test use; putting it in `content/` would make
 * the content layer import the library layer that imports it back.
 */

import { STRATEGY } from "@/content/strategy";
import type { Strategy } from "@/content/strategy/types";

import { staticAvatars } from "./store";

export const AVATAR_SEED_START = "-- @@AVATAR-SEED-START@@";
export const AVATAR_SEED_END = "-- @@AVATAR-SEED-END@@";

/** A dollar-quoted literal. The tag is fixed and appears in no payload. */
function q(value: string): string {
  if (value.includes("$hs$")) {
    throw new Error("An avatar string contains the dollar-quote tag $hs$.");
  }
  return `$hs$${value}$hs$`;
}

function textArray(values: readonly string[]): string {
  return `array[${values.map((value) => q(value)).join(", ")}]::text[]`;
}

export function avatarSeedSql(strategy: Strategy = STRATEGY): string {
  const rows = staticAvatars(strategy).map(
    (record) =>
      `  (${q(record.slug)}, ${q(record.audience)}::public.strategy_audience,\n` +
      `   ${q(record.label)}, ${q(record.version)},\n` +
      `   ${textArray(record.appliesTo)}, ${String(record.position)}, true,\n` +
      `   ${q(JSON.stringify(record.body, null, 2))}::jsonb)`,
  );

  return [
    "-- Generated from content/strategy/avatars.ts by lib/strategy/emit-avatar-seed.ts.",
    "-- Do not hand-edit: run",
    "--   UPDATE_AVATAR_SEED=1 npx vitest run tests/strategy/avatars.test.ts",
    "-- after changing an avatar in code.",
    "",
    "insert into public.strategy_avatars",
    "  (slug, audience, label, version, applies_to, position, is_active, body)",
    "values",
    `${rows.join(",\n")};`,
  ].join("\n");
}
