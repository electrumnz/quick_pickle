"use server";

import { staffCaller } from "@/lib/backstage/auth/current";
import { OpError } from "@/lib/backstage/core/errors";
import { execute } from "@/lib/backstage/core/op";
import { sendMorningEmail, setMorningEmail } from "@/lib/backstage/digest/ops";
import { formText, sayAndGo, submit } from "@/lib/backstage/ui/submit";

const PAGE = "/backstage/settings/morning-email";

/** Switch it on or off, and say where it goes. */
export async function saveMorningEmailAction(form: FormData): Promise<void> {
  const on = formText(form, "on") === "yes";
  const to = formText(form, "to");
  await submit(
    setMorningEmail,
    { on, to: to === "" ? null : to },
    {
      back: PAGE,
      done: (saved) =>
        saved.on
          ? `On. It goes to ${saved.to ?? ""} each morning, around seven.`
          : "Off. Nothing is sent.",
    },
  );
}

/** Write one this minute, to see it arrive. */
export async function sendOneNowAction(): Promise<void> {
  const caller = await staffCaller();
  let said: { text: string; tone: "good" | "bad" };
  try {
    const sent = await execute(sendMorningEmail, { now: true }, caller);
    said = sent.written
      ? {
          text: "Written and on its way. It should arrive within a minute.",
          tone: "good",
        }
      : { text: `Not sent. ${sent.why}`, tone: "bad" };
  } catch (error) {
    if (!(error instanceof OpError)) throw error;
    said = { text: error.message, tone: "bad" };
  }
  sayAndGo(PAGE, said.text, said.tone);
}
