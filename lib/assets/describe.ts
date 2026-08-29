import "server-only";

/**
 * A first draft of "what is in this picture", from a vision model.
 *
 * The founder's words always win. This exists because the honest default
 * description — "nobody has written down what is in it yet" — is a description
 * an agent will refuse to use, and a library of undescribed files is a folder.
 * A draft gives her something to correct in five seconds instead of something
 * to compose from nothing.
 *
 * Three rules hold it in place:
 *
 *  1. **A draft is labelled as a draft, everywhere.** `description_source` is
 *     `model_draft` until she touches it, the admin says so on the card and on
 *     the detail page, and the agent-facing payload carries the same flag. She
 *     is never shown a machine sentence dressed as hers.
 *  2. **A draft is checked before it is stored.** See `claim-guard.ts`: model
 *     output is the one place text arrives from outside the company, and a
 *     draft containing a health or therapeutic word is discarded, not filed.
 *  3. **It is optional.** No `REPLICATE_API_TOKEN`, no drafter, no error: the
 *     upload succeeds with the plain default description. Nothing in the
 *     library depends on a model being reachable.
 */

import { checkGeneratedText } from "./claim-guard";

export interface DescriptionDraft {
  readonly text: string;
  readonly model: string;
}

export interface DescriptionDrafter {
  /** Null whenever a draft could not be produced, for any reason. */
  draft(input: {
    readonly bytes: Uint8Array;
    readonly mimeType: string;
    /** What she has already told us, if anything: the occasion, the products. */
    readonly hint?: string | null;
  }): Promise<DescriptionDraft | null>;
}

const DEFAULT_MODEL = "yorickvp/llava-13b";

/**
 * The instruction the model is given.
 *
 * Written to produce a caption-library entry rather than a caption: what is in
 * the frame, where it looks like it was taken, who is in it. It asks for plain
 * observation on purpose — an enthusiastic model writes marketing copy, and
 * marketing copy from a model is exactly what must not reach a caption.
 */
const PROMPT =
  "Describe what is visible in this photograph in one plain sentence for an " +
  "internal picture library. Name the objects, the people and the setting. " +
  "Do not use adjectives of praise, do not guess at a brand, and do not say " +
  "anything about how the food or drink affects a person.";

export interface ReplicateConfig {
  readonly token: string;
  readonly model: string;
  /** Pinned version hash. Resolved from the model when absent. */
  readonly version: string | null;
  readonly timeoutMs: number;
}

/**
 * Replicate, over `fetch`.
 *
 * `Prefer: wait` turns the create call into a synchronous one for up to a
 * minute, which is the difference between an upload that waits once and an
 * upload that has to poll. Anything slower than that gives up and the founder
 * writes her own line — which she was going to do anyway.
 */
export class ReplicateDescriptionDrafter implements DescriptionDrafter {
  constructor(private readonly config: ReplicateConfig) {}

  async draft(input: {
    readonly bytes: Uint8Array;
    readonly mimeType: string;
    readonly hint?: string | null;
  }): Promise<DescriptionDraft | null> {
    if (!input.mimeType.startsWith("image/")) return null;
    // A poster frame is an image; a 200 MB video is not something to base64.
    if (input.bytes.length > 6 * 1024 * 1024) return null;

    try {
      const version = await this.resolveVersion();
      if (version === null) return null;
      const dataUri = `data:${input.mimeType};base64,${Buffer.from(input.bytes).toString("base64")}`;
      const response = await fetch("https://api.replicate.com/v1/predictions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.config.token}`,
          "content-type": "application/json",
          prefer: "wait=60",
        },
        body: JSON.stringify({
          version,
          input: {
            image: dataUri,
            prompt:
              input.hint === undefined || input.hint === null || input.hint === ""
                ? PROMPT
                : `${PROMPT} Context you may use if it matches what you can see: ${input.hint}`,
            max_tokens: 120,
            temperature: 0.2,
          },
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
      if (!response.ok) return null;
      const payload: unknown = await response.json();
      const text = readOutput(payload);
      if (text === null) return null;

      const check = checkGeneratedText(text);
      if (!check.clean) return null;
      return { text, model: this.config.model };
    } catch {
      // A drafter that throws would fail an upload that is otherwise perfect.
      return null;
    }
  }

  private async resolveVersion(): Promise<string | null> {
    if (this.config.version !== null) return this.config.version;
    const response = await fetch(
      `https://api.replicate.com/v1/models/${this.config.model}`,
      {
        headers: { authorization: `Bearer ${this.config.token}` },
        signal: AbortSignal.timeout(this.config.timeoutMs),
      },
    );
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    if (typeof payload !== "object" || payload === null) return null;
    const latest = (payload as Record<string, unknown>)["latest_version"];
    if (typeof latest !== "object" || latest === null) return null;
    const id = (latest as Record<string, unknown>)["id"];
    return typeof id === "string" ? id : null;
  }
}

/** Replicate returns a stream of string fragments for a language model. */
function readOutput(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const output = (payload as Record<string, unknown>)["output"];
  const text = Array.isArray(output)
    ? output.filter((part): part is string => typeof part === "string").join("")
    : typeof output === "string"
      ? output
      : "";
  const cleaned = text.trim().replace(/\s+/g, " ");
  if (cleaned.length < 8) return null;
  return cleaned.slice(0, 400);
}

export type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * The drafter, or null when the environment has not been given a key.
 *
 * Null is a supported state, not a failure: the library works without it.
 */
export function getDescriptionDrafter(
  env: EnvSource = process.env,
): DescriptionDrafter | null {
  const token = env.REPLICATE_API_TOKEN?.trim();
  if (token === undefined || token === "") return null;
  if (env.ASSET_VISION_DRAFTS?.trim().toLowerCase() === "off") return null;
  const version = env.ASSET_VISION_VERSION?.trim();
  return new ReplicateDescriptionDrafter({
    token,
    model: env.ASSET_VISION_MODEL?.trim() ?? DEFAULT_MODEL,
    version: version === undefined || version === "" ? null : version,
    timeoutMs: 70_000,
  });
}
