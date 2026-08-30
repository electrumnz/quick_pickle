import { count } from "@/components/admin/data/format";
import type { SocialPostItem } from "@/components/admin/data/queries";
import { Callout } from "@/components/admin";
import { Disclosure } from "@/components/admin/ui/controls";
// Imported from the module rather than the `@/lib/assets` barrel: the barrel
// also carries the agent tool registry, and this component needs one pure
// function that imports nothing at all.
import { checkGeneratedText } from "@/lib/assets/claim-guard";
import {
  DEVICE_VIEWPORT,
  DEVICE_WORDS,
  DEVICES,
  fullCaption,
  surfacesForPost,
} from "@/lib/social";

import styles from "./preview.module.css";
import {
  Counts,
  SURFACE_COMPONENTS,
  columnVars,
  type PreviewPost,
} from "./surfaces";

/**
 * What the post will look like, before she says yes.
 *
 * The Social page could already approve, reword, diarise and decline a post.
 * What it could not do was show her the post: she was approving a caption in a
 * table row and hoping. This is the missing half — the caption rendered the way
 * each platform will actually render it, at a phone, a tablet and a desktop
 * width, with every limit it is about to hit shown being hit.
 *
 * ## The three decisions in it
 *
 * **It is honest before it is pretty.** Every number comes from
 * `lib/social/platforms.ts`, which records for each one whether the platform
 * published it or somebody measured it off the running product, and prints that
 * on screen under &ldquo;Where these numbers come from&rdquo;. Where no
 * trustworthy figure exists — Threads', YouTube's and Pinterest's fold points —
 * nothing is drawn and the panel says so. A confident wrong line is the failure
 * this screen exists to prevent, so it is not allowed to be one of its own
 * outputs.
 *
 * **It is an approximation, not a facsimile.** No platform logo, icon, typeface
 * or brand colour is reproduced; see the note at the top of `surfaces.tsx` for
 * where that line is drawn and why. What is reproduced is the order, the
 * proportion, the crop and the cut.
 *
 * **It switches with no JavaScript.** Two radio groups and `:has()` in
 * `preview.module.css`. The whole admin works with scripting off and this is
 * not going to be the one screen that does not; it also means the preview is
 * there in a printout and in the first paint, which is when she looks at it.
 *
 * **Nothing here publishes.** There is no credential in this deployment, no
 * OAuth flow, and no code path from this component to a network. Approving a
 * post writes a row and stops; the outbox records it with `delivered: false`.
 * That is said on the face of the component, in those words, because the
 * difference between "approved" and "sent" is the whole safety model.
 */
