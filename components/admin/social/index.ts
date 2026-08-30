/**
 * The two social surfaces: what a post turns into, and when it goes out.
 *
 * `PostPreview` is the picture of one post. `Calendar` is the diary the
 * pictures sit in — the month and the week, the gaps between them in words,
 * and the link from a cell back into the preview.
 *
 * One import, used from inside the approval card and from the queue row
 * beneath it. It is a picture, never a publisher: nothing in this directory
 * reaches a network, and there is no credential in this deployment for it to
 * reach one with.
 *
 * ```tsx
 * import { PostPreview } from "@/components/admin/social";
 *
 * <PostPreview post={post} handles={handles} scope="queue" whenWords="Not in the diary yet" />
 * ```
 *
 * The limits it enforces, and the source of every one of them, are in
 * `lib/social/platforms.ts`.
 */

export { PostPreview } from "./PostPreview";
export {
  CalendarControls,
  CalendarMonth,
  CalendarWeek,
  GapSummary,
  POST_STATES,
  StateLegend,
  UndatedPosts,
  calendarHref,
  dayInShort,
  dayInWords,
  periodTitle,
  periodWords,
  type CalendarView,
} from "./Calendar";
export {
  Counts,
  FacebookPost,
  InstagramFeed,
  InstagramStory,
  LinkedInPost,
  PinterestPin,
  SURFACE_COMPONENTS,
  ThreadsPost,
  TikTokVideo,
  XPost,
  YouTubeVideo,
  columnVars,
  type PreviewPost,
  type SurfaceProps,
} from "./surfaces";
