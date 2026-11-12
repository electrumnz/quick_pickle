import Link from "next/link";
import type { ReactNode } from "react";

import { ShopLink } from "@/components/backstage/ShopLink";
import { CheckIcon } from "@/components/brand/Icons";
import {
  parseMarkdown,
  type Align,
  type Block,
  type Inline,
  type ListItem,
} from "@/lib/backstage/plans/markdown";

/**
 * A document, shown.
 *
 * The text is read into a tree by lib/backstage/plans/markdown.ts and this
 * file builds React elements from that tree, one by one. Nothing a writer
 * typed is ever handed to the browser as HTML, so a `<script>` in a document
 * is five letters between two angle brackets, and a link can only point where
 * the reader allows (see `safeLink`).
 *
 * This lives under app/backstage because the back end's stylesheet only
 * scans its own folders for class names: the same file under lib/ would
 * render with no styles and no error.
 */

const LINK_CLASS =
  "underline decoration-pink decoration-2 underline-offset-[0.2em] [overflow-wrap:anywhere]";

const ALIGN_CLASS: Readonly<Record<Exclude<Align, null>, string>> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

/** Section headings sit under the page's own title, so they start at h2. */
const HEADING_CLASS = [
  "bk-h2 border-navy-line mt-3 border-b pb-2 first:mt-0",
  "font-semibold mt-2 text-[1.125rem] leading-snug first:mt-0",
  "label bk-muted mt-1 text-[1.05rem] first:mt-0",
] as const;

function renderInline(nodes: readonly Inline[]): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text":
        return node.text;
      case "strong":
        return <strong key={index}>{renderInline(node.children)}</strong>;
      case "em":
        return <em key={index}>{renderInline(node.children)}</em>;
      case "del":
        return <del key={index}>{renderInline(node.children)}</del>;
      case "code":
        return (
          <code
            key={index}
            className="bg-mist rounded px-1 py-0.5 font-mono text-[0.9em]"
          >
            {node.text}
          </code>
        );
      case "break":
        return <br key={index} />;
      case "link": {
        const label = renderInline(node.children);
        if (node.kind === "backstage") {
          return (
            <Link key={index} href={node.href} className={LINK_CLASS}>
              {label}
            </Link>
          );
        }
        if (node.kind === "site") {
          // The shop has its own stylesheet: a full page load, not a hop.
          return (
            <ShopLink key={index} href={node.href} className={LINK_CLASS}>
              {label}
            </ShopLink>
          );
        }
        if (node.kind === "mail") {
          return (
            <a key={index} href={node.href} className={LINK_CLASS}>
              {label}
            </a>
          );
        }
        return (
          <a
            key={index}
            href={node.href}
            className={LINK_CLASS}
            target="_blank"
            rel="noopener noreferrer"
          >
            {label}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        );
      }
    }
  });
}

/** An empty box to tick on paper, or a ticked one. Never a form control. */
function TaskBox({ checked }: { readonly checked: boolean }) {
  return (
    <>
      <span
        aria-hidden="true"
        className="border-navy mt-[0.2em] inline-flex size-5 shrink-0 items-center justify-center rounded border-2"
      >
        {checked ? <CheckIcon className="size-4" /> : null}
      </span>
      <span className="sr-only">{checked ? "Done: " : "To do: "}</span>
    </>
  );
}

type Shared = {
  /** The tag level the document's shallowest heading is given: 2 or 3. */
  readonly base: number;
  /** Added to a heading's own level so the shallowest one lands on `base`. */
  readonly shift: number;
  /** Counts tables, so each scrolling region has its own name. */
  tables: number;
};

/**
 * One item of a list. `lead` is what stands in front of its words when the
 * list draws its own markers: a step number, an empty slot, or nothing.
 */
function renderItem(
  item: ListItem,
  index: number,
  shared: Shared,
  lead: ReactNode,
) {
  const body = (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      {renderBlocks(item.children, shared)}
    </div>
  );
  if (lead === null && item.checked === null) {
    return <li key={index}>{body}</li>;
  }
  return (
    <li key={index} className="flex gap-2.5">
      {lead}
      {item.checked === null ? null : <TaskBox checked={item.checked} />}
      {body}
    </li>
  );
}