export function PostPreview({
  post,
  handles,
  scope,
  whenWords,
}: {
  post: SocialPostItem;
  /** Platform to the handle on the connected account, where there is one. */
  handles: Readonly<Record<string, string | null>>;
  /**
   * Which part of the page this copy is in. A post appears twice — once as the
   * decision at the top, once in the queue below — and two radio groups with
   * the same `name` would fight each other.
   */
  scope: string;
  /** When it is pencilled in for, in her words. Never a promise that it sends. */
  whenWords: string;
}) {
  const surfaces = surfacesForPost(post.platform);
  const text = fullCaption(post.caption, post.hashtags);
  // The library's claim guard, reached from the admin. It is a deliberately
  // small subset of the health, therapeutic and sports-drink groups that
  // `legal/COPY-RULES.md` bans on every surface; the audit script is the
  // authority and this is an early warning. See the note below the callout.
  const claims = checkGeneratedText(text);
  const headingId = `pv-heading-${scope}-${post.id}`;
  const surfaceName = `pv-surface-${scope}-${post.id}`;
  const deviceName = `pv-device-${scope}-${post.id}`;

  const previewPost: PreviewPost = {
    text,
    linkUrl: post.linkUrl,
    media: post.media,
    handles,
    displayName: "Half Sour",
    whenWords,
  };

  return (
    // Deliberately an unnamed section rather than a labelled one. A `<section>`
    // with an accessible name is a `region` landmark, and one post can appear
    // twice on this page — as the decision at the top and as the row below it —
    // which put two landmarks called "How it would look" in the same document
    // and tripped axe's `landmark-unique`. Landmarks are for the parts of a
    // page, not for a component that repeats inside one; the heading below is
    // what gives this its place in the outline, and it still does.
    <section className={styles.root}>
      <h3
        id={headingId}
        className="font-sans text-body-sm font-semibold text-primary"
      >
        How it would look
      </h3>
      <p className="mt-1 max-w-prose text-caption text-muted">
        An approximation of each platform&rsquo;s layout drawn in this
        admin&rsquo;s own type and colour — the order, the proportions, the crop
        and the exact character the caption is cut at. The picture inside it is
        the real file at the real crop; everything around the picture is drawn
        here. It is not a screenshot and no platform&rsquo;s logo or interface
        is copied.{" "}
        <strong className="font-semibold text-primary">
          Nothing here is connected.
        </strong>{" "}
        No account is wired to this deployment, so nothing on this screen can
        post, schedule or send anything.
      </p>

      {!claims.clean && (
        <div className="mt-3">
          <Callout title="This caption trips the claim guard" tone="danger">
            <p>
              {claims.matched.map((word) => `“${word}”`).join(", ")} —{" "}
              {claims.matched.length === 1
                ? "that word makes"
                : "those words make"}{" "}
              a claim about what the product does to a person, which{" "}
              <code>legal/COPY-RULES.md</code> forbids everywhere, a caption
              included. Reword it before you approve it.
            </p>
            <p className="mt-1.5">
              This is the early warning, not the ruling.{" "}
              <code>legal/scripts/audit-copy.mjs</code> is what enforces the
              rules and it reads more than this does.
            </p>
          </Callout>
        </div>
      )}

      <fieldset className="mt-3 min-w-0 border-0 p-0">
        <legend className="text-caption text-muted">Show it as</legend>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {surfaces.map((surface, index) => {
            const id = `${surfaceName}-${surface.id}`;
            return (
              <span key={surface.id} className="relative inline-flex">
                <input
                  id={id}
                  className={styles.pick}
                  data-pick={surface.id}
                  type="radio"
                  name={surfaceName}
                  value={surface.id}
                  defaultChecked={index === 0}
                />
                <label htmlFor={id} className={styles.chip}>
                  {surface.tab}
                </label>
              </span>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="mt-3 min-w-0 border-0 p-0">
        <legend className="text-caption text-muted">At what width</legend>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {DEVICES.map((device, index) => {
            const id = `${deviceName}-${device}`;
            return (
              <span key={device} className="relative inline-flex">
                <input
                  id={id}
                  className={styles.pick}
                  data-device={device}
                  type="radio"
                  name={deviceName}
                  value={device}
                  defaultChecked={index === 0}
                />
                <label htmlFor={id} className={styles.chip}>
                  {DEVICE_WORDS[device]}, {count(DEVICE_VIEWPORT[device])}px
                </label>
              </span>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-4">
        {surfaces.map((surface) => {
          const Surface = SURFACE_COMPONENTS[surface.id];
          if (Surface === undefined) return null;
          return (
            <div
              key={surface.id}
              className={styles.panel}
              data-panel={surface.id}
              style={columnVars(surface)}
            >
              <Surface surface={surface} post={previewPost} />
              <Counts surface={surface} post={previewPost} />
              <p className="mt-2 max-w-prose text-caption text-muted">
                {surface.caveat}
              </p>
              <div className="mt-2">
                <Disclosure label="Where these numbers come from">
                  <ul className="space-y-2">
                    {surface.sources.map((source) => (
                      <li key={source.url + source.what}>
                        <p className="text-caption text-primary">
                          {source.what}
                        </p>
                        <p className="text-caption text-muted">
                          {source.kind === "published"
                            ? "Published by the platform"
                            : "Measured, not published — it can move without notice"}
                          {" · "}
                          {source.where} · read {source.checked}
                        </p>
                        <p className="text-caption break-all text-muted">
                          {source.url}
                        </p>
                      </li>
                    ))}
                  </ul>
                </Disclosure>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
