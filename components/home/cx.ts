/**
 * Join class names, dropping the ones that are not there.
 *
 * CSS module members are typed `string | undefined`, because a class the
 * stylesheet does not define is a real possibility. Interpolating one straight
 * into a template literal turns that possibility into the literal class name
 * "undefined" in the DOM — a silent styling failure that renders fine in
 * review and wrong in production. This makes the missing case contribute
 * nothing instead, and keeps the type checker honest without a cast.
 */
export function cx(...parts: readonly (string | false | null | undefined)[]) {
  return parts
    .filter((part): part is string => typeof part === "string" && part !== "")
    .join(" ");
}
