# Parked work

One area of the back end, as its builder left it on 12 November 2026 when it
was stopped part-way: the inbox (`mail`). (Marketing, plans and stock were the
other three. They have been finished and moved in.) It is kept here, outside
everything that is built, linted, tested or scanned, so that none of it is
lost. Nothing in this folder runs.

Half of `mail` has left already: sending (`lib/mail`), the outbox
(`lib/backstage/mail/outbound.ts`) and an order's emails. What is still here
is the other half, mail coming in: the two inbound doors, parsing, threading
and the inbox's own operations. Where a file here and a file out there share
a name (`conversations.ts`, `resend.ts`), the one out there holds the part
that was needed for sending and this one is the whole of the original.

An area keeps the paths it will have once it is moved in (`.wip/mail/lib/…`
becomes `lib/…`). A `shared-files.patch` beside an area is its changes to
files it does not own, written against an older commit; apply those by hand.

An area leaves this folder when it has been finished, checked and wired into
the back end's navigation. When the folder is empty, delete it and take
`.wip` back out of `tsconfig.json`, `eslint.config.mjs` and `.prettierignore`.
