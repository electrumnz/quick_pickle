<!-- Generated from the design review of 2 September 2026. Screenshots referenced in the text were taken from the live site; the HTML version of this review carries them. -->

Design and UX review · customer-facing pages

# Half Sour storefront review

Reviewed on the live site, half-sour.vercel.app, 2 September 2026 · desktop 1440, mobile 390, light and dark

The site is tidy, consistent and legally careful, and the wholesale page is genuinely good. But as a shop it is hard to use and easy to forget. Four things are holding it back more than anything else: a demo banner and an open admin link are live on every public page, there is no cart page at all, the header's Buy button scrolls to the bottom of the homepage instead of going to the shop, and the homepage spends two full screens of scrolling on a hero that barely moves. Underneath those, the site is a one-page homepage bolted to a multi-page store, which is why it feels confusing to move around.

On the competitor question: the visual language is not copied from the pickle competitors. It is the generic "considered DTC" recipe of the last two years, cream ground, high-contrast serif, one acid accent, mono eyebrows. That is why it feels like it could be anyone's. The things that would make it unmistakably Half Sour are already in the repo (the drawn wordmark, the label architecture, the photography, the real numbers) and the page design uses them less than it should.

What I found

- Fix before anyone else sees it: **3**
- Store UX: **7**
- How it moves and flows: **5**
- Visual identity and type: **5**
- Pages reviewed: **11**

Screenshots below are from the production deployment, not a local build. Text content on the live shop page matched this branch's build word for word apart from the banner.

## What is working

- **Job-first product cards** "The martini", "Seafood", "The everyday one" as the headline is the right call for a product nobody has heard of.
- **The chooser** "If you are making a gibson, No. 02 DIRTY" is the best conversion device on the site. It is buried at the bottom of the shop.
- **Wholesale page** A real price table, the working shown, a two-field form. This is the tone the whole site should have.
- **Photography** The bottle shots are strong, the labels read, the black slate ground is a genuine point of view.
- **Honesty in the copy** Delivery cost on the shop page, real stock counts, a 404 that lists the range. None of this is common.
- **Works without JavaScript** Every form and menu still functions. Accessibility floors (44px targets, focus, headings) are in place.

## Fix before anyone else sees it

### 01. The demo banner and the admin door are live in production

_Blocking._

Every public page carries a fixed acid-green bar at the bottom reading "DEMO. Everything here is invented. Nothing is a real order. The admin is open." The footer of every page has an "Open the admin" button. Every page is also sent with noindex, so search engines will not list the shop. A customer arriving from a bartender's recommendation is told the shop is fake and offered the back office.

At 1440×900 the banner covers the hero's two buttons. At 390×844 it covers the second button and the join-the-list field on every page.

**Do:** keep demo mode on a preview deployment and turn `HALF_SOUR_DEMO` off for production, or at minimum stop rendering the banner, the footer admin link and the noindex headers on public routes when the site is the live one. This is a one-variable change and a legal one as much as a design one.

### 02. There is no cart

_Blocking._

The "Cart 1" chip in the masthead is a label, not a link. The only route to checkout is the green "Added to your cart" strip that appears straight after you press Add. Leave that page, or add a second bottle, and there is no way to see what is in the cart, change a quantity, remove a line, or see the total. On mobile the strip sits under the demo banner.

Every shopper expects to be able to open a cart from the header. Its absence will read as broken, not minimal.

**Do:** a `/cart` page or a slide-over drawer, reached from the chip. Lines with quantity steppers and remove, delivery line, total, one checkout button. The added strip can stay as confirmation.

### 03. The hero pins for two and a half screens and nothing happens

_Blocking._

With motion allowed the hero track is 260vh tall. Scrolling from 0 to 1400px on desktop produces the two frames on the right: the photo scales up about 16 per cent and the giant wordmark fades. The range, the reason to be on the page, arrives after roughly 2000px of scrolling. The buttons are below the fold at rest on both desktop and mobile.

A scroll-scrub earns its length when something is revealed. Here a still image is being zoomed, which most people will read as the page being stuck.

**Do:** make the hero one viewport: wordmark, photograph, statement, both buttons all visible at rest at 1440×900 and 390×844. If any scrub survives, cap it at about 120vh. Consider whether the statement and buttons should sit beside or over the photograph rather than under it.

## Store UX

### 04. The homepage and the shop are two different websites

_Important._

