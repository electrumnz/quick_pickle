/**
 * Join class names, dropping the ones that are not there.
 *
 * CSS module members are typed `string | undefined`, because a class the
 * stylesheet does not define is a real possibility. Interpolating one straight
 * into a template literal turns that possibility into the literal class name
 * "undefined" in the DOM — a silent styling failure that renders fine in review
 * and wrong in production.
 *
 * It lives in a module of its own rather than beside the chrome that first
 * needed it, and that is load-bearing: `error.tsx` is a client component, and
 * importing this helper from a module that also reaches `lib/commerce` would
 * drag the Postgres driver into the browser bundle. A shared helper must import
 * nothing.
 */
export function cx(...parts: readonly (string | false | null | undefined)[]) {
  return parts
    .filter((part): part is string => typeof part === "string" && part !== "")
    .join(" ");
}
