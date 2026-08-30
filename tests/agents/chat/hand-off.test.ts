/**
 * `hand_off`, the caller the routing fabric never had.
 *
 * `lib/agents/boundary/handoff.ts` has been able to resolve a capability to an
 * agent, refuse an unadvertised one and refuse a spent conversation since it was
 * written. `tests/agents/boundary/handoff.test.ts` proves all three against a
 * router held in a test's own hand. What was missing was a way for an agent to
 * reach it, and this proves the tool that closes that: an agent that runs out of
 * its own job names the WORK it needs, the router finds whoever advertises it,
 * and a second run really opens.
 *
 * Everything here is the real thing except the two models: the real seeded
 * business, the real roster, the real registry, the real runtime, the real
 * approval gate, the real cost meter, and the SQL conversation ledger the cap is
 * counted in.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ScriptedModel, createScriptedResolver } from "@/lib/agents";
import type { ModelResolver } from "@/lib/agents";
import { askTheTeam, createChatPlatform, openSession } from "@/lib/agents/chat";
import { createPgliteExecutor } from "@/lib/commerce/sql/pglite";
import type { SqlExecutor } from "@/lib/commerce/sql/executor";

import {
  createSeededBusiness,
  type RosterTestDatabase,
} from "../../roster/support/pglite";

let database: RosterTestDatabase;
let sql: SqlExecutor;
let operatorId: string;

beforeAll(async () => {
  database = await createSeededBusiness();
  sql = createPgliteExecutor(database.db);
  const rows = await database.rows(
    `select id::text as id from public.operators order by created_at limit 1`,
  );
  operatorId = String(rows[0]?.["id"]);
}, 180_000);

afterAll(async () => {
  await database.close();
});

/**
 * One script, both runs.
 *
 * A handoff happens inside the calling run's tool execution, so the model calls
 * are strictly ordered in time: the caller proposes the handoff, the colleague's
 * whole run happens, and only then does the caller take its next turn. One
 * script in that order serves both, which is also the clearest statement of what
 * actually happens — a second model keyed on the role would hide the ordering
 * that is the point.
 */
function twoRunScript(params: {
  readonly capability: string;
  readonly message: string;
  /** What the colleague says. Comes back into the caller's transcript. */
  readonly reply: string;
  /** What the caller says once it has the answer. */
  readonly handOver: string;
}): ModelResolver {
  return createScriptedResolver(
    new ScriptedModel([
      {
        kind: "tool-calls",
        text: "This is not my job. Passing it to whoever does it.",
        calls: [
          {
            toolName: "hand_off",
            input: { capability: params.capability, message: params.message },
          },
        ],
      },
      { kind: "text", text: params.reply },
      { kind: "text", text: params.handOver },
    ]),
  );
}