The homepage has its own masthead (six links plus a Buy button that scrolls to the bottom of the same page) and its own footer with the round mark. Every other page has a different masthead (three links plus the cart chip) and a different footer with the wordmark and different columns. The homepage has no cart indicator at all, so a shopper who adds a bottle and goes home loses sight of it.

The code comments say this was deliberate so the section anchors would not appear on other pages. The cost is that the site does not feel like one place.

**Do:** one masthead everywhere: wordmark, Shop, Recipes, Wholesale, cart. The homepage's section anchors can live in the page itself. One footer. "Buy" in the header goes to the shop, not to an anchor.

### 05. The set is shown as a cartoon next to photographs

_Important._

The First Three is the highest-value item and the one the homepage pushes. On the shop and its own page it is drawn as three flat vector bottles, one of them amber, labelled 01, 02, 03 in a different type. Beside four photographed bottles it looks like a placeholder from a different brand, and the amber bottle contradicts the red SMOKE the shopper just saw.

**Do:** a composite of the three real bottle shots on the same slate ground, or a photograph of the box. Until then, use the range photograph cropped to the first three.

### 06. The recipe library is 25 black boxes

_Important._

Recipes are the best marketing content the company has, and the index is the least appetising page on the site. Each tile opens with a black block of mono type reading "THE BUILD" and three measures. Twenty-five of them in a grid reads as a code listing. On mobile the black block is half the screen before the drink's name appears.

The code explains there are no photographs of the drinks and that showing the bottle would misrepresent the recipe. Both are true, and neither requires black boxes.

**Do:** lead with the drink name in the display face, the build under it as a quiet list on the page ground, and one small device that says which bottle: the seal colour, or a drawn glass silhouette per serve type (shot, coupe, highball, shell) which the serve data already records. Add filters by bottle and by drink or dish; there are 25 entries and four bottles.

### 07. Product cards carry nine things and the grid breaks

_Important._

Eyebrow, serif job title, mono name and descriptor, one-line, tasting notes, supply note, price, unit price, availability chip, add button. "Mezcal, michelada, pork" wraps to two lines and the whole row's baselines shift. The eye has nowhere to land.

