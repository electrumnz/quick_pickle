import { Callout } from "@/components/admin/ui/primitives";

import { FLASH_SENTENCES } from "./guard";

/**
 * What the last button did, said on the page she pressed it on.
 *
 * A mistyped refund is not a crash and must not throw her onto the error
 * boundary, and a write that worked should say so where she is looking rather
 * than leaving her to infer it from a list that has quietly reordered. Every
 * action redirects back with `?done=` or `?problem=`, both of which name a
 * sentence in `FLASH_SENTENCES`; this renders it and nothing else.
 *
 * The codes are a closed set, so a crafted `?problem=` in the address bar can
 * only ever produce a sentence this company wrote.
 */
export function Flash({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const problem = sentence(searchParams["problem"]);
  const good = sentence(searchParams["done"]);
  if (problem === null && good === null) return null;
  return (
    <div className="mb-5 space-y-2">
      {problem !== null && (
        <Callout title="That did not happen" tone="danger">
          {problem}
        </Callout>
      )}
      {good !== null && <Callout title="Done">{good}</Callout>}
    </div>
  );
}

function sentence(raw: string | string[] | undefined): string | null {
  const code = Array.isArray(raw) ? raw[0] : raw;
  if (code === undefined) return null;
  const known = Object.entries(FLASH_SENTENCES).find(([key]) => key === code);
  return known === undefined ? null : known[1];
}
