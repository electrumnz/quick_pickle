import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

export default function AdminHomePage() {
  return (
    <section className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
      <p className="text-base opacity-70">
        Placeholder. Auth gate and operator tooling land here.
      </p>
    </section>
  );
}
