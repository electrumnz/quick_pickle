/**
 * The gate, exercised through the runtime that agents actually use.
 *
 * Nothing here calls the consent check directly. Every assertion goes through
 * `invokeTool` on a `ToolRegistry` built the same way the roster's is, because
 * the claim being tested is not "a function returns false" — it is "an agent
 * cannot select an asset whose people-consent is unrecorded".
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { silentLogger } from "@/lib/agents/logger";
import {
  ToolRegistry,
  invokeTool,
  type ToolExecutionContext,
} from "@/lib/agents/tools/registry";
import { ingestFile } from "@/lib/assets/ingest";
import { ASSET_TOOL_NAMES, registerAssetTools } from "@/lib/assets/tools";
import type {
  ConsentState,
  MarketingAsset,
  UsageRights,
} from "@/lib/assets/types";

import { createAssetWorld, type AssetTestWorld } from "./support/db";
import { repoFile } from "./support/fixtures";

let world: AssetTestWorld;
let registry: ToolRegistry;
const assets = new Map<string, MarketingAsset>();

const NOW = new Date("2026-09-20T09:00:00Z");

function context(): ToolExecutionContext {
  return {
    runId: "00000000-0000-4000-8000-000000000001",
    agentSlug: "social",
    toolCallId: "call-1",
    now: NOW,
    logger: silentLogger,
    abortSignal: new AbortController().signal,
  };
}

async function put(input: {
  readonly name: string;
  readonly source: string;
  readonly title: string;
  readonly description: string;
  readonly occasion: string;
  readonly occasionOn: string;
  readonly peoplePresent: boolean;
  readonly consent?: ConsentState;
  readonly rights?: UsageRights;
  readonly rightsExpireOn?: string;
  readonly credit?: string;
  readonly sku?: string;
  readonly tags?: string;
}): Promise<MarketingAsset> {
  const bytes = repoFile(input.source);
  const outcome = await ingestFile(
    { bytes, filename: `${input.name}.jpg` },
    {
      title: input.title,
      description: input.description,
      occasion: input.occasion,
      occasionOn: input.occasionOn,
      peoplePresent: input.peoplePresent,
      peopleConsent: input.consent,
      usageRights: input.rights,
      credit: input.credit,
      rightsExpireOn: input.rightsExpireOn,
      tags: input.tags ?? "",
      variantIds:
        input.sku === undefined
          ? []
          : [
              world.variants.find((variant) => variant.sku === input.sku)
                ?.variantId ?? "",
            ],
    },
    {
      store: world.store,
      storage: world.storage,
      drafter: null,
      operatorId: world.operatorId,
      now: () => NOW,
    },
  );
  if (outcome.status !== "stored") {
    throw new Error(`Fixture did not store: ${JSON.stringify(outcome)}`);
  }
  assets.set(input.name, outcome.asset);
  return outcome.asset;
}

beforeAll(async () => {
  world = await createAssetWorld();
  registry = new ToolRegistry();
  registerAssetTools(registry, { assets: world.store });

  await put({
    name: "stall",
    source: "public/media/bottles/no-01-house.jpg",
    title: "The stall, set up",
    description: "Four bottles on the trestle table, nobody in the frame.",
    occasion: "Grey Lynn market",
    occasionOn: "2026-09-14",
    peoplePresent: false,
    sku: "HS-01-500",
    tags: "market, spring",
  });
  await put({
    name: "crowd",
    source: "public/media/range/range.jpg",
    title: "Two customers at the stall",
    description: "Two people holding bottles, laughing at something off frame.",
    occasion: "Grey Lynn market",
    occasionOn: "2026-09-14",
    peoplePresent: true,
    tags: "market",
  });
  await put({
    name: "bartender",
    source: "public/media/bottles/no-02-dirty.jpg",
    title: "Bartender making a martini",
    description: "A bartender pouring No 02 DIRTY into a mixing glass.",
    occasion: "a bar on Karangahape Road",
    occasionOn: "2026-08-02",
    peoplePresent: true,
    consent: "refused",
    sku: "HS-02-500",
  });
  await put({
    name: "borrowed",
    source: "public/media/bottles/no-03-smoke.jpg",
    title: "Someone else's photo of the range",
    description: "The three bottles on a windowsill.",
    occasion: "sent to us by a stockist",
    occasionOn: "2026-07-11",
    peoplePresent: false,
    rights: "unknown",
  });
  await put({
    name: "expired",
    source: "public/media/bottles/no-04-wild.jpg",
    title: "Licensed shot of No 04",
    description: "A studio photo of No 04 WILD on a dark bench.",
    occasion: "a paid shoot",
    occasionOn: "2026-06-01",
    peoplePresent: false,
    rights: "licensed",
    credit: "Ana Rivers",
    rightsExpireOn: "2026-08-31",
  });
}, 120_000);

afterAll(async () => {
  await world.close();
});

async function run(tool: string, input: unknown): Promise<unknown> {
  return invokeTool(registry.get(tool), input, context());
}

describe("the tools are ordinary tools", () => {
  it("register through the runtime's own registry, read-only", () => {
    for (const name of ASSET_TOOL_NAMES) {
      expect(registry.has(name)).toBe(true);
      expect(registry.get(name).effect).toBe("read");
      // A read tool needs no approval subject, and must not claim one.
      expect(registry.get(name).approval).toBeNull();
    }
  });

  it("refuses arguments that do not fit the schema", async () => {
    await expect(
      run("select_marketing_asset", { assetId: 42 }),
    ).rejects.toThrow(/rejected its arguments/i);
  });
});

describe("an agent cannot select an asset whose consent is unrecorded", () => {
  it("refuses, and says what would fix it", async () => {
    const crowd = assets.get("crowd");
    expect(crowd?.peopleConsent).toBe("unrecorded");
    expect(crowd?.selectableForOutbound).toBe(false);

    await expect(
      run("select_marketing_asset", {
        assetId: crowd?.id ?? "",
        purpose: "A spring market post for Instagram.",
      }),
    ).rejects.toThrow(/nobody has recorded whether they agreed/i);
  });

  it("refuses when someone in it said no, in different words", async () => {
    await expect(
      run("select_marketing_asset", {
        assetId: assets.get("bartender")?.id ?? "",
        purpose: "A martini post.",
      }),
    ).rejects.toThrow(/said no/i);
  });

  it("refuses when nobody recorded where the file came from", async () => {
    await expect(
      run("select_marketing_asset", {
        assetId: assets.get("borrowed")?.id ?? "",
        purpose: "A range shot for the feed.",
      }),
    ).rejects.toThrow(/who owns this file/i);
  });

  it("refuses when the licence has run out — the check the database cannot do", async () => {
    const expired = assets.get("expired");
    // Postgres says yes: consent is settled and the rights are known.
    expect(expired?.selectableForOutbound).toBe(true);
    // The clock says no, and the tool checks the clock.
    await expect(
      run("select_marketing_asset", {
        assetId: expired?.id ?? "",
        purpose: "A No 04 post.",
      }),
    ).rejects.toThrow(/ran out on 2026-08-31/i);
  });

  it("does not leak a usable citation in the failure", async () => {
    try {
      await run("select_marketing_asset", {
        assetId: assets.get("crowd")?.id ?? "",
        purpose: "anything",
      });
      throw new Error("should have refused");
    } catch (cause) {
      expect(String(cause)).not.toContain("storage");
      expect(String(cause)).not.toContain(
        assets.get("crowd")?.storageKey ?? "!",
      );
    }
  });

  it("selects the one that is cleared, and hands back a citation to attach", async () => {
    const result = (await run("select_marketing_asset", {
      assetId: assets.get("stall")?.id ?? "",
      purpose: "A spring market post.",
    })) as {
      selected: boolean;
      asset: { assetId: string; products: string[]; fitsFrames: string[] };
      attachToYourProposal: { assetIds: string[] };
    };
    expect(result.selected).toBe(true);
    expect(result.asset.assetId).toBe(assets.get("stall")?.id);
    expect(result.asset.products).toEqual(["HS-01-500"]);
    expect(result.attachToYourProposal.assetIds).toEqual([
      assets.get("stall")?.id,
    ]);
    // No key, no URL, nothing fetchable outside the admin session.
    expect(JSON.stringify(result)).not.toContain("photos/2026");
  });
});

describe("searching", () => {
  it("returns only what may be used, by default", async () => {
    const result = (await run("find_marketing_assets", {})) as {
      assets: { assetId: string; title: string }[];
      blocked: unknown[];
    };
    const titles = result.assets.map((asset) => asset.title);
    expect(titles).toContain("The stall, set up");
    expect(titles).not.toContain("Two customers at the stall");
    expect(titles).not.toContain("Bartender making a martini");
    expect(titles).not.toContain("Someone else's photo of the range");
    expect(result.blocked).toHaveLength(0);
  });

  it("can list what is blocked, with the reason and the fix, and nothing else", async () => {
    const result = (await run("find_marketing_assets", {
      include: "blocked",
    })) as {
      assets: unknown[];
      blocked: { title: string; why: string; whatWouldFixIt: string }[];
    };
    expect(result.assets).toHaveLength(0);
    const crowd = result.blocked.find(
      (entry) => entry.title === "Two customers at the stall",
    );
    expect(crowd?.why).toMatch(/nobody has recorded/i);
    expect(crowd?.whatWouldFixIt).toMatch(/record their answer/i);
    // A blocked entry carries no description an agent could caption from.
    expect(JSON.stringify(result)).not.toContain("laughing at something");
  });

  it("filters by occasion, product, tag and date", async () => {
    const byOccasion = (await run("find_marketing_assets", {
      occasion: "market",
    })) as { assets: { title: string }[] };
    expect(byOccasion.assets.map((asset) => asset.title)).toEqual([
      "The stall, set up",
    ]);

    const bySku = (await run("find_marketing_assets", {
      sku: "HS-02-500",
    })) as {
      assets: unknown[];
    };
    expect(bySku.assets).toHaveLength(0); // the only HS-02 photo is refused

    const byTag = (await run("find_marketing_assets", { tag: "spring" })) as {
      assets: { title: string }[];
    };
    expect(byTag.assets).toHaveLength(1);

    const bySeason = (await run("find_marketing_assets", {
      from: "2026-09-01",
      to: "2026-09-30",
    })) as { assets: { title: string }[] };
    expect(bySeason.assets).toHaveLength(1);

    const wrongSeason = (await run("find_marketing_assets", {
      from: "2026-12-01",
      to: "2026-12-31",
    })) as { assets: unknown[] };
    expect(wrongSeason.assets).toHaveLength(0);
  });

  it("filters by the shape of the frame the post needs", async () => {
    const portrait = (await run("find_marketing_assets", {
      frame: "portrait_post",
    })) as { assets: { shape: string; fitsFrames: string[] }[] };
    expect(portrait.assets.length).toBeGreaterThan(0);
    expect(portrait.assets[0]?.shape).toBe("portrait");
    expect(portrait.assets[0]?.fitsFrames).toContain("portrait_post");

    const wide = (await run("find_marketing_assets", { frame: "wide" })) as {
      assets: unknown[];
    };
    expect(wide.assets).toHaveLength(0);
  });

  it("tells the agent whose words the description is", async () => {
    const result = (await run("find_marketing_assets", {})) as {
      assets: { descriptionBy: string }[];
    };
    expect(result.assets[0]?.descriptionBy).toBe("the founder");
  });
});
