# The admin's write side, driven for real

Everything in this folder was produced against a running production build of
this repository, signed in through the real login form, against the seeded
local business database. There is no test bypass anywhere in the admin and none
was used here: `drive.mjs` types the password into `#admin-password` and presses
the same buttons the founder does.

## What is here

| File                                    | What it proves                                                                                                 |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `transcript.txt`                        | Eleven writes, each with the database row before, the click, the row after, and the `audit_log` line it wrote. |
| `bypass.txt`                            | Six attempts to make a write without being allowed to. All six refused, all six left the database untouched.   |
| `drive.mjs`                             | The script that produced the transcript.                                                                       |
| `bypass.mjs`                            | The script that produced the bypass log.                                                                       |
| `capture.mjs`                           | The screenshot run.                                                                                            |
| `screenshots.json`                      | Every shot, with the console errors seen while taking it. Zero, everywhere.                                    |
| `*-1440-light.png`, `*-375-dark.png`, … | The four pages that can now change something, at both widths, in both schemes.                                 |
| `01-…` – `12-…`                         | The individual actions mid-flight: the confirmation folds open, and the page immediately after the write.      |

## Running them again

The server has to be a production build in its own directory, so it does not
collide with anything else running in the same tree:

```bash
NEXT_DIST_DIR=.scratch/next-admin npm run build
NEXT_DIST_DIR=.scratch/next-admin npx next start -p <a port you have checked is free>

BASE=http://localhost:<port> ADMIN_PASSWORD='…' \
  PGURL='postgresql://postgres@localhost:55432/halfsour' \
  node components/admin/evidence/writes/drive.mjs

BASE=http://localhost:<port> ADMIN_PASSWORD='…' \
  PGURL='…' node components/admin/evidence/writes/bypass.mjs

BASE=http://localhost:<port> ADMIN_PASSWORD='…' \
  node components/admin/evidence/writes/capture.mjs
```

`drive.mjs` expects the seeded database in its seeded state: it packs
`HS-01093`, cancels `HS-01088`, and opens a batch. Running it twice needs those
rows put back first, which is what the reset in `transcript.txt`'s header
commentary refers to.

## What the transcript shows, in one line each

1. **Mark packed** — `HS-01093` went from `unfulfilled` with no ticket to
   `fulfilled`, Post Haste, `PH-EVIDENCE-0001`, through the commerce adapter.
2. **Record a refund** — `$18.50` against a `$63.90` order, written to
   `order_refunds` with `settled_at` null, because no money moved.
3. **Refuse a refund larger than the order** — `$9,999` on the same order came
   back with a sentence, and no second row was written.
4. **Cancel** — `HS-01088` closed with a reason, and the audit line says
   truthfully that nothing came back onto the shelf, because nothing had left it.
5. **Correct a count** — three bottles off Sale Street, with `damage` and a note
   in the stock ledger.
6. **Open a batch** — `HS-01-260830-A`, with nine ingredient lines copied from
   the recipe and scaled to 120 litres, and the store room drawn down.
7. **Release it** — 240 filled, 4 thrown, 236 on the shelf at Penrose, and a
   `batch_release` ledger entry naming the batch. That is the traceability link.
8. **Set a reorder point** — fresh dill now flags at 9 kg.
9. **Approve a post and diarise it** — the approval is stamped, the post is
   `scheduled`, and `published` is still zero. Nothing went out.
10. **Decline** — with the reason kept on the row, which the schema insists on.
11. **Approve two at once**, and **move an agent's autonomy dial**.
