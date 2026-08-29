/**
 * Plain-English formatting for the admin.
 *
 * Two rules run through everything here.
 *
 * **Every number gets a label a non-accountant understands.** That happens at
 * the call site, but the shapes here make it easy: money always carries its
 * dollar sign, quantities always carry their unit, and a date is never an ISO
 * string on screen.
 *
 * **The business runs on New Zealand time.** The database stores UTC; the
 * founder lives in Pacific/Auckland and "today" means her today, not the
 * server's. Every format function below pins that zone explicitly rather than
 * inheriting whatever the render happens to run in.
 */

export const NZ_TIME_ZONE = "Pacific/Auckland";
const NZ_LOCALE = "en-NZ";

const MONEY = new Intl.NumberFormat(NZ_LOCALE, {
  style: "currency",
  currency: "NZD",
  currencyDisplay: "narrowSymbol",
});

const MONEY_ROUND = new Intl.NumberFormat(NZ_LOCALE, {
  style: "currency",
  currency: "NZD",
  currencyDisplay: "narrowSymbol",
  maximumFractionDigits: 0,
});

const NUMBER = new Intl.NumberFormat(NZ_LOCALE);

/** Integer cents to "$1,234.50". Money is never a float in this codebase. */
export function money(cents: number): string {
  return MONEY.format(cents / 100);
}

/** Integer cents to "$1,235" — for stat tiles, where cents are noise. */
export function moneyRound(cents: number): string {
  return MONEY_ROUND.format(cents / 100);
}

/** A count with thousands separators. */
export function count(value: number): string {
  return NUMBER.format(value);
}

/** A quantity that may carry decimals, trimmed: 5.1, 1180, 0.9. */
export function quantity(value: number, unit?: string): string {
  const rounded = Math.round(value * 100) / 100;
  const text = NUMBER.format(rounded);
  return unit === undefined ? text : `${text} ${unit}`;
}

export function percent(fraction: number, digits = 0): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

// ---------------------------------------------------------------------------
// Dates and times, always in New Zealand
// ---------------------------------------------------------------------------

const DAY = new Intl.DateTimeFormat(NZ_LOCALE, {
  timeZone: NZ_TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
});

const DAY_LONG = new Intl.DateTimeFormat(NZ_LOCALE, {
  timeZone: NZ_TIME_ZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
});

const DAY_SHORT = new Intl.DateTimeFormat(NZ_LOCALE, {
  timeZone: NZ_TIME_ZONE,
  day: "numeric",
  month: "short",
});

