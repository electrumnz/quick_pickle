/**
 * The post preview — what a queued post turns into on each platform.
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
