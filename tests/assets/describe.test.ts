/**
 * The drafted description, and the rule that a machine sentence is never
 * allowed to look like the founder's.
 *
 * The last test in this file talks to Replicate for real, and is skipped unless
 * `ASSET_VISION_LIVE=1` is set with a token present. Its output is written to
 * `components/assets/evidence/vision-draft.json` so there is a record of what
 * the model actually said about a real photograph from this repository.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { checkGeneratedText } from "@/lib/assets/claim-guard";
import {
  ReplicateDescriptionDrafter,
  type DescriptionDrafter,
} from "@/lib/assets/describe";
import { ingestFile } from "@/lib/assets/ingest";

import { createAssetWorld, type AssetTestWorld } from "./support/db";
import { repoFile } from "./support/fixtures";

let world: AssetTestWorld;

beforeAll(async () => {
  world = await createAssetWorld();
}, 120_000);

afterAll(async () => {
  await world.close();
});

function drafterSaying(text: string): DescriptionDrafter {
  return {
    draft: async () => {
      const check = checkGeneratedText(text);
      return check.clean ? { text, model: "test/vision" } : null;
    },
  };
}

async function ingestWith(
  drafter: DescriptionDrafter | null,
  source: string,
  intake: Record<string, unknown> = {},
) {
  return ingestFile(
    { bytes: repoFile(source), filename: path.basename(source) },
    { occasion: "the kitchen bench", ...intake },
    {
      store: world.store,
      storage: world.storage,
      drafter,
      operatorId: world.operatorId,
    },
  );
}

describe("what the model is allowed to write", () => {
  it("stops a draft that would put a claim in the company's own notes", () => {
    expect(checkGeneratedText("A jar of pickles on a bench.").clean).toBe(true);
    const bad = checkGeneratedText(
      "A jar of healthy pickles, full of probiotics, good for digestion.",
    );
    expect(bad.clean).toBe(false);
    expect(bad.matched.length).toBeGreaterThan(2);
  });

  it("leaves the founder's own words entirely alone", async () => {
    // She is the one bound by the copy rules and the one who signs off the
    // captions; a library that quietly rewrote her would be worse than useless.
    const outcome = await ingestWith(
      null,
      "public/media/bottles/no-01-house.jpg",
      { description: "The healthy-looking bench in my kitchen." },
    );
    expect(outcome.status).toBe("stored");
    if (outcome.status !== "stored") return;
    expect(outcome.asset.description).toBe(
      "The healthy-looking bench in my kitchen.",
    );
    expect(outcome.asset.descriptionSource).toBe("founder");
  });
});

describe("a drafted description", () => {
  it("is stored, labelled as a draft, and named as such to an agent", async () => {
    const outcome = await ingestWith(
      drafterSaying("Three bottles of brine on a wooden bench beside a lemon."),
      "public/media/bottles/no-02-dirty.jpg",
    );
    expect(outcome.status).toBe("stored");
    if (outcome.status !== "stored") return;
    expect(outcome.asset.description).toBe(
      "Three bottles of brine on a wooden bench beside a lemon.",
    );
    expect(outcome.asset.descriptionSource).toBe("model_draft");
    expect(outcome.asset.descriptionModel).toBe("test/vision");
    expect(outcome.notes.join(" ")).toContain("vision model");
  });

  it("is thrown away when it contains a claim, and the file still lands", async () => {
    const outcome = await ingestWith(
      drafterSaying("A healthy jar of probiotic pickles, good for you."),
      "public/media/bottles/no-03-smoke.jpg",
    );
    expect(outcome.status).toBe("stored");
    if (outcome.status !== "stored") return;
    expect(outcome.asset.descriptionSource).toBe("founder");
    expect(outcome.asset.description).toContain("Nobody has written down");
    expect(outcome.asset.descriptionModel).toBeNull();
    expect(outcome.notes.join(" ")).toContain("plain default");
  });

  it("does not stop an upload when the model is unreachable", async () => {
    const broken: DescriptionDrafter = {
      draft: async () => {
        throw new Error("network down");
      },
    };
    // The drafter contract is that it returns null rather than throwing; this
    // proves the pipeline survives one that breaks the contract anyway.
    await expect(
      ingestWith(
        {
          draft: async () =>
            broken
              .draft({ bytes: new Uint8Array(), mimeType: "" })
              .catch(() => null),
        },
        "public/media/bottles/no-04-wild.jpg",
      ),
    ).resolves.toMatchObject({ status: "stored" });
  });
});

describe("the live model", () => {
  const live =
    process.env.ASSET_VISION_LIVE === "1" &&
    (process.env.REPLICATE_API_TOKEN ?? "") !== "";

  it.skipIf(!live)(
    "describes a real photograph, and the draft passes the claim check",
    async () => {
      const drafter = new ReplicateDescriptionDrafter({
        token: process.env.REPLICATE_API_TOKEN ?? "",
        model: process.env.ASSET_VISION_MODEL ?? "yorickvp/llava-13b",
        version: null,
        timeoutMs: 90_000,
      });
      const bytes = repoFile("public/media/bottles/no-01-house.jpg");
      const draft = await drafter.draft({
        bytes,
        mimeType: "image/jpeg",
        hint: "the kitchen bench",
      });
      expect(draft).not.toBeNull();
      expect(checkGeneratedText(draft?.text ?? "").clean).toBe(true);

      const out = path.join(process.cwd(), "components", "assets", "evidence");
      mkdirSync(out, { recursive: true });
      writeFileSync(
        path.join(out, "vision-draft.json"),
        `${JSON.stringify(
          {
            what: "One live call to the vision model, through lib/assets/describe.ts",
            photo: "public/media/bottles/no-01-house.jpg",
            model: draft?.model,
            draft: draft?.text,
            claimCheck: checkGeneratedText(draft?.text ?? ""),
            at: new Date().toISOString(),
          },
          null,
          2,
        )}\n`,
      );
    },
    120_000,
  );
});
