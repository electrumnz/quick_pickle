/**
 * The picture reaching the decision.
 *
 * An agent cites an asset by putting its id in the payload of the tool call it
 * proposes. `approvals.payload` stores that payload verbatim, so the citation
 * and the action cannot drift apart. These tests take the round trip: a tool
 * call is written into `approvals` the way the runtime writes one, and the
 * library finds the picture from it and finds the decision from the picture.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assetIdsIn } from "@/lib/assets/approvals";
import { assetsForApproval } from "@/lib/assets/server";
import { ingestFile } from "@/lib/assets/ingest";
import type { MarketingAsset } from "@/lib/assets/types";

import { createAssetWorld, type AssetTestWorld } from "./support/db";
import { repoFile } from "./support/fixtures";

let world: AssetTestWorld;
let asset: MarketingAsset;
let approvalId = "";

beforeAll(async () => {
  world = await createAssetWorld();
  const outcome = await ingestFile(
    { bytes: repoFile("public/media/bottles/no-02-dirty.jpg"), filename: "bar.jpg" },
    {
      title: "The martini at the bar",
      description: "A bartender pouring No 02 DIRTY into a mixing glass.",
      occasion: "a bar we sell to",
      occasionOn: "2026-08-02",
      peoplePresent: false,
    },
    {
      store: world.store,
      storage: world.storage,
      drafter: null,
      operatorId: world.operatorId,
    },
  );
  if (outcome.status !== "stored") throw new Error("fixture did not store");
  asset = outcome.asset;

  // Exactly the shape ApprovalService.request writes: the tool name, the
  // arguments the agent proposed, and nothing else.
  const payload = {
    tool: "queue_social_post",
    agentSlug: "social",
    effect: "external",
    arguments: {
      platform: "instagram",
      caption: "No 02 DIRTY, poured properly.",
      assetIds: [asset.id],
    },
  };
  const inserted = await world.sql.query<{ id: string }>(
    `insert into public.approvals
       (subject_type, subject_table, title, summary, payload, preview, risk, status)
     values ('social_post', 'social_posts', 'instagram post',
             'No 02 DIRTY, poured properly.', $1::jsonb, '{}'::jsonb, 'medium', 'pending')
     returning id`,
    [JSON.stringify(payload)],
  );
  approvalId = inserted.rows[0]?.id ?? "";
}, 120_000);

afterAll(async () => {
  await world.close();
});

describe("finding the picture in a decision", () => {
  it("reads the ids out of a payload, wherever the tool put them", () => {
    const id = "3f4d5a6b-1c2d-4e3f-8a9b-0c1d2e3f4a5b";
    expect(assetIdsIn({ arguments: { assetIds: [id] } })).toEqual([id]);
    expect(assetIdsIn({ assets: [{ id }] })).toEqual([id]);
    expect(assetIdsIn({ deep: { nested: { asset_id: id } } })).toEqual([id]);
    expect(assetIdsIn({ caption: "no ids here" })).toEqual([]);
    // Nothing that is not shaped like an id is picked up.
    expect(assetIdsIn({ assetId: "not-a-uuid" })).toEqual([]);
  });

  it("loads the asset the approval cites", async () => {
    const result = await world.sql.query<{ payload: unknown }>(
      `select payload from public.approvals where id = $1::uuid`,
      [approvalId],
    );
    const payload = result.rows[0]?.payload;
    const assets = await assetsForApproval(payload, { store: world.store });
    expect(assets.map((entry) => entry.id)).toEqual([asset.id]);
    expect(assets[0]?.title).toBe("The martini at the bar");
    // Which is what lets the queue show the photograph rather than a filename.
    expect(assets[0]?.storageKey).toContain("photos/");
  });
});

describe("finding the decision from the picture", () => {
  it("lists the approvals an asset is attached to", async () => {
    const approvals = await world.store.approvalsFor([asset.id]);
    expect(approvals).toHaveLength(1);
    expect(approvals[0]?.approvalId).toBe(approvalId);
    expect(approvals[0]?.status).toBe("pending");
    expect(approvals[0]?.assetIds).toEqual([asset.id]);
  });

  it("finds nothing for an asset nobody has proposed", async () => {
    expect(
      await world.store.approvalsFor(["3f4d5a6b-1c2d-4e3f-8a9b-0c1d2e3f4a5b"]),
    ).toHaveLength(0);
    expect(await world.store.approvalsFor([])).toHaveLength(0);
  });
});
