# The documents

Everything written down about Quick Pickle that is not code.

| Document                                                 | What it is                                                                  |
| :------------------------------------------------------- | :-------------------------------------------------------------------------- |
| [../HANDOVER.md](../HANDOVER.md)                         | For whoever takes the business on. Start there                              |
| [ACCOUNTS.md](ACCOUNTS.md)                               | Every account, setting and key by name, and how each is handed over         |
| [starter](starter/README.md)                             | The drafts the back end starts with: how-to sheets, plans, questions, lists |
| [../TODO.md](../TODO.md)                                 | What is done and what is not, with the reasons                              |
| [../legal/COPY-RULES.md](../legal/COPY-RULES.md)         | What may and may not be said about the product, and why                     |
| [../CLAUDE.md](../CLAUDE.md)                             | The rulebook for changing the code                                          |
| [../lib/backstage/README.md](../lib/backstage/README.md) | How to add an area to the back end                                          |
| [../lib/brand/README.md](../lib/brand/README.md)         | The brand layer: tokens, fonts and art                                      |

`starter/` is written by `npm run docs:export` from the same data the back end loads, and
a test fails if the two differ. Do not edit those files by hand: change the source in
`lib/backstage/plans/starter` and run the command again.

The living brand guide is not a file. It is a page in the back end, drawn from the same
colours, fonts and parts as the shop: `/backstage/brand`.
