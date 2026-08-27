import { expect, test } from "@playwright/test";

test("robots.txt is served and keeps the admin group out of indexes", async ({
  request,
}) => {
  const response = await request.get("/robots.txt");
  expect(response.status()).toBe(200);

  const body = await response.text();
  expect(body).toContain("User-Agent: *");
  expect(body).toContain("Disallow: /admin");
  expect(body).toMatch(/Sitemap: https?:\/\/[^\s]+\/sitemap\.xml/);
});

test("sitemap.xml is served and lists absolute URLs", async ({ request }) => {
  const response = await request.get("/sitemap.xml");
  expect(response.status()).toBe(200);

  const body = await response.text();
  expect(body).toContain("<urlset");
  expect(body).toMatch(/<loc>https?:\/\/[^<]+<\/loc>/);
  // The admin group is disallowed in robots.txt and must never be advertised.
  expect(body).not.toContain("/admin");
});

test("home page emits an absolute canonical and Open Graph URL", async ({
  page,
}) => {
  await page.goto("/");

  const canonical = await page
    .locator('link[rel="canonical"]')
    .getAttribute("href");
  expect(canonical).toMatch(/^https?:\/\//);

  const ogUrl = await page
    .locator('meta[property="og:url"]')
    .getAttribute("content");
  expect(ogUrl).toMatch(/^https?:\/\//);
});
