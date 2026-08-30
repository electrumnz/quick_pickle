/**
 * A stand-in for the Vercel AI Gateway, on localhost, for the screenshots.
 *
 * The evidence in this directory has to show the "Run now" control before,
 * during and after a real run. That needs a model to answer, and there is no
 * gateway credential in this container — so rather than photograph a scripted
 * planner and call it a run, this speaks the gateway's own wire protocol on a
 * local port and the app is pointed at it with `AI_GATEWAY_BASE_URL`.
 *
 * What that means for the screenshots, stated so nobody has to guess:
 *
 *  - Everything above the socket is the shipping code path. The real
 *    `@ai-sdk/gateway` client builds the request, the runtime builds the prompt
 *    from `strategy_documents` and `brand_rules`, the seeded Postgres answers
 *    the tools, the approval gate and the cost meter run, and the transcript is
 *    written to `agent_runs` by `SqlAgentStore`.
 *  - The words the agent "says" are the ones below. They are not a model's.
 *
 * `tests/roster/manual-run.test.ts` proves the same stack with `fetch`
 * substituted in process rather than over a socket, and asserts what goes on the
 * wire. This exists only so the control can be photographed working.
 *
 *   node lib/agents/roster/evidence/run-now/stand-in-gateway.mjs 4311
 */

import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 4311);

/** Roughly a real turn's token count, so the cost meter has something to price. */
const USAGE = {
  inputTokens: { total: 21_400, noCache: 21_400, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 610, text: 610, reasoning: 0 },
};

function turn(content, finish, modelId) {
  return {
    content,
    finishReason: finish,
    usage: USAGE,
    warnings: [],
    response: { id: `stand-in-${String(Date.now())}`, modelId },
  };
}

/**
 * Two turns: read the stock cover, then say what it found.
 *
 * Deliberately a read-only routine. A run that proposed a supplier order would
 * park on the approval gate, which is the right behaviour and the wrong
 * screenshot for "here is a finished transcript".
 */
const script = [
  (modelId) =>
    turn(
      [
        {
          type: "text",
          text: "Days of cover first — nothing else in this job means anything without it.",
        },
        {
          type: "tool-call",
          toolCallId: "stand-in-1",
          toolName: "read_stock_cover",
          input: JSON.stringify({}),
        },
      ],
      { unified: "tool-calls", raw: "tool_use" },
      modelId,
    ),
  (modelId) =>
    turn(
      [
        {
          type: "text",
          text:
            "Cover read against the reorder points and the production board. " +
            "Nothing is inside its lead time today, so there is nothing to order " +
            "and nothing for you to decide. I have written the numbers down.",
        },
      ],
      { unified: "stop", raw: "end_turn" },
      modelId,
    ),
];

let call = 0;

const server = createServer((request, response) => {
  // The body is drained rather than read: what the request carried is asserted
  // in `tests/roster/manual-run.test.ts`, where it can be looked at properly.
  request.resume();
  request.on("end", () => {
    const modelId = request.headers["ai-language-model-id"] ?? "unknown";
    // A pause, so the "during" screenshot has something to photograph. A real
    // gateway turn takes about this long.
    const delay = 2200;
    const next = script[Math.min(call, script.length - 1)];
    call += 1;
    setTimeout(() => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(next(String(modelId))));
    }, delay);
  });
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(
    `stand-in gateway on http://127.0.0.1:${String(port)}\n`,
  );
});
