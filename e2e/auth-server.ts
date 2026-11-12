/**
 * The second test server: the same build as the first, with the back end's
 * door shut.
 *
 * The first server has no database, so its back end is open and full of demo
 * records. This one is told to behave as if a real database were connected
 * (BACKSTAGE_AUTH=required), which is what the sign-in tests need. It listens
 * one port up from the first.
 */

const port = Number(process.env.PORT ?? 3000) + 1;

export const AUTH_URL = `http://localhost:${String(port)}`;

/** Sixteen characters or more, as the set-up page insists. */
export const SETUP_CODE = "left boot first, then the right";
