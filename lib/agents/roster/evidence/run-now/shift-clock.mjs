/**
 * Move the server's clock forward, for one screenshot.
 *
 * The free window on `minimax/minimax-m3-free` and `minimax/minimax-m2.7-free`
 * closes at the end of Sunday 6 September 2026, and the roster fails closed past
 * it. The "Run now" control has to say so in words a founder can act on — which
 * model, and what to set — and that state cannot be photographed on 30 August
 * without moving something.
 *
 * What is moved is the CLOCK, not the code. Nothing in `lib/agents` is patched,
 * no constant is edited and no test hook is added; the server simply believes it
 * is 8 September 2026, which is exactly what the founder's deployment will
 * believe on 8 September 2026. Preloaded with:
 *
 *   node --import ./lib/agents/roster/evidence/run-now/shift-clock.mjs \
 *     ./node_modules/next/dist/bin/next start -p 3311
 *
 * `HALF_SOUR_EVIDENCE_CLOCK` is read here and nowhere else in the repository. It
 * has no effect on any build, any test or any deployment: it is an argument to a
 * script in an evidence directory.
 */

const target = process.env["HALF_SOUR_EVIDENCE_CLOCK"];
if (target !== undefined && target !== "") {
  const RealDate = Date;
  const offset = RealDate.parse(target) - RealDate.now();

  // A Proxy rather than a subclass: `Date` carries statics (`parse`, `UTC`,
  // `[Symbol.hasInstance]`) that half of Node and all of Next rely on, and a
  // subclass that forgets one of them takes the server down at import time
  // rather than showing a screenshot. This forwards everything and answers
  // exactly two questions differently.
  globalThis.Date = new Proxy(RealDate, {
    construct(constructor, args, newTarget) {
      return args.length === 0
        ? Reflect.construct(constructor, [RealDate.now() + offset], newTarget)
        : Reflect.construct(constructor, args, newTarget);
    },
    apply() {
      return new RealDate(RealDate.now() + offset).toString();
    },
    get(constructor, property, receiver) {
      if (property === "now") return () => RealDate.now() + offset;
      return Reflect.get(constructor, property, receiver);
    },
  });

  process.stdout.write(
    `evidence clock: pretending it is ${new Date().toISOString()}\n`,
  );
}
