import type { Metadata } from "next";

import { SubmitButton } from "@/components/backstage/SubmitButton";
import { Notice, PageHeader, Panel, When } from "@/components/backstage/ui";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import {
  liveKey,
  xeroStatus,
  type XeroStatus,
} from "@/lib/backstage/books/xero";
import { execute } from "@/lib/backstage/core/op";
import { todayKey } from "@/lib/backstage/stock/dates";
import { getDb } from "@/lib/db/client";
import { formatNzd } from "@/lib/shop/money";
import { formatNzDateTime } from "@/lib/time";
import { xeroApp, xeroRedirectUri, xeroSetting } from "@/lib/xero";
import {
  listAccounts,
  listTaxRates,
  XeroError,
  type XeroAccount,
  type XeroTaxRate,
} from "@/lib/xero/client";

import {
  chooseOrganisationAction,
  connectXeroAction,
  disconnectXeroAction,
  setUpXeroAction,
  tryXeroAgainAction,
} from "./actions";

export const metadata: Metadata = { title: "Xero" };

const PAGE = "/backstage/settings/xero";

type Lists =
  | { readonly accounts: XeroAccount[]; readonly taxRates: XeroTaxRate[] }
  | { readonly trouble: string };

function leadOf(status: XeroStatus, on: boolean, held: string | null): string {
  if (!on) {
    return held === null
      ? "Off. Once the shop's Xero app is set up on the host, an owner can connect your Xero here."
      : `Off here. ${held}`;
  }
  if (!status.connected) {
    return "Not connected. Connect your Xero, say where things go, and each sale and refund goes there by itself.";
  }
  if (status.lost)
    return "Xero needs connecting again. Sales wait here until it is.";
  if (status.choose.length > 0) {
    return "Connected. Choose which organisation the books go to.";
  }
  if (!status.sending) {
    return `Connected to ${status.organisation ?? "your organisation"}. Say where things go, and sales start going.`;
  }
  return `On. Each sale and refund goes to ${status.organisation ?? "your Xero"} by itself, a few minutes after it happens.`;
}

/**
 * Xero: whether it can be connected, connecting it, where sales and refunds
 * go in it, and what has gone. Off until an owner connects it, and nothing
 * is sent until they have said where things go.
 */
