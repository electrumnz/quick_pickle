import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SiteFooter } from "@/components/site/Sections";
import { SiteHeader } from "@/components/site/SiteHeader";
import { POLICIES, policyBySlug } from "@/content/policies";

type Params = { readonly policy: string };

/** Only the four policies exist; anything else under this segment is a 404. */
export const dynamicParams = false;

export function generateStaticParams(): Params[] {
  return POLICIES.map((policy) => ({ policy: policy.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const policy = policyBySlug((await params).policy);
  if (policy === null) return {};
  return { title: policy.title, description: policy.intro };
}

/**
 * The fine print. One layout for delivery, returns, terms and privacy, all
 * rendered from content/policies.ts.
 */
export default async function PolicyPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const policy = policyBySlug((await params).policy);
  if (policy === null) notFound();

  return (
    <>
      <SiteHeader minimal />
      <main id="main" className="bg-cream px-gutter flex-1 pt-10 pb-20">
        <article className="mx-auto max-w-[42rem]">
          <h1 className="varsity text-[clamp(2.75rem,12vw,4.5rem)] leading-[0.95]">
            {policy.title}
          </h1>
          <p className="text-navy-muted mt-4 text-[1.125rem] leading-relaxed">
            {policy.intro}
          </p>

          <div className="mt-10 flex flex-col gap-9">
            {policy.sections.map((section) => (
              <section key={section.heading}>
                <h2 className="varsity text-[1.75rem] leading-tight">
                  {section.heading}
                </h2>
                {section.body.map((paragraph) => (
                  <p key={paragraph} className="mt-3 leading-relaxed">
                    {paragraph}
                  </p>
                ))}
              </section>
            ))}
          </div>

          <nav
            aria-label="More fine print"
            className="border-navy mt-14 border-t-[3px] pt-6"
          >
            <ul className="flex flex-wrap gap-x-6 gap-y-1">
              {POLICIES.filter((other) => other.slug !== policy.slug).map(
                (other) => (
                  <li key={other.slug}>
                    <Link href={`/${other.slug}`} className="link">
                      {other.title}
                    </Link>
                  </li>
                ),
              )}
            </ul>
          </nav>
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
