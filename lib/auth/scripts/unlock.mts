#!/usr/bin/env node
/**
 * Clear an admin lockout.
 *
 *   npm run auth:unlock              # clear every throttle bucket
 *   npm run auth:unlock -- 1.2.3.4   # clear one address
 *
 * The lockout has a deliberate cost: a determined attacker can hold the global
 * bucket shut for a few minutes at a time, which is the price of having a
 * global bucket at all. This is the founder's way out of that without waiting,
 * and it needs database credentials to run, so it is not a lever anyone on the
 * internet can pull.
 *
 * It clears counters only. It never touches `audit_log`: the record of what
 * happened is the point.
 */
import { argv, env, exit, stdout, stderr } from "node:process";

import pg from "pg";

const connectionString = env.SUPABASE_DB_URL;
if (connectionString === undefined || connectionString.trim() === "") {
  stderr.write("SUPABASE_DB_URL is not set.\n");
  exit(2);
}

const subject = argv[2];
const pool = new pg.Pool({ connectionString, max: 1 });

try {
  const result =
    subject === undefined
      ? await pool.query(
          "delete from public.admin_auth_throttle returning scope, subject",
        )
      : await pool.query(
          "delete from public.admin_auth_throttle where subject = $1::text returning scope, subject",
          [subject],
        );
  stdout.write(
    `Cleared ${String(result.rowCount ?? 0)} throttle bucket(s)${subject === undefined ? "" : ` for ${subject}`}.\n`,
  );
} finally {
  await pool.end();
}
