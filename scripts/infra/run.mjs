// The repository's own hands on its hosting, database and payments.
//
// Run by .github/workflows/infra.yml, never by the app. It reads four
// repository secrets from the environment and talks to three APIs:
//
//   QP_VERCEL_TOKEN            Vercel, Quick Pickle's own project only
//   QP_SUPABASE_ACCESS_TOKEN   Supabase, the Quick Pickle project only
//   QP_STRIPE_SECRET_KEY       Stripe
//
// and, only for "connect-starshipit", the two keys Starshipit makes under
// Settings, API: QP_STARSHIPIT_API_KEY and QP_STARSHIPIT_SUBSCRIPTION_KEY.
//
// What it does is decided one of two ways (see the workflow):
//
//   started by hand   the action and the yes come from the form
//   a push to main    "status", unless that push changed
//                     .github/infra-request.json, in which case the file
//                     says: { "actions": ["status", ...], "confirm": "yes" }
//                     and, for the two actions that take one, the name of
//                     a domain: "domain": "example.co.nz"
//
// Rules this file keeps:
//   - It prints names and states. It never prints a value, and anything it
//     generates is masked in the log before it is used. (A DNS record is not
//     a secret: it is public the moment it is added, and a person has to be
//     able to read it here to add it.)
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

import {
  hostsOwnAddress,
  readDomainName,
  recordFor,
  STATE_SAID,
  stateOf,
} from "./domain.mjs";

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
      domain: "",
    };
  }
  const request = readRequest();
  if (request === null) {
    return { actions: ["status"], confirmed: false, rotate: false, domain: "" };
  }
  const list = Array.isArray(request.actions)
    ? request.actions.filter((item) => typeof item === "string")
    : [];
  return {
    actions: list.length > 0 ? list : ["status"],
    confirmed: String(request.confirm ?? "").toLowerCase() === "yes",
    rotate: request.rotate === true,
    // A domain is only ever named in a commit, never typed into a form.
    domain: typeof request.domain === "string" ? request.domain : "",
  };
}

const { actions, confirmed, rotate, domain: askedDomain } = whatWasAsked();

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

/** Every address on the project, as the host lists them. */
async function projectDomains() {
  const result = await vercel(`/v9/projects/${vercelProject}/domains`);
  return Array.isArray(result?.domains) ? result.domains : [];
}

/**
 * How the host sees one name's DNS, and what it recommends. Null for the
 * host's own address, which has no DNS of ours, and when it cannot be read.
 */
async function domainConfig(name) {
  if (name.endsWith(".vercel.app")) return null;
  try {
    return await vercel(
      `/v6/domains/${encodeURIComponent(name)}/config?projectIdOrName=${encodeURIComponent(vercelProject)}`,
    );
  } catch {
    return null;
  }
}

