# Parked work

Areas of the back end, as their builders left them on 12 November 2026 when
they were stopped part-way: stock, plans and the inbox. (Marketing was the
fourth. It has been finished and moved in.) They
are kept here, outside everything that is built, linted, tested or scanned,
so that none of it is lost. Nothing in this folder runs.

Each area keeps the paths it will have once it is moved in (`.wip/stock/lib/…`
becomes `lib/…`). A `shared-files.patch` beside an area is its changes to
files it does not own, written against an older commit; apply those by hand.

An area leaves this folder when it has been finished, checked and wired into
the back end's navigation. When the folder is empty, delete it and take
`.wip` back out of `tsconfig.json`, `eslint.config.mjs` and `.prettierignore`.