**Do:** photo, job, name, price, add. Notes and unit price belong on the product page. Give the job one line (shorten SMOKE's to "Mezcal and pork" or "The michelada").

### 08. The product page is an essay with one picture

_Important._

Seven sections, one photograph, and everything else set as type: five tasting notes in a numbered list, the ingredient run in display size on a green band, six serve cards, the set, the rest of the range. It is well written and it is long. Nothing after the first screen shows the product being used.

**Do:** a second image of the serve (the clip assets already exist per bottle). Merge "In the order it arrives" and "What goes in the tank" into one compact band. Keep the sticky buy bar, it is doing the right job.

### 09. The homepage repeats the shop instead of selling it

_Important._

The range section lists the same five products as the shop, in rows, with a small text link. Then the shop lists them again as cards. Meanwhile the chooser ("If you are making…"), the one device that turns a stranger into a buyer, is only on the shop page, at the bottom.

**Do:** homepage as photograph, one line, chooser, then the four serves. Let the shop be the place the five products are listed. Make the range rows clickable end to end if they stay.

### 10. Small things

_Minor._

- The footer email on every page is at halfsour.co.nz, a domain the TODO says is not yet registered. Mail to it bounces.
- Six copies of the wordmark in the first desktop screen: masthead, giant heading, and one on each of four labels.
- "One size. Nothing to choose." on the product page is a sentence where a control would normally be. It adds height and no information.
- The delivery paragraph appears in full on the shop page, on every product page, in the added strip and in the checkout. Once on the shop page and once at checkout is enough.
- Dark mode is coherent (the product photography is on black so it holds up). Low priority.

## How the site moves

### 16. "Buy" in the header does not go to the shop

_Blocking._

On the homepage the Buy button is an anchor. Pressing it scrolls 6,300px down a page 8,100px tall (5,700px on a phone) and lands on a section called "Buy a bottle" whose main control is another button, "Shop the range". So the most prominent call to action on the site takes two presses and a long smooth-scroll to reach the products. On mobile the menu panel is still open when you arrive, because a plain disclosure does not close itself.

This is the single thing that makes the site feel like a one-page site that is not one.

**Do:** Buy goes to `/shop`. Everywhere. Drop the in-page "Buy a bottle" section or fold it into the shop.

### 17. The custom cursor and smooth scroll are working against the shop

_Important._

On a desktop with a mouse, a green disc follows the pointer and, over any link, swells into a pill carrying a mono label ("HOW IT'S MADE", "BUY"). Over the Buy button the disc sits on top of the button and hides the word. Underneath it, Lenis smooth-scroll adds inertia to every wheel movement, so the page keeps moving after you stop. Both are the vocabulary of agency portfolio sites. On a shop they slow the page, cost script, and make people feel they are not in control of the scroll.

**Do:** remove the custom cursor. Remove Lenis, or keep it only on the homepage if you love it. Native scroll on the shop, product and cart pages.

### 18. Add to cart reloads the page and scrolls you away

_Important._

Pressing Add on a shop card submits a form, the page reloads with `?added=…#added`, and the browser jumps to a green strip that sits above the product grid, so the bottle you just chose is now below the fold. Adding a second bottle replaces the strip. The masthead chip updates to "Cart 2" but still cannot be pressed. Everything works, and it works without JavaScript, but as a shopping interaction it feels like 2009.

**Do:** keep the no-JS form as the fallback and progressively enhance it: on a JS-enabled page, Add updates the cart in place, the chip counts up, and a cart drawer opens from the header. No reload, no jump.

### 19. On desktop the buy button disappears after the first screen

_Important._

The product page's sticky buy bar only exists below 1024px. On desktop the buy panel sticks inside its own column, and that column ends with the first section. From the tasting notes to the footer, about 4,000px, there is nothing to press to buy the bottle except the set's Add button in the bundle block. On mobile the sticky bar and the demo banner both fix to the bottom edge and fight for it.

**Do:** a slim sticky bar on desktop too (name, price, Add), appearing once the main panel scrolls off, as the mobile one already does.

### 20. Interaction details that are fine, and a few that are not

_Minor._

- **Good:** a visible focus ring on every control; the whole card is a link on the shop; forms answer inline ("You're on the list", the samples confirmation) and work with scripting off; reduced-motion collapses the hero to one screen; the simulated checkout is clear about what it is.
- Hovering a product card does nothing. A small lift or a photo change would say "this is a thing you can open".
- Section reveals: every block below the hero is hidden by script on load and faded in on scroll. On a fast scroll the content chases you. Cut the reveal to the homepage, or drop it.
- The mobile "Menu +" disclosure opens over the hero rather than pushing it, and the panel's background is the page colour, so the hero shows through at the bottom edge.
- The quantity control is a native select with one to nine. A stepper reads faster and matches the mono numbers.
- Product page "The full recipe" is a plain text line that happens to be a link. Give it the arrow the other links have.

## Page-to-page flow

You are right that it feels like a one-page site that is not one. The homepage is built as a one-pager: its own navigation of section anchors, its own footer, a Buy button that scrolls, a "range" that lists every product, and a "buy" section at the bottom. Then the shop, the product pages, recipes and wholesale are a conventional multi-page store with a different header and footer. The two models are stitched together at the Shop link, and a visitor is never sure which one they are in.

A flat, ordinary structure would fix most of findings 04, 09, 16 and 17 at once. Proposed:

| Page                | Job                                        | What changes                                                                                                                                                               |
| ------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home                | Say what it is and send people to the shop | One screen of photograph and line, the chooser, the four serves, a row of the four bottles linking to their pages. No anchors in the nav, no "buy" section, no range list. |
| Shop                | List the five products                     | As now, with lighter cards and the chooser moved up under the heading.                                                                                                     |
| Product ×5          | Sell one bottle                            | As now, shorter, with a second image and a desktop sticky bar.                                                                                                             |
| Cart                | Review and change the order                | New. Page or drawer, reached from the header chip.                                                                                                                         |
| Checkout            | Pay                                        | Shopify's hosted checkout once the tokens exist.                                                                                                                           |
| Recipes, Recipe ×25 | Give reasons to buy                        | As now, with the tiles redesigned and filters.                                                                                                                             |
| How it's made       | Prove the spec                             | Currently a homepage section. Give it a page; it is the brand's best proof and it deserves a URL.                                                                          |
| Wholesale           | Trade price and samples                    | Keep.                                                                                                                                                                      |
| Delivery, Terms     | Policy                                     | Keep.                                                                                                                                                                      |
| Stockists, Story    | When they exist                            | Already planned; the nav filter will show them.                                                                                                                            |

One header on every page: wordmark to Home, then Shop, Recipes, How it's made, Wholesale, and the cart. One footer. Buy means `/shop`. Nothing in the navigation scrolls; everything navigates.

## Visual identity and type

### 11. The look is the genre, not the product

_Important._

Cream page, high-contrast serif headings, one acid-green accent, mono eyebrows in tracked caps, hairline rules, pill buttons. This is the default of most considered direct-to-consumer drinks and food sites of 2025 and 2026. It is competent and it is anonymous. The brand guide's competitor set (Good Girl Snacks, Van Holten's, The Pickle House, Six Barrel) is not what was copied; the genre template is.