/** One address and where it stands, for the log. */
async function addressSaid(domain) {
  const name = String(domain.name);
  if (name.endsWith(".vercel.app")) {
    return `${name}: the host's own${domain.redirect ? `, BUT it sends people on to ${String(domain.redirect)}` : ""}`;
  }
  const config = await domainConfig(name);
  const state =
    config === null && domain.verified !== false
      ? "could not be read"
      : STATE_SAID[stateOf(domain, config)];
  return `${name}: ${state}${domain.redirect ? `, sends people on to ${String(domain.redirect)}` : ""}`;
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
  const addresses = await projectDomains();
  for (const domain of addresses) {
    console.log(`  address ${await addressSaid(domain)}`);
  }
  const own = hostsOwnAddress(addresses);
  console.log(
    own === null
      ? "  ✗ the host's own address is missing or sends people elsewhere. Stripe and the clock call it."
      : `  Stripe and the clock call ${own}`,
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
    `  database url in production: ${database ? "yes" : "NO. The back end is running on demo data."}`,
  );
  console.log(
    `  BACKSTAGE_SETUP_CODE in production: ${hasInProduction(names, "BACKSTAGE_SETUP_CODE") ? "yes" : "NO"}`,
  );
  console.log(
    `  the shop's own address: ${hasInProduction(names, "NEXT_PUBLIC_SITE_URL") ? "held by NEXT_PUBLIC_SITE_URL" : "whatever the host says (NEXT_PUBLIC_SITE_URL is not set)"}`,
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
  // The courier's booking system (lib/courier). Off is normal.
  const starshipitMissing = STARSHIPIT_SETTINGS.filter(
    (key) => !hasInProduction(names, key),
  );
  console.log(
    `  Starshipit in production: ${starshipitMissing.length === 0 ? "connected: packed orders go there, and labels come back as shipped orders" : starshipitMissing.length === STARSHIPIT_SETTINGS.length ? "not connected (the courier screen's file is the way out)" : `half set up. Missing: ${starshipitMissing.join(", ")}`}`,
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

// --- The shop's own domain ----------------------------------------------------

/** Holds the address the shop calls itself by. A new deployment picks it up. */
function holdAddress(host, why) {
  return vercel(`/v10/projects/${vercelProject}/env?upsert=true`, {
    method: "POST",
    body: {
      key: "NEXT_PUBLIC_SITE_URL",
      value: `https://${host}`,
      type: "plain",
      target: ["production"],
      comment: `The address the shop calls itself by: in its links, its emails and where Stripe sends a buyer back. ${why} Set by the infra workflow.`,
    },
  });
}

/** The name the request gave, or a stop with the reason. */
function domainAsked() {
  const read = readDomainName(askedDomain);
  if (read.name === undefined) return fail(read.why);
  return read.name;
}

/**
 * Puts one name on the project, or finds it there, and has the host look
 * again at one it has not accepted yet.
 */
async function nameOnProject(name, existing, extra = {}) {
  const there = existing.find((domain) => domain.name === name);
  if (there !== undefined) {
    if (there.verified !== false) {
      console.log(`  ${name} is already on the project. Left alone.`);
      return there;
    }
    try {
      const looked = await vercel(
        `/v9/projects/${vercelProject}/domains/${encodeURIComponent(name)}/verify`,
        { method: "POST" },
      );
      console.log(
        `  ${name} was on the project and not proven. The host looked again.`,
      );
      return looked ?? there;
    } catch {
      return there;
    }
  }
  try {
    const made = await vercel(`/v10/projects/${vercelProject}/domains`, {
      method: "POST",
      body: { name, ...extra },
    });
    console.log(`  ${name} is on the project.`);
    return made ?? { name };
  } catch (error) {
    if (error?.status === 409) {
      return fail(
        `The host says ${name} is in use by another project or account, or is not allowed. It was not added.`,
      );
    }
    throw error;
  }
}

/** Says what a person has to add where the domain's DNS is kept. */
async function sayRecords(entries, apex) {
  console.log("");
  console.log(
    "  Records to add where the domain's DNS is kept (its registrar, unless",
  );
  console.log("  the name servers were pointed somewhere else):");
  console.log("");
  console.log("    TYPE   HOST   VALUE");
  for (const entry of entries) {
    const name = String(entry.name);
    for (const proof of Array.isArray(entry.verification)
      ? entry.verification
      : []) {
      if (entry.verified !== false) break;
      const at = String(proof.domain ?? "").endsWith(`.${apex}`)
        ? String(proof.domain).slice(0, -apex.length - 1)
        : String(proof.domain ?? "");
      console.log(
        `    ${String(proof.type ?? "TXT").padEnd(6)} ${at.padEnd(6)} ${String(proof.value ?? "")}   (proves ${name} is ours)`,
      );
    }
    const config = await domainConfig(name);
    const record = recordFor(name, apex, config);
    const state = STATE_SAID[stateOf(entry, config)];
    console.log(
      record === null
        ? `    ${name}: the host recommended nothing this can read. The project's Domains page on the host shows the record.`
        : `    ${record.type.padEnd(6)} ${record.at.padEnd(6)} ${record.value}   (${name}: ${state})`,
    );
  }
  console.log("");
  console.log(
    '  "@" is the bare name. Some registrars want that box left blank, or the',
  );
  console.log("  name typed in full.");
  console.log(
    "  A record already at the same host (a parking page's, say) has to go, or",
  );
  console.log(
    '  the two fight. DNS takes from minutes to a day to spread. Then "status"',
  );
  console.log('  says "answering", and "use-domain" can be asked for.');
}

/**
 * Waits for the host to finish building what the asking push started.
 *
 * A request arrives in a push to main, and the host starts building that same
 * push at the same moment. Changing which names a project answers to while
 * it is being built is asking for a refusal, and the deployment made next
 * should be the first to carry what was just set. Gives up after four
 * minutes and says where things stood, so it can never be why a run hangs.
 */
async function productionSettled() {
  const started = Date.now();
  // The push that asked, when there was one. The host may not have made its
  // deployment yet when this first looks, and the one before it is no answer.
  const asking = (env.GITHUB_SHA ?? "").trim();
  for (;;) {
    const list = await vercel(
      `/v6/deployments?projectId=${encodeURIComponent(vercelProject)}&target=production&limit=1`,
    );
    const latest = (list?.deployments ?? [])[0];
    const state = String(latest?.state ?? latest?.readyState ?? "UNKNOWN");
    const busy = ["BUILDING", "QUEUED", "INITIALIZING"].includes(state);
    const ours =
      asking === "" || String(latest?.meta?.githubCommitSha ?? "") === asking;
    if ((ours && !busy) || Date.now() - started > 4 * 60 * 1000) return state;
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }
}

/**
 * Puts a domain on the project, and says which DNS records point it here.
 *
 * It changes nothing a visitor can see. The site goes on answering at the
 * host's own address and goes on calling itself by it: that is held in place
 * FIRST, because the host would otherwise start naming the new domain as the
 * site's address at the next deployment, before a single record points at it,
 * and every link in an email and every return from Stripe would lead to a
 * registrar's parking page. "www." is added beside the name and sends people
 * on to it. Safe to ask for twice.
 */
async function addDomain() {
  if (!confirmed) fail('This changes settings. Ask again with confirm "yes".');
  const name = domainAsked();
  const existing = await projectDomains();
  const own = hostsOwnAddress(existing);
  if (own === null) {
    fail(
      "The host's own address is missing or sends people elsewhere. Stopping before anything is changed.",
    );
  }

  const names = await vercelEnvNames();
  if (hasInProduction(names, "NEXT_PUBLIC_SITE_URL")) {
    console.log(
      "  the shop's own address is already held in place. Left alone.",
    );
  } else {
    await holdAddress(
      own,
      'Held at the host\'s own address until "use-domain" moves it.',
    );
    console.log(
      `  the shop goes on calling itself ${own}, held in place until "use-domain".`,
    );
    changedSettings = true;
  }

  const settled = await productionSettled();
  console.log(
    `  the host's own build of this push: ${settled.toLowerCase()}. Going on.`,
  );

  const added = await nameOnProject(name, existing);
  const apex = typeof added.apexName === "string" ? added.apexName : name;
  const entries = [added];
  if (apex === name) {
    entries.push(
      await nameOnProject(`www.${name}`, existing, {
        redirect: name,
        redirectStatusCode: 308,
      }),
    );
  }
  await sayRecords(entries, apex);
}

/**
 * Makes a domain the address the shop calls itself by.
 *
 * Only once the domain is really answering: the host has to say its DNS is
 * right, and the shop has to answer there when asked, as a visitor would
 * ask. Until both are true nothing is changed. Follow it with "redeploy",
 * because the address is built into the site.
 *
 * Two things follow from a new address and are meant: everybody's Claude
 * connection ends (a key is good for one address) and they connect again;
 * and printed QR codes made before now still lead to the host's own address,
 * which goes on working. Stripe and the clock are not moved.
 */
async function useDomain() {
  if (!confirmed) fail('This changes settings. Ask again with confirm "yes".');
  const name = domainAsked();
  const existing = await projectDomains();
  const entry = existing.find((domain) => domain.name === name);
  if (entry === undefined) {
    fail(`${name} is not on the project. Ask for "add-domain" first.`);
  }
  if (entry.verified === false) {
    fail(`${name} has not been proven to be ours yet. Nothing was changed.`);
  }
  if (entry.redirect) {
    fail(
      `${name} sends people on to ${String(entry.redirect)}, so it cannot be the shop's address. Nothing was changed.`,
    );
  }
  const config = await domainConfig(name);
  if (config?.misconfigured !== false) {
    fail(
      `${name} is not pointing at the site yet: the host cannot see its DNS records. Nothing was changed.`,
    );
  }
  let answered = "no answer";
  try {
    const response = await fetch(`https://${name}/`, {
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
    });
    const page = response.status === 200 ? await response.text() : "";
    answered =
      response.status === 200 && page.includes("Quick Pickle")
        ? "the shop"
        : `status ${String(response.status)}`;
  } catch {
    answered = "no answer";
  }
  if (answered !== "the shop") {
    fail(
      `Asked https://${name}/ for the shop and got ${answered}. Nothing was changed. DNS can take a day to spread: ask again later.`,
    );
  }
  await holdAddress(name, "The shop's own domain.");
  console.log(
    `  the shop will call itself ${name} once it has been built again ("redeploy").`,
  );
  console.log(
    "  Everybody's Claude connection ends with the old address: they connect again.",
  );
  console.log(
    `  Stripe and the clock go on calling ${String(hostsOwnAddress(existing))}, on purpose.`,
  );
  changedSettings = true;
}

/**
 * The way back: the shop calls itself by the host's own address again.
 *
 * For the day a domain stops working (its registration ran out, its DNS was
 * changed by mistake). The site itself never stopped answering at the host's
 * own address; this stops its links and emails pointing at the broken one.
 * The domain stays on the project. Follow it with "redeploy".
 */
async function leaveDomain() {
  if (!confirmed) fail('This changes settings. Ask again with confirm "yes".');
  const own = hostsOwnAddress(await projectDomains());
  if (own === null) {
    fail("The host's own address is missing or sends people elsewhere.");
  }
  await holdAddress(own, "Back at the host's own address.");
  console.log(
    `  the shop will call itself ${own} again once it has been built again ("redeploy").`,
  );
  changedSettings = true;
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

/**
 * The address machines reach the site at: Stripe with its news of a payment,
 * the database with the clock.
 *
 * It is the host's own address, on purpose, and stays that whatever domain
 * the shop is given (scripts/infra/domain.mjs says why). Before there was a
 * domain it was the only address, so nothing moved when this was written.
 */
async function productionHost() {
  const list = await projectDomains();
  const host =
    hostsOwnAddress(list) ??
    list.find((domain) => domain.verified !== false)?.name;
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

// --- Starshipit ----------------------------------------------------------------

/** The app's names for the two keys (lib/courier/index.ts). */
const STARSHIPIT_SETTINGS = [
  "STARSHIPIT_API_KEY",
  "STARSHIPIT_SUBSCRIPTION_KEY",
];

/**
 * Puts Starshipit's two keys on the host, from the repository's secrets,
 * after asking Starshipit whether they work: one read of the orders waiting
 * there, which changes nothing. Follow it with "redeploy". From then on a
 * packed order goes to Starshipit by itself (lib/backstage/orders/starshipit.ts).
 */
async function connectStarshipit() {
  if (!confirmed) fail('This changes settings. Ask again with confirm "yes".');
  const apiKey = required("QP_STARSHIPIT_API_KEY");
  const subscriptionKey = required("QP_STARSHIPIT_SUBSCRIPTION_KEY");
  mask(apiKey);
  mask(subscriptionKey);
  let response;
  try {
    response = await fetch(
      "https://api.starshipit.com/api/orders/unshipped?limit=1",
      {
        headers: {
          "Content-Type": "application/json",
          "StarShipIT-Api-Key": apiKey,
          "Ocp-Apim-Subscription-Key": subscriptionKey,
        },
        signal: AbortSignal.timeout(20_000),
      },
    );
  } catch {
    fail("Starshipit did not answer. Nothing was changed.");
  }
  if (!response.ok) {
    fail(
      `Starshipit turned the keys down (${String(response.status)}). Check both were copied from Settings, API in Starshipit. Nothing was changed.`,
    );
  }
  console.log("  Starshipit took both keys.");
  const save = (name, value) =>
    vercel(`/v10/projects/${vercelProject}/env?upsert=true`, {
      method: "POST",
      body: { key: name, value, type: "sensitive", target: ["production"] },
    });
  await save("STARSHIPIT_API_KEY", apiKey);
  await save("STARSHIPIT_SUBSCRIPTION_KEY", subscriptionKey);
  console.log(
    "  production will send packed orders to Starshipit once it is redeployed.",
  );
  changedSettings = true;
}

/** Takes Starshipit's keys off the host. Follow it with "redeploy". */
async function disconnectStarshipit() {
  if (!confirmed) fail('This changes settings. Ask again with confirm "yes".');
  const result = await vercel(`/v10/projects/${vercelProject}/env`);
  const list = Array.isArray(result?.envs) ? result.envs : [];
  let removed = 0;
  for (const item of list) {
    if (STARSHIPIT_SETTINGS.includes(String(item.key)) && item.id) {
      await vercel(`/v9/projects/${vercelProject}/env/${item.id}`, {
        method: "DELETE",
      });
      removed += 1;
    }
  }
  console.log(
    removed === 0
      ? "  Starshipit was not connected. Nothing to take off."
      : "  Starshipit's keys are off the host. Orders already there stay there.",
  );
  if (removed > 0) changedSettings = true;
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
  "connect-starshipit": connectStarshipit,
  "disconnect-starshipit": disconnectStarshipit,
  "add-domain": addDomain,
  "use-domain": useDomain,
  "leave-domain": leaveDomain,
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
