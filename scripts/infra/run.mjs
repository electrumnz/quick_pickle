// The repository's own hands on its hosting, database and payments.
//
// Run by .github/workflows/infra.yml, never by the app. It reads four
// repository secrets from the environment and talks to three APIs:
//
//   QP_VERCEL_TOKEN            Vercel, the `quickpickle` project only
//   QP_SUPABASE_ACCESS_TOKEN   Supabase, the Quick Pickle project only
//   QP_STRIPE_SECRET_KEY       Stripe
//
// Rules this file keeps:
//   - It prints names and states. It never prints a value, and anything it
//     generates is masked in the log before it is used.
//   - It is pinned to Quick Pickle's own project and team. A personal token
//     can reach every project its owner can, and another business shares the
//     owner, so nothing here lists projects or takes an id from an input.
//   - Anything that changes a setting needs INFRA_CONFIRM=yes.

import { randomBytes } from "node:crypto";

/** Never to be touched, whatever a token can reach. */
const NOT_OURS = new Set(["ogayhxewacfwohxgwzuz"]);

const env = process.env;
const action = (env.INFRA_ACTION ?? "status").trim();
const confirmed = (env.INFRA_CONFIRM ?? "").trim().toLowerCase() === "yes";

const supabaseRef = required("QP_SUPABASE_PROJECT_REF");
const vercelTeam = required("QP_VERCEL_TEAM_SLUG");
const vercelProject = required("QP_VERCEL_PROJECT");

if (NOT_OURS.has(supabaseRef)) {
  fail(`${supabaseRef} is not Quick Pickle's database. Refusing to run.`);
}

function required(name) {
  const value = (env[name] ?? "").trim();
  if (value === "") fail(`${name} is not set.`);
  return value;
}

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function mask(value) {
  // GitHub replaces a masked string with *** everywhere in the log.
  console.log(`::add-mask::${value}`);
}

/** One JSON request. Throws an error that carries the status, not the body. */
async function call(base, path, { token, method = "GET", body, form } = {}) {
  const headers = { Authorization: `Bearer ${token}` };
  let payload;
  if (form !== undefined) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    payload = new URLSearchParams(form).toString();
  } else if (body !== undefined) {
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

function vercel(path, options = {}) {
  const joiner = path.includes("?") ? "&" : "?";
  return call(
    VERCEL,
    `${path}${joiner}slug=${encodeURIComponent(vercelTeam)}`,
    {
      token: required("QP_VERCEL_TOKEN"),
      ...options,
    },
  );
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
  if (project?.name !== vercelProject) {
    fail(`Vercel answered with a different project. Refusing to go on.`);
  }
  console.log(
    `  project ${project.name}, framework ${String(project.framework)}, node ${String(project.nodeVersion)}`,
  );
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
    `  database url in production: ${database ? "yes" : "NO. Connect Supabase to this project, or the back end runs on demo data."}`,
  );
  console.log(
    `  BACKSTAGE_SETUP_CODE in production: ${hasInProduction(names, "BACKSTAGE_SETUP_CODE") ? "yes" : "NO. Run this workflow with ensure-setup-code."}`,
  );
  return project;
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

/** Run each section even if another fails, then fail at the end if any did. */
async function status() {
  let failed = false;
  for (const section of [vercelStatus, supabaseStatus, stripeStatus]) {
    try {
      await section();
    } catch (error) {
      failed = true;
      console.log(`  ✗ ${error instanceof Error ? error.message : "failed"}`);
    }
    console.log("");
  }
  if (failed) process.exit(1);
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
  if (!confirmed)
    fail('This changes a setting. Run it again with confirm "yes".');
  // Words a person can read off one screen and type on another.
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
    "BACKSTAGE_SETUP_CODE made and saved for production. Read it in Vercel: Settings, Environment Variables. It takes effect on the next deployment.",
  );
}

const ACTIONS = {
  status,
  "ensure-setup-code": ensureSetupCode,
};

const run = ACTIONS[action];
if (run === undefined) {
  fail(
    `Unknown action "${action}". Known: ${Object.keys(ACTIONS).join(", ")}.`,
  );
}

console.log(`infra: ${action}\n`);
await run();
