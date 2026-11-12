/**
 * True under a test runner.
 *
 * Two things in this code base must never happen from a test: a call on the
 * wire to a real provider, and work done behind a test's back by the event
 * dispatcher. Both used to ask NODE_ENV alone. A test that stands in for a
 * production deployment sets NODE_ENV itself, and that must not be what
 * lets either of them happen. (It did once: a test of the morning email set
 * NODE_ENV to production and ran the clock, and the mail seam took that as
 * leave to use the network.)
 *
 * So this also asks for the marks the runner puts in the environment itself,
 * which a test has no reason to touch. It imports nothing.
 */
export function underTestRunner(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return (
    env.NODE_ENV === "test" ||
    (env.VITEST ?? "") !== "" ||
    (env.VITEST_WORKER_ID ?? "") !== "" ||
    (env.JEST_WORKER_ID ?? "") !== ""
  );
}
