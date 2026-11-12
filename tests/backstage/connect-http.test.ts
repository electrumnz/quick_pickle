import {
  Client,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  type OAuthClientProvider,
} from "@modelcontextprotocol/client";
import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import * as serverDocument from "@/app/.well-known/oauth-authorization-server/route";
import * as resourceDocument from "@/app/.well-known/oauth-protected-resource/[[...path]]/route";
import * as mcpRoute from "@/app/api/mcp/route";
import * as registerRoute from "@/app/api/oauth/register/route";
import * as tokenRoute from "@/app/api/oauth/token/route";
import {
  approvals,
  auditLog,
  connections,
  events,
  oauthClients,
  oauthCodes,
  rateHits,
  settings,
  tasks,
  users,
} from "@/db/schema";
import { approve } from "@/lib/backstage/connect/approve";
import {
  checkConnectRequest,
  CONNECT_KEY,
  grantConnection,
  setConnectOn,
} from "@/lib/backstage/connect/oauth";
import { callMark } from "@/lib/backstage/connect/http";
import { ACCESS_MINUTES } from "@/lib/backstage/connect/tokens";
import { systemCaller, type Caller } from "@/lib/backstage/core/actor";
import { execute } from "@/lib/backstage/core/op";
import { countHit } from "@/lib/backstage/limits/ops";
import { SHOP_OFFER_KEY, shopOffer } from "@/lib/backstage/shop/ops";
import {
  closeDb,
  openEmbedded,
  useDbHandle,
  type DbHandle,
} from "@/lib/db/client";
import { newId } from "@/lib/db/id";
import { LIMITS } from "@/lib/shop/limit";

/**
 * The connection, end to end, the way an app really makes one.
 *
 * The app here is the Model Context Protocol's own client library, which
 * is what an app like Claude Code is built on. It is pointed at this
 * site's own handlers through a stand-in for the network, so everything it
 * does is what a real app does: it is told it needs a key, reads the two
 * documents that say where keys come from, registers, sends a person to
 * say yes, swaps the code, and then calls the tools. Nothing here goes on
 * the wire.
 */

const SITE = "https://shop.example";
const MCP = `${SITE}/api/mcp`;
const CALLBACK = "http://localhost:53999/callback";

type Handler = (request: Request) => Response | Promise<Response>;

/** This site, as a function: an address in, the handler's answer out. */
async function site(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  const routes: Record<string, Readonly<Record<string, unknown>>> = {
    "/.well-known/oauth-protected-resource": resourceDocument,
    "/.well-known/oauth-protected-resource/api/mcp": resourceDocument,
    "/.well-known/oauth-authorization-server": serverDocument,
    "/api/oauth/register": registerRoute,
    "/api/oauth/token": tokenRoute,
    "/api/mcp": mcpRoute,
  };
  const handler = routes[pathname]?.[request.method];
  if (typeof handler !== "function") {
    return new Response("Not found", { status: 404 });
  }
  return (handler as Handler)(request);
}

const network = vi.fn(
  (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (new URL(request.url).origin !== SITE) {
      throw new Error(`A test reached for ${request.url}`);
    }
    return site(request);
  },
);

/** What an app keeps between steps. In a real one this is on its disk. */
class AppMemory implements OAuthClientProvider {
  client: unknown;
  kept: unknown;
  verifier = "";
  /** Where the app tried to send the person to say yes. */
  sentTo: URL | null = null;