function renderBlock(block: Block, index: number, shared: Shared): ReactNode {
  switch (block.type) {
    case "heading": {
      const level = Math.min(
        6,
        Math.max(shared.base, block.level + shared.shift),
      );
      const Tag = `h${String(level)}` as "h2" | "h3" | "h4" | "h5" | "h6";
      // How it looks follows how deep it is in the document, not its tag.
      const depth = Math.min(level - shared.base, 2);
      return (
        <Tag key={index} className={HEADING_CLASS[depth] ?? HEADING_CLASS[2]}>
          <span className={depth === 1 ? "" : "cap-trim"}>
            {renderInline(block.children)}
          </span>
        </Tag>
      );
    }
    case "paragraph":
      return <p key={index}>{renderInline(block.children)}</p>;
    case "list": {
      const gap = block.tight ? "gap-1.5" : "gap-3";
      const boxes = block.items.some((item) => item.checked !== null);
      // A checklist draws its own markers, so a step number, its box and its
      // words sit on one line whatever the browser does with list markers.
      // `role="list"` keeps it a list for screen readers once the browser's
      // own markers are switched off.
      if (block.ordered && boxes) {
        return (
          <ol
            key={index}
            role="list"
            className={`flex list-none flex-col ${gap}`}
          >
            {block.items.map((item, at) =>
              renderItem(
                item,
                at,
                shared,
                <>
                  <span className="min-w-6 shrink-0 text-right font-semibold tabular-nums">
                    {block.start + at}.
                  </span>
                  {item.checked === null ? (
                    <span aria-hidden="true" className="size-5 shrink-0" />
                  ) : null}
                </>,
              ),
            )}
          </ol>
        );
      }
      if (block.ordered) {
        return (
          <ol
            key={index}
            start={block.start === 1 ? undefined : block.start}
            className={`flex list-decimal flex-col pl-7 ${gap}`}
          >
            {block.items.map((item, at) => renderItem(item, at, shared, null))}
          </ol>
        );
      }
      if (boxes) {
        return (
          <ul
            key={index}
            role="list"
            className={`flex list-none flex-col ${gap}`}
          >
            {block.items.map((item, at) =>
              renderItem(
                item,
                at,
                shared,
                item.checked === null ? (
                  <span aria-hidden="true" className="size-5 shrink-0" />
                ) : null,
              ),
            )}
          </ul>
        );
      }
      return (
        <ul key={index} className={`flex list-disc flex-col pl-6 ${gap}`}>
          {block.items.map((item, at) => renderItem(item, at, shared, null))}
        </ul>
      );
    }
    case "quote":
      return (
        <blockquote
          key={index}
          className="border-olive bg-olive-wash flex flex-col gap-3 rounded-r-xl border-l-4 px-4 py-3"
        >
          {renderBlocks(block.children, shared)}
        </blockquote>
      );
    case "code":
      return (
        <pre
          key={index}
          className="bg-mist border-navy-line rounded-xl border p-3 font-mono text-[0.875rem] leading-snug [overflow-wrap:anywhere] whitespace-pre-wrap"
        >
          <code>{block.text}</code>
        </pre>
      );
    case "rule":
      return <hr key={index} className="border-navy-line border-t-2" />;
    case "table": {
      shared.tables += 1;
      const align = (column: number) => {
        const side = block.align[column] ?? null;
        return side === null ? undefined : ALIGN_CLASS[side];
      };
      return (
        <div
          key={index}
          className="bk-table-wrap border-navy-line rounded-xl border"
          role="region"
          aria-label={`Table ${String(shared.tables)}`}
          tabIndex={0}
        >
          <table className="bk-table">
            <thead>
              <tr>
                {block.head.map((cell, column) =>
                  cell.length === 0 ? (
                    <td key={column} />
                  ) : (
                    <th key={column} scope="col" className={align(column)}>
                      {renderInline(cell)}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, at) => (
                <tr key={at}>
                  {row.map((cell, column) => (
                    <td key={column} className={align(column)}>
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
  }
}

function renderBlocks(blocks: readonly Block[], shared: Shared): ReactNode[] {
  return blocks.map((block, index) => renderBlock(block, index, shared));
}

function shallowestHeading(blocks: readonly Block[]): number {
  let level = 7;
  for (const block of blocks) {
    if (block.type === "heading") level = Math.min(level, block.level);
    else if (block.type === "quote") {
      level = Math.min(level, shallowestHeading(block.children));
    } else if (block.type === "list") {
      for (const item of block.items) {
        level = Math.min(level, shallowestHeading(item.children));
      }
    }
  }
  return level;
}

export function Markdown({
  source,
  empty = "Nothing has been written here yet.",
  under = 1,
}: {
  readonly source: string;
  /** What to say when there is no text at all. */
  readonly empty?: string;
  /**
   * The level of the heading this text sits under on the page: 1 under the
   * page's own title, 2 inside a titled panel. The document's own headings
   * start one below it, whatever marks the writer used.
   */
  readonly under?: 1 | 2;
}) {
  const blocks = parseMarkdown(source);
  if (blocks.length === 0) {
    return <p className="bk-muted">{empty}</p>;
  }
  const top = shallowestHeading(blocks);
  const base = under + 1;
  const shared: Shared = { base, shift: top > 6 ? 0 : base - top, tables: 0 };
  return (
    <div className="flex flex-col gap-4 leading-relaxed [overflow-wrap:anywhere]">
      {renderBlocks(blocks, shared)}
    </div>
  );
}
