import Link from "next/link";

import { Art } from "@/components/brand/Art";
import { SiteHeader } from "@/components/site/SiteHeader";
import { NOT_FOUND } from "@/content/site";

export default function NotFound() {
  return (
    <>
      <SiteHeader minimal />
      <main
        id="main"
        className="on-pink bg-pink px-gutter flex flex-1 flex-col items-center justify-center py-16 text-center"
      >
        <Art
          name="lucky-sleeping"
          alt={NOT_FOUND.alt}
          sizes="(min-width: 768px) 260px, 50vw"
          className="w-[50%] max-w-[16rem]"
          eager
        />
        <h1 className="display text-cream mt-8 text-[min(17vw,6rem)] leading-[0.9]">
          {NOT_FOUND.title.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </h1>
        <p className="label text-navy mt-5 max-w-[22rem] text-[1.35rem] leading-tight">
          {NOT_FOUND.body}
        </p>
        <Link href="/" className="btn btn-lg btn-on-pink mt-8">
          <span className="cap-trim">{NOT_FOUND.cta}</span>
        </Link>
      </main>
    </>
  );
}
