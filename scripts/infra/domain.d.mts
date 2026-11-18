/** Types for domain.mjs, for the tests that hold it to its word. */

export type ReadDomain =
  | { readonly name: string; readonly why?: undefined }
  | { readonly why: string; readonly name?: undefined };

export type ProjectDomain = {
  readonly name?: unknown;
  readonly verified?: unknown;
  readonly redirect?: unknown;
};

export type DomainConfig = {
  readonly misconfigured?: unknown;
  readonly recommendedIPv4?: unknown;
  readonly recommendedCNAME?: unknown;
};

export type DnsRecord = {
  readonly type: "A" | "CNAME";
  readonly at: string;
  readonly value: string;
};

export type DomainState = "not proven" | "answering" | "waiting";

export function readDomainName(input: unknown): ReadDomain;

export function hostsOwnAddress(domains: unknown): string | null;

export function recordFor(
  host: unknown,
  apex: unknown,
  config: DomainConfig | null | undefined,
): DnsRecord | null;

export function stateOf(
  domain: ProjectDomain | null | undefined,
  config: DomainConfig | null | undefined,
): DomainState;

export const STATE_SAID: Readonly<Record<DomainState, string>>;
