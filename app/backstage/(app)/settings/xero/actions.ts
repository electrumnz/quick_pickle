"use server";

import { randomBytes } from "node:crypto";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  chooseOrganisation,
  disconnectXero,
  setUpXero,
  tryXeroAgain,
} from "@/lib/backstage/books/xero";
import { requestIsSecure, requireStaff } from "@/lib/backstage/auth/current";
import { formText, sayAndGo, submit } from "@/lib/backstage/ui/submit";
import { xeroApp, xeroRedirectUri, XERO_CALLBACK_PATH } from "@/lib/xero";
import { authorizeUrl } from "@/lib/xero/client";

import { XERO_STATE_COOKIE } from "./state";

const PAGE = "/backstage/settings/xero";

/**
 * Send the owner to Xero to let the shop in. The address is Xero's own, put
 * together here from fixed parts: nothing in it was handed to us. A word only
 * this browser holds goes with it, and comes back with the owner, so the
 * callback knows the sign-in was started here.
 */
export async function connectXeroAction(): Promise<void> {
  const staff = await requireStaff(PAGE);
  if (staff.role !== "owner")
    sayAndGo(PAGE, "Only an owner can connect Xero.", "bad");
  const app = xeroApp();
  if (app === null) {
    sayAndGo(
      PAGE,
      "Xero cannot be connected from here yet. The page says what it needs.",
      "bad",
    );
  }
  const state = randomBytes(24).toString("base64url");
  (await cookies()).set(XERO_STATE_COOKIE, state, {
    httpOnly: true,
    secure: await requestIsSecure(),
    sameSite: "lax",
    path: XERO_CALLBACK_PATH,
    maxAge: 10 * 60,
  });
  redirect(authorizeUrl(app, xeroRedirectUri(), state));
}

export async function chooseOrganisationAction(form: FormData): Promise<void> {
  await submit(
    chooseOrganisation,
    { tenantId: formText(form, "tenantId") },
    {
      back: PAGE,
      done: (done) => `The books go to ${done.name}. Now say where things go.`,
    },
  );
}

export async function setUpXeroAction(form: FormData): Promise<void> {
  // The bank account comes as "<Xero's id>::<its name>", so the screen can
  // say which it is without asking Xero again.
  const [bankAccountId = "", bankAccountName = ""] = formText(
    form,
    "bankAccount",
  ).split("::");
  await submit(
    setUpXero,
    {
      salesAccount: formText(form, "salesAccount"),
      deliveryAccount: formText(form, "deliveryAccount"),
      bankAccountId,
      bankAccountName,
      taxType: formText(form, "taxType") || undefined,
      contactName: formText(form, "contactName"),
      startDay: formText(form, "startDay"),
    },
    {
      back: PAGE,
      done: "Saved. Sales and refunds go to Xero by themselves from that day, a few minutes after each happens.",
    },
  );
}

export async function disconnectXeroAction(): Promise<void> {
  await submit(
    disconnectXero,
    {},
    {
      back: PAGE,
      done: "Disconnected. Nothing more goes to Xero, and nothing already there has changed.",
    },
  );
}

export async function tryXeroAgainAction(form: FormData): Promise<void> {
  await submit(
    tryXeroAgain,
    { key: formText(form, "key") },
    {
      back: PAGE,
      done: "Back in line. The next round sends it, within a few minutes.",
    },
  );
}
