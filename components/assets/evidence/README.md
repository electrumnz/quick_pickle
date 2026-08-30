# Evidence — the asset library

Every image here was taken by `capture.mjs` driving a real browser against a
real server, signed in through the real login form. Nothing is mocked: the files
in the screenshots were uploaded through the form on the page, and the checks in
`measurements.json` were made against the bytes the admin actually served back.

```bash
BASE=http://localhost:3000 ADMIN_PASSWORD='…' \
  node components/assets/evidence/capture.mjs
```

| File                      | What it shows                                                                                                                                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `empty-*.png`             | The first screen she ever sees, with nothing in the library. It teaches rather than reports: what to put here, why the date matters, and that a photo with a person in it is unusable until consent is recorded. |
| `library-*.png`           | The library with photos and a clip in it, filters above, and the consent state on every card.                                                                                                                    |
| `blocked-*.png`           | One photo with people in it: "The team cannot use this one", the reason, and what would fix it.                                                                                                                  |
| `cleared-*.png`           | The same photo after consent is recorded through the form: the gate has flipped to "Cleared for use".                                                                                                            |
| `clip-*.png`              | A video: poster frame, controls, and nothing playing.                                                                                                                                                            |
| `one-file-1440-light.png` | The detail page for the photograph that arrived carrying GPS.                                                                                                                                                    |
| `measurements.json`       | Every check, with the numbers.                                                                                                                                                                                   |
| `vision-draft.json`       | One live call to the vision model through `lib/assets/describe.ts`, with what it wrote about a real photo and the claim check on that text.                                                                      |

Each screenshot exists at 1440 and 375, in light and dark.

## What `measurements.json` proves

- **A photograph carrying GPS goes in, and no EXIF comes back out.** The script
  builds a real EXIF block with a GPS IFD, injects it into a real photo from this
  repository, uploads it, then fetches the stored file from the admin and scans
  the bytes: `uploadedHadExifBlock: true`, `servedHasExifBlock: false`,
  `servedHasExifMarker: false`. The page says "found, and removed".
- **A mislabelled file is turned away in the interface**, with the sentence the
  founder actually reads.
- **The clip has a poster frame the browser captured**, and the stored video
  still decodes — `videoWidth` and `videoHeight` are read off the element on the
  page — with `hasAutoplayAttribute: false`, `paused: true`, `muted: true`.
- **A photo with people in it lands unusable** and the detail page refuses in
  words.
- **The file route**: content type from the database, `nosniff`, a
  `default-src 'none'; sandbox` CSP, `Content-Disposition` with a generated
  filename, a 206 for a range request, 404 for a path-traversal key, and 404 for
  a browser with no session.

## The one thing this browser cannot do

Playwright ships an open-source Chromium with no H.264 decoder, so it cannot
read the repository's own MP4: it captures no poster frame from one and draws
nothing. That is this browser, not the library — Chrome, Safari and Edge all
decode H.264, and the file is stored and scrubbed either way, which the
measurements record.

So the clip that proves the poster capture and the playback is a WebM the
browser records for itself, from a canvas, at the start of the run, and then
uploads through the same form as everything else.
