import "server-only";

/**
 * The library, wired up.
 *
 * One place where the environment becomes objects: a database pool, a storage
 * provider, and a description drafter that may legitimately be absent. The admin
 * pages, the upload route and the agent wiring all call `assetLibrary()` and get
 * the same three, so there is one answer to "which storage is this running on"
 * rather than one per caller.
 *
 * The pool is its own, keyed separately on `globalThis`, rather than borrowed
 * from `components/admin/data/db.ts`: a library reaching up into a component
 * directory for its connection would invert the dependency and would break the
 * moment this code ran anywhere but a page render — the Inngest worker, for
 * instance, which has no admin at all.
 */

import { createPgExecutor, type SqlExecutor } from "@/lib/commerce";

import { assetIdsIn } from "./approvals";
import { getDescriptionDrafter, type DescriptionDrafter } from "./describe";
import { AssetError } from "./errors";
import { getStorageProvider } from "./storage/registry";
import type { StorageProvider } from "./storage/provider";
import { SqlAssetStore } from "./store/sql";
import type { AssetStore } from "./store/types";
import type { MarketingAsset } from "./types";

type AssetGlobal = { __halfSourAssetSql?: SqlExecutor };

export function assetSql(): SqlExecutor {
  const url = process.env.SUPABASE_DB_URL?.trim();
  if (url === undefined || url === "") {
    throw new AssetError(
      "storage_unavailable",
      "SUPABASE_DB_URL is not set, so the asset library cannot reach the business database.",
    );
  }
  const store = globalThis as unknown as AssetGlobal;
  store.__halfSourAssetSql ??= createPgExecutor(url);
  return store.__halfSourAssetSql;
}

export interface AssetLibrary {
  readonly store: AssetStore;
  readonly storage: StorageProvider;
  readonly drafter: DescriptionDrafter | null;
}

export function assetLibrary(): AssetLibrary {
  return {
    store: new SqlAssetStore(assetSql()),
    storage: getStorageProvider(),
    drafter: getDescriptionDrafter(),
  };
}

/**
 * The assets an approval is about, ready to render.
 *
 * The ids travel in the approval's own payload — the agent cited them there
 * when it proposed the action — so this needs nothing but the payload and a
 * lookup. An id that is not an asset simply does not come back.
 *
 * ```tsx
 * const pictures = await assetsForApproval(approval.payload);
 * <ApprovalAssets assets={pictures} />
 * ```
 */
export async function assetsForApproval(
  payload: unknown,
  library: Pick<AssetLibrary, "store"> = assetLibrary(),
): Promise<readonly MarketingAsset[]> {
  const ids = assetIdsIn(payload);
  if (ids.length === 0) return [];
  const found = await Promise.all(ids.map((id) => library.store.get(id)));
  return found.filter((asset): asset is MarketingAsset => asset !== null);
}

/**
 * Run a read and turn a failure into something a person can read.
 *
 * The same shape as `components/admin/data/db.ts`'s `load`, and for the same
 * reason: the admin is where she finds out something is broken, so it is not
 * allowed to be the broken thing.
 */
export type Loaded<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly problem: string; readonly detail: string };

export async function loadAssets<T>(
  read: () => Promise<T>,
): Promise<Loaded<T>> {
  try {
    return { ok: true, data: await read() };
  } catch (cause) {
    return {
      ok: false,
      problem:
        "The library could not be read just now, so this page has nothing to show. Nothing has been lost — the files are where they were.",
      detail: cause instanceof Error ? cause.message : String(cause),
    };
  }
}
