/**
 * What the gateway resolver actually puts on the wire.
 *
 * This is not a live run and does not pretend to be one — `live-gateway.test.ts`
 * is that, and it needs a credential. This proves the half that does not: that
 * `createGatewayResolver` is wired to the real `@ai-sdk/gateway` client, that a
 * roster role's tools reach the request as tool definitions the model can call,
 * that the model id and the credential travel in the right places, and that a
 * tool call coming back drives the runtime's gate, its meter and its outbox
 * exactly as the scripted path does.
 *
 * The only thing substituted is `fetch`. Everything above it is the shipping
 * code path: the gateway provider builds the request, the runtime builds the
 * prompt, the seeded Postgres answers the tool, and `RecordingOutbox` delivers
 * nothing.
 *
 * Tool calling is a hard requirement here — the roster has twenty-three tools
 * and a role that cannot call one is a role that cannot do its job — so it is
 * asserted rather than assumed.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  MINIMAX_M2_7_FREE,
  createGatewayResolver,
  formatMicrosNzd,
} from "@/lib/agents";
import type { RosterRole } from "@/lib/agents/roster";

import {
  APPROVE_EVERYTHING,
  createRosterHarness,
  runRole,
  type RosterHarness,
} from "./support/harness";

interface CapturedRequest {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: {
    readonly prompt?: readonly unknown[];
    readonly tools?: readonly {
      readonly type?: string;
      readonly name?: string;
      readonly description?: string;
      readonly inputSchema?: unknown;
    }[];
  };
}

const captured: CapturedRequest[] = [];

/** A `LanguageModelV4` generate result, as the gateway returns it: straight JSON. */
function turn(
  content: readonly unknown[],
  finish: { unified: string; raw: string },
): Response {
  return new Response(
    JSON.stringify({
      content,
      finishReason: finish,
      usage: {
        inputTokens: {
          total: 41_200,
          noCache: 41_200,
          cacheRead: 0,
          cacheWrite: 0,
        },
        outputTokens: { total: 480, text: 480, reasoning: 0 },
      },
      warnings: [],
      response: { id: "gw-1", modelId: MINIMAX_M2_7_FREE },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

/**
 * Answers two turns: read the stock cover, then say what it found.
 *
 * Deliberately the shape a real agentic model produces — reasoning first, then a
 * tool call with arguments the tool's own schema has to accept.
 */
function scriptedGateway(): typeof globalThis.fetch {
  let call = 0;
  return async (input, init) => {
    call += 1;
    const headers: Record<string, string> = {};
    for (const [key, value] of new Headers(init?.headers).entries()) {
      headers[key.toLowerCase()] = value;
    }
    captured.push({
      url: String(input),
      headers,
      body: JSON.parse(String(init?.body ?? "{}")) as CapturedRequest["body"],
    });

    if (call === 1) {
      return turn(
        [
          {
            type: "text",
            text: "Days of cover first: nothing else in this job means anything without it.",
          },
          {
            type: "tool-call",
            toolCallId: "gw-call-1",
            toolName: "read_stock_cover",
            input: JSON.stringify({}),
          },
        ],
        { unified: "tool-calls", raw: "tool_use" },
      );
    }
    return turn(
      [
        {
          type: "text",
          text: "Cover read. Nothing is close enough to its lead time to order against today.",
        },
      ],
      { unified: "stop", raw: "end_turn" },
    );
  };
}

let harness: RosterHarness;

function roleFor(slug: string): RosterRole {
  const role = harness.roster.roles.find(
    (candidate) => candidate.definition.slug === slug,
  );
  if (role === undefined) throw new Error(`no role ${slug}`);
  return role;
}

beforeAll(async () => {
  harness = await createRosterHarness();
}, 120_000);

afterAll(async () => {
  await harness.close();
});

describe("a roster role driven through the real gateway client", () => {
  it("posts to the gateway, names the model, and carries the role's tools", async () => {
    captured.length = 0;
    const role = roleFor("brine-ops");
    const run = await runRole(harness, role, {
      policy: APPROVE_EVERYTHING,
      models: createGatewayResolver({
        apiKey: "test-gateway-key",
        fetch: scriptedGateway(),
      }),
    });

    const first = captured[0];
    expect(first).toBeDefined();
    if (first === undefined) return;

    // The gateway, not a provider's own endpoint.
    expect(first.url).toContain("ai-gateway.vercel.sh");
    expect(first.url.endsWith("/language-model")).toBe(true);

    // The model id rides in the header the gateway routes on, and it is the one
    // this role's definition declares — not a default and not a global.
    expect(first.headers["ai-language-model-id"]).toBe(role.definition.model);
    expect(first.headers["ai-language-model-id"]).toBe(MINIMAX_M2_7_FREE);
    expect(first.headers["authorization"]).toBe("Bearer test-gateway-key");

    // Tool calling. Every tool the role is granted, and nothing it is not.
    const names = (first.body.tools ?? [])
      .map((tool) => tool.name ?? "")
      .sort();
    expect(names).toEqual([...role.definition.tools].sort());
    for (const tool of first.body.tools ?? []) {
      expect(tool.type).toBe("function");
      expect(tool.inputSchema).toBeDefined();
      // The effect is stated to the model in the description, so a model that
      // reads its tools knows which of them a human has to approve.
      expect(tool.description ?? "").toContain("effect:");
    }
    // Ari's tools are not in Marlow's request.
    expect(names).not.toContain("queue_campaign_email");

    expect(run.summary.status).toBe("succeeded");
  }, 120_000);

  it("executes the tool the model asked for and records what it cost", async () => {
    captured.length = 0;
    const role = roleFor("brine-ops");
    const run = await runRole(harness, role, {
      policy: APPROVE_EVERYTHING,
      models: createGatewayResolver({
        apiKey: "test-gateway-key",
        fetch: scriptedGateway(),
      }),
    });

    const calls = await run.store.listToolCalls(run.runId);
    expect(calls.map((call) => call.toolName)).toEqual(["read_stock_cover"]);
    expect(calls[0]?.status).toBe("succeeded");
    // A real query against the seeded business answered it.
    expect(JSON.stringify(calls[0]?.result ?? {})).toContain("sku");

    // The run is recorded as having gone through the gateway, and priced.
    const stored = await run.store.getRun(run.runId);
    expect(stored?.context["modelProvider"]).toBe("gateway");
    expect(stored?.context["model"]).toBe(MINIMAX_M2_7_FREE);

    const costs = await run.store.listCosts({ runId: run.runId });
    expect(costs).toHaveLength(2);
    for (const cost of costs) {
      expect(cost.provider).toBe("gateway");
      expect(cost.model).toBe(MINIMAX_M2_7_FREE);
      expect(cost.inputTokens).toBe(41_200);
      expect(cost.costMicros).toBeGreaterThan(0);
    }
    expect(formatMicrosNzd(run.summary.costMicros)).toMatch(/^\$/);

    // And nothing left the company.
    expect(run.outbox.externalCount()).toBe(0);
  }, 120_000);

  it("carries the second turn's tool result back to the model, framed", async () => {
    captured.length = 0;
    await runRole(harness, roleFor("brine-ops"), {
      policy: APPROVE_EVERYTHING,
      models: createGatewayResolver({
        apiKey: "test-gateway-key",
        fetch: scriptedGateway(),
      }),
    });

    const second = captured[1];
    expect(second).toBeDefined();
    // The prompt grew: system, goal, the assistant turn, and the tool result.
    expect((second?.body.prompt ?? []).length).toBeGreaterThan(
      (captured[0]?.body.prompt ?? []).length,
    );
    const wire = JSON.stringify(second?.body.prompt ?? []);
    expect(wire).toContain("read_stock_cover");
    // The role's own instructions reached the model, not just the goal.
    expect(JSON.stringify(captured[0]?.body.prompt ?? [])).toContain(
      "days of cover",
    );
  }, 120_000);
});
