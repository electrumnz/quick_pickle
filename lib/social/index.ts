/**
 * `lib/social` — what a platform will do to a post, before it is approved.
 *
 * Plain data and pure functions, no imports outside this directory, so it is
 * safe in a client component and identical in a test.
 *
 * | Module         | What it is                                              |
 * | -------------- | ------------------------------------------------------- |
 * | `platforms.ts` | The enum mirror, the per-surface limits, and the sources |
 * | `measure.ts`   | Counting, folding and cropping, the way each one does it |
 *
 * The components that draw it are in `components/admin/social`. Nothing in
 * either directory posts anything: there is no credential in this deployment
 * and no code path out of it.
 */

export {
  DEVICE_VIEWPORT,
  DEVICE_WORDS,
  DEVICES,
  PREVIEW_SURFACES,
  SOCIAL_PLATFORMS,
  SURFACES,
  isSocialPlatform,
  surfacesFor,
  surfacesForPost,
  type CaptionRule,
  type CountingRule,
  type Device,
  type Frame,
  type PreviewSurface,
  type SocialPlatform,
  type Source,
  type SurfaceSpec,
} from "./platforms";

export {
  captionLength,
  collapse,
  countingWords,
  cropPlan,
  fullCaption,
  hashtagsIn,
  mentionsIn,
  ratioWords,
  urlsIn,
  utf16Length,
  utf8Length,
  weightedLength,
  type CountingRuleName,
  type CropPlan,
  type Truncation,
} from "./measure";
