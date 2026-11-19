/**
 * Xero, over plain HTTP. No SDK: the handful of calls the books need do not
 * need one, and each takes the `fetch` to use so a test can hand in a fake.
 *
 * Where each address comes from:
 *   - signing in and the keys: Xero's own OpenID description
 *     (identity.xero.com/.well-known/openid-configuration, read 19 November
 *     2026): login.xero.com/identity/connect/authorize and
 *     identity.xero.com/connect/token, the app's secret sent as HTTP Basic;
 *   - the organisations a sign-in let in: api.xero.com/connections;
 *   - the accounting calls and their fields: Xero's published OpenAPI file
 *     for the Accounting API (XeroAPI/Xero-OpenAPI, version 20.1.0), whose
 *     calls take an `Idempotency-Key` header of up to 128 characters;
 *   - the scopes: Xero's change of 6 August 2026 replaced
 *     accounting.transactions with accounting.invoices,
 *     accounting.payments and others, for apps made from 2 March 2026.
 *
 * The app's secret and the keys go to Xero's own addresses and nowhere else,
 * and never appear in an error, a log line or anything else that leaves
 * this file. Nobody could try these against a real organisation from here:
 * the first connection is the test, and the screen says what Xero answered.
 */

const AUTHORIZE_URL = "https://login.xero.com/identity/connect/authorize";
const TOKEN_URL = "https://identity.xero.com/connect/token";
const CONNECTIONS_URL = "https://api.xero.com/connections";
const API = "https://api.xero.com/api.xro/2.0";
const TIMEOUT_MS = 20_000;

/**
 * What the shop asks to be let do: renew its own key, write invoices and
 * credit notes, record payments, read the chart of accounts and tax rates,
 * and name the one contact sales are made out to.
 */
export const XERO_SCOPES = [
  "offline_access",
  "accounting.invoices",
  "accounting.payments",
  "accounting.settings.read",
  "accounting.contacts",
] as const;

export type XeroApp = {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly fetch: typeof fetch;
};

export type Tokens = {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: Date;
};

export type Organisation = { readonly id: string; readonly name: string };

/** Why a call did not do what it was asked. Never carries a key. */
export class XeroError extends Error {
  readonly status: number | null;
  /** Worth asking again later: busy, a fault at their end, no answer. */
  readonly retryable: boolean;
  /** Xero will not take the keys any more: the owner connects it again. */
  readonly reconnect: boolean;

  constructor(
    message: string,
    details: { status: number | null; retryable: boolean; reconnect?: boolean },
  ) {
    super(message);
    this.name = "XeroError";
    this.status = details.status;
    this.retryable = details.retryable;
    this.reconnect = details.reconnect ?? false;
  }
}

function oneLine(text: string, max: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

/** Take anything key-shaped out of text that is about to be kept or shown. */
export function scrubXero(
  text: string,
  secrets: readonly string[] = [],
): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length >= 8) out = out.split(secret).join("[key removed]");
  }
  return out
    .replace(
      /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g,
      "[key removed]",
    )
    .replace(/\bBearer\s+\S{8,}/gi, "Bearer [key removed]");
}

type Json = Record<string, unknown>;

function asRecord(value: unknown): Json | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : null;
}

function text(value: unknown, max = 200): string {
  if (typeof value === "string") return oneLine(value, max);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function amount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : NaN;
}

/** What Xero said went wrong, from the shapes its errors come in. */
function errorSaid(body: Json | null): string {
  if (body === null) return "";
  const said: string[] = [];
  const elements = body.Elements;
  if (Array.isArray(elements)) {
    for (const element of elements) {
      const errors = asRecord(element)?.ValidationErrors;
      if (!Array.isArray(errors)) continue;
      for (const error of errors) {
        const message = text(asRecord(error)?.Message, 200);
        if (message !== "" && !said.includes(message)) said.push(message);
      }
    }
  }
  if (said.length === 0) {
    const message =
      text(body.Detail, 200) ||
      text(body.Message, 200) ||
      text(body.error_description, 200) ||
      text(body.error, 100) ||
      text(body.Title, 100);
    if (message !== "") said.push(message);
  }
  return said.join("; ").slice(0, 400);
}