  readonly redirectUrl = CALLBACK;
  readonly clientMetadata = {
    client_name: "Claude Code",
    redirect_uris: [CALLBACK],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
  clientInformation() {
    return this.client as never;
  }
  saveClientInformation(client: unknown) {
    this.client = client;
  }
  tokens() {
    return this.kept as never;
  }
  saveTokens(tokens: unknown) {
    this.kept = tokens;
  }
  redirectToAuthorization(url: URL) {
    this.sentTo = url;
  }
  saveCodeVerifier(verifier: string) {
    this.verifier = verifier;
  }
  codeVerifier() {
    return this.verifier;
  }
}

describe("connecting an app, end to end", () => {
  let handle: DbHandle;
  let owner: Caller;
  let staff: Caller;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    handle = await openEmbedded();
    useDbHandle(handle);
    for (const [name, role] of [
      ["Ash", "owner"],
      ["Sam", "staff"],
    ] as const) {
      ids[name] = newId("usr");
      await handle.db.insert(users).values({
        id: ids[name] ?? "",
        email: `${name.toLowerCase()}@example.co.nz`,
        name,
        role,
      });
    }
    const person = (name: string, role: "owner" | "staff"): Caller => ({
      actor: { type: "human", userId: ids[name] ?? "", name, role },
      via: "ui",
      confirmed: true,
    });
    owner = person("Ash", "owner");
    staff = person("Sam", "staff");
  }, 60_000);
  afterAll(async () => {
    await closeDb();
  });
  beforeEach(async () => {
    network.mockClear();
    // A back end on real records, at an address of its own.
    vi.stubEnv("BACKSTAGE_AUTH", "required");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", SITE);
    vi.stubEnv("QP_LIMITS", "on");
    await handle.db.delete(approvals);
    await handle.db.delete(connections);
    await handle.db.delete(oauthCodes);
    await handle.db.delete(oauthClients);
    await handle.db.delete(tasks);
    await handle.db.delete(rateHits);
    await handle.db.delete(auditLog);
    await handle.db.delete(events);
    await handle.db.delete(users).where(eq(users.kind, "bot"));
    await handle.db.delete(settings).where(eq(settings.key, CONNECT_KEY));
    await handle.db.delete(settings).where(eq(settings.key, SHOP_OFFER_KEY));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const open = () => execute(setConnectOn, { on: true }, owner);
  const get = (path: string, headers: Record<string, string> = {}) =>
    site(new Request(`${SITE}${path}`, { headers }));
  const post = (path: string, body: string, type: string) =>
    site(
      new Request(`${SITE}${path}`, {
        method: "POST",
        headers: { "Content-Type": type, "x-real-ip": "203.0.113.7" },
        body,
      }),
    );

  /** A person on the consent screen, saying yes to what the app asked. */
  async function sayYes(
    app: AppMemory,
    who: Caller,
    role: "viewer" | "staff",
  ): Promise<URLSearchParams> {
    const asked = app.sentTo;
    if (asked === null) throw new Error("The app sent nobody anywhere.");
    expect(`${asked.origin}${asked.pathname}`).toBe(
      `${SITE}/backstage/connect`,
    );
    const said = asked.searchParams;
    expect(said.get("response_type")).toBe("code");
    expect(said.get("code_challenge_method")).toBe("S256");
    // The app says which server it wants keys for.
    expect(said.get("resource")).toBe(MCP);
    const request = {
      clientId: said.get("client_id") ?? "",
      redirectUri: said.get("redirect_uri") ?? "",
      codeChallenge: said.get("code_challenge") ?? "",
      resource: said.get("resource"),
    };
    await execute(checkConnectRequest, request, who);
    const { code } = await execute(grantConnection, { ...request, role }, who);
    // What the consent screen sends the person back to the app with.
    return new URLSearchParams({
      code,
      ...(said.get("state") === null ? {} : { state: said.get("state") ?? "" }),
      iss: SITE,
    });
  }

  /** The whole way in. Returns a client that is connected. */
  async function connected(
    who: Caller = staff,
    role: "viewer" | "staff" = "staff",
  ): Promise<{ client: Client; app: AppMemory }> {
    const app = new AppMemory();
    const transport = () =>
      new StreamableHTTPClientTransport(new URL(MCP), {
        authProvider: app,
        fetch: network,
      });
    const first = transport();
    const knocking = new Client({ name: "claude-code", version: "1.0.0" });
    await expect(knocking.connect(first)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    await first.finishAuth(await sayYes(app, who, role));
    const client = new Client({ name: "claude-code", version: "1.0.0" });
    await client.connect(transport());
    return { client, app };
  }

  const answer = (result: { content?: unknown }): unknown => {
    const [first] = result.content as { type: string; text: string }[];
    return JSON.parse(first?.text ?? "null");
  };

  describe("while it is switched off", () => {
    it("says there is nothing here, at every address", async () => {
      for (const path of [
        "/.well-known/oauth-protected-resource",
        "/.well-known/oauth-protected-resource/api/mcp",
        "/.well-known/oauth-authorization-server",
        "/api/mcp",
      ]) {
        expect((await get(path)).status, path).toBe(404);
      }
      expect(
        (await post("/api/oauth/register", "{}", "application/json")).status,
      ).toBe(404);
      expect(
        (
          await post(
            "/api/oauth/token",
            "grant_type=refresh_token&refresh_token=x",
            "application/x-www-form-urlencoded",
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await site(
            new Request(MCP, {
              method: "POST",
              headers: { Authorization: "Bearer qpa_whatever" },
              body: "{}",
            }),
          )
        ).status,
      ).toBe(404);
    });

    it("stays that way on invented records, whatever the switch says", async () => {
      await open();
      vi.stubEnv("BACKSTAGE_AUTH", "");
      expect(
        (await get("/.well-known/oauth-authorization-server")).status,
      ).toBe(404);
      expect((await get("/api/mcp")).status).toBe(404);
    });
  });

  describe("switched on", () => {
    beforeEach(open);

    it("tells an app with no key where keys come from", async () => {
      const refused = await site(
        new Request(MCP, { method: "POST", body: "{}" }),
      );
      expect(refused.status).toBe(401);
      expect(refused.headers.get("www-authenticate")).toBe(
        `Bearer resource_metadata="${SITE}/.well-known/oauth-protected-resource", scope="backstage"`,
      );
      const bad = await site(
        new Request(MCP, {
          method: "POST",
          headers: { Authorization: `Bearer qpa_${"a".repeat(43)}` },
          body: "{}",
        }),
      );
      expect(bad.status).toBe(401);
      expect(bad.headers.get("www-authenticate")).toContain(
        'error="invalid_token"',
      );

      for (const path of [
        "/.well-known/oauth-protected-resource",
        "/.well-known/oauth-protected-resource/api/mcp",
      ]) {
        const document = await get(path);
        expect(document.headers.get("access-control-allow-origin")).toBe("*");
        expect(await document.json()).toMatchObject({
          resource: MCP,
          authorization_servers: [SITE],
        });
      }
      expect(
        await (await get("/.well-known/oauth-authorization-server")).json(),
      ).toEqual({
        issuer: SITE,
        authorization_endpoint: `${SITE}/backstage/connect`,
        token_endpoint: `${SITE}/api/oauth/token`,
        registration_endpoint: `${SITE}/api/oauth/register`,
        response_types_supported: ["code"],
        response_modes_supported: ["query"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
        scopes_supported: ["backstage", "offline_access"],
        authorization_response_iss_parameter_supported: true,
      });
    });

    it("will not be called from a page on somebody else's site", async () => {
      const from = (origin: string) =>
        site(
          new Request(MCP, {
            method: "POST",
            headers: { Origin: origin },
            body: "{}",
          }),
        );
      expect((await from("https://evil.example")).status).toBe(403);
      // Its own pages and Claude's get as far as being asked for a key.
      expect((await from(SITE)).status).toBe(401);
      expect((await from("https://claude.ai")).status).toBe(401);
    });

    it("registers an app that will be sent back to Claude or this computer, and no other", async () => {
      const register = (body: unknown) =>
        post("/api/oauth/register", JSON.stringify(body), "application/json");
      const made = await register({
        client_name: "Claude",
        redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      });
      expect(made.status).toBe(201);
      expect(await made.json()).toMatchObject({
        client_name: "Claude",
        redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
      });
      const elsewhere = await register({
        client_name: "Claude",
        redirect_uris: ["https://evil.example/callback"],
      });
      expect(elsewhere.status).toBe(400);
      expect(await elsewhere.json()).toMatchObject({
        error: "invalid_redirect_uri",
      });
      expect((await register({ client_name: "No address" })).status).toBe(400);
      expect(
        (await post("/api/oauth/register", "not json", "application/json"))
          .status,
      ).toBe(400);
      expect(await handle.db.select().from(oauthClients)).toHaveLength(1);
    });

    it("asks an address that keeps knocking to wait", async () => {
      const knock = () =>
        post(
          "/api/oauth/token",
          "grant_type=refresh_token&refresh_token=qpr_nope",
          "application/x-www-form-urlencoded",
        );
      const answers: number[] = [];
      for (let n = 0; n < 45; n += 1) answers.push((await knock()).status);
      expect(answers.slice(0, 40).every((status) => status === 400)).toBe(true);
      expect(answers.slice(40).every((status) => status === 429)).toBe(true);
    });

    it("takes a real app all the way in, and hands it three tools", async () => {
      const { client, app } = await connected(staff, "staff");
      // It registered itself, and was given keys it now holds.
      expect((app.client as { client_id: string }).client_id).toMatch(/^cli_/);
      expect(app.kept).toMatchObject({
        token_type: "Bearer",
        expires_in: ACCESS_MINUTES * 60,
        scope: "backstage",
      });
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual([
        "find",
        "look",
        "change",
      ]);
      const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
      // The app is told which may run by themselves and which to show first.
      expect(byName.find?.annotations).toMatchObject({ readOnlyHint: true });
      expect(byName.look?.annotations).toMatchObject({ readOnlyHint: true });
      expect(byName.change?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
      });
      for (const tool of tools) {
        expect(tool.title, tool.name).toBeTruthy();
        expect(tool.inputSchema.type, tool.name).toBe("object");
      }
      expect(await handle.db.select().from(connections)).toHaveLength(1);
      await client.close();
    });

    it("finds, looks and changes through those tools, as the person's bot", async () => {
      const { client } = await connected(staff, "staff");

      const found = answer(
        await client.callTool({
          name: "find",
          arguments: { query: "add a task to the to-do list" },
        }),
      ) as { found: { name: string; kind: string }[] };
      expect(found.found.map((each) => each.name)).toContain("plans.addTask");

      const described = answer(
        await client.callTool({
          name: "find",
          arguments: { names: ["plans.addTask", "orders.markPaid"] },
        }),
      ) as { operations: Record<string, unknown>[] };
      expect(described.operations[0]).toMatchObject({
        name: "plans.addTask",
        kind: "change",
        input: { type: "object", required: ["title"] },
      });
      // The system's own work is not there to be found.
      expect(described.operations[1]).toEqual({
        name: "orders.markPaid",
        error: "There is no operation by that name.",
      });

      const overview = answer(
        await client.callTool({ name: "find", arguments: {} }),
      ) as { operations: number; areas: { area: string }[] };
      expect(overview.operations).toBeGreaterThan(180);
      expect(overview.areas.map((each) => each.area)).toContain("orders");

      const changed = answer(
        await client.callTool({
          name: "change",
          arguments: {
            calls: [
              { op: "plans.addTask", input: { title: "Count the caps" } },
            ],
          },
        }),
      ) as { outcomes: { ok: boolean }[] };
      expect(changed.outcomes[0]?.ok).toBe(true);
      expect(
        (await handle.db.select().from(tasks)).map((task) => task.title),
      ).toEqual(["Count the caps"]);

      const looked = answer(
        await client.callTool({
          name: "look",
          arguments: { calls: [{ op: "plans.listTasks", input: {} }] },
        }),
      ) as { outcomes: { ok: boolean; result: unknown }[] };
      expect(JSON.stringify(looked.outcomes[0]?.result)).toContain(
        "Count the caps",
      );

      const lines = (await handle.db.select().from(auditLog)).map(
        (line) => `${line.actorName} (${line.via}): ${line.summary}`,
      );
      expect(lines.at(-1)).toBe(
        "Claude, for Sam (mcp): Added a task: Count the caps",
      );
      await client.close();
    });

    it("asks a person before anything outward, and does it only on their yes", async () => {
      const { client } = await connected(staff, "staff");
      const asked = answer(
        await client.callTool({
          name: "change",
          arguments: {
            calls: [
              { op: "shop.change", input: { prices: { "QP-SHOT-06": 3000 } } },
            ],
          },
        }),
      ) as {
        outcomes: {
          waitingForAPerson: { approval: string; decideAt: string };
        }[];
      };
      const waiting = asked.outcomes[0]?.waitingForAPerson;
      expect(waiting?.decideAt).toBe(
        `${SITE}/backstage/approvals/${waiting?.approval ?? ""}`,
      );
      expect(
        (await execute(shopOffer, {}, owner)).offer.packs[0]?.priceCents,
      ).toBe(2700);

      await approve(waiting?.approval ?? "", owner);
      expect(
        (await execute(shopOffer, {}, owner)).offer.packs[0]?.priceCents,
      ).toBe(3000);
      const seen = answer(
        await client.callTool({
          name: "look",
          arguments: {
            calls: [{ op: "approvals.get", input: { id: waiting?.approval } }],
          },
        }),
      ) as { outcomes: { result: { status: string } }[] };
      expect(seen.outcomes[0]?.result.status).toBe("done");
      await client.close();
    });

    it("lets a connection that can only look do nothing else", async () => {
      const { client } = await connected(staff, "viewer");
      const refused = await client.callTool({
        name: "change",
        arguments: {
          calls: [{ op: "plans.addTask", input: { title: "Not allowed" } }],
        },
      });
      expect(refused.isError).toBe(true);
      expect(JSON.stringify(refused.content)).toContain(
        "can look but not change things",
      );
      expect(await handle.db.select().from(tasks)).toEqual([]);
      const looked = await client.callTool({
        name: "look",
        arguments: { calls: [{ op: "shop.offer" }] },
      });
      expect(looked.isError).toBeFalsy();
      await client.close();
    });

    it("renews its own key when the hour is up, and is shut out the moment it is cut off", async () => {
      const { client, app } = await connected(staff, "staff");
      const before = (app.kept as { access_token: string }).access_token;
      // The hour passes: the key it holds is no longer good.
      await handle.db
        .update(connections)
        .set({ accessExpiresAt: new Date(Date.now() - 1000) });
      const looked = await client.callTool({
        name: "look",
        arguments: { calls: [{ op: "shop.offer" }] },
      });
      expect(looked.isError).toBeFalsy();
      const after = (app.kept as { access_token: string }).access_token;
      expect(after).not.toBe(before);

      // Cut off: its key stops, and so does renewing.
      await handle.db
        .update(connections)
        .set({ revokedAt: new Date(), revokedWhy: "Cut off by Sam." });
      // The app is told so in a word it understands: start again.
      await expect(
        client.callTool({
          name: "look",
          arguments: { calls: [{ op: "shop.offer" }] },
        }),
      ).rejects.toThrow(/no longer good/);
      await client.close().catch(() => undefined);
    });

    it("asks a connection that calls without stopping to wait", async () => {
      const { client, app } = await connected(staff, "staff");
      const [row] = await handle.db.select().from(connections);
      // Six hundred calls in ten minutes, counted the way the door counts.
      const who = callMark(row?.id ?? "");
      const door = systemCaller("The connection", "mcp");
      for (let n = 0; n < LIMITS.calls.most; n += 1) {
        await execute(countHit, { what: "calls", who }, door);
      }
      const refused = await site(
        new Request(MCP, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${(app.kept as { access_token: string }).access_token}`,
            "Content-Type": "application/json",
          },
          body: "{}",
        }),
      );
      expect(refused.status).toBe(429);
      expect(refused.headers.get("retry-after")).toBe("600");
      await client.close().catch(() => undefined);
    });

    it("answers an app that speaks the older way too", async () => {
      const { app } = await connected(staff, "staff");
      const key = (app.kept as { access_token: string }).access_token;
      const say = (body: unknown) =>
        site(
          new Request(MCP, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${key}`,
              "Content-Type": "application/json",
              Accept: "application/json, text/event-stream",
            },
            body: JSON.stringify(body),
          }),
        );
      const hello = await say({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "an older app", version: "1.0.0" },
        },
      });
      expect(hello.status).toBe(200);
      const text = await hello.text();
      expect(text).toContain("quick-pickle-back-end");
      // No session is kept: asking to end one is not a thing here.
      const end = await site(
        new Request(MCP, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${key}` },
        }),
      );
      expect(end.status).toBe(405);
    });

    it("never reached the outside world", () => {
      for (const [input] of network.mock.calls) {
        const url = input instanceof Request ? input.url : String(input);
        expect(new URL(url).origin).toBe(SITE);
      }
    });
  });
});
