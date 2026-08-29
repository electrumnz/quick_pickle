/**
 * The two tools an agent gets.
 *
 * They are declared with the runtime's own `defineTool` and handed to the
 * runtime's own `ToolRegistry`, exactly like every other tool in the company —
 * there is no second registry, no bypass, and no privileged path into the
 * library. Both are `effect: "read"`, which is the truth: they observe. Nothing
 * here writes a row, sends anything, or publishes anything.
 *
 * **The gate lives in the tool, not in the interface.**
 * `select_marketing_asset` calls `assertSelectableForOutbound`, which throws.
 * An agent whose model decides to use a photograph of somebody who has not been
 * asked gets an error in its transcript, not a warning it can talk itself past.
 * The search tool applies the same rule in SQL, so an unusable asset is not
 * even in the list unless the caller explicitly asked to see what is blocked —
 * and asking for that returns the reason and the fix, never a usable citation.
 *
 * **Selecting is not publishing.** What comes back is a citation: an id, a
 * description, the shape, and the admin path to look at it. The agent puts that
 * citation in the payload of whatever it proposes, and the proposal goes through
 * `approvals` like every other outbound act. There is no URL in the payload that
 * anyone outside the admin session could fetch, and no second path to the world.
 */

import { z } from "zod";

import {
  defineTool,
  ToolRegistry,
  type ToolDefinition,
} from "@/lib/agents/tools/registry";

import { assertSelectableForOutbound, outboundVerdict } from "./consent";
import {
  aspectBucket,
  framesFor,
  FRAME_NAMES,
  type MarketingAsset,
} from "./types";
import type { AssetFilter, AssetStore } from "./store/types";

/** The slice of the store a tool is allowed to see. Reads only. */
export type AssetLibraryReads = Pick<AssetStore, "list" | "get">;

export interface AssetToolPorts {
  readonly assets: AssetLibraryReads;
}

/** What an agent is told about one asset. Never a storage key, never a URL. */
export interface AssetCitation {
  readonly assetId: string;
  readonly title: string;
  readonly description: string;
  /** "founder" or "model_draft" — the agent is told whose words these are. */
  readonly descriptionBy: string;
  readonly kind: string;
  readonly occasion: string | null;
  readonly occasionOn: string | null;
  readonly shape: string;
  readonly aspectRatio: number | null;
  readonly fitsFrames: readonly string[];
  readonly products: readonly string[];
  readonly tags: readonly string[];
  readonly seconds: number | null;
  readonly consent: string;
  readonly rights: string;
  /** Where the founder can look at it. An admin path, behind the admin gate. */
  readonly adminPath: string;
}

export function citationFor(asset: MarketingAsset): AssetCitation {
  return {
    assetId: asset.id,
    title: asset.title,
    description: asset.description,
    descriptionBy:
      asset.descriptionSource === "founder"
        ? "the founder"
        : asset.descriptionSource === "model_edited"
          ? "a model draft the founder edited"
          : "an unedited model draft — treat it as a guess",
    kind: asset.kind,
    occasion: asset.occasion,
    occasionOn: asset.occasionOn,
    shape: aspectBucket(asset.aspectRatio),
    aspectRatio: asset.aspectRatio,
    fitsFrames: framesFor(asset.aspectRatio),
    products: asset.products.map((product) => product.sku),
    tags: asset.tags,
    seconds:
      asset.durationMs === null ? null : Math.round(asset.durationMs / 100) / 10,
    consent:
      asset.peopleConsent === "no_people"
        ? "nobody identifiable in it"
        : "the people in it agreed",
    rights: asset.usageRights,
    adminPath: `/admin/assets/${asset.id}`,
  };
}

const findSchema = z.object({
  occasion: z
    .string()
    .max(120)
    .nullable()
    .default(null)
    .describe("Part of the occasion, e.g. 'market' or 'bar'."),
  sku: z
    .string()
    .max(40)
    .nullable()
    .default(null)
    .describe("Only assets with this product in them, e.g. HS-02-500."),
  tag: z.string().max(40).nullable().default(null),
  search: z
    .string()
    .max(120)
    .nullable()
    .default(null)
    .describe("Words to look for in the title, the description or the tags."),
  frame: z
    .enum(FRAME_NAMES as unknown as [string, ...string[]])
    .nullable()
    .default(null)
    .describe(
      "The shape the post needs: story (9:16), portrait_post (4:5), square (1:1) or wide (16:9).",
    ),
  kind: z
    .enum(["photo", "video"])
    .nullable()
    .default(null),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null)
    .describe("Earliest occasion date, YYYY-MM-DD. Use it to keep the season right."),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null)
    .describe("Latest occasion date, YYYY-MM-DD."),
  include: z
    .enum(["usable", "blocked", "all"])
    .default("usable")
    .describe(
      "'usable' is everything you may actually choose. 'blocked' lists what is waiting on a consent or rights decision, with the reason, so you can ask for one. You cannot select a blocked asset either way.",
    ),
  limit: z.number().int().min(1).max(40).default(12),
});

