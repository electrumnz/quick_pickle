# The admin

The shell the founder runs the company from. Nine destinations, one action
inbox, and nothing else.

## Where things are

| Path                    | What is in it                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| `shell/`                | The frame: sidebar, top bar, breadcrumbs, mobile drawer, scheme switch                                       |
| `shell/destinations.ts` | **The information architecture.** Nine entries, read by the sidebar, the breadcrumbs, the palette and search |
| `command/`              | The ⌘K palette and the buttons that open it                                                                  |
| `ui/`                   | Page furniture and primitives. Import them from `@/components/admin`                                         |
| `data/`                 | Everything that reads the business. `server-only`, never imported by a client component                      |
| `evidence/`             | Screenshots of every destination, at 375 and 1440, light and dark                                            |

## Building a page

```tsx
import {
  Card,
  CardBody,
  NotBuiltYet,
  PageHeader,
  PageSections,
  Section,
} from "@/components/admin";
```

Every page is the same three things in the same order:

1. `<PageHeader title lede />` — the `lede` is required, and it is the sentence
   that tells a non-technical reader what this place is for.
2. `<PageSections>` wrapping one or more `<Section title description>`. Give a
   `Section` an `id` and it becomes an anchor target for `<PageNav>`.
3. `<NotBuiltYet works coming />` at the bottom, for as long as the page is
   partly built. Two honest lists beat a fake button.

Long-form reference pages should put `<PageNav items>` at the top of the right
column: plain anchors, no JavaScript, one entry per `Section` id.

## The rules the pages are held to

- **Semantic tokens only.** `bg-surface-raised`, `text-muted`, `border-hairline`,
  `bg-accent` + `text-on-accent`. Never a pigment name, never a hex — a test in
  `tests/unit/brand-tokens.test.ts` greps the whole tree for one and fails.
  `text-accent` is display-size only: Brine on a light ground is not body-safe.
- **Every number carries the words that make it mean something.** `Stat`
  requires a `label` and takes a `hint` for the sentence underneath.
- **Never a raw identifier where a name exists.** A batch is "No 03 SMOKE,
  batch E". An order is a person and a town.
- **Empty means teach, not report.** `EmptyState` takes what the section is for
  and what will fill it. "No data" is banned.
- **Money is integer cents** all the way to `format.ts`, which is the only
  place that divides by 100.
- **New Zealand time.** `data/format.ts` pins `Pacific/Auckland` on every date;
  "today" means her today.

## Reading data

```ts
import { load } from "@/components/admin/data/db";

const result = await load(async () => …);
if (!result.ok) return <DataUnavailable {...result} />;
```

Orders, products, inventory and customers go through `data/commerce-reads.ts`,
which calls the `lib/commerce` provider — never SQL. Batches, suppliers,
agents, approvals, brand rules and settings are Half Sour's own tables and go
through `data/queries.ts`.
