import { timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import { XERO_STATE_COOKIE } from "@/app/backstage/(app)/settings/xero/state";
import { currentStaff, staffCaller } from "@/lib/backstage/auth/current";
import { connectXero } from "@/lib/backstage/books/xero";
import { OpError } from "@/lib/backstage/core/errors";
import { execute } from "@/lib/backstage/core/op";
import { withNotice } from "@/lib/backstage/ui/notice";
import { xeroApp, xeroRedirectUri } from "@/lib/xero";
import { exchangeCode, listOrganisations, XeroError } from "@/lib/xero/client";
import { seal } from "@/lib/xero/seal";

const PAGE = "/backstage/settings/xero";

export const dynamic = "force-dynamic";

function same(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Where Xero sends the owner back after they let the shop in. Behind the
 * sign-in like every page of the back end, for an owner only, and only for
 * a sign-in this browser started (the word in the cookie). Whatever Xero
 * puts in the address is never repeated back: the notice says the back
 * end's own sentences.
 */
export async function GET(request: NextRequest): Promise<never> {
  const staff = await currentStaff();
  if (staff === null)
    redirect(`/backstage/sign-in?next=${encodeURIComponent(PAGE)}`);
  const jar = await cookies();
  const expected = jar.get(XERO_STATE_COOKIE)?.value ?? "";
  jar.delete(XERO_STATE_COOKIE);
  function say(sentence: string, tone: "good" | "bad"): never {
    redirect(withNotice(PAGE, sentence, tone));
  }

  if (staff.role !== "owner") say("Only an owner can connect Xero.", "bad");
  const params = request.nextUrl.searchParams;
  const state = params.get("state") ?? "";
  const code = params.get("code") ?? "";
  if (expected === "" || state === "" || !same(state, expected)) {
    say(
      "That answer from Xero was not for a sign-in started here, or it took too long. Nothing changed. Try again.",
      "bad",
    );
  }
  if (params.get("error") !== null || code === "") {
    say("Xero did not let the shop in. Nothing changed.", "bad");
  }
  const app = xeroApp();
  if (app === null)
    say("Xero cannot be connected from here. Nothing changed.", "bad");

  let target: string;
  try {
    const now = new Date();
    const tokens = await exchangeCode(app, code, xeroRedirectUri(), now);
    const organisations = await listOrganisations(app, tokens.accessToken);
    const done = await execute(
      connectXero,
      {
        organisations,
        accessToken: seal(tokens.accessToken, app.clientSecret),
        refreshToken: seal(tokens.refreshToken, app.clientSecret),
        expiresAt: tokens.expiresAt,
      },
      await staffCaller(),
    );
    target = withNotice(
      PAGE,
      done.organisation === null
        ? "Connected. Choose which organisation the books go to."
        : `Connected to ${done.organisation}. Now say where things go.`,
      "good",
    );
  } catch (error) {
    if (!(error instanceof XeroError || error instanceof OpError)) throw error;
    target = withNotice(PAGE, error.message, "bad");
  }
  redirect(target);
}
