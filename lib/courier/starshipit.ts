/**
 * Starshipit, over plain HTTP. No SDK: four calls do not need one, and each
 * takes the `fetch` to use so a test can hand in a fake.
 *
 * Read from Starshipit's own API documentation (api-docs.starshipit.com,
 * 19 November 2026). Every call carries two keys, both made in Starshipit
 * under Settings, API: the API key (`StarShipIT-Api-Key`) and the
 * subscription key (`Ocp-Apim-Subscription-Key`). They go to
 * api.starshipit.com and nowhere else, and never appear in an error, a log
 * line or anything else that leaves this file.
 *
 * The four calls:
 *
 *   createOrder    POST /api/orders                  an order to be labelled
 *   findUnshipped  GET  /api/orders?order_number=    did an earlier try land?
 *   deleteOrder    DELETE /api/orders/delete         take an unshipped one back
 *   listShipped    GET  /api/orders/shipped          labels printed since then
 *
 * Nobody could try these against a real account from here. The first real
 * hand-over is the test: the back end says plainly what Starshipit answered.
 */

const API = "https://api.starshipit.com";
const TIMEOUT_MS = 20_000;

export type StarshipitKeys = {
  readonly apiKey: string;
  readonly subscriptionKey: string;
};

export type StarshipitOptions = StarshipitKeys & {
  readonly fetch: typeof fetch;
};

/** Why a call did not do what it was asked. Never carries a key. */
export class CourierError extends Error {
  /** The HTTP status, or null when nothing came back. */
  readonly status: number | null;
  /** Worth asking again later: busy, a fault at their end, no answer. */
  readonly retryable: boolean;
  /**
   * Did it happen? "refused" means it did not. "unknown" means it may have:
   * no answer, or a fault at their end after the request arrived.
   */
  readonly outcome: "refused" | "unknown";

  constructor(
    message: string,
    details: {
      status: number | null;
      retryable: boolean;
      outcome: "refused" | "unknown";
    },
  ) {
    super(message);
    this.name = "CourierError";
    this.status = details.status;
    this.retryable = details.retryable;
    this.outcome = details.outcome;
  }
}

/** Take anything key-shaped out of text that is about to be kept or shown. */
export function scrubKeys(text: string, keys?: StarshipitKeys): string {
  let out = text;
  for (const key of [keys?.apiKey, keys?.subscriptionKey]) {
    if (key !== undefined && key.length >= 6) {
      out = out.split(key).join("[key removed]");
    }
  }
  return out.replace(/\b[a-f0-9]{32}\b/gi, "[key removed]");
}

function oneLine(text: string, max: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

/* ---- what goes over ------------------------------------------------------ */

export type StarshipitDestination = {
  readonly name: string;
  readonly email?: string;
  readonly phone?: string;
  readonly building?: string;
  readonly street: string;
  readonly suburb: string;
  readonly city: string;
  readonly state: string;
  readonly post_code: string;
  readonly country: string;
  readonly delivery_instructions?: string;
};

export type StarshipitItem = {
  readonly description: string;
  readonly sku: string;
  readonly quantity: number;
  /** The price of one, in dollars. */
  readonly value: number;
};

/** The order, under Starshipit's own names for each thing. */
export type StarshipitOrder = {
  readonly order_date: string;
  readonly order_number: string;
  readonly reference: string;
  readonly shipping_method: string;
  readonly signature_required: boolean;
  readonly currency: string;
  readonly destination: StarshipitDestination;
  readonly items: readonly StarshipitItem[];
};

/** One order Starshipit has printed a label for. */
export type ShippedOrder = {
  readonly orderId: string;
  readonly orderNumber: string;
  /** Starshipit's word for the courier: "CourierPost", "NZCouriers". */
  readonly carrier: string;
  /** The courier's name as Starshipit writes it. */
  readonly carrierName: string;
  readonly trackingNumber: string;
  /** The tracking page, if Starshipit gave one. */
  readonly trackingUrl: string | null;
  readonly shippedAt: string | null;
};

/* ---- the wire ------------------------------------------------------------ */

type Answer = Record<string, unknown>;

function asRecord(value: unknown): Answer | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Answer)
    : null;
}

function text(value: unknown, max = 200): string {
  if (typeof value === "string") return oneLine(value, max);
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return "";
}

/** What Starshipit said went wrong, from an answer's `errors` list. */
function errorsSaid(body: Answer | null): string {
  const errors = body?.errors;
  if (!Array.isArray(errors)) {
    return text(body?.message ?? body?.Message ?? "", 300);
  }
  return errors
    .map((error) => {
      const record = asRecord(error);
      if (record === null) return text(error, 200);
      const message = text(record.message, 200);
      const details = text(record.details, 200);
      return details === "" || details === message
        ? message
        : `${message}${message === "" ? "" : ": "}${details}`;
    })
    .filter((said) => said !== "")
    .join("; ")
    .slice(0, 300);
}

/**
 * Worth trying again later: too many at once, a fault at their end, or no
 * answer in time. A plain refusal (a field it will not take, a wrong key)
 * gets the same answer however often it is asked.
 */
