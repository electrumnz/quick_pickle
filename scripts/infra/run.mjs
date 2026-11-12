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
    console.log(
      `    ${String(hook.status)} ${host} (${String(hook.enabled_events?.length ?? 0)} events)`,
    );
  }
  const publishable = (env.QP_STRIPE_PUBLISHABLE_KEY ?? "").trim();
  console.log(
    `  publishable key: ${publishable === "" ? "missing" : publishable.startsWith("pk_test_") ? "test" : publishable.startsWith("pk_live_") ? "LIVE" : "unrecognised"}`,
  );
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

const ACTIONS = {
  status,
  "ensure-setup-code": ensureSetupCode,
  "connect-database": connectDatabase,
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
  await ACTIONS[name]();
}