describe("an agent asks a colleague", () => {
  it("routes by capability, opens a real second run, and brings the answer back", async () => {
    const chat = await createChatPlatform({
      sql,
      env: {},
      models: twoRunScript({
        capability: "pricing_and_margin",
        message: "A supplier price moved. What does that do to No 01?",
        handOver: "Teller has the margin; I have passed it over.",
        reply: "No 01 is still above the floor at 63 percent.",
      }),
    });
    const sessionId = await openSession(sql, operatorId, "Handoff");
    const result = await askTheTeam({
      sql,
      chat,
      sessionId,
      message: "are we running low on dill",
    });

    expect(result.outcome).toBe("answered");
    // Marlow answered her; Teller answered Marlow.
    expect(result.agentName).toBe("Marlow");

    const chained = await database.rows(
      `select r.id::text as id, a.slug, r.trigger::text as trigger,
              r.parent_run_id::text as parent, r.status::text as status,
              r.context -> 'conversation' as conversation
         from public.agent_runs r
         join public.agents a on a.id = r.agent_id
        where r.parent_run_id = $1`,
      [result.runId],
    );
    expect(chained).toHaveLength(1);
    const child = chained[0] ?? {};
    // Resolved from the capability, never named by the calling agent.
    expect(String(child["slug"])).toBe("ledger");
    expect(String(child["trigger"])).toBe("chained");
    expect(String(child["status"])).toBe("succeeded");

    // Both runs are in the same conversation, and the child is turn 2 of it.
    const conversation = child["conversation"] as Record<string, unknown>;
    expect(conversation["turn"]).toBe(2);
    expect(conversation["turnCap"]).toBe(5);

    // The colleague's answer came back into the calling run's transcript as a
    // tool result, so the handoff is replayable like any other tool call.
    const toolCalls = await database.rows(
      `select tool_name, status::text as status, result
         from public.agent_tool_calls where run_id = $1`,
      [result.runId],
    );
    expect(toolCalls).toHaveLength(1);
    expect(String(toolCalls[0]?.["tool_name"])).toBe("hand_off");
    expect(String(toolCalls[0]?.["status"])).toBe("succeeded");
    expect(JSON.stringify(toolCalls[0]?.["result"])).toContain(
      "still above the floor",
    );
  }, 180_000);

  it("comes back as a readable outcome when nobody advertises the work", async () => {
    // Nobody on duty does social, so the capability resolves to nothing. The
    // router returns `unroutable` and the tool turns it into something the
    // calling agent can act on rather than throwing into its transcript.
    await database.rows(
      `update public.agents set is_enabled = false, status = 'paused'
        where slug = 'social'`,
    );
    const chat = await createChatPlatform({
      sql,
      env: {},
      models: twoRunScript({
        capability: "social_content",
        message: "Write a post about this.",
        handOver: "Nobody could take the post, so I have left it.",
        reply: "unused",
      }),
    });
    const sessionId = await openSession(sql, operatorId, "Unroutable");
    const result = await askTheTeam({
      sql,
      chat,
      sessionId,
      message: "are we running low on dill",
    });

    expect(result.outcome).toBe("answered");
    const toolCalls = await database.rows(
      `select status::text as status, result from public.agent_tool_calls
        where run_id = $1`,
      [result.runId],
    );
    expect(String(toolCalls[0]?.["status"])).toBe("succeeded");
    const said = JSON.stringify(toolCalls[0]?.["result"]);
    expect(said).toContain("Nobody in this company advertises");
    expect(said).toContain('"handedOver":false');

    // Nothing was opened.
    const chained = await database.rows(
      `select count(*)::int as n from public.agent_runs where parent_run_id = $1`,
      [result.runId],
    );
    expect(Number(chained[0]?.["n"])).toBe(0);

    await database.rows(
      `update public.agents set is_enabled = true, status = 'active'
        where slug = 'social'`,
    );
  }, 180_000);

  it("refuses rather than opening a sixth run when the turns are gone", async () => {
    const chat = await createChatPlatform({
      sql,
      env: {},
      models: twoRunScript({
        capability: "pricing_and_margin",
        message: "One more, please.",
        handOver: "The conversation is out of turns.",
        reply: "unused",
      }),
    });
    const sessionId = await openSession(sql, operatorId, "Out of turns");

    // Four agents have already passed this round; the run the chat opens is the
    // fifth turn, and the handoff it proposes would be the sixth. Written into
    // the ledger directly because scripting five real agents to circle would
    // prove the same thing five times more slowly.
    const conversationId = `chat:${sessionId}:1`;
    await database.rows(
      `insert into public.agent_conversations (id, turns_taken, turn_cap)
       values ($1, 4, 5)`,
      [conversationId],
    );

    const result = await askTheTeam({
      sql,
      chat,
      sessionId,
      message: "are we running low on dill",
    });

    // The tool ran and refused. It did not throw: a refusal the calling run can
    // read is the whole reason `HandoffOutcome` is returned rather than raised.
    const toolCalls = await database.rows(
      `select status::text as status, result
         from public.agent_tool_calls where run_id = $1`,
      [result.runId],
    );
    expect(String(toolCalls[0]?.["status"])).toBe("succeeded");
    const said = JSON.stringify(toolCalls[0]?.["result"]);
    expect(said).toContain("used its 5 turns");
    expect(said).toContain('"handedOver":false');

    const chained = await database.rows(
      `select count(*)::int as n from public.agent_runs where parent_run_id = $1`,
      [result.runId],
    );
    expect(Number(chained[0]?.["n"])).toBe(0);
  }, 180_000);
});
