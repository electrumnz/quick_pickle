import { IconSearch } from "./icons";

/**
 * A plain GET form for filtering a section.
 *
 * Deliberately not the command palette: this one puts the term in the URL, so
 * a filtered view can be bookmarked, reloaded and linked to — which is what
 * makes a search result from the palette land somewhere real rather than
 * somewhere that resets. It also works with JavaScript switched off.
 */
export function SearchForm({
  action,
  value,
  placeholder,
  label,
}: {
  action: string;
  value: string;
  placeholder: string;
  label: string;
}) {
  return (
    <form action={action} method="get" className="flex items-center gap-2">
      <label htmlFor="section-search" className="sr-only">
        {label}
      </label>
      <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-hairline bg-surface-raised px-2.5 py-1.5 sm:w-72 sm:flex-none">
        <IconSearch className="size-4 shrink-0 text-muted" />
        <input
          id="section-search"
          name="q"
          type="search"
          defaultValue={value}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-body-sm text-primary outline-none placeholder:text-muted"
        />
      </div>
      <button
        type="submit"
        className="shrink-0 rounded-md border border-strong px-3 py-1.5 text-caption font-medium text-primary hover:bg-surface-page"
      >
        Search
      </button>
    </form>
  );
}

/** Says what a filtered view is showing, and how to get back out of it. */
export function FilterNotice({
  query,
  found,
  clearHref,
  noun,
}: {
  query: string;
  found: number;
  clearHref: string;
  noun: string;
}) {
  return (
    <p className="text-caption text-muted">
      {found === 0
        ? `Nothing here matches “${query}”.`
        : `Showing ${String(found)} ${noun}${found === 1 ? "" : "s"} matching “${query}”.`}{" "}
      <a
        href={clearHref}
        className="text-link underline underline-offset-4 hover:no-underline"
      >
        Clear the filter
      </a>
    </p>
  );
}
