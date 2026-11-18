// What the infra script knows about the shop's addresses.
//
// Kept apart from run.mjs so that it can be tested: run.mjs starts work the
// moment it is loaded, and nothing in this file reads a setting or uses the
// network.
//
// The site has two kinds of address, and they are kept for two kinds of
// caller:
//
//   the host's own   the one the host gives the project (…vercel.app). It
//                    is there from the first deployment and no DNS of ours
//                    can break it. Machines call this one: Stripe with its
//                    news of a payment, the database with the clock.
//   a domain         the shop's own name, bought by its owner. People use
//                    this one. It works only while its DNS records point at
//                    the host and its registration is paid for.
//
// So a mistake at a registrar can never stop a payment being recorded or the
// clock being rung.

/** Words that mark a name as another business's. Never taken, whatever asks. */
const NOT_OURS = ["keece"];

/** Endings that are not names the public can reach. */
const NOT_PUBLIC = new Set([
  "localhost",
  "local",
  "internal",
  "invalid",
  "example",
  "test",
]);

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4 =
  /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const HOSTNAME =
  /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/**
 * Reads a domain's name out of a request.
 *
 * A name and nothing more: no "https://", no path, no "www." (that one is
 * added beside the name by the script). Answers { name } or { why }, and the
 * why is a sentence a person can act on.
 */
export function readDomainName(input) {
  if (typeof input !== "string" || input.trim() === "") {
    return {
      why: 'The request names no domain. Add "domain": "example.co.nz" to it.',
    };
  }
  const name = input.trim().toLowerCase();
  if (name.length > 253) {
    return { why: "That is too long to be a domain name." };
  }
  if (/[\s/\\:@?#_*]/.test(name)) {
    return {
      why: "Give the bare name, like example.co.nz: no https://, no slash, no spaces.",
    };
  }
  const labels = name.split(".");
  if (labels.length < 2 || labels.length > 4) {
    return { why: "That is not a domain name. It looks like example.co.nz." };
  }
  if (!labels.every((label) => LABEL.test(label))) {
    return {
      why: "A domain name is letters, digits and hyphens, with dots between its parts.",
    };
  }
  if (labels.some((label) => label.startsWith("xn--"))) {
    return {
      why: "Names written outside plain letters and digits are not taken here.",
    };
  }
  const ending = labels[labels.length - 1];
  if (!/^[a-z]{2,}$/.test(ending) || NOT_PUBLIC.has(ending)) {
    return { why: "That is not a name the public can reach the shop at." };
  }
  if (name === "vercel.app" || name.endsWith(".vercel.app")) {
    return {
      why: "That is the host's own address. It is already the site's, and it is not a domain of ours.",
    };
  }
  if (labels[0] === "www") {
    return {
      why: 'Give the name without "www.": that one is added beside it.',
    };
  }
  if (NOT_OURS.some((word) => name.includes(word))) {
    return { why: "That name belongs to another business. Refusing." };
  }
  return { name };
}

/**
 * The address the host gives the project itself, out of the project's list.
 *
 * It has to be one the host has accepted and one that is not sending people
 * on somewhere else: a machine that is redirected gives up. Null when there
 * is none, which would be a fault to stop for.
 */
export function hostsOwnAddress(domains) {
  const list = Array.isArray(domains) ? domains : [];
  const own = list.find(
    (domain) =>
      typeof domain?.name === "string" &&
      domain.name.endsWith(".vercel.app") &&
      domain.verified !== false &&
      !domain.redirect,
  );
  return own === undefined ? null : own.name;
}

/** The first choice out of one of the host's ranked lists. */
function firstChoice(list) {
  if (!Array.isArray(list)) return undefined;
  const ranked = list
    .filter((item) => item !== null && typeof item === "object")
    .sort((a, b) => Number(a.rank) - Number(b.rank));
  return ranked.length === 0 ? undefined : ranked[0].value;
}

/**
 * The one DNS record a person adds for a name, from what the host recommends.
 *
 * The name itself (the apex) takes an A record; anything under it (www)
 * takes a CNAME. Null when the host recommended nothing this file can read,
 * so that nothing is ever printed that was not the host's own word: a record
 * typed wrong at a registrar is hours of a shop that cannot be reached.
 */
export function recordFor(host, apex, config) {
  if (typeof host !== "string" || typeof apex !== "string") return null;
  if (host === apex) {
    const choice = firstChoice(config?.recommendedIPv4);
    const address = Array.isArray(choice) ? choice[0] : choice;
    if (typeof address !== "string" || !IPV4.test(address)) return null;
    return { type: "A", at: "@", value: address };
  }
  if (!host.endsWith(`.${apex}`)) return null;
  const choice = firstChoice(config?.recommendedCNAME);
  if (typeof choice !== "string") return null;
  const target = choice.trim().toLowerCase().replace(/\.$/, "");
  if (!HOSTNAME.test(target)) return null;
  return {
    type: "CNAME",
    at: host.slice(0, host.length - apex.length - 1),
    value: target,
  };
}

/**
 * Where one of the project's names stands, in a few words.
 *
 *   not proven    the host wants proof the name is ours before it will use it
 *   answering     its DNS points at the host, and the host can give it a
 *                 certificate
 *   waiting       it is on the project, and its DNS does not point here yet
 */
export function stateOf(domain, config) {
  if (domain?.verified === false) return "not proven";
  return config?.misconfigured === false ? "answering" : "waiting";
}

/** The words the log uses for each state. */
export const STATE_SAID = {
  "not proven": "NOT PROVEN to be ours yet",
  answering: "answering",
  waiting: "waiting for its DNS records",
};
