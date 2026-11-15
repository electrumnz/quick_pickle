// The repository's own hands on its hosting, database and payments.
//
// Run by .github/workflows/infra.yml, never by the app. It reads four
// repository secrets from the environment and talks to three APIs:
//
//   QP_VERCEL_TOKEN            Vercel, Quick Pickle's own project only
//   QP_SUPABASE_ACCESS_TOKEN   Supabase, the Quick Pickle project only
//   QP_STRIPE_SECRET_KEY       Stripe
//
// What it does is decided one of two ways (see the workflow):
//
//   started by hand   the action and the yes come from the form
//   a push to main    "status", unless that push changed
//                     .github/infra-request.json, in which case the file
//                     says: { "actions": ["status", ...], "confirm": "yes" }
//
// Rules this file keeps:
//   - It prints names and states. It never prints a value, and anything it
//     generates is masked in the log before it is used.
//   - It is pinned to Quick Pickle's own project and team. A personal token
//     can reach every project its owner can, and another business shares the
//     owner, so nothing here lists projects or takes an id from an input.
//   - Anything that changes a setting needs a yes.

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Never to be touched, whatever a token can reach. */
const NOT_OURS = new Set(["ogayhxewacfwohxgwzuz"]);

const REQUEST_FILE = ".github/infra-request.json";

const env = process.env;

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function required(name) {
  const value = (env[name] ?? "").trim();
  if (value === "") fail(`${name} is not set.`);
  return value;
}

function mask(value) {
  // GitHub replaces a masked string with *** everywhere in the log.
  console.log(`::add-mask::${value}`);
}

/** The request file, when this push changed it. Otherwise null. */
function readRequest() {
  if ((env.INFRA_EVENT ?? "") !== "push") return null;
  if ((env.INFRA_REQUEST_CHANGED ?? "").trim() !== "true") return null;
  try {
    return JSON.parse(readFileSync(REQUEST_FILE, "utf8"));
  } catch {
    return fail(`${REQUEST_FILE} changed but is not readable JSON.`);
  }
}

/** The actions to run, in order, and whether a yes came with them. */
function whatWasAsked() {
  if ((env.INFRA_EVENT ?? "") !== "push") {
    return {
      actions: [(env.INFRA_ACTION ?? "").trim() || "status"],
      confirmed: (env.INFRA_CONFIRM ?? "").trim().toLowerCase() === "yes",
      rotate: false,
    };
  }
  const request = readRequest();
  if (request === null) {
    return { actions: ["status"], confirmed: false, rotate: false };
  }
  const list = Array.isArray(request.actions)
    ? request.actions.filter((item) => typeof item === "string")
    : [];
  return {
    actions: list.length > 0 ? list : ["status"],
    confirmed: String(request.confirm ?? "").toLowerCase() === "yes",
    rotate: request.rotate === true,
  };
}

const { actions, confirmed, rotate } = whatWasAsked();

/** Set when an action changed a setting that only a new deployment picks up. */
let changedSettings = false;
/** Set once the app's Stripe code has been proved against Stripe in this run. */
let stripeChecked = false;

const supabaseRef = required("QP_SUPABASE_PROJECT_REF");
const vercelTeam = required("QP_VERCEL_TEAM_SLUG");
const vercelProject = required("QP_VERCEL_PROJECT");

if (NOT_OURS.has(supabaseRef)) {
  fail(`${supabaseRef} is not Quick Pickle's database. Refusing to run.`);
}

/** One JSON request. Throws an error that carries the status, not the body. */
async function call(base, path, { token, method = "GET", body } = {}) {
  const headers = { Authorization: `Bearer ${token}` };
  let payload;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: payload,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text === "" ? null : JSON.parse(text);
  } catch {
    json = null;
  }
  if (!response.ok) {
    const reason =
      json?.error?.message ?? json?.message ?? json?.error?.code ?? "";
    const error = new Error(
      `${method} ${path.split("?")[0]} answered ${String(response.status)}${reason ? `: ${String(reason).slice(0, 200)}` : ""}`,
    );
    error.status = response.status;
    throw error;
  }
  return json;
}

// --- Vercel ---------------------------------------------------------------

const VERCEL = "https://api.vercel.com";

/**
 * Which team the project lives under, as the query string Vercel wants. The
 * project is pinned by id, which is unique everywhere, so trying the team by
 * its slug, then by its id, then the token's own account can only ever find
 * that one project. It is worked out once.
 */
let vercelScope = null;