async function send(
  app: XeroApp,
  url: string,
  init: RequestInit,
  secrets: readonly string[],
): Promise<{ status: number; body: unknown; headers: Headers }> {
  let response: Response;
  try {
    response = await app.fetch(url, {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const why = error instanceof Error ? error.message : "no answer";
    throw new XeroError(
      `Xero could not be reached: ${oneLine(scrubXero(why, secrets), 200)}`,
      { status: null, retryable: true },
    );
  }
  let body: unknown = null;
  try {
    body = JSON.parse((await response.text()).slice(0, 4_000_000));
  } catch {
    body = null;
  }
  return { status: response.status, body, headers: response.headers };
}

function refused(
  what: string,
  answer: { status: number; body: unknown; headers: Headers },
  secrets: readonly string[],
): XeroError {
  const said = scrubXero(errorSaid(asRecord(answer.body)), secrets);
  const scope = /insufficient_scope|insufficent_scope/i.test(
    answer.headers.get("www-authenticate") ?? "",
  );
  const status = answer.status;
  const reconnect = status === 401 && !scope;
  const hint = scope
    ? " Xero says this connection may not do that. Connect Xero again from Settings, Xero, and allow everything it asks for."
    : reconnect
      ? " Xero no longer takes the shop's key. Connect Xero again from Settings, Xero."
      : status === 403
        ? " The organisation is no longer connected to the shop's app. Connect Xero again from Settings, Xero."
        : status === 429
          ? " Xero says it has had enough calls for now. It is tried again later."
          : "";
  return new XeroError(
    `Xero ${what} (${String(status)})${said === "" ? "." : `: ${said}.`}${hint}`.replace(
      /\.\./g,
      ".",
    ),
    {
      status,
      retryable: status === 408 || status === 429 || status >= 500,
      reconnect: reconnect || status === 403,
    },
  );
}

/* ---- signing in ----------------------------------------------------------- */

/** Where the owner is sent to let the shop in to their Xero. */
export function authorizeUrl(
  app: Pick<XeroApp, "clientId">,
  redirectUri: string,
  state: string,
): string {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: app.clientId,
    redirect_uri: redirectUri,
    scope: XERO_SCOPES.join(" "),
    state,
  });
  return `${AUTHORIZE_URL}?${query.toString()}`;
}

async function tokenCall(
  app: XeroApp,
  form: Record<string, string>,
  now: Date,
  what: string,
): Promise<Tokens> {
  const basic = Buffer.from(`${app.clientId}:${app.clientSecret}`).toString(
    "base64",
  );
  const secrets = [app.clientSecret, ...Object.values(form)];
  const answer = await send(
    app,
    TOKEN_URL,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams(form).toString(),
    },
    secrets,
  );
  const body = asRecord(answer.body);
  if (answer.status < 200 || answer.status >= 300) {
    const error = text(body?.error, 60);
    // invalid_grant: the renewal key is spent, or was taken back in Xero.
    throw new XeroError(
      `Xero would not ${what} (${String(answer.status)})${error === "" ? "." : `: ${error}.`}`,
      {
        status: answer.status,
        retryable: answer.status === 429 || answer.status >= 500,
        reconnect: error === "invalid_grant" || error === "invalid_client",
      },
    );
  }
  const accessToken =
    typeof body?.access_token === "string" ? body.access_token : "";
  const refreshToken =
    typeof body?.refresh_token === "string" ? body.refresh_token : "";
  const seconds = Number(body?.expires_in);
  if (accessToken === "" || refreshToken === "") {
    throw new XeroError(
      `Xero did not hand over its keys when asked to ${what}.`,
      {
        status: answer.status,
        retryable: false,
      },
    );
  }
  return {
    accessToken,
    refreshToken,
    expiresAt: new Date(
      now.getTime() + (Number.isFinite(seconds) ? seconds : 1800) * 1000,
    ),
  };
}

/** The keys, for the code Xero sent the owner back with. */
export function exchangeCode(
  app: XeroApp,
  code: string,
  redirectUri: string,
  now: Date,
): Promise<Tokens> {
  return tokenCall(
    app,
    { grant_type: "authorization_code", code, redirect_uri: redirectUri },
    now,
    "let the shop in",
  );
}

