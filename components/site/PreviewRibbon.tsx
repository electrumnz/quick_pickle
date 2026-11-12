/**
 * The strip across the top of a preview. Staff only: a preview is behind the
 * back end's sign-in, and this never appears on a page a customer can reach.
 *
 * It says, in one line, that this is not the live page and which words are
 * showing, and it leads back to where they are edited. The link opens in the
 * whole window, because a preview is often looked at inside a frame.
 */
export function PreviewRibbon({
  showing,
  name,
  editHref,
  otherHref,
}: {
  /** Which words are on screen. */
  readonly showing: "draft" | "live";
  readonly name: string;
  readonly editHref: string;
  /** The other set of words, when there is one to compare with. */
  readonly otherHref: string | null;
}) {
  return (
    <aside
      aria-label="Preview"
      data-testid="preview-ribbon"
      className="bg-olive text-navy border-navy relative z-50 border-b-[3px] px-4 py-2.5 text-center text-[0.9375rem] leading-snug"
    >
      <strong>Preview.</strong>{" "}
      {showing === "draft"
        ? `The draft of \u201c${name}\u201d. Customers cannot see this.`
        : `\u201c${name}\u201d as customers see it now.`}{" "}
      Visits here are not counted.{" "}
      {otherHref === null ? null : (
        <>
          <a href={otherHref} className="font-semibold underline">
            {showing === "draft" ? "See what is live" : "See the draft"}
          </a>
          {" \u00b7 "}
        </>
      )}
      <a href={editHref} target="_top" className="font-semibold underline">
        Back to the editor
      </a>
    </aside>
  );
}
