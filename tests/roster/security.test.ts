/**
 * Ward can see the shape of this deployment, and never its secrets.
 *
 * The whole role rests on one property: a tool that returned a token — even
 * into an internal transcript — would be a worse leak than the one it was
 * looking for, because `agent_messages` is written to the database, replayed in
 * the admin, and read back by whoever opens the run.
 *
 * So this file sets every watched variable to a value that could not occur by
 * accident and asserts that value appears NOWHERE in the whole report, at any
 * depth, in any field. It also checks the two things that make the role safe by
 * construction: it proposes rather than acts, and every tool it holds is a read
 * or an internal note.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  WATCHED_SECRETS,
  describeSecretPosture,
  securityRole,
  type SecurityEnv,
} from "@/lib/agents/roster";
import { StaticStrategyStore } from "@/lib/strategy";
import type { Strategy } from "@/content/strategy/types";

import {
  createSeededBusiness,
  type RosterTestDatabase,
} from "./support/pglite";
import { SqlBusinessReads } from "@/lib/agents/roster";

/** A string that cannot plausibly be produced by any code path under test. */
const CANARY = "sk-live-CANARY-3f9a2b7c-do-not-echo";

function envWithEverythingSet(): SecurityEnv {
  const env: Record<string, string> = {};
  for (const secret of WATCHED_SECRETS) env[secret.name] = CANARY;
  return env;
}

let database: RosterTestDatabase;
let strategy: Strategy;

beforeAll(async () => {
  database = await createSeededBusiness();
  strategy = await new StaticStrategyStore().loadStrategy();
}, 180_000);

afterAll(async () => {
  await database.close();
});

describe("the security role never holds a secret", () => {
  it("reports every watched credential as configured without echoing one", () => {
    const posture = describeSecretPosture({
      env: envWithEverythingSet(),
      authGaps: () => [],
    });
    expect(posture.missing).toEqual([]);
    expect(posture.configuredCount).toBe(WATCHED_SECRETS.length);
    expect(JSON.stringify(posture)).not.toContain(CANARY);
    // It knows the names, which is the whole point of it being useful.
    expect(posture.secrets.map((secret) => secret.name)).toContain(
      "ADMIN_PASSWORD_HASH",
    );
  });

  it("names what is missing without inventing what is there", () => {
    const posture = describeSecretPosture({ env: {}, authGaps: () => [] });
    expect(posture.configuredCount).toBe(0);
    expect(posture.missing).toContain("ADMIN_PASSWORD_HASH");
    for (const entry of posture.secrets) {
      expect(entry.whenMissing).not.toBeNull();
    }
  });

  it("says plainly when the admin opens with no password at all", () => {
    const posture = describeSecretPosture({
      env: { HALF_SOUR_DEMO: "1" },
      authGaps: () => [],
    });
    expect(posture.adminOpensWithoutPassword).toBe(true);
    expect(posture.warnings.join(" ")).toContain("opens without a password");
  });

  it("does not call the admin open when a real database is attached", () => {
    const posture = describeSecretPosture({
      env: {
        HALF_SOUR_DEMO: "1",
        SUPABASE_DB_URL: "postgres://localhost:5432/half_sour",
      },
      authGaps: () => [],
    });
    expect(posture.adminOpensWithoutPassword).toBe(false);
  });

  it("returns no secret value through the database read either", async () => {
    const reads = new SqlBusinessReads(database.sql, {
      env: envWithEverythingSet(),
      authGaps: () => [],
    });
    const report = await reads.secretsConfigured();
    const serialised = JSON.stringify(report);
    expect(serialised).not.toContain(CANARY);
    // The seed marks two settings rows secret. Their keys are readable; the
    // `value` column is not selected by the query at all.
    expect(report.secretSettings.length).toBeGreaterThan(0);
    expect(serialised).not.toContain("vault:shopify_admin_api_token");
  });

  it("reads sessions without ever returning a session token hash", async () => {
    const reads = new SqlBusinessReads(database.sql);
    const report = await reads.adminSessions();
    const hashes = await database.rows(
      `select session_token_hash from public.admin_sessions`,
    );
    expect(hashes.length).toBeGreaterThan(0);
    const serialised = JSON.stringify(report);
    for (const row of hashes) {
      expect(serialised).not.toContain(String(row["session_token_hash"]));
    }
    expect(report.headline.length).toBeGreaterThan(10);
  });

  it("reads the sign-in record and the change trail off the seeded business", async () => {
    const reads = new SqlBusinessReads(database.sql);
    const signIns = await reads.signInActivity(30);
    // The seed records one sign-in and one sign-out for the founder.
    expect(signIns.signIns.length).toBeGreaterThan(0);
    expect(signIns.findings.length).toBeGreaterThan(0);

    const trail = await reads.changeTrail(30);
    expect(trail.total).toBeGreaterThan(0);
    expect(trail.byActor.length).toBeGreaterThan(0);
    // Plain English rather than the enum: the trail says "created" and
    // "synced", not "create" and "sync". (An entity label may still contain
    // the word — one of the seeded rows is a webhook topic called
    // "orders/create" — so this checks the verbs rather than the whole string.)
    const said = trail.findings.join(" ");
    expect(said).toContain(" created ");
    expect(said).toContain(" synced ");
    expect(said).not.toMatch(/ (create|sync|approve) [a-z]/);
  });
});

describe("the security role watches and does not act", () => {
  it("is on propose, so every write of any kind stops for a decision", () => {
    const role = securityRole(strategy);
    expect(role.definition.autonomy).toBe("propose");
    expect(role.definition.requiresApprovalFor.length).toBeGreaterThan(0);
  });

  it("holds nothing that could change a setting or reach outside the company", () => {
    const role = securityRole(strategy);
    for (const tool of role.definition.tools) {
      expect(
        tool.startsWith("read_") ||
          tool === "save_internal_note" ||
          tool === "hand_off",
      ).toBe(true);
    }
  });

  it("advertises the capability the chat router can reach it by", () => {
    const role = securityRole(strategy);
    expect(role.capabilities).toContain("security_watch");
  });
});