/** New keys for old. Xero gives a new renewal key each time. */
export function refreshTokens(
  app: XeroApp,
  refreshToken: string,
  now: Date,
): Promise<Tokens> {
  return tokenCall(
    app,
    { grant_type: "refresh_token", refresh_token: refreshToken },
    now,
    "renew the shop's key",
  );
}

/** The organisations the owner let the shop in to. */
export async function listOrganisations(
  app: XeroApp,
  accessToken: string,
): Promise<Organisation[]> {
  const answer = await send(
    app,
    CONNECTIONS_URL,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    },
    [accessToken],
  );
  if (answer.status !== 200 || !Array.isArray(answer.body)) {
    throw refused("did not say which organisations were let in", answer, [
      accessToken,
    ]);
  }
  return answer.body
    .map((item) => asRecord(item))
    .filter(
      (item): item is Json =>
        item !== null && text(item.tenantType, 40) === "ORGANISATION",
    )
    .map((item) => ({
      id: text(item.tenantId, 80),
      name: text(item.tenantName, 120) || "Your organisation",
    }))
    .filter((organisation) => organisation.id !== "");
}

/* ---- the accounting calls -------------------------------------------------- */

export type XeroApi = {
  readonly app: XeroApp;
  readonly accessToken: string;
  readonly tenantId: string;
};

async function api(
  connection: XeroApi,
  method: "GET" | "PUT",
  path: string,
  what: string,
  options: { readonly body?: unknown; readonly key?: string } = {},
): Promise<Json> {
  const answer = await send(
    connection.app,
    `${API}${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${connection.accessToken}`,
        "xero-tenant-id": connection.tenantId,
        Accept: "application/json",
        ...(options.body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
        ...(options.key === undefined
          ? {}
          : { "Idempotency-Key": options.key.slice(0, 128) }),
      },
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
    },
    [connection.accessToken],
  );
  const body = asRecord(answer.body);
  if (answer.status < 200 || answer.status >= 300 || body === null) {
    throw refused(what, answer, [connection.accessToken]);
  }
  return body;
}

function list(body: Json, key: string): Json[] {
  const items = body[key];
  return Array.isArray(items)
    ? items.map(asRecord).filter((item): item is Json => item !== null)
    : [];
}

export type XeroAccount = {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  /** "BANK", "REVENUE", "SALES" and so on. */
  readonly type: string;
  /** "REVENUE", "ASSET" and so on. */
  readonly class: string;
};

/** The chart of accounts: the live ones. */
export async function listAccounts(
  connection: XeroApi,
): Promise<XeroAccount[]> {
  const body = await api(
    connection,
    "GET",
    "/Accounts",
    "did not list its accounts",
  );
  return list(body, "Accounts")
    .filter((item) => text(item.Status, 20) === "ACTIVE")
    .map((item) => ({
      id: text(item.AccountID, 80),
      code: text(item.Code, 20),
      name: text(item.Name, 150),
      type: text(item.Type, 40),
      class: text(item.Class, 40),
    }))
    .filter((account) => account.id !== "");
}

export type XeroTaxRate = {
  readonly taxType: string;
  readonly name: string;
  readonly rate: number;
};

/** Tax rates that can go on a sale. */
export async function listTaxRates(
  connection: XeroApi,
): Promise<XeroTaxRate[]> {
  const body = await api(
    connection,
    "GET",
    "/TaxRates",
    "did not list its tax rates",
  );
  return list(body, "TaxRates")
    .filter(
      (item) =>
        text(item.Status, 20) === "ACTIVE" && item.CanApplyToRevenue !== false,
    )
    .map((item) => ({
      taxType: text(item.TaxType, 40),
      name: text(item.Name, 120),
      rate: amount(item.EffectiveRate),
    }))
    .filter((rate) => rate.taxType !== "");
}

export type XeroLine = {
  readonly Description: string;
  readonly Quantity: number;
  readonly UnitAmount: number;
  readonly AccountCode: string;
  readonly TaxType: string;
};

