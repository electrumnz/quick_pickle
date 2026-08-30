/**
 * Choosing a storage provider.
 *
 * Mirrors `lib/commerce/registry.ts`: one variable decides, the choice is
 * resolved once and memoised, and a value that is not a known provider is a
 * hard failure naming the valid set rather than a silent fallback.
 *
 * The one deliberate difference is the default. Commerce refuses to boot
 * without `COMMERCE_PROVIDER` because serving fixture prices to a customer who
 * thinks they are real prices is worse than not serving at all. Here, an unset
 * variable means `local`, because the library must be fully usable today with
 * no cloud account — that is the point of the port.
 */

import path from "node:path";

import { AssetError } from "../errors";
import { STORAGE_BACKENDS, type StorageBackend } from "../types";
import { LocalStorageProvider } from "./local";
import type { StorageProvider } from "./provider";
import { SupabaseStorageProvider } from "./supabase";

export type EnvSource = Readonly<Record<string, string | undefined>>;

export interface StorageConfig {
  readonly backend: StorageBackend;
  /** Where the local provider keeps files. Never inside `public/`. */
  readonly directory: string;
  readonly supabase: {
    readonly url: string | null;
    readonly serviceKey: string | null;
    readonly bucket: string;
  };
}

export const DEFAULT_ASSET_DIRECTORY = ".assets";
export const DEFAULT_ASSET_BUCKET = "marketing-assets";

function orNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? null : trimmed;
}

export function readStorageConfig(env: EnvSource = process.env): StorageConfig {
  const raw = env.ASSET_STORAGE_PROVIDER?.trim().toLowerCase();
  if (raw !== undefined && raw !== "" && !isBackend(raw)) {
    throw new AssetError(
      "storage_unavailable",
      `ASSET_STORAGE_PROVIDER is ${JSON.stringify(raw)}, which is not a storage provider. Valid values: ${STORAGE_BACKENDS.join(", ")}.`,
    );
  }
  return {
    backend: raw === undefined || raw === "" ? "local" : raw,
    directory: assetDirectory(orNull(env.ASSET_STORAGE_DIR)),
    supabase: {
      url: orNull(env.SUPABASE_URL) ?? orNull(env.NEXT_PUBLIC_SUPABASE_URL),
      serviceKey: orNull(env.SUPABASE_SERVICE_ROLE_KEY),
      bucket: orNull(env.ASSET_STORAGE_BUCKET) ?? DEFAULT_ASSET_BUCKET,
    },
  };
}

/**
 * Where the local provider keeps files.
 *
 * The default is one fixed subfolder of the project, spelled out statically: the
 * build's file tracer follows path expressions, and one it cannot resolve makes
 * it trace and deploy the entire repository — public folder included.
 *
 * `ASSET_STORAGE_DIR` must therefore be an absolute path. A relative one would
 * have to be joined to the working directory here, which is exactly the
 * expression the tracer cannot see through, and "relative to what?" is a bad
 * question to leave open about the folder holding the company's photographs.
 */
function assetDirectory(configured: string | null): string {
  if (configured === null) {
    return path.join(process.cwd(), DEFAULT_ASSET_DIRECTORY);
  }
  if (!path.isAbsolute(configured)) {
    throw new AssetError(
      "storage_unavailable",
      `ASSET_STORAGE_DIR is ${JSON.stringify(configured)}, which is a relative path. Give it an absolute one, or leave it unset to use ${DEFAULT_ASSET_DIRECTORY} in the project.`,
    );
  }
  return configured;
}

function isBackend(value: string): value is StorageBackend {
  return (STORAGE_BACKENDS as readonly string[]).includes(value);
}

export function createStorageProvider(config: StorageConfig): StorageProvider {
  if (config.backend === "local") {
    return new LocalStorageProvider(config.directory);
  }
  const missing: string[] = [];
  if (config.supabase.url === null) missing.push("SUPABASE_URL");
  if (config.supabase.serviceKey === null) {
    missing.push("SUPABASE_SERVICE_ROLE_KEY");
  }
  if (missing.length > 0) {
    throw new AssetError(
      "storage_unavailable",
      `ASSET_STORAGE_PROVIDER is "supabase" but ${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} not set.`,
    );
  }
  return new SupabaseStorageProvider({
    url: config.supabase.url ?? "",
    serviceKey: config.supabase.serviceKey ?? "",
    bucket: config.supabase.bucket,
  });
}

type StorageGlobal = { __halfSourAssetStorage?: StorageProvider };

/** The process-wide provider, resolved on first use. */
export function getStorageProvider(
  env: EnvSource = process.env,
): StorageProvider {
  const store = globalThis as unknown as StorageGlobal;
  store.__halfSourAssetStorage ??= createStorageProvider(
    readStorageConfig(env),
  );
  return store.__halfSourAssetStorage;
}

/** Drop the memoised provider. Tests and hot reload only. */
export function resetStorageProvider(): void {
  const store = globalThis as unknown as StorageGlobal;
  delete store.__halfSourAssetStorage;
}