const selectSchema = z.object({
  assetId: z.string().min(1).describe("The assetId from find_marketing_assets."),
  purpose: z
    .string()
    .min(1)
    .max(400)
    .describe(
      "What you intend to use it for, in one line. It is recorded in the transcript the founder reads.",
    ),
});

export interface AssetTools {
  readonly all: readonly ToolDefinition[];
  readonly byName: Readonly<Record<string, ToolDefinition>>;
}

export const ASSET_TOOL_NAMES = [
  "find_marketing_assets",
  "select_marketing_asset",
] as const;

export function createAssetTools(ports: AssetToolPorts): AssetTools {
  const findMarketingAssets = defineTool({
    name: "find_marketing_assets",
    title: "Find a photo or a clip",
    description:
      "Search the founder's own photos and video by occasion, product, tag, date and the shape of the frame you need. Read-only. Only assets whose people-consent and usage rights are settled can be chosen; the rest are visible only if you ask for what is blocked, and cannot be selected.",
    effect: "read",
    inputSchema: findSchema,
    execute: async (input) => {
      const base: AssetFilter = {
        occasion: input.occasion,
        sku: input.sku,
        tag: input.tag,
        search: input.search,
        frame: (input.frame ?? null) as AssetFilter["frame"],
        kind: input.kind,
        from: input.from,
        to: input.to,
        limit: input.limit,
      };

      const usable =
        input.include === "blocked"
          ? []
          : await ports.assets.list({ ...base, onlySelectable: true });

      const blocked =
        input.include === "usable"
          ? []
          : (await ports.assets.list(base))
              .filter((asset) => !asset.selectableForOutbound)
              .map((asset) => {
                const verdict = outboundVerdict(asset);
                return {
                  assetId: asset.id,
                  title: asset.title,
                  why: verdict.allowed ? "unknown" : verdict.reason,
                  whatWouldFixIt: verdict.allowed ? "" : verdict.fix,
                  adminPath: `/admin/assets/${asset.id}`,
                };
              });

      return {
        headline:
          usable.length === 0
            ? "Nothing in the library matches that and is cleared for use."
            : `${String(usable.length)} of the founder's own ${usable.length === 1 ? "file" : "files"} match and are cleared for use.`,
        assets: usable.map(citationFor),
        blocked,
        howToUse:
          "Cite an asset by putting its assetId in the payload of whatever you propose. The founder sees the picture beside your words when she decides.",
      };
    },
  });

  const selectMarketingAsset = defineTool({
    name: "select_marketing_asset",
    title: "Choose one for a draft",
    description:
      "Confirm one asset for something that will leave the company, and get the citation to attach to your proposal. Refuses outright when the people in it have not agreed, when consent has not been recorded, or when the usage rights are unknown or expired. Selecting is not publishing: the proposal still goes to the approvals queue.",
    effect: "read",
    inputSchema: selectSchema,
    execute: async (input, context) => {
      const asset = await ports.assets.get(input.assetId);
      if (asset === null) {
        return {
          selected: false,
          reason: `There is no asset with the id ${input.assetId}. Search again.`,
        };
      }
      // Throws. There is no branch here that returns a citation anyway.
      assertSelectableForOutbound(asset, context.now);

      return {
        selected: true,
        purpose: input.purpose,
        asset: citationFor(asset),
        attachToYourProposal: { assetIds: [asset.id] },
        reminder:
          "Put assetIds in the payload of the tool call you make next. Nothing is published by this tool.",
      };
    },
  });

  const all = [findMarketingAssets, selectMarketingAsset] as const;
  const byName: Record<string, ToolDefinition> = {};
  for (const tool of all) byName[tool.name] = tool;
  return { all, byName };
}

/**
 * Add the asset tools to an existing registry.
 *
 * This is the whole integration: the composition root that builds the roster's
 * registry calls this, and then a role that should be able to look at the
 * library gets `find_marketing_assets` and `select_marketing_asset` in its
 * `tools` list, like any other grant. No change to the runtime, no change to the
 * authorisation model.
 */
export function registerAssetTools(
  registry: ToolRegistry,
  ports: AssetToolPorts,
): readonly ToolDefinition[] {
  const tools = createAssetTools(ports);
  for (const tool of tools.all) registry.register(tool);
  return tools.all;
}
