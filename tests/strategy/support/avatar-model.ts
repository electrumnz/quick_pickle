/**
 * A model that writes only to the avatar it was given.
 *
 * `BriefingModel` next door proves the BrandScript reaches an agent. This is
 * the same idea one layer along: it reads the WHO YOU ARE WRITING TO block out
 * of the composed briefing and writes a caption entirely out of that person —
 * the job they are hiring the bottle for, the trigger that brings them, the
 * thing that stops them, what they price it against, and when they come back.
 *
 * Why not a scripted model: a scripted model returns the same text whatever the
 * prompt says, so it would pass this test with the wiring cut. Why not the real
 * model: there is no key in CI, and the property under test is a property of
 * the wiring rather than of the model.
 *
 * It refuses to write when there is no avatar in the prompt, which is the whole
 * point — if the avatar were decorative, the model could carry on without it.
 */

import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamResult,
} from "@ai-sdk/provider";

export interface ReadAvatar {
  readonly label: string;
  readonly headline: string;
  readonly job: string;
  readonly trigger: string;
  readonly stopper: string;
  readonly anchor: string;
  readonly cadence: string;
}

export class MissingAvatarError extends Error {
  constructor() {
    super(
      "AvatarModel was given no WHO YOU ARE WRITING TO block, so it has nobody to write to.",
    );
    this.name = "MissingAvatarError";
  }
}

const AVATAR_HEADING = "WHO YOU ARE WRITING TO — ";

function systemPromptOf(options: LanguageModelV4CallOptions): string {
  const system = options.prompt.find((message) => message.role === "system");
  return system === undefined ? "" : system.content;
}

function lineAfter(source: string, label: string): string {
  const at = source.indexOf(label);
  if (at === -1) return "";
  const rest = source.slice(at + label.length);
  const end = rest.indexOf("\n");
  return (end === -1 ? rest : rest.slice(0, end)).trim();
}

/** The first bulleted item under a heading. */
function firstBulletUnder(source: string, heading: string): string {
  const at = source.indexOf(heading);
  if (at === -1) return "";
  for (const line of source.slice(at).split("\n").slice(1)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("- ")) return trimmed.slice(2).trim();
    if (trimmed === "") continue;
  }
  return "";
}

export function readAvatar(system: string): ReadAvatar {
  const at = system.indexOf(AVATAR_HEADING);
  if (at === -1) throw new MissingAvatarError();
  const block = system.slice(at);
  return {
    label: lineAfter(system, AVATAR_HEADING),
    headline: block.split("\n")[1]?.trim() ?? "",
    job: lineAfter(block, "THE JOB THEY ARE HIRING THIS FOR: "),
    trigger: firstBulletUnder(block, "WHAT TRIGGERS A PURCHASE"),
    stopper: firstBulletUnder(block, "WHAT STOPS THEM"),
    anchor: lineAfter(block, "They price it against: "),
    cadence: lineAfter(block, "Cadence: "),
  };
}

/**
 * Compose the caption.
 *
 * Mechanical on purpose: every clause is lifted from one named avatar field, so
 * the diff between two captions is exactly the diff between two avatars.
 */
export function composeAvatarCaption(avatar: ReadAvatar): string {
  const trigger = avatar.trigger.split("→")[0]?.trim() ?? avatar.trigger;
  const stopper = avatar.stopper.split("—")[0]?.trim() ?? avatar.stopper;
  return [
    `To: ${avatar.label} — ${avatar.headline}`,
    "",
    `When: ${trigger}`,
    `The job: ${avatar.job}`,
    `What we have to settle first: ${stopper}`,
    `They are pricing it against: ${avatar.anchor}`,
    `Back again: ${avatar.cadence}`,
  ].join("\n");
}

export class AvatarModel implements LanguageModelV4 {
  readonly specificationVersion = "v4" as const;
  readonly provider = "avatar";
  readonly modelId = "claude-opus-5";
  readonly supportedUrls: Record<string, RegExp[]> = {};

  /** Every system prompt this model was handed, in order. */
  readonly systemPrompts: string[] = [];

  async doGenerate(
    options: LanguageModelV4CallOptions,
  ): Promise<LanguageModelV4GenerateResult> {
    const system = systemPromptOf(options);
    this.systemPrompts.push(system);
    const caption = composeAvatarCaption(readAvatar(system));
    return {
      content: [{ type: "text", text: caption }],
      finishReason: { unified: "stop", raw: "end_turn" },
      usage: {
        inputTokens: {
          total: Math.ceil(system.length / 4),
          noCache: Math.ceil(system.length / 4),
          cacheRead: 0,
          cacheWrite: 0,
        },
        outputTokens: {
          total: Math.ceil(caption.length / 4),
          text: Math.ceil(caption.length / 4),
          reasoning: 0,
        },
      },
      warnings: [],
      response: { id: "avatar-1", modelId: this.modelId },
    };
  }

  async doStream(): Promise<LanguageModelV4StreamResult> {
    throw new Error(
      "AvatarModel does not stream; the runtime uses generateText.",
    );
  }
}