function retryable(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

async function call(
  options: StarshipitOptions,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
): Promise<{ status: number; body: Answer | null }> {
  let response: Response;
  try {
    response = await options.fetch(`${API}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "StarShipIT-Api-Key": options.apiKey,
        "Ocp-Apim-Subscription-Key": options.subscriptionKey,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const why = error instanceof Error ? error.message : "no answer";
    throw new CourierError(
      `Starshipit could not be reached: ${oneLine(scrubKeys(why, options), 200)}`,
      {
        status: null,
        retryable: true,
        // A request that was cut off may have arrived.
        outcome: method === "GET" ? "refused" : "unknown",
      },
    );
  }
  let parsed: Answer | null = null;
  try {
    parsed = asRecord(JSON.parse((await response.text()).slice(0, 2_000_000)));
  } catch {
    parsed = null;
  }
  return { status: response.status, body: parsed };
}

function refusedBy(
  what: string,
  answer: { status: number; body: Answer | null },
  options: StarshipitOptions,
): CourierError {
  const said = scrubKeys(errorsSaid(answer.body), options);
  const why =
    answer.status === 401 || answer.status === 403
      ? " Check the two Starshipit keys."
      : "";
  return new CourierError(
    `Starshipit ${what} (${String(answer.status)})${said === "" ? "." : `: ${said}`}${why}`,
    {
      status: answer.status,
      retryable: retryable(answer.status),
      outcome: answer.status >= 500 ? "unknown" : "refused",
    },
  );
}

/** The order Starshipit sent back, as its id, or "" if it gave none. */
function orderIdIn(body: Answer | null): string {
  const order = asRecord(body?.order);
  return text(order?.order_id, 40);
}

/**
 * Hand one order over. Resolves with Starshipit's id for it. Throws
 * `CourierError`: `outcome` says whether it might have landed anyway.
 */
export async function createOrder(
  order: StarshipitOrder,
  options: StarshipitOptions,
): Promise<string> {
  const answer = await call(options, "POST", "/api/orders", { order });
  if (
    answer.status < 200 ||
    answer.status >= 300 ||
    answer.body?.success === false
  ) {
    throw refusedBy("would not take the order", answer, options);
  }
  const id = orderIdIn(answer.body);
  if (id === "") {
    throw new CourierError(
      "Starshipit took the order but did not say what it called it.",
      { status: answer.status, retryable: false, outcome: "unknown" },
    );
  }
  return id;
}

/**
 * Starshipit's id for an order it holds unshipped under this number, or null
 * if it holds none. Asked before handing an order over again after a try that
 * got no clear answer, so one order is never two boxes.
 */
export async function findUnshipped(
  orderNumber: string,
  options: StarshipitOptions,
): Promise<string | null> {
  const query = new URLSearchParams({ order_number: orderNumber });
  const answer = await call(options, "GET", `/api/orders?${query.toString()}`);
  if (answer.status === 404) return null;
  if (answer.status < 200 || answer.status >= 300) {
    throw refusedBy("did not answer the question", answer, options);
  }
  if (answer.body?.success === false) return null;
  const order = asRecord(answer.body?.order);
  if (order === null) return null;
  // Only the order asked about, never a near match.
  return text(order.order_number, 60) === orderNumber
    ? text(order.order_id, 40) || null
    : null;
}

/** Take back an order that has no label yet. */
export async function deleteOrder(
  starshipitId: string,
  options: StarshipitOptions,
): Promise<void> {
  const query = new URLSearchParams({ order_id: starshipitId });
  const answer = await call(
    options,
    "DELETE",
    `/api/orders/delete?${query.toString()}`,
  );
  if (
    answer.status < 200 ||
    answer.status >= 300 ||
    answer.body?.success === false
  ) {
    throw refusedBy("would not take the order back", answer, options);
  }
}

/** Starshipit's tracking page for a parcel, if it gave one in this answer. */
function trackingUrlIn(order: Answer): string | null {
  const direct = text(order.tracking_url, 400);
  if (/^https:\/\//i.test(direct)) return direct;
  const packages = order.packages;
  if (Array.isArray(packages)) {
    for (const parcel of packages) {
      const url = text(asRecord(parcel)?.tracking_url, 400);
      if (/^https:\/\//i.test(url)) return url;
    }
  }
  return null;
}

/** The most pages read in one go: 250 orders a page. */
export const SHIPPED_PAGES = 10;

/** Every order with a label printed or updated since then, oldest page first. */
export async function listShipped(
  since: Date,
  options: StarshipitOptions,
): Promise<ShippedOrder[]> {
  const found: ShippedOrder[] = [];
  for (let page = 1; page <= SHIPPED_PAGES; page += 1) {
    const query = new URLSearchParams({
      since_last_updated: since.toISOString(),
      limit: "250",
      page: String(page),
    });
    const answer = await call(
      options,
      "GET",
      `/api/orders/shipped?${query.toString()}`,
    );
    if (
      answer.status < 200 ||
      answer.status >= 300 ||
      answer.body?.success === false
    ) {
      throw refusedBy("did not list what it has shipped", answer, options);
    }
    const orders = answer.body?.orders;
    if (!Array.isArray(orders)) break;
    for (const item of orders) {
      const order = asRecord(item);
      if (order === null) continue;
      const orderNumber = text(order.order_number, 60);
      const trackingNumber = text(order.tracking_number, 80);
      if (orderNumber === "" || trackingNumber === "") continue;
      found.push({
        orderId: text(order.order_id, 40),
        orderNumber,
        carrier: text(order.carrier, 60),
        carrierName: text(order.carrier_name, 60),
        trackingNumber,
        trackingUrl: trackingUrlIn(order),
        shippedAt: text(order.shipped_date, 40) || null,
      });
    }
    const pages = Number(answer.body?.total_pages);
    if (!Number.isFinite(pages) || page >= pages) break;
  }
  return found;
}