What only Half Sour has is already in the build: a drawn wordmark, a label with a strict architecture (rule, wordmark, rule, seal, number in a box, name, descriptor, ingredient run, coloured foot band), a seal colour per bottle, real batch numbers, and bar-at-4pm photography.

**Do:** let the label design the page. Product pages take their one colour from the bottle's seal and foot band. Section heads use the label's rule-name-rule device. The ingredient run is set the way the label sets it. The photograph is allowed to be large and cropped, as the brand guide asks. Drop the pill buttons for the label's hairline box.

### 12. The typefaces in the code are not the typefaces in the brand guide

_Important._

The guide specifies Instrument Serif, Archivo and Martian Mono. The site ships Fraunces, Inter Tight and no mono webfont at all. Prices, eyebrows, stock counts and the recipe builds are set in whatever monospace the visitor's device has: Menlo on a Mac, Consolas on Windows, Roboto Mono or a fallback on Android. The guide calls the numbers "the brand's whole personality" and they currently look like a terminal.

**Do:** pick the mono and ship it (Martian Mono per the guide, or JetBrains Mono, both free). Then decide the serif and grotesk once, and update either the guide or the code so they agree.

### 13. Too much muted text

_Minor._

Whole ledes and paragraphs are set in the muted grey on cream. It passes contrast, but a page where most of the reading is secondary-coloured has no secondary level left. Reserve muted for captions and metadata; body copy in ink.

### 14. Mono caps everywhere

_Minor._

Eyebrows, section labels, breadcrumbs, product names, chips, table heads and footer headings are all tracked uppercase mono. When everything is a label nothing is. Keep it for numbers, codes and one eyebrow per section.

### 15. Where to look instead of direct competitors

_Minor._

Not to copy, but as a better reference set for a bottled ingredient sold to bars and cooks:

- **Spirits and bitters with numbered ranges.** Bottle first, serve second, one colour per expression, a proper cart. This is the shelf Half Sour wants to sit on.
- **Ingredient brands that sell by the dish.** Chilli crisp, olive oil and spice brands that lead with "what to make" and show the product in use on every page.
- **New Zealand hospitality suppliers.** How trade pricing, case sizes and samples are presented locally. The wholesale page already does this well.

## Pages reviewed

| Page                      | Desktop                         | Mobile                           | Note                       |
| ------------------------- | ------------------------------- | -------------------------------- | -------------------------- |
| Home                      | Hero pins; buttons below fold   | Same                             | Findings 01, 03, 04, 09    |
| Shop                      | Cards crowded; set is a drawing | Card thumbnail tiny beside title | 02, 05, 07                 |
| Product (01, 02, 04, set) | Long; one photo                 | Sticky buy works                 | 08, 11                     |
| Recipes index             | Black tiles                     | Tile is half the screen          | 06                         |
| Recipe page               | Good two-column layout          | Fine                             | Best-written page          |
| Wholesale                 | Good                            | Table scrolls sideways correctly | Keep                       |
| Delivery, Terms           | Clear                           | Fine                             | Placeholder rates per TODO |
| 404                       | Lists the range, good           | Fine                             |                            |
| Add to cart, checkout     | No cart page; reload and jump   | Strip hidden by banner           | 02, 18                     |

Method: every page loaded from half-sour.vercel.app in Chromium at 1440×900 and 390×844, light and dark, with scroll positions captured through the hero; hover, focus, cursor, menu, anchor and reduced-motion states tested on the live site; add-to-cart, checkout and the two forms exercised on a local build of the same commit (the live shop's text matched it word for word). Code read alongside: the homepage, shop, product, recipe, wholesale and policy views, the token layer, the brand guide and the strategy content.
