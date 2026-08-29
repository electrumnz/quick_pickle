/**
 * The moment between clicking a section and its data arriving.
 *
 * Deliberately a shape rather than a spinner: the blocks sit where the header
 * and the first cards will be, so the page appears to fill in rather than to
 * jump. No text, because a word that is replaced a quarter of a second later
 * is a word she started reading for nothing.
 */
export default function AdminLoading() {
  return (
    <div aria-hidden="true" className="animate-pulse space-y-6">
      <div className="space-y-3 border-b border-hairline pb-5">
        <div className="h-7 w-48 rounded-sm bg-surface-sunken" />
        <div className="h-4 w-full max-w-prose rounded-sm bg-surface-sunken" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4">
          <div className="h-64 rounded-lg border border-hairline bg-surface-raised" />
          <div className="h-48 rounded-lg border border-hairline bg-surface-raised" />
        </div>
        <div className="space-y-4">
          <div className="h-56 rounded-lg border border-hairline bg-surface-raised" />
          <div className="h-40 rounded-lg border border-hairline bg-surface-raised" />
        </div>
      </div>
      <span className="sr-only">Loading</span>
    </div>
  );
}