const TIME = new Intl.DateTimeFormat(NZ_LOCALE, {
  timeZone: NZ_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const ISO_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: NZ_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/** "Sat 29 Aug" */
export function day(value: Date | string): string {
  return DAY.format(asDate(value));
}

/** "Saturday 29 August" — the masthead date on Today. */
export function dayLong(value: Date | string): string {
  return DAY_LONG.format(asDate(value)).replace(/,/g, "");
}

/** "29 Aug" */
export function dayShort(value: Date | string): string {
  return DAY_SHORT.format(asDate(value));
}

/** "4:47 pm" */
export function time(value: Date | string): string {
  return TIME.format(asDate(value)).toLowerCase().replace(/\s/g, " ");
}

const DAY_YEAR = new Intl.DateTimeFormat(NZ_LOCALE, {
  timeZone: NZ_TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
});

/**
 * "10 Feb 2028" — for a date far enough away that the year matters.
 *
 * A best-before two years out shown as "Thu 10 Feb" is a date she will read as
 * this coming February.
 */
export function dayAndYear(value: Date | string): string {
  return DAY_YEAR.format(asDate(value));
}

/** "Sat 29 Aug, 4:47 pm" */
export function dayAndTime(value: Date | string): string {
  return `${day(value)}, ${time(value)}`;
}

/** The calendar date in New Zealand, as `2026-08-30`. */
export function nzDateKey(value: Date | string): string {
  return ISO_DAY.format(asDate(value));
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * How long ago, in the words a person would use.
 *
 * Deliberately coarse past a week: "3 weeks ago" is what she needs, and a
 * precise "19 days ago" makes her do arithmetic to get there.
 */
export function ago(value: Date | string, now: Date = new Date()): string {
  const elapsed = now.getTime() - asDate(value).getTime();
  if (elapsed < 0) return until(value, now);
  if (elapsed < 2 * MINUTE_MS) return "just now";
  if (elapsed < HOUR_MS) {
    return `${String(Math.round(elapsed / MINUTE_MS))} minutes ago`;
  }
  if (elapsed < 22 * HOUR_MS) {
    const hours = Math.round(elapsed / HOUR_MS);
    return hours === 1 ? "an hour ago" : `${String(hours)} hours ago`;
  }
  const days = Math.round(elapsed / DAY_MS);
  if (days <= 1) return "yesterday";
  if (days < 14) return `${String(days)} days ago`;
  if (days < 60) return `${String(Math.round(days / 7))} weeks ago`;
  return `${String(Math.round(days / 30))} months ago`;
}

/** How long until, in the same voice: "in 4 hours", "tomorrow", "in 3 days". */
export function until(value: Date | string, now: Date = new Date()): string {
  const remaining = asDate(value).getTime() - now.getTime();
  if (remaining <= 0) return "now";
  if (remaining < HOUR_MS) {
    return `in ${String(Math.max(1, Math.round(remaining / MINUTE_MS)))} minutes`;
  }
  if (remaining < 22 * HOUR_MS) {
    const hours = Math.round(remaining / HOUR_MS);
    return hours === 1 ? "in an hour" : `in ${String(hours)} hours`;
  }
  const days = Math.round(remaining / DAY_MS);
  if (days <= 1) return "tomorrow";
  if (days < 14) return `in ${String(days)} days`;
  return `in ${String(Math.round(days / 7))} weeks`;
}

/** "waiting 4 days" — for a queue where age is the point. */
export function waiting(value: Date | string, now: Date = new Date()): string {
  const elapsed = now.getTime() - asDate(value).getTime();
  if (elapsed < HOUR_MS) return "waiting under an hour";
  if (elapsed < DAY_MS) {
    const hours = Math.round(elapsed / HOUR_MS);
    return `waiting ${String(hours)} ${hours === 1 ? "hour" : "hours"}`;
  }
  const days = Math.round(elapsed / DAY_MS);
  return `waiting ${String(days)} ${days === 1 ? "day" : "days"}`;
}

/** Whole days between two instants, rounded down, never negative. */
export function daysBetween(from: Date | string, to: Date | string): number {
  const gap = asDate(to).getTime() - asDate(from).getTime();
  return Math.max(0, Math.floor(gap / DAY_MS));
}

// ---------------------------------------------------------------------------
// Words for the database's vocabulary
// ---------------------------------------------------------------------------

/** Sentence case from a snake_case enum, as a last resort. */
export function humanise(value: string): string {
  const spaced = value.replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * The words behind the abbreviations a settings key uses.
 *
 * `tax.gst_rate_bp` is precise and unreadable. She should see "GST rate in
 * basis points", which is the same fact in words she can act on.
 */
const KEY_WORDS: Readonly<Record<string, string>> = {
  gst: "GST",
  bp: "in basis points",
  cents: "in cents",
  nzbn: "NZBN",
  url: "address",
  api: "API",
  ref: "reference",
  ird: "IRD",
  hmac: "signature",
  id: "identifier",
};

/** A settings key as a phrase: `shipping.free_threshold_cents` → "Free threshold in cents". */
export function settingLabel(key: string): string {
  const tail = key.includes(".") ? key.slice(key.indexOf(".") + 1) : key;
  const words = tail
    .split(/[._]/)
    .filter(Boolean)
    .map((word) => KEY_WORDS[word] ?? word);
  const phrase = words.join(" ");
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

/**
 * A browser's user agent, as the device it actually is.
 *
 * A sign-in list exists so she can spot one that is not hers. Seven identical
 * lines of `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36…` makes that
 * impossible; "Chrome on Linux" makes it easy.
 */
export function deviceName(userAgent: string | null): string {
  if (userAgent === null || userAgent.trim() === "") {
    return "Unrecorded device";
  }
  const ua = userAgent;
  if (/^curl\//i.test(ua)) return "A command line tool";
  if (!/mozilla|safari|chrome|firefox/i.test(ua)) {
    return ua.length > 40 ? `${ua.slice(0, 40)}…` : ua;
  }
  const browser = /edg\//i.test(ua)
    ? "Edge"
    : /headlesschrome/i.test(ua)
      ? "Headless Chrome"
      : /chrome|crios/i.test(ua)
        ? "Chrome"
        : /firefox|fxios/i.test(ua)
          ? "Firefox"
          : /safari/i.test(ua)
            ? "Safari"
            : "A browser";
  const platform = /iphone/i.test(ua)
    ? "an iPhone"
    : /ipad/i.test(ua)
      ? "an iPad"
      : /android/i.test(ua)
        ? "an Android phone"
        : /mac os x|macintosh/i.test(ua)
          ? "a Mac"
          : /windows/i.test(ua)
            ? "Windows"
            : /linux/i.test(ua)
              ? "Linux"
              : "an unrecognised device";
  return `${browser} on ${platform}`;
}

/** "3 orders" / "1 order" — the pluralisation this admin does constantly. */
export function plural(n: number, one: string, many?: string): string {
  const word = n === 1 ? one : (many ?? `${one}s`);
  return `${count(n)} ${word}`;
}

/** A person's initials for an avatar. Never more than two letters. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.charAt(0) ?? "?";
  const second =
    parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? "") : "";
  return (first + second).toUpperCase();
}

/** Trim to a length without cutting mid-word, and add an ellipsis. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > max * 0.6 ? lastSpace : max).trimEnd()}…`;
}
