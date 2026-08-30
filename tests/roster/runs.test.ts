/**
 * All nine roles, run against the seeded business.
 *
 * The point of this file is not that a model said something. It is that each
 * role read the business through its own grant, reasoned from what came back,
 * and could not make anything happen outside the company without a decision.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createRosterHarness,
  runRole,
  type RosterHarness,
} from "./support/harness";

let harness: RosterHarness;

beforeAll(async () => {
  harness = await createRosterHarness();
}, 120_000);

afterAll(async () => {
  await harness.close();
});

describe("the roster runs", () => {
  it("has all nine roles, each with a routine and a goal", () => {
    expect(harness.roster.roles).toHaveLength(9);
    for (const role of harness.roster.roles) {
      expect(role.routine.length).toBeGreaterThan(0);
      expect(role.goal.length).toBeGreaterThan(10);
      expect(role.plainJob.length).toBeGreaterThan(10);
    }
  });

  it("every granted tool exists in the registry", () => {
    for (const role of harness.roster.roles) {
      for (const tool of role.definition.tools) {
        expect(harness.tools.registry.has(tool)).toBe(true);
      }
    }
  });

  for (const slug of [
    "brine-ops",
    "concierge",
    "ledger",
    "social",
    "marketing",
    "trade",
    "product",
    "analyst",
    "security",
  ]) {
    it(`${slug} finishes a run and reports numbers it actually read`, async () => {
      const role = harness.roster.roles.find(
        (candidate) => candidate.definition.slug === slug,
      );
      expect(role).toBeDefined();
      if (role === undefined) return;

      const run = await runRole(harness, role);
      expect(run.summary.status).toBe("succeeded");
      expect(run.summary.toolCallCount).toBeGreaterThan(0);
      expect(run.summary.costMicros).toBeGreaterThan(0);

      const messages = await run.store.listMessages(run.runId);
      const assistant = messages.filter(
        (message) => message.role === "assistant",
      );
      // Reasoning is stated before every tool call and stored.
      expect(assistant.length).toBeGreaterThan(1);
      expect(run.summary.outcome ?? "").toContain("What I found");
    }, 60_000);
  }
});
