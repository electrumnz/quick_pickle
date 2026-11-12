import type { Metadata } from "next";

import { ChoosePasswordForm } from "../forms";

export const metadata: Metadata = { title: "Choose a password" };

export default async function PasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <>
      <h1 className="bk-h1">Choose a password</h1>
      {token === undefined || token.length < 20 ? (
        <p className="bk-notice bk-notice-bad mt-4">
          This page needs the link from your invitation. Open that link again,
          or ask an owner for a new one.
        </p>
      ) : (
        <>
          <p className="bk-muted mt-2 mb-6 leading-snug">
            This link works once. After this you sign in with your email and the
            password you choose here.
          </p>
          <ChoosePasswordForm token={token} />
        </>
      )}
    </>
  );
}