export type XeroInvoice = {
  readonly Type: "ACCREC";
  readonly Contact: { readonly Name: string };
  readonly Date: string;
  readonly DueDate: string;
  readonly InvoiceNumber: string;
  readonly Reference: string;
  readonly LineAmountTypes: "Inclusive" | "NoTax";
  readonly Status: "AUTHORISED";
  readonly CurrencyCode: "NZD";
  readonly LineItems: readonly XeroLine[];
};

export type XeroCreditNote = Omit<
  XeroInvoice,
  "Type" | "InvoiceNumber" | "DueDate"
> & {
  readonly Type: "ACCRECCREDIT";
  readonly CreditNoteNumber: string;
};

/** What a document in Xero comes to: its id, and what is left to settle. */
export type Held = { readonly id: string; readonly left: number };

const GONE = new Set(["VOIDED", "DELETED"]);

/** The invoice with this number, unless it was voided or deleted. */
export async function findInvoice(
  connection: XeroApi,
  number: string,
): Promise<Held | null> {
  const query = new URLSearchParams({ InvoiceNumbers: number });
  const body = await api(
    connection,
    "GET",
    `/Invoices?${query.toString()}`,
    "did not answer about an invoice",
  );
  const found = list(body, "Invoices").find(
    (item) =>
      text(item.InvoiceNumber, 60) === number &&
      !GONE.has(text(item.Status, 20)),
  );
  return found === undefined
    ? null
    : { id: text(found.InvoiceID, 80), left: amount(found.AmountDue) };
}

export async function createInvoice(
  connection: XeroApi,
  invoice: XeroInvoice,
  key: string,
): Promise<Held> {
  const body = await api(
    connection,
    "PUT",
    "/Invoices",
    "would not take the invoice",
    {
      body: { Invoices: [invoice] },
      key,
    },
  );
  const [made] = list(body, "Invoices");
  const id = text(made?.InvoiceID, 80);
  if (made === undefined || id === "") {
    throw new XeroError(
      "Xero took the invoice but did not say what it called it.",
      {
        status: 200,
        retryable: false,
      },
    );
  }
  return { id, left: amount(made.AmountDue) };
}

/** The credit note with this number, unless it was voided or deleted. */
export async function findCreditNote(
  connection: XeroApi,
  number: string,
): Promise<Held | null> {
  const query = new URLSearchParams({
    where: `CreditNoteNumber=="${number.replace(/"/g, "")}"`,
  });
  const body = await api(
    connection,
    "GET",
    `/CreditNotes?${query.toString()}`,
    "did not answer about a credit note",
  );
  const found = list(body, "CreditNotes").find(
    (item) =>
      text(item.CreditNoteNumber, 60) === number &&
      !GONE.has(text(item.Status, 20)),
  );
  return found === undefined
    ? null
    : { id: text(found.CreditNoteID, 80), left: amount(found.RemainingCredit) };
}

export async function createCreditNote(
  connection: XeroApi,
  note: XeroCreditNote,
  key: string,
): Promise<Held> {
  const body = await api(
    connection,
    "PUT",
    "/CreditNotes",
    "would not take the credit note",
    { body: { CreditNotes: [note] }, key },
  );
  const [made] = list(body, "CreditNotes");
  const id = text(made?.CreditNoteID, 80);
  if (made === undefined || id === "") {
    throw new XeroError(
      "Xero took the credit note but did not say what it called it.",
      { status: 200, retryable: false },
    );
  }
  return { id, left: amount(made.RemainingCredit) };
}

export type XeroPayment = {
  readonly Invoice?: { readonly InvoiceID: string };
  readonly CreditNote?: { readonly CreditNoteID: string };
  readonly Account: { readonly AccountID: string };
  readonly Date: string;
  readonly Amount: number;
  readonly Reference: string;
};

/** Money in against an invoice, or out against a credit note. */
export async function createPayment(
  connection: XeroApi,
  payment: XeroPayment,
  key: string,
): Promise<string> {
  const body = await api(
    connection,
    "PUT",
    "/Payments",
    "would not take the payment",
    {
      body: { Payments: [payment] },
      key,
    },
  );
  const [made] = list(body, "Payments");
  const id = text(made?.PaymentID, 80);
  if (id === "") {
    throw new XeroError(
      "Xero took the payment but did not say what it called it.",
      {
        status: 200,
        retryable: false,
      },
    );
  }
  return id;
}
