# The back end

Everything behind `/backstage`. This is the guide to adding to it.

## The shape of an area

An area is one part of the business: orders, stock, the inbox. Each has the same five
pieces, and `orders` is the one to copy.

| Piece      | Where                            | What                                                        |
| ---------- | -------------------------------- | ----------------------------------------------------------- |
| Tables     | `db/schema/<area>.ts`            | Drizzle tables. Every one ends `.enableRLS()`.              |
| Operations | `lib/backstage/<area>/ops.ts`    | Everything the area can read or change, as `defineOp(...)`. |
| Screens    | `app/backstage/(app)/<area>/`    | Server components. Forms post to `actions.ts` beside them.  |
| Demo data  | `lib/backstage/<area>/demo.ts`   | Invented records, put in through the area's own operations. |
| Tests      | `tests/backstage/<area>.test.ts` | Operations against a real (in-process) Postgres.            |

Then one line each in: `db/schema/index.ts`, `components/backstage/nav.ts` (if it is a
destination), `lib/backstage/demo.ts`, and `e2e/a11y.spec.ts` (every new page).

And, for a new file of operations, one import in `lib/backstage/connect/catalogue.ts`: the
list of every operation there is, which a connected Claude finds them through. A test fails
until it is there. Then decide, for each new operation, whether it is the system's own work
(see below).

## Operations

```ts
export const markPacked = defineOp({
  name: "orders.markPacked", // area.verb. Stable: bots and scripts call it by name.
  title: "Mark an order as packed", // a few words
  description: "Says the box is packed and …", // for a person AND for Claude: when to use it
  access: "write", // read | write | admin (owners only)
  effect: "none", // none | outward (something leaves) | destructive (cannot be undone)
  input: z.object({ number: orderNumber }),
  explain: (input) => `…`, // for outward/destructive: what will happen, said plainly
  async run(ctx, input) {
    // ctx.db is a transaction. ctx.now is one clock reading for the whole operation.
    await ctx.audit({
      entity: { type: "order", id },
      summary: "Packed QP-7K2M9X",
    });
    await ctx.emit({ type: "order.packed", entity: { type: "order", id } });
    return { status: "packed" };
  },
});
```

Rules that are easy to get wrong:

- **Write the description for someone who cannot see the code.** It is what Claude reads to
  decide whether this is the operation it wants. Say what it does, when to use it, and what
  it will not do.
- **Audit summaries are one plain past-tense sentence** a person can read in a list:
  "Shipped QP-7K2M9X with NZ Post". Never a password, a token or a card number in `data`.
- **Refuse with `OpError`**, and make the message something to show a person as it stands:
  `conflict("QP-7K2M9X has already shipped, so its address cannot be changed.")`.
- **Nothing outward inside `run`.** No email, no payment, no HTTP call. Emit an event; the
  work happens after the transaction commits, with retries.
- **Doing the same thing twice is not an error.** Packing a packed order returns quietly.
- **Reads take filters and a `limit`**, and return plain objects, never table rows with
  columns nobody asked for (a password hash, say).
- Inputs are zod. Trim strings, cap lengths, lower-case emails. Error messages are
  sentences: "Say why, in a few words".
- **Decide whether a bot may be offered it.** Every operation is offered to a connected
  Claude unless it is an owner's (`access: "admin"`) or named in `SYSTEM_ONLY` in
  `lib/backstage/connect/catalogue.ts`. Put it in `SYSTEM_ONLY` if it is true because
  something outside said so (a payment processor, a mail provider, the shop's own
  checkout) or is plumbing a person never runs. If in doubt, hold it back. An operation
  with an `effect` is never run for a bot: it waits for a person's yes, so write its
  `explain` for the person who will read it cold.
- **"Outward" is anything that reaches a customer, not only what sends an email.** Money
  off at the checkout, where a box is sent, the words under every reply, who is never
  written to again, what food is on sale: none of those sends anything, and a bot ran
  every one of them by itself until a review said so. Ask of a new operation: could a
  customer be worse off for this having been done wrongly, before a person saw it? Then
  it has an `effect`.
- **Whatever would go out has to be in the input.** A person saying yes to a bot's
  request is shown what the bot handed over and nothing else. An operation that
  publishes words kept somewhere else (a draft, a page, a campaign) is saying yes to
  words that can change after the asking: put it in `PEOPLE_ONLY`, so a person does it
  on the screen that has the words on it. If only one field is like that, name it in
  `BOT_MUST_SAY`.
- **Read the input as a plain `z.object`.** A bot's input is compared with what the
  schema read of it, and a key that was dropped on the way is refused, so a request can
  never carry a key that looks as though it matters and does nothing. A schema that
  reshapes the whole object would slip past that comparison; a test fails if one does.

## Screens

- A page starts with `await requireStaff()`. A layout having checked is not enough.
- Read with `execute(op, input, await staffCaller())`.
- A form posts to a Server Action that ends in `submit(op, input, { back, done })`
  (`lib/backstage/ui/submit.ts`): it runs the operation and redirects with a short message,
  good or bad. Forms therefore work with scripting off, and a reload never repeats a change.
- Offer only what is allowed: the buttons on an order come from its stage. A viewer sees no
  buttons.
- Parts are in `components/backstage/ui.tsx`: `PageHeader`, `Panel`, `Pill`, `Stat`, `When`
  (a moment in NZ time), `Notice`, `Empty`. Classes are in `app/backstage/backstage.css`
  (`bk-btn`, `bk-rows`, `bk-row`, `bk-table`, `bk-kv`, `bk-pill-*`). Form fields reuse the
  shop's `field`, `field-label`, `field-error`.
- Phone first. A list is `bk-rows` of `bk-row` links that reflow with grid, not a table. A
  table that must scroll sideways sits in `bk-table-wrap` with `role="region"`, a label and
  `tabIndex={0}`.
- Internal links are `next/link`. A link to the shop is `ShopLink`.
- Say what does not work. If something only records and does not yet do (a refund with no
  payment processor behind it), the screen says so in a sentence.
- The words are plain New Zealand English. No em dashes. "Sign in", not "authenticate".

## Tests

`openEmbedded()` gives a fresh Postgres in memory with every migration applied.
`useDbHandle(handle)` points the app's own `getDb()` at it for the length of a test file.
Pass `{ db, now }` to `execute` to fix the clock. Test the refusals as carefully as the
successes: wrong role, wrong stage, missing yes, twice in a row.
