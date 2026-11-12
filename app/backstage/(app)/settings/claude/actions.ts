"use server";

import { cutOffConnection, setConnectOn } from "@/lib/backstage/connect/oauth";
import { formText, submit } from "@/lib/backstage/ui/submit";

const PAGE = "/backstage/settings/claude";

/** Let Claude be connected, or stop it. An owner's button is the yes. */
export async function setConnectOnAction(form: FormData): Promise<void> {
  const on = formText(form, "on") === "yes";
  await submit(
    setConnectOn,
    { on },
    {
      back: PAGE,
      done: on
        ? "On. Claude can be connected now, with the address below."
        : "Off. Nothing can connect, and every connection has stopped working.",
    },
  );
}

/** End one connection, for good. */
export async function cutOffAction(form: FormData): Promise<void> {
  await submit(
    cutOffConnection,
    { id: formText(form, "id") },
    {
      back: PAGE,
      done: (done) =>
        done.cutOff
          ? "Cut off. It stopped working at once."
          : "Already cut off.",
    },
  );
}