async function resolveVercelScope() {
  if (vercelScope !== null) return vercelScope;
  const candidates = [`slug=${encodeURIComponent(vercelTeam)}`];
  const teamId = (env.QP_VERCEL_TEAM_ID ?? "").trim();
  if (teamId !== "") candidates.push(`teamId=${encodeURIComponent(teamId)}`);
  candidates.push("");
  let lastError = null;
  for (const scope of candidates) {
    try {
      const project = await call(
        VERCEL,
        `/v9/projects/${vercelProject}${scope === "" ? "" : `?${scope}`}`,
        { token: required("QP_VERCEL_TOKEN") },
      );
      if (project?.id === vercelProject) {
        vercelScope = scope;
        return scope;
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw (
    lastError ??
    new Error("The Vercel project could not be found with this token.")
  );
}

async function vercel(path, options = {}) {
  const scope = await resolveVercelScope();
  const joiner = path.includes("?") ? "&" : "?";
  return call(VERCEL, scope === "" ? path : `${path}${joiner}${scope}`, {
    token: required("QP_VERCEL_TOKEN"),
    ...options,
  });
}

async function vercelEnvNames() {
  const result = await vercel(`/v10/projects/${vercelProject}/env`);
  const list = Array.isArray(result?.envs) ? result.envs : [];
  return list.map((item) => ({
    key: String(item.key),
    targets: Array.isArray(item.target) ? item.target : [item.target],
    type: String(item.type ?? ""),
  }));
}

function hasInProduction(names, key) {
  return names.some(
    (item) => item.key === key && item.targets.includes("production"),
  );
}

async function vercelStatus() {
  console.log("Vercel");
  const project = await vercel(`/v9/projects/${vercelProject}`);
  if (project?.id !== vercelProject) {
    fail(`Vercel answered with a different project. Refusing to go on.`);
  }
  console.log(
    `  project "${String(project.name)}", framework ${String(project.framework)}, node ${String(project.nodeVersion)}`,
  );
  const domains = await vercel(`/v9/projects/${vercelProject}/domains`);
  for (const domain of domains?.domains ?? []) {
    console.log(
      `  address ${String(domain.name)}${domain.verified === false ? " (not verified)" : ""}`,
    );
  }
  console.log(
    `  follows ${String(project.link?.type ?? "no git link")} ${String(project.link?.org ?? "")}/${String(project.link?.repo ?? "")}, production branch ${String(project.link?.productionBranch ?? "?")}`,
  );

  const deployments = await vercel(
    `/v6/deployments?projectId=${encodeURIComponent(project.id)}&limit=6`,
  );
  for (const item of deployments?.deployments ?? []) {
    const when = new Date(item.created).toISOString().slice(0, 16);
    const sha = String(item.meta?.githubCommitSha ?? "").slice(0, 7);
    const ref = String(item.meta?.githubCommitRef ?? "");
    console.log(
      `  ${String(item.target ?? "preview").padEnd(10)} ${String(item.state ?? item.readyState).padEnd(9)} ${when}  ${sha} ${ref}`,
    );
  }

  const names = await vercelEnvNames();
  console.log(`  environment variables (names only): ${String(names.length)}`);
  for (const item of names.sort((a, b) => a.key.localeCompare(b.key))) {
    console.log(`    ${item.key}  [${item.targets.join(", ")}]  ${item.type}`);
  }

  const database =
    hasInProduction(names, "DATABASE_URL") ||
    hasInProduction(names, "POSTGRES_URL");
  console.log(
    `  database url in production: ${database ? "yes" : "NO. The back end is running on demo data."}`,
  );
  console.log(
    `  BACKSTAGE_SETUP_CODE in production: ${hasInProduction(names, "BACKSTAGE_SETUP_CODE") ? "yes" : "NO"}`,
  );
  // What sending email needs (lib/mail). Names only, as everywhere here.
  const mailMissing = ["MAIL_PROVIDER", "RESEND_API_KEY", "MAIL_FROM"].filter(
    (key) => !hasInProduction(names, key),
  );
  console.log(
    `  order emails in production: ${mailMissing.length === 0 ? "the settings are there" : `NOT connected. Missing: ${mailMissing.join(", ")}`}`,
  );
  // What the inbox needs to hear from Resend (lib/backstage/mail/config.ts):
  // mail received for us, and bounces and complaints about mail we sent.
  console.log(
    `  bounces and incoming mail in production: ${hasInProduction(names, "RESEND_WEBHOOK_SECRET") ? "the signing secret is there" : "NOT heard. Missing: RESEND_WEBHOOK_SECRET"}`,
  );
  console.log(
    `  reply addresses of their own: ${hasInProduction(names, "MAIL_TOKEN_SECRET") ? "MAIL_TOKEN_SECRET is there" : "off (MAIL_TOKEN_SECRET is not set), so replies come to MAIL_FROM"}`,
  );
}

// --- Supabase -------------------------------------------------------------

const SUPABASE = "https://api.supabase.com";

function supabase(path, options = {}) {
  return call(SUPABASE, path, {
    token: required("QP_SUPABASE_ACCESS_TOKEN"),
    ...options,
  });
}

function readOnlyQuery(query) {
  return supabase(`/v1/projects/${supabaseRef}/database/query/read-only`, {
    method: "POST",
    body: { query },
  });
}

async function supabaseStatus() {
  console.log("Supabase");
  const project = await supabase(`/v1/projects/${supabaseRef}`);
  console.log(
    `  project "${String(project.name)}", region ${String(project.region)}, status ${String(project.status)}, postgres ${String(project.database?.version ?? "?")}`,
  );

  const tables = await readOnlyQuery(
    "select c.relname as name, c.relrowsecurity as rls, pg_catalog.pg_get_userbyid(c.relowner) as owner from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by c.relname",
  );
  const rows = Array.isArray(tables) ? tables : [];
  console.log(`  tables in public: ${String(rows.length)}`);
  const open = rows.filter((row) => row.rls !== true);
  if (open.length > 0) {
    console.log(
      `  WITHOUT row level security: ${open.map((row) => row.name).join(", ")}`,
    );
  }
  const owners = [...new Set(rows.map((row) => String(row.owner)))];
  if (owners.length > 0) console.log(`  owned by: ${owners.join(", ")}`);

  const roles = await readOnlyQuery(
    `select count(*)::int as n from pg_catalog.pg_roles where rolname = '${APP_ROLE}'`,
  );
  console.log(
    `  the app's own login (${APP_ROLE}): ${Array.isArray(roles) && roles[0]?.n === 1 ? "exists" : "not made yet"}`,
  );

  if (rows.some((row) => row.name === "qp_migrations")) {
    const applied = await readOnlyQuery(
      "select tag, applied_at from public.qp_migrations order by tag",
    );
    for (const row of Array.isArray(applied) ? applied : []) {
      console.log(
        `  migration ${String(row.tag)} applied ${String(row.applied_at).slice(0, 16)}`,
      );
    }
    const counts = await readOnlyQuery(
      "select (select count(*) from public.users) as users, (select count(*) from public.orders) as orders, (select count(*) from public.customers) as customers",
    );
    const first = Array.isArray(counts) ? counts[0] : null;
    if (first) {
      console.log(
        `  staff logins ${String(first.users)}, orders ${String(first.orders)}, customers ${String(first.customers)}`,
      );
    }
    // The shop's own settings: which kinds of thing have been changed from
    // the catalogue file, and which open facts an owner has confirmed.
    // Names only, never a figure or an address.
    const shop = await readOnlyQuery(
      "select value from public.settings where key = 'shop.offer'",
    );
    const kept = Array.isArray(shop) ? shop[0]?.value : null;
    const settings = typeof kept === "string" ? JSON.parse(kept) : (kept ?? {});
    const changed = Object.keys(settings).filter((key) => key !== "confirmed");
    console.log(
      `  the shop: ${settings.open === false ? "NOT taking orders" : "taking orders"}; changed from the catalogue: ${changed.length === 0 ? "nothing" : changed.join(", ")}; facts confirmed: ${Object.keys(settings.confirmed ?? {}).join(", ") || "none"}`,
    );
    // The connection for Claude: whether an owner has switched it on, how
    // many are connected and how much is waiting for a person's yes. Counts
    // only. Its tables arrive with the first deployment that has them.
    try {
      const door = await readOnlyQuery(
        "select (select value->>'on' from public.settings where key = 'connect.claude') as open, (select count(*)::int from public.connections where revoked_at is null and refresh_expires_at > now()) as connected, (select count(*)::int from public.approvals where status = 'waiting') as waiting",
      );
      const claude = Array.isArray(door) ? door[0] : null;
      if (claude) {
        console.log(
          `  Claude: ${claude.open === "true" ? "can be connected" : "switched off"}; connections working: ${String(claude.connected)}; waiting for a yes: ${String(claude.waiting)}`,
        );
      }
    } catch {
      console.log(
        "  Claude: not there yet (its tables are not in this database)",
      );
    }
    // Counts only, by state. Never a name, an address or an order number.
    const byState = await readOnlyQuery(
      "select status, payment_status, is_test, count(*)::int as n from public.orders group by 1, 2, 3 order by 1, 2, 3",
    );
    for (const row of Array.isArray(byState) ? byState : []) {
      console.log(
        `    orders ${String(row.status)} / ${String(row.payment_status)}${row.is_test ? " (test)" : ""}: ${String(row.n)}`,
      );
    }
    const queue = await readOnlyQuery(
      "select type, count(*)::int as n, count(*) filter (where processed_at is null)::int as waiting, coalesce(max(attempts), 0)::int as most_tries from public.events group by 1 order by 1",
    );
    for (const row of Array.isArray(queue) ? queue : []) {
      console.log(
        `    events ${String(row.type)}: ${String(row.n)}${row.waiting > 0 ? `, ${String(row.waiting)} waiting (most tries ${String(row.most_tries)})` : ""}`,
      );
    }
    // Emails by state. Counts only: never an address or a subject.
    const mail = await readOnlyQuery(
      "select direction, status, count(*)::int as n from public.mail_messages group by 1, 2 order by 1, 2",
    );
    for (const row of Array.isArray(mail) ? mail : []) {
      console.log(
        `    emails ${row.direction === "out" ? "out" : "in"} / ${String(row.status)}: ${String(row.n)}`,
      );
    }
    // The inbox, by whose turn it is, and the do-not-email list by reason.
    const talk = await readOnlyQuery(
      "select status, count(*)::int as n from public.mail_conversations group by 1 order by 1",
    );
    for (const row of Array.isArray(talk) ? talk : []) {
      console.log(`    conversations ${String(row.status)}: ${String(row.n)}`);
    }
    const stopped = await readOnlyQuery(
      "select reason, count(*)::int as n from public.mail_suppressions group by 1 order by 1",
    );
    for (const row of Array.isArray(stopped) ? stopped : []) {
      console.log(`    do not email (${String(row.reason)}): ${String(row.n)}`);
    }
    await clockStatus();
  } else {
    console.log(
      "  the app has not connected yet (no qp_migrations table). It makes its own tables the first time it does.",
    );
  }
}

// --- Stripe ---------------------------------------------------------------

const STRIPE = "https://api.stripe.com";

async function stripeStatus() {
  console.log("Stripe");
  const key = required("QP_STRIPE_SECRET_KEY");
  const mode = key.startsWith("sk_test_")
    ? "test"
    : key.startsWith("sk_live_")
      ? "LIVE"
      : key.startsWith("rk_")
        ? "restricted key"
        : "unrecognised key";
  const account = await call(STRIPE, "/v1/account", { token: key });
  console.log(
    `  ${mode} key, account country ${String(account.country)}, currency ${String(account.default_currency)}, charges ${account.charges_enabled ? "enabled" : "not enabled yet"}, details ${account.details_submitted ? "submitted" : "not submitted yet"}`,
  );
  const hooks = await call(STRIPE, "/v1/webhook_endpoints?limit=20", {
    token: key,
  });
  const list = Array.isArray(hooks?.data) ? hooks.data : [];
  console.log(`  webhook endpoints: ${String(list.length)}`);
  for (const hook of list) {
    let host = "?";
    try {
      host = new URL(hook.url).host;
    } catch {
      host = "?";
    }
    const sends = Array.isArray(hook.enabled_events) ? hook.enabled_events : [];
    const missing = STRIPE_EVENTS.filter((type) => !sends.includes(type));
    console.log(
      `    ${String(hook.status)} ${host} (${String(sends.length)} events)${missing.length === 0 ? "" : `, NOT sending: ${missing.join(", ")}. Run stripe-events.`}`,
    );
  }
  const publishable = (env.QP_STRIPE_PUBLISHABLE_KEY ?? "").trim();
  console.log(
    `  publishable key: ${publishable === "" ? "missing" : publishable.startsWith("pk_test_") ? "test" : publishable.startsWith("pk_live_") ? "LIVE" : "unrecognised"}`,
  );

  // Is Stripe's news getting through? An event still "to deliver" long after
  // it happened means the site is not answering Stripe properly.
  const recent = await call(
    STRIPE,
    `/v1/events?limit=100&created[gte]=${String(Math.floor(Date.now() / 1000) - 24 * 3600)}`,
    { token: key },
  );
  const tally = new Map();
  for (const event of Array.isArray(recent?.data) ? recent.data : []) {
    if (!STRIPE_EVENTS.includes(event.type)) continue;
    const row = tally.get(event.type) ?? { n: 0, undelivered: 0 };
    row.n += 1;
    if ((event.pending_webhooks ?? 0) > 0) row.undelivered += 1;
    tally.set(event.type, row);
  }
  if (tally.size === 0) {
    console.log("  payment news in the last day: none");
  }
  for (const [type, row] of tally) {
    console.log(
      `  last day, ${type}: ${String(row.n)}${row.undelivered > 0 ? `, ${String(row.undelivered)} NOT delivered yet` : ", all delivered"}`,
    );
  }
}

// --- Actions ---------------------------------------------------------------

/**
 * What is where. Changes nothing. A section that cannot be read says so and
 * the others still run; it never stops the actions after it.
 */
async function status() {
  for (const section of [vercelStatus, supabaseStatus, stripeStatus]) {
    try {
      await section();
    } catch (error) {
      console.log(`  ✗ ${error instanceof Error ? error.message : "failed"}`);
    }
    console.log("");
  }
}

/**
 * The code that lets the first owner make their login at /backstage/set-up.
 * Made once, kept in Vercel where the account owner can read it (Settings,
 * Environment Variables), and never shown here.
 */
async function ensureSetupCode() {
  const names = await vercelEnvNames();
  if (hasInProduction(names, "BACKSTAGE_SETUP_CODE")) {
    console.log(
      "BACKSTAGE_SETUP_CODE is already set for production. Left alone.",
    );
    return;
  }
  if (!confirmed) fail('This changes a setting. Ask again with confirm "yes".');
  const code = randomBytes(18).toString("base64url");
  mask(code);
  await vercel(`/v10/projects/${vercelProject}/env`, {
    method: "POST",
    body: {
      key: "BACKSTAGE_SETUP_CODE",
      value: code,
      type: "encrypted",
      target: ["production"],
      comment:
        "Typed once at /backstage/set-up to make the first owner login. Made by the infra workflow.",
    },
  });
  console.log(
    "  BACKSTAGE_SETUP_CODE made and saved for production. Read it in Vercel: Settings, Environment Variables.",
  );
  changedSettings = true;
}

// --- The database login ---------------------------------------------------

const APP_ROLE = "qp_app";

/**
 * Gives production a database.
 *
 * Makes the app its own login on Quick Pickle's Postgres (not the
 * all-powerful one the dashboard uses), proves that login works through the
 * pooler from here, and only then saves the connection string as
 * DATABASE_URL for production. The password is made here, masked, and never
 * shown. To replace it, ask again with "rotate": true.
 *
 * The app creates its own tables the first time it connects, so it owns them,
 * and row level security (on for every table) shuts everyone else out.
 */
async function connectDatabase() {
  const names = await vercelEnvNames();
  const already =
    hasInProduction(names, "DATABASE_URL") ||
    hasInProduction(names, "POSTGRES_URL");
  if (already && !rotate) {
    console.log("Production already has a database url. Left alone.");
    return;
  }
  if (!confirmed) fail('This changes settings. Ask again with confirm "yes".');

  const pooler = await supabase(
    `/v1/projects/${supabaseRef}/config/database/pooler`,
  );
  const entries = Array.isArray(pooler) ? pooler : [pooler];
  const primary =
    entries.find((item) => item?.database_type === "PRIMARY") ?? entries[0];
  const host = String(primary?.db_host ?? "");
  if (!/^[a-z0-9.-]+\.supabase\.com$/.test(host)) {
    fail(
      `Could not read the pooler's address from Supabase (fields: ${Object.keys(primary ?? {}).join(", ")}).`,
    );
  }
  console.log(`  pooler found (${String(primary?.pool_mode ?? "?")} mode)`);

  const password = randomBytes(30).toString("base64url");
  mask(password);

  // One statement at a time, so a failure says which.
  const statements = [
    `do $do$ begin if not exists (select 1 from pg_catalog.pg_roles where rolname = '${APP_ROLE}') then create role ${APP_ROLE} login; end if; end $do$`,
    `alter role ${APP_ROLE} with login password '${password}'`,
    `grant usage, create on schema public to ${APP_ROLE}`,
    `alter role ${APP_ROLE} set search_path to public`,
  ];
  for (const [index, query] of statements.entries()) {
    try {
      await supabase(`/v1/projects/${supabaseRef}/database/query`, {
        method: "POST",
        body: { query },
      });
    } catch (error) {
      fail(
        `Setting up the database login failed at step ${String(index + 1)} of ${String(statements.length)}: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }
  // So the dashboard's own login can look after what the app owns. Handy,
  // not essential: the app works without it.
  try {
    await supabase(`/v1/projects/${supabaseRef}/database/query`, {
      method: "POST",
      body: { query: `grant ${APP_ROLE} to postgres` },
    });
  } catch (error) {
    console.log(
      `  (could not let the dashboard's login manage the app's tables: ${error instanceof Error ? error.message : "unknown"})`,
    );
  }
  console.log(`  login "${APP_ROLE}" is ready`);

  // Port 6543 is the pooler's transaction mode: right for short-lived
  // serverless functions. base64url needs no escaping in a URL.
  const url = `postgresql://${APP_ROLE}.${supabaseRef}:${password}@${host}:6543/postgres`;
  mask(url);
  await proveConnection(url);

  await vercel(`/v10/projects/${vercelProject}/env?upsert=true`, {
    method: "POST",
    body: {
      key: "DATABASE_URL",
      value: url,
      type: "sensitive",
      target: ["production"],
      comment: `The app's own database login (${APP_ROLE}), through the pooler. Made by the infra workflow.`,
    },
  });
  console.log("  DATABASE_URL saved for production.");
  changedSettings = true;
}

/** Connect for real, as the app will, before anything is told to use it. */
async function proveConnection(url) {
  const version = JSON.parse(readFileSync("package.json", "utf8")).dependencies
    ?.pg;
  if (typeof version !== "string") fail("package.json does not name pg.");
  const dir = mkdtempSync(join(tmpdir(), "qp-infra-"));
  execFileSync(
    "npm",
    [
      "install",
      "--no-save",
      "--no-package-lock",
      "--no-audit",
      "--no-fund",
      "--prefix",
      dir,
      `pg@${version}`,
    ],
    { stdio: "ignore" },
  );
  const { Client } = createRequire(join(dir, "package.json"))("pg");

  let lastError = "no attempt made";
  // A login made a moment ago can take a few seconds to reach the pooler.
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const client = new Client({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10_000,
    });
    // An error on an idle connection must not end the process.
    client.on("error", () => undefined);
    try {
      await client.connect();
      const result = await client.query(
        "select current_user as who, has_schema_privilege(current_user, 'public', 'CREATE') as can_create",
      );
      const row = result.rows[0];
      if (row?.who !== APP_ROLE || row?.can_create !== true) {
        fail("Connected, but not as the app's login with the rights it needs.");
      }
      console.log(
        `  connected through the pooler as "${APP_ROLE}" (attempt ${String(attempt)})`,
      );
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "unknown";
      await new Promise((resolve) => setTimeout(resolve, 4000));
    } finally {
      await client.end().catch(() => undefined);
    }
  }
  fail(
    `The new login could not connect through the pooler, so nothing was saved to Vercel. Last error: ${lastError.slice(0, 200)}`,
  );
}

// --- Deploying --------------------------------------------------------------

/**
 * Builds production again from the newest commit on its branch, so settings
 * changed a moment ago take effect. Does nothing unless something changed.
 */
async function redeployIfChanged() {
  if (!changedSettings) {
    console.log("Nothing was changed, so nothing needs building again.");
    return;
  }
  const project = await vercel(`/v9/projects/${vercelProject}`);
  const list = await vercel(
    `/v6/deployments?projectId=${encodeURIComponent(project.id)}&target=production&limit=5`,
  );
  const latest = (list?.deployments ?? [])[0];
  if (!latest?.uid) fail("No production deployment to build again.");
  const created = await vercel(`/v13/deployments?forceNew=1`, {
    method: "POST",
    body: {
      name: String(project.name),
      project: String(project.id),
      deploymentId: latest.uid,
      target: "production",
      withLatestCommit: true,
    },
  });
  console.log(
    `  production is building again (${String(created?.readyState ?? created?.status ?? "started")}).`,
  );
}

// --- Stripe ------------------------------------------------------------------

/**
 * The kinds of news the site acts on (lib/shop/payments/stripe-events.ts).
 * Add one here when the site learns to act on it, and run "stripe-events":
 * an endpoint made by an earlier run only sends what was asked for then.
 */
const STRIPE_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  // A refund, from the back end or from Stripe's own dashboard.
  "charge.refunded",
  // A refund that changed after it was made: above all one that left and
  // then failed, because the card it was going to has been closed.
  "refund.updated",
  "refund.failed",
  // A card dispute: opened, moved along, decided.
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
];

/** One form-encoded request to Stripe, the way the app makes them. */
async function stripeCall(key, method, path, form) {
  const { stripeForm } = await import("../../lib/shop/payments/stripe.ts");
  const response = await fetch(`${STRIPE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(form === undefined
        ? {}
        : { "Content-Type": "application/x-www-form-urlencoded" }),
    },
    body: form === undefined ? undefined : stripeForm(form),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  if (!response.ok) {
    throw new Error(
      `${method} ${path.split("?")[0]} answered ${String(response.status)}: ${String(json?.error?.message ?? "").slice(0, 200)}`,
    );
  }
  return json;
}

/**
 * Proves the app's own Stripe code against the real Stripe, in test mode:
 * makes a payment page for a made-up order with the same function the
 * checkout uses, checks what came back, and closes the page again. No money
 * can move: it refuses to run with anything but a test key.
 */
async function stripeCheck() {
  const key = required("QP_STRIPE_SECRET_KEY");
  if (!key.startsWith("sk_test_")) {
    fail("The Stripe check only ever runs with a test key.");
  }
  const { createCheckoutSession, retrieveCheckoutSession, paymentPageLook } =
    await import("../../lib/shop/payments/stripe.ts");
  const { hexOf } = await import("../../lib/brand/colours.ts");
  // The same look the shop asks for, so Stripe gets to refuse it here first.
  const look = paymentPageLook(hexOf, "Quick Pickle");
  const keysUsed = [];
  const watched = (url, init) => {
    const used = init?.headers?.["Idempotency-Key"];
    if (typeof used === "string") keysUsed.push(used);
    return fetch(url, init);
  };
  // One clock reading: the page's closing time is part of what is asked for.
  const now = new Date();
  const number = "QP-TESTZZ";
  const request = {
    // A new page each run: the order number is the idempotency key.
    orderNumber: `${number.slice(0, 3)}${randomBytes(4)
      .toString("hex")
      .toUpperCase()
      .replace(/[01ILOU]/g, "Z")
      .slice(0, 6)}`,
    amountCents: 8850,
    currency: "NZD",
    email: "check@example.co.nz",
    lines: [{ name: "The Squad", qty: 1, unitCents: 8400 }],
    shippingCents: 450,
    discountCents: 0,
    discountLabel: "",
    successUrl: "https://quickpickle.vercel.app/order/thanks",
    cancelUrl: "https://quickpickle.vercel.app/checkout?payment=cancelled",
  };
  const session = await createCheckoutSession(key, request, now, watched, look);
  // The app asks again without a setting Stripe refuses, and the key it
  // used last says which ones it had to leave out.
  const leftOut = (keysUsed.at(-1) ?? "").split("-no-")[1] ?? "";
  console.log(
    leftOut === ""
      ? "  ok   NZ dollars only, in the shop's colours"
      : `  NOTE Stripe would not take: ${leftOut}. The page works without it.`,
  );
  const checks = [
    [
      "has an id",
      typeof session.id === "string" && session.id.startsWith("cs_test_"),
    ],
    [
      "has a payment page",
      typeof session.url === "string" && session.url.startsWith("https://"),
    ],
    ["totals 8850 cents", session.amount_total === 8850],
    ["is in NZD", session.currency === "nzd"],
    [
      "carries the order number",
      session.client_reference_id === request.orderNumber,
    ],
    [
      "is open and unpaid",
      session.status === "open" && session.payment_status === "unpaid",
    ],
  ];
  for (const [label, ok] of checks)
    console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`);

  const again = await createCheckoutSession(key, request, now, watched, look);
  console.log(
    `  ${again.id === session.id ? "ok  " : "FAIL"} asking twice gives the same page`,
  );
  const read = await retrieveCheckoutSession(key, session.id);
  console.log(`  ${read.id === session.id ? "ok  " : "FAIL"} can be read back`);

  await stripeCall(
    key,
    "POST",
    `/v1/checkout/sessions/${session.id}/expire`,
    {},
  );
  const closed = await retrieveCheckoutSession(key, session.id);
  console.log(
    `  ${closed.status === "expired" ? "ok  " : "FAIL"} closed again`,
  );

  // An order with a promo code: the saving goes to Stripe as a one-off
  // coupon, and the page has to come to the discounted total exactly.
  const withCode = {
    ...request,
    orderNumber: `${request.orderNumber.slice(0, 8)}D`,
    amountCents: 8010,
    discountCents: 840,
    discountLabel: "Code CHECK10",
  };
  const discounted = await createCheckoutSession(
    key,
    withCode,
    now,
    watched,
    look,
  );
  const cameOff = discounted.total_details?.amount_discount;
  const codeOk =
    discounted.amount_total === 8010 &&
    discounted.currency === "nzd" &&
    cameOff === 840;
  console.log(
    `  ${codeOk ? "ok  " : "FAIL"} a code's saving comes off (total ${String(discounted.amount_total)}, ${String(cameOff)} off)`,
  );
  await stripeCall(
    key,
    "POST",
    `/v1/checkout/sessions/${discounted.id}/expire`,
    {},
  );

  if (
    checks.some(([, ok]) => !ok) ||
    again.id !== session.id ||
    read.id !== session.id ||
    closed.status !== "expired" ||
    !codeOk
  ) {
    fail("The Stripe check did not pass. Nothing was changed.");
  }
  stripeChecked = true;
}

/** The address the public reaches the site at. */
async function productionHost() {
  const domains = await vercel(`/v9/projects/${vercelProject}/domains`);
  const host = (domains?.domains ?? []).find(
    (domain) => domain.verified !== false,
  )?.name;
  if (typeof host !== "string" || !/^[a-z0-9.-]+$/.test(host)) {
    fail("Could not find the site's address.");
  }
  return host;
}

/**
 * Switches production's checkout from "practice" to Stripe.
 *
 * Saves the secret key, tells Stripe where to send its word that a payment
 * was made (and keeps the signing secret Stripe gives back, which is shown
 * once and never printed here), and names Stripe as the payment provider.
 * With a test key that means Stripe's test mode: its real payment page, no
 * real money. It will not run unless the check above passed in the same run.
 */
async function connectStripe() {
  if (!confirmed) fail('This changes settings. Ask again with confirm "yes".');
  if (!stripeChecked) {
    fail('Run "stripe-check" before "connect-stripe" in the same request.');
  }
  const key = required("QP_STRIPE_SECRET_KEY");
  const names = await vercelEnvNames();
  const have = (name) => hasInProduction(names, name);
  if (
    have("STRIPE_SECRET_KEY") &&
    have("STRIPE_WEBHOOK_SECRET") &&
    have("PAYMENT_PROVIDER") &&
    !rotate
  ) {
    console.log("Production is already set up for Stripe. Left alone.");
    return;
  }

  const host = await productionHost();
  const url = `https://${host}/api/stripe/webhook`;

  // The signing secret is only shown when an endpoint is made, so an
  // endpoint of ours from an earlier run is replaced, not reused.
  const existing = await stripeCall(
    key,
    "GET",
    "/v1/webhook_endpoints?limit=100",
  );
  for (const hook of existing?.data ?? []) {
    if (hook.url === url) {
      await stripeCall(key, "DELETE", `/v1/webhook_endpoints/${hook.id}`);
      console.log("  replaced the webhook endpoint from an earlier run");
    }
  }
  const made = await stripeCall(key, "POST", "/v1/webhook_endpoints", {
    url,
    enabled_events: STRIPE_EVENTS,
    description: "Quick Pickle: marks an order paid, or closes it unpaid.",
  });
  if (typeof made?.secret !== "string" || !made.secret.startsWith("whsec_")) {
    fail("Stripe did not give back a signing secret.");
  }
  mask(made.secret);
  console.log(`  Stripe will send payment news to ${host}`);

  const save = (name, value, type) =>
    vercel(`/v10/projects/${vercelProject}/env?upsert=true`, {
      method: "POST",
      body: { key: name, value, type, target: ["production"] },
    });
  await save("STRIPE_SECRET_KEY", key, "sensitive");
  await save("STRIPE_WEBHOOK_SECRET", made.secret, "sensitive");
  await save("PAYMENT_PROVIDER", "stripe", "plain");
  console.log(
    `  production will take payments through Stripe (${key.startsWith("sk_test_") ? "test mode: no real money" : "LIVE"}).`,
  );
  changedSettings = true;
}

/**
 * Makes Stripe send exactly the kinds of news the site acts on.
 *
 * The list grows with the app, and an endpoint made by an earlier run only
 * sends what was asked for then. This changes the list on the endpoint that
 * is already there, so its signing secret stays as it is and nothing needs
 * building again.
 */
async function stripeEvents() {
  const key = required("QP_STRIPE_SECRET_KEY");
  const host = await productionHost();
  const url = `https://${host}/api/stripe/webhook`;
  const existing = await stripeCall(
    key,
    "GET",
    "/v1/webhook_endpoints?limit=100",
  );
  const hook = (existing?.data ?? []).find((each) => each.url === url);
  if (hook === undefined) {
    fail("Stripe has no webhook endpoint for the site. Run connect-stripe.");
  }
  const sends = [...(hook.enabled_events ?? [])].sort();
  const wanted = [...STRIPE_EVENTS].sort();
  if (JSON.stringify(sends) === JSON.stringify(wanted)) {
    console.log(
      "  Stripe already sends exactly what the site acts on. Left alone.",
    );
    return;
  }
  if (!confirmed) {
    fail('This changes what Stripe sends. Ask again with confirm "yes".');
  }
  const changed = await stripeCall(
    key,
    "POST",
    `/v1/webhook_endpoints/${hook.id}`,
    { enabled_events: STRIPE_EVENTS },
  );
  const now = Array.isArray(changed?.enabled_events)
    ? changed.enabled_events
    : [];
  const missing = STRIPE_EVENTS.filter((type) => !now.includes(type));
  if (missing.length > 0) {
    fail(`Stripe did not take: ${missing.join(", ")}.`);
  }
  console.log(`  Stripe now sends: ${STRIPE_EVENTS.join(", ")}`);
}

/** Back to the practice checkout: orders recorded, nobody sent to pay. */
async function disconnectStripe() {
  if (!confirmed) fail('This changes settings. Ask again with confirm "yes".');
  await vercel(`/v10/projects/${vercelProject}/env?upsert=true`, {
    method: "POST",
    body: {
      key: "PAYMENT_PROVIDER",
      value: "test",
      type: "plain",
      target: ["production"],
    },
  });
  console.log("  production is back on the practice checkout.");
  changedSettings = true;
}

// --- The checkout's limit ------------------------------------------------------

/**
 * The checkout counts how often one internet address asks it things
 * (lib/shop/limit.ts) whenever production has a database. These two are the
 * off switch and the way back. A ceiling can refuse a real buyer: put the
 * site behind something that makes every visitor look like one address and
 * it would, so stopping it must never wait for a change to the code. Follow
 * either with "redeploy". The go-live list in the back end says which it is.
 */
async function setLimits(value, said) {
  if (!confirmed) fail('This changes a setting. Ask again with confirm "yes".');
  await vercel(`/v10/projects/${vercelProject}/env?upsert=true`, {
    method: "POST",
    body: {
      key: "QP_LIMITS",
      value,
      type: "plain",
      target: ["production"],
      comment:
        'The checkout\'s limit on asks from one address. "off" stops it; anything else leaves it to run. Set by the infra workflow.',
    },
  });
  console.log(`  ${said}`);
  changedSettings = true;
}

const limitsOff = () =>
  setLimits("off", "the checkout's limit is switched off for production.");
const limitsOn = () =>
  setLimits("auto", "the checkout's limit is back on for production.");

// --- The clock --------------------------------------------------------------

const CLOCK_JOB = "qp-tick";
const CLOCK_TIDY_JOB = "qp-tick-tidy";
const CLOCK_SECRET = "qp_tick_secret";

function writeQuery(query) {
  return supabase(`/v1/projects/${supabaseRef}/database/query`, {
    method: "POST",
    body: { query },
  });
}

/**
 * Gives the back end a clock.
 *
 * The database's own scheduler (pg_cron) asks the site's /api/tick every
 * five minutes (pg_net), with a secret only the two of them hold: it is made
 * here, kept in the database's vault and in production's settings, and
 * never printed. The scheduler lives with the database rather than the host,
 * so it carries on whoever hosts the site.
 *
 * Running it again makes a new secret in both places. Until the redeploy
 * that follows has finished, the site turns the clock away; nothing is lost,
 * the next tick does the work.
 */
async function connectClock() {
  if (!confirmed) fail('This changes settings. Ask again with confirm "yes".');

  const offered = await readOnlyQuery(
    "select name, installed_version is not null as installed from pg_catalog.pg_available_extensions where name in ('pg_cron', 'pg_net', 'supabase_vault')",
  );
  const installed = new Map(
    (Array.isArray(offered) ? offered : []).map((row) => [
      String(row.name),
      row.installed === true,
    ]),
  );
  for (const needed of ["pg_cron", "pg_net", "supabase_vault"]) {
    if (!installed.has(needed)) {
      fail(`This database does not offer ${needed}.`);
    }
  }
  // Only what is not already on is switched on.
  const switchOn = [
    [
      "pg_cron",
      "switch the scheduler on",
      "create extension if not exists pg_cron with schema pg_catalog",
    ],
    [
      "pg_net",
      "switch outgoing requests on",
      "create extension if not exists pg_net",
    ],
    [
      "supabase_vault",
      "switch the vault on",
      "create extension if not exists supabase_vault",
    ],
  ]
    .filter(([name]) => installed.get(name) !== true)
    .map(([, what, query]) => [what, query]);

  const host = await productionHost();
  const secret = randomBytes(32).toString("hex");
  mask(secret);

  // One step at a time, so a failure says which. A failure's own message is
  // not printed: one of these statements carries the secret.
  const steps = [
    ...switchOn,
    [
      "keep the secret in the vault",
      `do $do$ declare found uuid; begin select id into found from vault.secrets where name = '${CLOCK_SECRET}'; if found is null then perform vault.create_secret('${secret}', '${CLOCK_SECRET}', 'What the database says to the site when it rings the clock.'); else perform vault.update_secret(found, '${secret}'); end if; end $do$`,
    ],
    [
      "set the clock going",
      `select cron.schedule('${CLOCK_JOB}', '*/5 * * * *', $job$select net.http_get(url := 'https://${host}/api/tick', headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = '${CLOCK_SECRET}')), timeout_milliseconds := 55000)$job$)`,
    ],
    [
      "keep the scheduler's own history short",
      `select cron.schedule('${CLOCK_TIDY_JOB}', '17 3 * * *', $job$delete from cron.job_run_details where end_time < now() - interval '3 days'$job$)`,
    ],
  ];
  for (const [what, query] of steps) {
    try {
      await writeQuery(query);
    } catch (error) {
      // The reason is said for every step but the one that holds the secret.
      const why =
        what.includes("secret") || !(error instanceof Error)
          ? ""
          : ` (${error.message.slice(0, 200)})`;
      fail(`Setting up the clock failed where it tried to ${what}.${why}`);
    }
    console.log(`  ok   ${what}`);
  }

  await vercel(`/v10/projects/${vercelProject}/env?upsert=true`, {
    method: "POST",
    body: {
      key: "CRON_SECRET",
      value: secret,
      type: "sensitive",
      target: ["production"],
      comment:
        "What the clock says to /api/tick. Made by the infra workflow; the database's vault holds the same value.",
    },
  });
  console.log(
    `  the database will ask ${host} to tick every five minutes. CRON_SECRET saved for production.`,
  );
  changedSettings = true;
}

/** Stops the clock. The secret and the endpoint stay; nothing calls it. */
async function disconnectClock() {
  if (!confirmed) fail('This changes settings. Ask again with confirm "yes".');
  for (const job of [CLOCK_JOB, CLOCK_TIDY_JOB]) {
    try {
      await writeQuery(
        `select cron.unschedule(jobid) from cron.job where jobname = '${job}'`,
      );
    } catch {
      fail(`Could not stop ${job}.`);
    }
  }
  console.log("  the clock is stopped.");
}

/** Is the clock going, and is the site answering it? Counts and times only. */
async function clockStatus() {
  const pulse = await readOnlyQuery(
    "select value->>'at' as at, round(extract(epoch from (now() - (value->>'at')::timestamptz)) / 60)::int as minutes_ago, value->'events' as events, value->'orders' as orders from public.settings where key = 'clock.last_tick'",
  );
  const last = Array.isArray(pulse) ? pulse[0] : null;
  console.log(
    last
      ? `  the clock last ran ${String(last.minutes_ago)} min ago: events ${JSON.stringify(last.events)}, unpaid orders ${JSON.stringify(last.orders)}`
      : "  the clock has never run",
  );
  // The scheduler's own tables may be closed to this read-only look.
  try {
    const jobs = await readOnlyQuery(
      "select jobname, schedule, active from cron.job where jobname like 'qp-%' order by 1",
    );
    const list = Array.isArray(jobs) ? jobs : [];
    console.log(
      list.length === 0
        ? "  scheduler: no jobs of ours"
        : `  scheduler: ${list.map((job) => `${String(job.jobname)} (${String(job.schedule)}${job.active ? "" : ", STOPPED"})`).join(", ")}`,
    );
    const answers = await readOnlyQuery(
      "select coalesce(status_code::text, case when timed_out then 'timed out' else 'no answer' end) as answer, count(*)::int as n from net._http_response where created > now() - interval '1 hour' group by 1 order by 1",
    );
    const heard = Array.isArray(answers) ? answers : [];
    if (heard.length > 0) {
      console.log(
        `  the site's answers in the last hour: ${heard.map((row) => `${String(row.answer)} x${String(row.n)}`).join(", ")}`,
      );
    }
  } catch {
    console.log("  (the scheduler's own tables could not be read from here)");
  }
}

const ACTIONS = {
  status,
  "ensure-setup-code": ensureSetupCode,
  "connect-database": connectDatabase,
  "stripe-check": stripeCheck,
  "connect-stripe": connectStripe,
  "stripe-events": stripeEvents,
  "disconnect-stripe": disconnectStripe,
  "connect-clock": connectClock,
  "disconnect-clock": disconnectClock,
  "limits-off": limitsOff,
  "limits-on": limitsOn,
  redeploy: redeployIfChanged,
};

for (const name of actions) {
  if (ACTIONS[name] === undefined) {
    fail(
      `Unknown action "${name}". Known: ${Object.keys(ACTIONS).join(", ")}.`,
    );
  }
}

for (const name of actions) {
  console.log(`\ninfra: ${name}\n`);
  try {
    await ACTIONS[name]();
  } catch (error) {
    // One plain line, and the actions after this one do not run.
    fail(error instanceof Error ? error.message : "It failed.");
  }
}