export default async function XeroSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; tone?: string }>;
}) {
  const staff = await requireStaff(PAGE);
  const params = await searchParams;
  const caller = await staffCaller();
  const status = await execute(xeroStatus, {}, caller);
  const setting = xeroSetting();
  const isOwner = staff.role === "owner";
  const app = xeroApp();
  const now = new Date();

  // What the form offers comes from Xero itself: its accounts and its tax
  // rates, never a list of ours.
  let lists: Lists | null = null;
  if (
    app !== null &&
    isOwner &&
    status.connected &&
    status.lost === null &&
    status.choose.length === 0
  ) {
    try {
      const db = await getDb();
      const key = await liveKey(db, app, now);
      const connection = {
        app,
        accessToken: key.accessToken,
        tenantId: key.row.tenantId ?? "",
      };
      lists = {
        accounts: await listAccounts(connection),
        taxRates: await listTaxRates(connection),
      };
    } catch (error) {
      if (!(error instanceof XeroError)) throw error;
      lists = { trouble: error.message };
    }
  }
  const chosen = status.setUp;
  const revenue =
    lists !== null && "accounts" in lists
      ? lists.accounts.filter(
          (account) => account.class === "REVENUE" && account.code !== "",
        )
      : [];
  const banks =
    lists !== null && "accounts" in lists
      ? lists.accounts.filter((account) => account.type === "BANK")
      : [];
  const rates = lists !== null && "taxRates" in lists ? lists.taxRates : [];
  const gstOnIncome =
    rates.find((rate) => rate.taxType === "OUTPUT2")?.taxType ?? "";

  return (
    <>
      <PageHeader
        title="Xero"
        back={{ href: "/backstage/settings", label: "Settings" }}
        lead={leadOf(status, setting.on, setting.held)}
      />
      {params.notice ? (
        <div className="mb-4">
          <Notice tone={params.tone === "bad" ? "bad" : "good"}>
            {params.notice}
          </Notice>
        </div>
      ) : null}

      <div className="flex flex-col gap-6">
        <Panel title="What goes">
          <div className="flex flex-col gap-3 leading-snug">
            <p>
              Each sale is an invoice, dated the day it was paid, numbered with
              the order&apos;s number, with a line for each pack, one for
              anything a code took off, and one for delivery. It is paid in full
              into the bank account you choose, with Stripe&apos;s reference on
              it, so it lines up with Stripe&apos;s own feed in Xero.
            </p>
            <p>
              Each refund is a credit note, dated the day it was given, paid out
              of the same account. Test orders never go, and every sale is made
              out to one contact: no customer&apos;s name or address goes to
              Xero.
            </p>
            <p className="bk-muted">
              Stripe&apos;s fees are not sent: they come in on Stripe&apos;s own
              feed. The shop does no accounting. That stays with Xero and your
              accountant.
            </p>
          </div>
        </Panel>

        {setting.missing.length > 0 ? (
          <Panel title="What it needs first">
            <ol className="flex list-decimal flex-col gap-2 pl-5 leading-snug">
              <li>
                In Xero&apos;s developer site (developer.xero.com), make an app
                of the &ldquo;Web app&rdquo; kind for the shop, with this as its
                redirect address:{" "}
                <code className="break-all">{xeroRedirectUri()}</code>
              </li>
              <li>
                Put its client id and secret in the repository&apos;s secrets as{" "}
                <code>QP_XERO_CLIENT_ID</code> and{" "}
                <code>QP_XERO_CLIENT_SECRET</code>.
              </li>
              <li>
                Ask the AI for <code>connect-xero</code> and{" "}
                <code>redeploy</code>. Then come back here and connect.
              </li>
            </ol>
          </Panel>
        ) : null}

        {setting.on && (!status.connected || status.lost !== null) ? (
          <Panel title={status.lost ? "Connect again" : "Connect"}>
            <div className="flex flex-col gap-3">
              {status.lost ? (
                <p className="leading-snug" role="status">
                  {status.lost.reason}
                </p>
              ) : null}
              <p className="bk-muted text-sm leading-snug">
                The shop&apos;s app in Xero has to list this as its redirect
                address: <code className="break-all">{xeroRedirectUri()}</code>
              </p>
              {isOwner ? (
                <form action={connectXeroAction}>
                  <SubmitButton pending="Going to Xero" className="bk-btn">
                    {status.lost ? "Connect Xero again" : "Connect Xero"}
                  </SubmitButton>
                </form>
              ) : (
                <p className="bk-muted leading-snug">An owner connects it.</p>
              )}
            </div>
          </Panel>
        ) : null}

        {status.choose.length > 0 && isOwner ? (
          <Panel title="Which organisation">
            <form
              action={chooseOrganisationAction}
              className="flex flex-col gap-3"
            >
              <fieldset className="flex flex-col gap-2">
                <legend className="field-label">The books go to</legend>
                {status.choose.map((organisation, at) => (
                  <label
                    key={organisation.id}
                    className="flex items-center gap-2"
                  >
                    <input
                      type="radio"
                      name="tenantId"
                      value={organisation.id}
                      defaultChecked={at === 0}
                    />
                    {organisation.name}
                  </label>
                ))}
              </fieldset>
              <SubmitButton pending="Saving" className="bk-btn">
                Use this one
              </SubmitButton>
            </form>
          </Panel>
        ) : null}

        {lists !== null && "trouble" in lists ? (
          <Notice tone="bad">{lists.trouble}</Notice>
        ) : null}

        {lists !== null && "accounts" in lists ? (
          <Panel title="Where things go">
            {status.gstRegistered === null ? (
              <p className="leading-snug">
                Say whether the business is registered for GST first, in
                Settings, The shop. It decides how every sale is written in
                Xero.
              </p>
            ) : (
              <form action={setUpXeroAction} className="flex flex-col gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="salesAccount" className="field-label">
                      Sales go to
                    </label>
                    <select
                      id="salesAccount"
                      name="salesAccount"
                      defaultValue={chosen.salesAccount ?? ""}
                      className="field"
                      required
                    >
                      <option value="">Choose an account</option>
                      {revenue.map((account) => (
                        <option key={account.id} value={account.code}>
                          {account.code} {account.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="deliveryAccount" className="field-label">
                      Delivery goes to
                    </label>
                    <select
                      id="deliveryAccount"
                      name="deliveryAccount"
                      defaultValue={chosen.deliveryAccount ?? ""}
                      className="field"
                      required
                    >
                      <option value="">Choose an account</option>
                      {revenue.map((account) => (
                        <option key={account.id} value={account.code}>
                          {account.code} {account.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="bankAccount" className="field-label">
                      Money comes in and goes out through
                    </label>
                    <select
                      id="bankAccount"
                      name="bankAccount"
                      defaultValue={
                        chosen.bankAccountId === null
                          ? ""
                          : `${chosen.bankAccountId}::${chosen.bankAccountName ?? ""}`
                      }
                      className="field"
                      required
                    >
                      <option value="">Choose a bank account</option>
                      {banks.map((account) => (
                        <option
                          key={account.id}
                          value={`${account.id}::${account.name}`}
                        >
                          {account.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  {status.gstRegistered ? (
                    <div>
                      <label htmlFor="taxType" className="field-label">
                        GST on a sale
                      </label>
                      <select
                        id="taxType"
                        name="taxType"
                        defaultValue={chosen.taxType ?? gstOnIncome}
                        className="field"
                        required
                      >
                        <option value="">Choose a tax rate</option>
                        {rates.map((rate) => (
                          <option key={rate.taxType} value={rate.taxType}>
                            {rate.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                  <div>
                    <label htmlFor="contactName" className="field-label">
                      Every sale is made out to
                    </label>
                    <input
                      id="contactName"
                      name="contactName"
                      defaultValue={
                        chosen.contactName ?? "Quick Pickle online shop"
                      }
                      className="field"
                      maxLength={100}
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="startDay" className="field-label">
                      Sales from this day go
                    </label>
                    <input
                      id="startDay"
                      name="startDay"
                      type="date"
                      defaultValue={chosen.startDay ?? todayKey(now)}
                      className="field"
                      required
                    />
                  </div>
                </div>
                <p className="bk-muted leading-snug">
                  The bank account is usually the one Stripe&apos;s feed comes
                  in on. Ask your accountant if you are not sure which accounts
                  to use.
                </p>
                <SubmitButton pending="Saving" className="bk-btn">
                  {status.sending ? "Save" : "Save, and start sending"}
                </SubmitButton>
              </form>
            )}
          </Panel>
        ) : null}

        {status.connected ? (
          <Panel title="What has gone">
            <div className="flex flex-col gap-3 leading-snug">
              <p>
                {status.sent === 0
                  ? "Nothing has gone to Xero yet."
                  : `${String(status.sent)} ${status.sent === 1 ? "sale or refund is" : "sales and refunds are"} in Xero.`}
                {status.lastRoundAt ? (
                  <>
                    {" "}
                    Last looked <When at={status.lastRoundAt} now={now} />.
                  </>
                ) : null}
              </p>
              {status.lastRoundSaid ? (
                <p role="status">{status.lastRoundSaid}</p>
              ) : null}
              {status.failed.length > 0 ? (
                <ul className="flex flex-col gap-3" data-testid="xero-failed">
                  {status.failed.map((item) => (
                    <li key={item.key} className="flex flex-col gap-2">
                      <p>
                        <strong>
                          {item.kind === "sale"
                            ? item.number
                            : `A refund on ${item.number}`}
                        </strong>
                        {item.state === "failed"
                          ? `: Xero would not take it. ${item.trouble ?? ""}`
                          : `: left out. ${item.trouble ?? ""}`}
                      </p>
                      {staff.role !== "viewer" ? (
                        <form action={tryXeroAgainAction}>
                          <input type="hidden" name="key" value={item.key} />
                          <SubmitButton
                            pending="Saving"
                            className="bk-btn bk-btn-quiet"
                          >
                            Send it again
                          </SubmitButton>
                        </form>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              {status.cameBack.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <p>
                    These refunds went to Xero and later came back to us,
                    because the customer&apos;s bank could not take them. Xero
                    still shows them as paid out. Ask your accountant how to put
                    each right.
                  </p>
                  <ul className="flex flex-col gap-1">
                    {status.cameBack.map((item) => (
                      <li key={`${item.number}-${item.at.toISOString()}`}>
                        {item.number}: {formatNzd(item.amountCents)}, came back{" "}
                        {formatNzDateTime(item.at)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </Panel>
        ) : null}

        {status.connected && isOwner ? (
          <Panel title="Disconnect">
            <form action={disconnectXeroAction} className="flex flex-col gap-3">
              <p className="leading-snug">
                {status.connectedBy
                  ? `Connected by ${status.connectedBy}${status.connectedAt ? ` on ${formatNzDateTime(status.connectedAt)}` : ""}. `
                  : ""}
                Disconnecting stops anything more going. What is already in Xero
                stays. To take the shop&apos;s access away in Xero too, remove
                it under Connected apps in Xero.
              </p>
              <SubmitButton
                pending="Disconnecting"
                className="bk-btn bk-btn-quiet"
              >
                Disconnect Xero
              </SubmitButton>
            </form>
          </Panel>
        ) : null}
      </div>
    </>
  );
}
