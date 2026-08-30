-- =============================================================================
-- HALF SOUR — SEED
--
-- Four months of a real small business: the four-brine line that is live in
-- Shopify (Picklin Jews / sgu8sy-at.myshopify.com, NZD, Pacific/Auckland),
-- 95 orders across New Zealand, versioned production recipes, batches traced
-- through to the order lines that shipped from them, five AI staff with live
-- runs, and an approvals queue with real things waiting in it.
--
-- Conventions:
--   * money is integer cents; NZ retail prices are GST-inclusive at 15%, so
--     tax_cents is the GST component already inside total_cents
--   * timestamps are relative to now(), so the store looks current whenever the
--     seed is loaded
--   * commerce rows are the Shopify MIRROR (provider = 'shopify', real product
--     and collection gids, sync_status = 'synced'); rows Half Sour owns outright
--     — recipes, batches, agents, approvals, reviews — are provider-free or
--     provider = 'local'
--
-- Safe to re-run: the file truncates what it owns before writing.
-- =============================================================================

begin;

truncate table
  public.order_item_batches, public.batch_ingredients, public.batches,
  public.recipe_ingredients, public.recipes, public.ingredient_suppliers,
  public.ingredients, public.purchase_order_items, public.purchase_orders,
  public.suppliers,
  public.social_post_assets, public.social_posts, public.social_accounts,
  public.content_assets, public.email_sends, public.campaigns, public.reviews,
  public.inventory_adjustments, public.discount_redemptions,
  public.subscription_items, public.subscriptions,
  public.order_items, public.orders, public.cart_items, public.carts,
  public.discounts, public.inventory_levels, public.inventory_locations,
  public.collection_products, public.collections,
  public.product_images, public.product_variants, public.products,
  public.addresses, public.customers,
  public.agent_costs, public.agent_tool_calls, public.agent_messages,
  public.agent_runs, public.approvals, public.agents,
  public.brand_rules, public.brand_assets,
  public.webhook_events, public.sync_state,
  public.audit_log, public.admin_sessions, public.settings, public.operators
restart identity cascade;

-- =============================================================================
-- OPERATORS AND SESSIONS
-- =============================================================================
insert into public.operators (email, full_name, role, phone, timezone, last_seen_at) values
  ('nadia@halfsour.co.nz', 'Nadia Feldman', 'owner', '+64 21 447 118', 'Pacific/Auckland', now() - interval '11 minutes'),
  ('agents@halfsour.co.nz', 'Half Sour Agent Runtime', 'agent_service', null, 'Pacific/Auckland', now() - interval '2 minutes');

insert into public.admin_sessions
  (operator_id, session_token_hash, started_at, last_active_at, expires_at,
   ip_address, user_agent, device_label, revoked_at, revoked_reason)
select o.id, h.hash, now() - h.started, now() - h.active, now() + h.expires,
       h.ip::inet, h.ua, h.device,
       case when h.revoked is null then null else now() - h.revoked end, h.reason
  from public.operators o
  cross join (values
    ('sha256:8f4c2b1a9e7d3f60c5a8b2e1d4f70963c8a5b2e1d4f7096328f4c2b1a9e7d3f6',
     interval '3 hours', interval '11 minutes', interval '5 hours', '203.86.74.201',
     'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0 Safari/537.36',
     'MacBook Air — Grey Lynn', null::interval, null),
    ('sha256:1d4f70963c8a5b2e8f4c2b1a9e7d3f60c5a8b2e1d4f7096328f4c2b1a9e7d3f6',
     interval '9 days', interval '9 days' - interval '40 minutes', interval '-8 days', '121.99.230.14',
     'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
     'iPhone — market stall', interval '8 days 2 hours', 'signed out on a shared device at the Coastville market')
  ) as h(hash, started, active, expires, ip, ua, device, revoked, reason)
 where o.email = 'nadia@halfsour.co.nz';

-- =============================================================================
-- SETTINGS
-- =============================================================================
insert into public.settings (key, value, description, category, is_public, is_secret) values
  ('company.legal_name', '"Half Sour Brine Co Limited"', 'Registered company name on invoices and labels.', 'company', true, false),
  ('company.trading_name', '"Half Sour"', 'Name used everywhere customer-facing.', 'company', true, false),
  ('company.nzbn', '"9429052118743"', 'New Zealand Business Number.', 'company', true, false),
  ('company.gst_number', '"142-806-397"', 'IRD GST registration. Required on every tax invoice.', 'company', false, false),
  ('company.address', '{"line1":"Unit 4, 62 Sale Street","suburb":"Freemans Bay","city":"Auckland","postcode":"1010","country_code":"NZ"}', 'Registered address and production kitchen.', 'company', true, false),
  ('company.support_email', '"hello@halfsour.co.nz"', 'Public contact address.', 'company', true, false),
  ('tax.gst_rate_bp', '1500', 'NZ GST at 15%, in basis points. Displayed prices are GST-inclusive.', 'tax', true, false),
  ('shipping.free_threshold_cents', '8000', 'Orders at or above NZ$80.00 ship free within New Zealand.', 'shipping', true, false),
  ('shipping.standard_cents', '990', 'NZ Post standard urban rate charged below the free threshold.', 'shipping', true, false),
  ('shipping.rural_cents', '1490', 'Rural delivery rate.', 'shipping', true, false),
  ('commerce.provider', '"shopify"', 'Active commerce adapter. Set to "local" to run the mock provider with no Shopify credentials.', 'commerce', false, false),
  ('commerce.shop_domain', '"sgu8sy-at.myshopify.com"', 'Live Shopify store these commerce tables mirror.', 'commerce', false, false),
  ('commerce.currency', '"NZD"', 'Store currency. Every money column is cents of this.', 'commerce', true, false),
  ('commerce.shopify_admin_token_ref', '"vault:shopify_admin_api_token"', 'Vault key for the Shopify Admin API token. Never the token itself.', 'commerce', false, true),
  ('commerce.webhook_secret_ref', '"vault:shopify_webhook_hmac"', 'Vault key for the webhook HMAC secret used to verify every inbound event.', 'commerce', false, true),
  ('agents.default_daily_spend_cap_cents', '500', 'Per-agent daily inference budget before a run halts and asks.', 'agents', false, false),
  ('agents.approval_expiry_hours', '48', 'A pending approval nobody touches expires after this many hours.', 'agents', false, false),
  ('agents.autopublish_enabled', 'false', 'Master switch. While false, no agent may publish anything without a human decision.', 'agents', false, false),
  ('production.batch_code_prefix', '"HS"', 'Prefix on every batch code. Overprinted on the neck label.', 'production', false, false),
  ('production.default_shelf_life_days', '540', 'Eighteen months from bottling for the unopened dill and martini brines.', 'production', true, false);

update public.settings s set updated_by = o.id
  from public.operators o where o.email = 'nadia@halfsour.co.nz';

-- =============================================================================
-- BRAND
-- =============================================================================
insert into public.brand_assets
  (slug, name, kind, description, storage_path, public_url, mime_type, width_px, height_px,
   hex_value, font_family, font_weight, usage_notes, is_public, is_primary, tags)
values
  ('wordmark-primary', 'Half Sour wordmark', 'wordmark', 'The full wordmark. Never re-typed — always placed as the file.', 'brand/wordmark-primary.svg', 'https://cdn.halfsour.co.nz/brand/wordmark-primary.svg', 'image/svg+xml', 1600, 320, null, null, null, 'Minimum width 24mm in print, 120px on screen. Clear space equal to the height of the S.', true, true, '{logo,primary}'),
  ('mark-jar', 'Jar mark', 'logo', 'The standalone jar glyph for avatars, the favicon and the cap.', 'brand/mark-jar.svg', 'https://cdn.halfsour.co.nz/brand/mark-jar.svg', 'image/svg+xml', 512, 512, null, null, null, 'Use wherever the wordmark will not read below 24mm.', true, true, '{logo,icon}'),
  ('colour-brine', 'Brine', 'colour', 'The house green. Everything else defers to it.', null, null, null, null, null, '#7A8B3C', null, null, 'Primary. Backgrounds, headings, the No 01 cap.', true, true, '{colour,primary}'),
  ('colour-caper', 'Caper', 'colour', 'Deep bottle green for type on light grounds.', null, null, null, null, null, '#2F3A1E', null, null, 'Body copy on cream. Never on Brine — it fails contrast.', true, false, '{colour}'),
  ('colour-cream', 'Cream', 'colour', 'The label stock colour.', null, null, null, null, null, '#F4EFE2', null, null, 'Page and label background.', true, false, '{colour}'),
  ('colour-ember', 'Ember', 'colour', 'No 03 SMOKE accent only. Not a general highlight.', null, null, null, null, null, '#B4482A', null, null, 'The SMOKE cap and its shelf card. Nothing else.', true, false, '{colour,accent}'),
  ('colour-olive', 'Olive', 'colour', 'No 02 DIRTY accent.', null, null, null, null, null, '#96A14B', null, null, 'The DIRTY cap and its shelf card.', true, false, '{colour,accent}'),
  ('type-kolo', 'Kolo Display', 'typeface', 'Display face for the wordmark, the numerals and headlines.', null, null, null, null, null, null, 'Kolo Display', 700, 'Headlines 32px and up, and the No 01 / 02 / 03 numerals. Never for body copy.', true, true, '{typeface}'),
  ('type-untitled', 'Untitled Sans', 'typeface', 'Working face for body copy, the admin and the storefront.', null, null, null, null, null, null, 'Untitled Sans', 400, 'Body, UI, labels. 16px minimum on screen.', true, false, '{typeface}'),
  ('label-no-01', 'No 01 HOUSE label artwork', 'label', 'Print-ready 500ml wrap label, CMYK with 3mm bleed.', 'brand/labels/no-01-house-500-v3.pdf', null, 'application/pdf', null, null, null, null, null, 'v3 — current print file. Batch code is overprinted at bottling, never pre-printed.', false, true, '{label,print}'),
  ('shot-bar-pour', 'Bar pour hero', 'photo', 'A brine poured over ice at a bar pass. The default hero shot.', 'brand/photos/bar-pour-hero.jpg', 'https://cdn.halfsour.co.nz/brand/photos/bar-pour-hero.jpg', 'image/jpeg', 3000, 2000, null, null, null, 'Crop from the left. Do not crop the bottle out of frame.', true, true, '{photo,hero}'),
  ('shot-three-up', 'Three-up line shot', 'photo', 'No 01, No 02 and No 03 side by side on cream.', 'brand/photos/three-up.jpg', 'https://cdn.halfsour.co.nz/brand/photos/three-up.jpg', 'image/jpeg', 3000, 2000, null, null, null, 'Always in numeric order, left to right. Never reordered for composition.', true, false, '{photo,range}');

insert into public.brand_rules
  (slug, kind, severity, title, rule, rationale, good_example, bad_example, applies_to, keywords, priority, is_active)
values
  ('name-two-words', 'naming', 'must', 'Half Sour is two words',
   'Always write "Half Sour" — two words, both capitalised. Never HalfSour, half-sour, or HALF SOUR in body copy.',
   'The name is a pickling term. Squashing it turns a real word into a startup.',
   'Half Sour No 01 HOUSE', 'HalfSour house brine', '{storefront,social,email,packaging}',
   '{halfsour,"half-sour","HALF SOUR"}', 10, true),

  ('sku-numerals', 'naming', 'must', 'The range is numbered, not nicknamed',
   'Always "No 01 HOUSE", "No 02 DIRTY", "No 03 SMOKE" — numeral first, name in caps, no full stop after No. "The Full Set" is the only bundle name.',
   'The numerals are the shelf system. A bar manager orders by number down a noisy phone line.',
   'Two cases of No 02 DIRTY', 'Two cases of the dirty martini one', '{storefront,social,email,packaging,wholesale}',
   '{"no.01","no.02","no.03","number one brine","the dill one"}', 12, true),

  ('no-health-claims', 'compliance', 'never', 'No health, nutrition or medical claims',
   'Never suggest the product does anything to the body. No nutrition, recovery, wellness or medical language of any kind. Say what it tastes like and what it does in a glass or a pan.',
   'The NZ Food Standards Code restricts health and nutrition content claims to pre-approved ones. We hold none, and a single caption is enough to breach it.',
   'Sharp, salty, and it wakes up a whisky.', 'Drink it after a long session and feel better fast.',
   '{storefront,social,email,packaging,paid}',
   '{cramp,hangover,detox,electrolyte,electrolytes,probiotic,"gut health",hydration,hydrating,immune,wellness,cure,recovery,nutrition,"good for you"}', 1, true),

  ('nz-spelling', 'voice', 'must', 'New Zealand English',
   'Flavour, colour, litre, metre, organise. -ise not -ize. Prices are NZ$ and GST-inclusive. Volumes in millilitres.',
   'We are an Auckland company selling to New Zealanders. American spelling reads as drop-shipping.',
   'Full flavour, 500ml, NZ$18.00 including GST', 'Full flavor, 17 fl oz, $18 plus tax',
   '{storefront,social,email,packaging}', '{flavor,color,liter,organize,"fl oz"}', 20, true),

  ('voice-dry-not-zany', 'voice', 'must', 'Dry, not zany',
   'Understated and confident. One idea per sentence. No exclamation marks, no puns on the word pickle, no emoji stacks.',
   'The category is full of novelty brands. Restraint is the whole differentiator.',
   'The brine is the point. Everything else is garnish.', 'Get PICKLED!! Dill-icious!!',
   '{storefront,social,email}', '{"dill-icious","pickle me","big dill","kind of a big dill"}', 15, true),

  ('gst-inclusive', 'pricing', 'must', 'Every displayed price includes GST',
   'Retail prices shown to consumers are GST-inclusive. Trade pricing may be shown GST-exclusive but must be labelled "+ GST" on the same line.',
   'Fair Trading Act 1986: an advertised price a consumer cannot actually pay is misleading.',
   'NZ$18.00 (incl. GST)', 'NZ$15.65 + GST', '{storefront,email,social}',
   '{"plus gst","ex gst","excluding gst"}', 25, true),

  ('alcohol-adjacent', 'legal', 'never', 'We do not market alcohol',
   'Half Sour contains no alcohol. Never imply the product is alcoholic, never target under-18s, and never depict intoxication in creative.',
   'The Sale and Supply of Alcohol Act 2012 governs promotion of alcohol. A mixer brand that implies otherwise invites the whole regime.',
   'A Dirty Martini needs a brine. We make the good one.', 'Get wrecked on Half Sour this weekend.',
   '{social,paid,storefront}', '{"get drunk","get wrecked","blackout",smashed,"pre-load"}', 5, true),

  ('batch-code-visible', 'product', 'must', 'Every product shot shows a legible batch code',
   'Hero and packaging photography must show the neck-label batch code in focus. Do not retouch it out.',
   'Traceability is a selling point for trade buyers. Hiding the code makes us look like a re-labeller.',
   'The batch code legible on the neck of the bottle', 'Neck label blurred or cloned out',
   '{social,storefront,packaging}', '{}', 40, true),

  ('trade-tone', 'channel', 'should', 'Trade copy leads with logistics',
   'For bars and grocers, lead with case size, shelf life, lead time and pour cost. Flavour language comes second.',
   'A bar manager buys on margin and reliability. The romance is for the shelf.',
   'Twelve by 500ml, 18-month shelf life, 48-hour Auckland delivery, about 30 martinis a bottle.',
   'A brine that sings of a Freemans Bay summer.', '{email,wholesale}', '{}', 60, true),

  ('photo-no-stock', 'visual', 'must', 'No stock photography',
   'Every image is our own product, our own kitchen, or a bar we actually supply. No licensed stock, no generated food imagery.',
   'Trade buyers recognise stock imagery instantly and read it as a brand with nothing to show.',
   'The bar-pour hero shot at Brass and Bitters', 'A smiling model holding a generic jar',
   '{social,storefront,email,paid}', '{}', 35, true),

  ('reply-within-day', 'channel', 'should', 'Reviews get a reply within one working day',
   'Reply to every review, good or bad, within one working day. If the review mentions a fault, name the batch.',
   'Traceability is only credible if we use it in public.',
   'That was batch HS-03-260712-B. We have pulled the rest of it and a replacement is on its way.',
   'Sorry to hear that! DM us.', '{storefront,social}', '{}', 70, true);

-- =============================================================================
-- AGENTS — the staff
-- =============================================================================
insert into public.agents
  (slug, name, job_title, purpose, model, tools, status, autonomy, requires_approval_for,
   daily_spend_cap_cents, monthly_spend_cap_cents, single_action_cap_cents, schedule_cron,
   colour_hex, last_run_at, runs_count)
values
  ('brine-ops', 'Marlow', 'Head of Brine Ops',
   'Watches stock against the reorder points, plans the production calendar off forward demand, drafts purchase orders, and flags batches coming up on their best-before.',
   'claude-sonnet-4-5',
   '{inventory.read,inventory.adjust,batches.read,batches.plan,suppliers.read,purchase_orders.draft,approvals.create}',
   'active', 'act_with_limits', '{purchase_order,inventory_adjustment,batch_release}', 800, 16000, 25000,
   '0 19 * * *', '#7A8B3C', now() - interval '4 hours', 214),

  ('social', 'Vinnie', 'Social and Content Lead',
   'Drafts the fortnightly content calendar against the brand rules, writes captions, schedules posts, and reports back on what actually landed.',
   'claude-sonnet-4-5',
   '{brand_rules.read,content_assets.read,social.draft,social.schedule,social.metrics,approvals.create}',
   'active', 'propose', '{social_post,content_asset,email_campaign}', 600, 12000, null,
   '0 20 * * 1,4', '#B4482A', now() - interval '19 hours', 96),

  ('concierge', 'Dot', 'Customer Concierge',
   'Handles order questions, drafts review replies, chases delivery exceptions, and escalates anything that smells like a product fault.',
   'claude-sonnet-4-5',
   '{orders.read,customers.read,reviews.read,reviews.reply_draft,email.draft,batches.trace,approvals.create}',
   'active', 'propose', '{review_reply,customer_message,refund}', 500, 10000, 15000,
   '0 */4 * * *', '#2F3A1E', now() - interval '52 minutes', 431),

  ('ledger', 'Teller', 'Finance and Pricing',
   'Recalculates unit cost from the last three batches, watches margin by SKU, models price moves, and reconciles Shopify payouts against the bank.',
   'claude-opus-4-1',
   '{orders.read,batches.read,products.read,pricing.model,reports.write,approvals.create}',
   'active', 'propose', '{price_change,discount,settings_change}', 900, 18000, null,
   '0 8 * * 1', '#96A14B', now() - interval '2 days 3 hours', 41),

  ('scout', 'Bex', 'Wholesale Outreach',
   'Builds the trade prospect list from bar and bottle-shop data, writes the first approach, and keeps the follow-up cadence honest.',
   'claude-sonnet-4-5',
   '{customers.read,crm.read,email.draft,campaigns.read,approvals.create}',
   'active', 'propose', '{email_outreach,customer_message}', 700, 14000, null,
   '30 9 * * 2', '#B4482A', now() - interval '5 days', 63),

  ('mirror', 'Mirror', 'Storefront Sync',
   'Keeps the local mirror honest against Shopify: drains the webhook queue, reconciles drift nightly, and reports anything the mirror and the store disagree about.',
   'claude-haiku-4-5',
   '{shopify.read,webhooks.drain,sync.reconcile,inventory.write}',
   'active', 'act_with_limits', '{}', 400, 8000, null,
   '*/15 * * * *', '#2F3A1E', now() - interval '6 minutes', 4812);

update public.agents a set operator_id = o.id
  from public.operators o where o.email = 'agents@halfsour.co.nz';

-- =============================================================================
-- CATALOGUE — the live Shopify products, mirrored
-- =============================================================================
insert into public.inventory_locations
  (code, name, kind, address_line, suburb, city, region, postcode, is_default, ships_orders,
   provider, shopify_gid, sync_status, synced_at)
values
  ('SALE_ST', 'Sale Street Kitchen', 'kitchen', 'Unit 4, 62 Sale Street', 'Freemans Bay', 'Auckland', 'Auckland', '1010', true, true, 'shopify', 'gid://shopify/Location/78234501234', 'synced', now() - interval '14 minutes'),
  ('COOLSTORE', 'Penrose Coolstore', 'coolstore', '19 Gabador Place', 'Mount Wellington', 'Auckland', 'Auckland', '1060', false, true, 'shopify', 'gid://shopify/Location/78234501235', 'synced', now() - interval '14 minutes'),
  ('MARKET', 'Coastville Market Stall', 'market_stall', 'Coastville Primary School grounds', 'Grey Lynn', 'Auckland', 'Auckland', '1021', false, false, 'local', null, 'local', null);

insert into public.products
  (handle, title, subtitle, description, product_type, status, published_at, tags,
   seo_title, seo_description, hero_image_url, position,
   provider, shopify_gid, shopify_updated_at, sync_status, synced_at)
values
  ('no-01-house', 'No 01 HOUSE', 'Dill and peppercorn brine.',
   'The one everything else is built from. Telegraph cucumbers from Pukekohe sit for twelve days in a 4.6% brine with whole dill heads, cracked black peppercorn, garlic and bay. We pull the cucumbers out and bottle what is left, which is the part most kitchens tip down the sink. Sharp, grassy, and long on the finish. Drink it cold, shoot it after a whiskey, or use it anywhere a recipe asks for vinegar and means it. 500ml.',
   'Brine', 'active', now() - interval '5 months', '{house,dill,peppercorn,vegan,gluten-free}',
   'No 01 HOUSE — dill and peppercorn brine | Half Sour',
   'The Half Sour house brine. Twelve days on cucumbers, dill and peppercorn. Made in Auckland, 500ml.',
   'https://cdn.shopify.com/s/files/1/0912/3456/7890/files/no-01-house-hero.jpg', 10,
   'shopify', 'gid://shopify/Product/9389911965946', now() - interval '6 days', 'synced', now() - interval '14 minutes'),

  ('no-02-dirty', 'No 02 DIRTY', 'Martini brine. Cornichon, green olive, lemon peel.',
   'Built for one job. Cornichons and Spanish manzanilla olives brined together with wide strips of lemon peel and white peppercorn, then rested a fortnight so the olive stops shouting. About thirty martinis to a bottle, and it will not turn the glass cloudy. Also very good in a dressing, and better than it has any right to be over ice with soda. 500ml.',
   'Brine', 'active', now() - interval '4 months', '{dirty,martini,olive,bar,vegan,gluten-free}',
   'No 02 DIRTY — martini brine | Half Sour',
   'Cornichon, green olive and lemon peel brine for a Dirty Martini. About thirty martinis a bottle. 500ml.',
   'https://cdn.shopify.com/s/files/1/0912/3456/7890/files/no-02-dirty-hero.jpg', 20,
   'shopify', 'gid://shopify/Product/9389912228090', now() - interval '6 days', 'synced', now() - interval '14 minutes'),

  ('no-03-smoke', 'No 03 SMOKE', 'Smoked chilli brine. Chipotle, manzano, manuka.',
   'Chipotle and fresh manzano chilli go in at day four, and the salt is cold-smoked over manuka before it ever touches water. The heat arrives about three seconds late and then sits there. This is the Bloody Mary bottle, and the one to keep beside the barbecue. Shorter shelf life than the other two because there is nothing in it to make it last. 500ml.',
   'Brine', 'active', now() - interval '3 months', '{smoke,chilli,chipotle,manuka,vegan,gluten-free}',
   'No 03 SMOKE — smoked chilli brine | Half Sour',
   'Chipotle, manzano and manuka-smoked salt. The Bloody Mary bottle. Made in Auckland, 500ml.',
   'https://cdn.shopify.com/s/files/1/0912/3456/7890/files/no-03-smoke-hero.jpg', 30,
   'shopify', 'gid://shopify/Product/9389912490234', now() - interval '2 days', 'synced', now() - interval '14 minutes'),

  -- No 04 WILD. Product, variant and inventory-item gids below are the REAL
  -- ones off sgu8sy-at.myshopify.com (read 29 Aug 2026), not invented.
  --
  -- The live Shopify description carries a fourth paragraph naming a Tairawhiti
  -- kawakawa grower. That relationship does not exist yet, which makes it a
  -- place-of-origin claim under Fair Trading Act s 13(j) — TODO.md tracks it.
  -- It is deliberately NOT reproduced here: the constraint on how much can be
  -- made is a fact and is stated; who grows the leaf is not, and is not.
  ('no-04-wild', 'No 04 WILD', 'Coastal brine. Kawakawa, kelp, lemon peel.',
   'Kawakawa, kelp and lemon peel. Peppery off the leaf, maritime underneath, and the least like anything else on the shelf. Built for seafood: a capful over oysters, the acid in a ceviche, a martini that tastes like the coast rather than the bar. It sits with a gin that has real botanicals in it instead of fighting one. Made in small runs — the leaf is what limits it, not the demand. 500ml.',
   'Brine', 'active', now() - interval '6 weeks', '{wild,kawakawa,kelp,seafood,limited,mixer,native}',
   'No 04 WILD — kawakawa and kelp brine | Half Sour',
   'Kawakawa, kelp and lemon peel brine, built for seafood. Limited by leaf supply. Made in Auckland, 500ml.',
   null, 35,
   'shopify', 'gid://shopify/Product/9389915963642', now() - interval '2 days', 'synced', now() - interval '14 minutes'),

  ('the-full-set', 'The Full Set', 'All three, boxed.',
   'No 01, No 02 and No 03 in a rigid box with three cards: a Dirty Martini, a Bloody Mary and the pickleback. It is what we send when we do not know what someone drinks, and it is most of our December. 3 x 500ml.',
   'Gift', 'active', now() - interval '5 months', '{gift,bundle,set,vegan,gluten-free}',
   'The Full Set — all three brines | Half Sour',
   'No 01 HOUSE, No 02 DIRTY and No 03 SMOKE boxed with recipe cards. 3 x 500ml.',
   'https://cdn.shopify.com/s/files/1/0912/3456/7890/files/the-full-set-hero.jpg', 40,
   'shopify', 'gid://shopify/Product/9389912654074', now() - interval '9 days', 'synced', now() - interval '14 minutes');

insert into public.product_variants
  (product_id, sku, barcode, title, size_ml, pack_count, price_cents, unit_cost_cents,
   weight_grams, shelf_life_days, position,
   provider, shopify_gid, shopify_inventory_item_gid, shopify_updated_at, sync_status, synced_at)
select p.id, v.sku, v.barcode, v.title, v.size_ml, v.pack, v.price, v.cost, v.weight, v.shelf, 10,
       'shopify', v.gid, v.inv_gid, now() - interval '6 days', 'synced', now() - interval '14 minutes'
  from (values
    ('no-01-house',  'HS-01-500', '9421903880014', '500ml',       500, 1, 1800,  620,  860, 540, 'gid://shopify/ProductVariant/48231847592314', 'gid://shopify/InventoryItem/50412938471625'),
    ('no-02-dirty',  'HS-02-500', '9421903880021', '500ml',       500, 1, 2000,  780,  860, 540, 'gid://shopify/ProductVariant/48231847625082', 'gid://shopify/InventoryItem/50412938504393'),
    ('no-03-smoke',  'HS-03-500', '9421903880038', '500ml',       500, 1, 2200,  890,  860, 180, 'gid://shopify/ProductVariant/48231847657850', 'gid://shopify/InventoryItem/50412938537161'),
    -- HS-04-500 has no GTIN allocated and the live variant carries no barcode,
    -- so this one is null rather than the next number in the block.
    -- 1015c unit cost is the No 04 line off the strategy document's own cost
    -- breakdown (520 + 185 + 60 + 250), not a fresh guess.
    ('no-04-wild',   'HS-04-500', null,            '500ml',       500, 1, 2600, 1015,  860, 365, 'gid://shopify/ProductVariant/50186882384122', 'gid://shopify/InventoryItem/52028729295098'),
    ('the-full-set', 'HS-SET-3',  '9421903880045', '3 x 500ml',   500, 3, 5400, 2180, 2790, 180, 'gid://shopify/ProductVariant/48231847690618', 'gid://shopify/InventoryItem/50412938569929')
  ) as v(handle, sku, barcode, title, size_ml, pack, price, cost, weight, shelf, gid, inv_gid)
  join public.products p on p.handle = v.handle;

-- No 04 WILD has NO rows here and a null hero_image_url, because the live
-- Shopify product has no media attached (checked 29 Aug 2026). A mirror that
-- invented a CDN URL would be a mirror of nothing.
insert into public.product_images
  (product_id, url, alt_text, position, width_px, height_px, provider, shopify_gid, sync_status, synced_at)
select p.id, i.url, i.alt, i.pos, 2400, 3000, 'shopify', i.gid, 'synced', now() - interval '14 minutes'
  from (values
    ('no-01-house',  'https://cdn.shopify.com/s/files/1/0912/3456/7890/files/no-01-house-front.jpg',  'A 500ml bottle of Half Sour No 01 HOUSE on a cream ground, batch code legible on the neck label', 10, 'gid://shopify/MediaImage/34123456789012'),
    ('no-01-house',  'https://cdn.shopify.com/s/files/1/0912/3456/7890/files/no-01-house-pour.jpg',   'No 01 HOUSE poured over ice at a bar pass', 20, 'gid://shopify/MediaImage/34123456789013'),
    ('no-02-dirty',  'https://cdn.shopify.com/s/files/1/0912/3456/7890/files/no-02-dirty-front.jpg',  'A 500ml bottle of Half Sour No 02 DIRTY beside a coupe and three olives on a pick', 10, 'gid://shopify/MediaImage/34123456789014'),
    ('no-02-dirty',  'https://cdn.shopify.com/s/files/1/0912/3456/7890/files/no-02-dirty-martini.jpg','A Dirty Martini being built at Brass and Bitters, the No 02 bottle in frame', 20, 'gid://shopify/MediaImage/34123456789015'),
    ('no-03-smoke',  'https://cdn.shopify.com/s/files/1/0912/3456/7890/files/no-03-smoke-front.jpg',  'A 500ml bottle of Half Sour No 03 SMOKE with an ember-red cap', 10, 'gid://shopify/MediaImage/34123456789016'),
    ('the-full-set', 'https://cdn.shopify.com/s/files/1/0912/3456/7890/files/the-full-set-open.jpg',  'The Full Set gift box open, showing all three 500ml bottles and the recipe cards', 10, 'gid://shopify/MediaImage/34123456789017'),
    ('the-full-set', 'https://cdn.shopify.com/s/files/1/0912/3456/7890/files/three-up.jpg',           'No 01, No 02 and No 03 side by side on cream, in numeric order', 20, 'gid://shopify/MediaImage/34123456789018')
  ) as i(handle, url, alt, pos, gid)
  join public.products p on p.handle = i.handle;

insert into public.collections
  (handle, title, description, is_published, published_at, position, is_smart, rules,
   provider, shopify_gid, sync_status, synced_at)
values
  ('the-brines', 'The Brines', 'No 01 HOUSE, No 02 DIRTY, No 03 SMOKE and No 04 WILD. Everything we make, in order.',
   true, now() - interval '5 months', 10, false, null,
   'shopify', 'gid://shopify/Collection/475327070458', 'synced', now() - interval '14 minutes'),
  ('gifts', 'Gifts', 'The Full Set, boxed with recipe cards and posted anywhere in New Zealand.',
   true, now() - interval '5 months', 20, false, null,
   'local', null, 'local', null),
  ('summer-2027', 'Summer 2027', 'Holding collection for the December range. Not published.',
   false, null, 30, false, null, 'local', null, 'local', null);

insert into public.collection_products (collection_id, product_id, position)
select c.id, p.id, cp.pos
  from (values
    ('the-brines', 'no-01-house', 10),
    ('the-brines', 'no-02-dirty', 20),
    ('the-brines', 'no-03-smoke', 30),
    ('the-brines', 'no-04-wild', 35),
    ('gifts', 'the-full-set', 10)
  ) as cp(coll, handle, pos)
  join public.collections c on c.handle = cp.coll
  join public.products p on p.handle = cp.handle;

-- =============================================================================
-- DISCOUNTS
-- =============================================================================
insert into public.discounts
  (code, title, description, value_type, value_bp, value_cents, applies_to, target_product_id,
   minimum_subtotal_cents, customer_type_restriction, usage_limit, usage_limit_per_customer,
   used_count, starts_at, ends_at, status, provider, shopify_gid, sync_status, synced_at)
values
  ('TRADE10', 'Trade standing discount', '10% off for approved bar and restaurant accounts on orders of NZ$200 or more.',
   'percentage', 1000, null, 'order', null, 20000, 'trade', null, null, 0,
   now() - interval '4 months', null, 'active', 'shopify', 'gid://shopify/DiscountCodeNode/91234500001', 'synced', now() - interval '14 minutes'),
  ('WHOLESALE20', 'Distributor rate', '20% off for distributor accounts on orders of NZ$400 or more. Net 30 terms.',
   'percentage', 2000, null, 'order', null, 40000, 'wholesale', null, null, 0,
   now() - interval '4 months', null, 'active', 'shopify', 'gid://shopify/DiscountCodeNode/91234500002', 'synced', now() - interval '14 minutes'),
  ('BRINETIME', 'Newsletter welcome', 'NZ$5.00 off a first order of NZ$30 or more.',
   'fixed_amount', null, 500, 'order', null, 3000, null, 500, 1, 0,
   now() - interval '4 months', null, 'active', 'shopify', 'gid://shopify/DiscountCodeNode/91234500003', 'synced', now() - interval '14 minutes'),
  ('SETFREIGHT', 'Free freight on The Full Set', 'Free shipping on any order containing The Full Set. Starts with the December push.',
   'free_shipping', null, null, 'shipping', null, 5000, null, null, null, 0,
   now() + interval '3 weeks', now() + interval '3 months', 'scheduled', 'shopify', 'gid://shopify/DiscountCodeNode/91234500004', 'synced', now() - interval '14 minutes'),
  ('SMOKE25', 'No 03 launch promotion', '25% off No 03 SMOKE for the launch fortnight.',
   'percentage', 2500, null, 'product', (select id from public.products where handle = 'no-03-smoke'),
   null, null, null, 2, 0,
   now() - interval '3 months', now() - interval '11 weeks', 'expired', 'shopify', 'gid://shopify/DiscountCodeNode/91234500005', 'synced', now() - interval '14 minutes');
-- =============================================================================
-- CUSTOMERS  (lifetime figures are recomputed from the order book further down —
-- nothing here is a typed-in total that can drift)
-- =============================================================================
insert into public.customers
  (email, first_name, last_name, phone, customer_type, company_name, nzbn, gst_number,
   accepts_marketing, marketing_opt_in_at, tags, note,
   provider, shopify_gid, shopify_updated_at, sync_status, synced_at)
values
  ('aroha.wetere@gmail.com', 'Aroha', 'Wetere', '+64 21 903 442', 'retail', null, null, null, true, now() - interval '130 days', '{auckland,repeat}', null, 'shopify', 'gid://shopify/Customer/71234510000', now() - interval '3 days', 'synced', now() - interval '14 minutes'),
  ('sam.kerrison@outlook.co.nz', 'Sam', 'Kerrison', '+64 27 118 664', 'retail', null, null, null, true, now() - interval '128 days', '{wellington,repeat}', null, 'shopify', 'gid://shopify/Customer/71234510001', now() - interval '4 days', 'synced', now() - interval '14 minutes'),
  ('priya.nair@fastmail.com', 'Priya', 'Nair', '+64 21 550 771', 'retail', null, null, null, true, now() - interval '126 days', '{christchurch,repeat}', null, 'shopify', 'gid://shopify/Customer/71234510002', now() - interval '5 days', 'synced', now() - interval '14 minutes'),
  ('tom.whitiora@gmail.com', 'Tom', 'Whitiora', '+64 22 447 001', 'retail', null, null, null, true, now() - interval '124 days', '{tauranga,repeat}', null, 'shopify', 'gid://shopify/Customer/71234510003', now() - interval '6 days', 'synced', now() - interval '14 minutes'),
  ('hana.f@protonmail.com', 'Hana', 'Fujimoto', '+64 27 883 215', 'retail', null, null, null, true, now() - interval '122 days', '{dunedin,repeat}', null, 'shopify', 'gid://shopify/Customer/71234510004', now() - interval '7 days', 'synced', now() - interval '14 minutes'),
  ('elise@marchetti.nz', 'Elise', 'Marchetti', '+64 21 660 908', 'retail', null, null, null, true, now() - interval '120 days', '{napier}', null, 'shopify', 'gid://shopify/Customer/71234510005', now() - interval '8 days', 'synced', now() - interval '14 minutes'),
  ('nikau.rangi@xtra.co.nz', 'Nikau', 'Rangi', '+64 21 447 209', 'retail', null, null, null, true, now() - interval '118 days', '{auckland}', null, 'shopify', 'gid://shopify/Customer/71234510006', now() - interval '9 days', 'synced', now() - interval '14 minutes'),
  ('grace.ihaka@gmail.com', 'Grace', 'Ihaka', '+64 27 302 118', 'retail', null, null, null, true, now() - interval '116 days', '{auckland}', null, 'shopify', 'gid://shopify/Customer/71234510007', now() - interval '10 days', 'synced', now() - interval '14 minutes'),
  ('c.speight@me.com', 'Callum', 'Speight', '+64 22 918 330', 'retail', null, null, null, true, now() - interval '114 days', '{christchurch}', null, 'shopify', 'gid://shopify/Customer/71234510008', now() - interval '11 days', 'synced', now() - interval '14 minutes'),
  ('mereana.tuari@gmail.com', 'Mereana', 'Tuari', '+64 21 774 662', 'retail', null, null, null, true, now() - interval '112 days', '{hamilton}', null, 'shopify', 'gid://shopify/Customer/71234510009', now() - interval '12 days', 'synced', now() - interval '14 minutes'),
  ('josh.verhoeven@outlook.co.nz', 'Josh', 'Verhoeven', '+64 27 664 018', 'retail', null, null, null, true, now() - interval '110 days', '{wellington}', null, 'shopify', 'gid://shopify/Customer/71234510010', now() - interval '13 days', 'synced', now() - interval '14 minutes'),
  ('anika.sharma@fastmail.com', 'Anika', 'Sharma', '+64 21 118 447', 'retail', null, null, null, true, now() - interval '108 days', '{auckland}', null, 'shopify', 'gid://shopify/Customer/71234510011', now() - interval '14 days', 'synced', now() - interval '14 minutes'),
  ('bencorrigan@gmail.com', 'Ben', 'Corrigan', '+64 27 441 992', 'retail', null, null, null, true, now() - interval '106 days', '{christchurch}', null, 'shopify', 'gid://shopify/Customer/71234510012', now() - interval '15 days', 'synced', now() - interval '14 minutes'),
  ('talia.fonoti@xtra.co.nz', 'Talia', 'Fonoti', '+64 22 330 774', 'retail', null, null, null, true, now() - interval '104 days', '{auckland}', null, 'shopify', 'gid://shopify/Customer/71234510013', now() - interval '16 days', 'synced', now() - interval '14 minutes'),
  ('rhys.ellingham@gmail.com', 'Rhys', 'Ellingham', '+64 21 992 006', 'retail', null, null, null, true, now() - interval '102 days', '{dunedin}', null, 'shopify', 'gid://shopify/Customer/71234510014', now() - interval '17 days', 'synced', now() - interval '14 minutes'),
  ('marama.kingi@gmail.com', 'Marama', 'Kingi', '+64 27 118 003', 'retail', null, null, null, true, now() - interval '100 days', '{napier}', null, 'shopify', 'gid://shopify/Customer/71234510015', now() - interval '18 days', 'synced', now() - interval '14 minutes'),
  ('o.bassett@me.com', 'Oliver', 'Bassett', '+64 21 447 771', 'retail', null, null, null, false, null, '{auckland}', null, 'shopify', 'gid://shopify/Customer/71234510016', now() - interval '19 days', 'synced', now() - interval '14 minutes'),
  ('lucy.pang@gmail.com', 'Lucy', 'Pang', '+64 27 006 118', 'retail', null, null, null, false, null, '{hamilton}', null, 'shopify', 'gid://shopify/Customer/71234510017', now() - interval '20 days', 'synced', now() - interval '14 minutes'),
  ('d.ahkuoi@outlook.co.nz', 'Daniel', 'Ah Kuoi', '+64 22 771 440', 'retail', null, null, null, true, now() - interval '94 days', '{tauranga}', null, 'shopify', 'gid://shopify/Customer/71234510018', now() - interval '21 days', 'synced', now() - interval '14 minutes'),
  ('freya.lindqvist@gmail.com', 'Freya', 'Lindqvist', '+64 21 330 992', 'retail', null, null, null, false, null, '{wellington}', null, 'shopify', 'gid://shopify/Customer/71234510019', now() - interval '22 days', 'synced', now() - interval '14 minutes'),
  ('manu.paikea@xtra.co.nz', 'Manu', 'Paikea', '+64 27 447 118', 'retail', null, null, null, false, null, '{dunedin}', null, 'shopify', 'gid://shopify/Customer/71234510020', now() - interval '23 days', 'synced', now() - interval '14 minutes'),
  ('sophie.tremain@fastmail.com', 'Sophie', 'Tremain', '+64 21 664 003', 'retail', null, null, null, true, now() - interval '88 days', '{queenstown-lakes}', null, 'shopify', 'gid://shopify/Customer/71234510021', now() - interval '24 days', 'synced', now() - interval '14 minutes'),
  ('arun.pillai@gmail.com', 'Arun', 'Pillai', '+64 22 118 774', 'retail', null, null, null, false, null, '{auckland}', null, 'shopify', 'gid://shopify/Customer/71234510022', now() - interval '25 days', 'synced', now() - interval '14 minutes'),
  ('kate.fenwick@me.com', 'Kate', 'Fenwick', '+64 21 774 118', 'retail', null, null, null, false, null, '{auckland}', null, 'shopify', 'gid://shopify/Customer/71234510023', now() - interval '26 days', 'synced', now() - interval '14 minutes'),
  ('louis.bourke@gmail.com', 'Louis', 'Bourke', '+64 27 992 447', 'retail', null, null, null, true, now() - interval '82 days', '{wellington}', null, 'shopify', 'gid://shopify/Customer/71234510024', now() - interval '27 days', 'synced', now() - interval '14 minutes'),
  ('ngaire.waaka@gmail.com', 'Ngaire', 'Waaka', '+64 21 006 771', 'retail', null, null, null, false, null, '{palmerston-north}', null, 'shopify', 'gid://shopify/Customer/71234510025', now() - interval '28 days', 'synced', now() - interval '14 minutes'),
  ('h.osgood@outlook.co.nz', 'Harry', 'Osgood', '+64 22 447 330', 'retail', null, null, null, false, null, '{queenstown}', null, 'shopify', 'gid://shopify/Customer/71234510026', now() - interval '29 days', 'synced', now() - interval '14 minutes'),
  ('ivy.sanderson@gmail.com', 'Ivy', 'Sanderson', '+64 21 118 992', 'retail', null, null, null, true, now() - interval '76 days', '{tauranga}', null, 'shopify', 'gid://shopify/Customer/71234510027', now() - interval '30 days', 'synced', now() - interval '14 minutes'),
  ('reuben.matiu@xtra.co.nz', 'Reuben', 'Matiu', '+64 27 330 006', 'retail', null, null, null, false, null, '{hamilton}', null, 'shopify', 'gid://shopify/Customer/71234510028', now() - interval '31 days', 'synced', now() - interval '14 minutes'),
  ('astrid.halvorsen@fastmail.com', 'Astrid', 'Halvorsen', '+64 21 447 664', 'retail', null, null, null, false, null, '{christchurch}', null, 'shopify', 'gid://shopify/Customer/71234510029', now() - interval '32 days', 'synced', now() - interval '14 minutes'),
  ('cam.doull@gmail.com', 'Cameron', 'Doull', '+64 27 774 118', 'retail', null, null, null, true, now() - interval '70 days', '{wellington}', null, 'shopify', 'gid://shopify/Customer/71234510030', now() - interval '33 days', 'synced', now() - interval '14 minutes'),
  ('tui.ngawhika@gmail.com', 'Tui', 'Ngawhika', '+64 21 992 330', 'retail', null, null, null, false, null, '{auckland}', null, 'shopify', 'gid://shopify/Customer/71234510031', now() - interval '34 days', 'synced', now() - interval '14 minutes'),
  ('felix.rowntree@me.com', 'Felix', 'Rowntree', '+64 22 006 447', 'retail', null, null, null, false, null, '{dunedin}', null, 'shopify', 'gid://shopify/Customer/71234510032', now() - interval '35 days', 'synced', now() - interval '14 minutes'),
  ('jasmine.okeroa@gmail.com', 'Jasmine', 'Okeroa', '+64 21 664 771', 'retail', null, null, null, true, now() - interval '64 days', '{wellington}', null, 'shopify', 'gid://shopify/Customer/71234510033', now() - interval '36 days', 'synced', now() - interval '14 minutes'),
  ('milo.hastings@outlook.co.nz', 'Milo', 'Hastings', '+64 27 118 447', 'retail', null, null, null, false, null, '{auckland}', null, 'shopify', 'gid://shopify/Customer/71234510034', now() - interval '37 days', 'synced', now() - interval '14 minutes'),
  ('erin.blackwood@gmail.com', 'Erin', 'Blackwood', '+64 21 330 118', 'retail', null, null, null, false, null, '{tauranga}', null, 'shopify', 'gid://shopify/Customer/71234510035', now() - interval '38 days', 'synced', now() - interval '14 minutes'),
  ('wiremu.tahana@xtra.co.nz', 'Wiremu', 'Tahana', '+64 22 992 664', 'retail', null, null, null, true, now() - interval '58 days', '{hamilton}', null, 'shopify', 'gid://shopify/Customer/71234510036', now() - interval '39 days', 'synced', now() - interval '14 minutes'),
  ('bianca.leota@gmail.com', 'Bianca', 'Leota', '+64 21 774 006', 'retail', null, null, null, false, null, '{auckland}', null, 'shopify', 'gid://shopify/Customer/71234510037', now() - interval '40 days', 'synced', now() - interval '14 minutes'),
  ('struan.macrae@fastmail.com', 'Struan', 'MacRae', '+64 27 447 992', 'retail', null, null, null, false, null, '{queenstown}', null, 'shopify', 'gid://shopify/Customer/71234510038', now() - interval '41 days', 'synced', now() - interval '14 minutes'),
  ('yuki.nakagawa@gmail.com', 'Yuki', 'Nakagawa', '+64 21 118 330', 'retail', null, null, null, true, now() - interval '52 days', '{napier}', null, 'shopify', 'gid://shopify/Customer/71234510039', now() - interval '42 days', 'synced', now() - interval '14 minutes'),
  ('pippa.thorndon@me.com', 'Pippa', 'Thorndon', '+64 27 006 774', 'retail', null, null, null, false, null, '{wellington}', null, 'shopify', 'gid://shopify/Customer/71234510040', now() - interval '3 days', 'synced', now() - interval '14 minutes'),
  ('kofi.mensah@gmail.com', 'Kofi', 'Mensah', '+64 22 664 118', 'retail', null, null, null, false, null, '{auckland}', null, 'shopify', 'gid://shopify/Customer/71234510041', now() - interval '4 days', 'synced', now() - interval '14 minutes'),
  ('jesse.lam@gmail.com', 'Jesse', 'Lam', '+64 21 447 003', 'retail', null, null, null, true, now() - interval '46 days', '{newsletter}', 'Signed up at the Coastville market. No order yet.', 'shopify', 'gid://shopify/Customer/71234510042', now() - interval '5 days', 'synced', now() - interval '14 minutes'),
  ('nadine.oputa@gmail.com', 'Nadine', 'Oputa', null, 'retail', null, null, null, true, now() - interval '44 days', '{newsletter}', 'Signed up at the Coastville market. No order yet.', 'shopify', 'gid://shopify/Customer/71234510043', now() - interval '6 days', 'synced', now() - interval '14 minutes'),
  ('orders@brassandbitters.co.nz', 'Kiri', 'Ngatai', '+64 9 302 7741', 'trade', 'Brass and Bitters Limited', '9429041827365', '128-449-006', true, now() - interval '42 days', '{auckland,trade}', 'Standing trade account. Orders on the first Tuesday.', 'shopify', 'gid://shopify/Customer/71234510044', now() - interval '7 days', 'synced', now() - interval '14 minutes'),
  ('bar@thesaltroom.co.nz', 'Dev', 'Ramanathan', '+64 4 385 1120', 'trade', 'Salt Room Hospitality Limited', '9429046612840', '104-772-318', true, now() - interval '40 days', '{wellington,trade}', 'Standing trade account. Orders on the first Tuesday.', 'shopify', 'gid://shopify/Customer/71234510045', now() - interval '8 days', 'synced', now() - interval '14 minutes'),
  ('hello@nightjarqt.nz', 'Flynn', 'Mackereth', '+64 3 442 8890', 'trade', 'Nightjar Bar Limited', '9429048830175', '117-205-664', true, now() - interval '38 days', '{queenstown,trade}', 'Standing trade account. Orders on the first Tuesday.', 'shopify', 'gid://shopify/Customer/71234510046', now() - interval '9 days', 'synced', now() - interval '14 minutes'),
  ('accounts@moxieprovisions.co.nz', 'Wiremu', 'Paterson', '+64 9 579 4402', 'wholesale', 'Moxie Provisions Limited', '9429039914628', '099-663-114', true, now() - interval '36 days', '{auckland,trade}', 'Distributes to grocers across Auckland and Waikato. Net 30.', 'shopify', 'gid://shopify/Customer/71234510047', now() - interval '10 days', 'synced', now() - interval '14 minutes'),
  ('kitchen@hallidayandsons.co.nz', 'Sina', 'Leaupepe', '+64 3 366 2214', 'trade', 'Halliday and Sons Limited', '9429044012287', '131-880-247', true, now() - interval '34 days', '{christchurch,trade}', 'Standing trade account. Orders on the first Tuesday.', 'shopify', 'gid://shopify/Customer/71234510048', now() - interval '11 days', 'synced', now() - interval '14 minutes'),
  ('buying@thegreengrocerdn.co.nz', 'Ari', 'Bercovitch', '+64 3 477 9016', 'trade', 'Green Grocer Dunedin Limited', '9429047710553', '142-006-991', true, now() - interval '32 days', '{dunedin,trade}', 'Standing trade account. Orders on the first Tuesday.', 'shopify', 'gid://shopify/Customer/71234510049', now() - interval '12 days', 'synced', now() - interval '14 minutes');

insert into public.addresses
  (customer_id, label, address_type, first_name, last_name, company, line1, suburb, city, region,
   postcode, phone, delivery_instructions, is_default, provider, shopify_gid, sync_status, synced_at)
select c.id, a.label, a.atype::public.address_type, a.fname, a.lname, a.company,
       a.line1, a.suburb, a.city, a.region, a.postcode, a.phone, a.instructions, true,
       'shopify', a.gid, 'synced', now() - interval '14 minutes'
  from (values
    ('aroha.wetere@gmail.com', 'Home', 'shipping', 'Aroha', 'Wetere', null, '14A Norfolk Street', 'Ponsonby', 'Auckland', 'Auckland', '1011', '+64 21 903 442', null, 'gid://shopify/MailingAddress/81234520000'),
    ('sam.kerrison@outlook.co.nz', 'Home', 'shipping', 'Sam', 'Kerrison', null, '9 Reef Street', 'Island Bay', 'Wellington', 'Wellington', '6023', '+64 27 118 664', 'Leave in the porch, green gate.', 'gid://shopify/MailingAddress/81234520001'),
    ('priya.nair@fastmail.com', 'Home', 'shipping', 'Priya', 'Nair', null, '212 Colombo Street, Flat 3', 'Sydenham', 'Christchurch', 'Canterbury', '8023', '+64 21 550 771', null, 'gid://shopify/MailingAddress/81234520002'),
    ('tom.whitiora@gmail.com', 'Home', 'shipping', 'Tom', 'Whitiora', null, '55 Marine Parade', 'Mount Maunganui', 'Tauranga', 'Bay of Plenty', '3116', '+64 22 447 001', 'Buzzer is broken — phone on arrival.', 'gid://shopify/MailingAddress/81234520003'),
    ('hana.f@protonmail.com', 'Home', 'shipping', 'Hana', 'Fujimoto', null, '78 Clyde Street, Flat 4', 'North Dunedin', 'Dunedin', 'Otago', '9016', '+64 27 883 215', null, 'gid://shopify/MailingAddress/81234520004'),
    ('elise@marchetti.nz', 'Home', 'shipping', 'Elise', 'Marchetti', null, '3 Battery Road', 'Ahuriri', 'Napier', 'Hawke''s Bay', '4110', '+64 21 660 908', 'Deliveries before 11am only.', 'gid://shopify/MailingAddress/81234520005'),
    ('nikau.rangi@xtra.co.nz', 'Home', 'shipping', 'Nikau', 'Rangi', null, '26 Sandringham Road', 'Kingsland', 'Auckland', 'Auckland', '1021', '+64 21 447 209', null, 'gid://shopify/MailingAddress/81234520006'),
    ('grace.ihaka@gmail.com', 'Home', 'shipping', 'Grace', 'Ihaka', null, '11 Vauxhall Road', 'Devonport', 'Auckland', 'Auckland', '0624', '+64 27 302 118', 'Leave with the neighbour at 16 if out.', 'gid://shopify/MailingAddress/81234520007'),
    ('c.speight@me.com', 'Home', 'shipping', 'Callum', 'Speight', null, '140 Riccarton Road', 'Riccarton', 'Christchurch', 'Canterbury', '8041', '+64 22 918 330', null, 'gid://shopify/MailingAddress/81234520008'),
    ('mereana.tuari@gmail.com', 'Home', 'shipping', 'Mereana', 'Tuari', null, '7 Rimu Street', 'Hamilton East', 'Hamilton', 'Waikato', '3216', '+64 21 774 662', null, 'gid://shopify/MailingAddress/81234520009'),
    ('josh.verhoeven@outlook.co.nz', 'Home', 'shipping', 'Josh', 'Verhoeven', null, '52 Adelaide Road', 'Newtown', 'Wellington', 'Wellington', '6021', '+64 27 664 018', 'Rear door, ring the bell.', 'gid://shopify/MailingAddress/81234520010'),
    ('anika.sharma@fastmail.com', 'Home', 'shipping', 'Anika', 'Sharma', null, '9 Bell Road', 'Remuera', 'Auckland', 'Auckland', '1050', '+64 21 118 447', null, 'gid://shopify/MailingAddress/81234520011'),
    ('bencorrigan@gmail.com', 'Home', 'shipping', 'Ben', 'Corrigan', null, '31 Papanui Road', 'Merivale', 'Christchurch', 'Canterbury', '8014', '+64 27 441 992', null, 'gid://shopify/MailingAddress/81234520012'),
    ('talia.fonoti@xtra.co.nz', 'Home', 'shipping', 'Talia', 'Fonoti', null, '88 Great North Road', 'Grey Lynn', 'Auckland', 'Auckland', '1021', '+64 22 330 774', 'Leave in the porch, green gate.', 'gid://shopify/MailingAddress/81234520013'),
    ('rhys.ellingham@gmail.com', 'Home', 'shipping', 'Rhys', 'Ellingham', null, '14 Highgate', 'Roslyn', 'Dunedin', 'Otago', '9010', '+64 21 992 006', null, 'gid://shopify/MailingAddress/81234520014'),
    ('marama.kingi@gmail.com', 'Home', 'shipping', 'Marama', 'Kingi', null, '5 Domain Road', 'Taradale', 'Napier', 'Hawke''s Bay', '4112', '+64 27 118 003', 'Buzzer is broken — phone on arrival.', 'gid://shopify/MailingAddress/81234520015'),
    ('o.bassett@me.com', 'Home', 'shipping', 'Oliver', 'Bassett', null, '23 Hinemoa Street', 'Birkenhead', 'Auckland', 'Auckland', '0626', '+64 21 447 771', null, 'gid://shopify/MailingAddress/81234520016'),
    ('lucy.pang@gmail.com', 'Home', 'shipping', 'Lucy', 'Pang', null, '66 Victoria Street', 'Hamilton Central', 'Hamilton', 'Waikato', '3204', '+64 27 006 118', 'Deliveries before 11am only.', 'gid://shopify/MailingAddress/81234520017'),
    ('d.ahkuoi@outlook.co.nz', 'Home', 'shipping', 'Daniel', 'Ah Kuoi', null, '12 Tirau Street', 'Otumoetai', 'Tauranga', 'Bay of Plenty', '3110', '+64 22 771 440', null, 'gid://shopify/MailingAddress/81234520018'),
    ('freya.lindqvist@gmail.com', 'Home', 'shipping', 'Freya', 'Lindqvist', null, '40 Aro Street', 'Aro Valley', 'Wellington', 'Wellington', '6021', '+64 21 330 992', 'Leave with the neighbour at 16 if out.', 'gid://shopify/MailingAddress/81234520019'),
    ('manu.paikea@xtra.co.nz', 'Home', 'shipping', 'Manu', 'Paikea', null, '18 Kaikorai Valley Road', 'Kaikorai', 'Dunedin', 'Otago', '9010', '+64 27 447 118', null, 'gid://shopify/MailingAddress/81234520020'),
    ('sophie.tremain@fastmail.com', 'Home', 'shipping', 'Sophie', 'Tremain', null, '7 Malcolm Street', 'Wanaka', 'Queenstown-Lakes', 'Otago', '9305', '+64 21 664 003', null, 'gid://shopify/MailingAddress/81234520021'),
    ('arun.pillai@gmail.com', 'Home', 'shipping', 'Arun', 'Pillai', null, '210 Dominion Road', 'Mount Eden', 'Auckland', 'Auckland', '1024', '+64 22 118 774', 'Rear door, ring the bell.', 'gid://shopify/MailingAddress/81234520022'),
    ('kate.fenwick@me.com', 'Home', 'shipping', 'Kate', 'Fenwick', null, '29 Hurstmere Road', 'Takapuna', 'Auckland', 'Auckland', '0622', '+64 21 774 118', null, 'gid://shopify/MailingAddress/81234520023'),
    ('louis.bourke@gmail.com', 'Home', 'shipping', 'Louis', 'Bourke', null, '3 Kelburn Parade', 'Kelburn', 'Wellington', 'Wellington', '6012', '+64 27 992 447', null, 'gid://shopify/MailingAddress/81234520024'),
    ('ngaire.waaka@gmail.com', 'Home', 'shipping', 'Ngaire', 'Waaka', null, '51 Fitzherbert Avenue', 'Palmerston North', 'Palmerston North', 'Manawatu', '4410', '+64 21 006 771', 'Leave in the porch, green gate.', 'gid://shopify/MailingAddress/81234520025'),
    ('h.osgood@outlook.co.nz', 'Home', 'shipping', 'Harry', 'Osgood', null, '16 Frankton Road', 'Frankton', 'Queenstown', 'Otago', '9300', '+64 22 447 330', null, 'gid://shopify/MailingAddress/81234520026'),
    ('ivy.sanderson@gmail.com', 'Home', 'shipping', 'Ivy', 'Sanderson', null, '88 Papamoa Beach Road', 'Papamoa', 'Tauranga', 'Bay of Plenty', '3118', '+64 21 118 992', 'Buzzer is broken — phone on arrival.', 'gid://shopify/MailingAddress/81234520027'),
    ('reuben.matiu@xtra.co.nz', 'Home', 'shipping', 'Reuben', 'Matiu', null, '9 Peachgrove Road', 'Chartwell', 'Hamilton', 'Waikato', '3210', '+64 27 330 006', null, 'gid://shopify/MailingAddress/81234520028'),
    ('astrid.halvorsen@fastmail.com', 'Home', 'shipping', 'Astrid', 'Halvorsen', null, '14 Bealey Avenue', 'Christchurch Central', 'Christchurch', 'Canterbury', '8013', '+64 21 447 664', 'Deliveries before 11am only.', 'gid://shopify/MailingAddress/81234520029'),
    ('cam.doull@gmail.com', 'Home', 'shipping', 'Cameron', 'Doull', null, '77 Karori Road', 'Karori', 'Wellington', 'Wellington', '6012', '+64 27 774 118', null, 'gid://shopify/MailingAddress/81234520030'),
    ('tui.ngawhika@gmail.com', 'Home', 'shipping', 'Tui', 'Ngawhika', null, '22 Shakespeare Road', 'Milford', 'Auckland', 'Auckland', '0620', '+64 21 992 330', 'Leave with the neighbour at 16 if out.', 'gid://shopify/MailingAddress/81234520031'),
    ('felix.rowntree@me.com', 'Home', 'shipping', 'Felix', 'Rowntree', null, '5 Marine Parade', 'St Clair', 'Dunedin', 'Otago', '9012', '+64 22 006 447', null, 'gid://shopify/MailingAddress/81234520032'),
    ('jasmine.okeroa@gmail.com', 'Home', 'shipping', 'Jasmine', 'Okeroa', null, '33 Onepu Road', 'Lyall Bay', 'Wellington', 'Wellington', '6022', '+64 21 664 771', null, 'gid://shopify/MailingAddress/81234520033'),
    ('milo.hastings@outlook.co.nz', 'Home', 'shipping', 'Milo', 'Hastings', null, '140 Ponsonby Road', 'Ponsonby', 'Auckland', 'Auckland', '1011', '+64 27 118 447', 'Rear door, ring the bell.', 'gid://shopify/MailingAddress/81234520034'),
    ('erin.blackwood@gmail.com', 'Home', 'shipping', 'Erin', 'Blackwood', null, '12 Cameron Road', 'Tauranga Central', 'Tauranga', 'Bay of Plenty', '3110', '+64 21 330 118', null, 'gid://shopify/MailingAddress/81234520035'),
    ('wiremu.tahana@xtra.co.nz', 'Home', 'shipping', 'Wiremu', 'Tahana', null, '48 Hukanui Road', 'Chartwell', 'Hamilton', 'Waikato', '3210', '+64 22 992 664', null, 'gid://shopify/MailingAddress/81234520036'),
    ('bianca.leota@gmail.com', 'Home', 'shipping', 'Bianca', 'Leota', null, '19 Mays Road', 'Onehunga', 'Auckland', 'Auckland', '1061', '+64 21 774 006', 'Leave in the porch, green gate.', 'gid://shopify/MailingAddress/81234520037'),
    ('struan.macrae@fastmail.com', 'Home', 'shipping', 'Struan', 'MacRae', null, '7 Arrow Lane', 'Arrowtown', 'Queenstown', 'Otago', '9302', '+64 27 447 992', null, 'gid://shopify/MailingAddress/81234520038'),
    ('yuki.nakagawa@gmail.com', 'Home', 'shipping', 'Yuki', 'Nakagawa', null, '64 Tennyson Street', 'Napier South', 'Napier', 'Hawke''s Bay', '4110', '+64 21 118 330', 'Buzzer is broken — phone on arrival.', 'gid://shopify/MailingAddress/81234520039'),
    ('pippa.thorndon@me.com', 'Home', 'shipping', 'Pippa', 'Thorndon', null, '3 Molesworth Street', 'Thorndon', 'Wellington', 'Wellington', '6011', '+64 27 006 774', null, 'gid://shopify/MailingAddress/81234520040'),
    ('kofi.mensah@gmail.com', 'Home', 'shipping', 'Kofi', 'Mensah', null, '25 New North Road', 'Eden Terrace', 'Auckland', 'Auckland', '1021', '+64 22 664 118', 'Deliveries before 11am only.', 'gid://shopify/MailingAddress/81234520041'),
    ('orders@brassandbitters.co.nz', 'Bar', 'shipping', 'Kiri', 'Ngatai', 'Brass and Bitters Limited', '30 Tyler Street', 'Britomart', 'Auckland', 'Auckland', '1010', '+64 9 302 7741', null, 'gid://shopify/MailingAddress/81234520044'),
    ('bar@thesaltroom.co.nz', 'Bar', 'shipping', 'Dev', 'Ramanathan', 'Salt Room Hospitality Limited', '118 Cuba Street', 'Te Aro', 'Wellington', 'Wellington', '6011', '+64 4 385 1120', null, 'gid://shopify/MailingAddress/81234520045'),
    ('hello@nightjarqt.nz', 'Bar', 'shipping', 'Flynn', 'Mackereth', 'Nightjar Bar Limited', '7 Hawthorne Drive, Unit 2', 'Frankton', 'Queenstown', 'Otago', '9300', '+64 3 442 8890', 'Rear door, ring the bell.', 'gid://shopify/MailingAddress/81234520046'),
    ('accounts@moxieprovisions.co.nz', 'Warehouse', 'shipping', 'Wiremu', 'Paterson', 'Moxie Provisions Limited', '42 Hugo Johnston Drive', 'Penrose', 'Auckland', 'Auckland', '1061', '+64 9 579 4402', null, 'gid://shopify/MailingAddress/81234520047'),
    ('kitchen@hallidayandsons.co.nz', 'Bar', 'shipping', 'Sina', 'Leaupepe', 'Halliday and Sons Limited', '6 Worcester Boulevard', 'Christchurch Central', 'Christchurch', 'Canterbury', '8013', '+64 3 366 2214', null, 'gid://shopify/MailingAddress/81234520048'),
    ('buying@thegreengrocerdn.co.nz', 'Bar', 'shipping', 'Ari', 'Bercovitch', 'Green Grocer Dunedin Limited', '301 George Street', 'Dunedin Central', 'Dunedin', 'Otago', '9016', '+64 3 477 9016', 'Leave in the porch, green gate.', 'gid://shopify/MailingAddress/81234520049')
  ) as a(email, label, atype, fname, lname, company, line1, suburb, city, region, postcode, phone, instructions, gid)
  join public.customers c on c.email = a.email;

update public.customers c
   set default_address_id = a.id
  from public.addresses a
 where a.customer_id = c.id and a.address_type = 'shipping' and a.is_default;

-- =============================================================================
-- ORDERS — 95 of them across the last four months: a slow start, the spike that
-- followed the Brass and Bitters feature, repeat buyers, two unpaid trade
-- invoices, two part refunds and one cancellation.
--
-- NZ retail pricing is GST-inclusive, so tax_cents is the GST already inside
-- total_cents and orders_total_balances holds: total = subtotal - discount + shipping.
-- =============================================================================
insert into public.orders
  (order_number, customer_id, email, phone, channel, status, financial_status, fulfillment_status,
   subtotal_cents, discount_cents, shipping_cents, tax_cents, total_cents, refunded_cents,
   shipping_address_id, billing_address_id, shipping_method, tracking_carrier, tracking_number, tracking_url,
   discount_id, discount_code, note, customer_note, tags,
   placed_at, paid_at, fulfilled_at, delivered_at, cancelled_at, cancel_reason, payment_gateway,
   provider, shopify_gid, shopify_updated_at, sync_status, synced_at)
select
  o.order_number, c.id, c.email, c.phone,
  o.channel::public.sales_channel, o.status::public.order_status,
  o.fin::public.order_financial_status, o.ful::public.order_fulfillment_status,
  o.subtotal, o.discount, o.shipping, o.tax, o.total, o.refunded,
  addr.id, addr.id, o.ship_method, o.carrier, o.tracking,
  case when o.tracking is null then null
       else 'https://www.nzpost.co.nz/tools/tracking/item/' || o.tracking end,
  d.id, o.discount_code, o.note, o.customer_note, o.tags::text[],
  o.placed_at, o.paid_at, o.fulfilled_at, o.delivered_at, o.cancelled_at,
  o.cancel_reason, o.gateway,
  'shopify', 'gid://shopify/Order/' || o.gid_suffix, coalesce(o.delivered_at, o.placed_at),
  'synced', now() - interval '14 minutes'
from (values
  ('HS-01001', 'sam.kerrison@outlook.co.nz', 'online', 'archived', 'paid', 'delivered', 5400, 0, 990, 833, 6390, 0, 'NZ Post Courier', 'NZ Post', 'CE923841000NZ', null, 'Regular. Threw a sticker in the box.', null, '{}', now() - interval '119 days 9 hours', now() - interval '119 days 9 hours', now() - interval '118 days 3 hours', now() - interval '116 days 2 hours', null, null, 'shopify_payments', '52640000000'),
  ('HS-01002', 'marama.kingi@gmail.com', 'online', 'archived', 'paid', 'delivered', 5400, 0, 990, 833, 6390, 0, 'Post Haste overnight', 'Post Haste', 'PH2298441007', null, null, 'Gift for my brother — no invoice in the box please.', '{}', now() - interval '115 days 10 hours', now() - interval '115 days 10 hours', now() - interval '114 days 3 hours', now() - interval '112 days 2 hours', null, null, 'shopify_payments', '52640000013'),
  ('HS-01003', 'nikau.rangi@xtra.co.nz', 'online', 'archived', 'paid', 'delivered', 2000, 0, 990, 390, 2990, 0, 'NZ Post Courier', 'NZ Post', 'CE923841014NZ', null, null, null, '{}', now() - interval '114 days 11 hours', now() - interval '114 days 11 hours', now() - interval '113 days 3 hours', now() - interval '111 days 2 hours', null, null, 'shopify_payments', '52640000026'),
  ('HS-01004', 'hello@nightjarqt.nz', 'wholesale', 'archived', 'paid', 'delivered', 74400, 7440, 0, 8734, 66960, 0, 'Freightways overnight', 'Mainfreight', 'MF80435009', 'TRADE10', 'Gift — no invoice in the box, card written.', null, '{trade}', now() - interval '113 days 12 hours', now() - interval '113 days 12 hours', now() - interval '112 days 3 hours', now() - interval '110 days 2 hours', null, null, 'invoice', '52640000039'),
  ('HS-01005', 'mereana.tuari@gmail.com', 'online', 'archived', 'paid', 'delivered', 7400, 0, 990, 1094, 8390, 0, 'NZ Post Courier', 'NZ Post', 'CE923841028NZ', null, null, 'Can you leave it with the neighbour at 16 if I''m out?', '{}', now() - interval '111 days 13 hours', now() - interval '111 days 13 hours', now() - interval '110 days 3 hours', now() - interval '108 days 2 hours', null, null, 'shopify_payments', '52640000052'),
  ('HS-01006', 'milo.hastings@outlook.co.nz', 'online', 'archived', 'paid', 'delivered', 2000, 0, 990, 390, 2990, 0, 'Post Haste overnight', 'Post Haste', 'PH2298441035', null, null, null, '{}', now() - interval '108 days 14 hours', now() - interval '108 days 14 hours', now() - interval '107 days 3 hours', now() - interval '105 days 2 hours', null, null, 'shopify_payments', '52640000065'),
  ('HS-01007', 'hana.f@protonmail.com', 'online', 'archived', 'paid', 'delivered', 10800, 0, 0, 1409, 10800, 0, 'NZ Post Courier', 'NZ Post', 'CE923841042NZ', null, 'Asked for the smoke one to be double-wrapped.', null, '{}', now() - interval '106 days 15 hours', now() - interval '106 days 15 hours', now() - interval '105 days 3 hours', now() - interval '103 days 2 hours', null, null, 'shopify_payments', '52640000078'),
  ('HS-01008', 'arun.pillai@gmail.com', 'online', 'archived', 'paid', 'delivered', 5400, 0, 990, 833, 6390, 0, 'Post Haste overnight', 'Post Haste', 'PH2298441049', null, null, 'Is the smoked one back in stock soon?', '{}', now() - interval '105 days 16 hours', now() - interval '105 days 16 hours', now() - interval '104 days 3 hours', now() - interval '102 days 2 hours', null, null, 'shopify_payments', '52640000091'),
  ('HS-01009', 'tom.whitiora@gmail.com', 'online', 'archived', 'paid', 'delivered', 10800, 0, 0, 1409, 10800, 0, 'NZ Post Courier', 'NZ Post', 'CE923841056NZ', null, null, null, '{}', now() - interval '101 days 17 hours', now() - interval '101 days 17 hours', now() - interval '100 days 3 hours', now() - interval '98 days 2 hours', null, null, 'shopify_payments', '52640000104'),
  ('HS-01010', 'orders@brassandbitters.co.nz', 'wholesale', 'archived', 'paid', 'delivered', 72000, 7200, 0, 8452, 64800, 0, 'Freightways overnight', 'Mainfreight', 'MF80435027', 'TRADE10', null, null, '{trade}', now() - interval '96 days 9 hours', now() - interval '96 days 9 hours', now() - interval '95 days 3 hours', now() - interval '93 days 2 hours', null, null, 'invoice', '52640000117'),
  ('HS-01011', 'tom.whitiora@gmail.com', 'online', 'archived', 'paid', 'delivered', 4000, 0, 990, 651, 4990, 0, 'NZ Post Courier', 'NZ Post', 'CE923841070NZ', null, 'Regular. Threw a sticker in the box.', null, '{}', now() - interval '93 days 10 hours', now() - interval '93 days 10 hours', now() - interval '92 days 3 hours', now() - interval '90 days 2 hours', null, null, 'shopify_payments', '52640000130'),
  ('HS-01012', 'kitchen@hallidayandsons.co.nz', 'wholesale', 'archived', 'paid', 'delivered', 72000, 7200, 0, 8452, 64800, 0, 'Freightways overnight', 'Mainfreight', 'MF80435033', 'TRADE10', null, null, '{trade}', now() - interval '92 days 11 hours', now() - interval '92 days 11 hours', now() - interval '91 days 3 hours', now() - interval '89 days 2 hours', null, null, 'invoice', '52640000143'),
  ('HS-01013', 'o.bassett@me.com', 'online', 'archived', 'paid', 'delivered', 5400, 0, 990, 833, 6390, 0, 'NZ Post Courier', 'NZ Post', 'CE923841084NZ', null, null, null, '{}', now() - interval '87 days 12 hours', now() - interval '87 days 12 hours', now() - interval '86 days 3 hours', now() - interval '84 days 2 hours', null, null, 'shopify_payments', '52640000156'),
  ('HS-01014', 'sam.kerrison@outlook.co.nz', 'online', 'archived', 'paid', 'delivered', 4400, 0, 990, 703, 5390, 0, 'Post Haste overnight', 'Post Haste', 'PH2298441091', null, 'Gift — no invoice in the box, card written.', 'Gift for my brother — no invoice in the box please.', '{}', now() - interval '86 days 13 hours', now() - interval '86 days 13 hours', now() - interval '85 days 3 hours', now() - interval '83 days 2 hours', null, null, 'shopify_payments', '52640000169'),
  ('HS-01015', 'astrid.halvorsen@fastmail.com', 'online', 'archived', 'paid', 'delivered', 2200, 0, 990, 416, 3190, 0, 'NZ Post Courier', 'NZ Post', 'CE923841098NZ', null, null, null, '{}', now() - interval '85 days 14 hours', now() - interval '85 days 14 hours', now() - interval '84 days 3 hours', now() - interval '82 days 2 hours', null, null, 'shopify_payments', '52640000182'),
  ('HS-01016', 'orders@brassandbitters.co.nz', 'wholesale', 'archived', 'paid', 'delivered', 67200, 6720, 0, 7889, 60480, 0, 'Freightways overnight', 'Mainfreight', 'MF80435045', 'TRADE10', null, null, '{trade}', now() - interval '85 days 15 hours', now() - interval '85 days 15 hours', now() - interval '84 days 3 hours', now() - interval '82 days 2 hours', null, null, 'invoice', '52640000195'),
  ('HS-01017', 'josh.verhoeven@outlook.co.nz', 'online', 'archived', 'paid', 'delivered', 5400, 0, 990, 833, 6390, 0, 'NZ Post Courier', 'NZ Post', 'CE923841112NZ', null, 'Asked for the smoke one to be double-wrapped.', 'Can you leave it with the neighbour at 16 if I''m out?', '{}', now() - interval '82 days 16 hours', now() - interval '82 days 16 hours', now() - interval '81 days 3 hours', now() - interval '79 days 2 hours', null, null, 'shopify_payments', '52640000208'),
  ('HS-01018', 'h.osgood@outlook.co.nz', 'online', 'archived', 'paid', 'delivered', 2000, 0, 990, 390, 2990, 0, 'Post Haste overnight', 'Post Haste', 'PH2298441119', null, null, null, '{}', now() - interval '80 days 17 hours', now() - interval '80 days 17 hours', now() - interval '79 days 3 hours', now() - interval '77 days 2 hours', null, null, 'shopify_payments', '52640000221'),
  ('HS-01019', 'tui.ngawhika@gmail.com', 'online', 'archived', 'paid', 'delivered', 7600, 500, 990, 1055, 8090, 0, 'NZ Post Courier', 'NZ Post', 'CE923841126NZ', 'BRINETIME', null, null, '{welcome}', now() - interval '80 days 9 hours', now() - interval '80 days 9 hours', now() - interval '79 days 3 hours', now() - interval '77 days 2 hours', null, null, 'shopify_payments', '52640000234'),
  ('HS-01020', 'buying@thegreengrocerdn.co.nz', 'wholesale', 'archived', 'paid', 'delivered', 74400, 7440, 0, 8734, 66960, 0, 'Freightways overnight', 'Mainfreight', 'MF80435057', 'TRADE10', null, 'Is the smoked one back in stock soon?', '{trade}', now() - interval '79 days 10 hours', now() - interval '79 days 10 hours', now() - interval '78 days 3 hours', now() - interval '76 days 2 hours', null, null, 'invoice', '52640000247'),
  ('HS-01021', 'orders@brassandbitters.co.nz', 'wholesale', 'archived', 'paid', 'delivered', 74400, 7440, 0, 8734, 66960, 0, 'Freightways overnight', 'Mainfreight', 'MF80435060', 'TRADE10', 'Regular. Threw a sticker in the box.', null, '{trade}', now() - interval '75 days 11 hours', now() - interval '75 days 11 hours', now() - interval '74 days 3 hours', now() - interval '72 days 2 hours', null, null, 'invoice', '52640000260'),
  ('HS-01022', 'sam.kerrison@outlook.co.nz', 'online', 'archived', 'paid', 'delivered', 10800, 0, 0, 1409, 10800, 0, 'Post Haste overnight', 'Post Haste', 'PH2298441147', null, null, null, '{}', now() - interval '72 days 12 hours', now() - interval '72 days 12 hours', now() - interval '71 days 3 hours', now() - interval '69 days 2 hours', null, null, 'shopify_payments', '52640000273'),
  ('HS-01023', 'bianca.leota@gmail.com', 'online', 'cancelled', 'refunded', 'cancelled', 5400, 0, 990, 833, 6390, 6390, 'NZ Post Courier', 'NZ Post', 'CE923841154NZ', null, 'Carrier damage, not a seam fault — the outer carton was crushed. Replacement shipped free.', null, '{refunded}', now() - interval '71 days 13 hours', now() - interval '71 days 13 hours', now() - interval '70 days 3 hours', null, now() - interval '66 days 1 hours', 'Two bottles arrived cracked. Refunded in full and a replacement sent at our cost.', 'shopify_payments', '52640000286'),
  ('HS-01024', 'aroha.wetere@gmail.com', 'online', 'archived', 'paid', 'delivered', 1800, 0, 990, 364, 2790, 0, 'Post Haste overnight', 'Post Haste', 'PH2298441161', null, 'Gift — no invoice in the box, card written.', null, '{}', now() - interval '66 days 14 hours', now() - interval '66 days 14 hours', now() - interval '65 days 3 hours', now() - interval '63 days 2 hours', null, null, 'shopify_payments', '52640000299'),
  ('HS-01025', 'tom.whitiora@gmail.com', 'online', 'archived', 'paid', 'delivered', 10800, 0, 0, 1409, 10800, 0, 'NZ Post Courier', 'NZ Post', 'CE923841168NZ', null, null, null, '{}', now() - interval '65 days 15 hours', now() - interval '65 days 15 hours', now() - interval '64 days 3 hours', now() - interval '62 days 2 hours', null, null, 'shopify_payments', '52640000312'),
  ('HS-01026', 'elise@marchetti.nz', 'online', 'archived', 'paid', 'delivered', 8000, 0, 0, 1043, 8000, 0, 'Post Haste overnight', 'Post Haste', 'PH2298441175', null, null, 'Gift for my brother — no invoice in the box please.', '{}', now() - interval '64 days 16 hours', now() - interval '64 days 16 hours', now() - interval '63 days 3 hours', now() - interval '61 days 2 hours', null, null, 'shopify_payments', '52640000325'),
  ('HS-01027', 'kate.fenwick@me.com', 'online', 'archived', 'paid', 'delivered', 12000, 500, 0, 1500, 11500, 0, 'NZ Post Courier', 'NZ Post', 'CE923841182NZ', 'BRINETIME', 'Asked for the smoke one to be double-wrapped.', null, '{welcome}', now() - interval '62 days 17 hours', now() - interval '62 days 17 hours', now() - interval '61 days 3 hours', now() - interval '59 days 2 hours', null, null, 'shopify_payments', '52640000338'),
  ('HS-01028', 'hana.f@protonmail.com', 'online', 'archived', 'paid', 'delivered', 10800, 0, 0, 1409, 10800, 0, 'Post Haste overnight', 'Post Haste', 'PH2298441189', null, null, null, '{}', now() - interval '58 days 9 hours', now() - interval '58 days 9 hours', now() - interval '57 days 3 hours', now() - interval '55 days 2 hours', null, null, 'shopify_payments', '52640000351'),
  ('HS-01029', 'lucy.pang@gmail.com', 'online', 'archived', 'partially_refunded', 'delivered', 10800, 500, 0, 1343, 10300, 5400, 'NZ Post Courier', 'NZ Post', 'CE923841196NZ', 'BRINETIME', 'One bottle short-shipped. Refunded that line rather than resending a single bottle.', 'Can you leave it with the neighbour at 16 if I''m out?', '{refunded,welcome}', now() - interval '57 days 10 hours', now() - interval '57 days 10 hours', now() - interval '56 days 3 hours', now() - interval '54 days 2 hours', null, null, 'shopify_payments', '52640000364'),
  ('HS-01030', 'orders@brassandbitters.co.nz', 'wholesale', 'archived', 'paid', 'delivered', 74400, 7440, 0, 8734, 66960, 0, 'Freightways overnight', 'Mainfreight', 'MF80435087', 'TRADE10', null, null, '{trade}', now() - interval '57 days 11 hours', now() - interval '57 days 11 hours', now() - interval '56 days 3 hours', now() - interval '54 days 2 hours', null, null, 'invoice', '52640000377'),
  ('HS-01031', 'nikau.rangi@xtra.co.nz', 'online', 'archived', 'paid', 'delivered', 5800, 0, 990, 886, 6790, 0, 'NZ Post Courier', 'NZ Post', 'CE923841210NZ', null, 'Regular. Threw a sticker in the box.', null, '{}', now() - interval '56 days 12 hours', now() - interval '56 days 12 hours', now() - interval '55 days 3 hours', now() - interval '53 days 2 hours', null, null, 'shopify_payments', '52640000390'),
  ('HS-01032', 'ivy.sanderson@gmail.com', 'online', 'archived', 'paid', 'delivered', 5400, 0, 1490, 899, 6890, 0, 'Post Haste overnight', 'Post Haste', 'PH2298441217', null, null, 'Is the smoked one back in stock soon?', '{}', now() - interval '55 days 13 hours', now() - interval '55 days 13 hours', now() - interval '54 days 3 hours', now() - interval '52 days 2 hours', null, null, 'shopify_payments', '52640000403'),
  ('HS-01033', 'grace.ihaka@gmail.com', 'online', 'archived', 'paid', 'delivered', 5400, 0, 990, 833, 6390, 0, 'NZ Post Courier', 'NZ Post', 'CE923841224NZ', null, null, null, '{}', now() - interval '51 days 14 hours', now() - interval '51 days 14 hours', now() - interval '50 days 3 hours', now() - interval '48 days 2 hours', null, null, 'shopify_payments', '52640000416'),
  ('HS-01034', 'marama.kingi@gmail.com', 'online', 'archived', 'paid', 'delivered', 5400, 0, 990, 833, 6390, 0, 'Post Haste overnight', 'Post Haste', 'PH2298441231', null, 'Gift — no invoice in the box, card written.', null, '{}', now() - interval '48 days 15 hours', now() - interval '48 days 15 hours', now() - interval '47 days 3 hours', now() - interval '45 days 2 hours', null, null, 'shopify_payments', '52640000429'),
  ('HS-01035', 'aroha.wetere@gmail.com', 'online', 'archived', 'paid', 'delivered', 1800, 0, 990, 364, 2790, 0, 'NZ Post Courier', 'NZ Post', 'CE923841238NZ', null, null, null, '{}', now() - interval '46 days 16 hours', now() - interval '46 days 16 hours', now() - interval '45 days 3 hours', now() - interval '43 days 2 hours', null, null, 'shopify_payments', '52640000442'),
  ('HS-01036', 'priya.nair@fastmail.com', 'online', 'open', 'paid', 'delivered', 9800, 0, 0, 1278, 9800, 0, 'Post Haste overnight', 'Post Haste', 'PH2298441245', null, null, null, '{}', now() - interval '45 days 17 hours', now() - interval '45 days 17 hours', now() - interval '44 days 3 hours', now() - interval '42 days 2 hours', null, null, 'shopify_payments', '52640000455'),
  ('HS-01037', 'mereana.tuari@gmail.com', 'online', 'open', 'paid', 'delivered', 8000, 0, 0, 1043, 8000, 0, 'NZ Post Courier', 'NZ Post', 'CE923841252NZ', null, 'Asked for the smoke one to be double-wrapped.', null, '{}', now() - interval '45 days 9 hours', now() - interval '45 days 9 hours', now() - interval '44 days 3 hours', now() - interval '42 days 2 hours', null, null, 'shopify_payments', '52640000468'),
  ('HS-01038', 'talia.fonoti@xtra.co.nz', 'online', 'open', 'partially_refunded', 'delivered', 10800, 0, 0, 1409, 10800, 5400, 'Post Haste overnight', 'Post Haste', 'PH2298441259', null, 'One bottle short-shipped. Refunded that line rather than resending a single bottle.', 'Gift for my brother — no invoice in the box please.', '{refunded}', now() - interval '45 days 10 hours', now() - interval '45 days 10 hours', now() - interval '44 days 3 hours', now() - interval '42 days 2 hours', null, null, 'shopify_payments', '52640000481'),
  ('HS-01039', 'yuki.nakagawa@gmail.com', 'online', 'open', 'paid', 'delivered', 4400, 0, 990, 703, 5390, 0, 'NZ Post Courier', 'NZ Post', 'CE923841266NZ', null, null, null, '{}', now() - interval '43 days 11 hours', now() - interval '43 days 11 hours', now() - interval '42 days 3 hours', now() - interval '40 days 2 hours', null, null, 'shopify_payments', '52640000494'),
  ('HS-01040', 'aroha.wetere@gmail.com', 'online', 'open', 'paid', 'delivered', 5400, 0, 990, 833, 6390, 0, 'Post Haste overnight', 'Post Haste', 'PH2298441273', null, null, null, '{}', now() - interval '42 days 12 hours', now() - interval '42 days 12 hours', now() - interval '41 days 3 hours', now() - interval '39 days 2 hours', null, null, 'shopify_payments', '52640000507'),
  ('HS-01041', 'rhys.ellingham@gmail.com', 'online', 'open', 'paid', 'delivered', 1800, 0, 990, 364, 2790, 0, 'NZ Post Courier', 'NZ Post', 'CE923841280NZ', null, 'Regular. Threw a sticker in the box.', 'Can you leave it with the neighbour at 16 if I''m out?', '{}', now() - interval '42 days 13 hours', now() - interval '42 days 13 hours', now() - interval '41 days 3 hours', now() - interval '39 days 2 hours', null, null, 'shopify_payments', '52640000520'),
  ('HS-01042', 'louis.bourke@gmail.com', 'online', 'open', 'paid', 'delivered', 2000, 0, 990, 390, 2990, 0, 'Post Haste overnight', 'Post Haste', 'PH2298441287', null, null, null, '{}', now() - interval '42 days 14 hours', now() - interval '42 days 14 hours', now() - interval '41 days 3 hours', now() - interval '39 days 2 hours', null, null, 'shopify_payments', '52640000533'),
  ('HS-01043', 'tom.whitiora@gmail.com', 'online', 'open', 'paid', 'delivered', 10800, 0, 0, 1409, 10800, 0, 'NZ Post Courier', 'NZ Post', 'CE923841294NZ', null, null, null, '{}', now() - interval '40 days 15 hours', now() - interval '40 days 15 hours', now() - interval '39 days 3 hours', now() - interval '37 days 2 hours', null, null, 'shopify_payments', '52640000546'),
  ('HS-01044', 'hello@nightjarqt.nz', 'wholesale', 'open', 'paid', 'delivered', 67200, 6720, 0, 7889, 60480, 0, 'Freightways overnight', 'Mainfreight', 'MF80435129', 'TRADE10', 'Gift — no invoice in the box, card written.', 'Is the smoked one back in stock soon?', '{trade}', now() - interval '40 days 16 hours', now() - interval '40 days 16 hours', now() - interval '39 days 3 hours', now() - interval '37 days 2 hours', null, null, 'invoice', '52640000559'),
  ('HS-01045', 'mereana.tuari@gmail.com', 'online', 'open', 'paid', 'delivered', 4000, 0, 990, 651, 4990, 0, 'NZ Post Courier', 'NZ Post', 'CE923841308NZ', null, null, null, '{}', now() - interval '39 days 17 hours', now() - interval '39 days 17 hours', now() - interval '38 days 3 hours', now() - interval '36 days 2 hours', null, null, 'shopify_payments', '52640000572'),
  ('HS-01046', 'aroha.wetere@gmail.com', 'online', 'open', 'paid', 'delivered', 9800, 0, 0, 1278, 9800, 0, 'Post Haste overnight', 'Post Haste', 'PH2298441315', null, null, null, '{}', now() - interval '38 days 9 hours', now() - interval '38 days 9 hours', now() - interval '37 days 3 hours', now() - interval '35 days 2 hours', null, null, 'shopify_payments', '52640000585'),
  ('HS-01047', 'anika.sharma@fastmail.com', 'online', 'open', 'paid', 'delivered', 5400, 0, 990, 833, 6390, 0, 'NZ Post Courier', 'NZ Post', 'CE923841322NZ', null, 'Asked for the smoke one to be double-wrapped.', null, '{}', now() - interval '38 days 10 hours', now() - interval '38 days 10 hours', now() - interval '37 days 3 hours', now() - interval '35 days 2 hours', null, null, 'shopify_payments', '52640000598'),
  ('HS-01048', 'kofi.mensah@gmail.com', 'online', 'open', 'paid', 'delivered', 4400, 0, 990, 703, 5390, 0, 'Post Haste overnight', 'Post Haste', 'PH2298441329', null, null, null, '{}', now() - interval '38 days 11 hours', now() - interval '38 days 11 hours', now() - interval '37 days 3 hours', now() - interval '35 days 2 hours', null, null, 'shopify_payments', '52640000611'),
  ('HS-01049', 'anika.sharma@fastmail.com', 'online', 'open', 'paid', 'delivered', 7800, 0, 990, 1147, 8790, 0, 'NZ Post Courier', 'NZ Post', 'CE923841336NZ', null, null, null, '{}', now() - interval '35 days 12 hours', now() - interval '35 days 12 hours', now() - interval '34 days 3 hours', now() - interval '32 days 2 hours', null, null, 'shopify_payments', '52640000624'),
  ('HS-01050', 'freya.lindqvist@gmail.com', 'online', 'open', 'paid', 'delivered', 7400, 0, 990, 1094, 8390, 0, 'Post Haste overnight', 'Post Haste', 'PH2298441343', null, null, 'Gift for my brother — no invoice in the box please.', '{}', now() - interval '35 days 13 hours', now() - interval '35 days 13 hours', now() - interval '34 days 3 hours', now() - interval '32 days 2 hours', null, null, 'shopify_payments', '52640000637'),
  ('HS-01051', 'struan.macrae@fastmail.com', 'online', 'open', 'paid', 'delivered', 2000, 0, 1490, 455, 3490, 0, 'NZ Post Courier', 'NZ Post', 'CE923841350NZ', null, 'Regular. Threw a sticker in the box.', null, '{}', now() - interval '33 days 14 hours', now() - interval '33 days 14 hours', now() - interval '32 days 3 hours', now() - interval '30 days 2 hours', null, null, 'shopify_payments', '52640000650'),
  ('HS-01052', 'bar@thesaltroom.co.nz', 'wholesale', 'open', 'paid', 'delivered', 67200, 6720, 0, 7889, 60480, 0, 'Freightways overnight', 'Mainfreight', 'MF80435153', 'TRADE10', null, null, '{trade}', now() - interval '32 days 15 hours', now() - interval '32 days 15 hours', now() - interval '31 days 3 hours', now() - interval '29 days 2 hours', null, null, 'invoice', '52640000663'),
  ('HS-01053', 'priya.nair@fastmail.com', 'online', 'open', 'paid', 'delivered', 10000, 0, 0, 1304, 10000, 0, 'NZ Post Courier', 'NZ Post', 'CE923841364NZ', null, null, 'Can you leave it with the neighbour at 16 if I''m out?', '{}', now() - interval '30 days 16 hours', now() - interval '30 days 16 hours', now() - interval '29 days 3 hours', now() - interval '27 days 2 hours', null, null, 'shopify_payments', '52640000676'),
  ('HS-01054', 'cam.doull@gmail.com', 'online', 'open', 'paid', 'delivered', 7600, 0, 990, 1120, 8590, 0, 'Post Haste overnight', 'Post Haste', 'PH2298441371', null, 'Gift — no invoice in the box, card written.', null, '{}', now() - interval '30 days 17 hours', now() - interval '30 days 17 hours', now() - interval '29 days 3 hours', now() - interval '27 days 2 hours', null, null, 'shopify_payments', '52640000689'),
  ('HS-01055', 'jasmine.okeroa@gmail.com', 'online', 'open', 'paid', 'delivered', 5400, 0, 990, 833, 6390, 0, 'NZ Post Courier', 'NZ Post', 'CE923841378NZ', null, null, null, '{}', now() - interval '30 days 9 hours', now() - interval '30 days 9 hours', now() - interval '29 days 3 hours', now() - interval '27 days 2 hours', null, null, 'shopify_payments', '52640000702'),
  ('HS-01056', 'josh.verhoeven@outlook.co.nz', 'online', 'open', 'paid', 'delivered', 10800, 0, 0, 1409, 10800, 0, 'Post Haste overnight', 'Post Haste', 'PH2298441385', null, null, 'Is the smoked one back in stock soon?', '{}', now() - interval '29 days 10 hours', now() - interval '29 days 10 hours', now() - interval '28 days 3 hours', now() - interval '26 days 2 hours', null, null, 'shopify_payments', '52640000715'),
  ('HS-01057', 'sam.kerrison@outlook.co.nz', 'online', 'open', 'paid', 'delivered', 6400, 0, 990, 964, 7390, 0, 'NZ Post Courier', 'NZ Post', 'CE923841392NZ', null, 'Asked for the smoke one to be double-wrapped.', null, '{}', now() - interval '28 days 11 hours', now() - interval '28 days 11 hours', now() - interval '27 days 3 hours', now() - interval '25 days 2 hours', null, null, 'shopify_payments', '52640000728'),
  ('HS-01058', 'ngaire.waaka@gmail.com', 'online', 'open', 'paid', 'delivered', 4400, 500, 990, 638, 4890, 0, 'Post Haste overnight', 'Post Haste', 'PH2298441399', 'BRINETIME', null, null, '{welcome}', now() - interval '27 days 12 hours', now() - interval '27 days 12 hours', now() - interval '26 days 3 hours', now() - interval '24 days 2 hours', null, null, 'shopify_payments', '52640000741'),
  ('HS-01059', 'felix.rowntree@me.com', 'online', 'open', 'paid', 'delivered', 4000, 0, 990, 651, 4990, 0, 'NZ Post Courier', 'NZ Post', 'CE923841406NZ', null, null, null, '{}', now() - interval '26 days 13 hours', now() - interval '26 days 13 hours', now() - interval '25 days 3 hours', now() - interval '23 days 2 hours', null, null, 'shopify_payments', '52640000754'),
  ('HS-01060', 'bar@thesaltroom.co.nz', 'wholesale', 'open', 'paid', 'delivered', 67200, 6720, 0, 7889, 60480, 0, 'Freightways overnight', 'Mainfreight', 'MF80435177', 'TRADE10', null, null, '{trade}', now() - interval '26 days 14 hours', now() - interval '26 days 14 hours', now() - interval '25 days 3 hours', now() - interval '23 days 2 hours', null, null, 'invoice', '52640000767'),
  ('HS-01061', 'hana.f@protonmail.com', 'online', 'open', 'paid', 'delivered', 12000, 0, 0, 1565, 12000, 0, 'NZ Post Courier', 'NZ Post', 'CE923841420NZ', null, 'Regular. Threw a sticker in the box.', null, '{}', now() - interval '25 days 15 hours', now() - interval '25 days 15 hours', now() - interval '24 days 3 hours', now() - interval '22 days 2 hours', null, null, 'shopify_payments', '52640000780'),
  ('HS-01062', 'c.speight@me.com', 'online', 'open', 'paid', 'delivered', 10800, 0, 0, 1409, 10800, 0, 'Post Haste overnight', 'Post Haste', 'PH2298441427', null, null, 'Gift for my brother — no invoice in the box please.', '{}', now() - interval '25 days 16 hours', now() - interval '25 days 16 hours', now() - interval '24 days 3 hours', now() - interval '22 days 2 hours', null, null, 'shopify_payments', '52640000793'),
  ('HS-01063', 'sam.kerrison@outlook.co.nz', 'online', 'open', 'paid', 'delivered', 4000, 0, 990, 651, 4990, 0, 'NZ Post Courier', 'NZ Post', 'CE923841434NZ', null, null, null, '{}', now() - interval '24 days 17 hours', now() - interval '24 days 17 hours', now() - interval '23 days 3 hours', now() - interval '21 days 2 hours', null, null, 'shopify_payments', '52640000806'),
  ('HS-01064', 'elise@marchetti.nz', 'online', 'open', 'paid', 'delivered', 5400, 0, 990, 833, 6390, 0, 'Post Haste overnight', 'Post Haste', 'PH2298441441', null, 'Gift — no invoice in the box, card written.', null, '{}', now() - interval '22 days 9 hours', now() - interval '22 days 9 hours', now() - interval '21 days 3 hours', now() - interval '19 days 2 hours', null, null, 'shopify_payments', '52640000819'),
  ('HS-01065', 'sophie.tremain@fastmail.com', 'online', 'open', 'paid', 'delivered', 5400, 0, 1490, 899, 6890, 0, 'NZ Post Courier', 'NZ Post', 'CE923841448NZ', null, null, 'Can you leave it with the neighbour at 16 if I''m out?', '{}', now() - interval '21 days 10 hours', now() - interval '21 days 10 hours', now() - interval '20 days 3 hours', now() - interval '18 days 2 hours', null, null, 'shopify_payments', '52640000832'),
  ('HS-01066', 'elise@marchetti.nz', 'online', 'open', 'paid', 'delivered', 3600, 0, 990, 599, 4590, 0, 'Post Haste overnight', 'Post Haste', 'PH2298441455', null, null, null, '{}', now() - interval '20 days 11 hours', now() - interval '20 days 11 hours', now() - interval '19 days 3 hours', now() - interval '17 days 2 hours', null, null, 'shopify_payments', '52640000845'),
  ('HS-01067', 'bencorrigan@gmail.com', 'online', 'open', 'paid', 'delivered', 5400, 0, 990, 833, 6390, 0, 'NZ Post Courier', 'NZ Post', 'CE923841462NZ', null, 'Asked for the smoke one to be double-wrapped.', null, '{}', now() - interval '20 days 12 hours', now() - interval '20 days 12 hours', now() - interval '19 days 3 hours', now() - interval '17 days 2 hours', null, null, 'shopify_payments', '52640000858'),
  ('HS-01068', 'accounts@moxieprovisions.co.nz', 'wholesale', 'open', 'paid', 'delivered', 189600, 37920, 0, 19784, 151680, 0, 'Pallet — Mainfreight', 'Mainfreight', 'MF80435201', 'WHOLESALE20', null, 'Is the smoked one back in stock soon?', '{trade}', now() - interval '20 days 13 hours', now() - interval '20 days 13 hours', now() - interval '19 days 3 hours', now() - interval '17 days 2 hours', null, null, 'invoice', '52640000871'),
  ('HS-01069', 'rhys.ellingham@gmail.com', 'online', 'open', 'paid', 'delivered', 4400, 0, 990, 703, 5390, 0, 'NZ Post Courier', 'NZ Post', 'CE923841476NZ', null, null, null, '{}', now() - interval '19 days 14 hours', now() - interval '19 days 14 hours', now() - interval '18 days 3 hours', now() - interval '16 days 2 hours', null, null, 'shopify_payments', '52640000884'),
  ('HS-01070', 'bar@thesaltroom.co.nz', 'wholesale', 'open', 'paid', 'delivered', 74400, 7440, 0, 8734, 66960, 0, 'Freightways overnight', 'Mainfreight', 'MF80435207', 'TRADE10', null, null, '{trade}', now() - interval '19 days 15 hours', now() - interval '19 days 15 hours', now() - interval '18 days 3 hours', now() - interval '16 days 2 hours', null, null, 'invoice', '52640000897'),
  ('HS-01071', 'sam.kerrison@outlook.co.nz', 'online', 'open', 'paid', 'delivered', 1800, 0, 990, 364, 2790, 0, 'NZ Post Courier', 'NZ Post', 'CE923841490NZ', null, 'Regular. Threw a sticker in the box.', null, '{}', now() - interval '18 days 16 hours', now() - interval '18 days 16 hours', now() - interval '17 days 3 hours', now() - interval '15 days 2 hours', null, null, 'shopify_payments', '52640000910'),
  ('HS-01072', 'priya.nair@fastmail.com', 'online', 'open', 'paid', 'delivered', 5400, 0, 990, 833, 6390, 0, 'Post Haste overnight', 'Post Haste', 'PH2298441497', null, null, null, '{}', now() - interval '18 days 17 hours', now() - interval '18 days 17 hours', now() - interval '17 days 3 hours', now() - interval '15 days 2 hours', null, null, 'shopify_payments', '52640000923'),
  ('HS-01073', 'tom.whitiora@gmail.com', 'online', 'open', 'paid', 'delivered', 5400, 0, 990, 833, 6390, 0, 'NZ Post Courier', 'NZ Post', 'CE923841504NZ', null, null, null, '{}', now() - interval '17 days 9 hours', now() - interval '17 days 9 hours', now() - interval '16 days 3 hours', now() - interval '14 days 2 hours', null, null, 'shopify_payments', '52640000936'),
  ('HS-01074', 'talia.fonoti@xtra.co.nz', 'online', 'open', 'paid', 'delivered', 6200, 0, 990, 938, 7190, 0, 'Post Haste overnight', 'Post Haste', 'PH2298441511', null, 'Gift — no invoice in the box, card written.', 'Gift for my brother — no invoice in the box please.', '{}', now() - interval '17 days 10 hours', now() - interval '17 days 10 hours', now() - interval '16 days 3 hours', now() - interval '14 days 2 hours', null, null, 'shopify_payments', '52640000949'),
  ('HS-01075', 'erin.blackwood@gmail.com', 'online', 'open', 'paid', 'delivered', 2000, 0, 990, 390, 2990, 0, 'NZ Post Courier', 'NZ Post', 'CE923841518NZ', null, null, null, '{}', now() - interval '16 days 11 hours', now() - interval '16 days 11 hours', now() - interval '15 days 3 hours', now() - interval '13 days 2 hours', null, null, 'shopify_payments', '52640000962'),
  ('HS-01076', 'accounts@moxieprovisions.co.nz', 'wholesale', 'open', 'paid', 'delivered', 163200, 32640, 0, 17030, 130560, 0, 'Pallet — Mainfreight', 'Mainfreight', 'MF80435225', 'WHOLESALE20', null, null, '{trade}', now() - interval '16 days 12 hours', now() - interval '16 days 12 hours', now() - interval '15 days 3 hours', now() - interval '13 days 2 hours', null, null, 'invoice', '52640000975'),
  ('HS-01077', 'josh.verhoeven@outlook.co.nz', 'online', 'open', 'paid', 'delivered', 2000, 0, 990, 390, 2990, 0, 'NZ Post Courier', 'NZ Post', 'CE923841532NZ', null, 'Asked for the smoke one to be double-wrapped.', 'Can you leave it with the neighbour at 16 if I''m out?', '{}', now() - interval '15 days 13 hours', now() - interval '15 days 13 hours', now() - interval '14 days 3 hours', now() - interval '12 days 2 hours', null, null, 'shopify_payments', '52640000988'),
  ('HS-01078', 'd.ahkuoi@outlook.co.nz', 'online', 'open', 'paid', 'delivered', 5800, 0, 990, 886, 6790, 0, 'Post Haste overnight', 'Post Haste', 'PH2298441539', null, null, null, '{}', now() - interval '15 days 14 hours', now() - interval '15 days 14 hours', now() - interval '14 days 3 hours', now() - interval '12 days 2 hours', null, null, 'shopify_payments', '52640001001'),
  ('HS-01079', 'c.speight@me.com', 'online', 'open', 'paid', 'delivered', 9000, 0, 0, 1174, 9000, 0, 'NZ Post Courier', 'NZ Post', 'CE923841546NZ', null, null, null, '{}', now() - interval '13 days 15 hours', now() - interval '13 days 15 hours', now() - interval '12 days 3 hours', now() - interval '10 days 2 hours', null, null, 'shopify_payments', '52640001014'),
  ('HS-01080', 'pippa.thorndon@me.com', 'online', 'open', 'paid', 'delivered', 2200, 0, 990, 416, 3190, 0, 'Post Haste overnight', 'Post Haste', 'PH2298441553', null, null, 'Is the smoked one back in stock soon?', '{}', now() - interval '13 days 16 hours', now() - interval '13 days 16 hours', now() - interval '12 days 3 hours', now() - interval '10 days 2 hours', null, null, 'shopify_payments', '52640001027'),
  ('HS-01081', 'kitchen@hallidayandsons.co.nz', 'wholesale', 'open', 'paid', 'delivered', 74400, 7440, 0, 8734, 66960, 0, 'Freightways overnight', 'Mainfreight', 'MF80435240', 'TRADE10', 'Regular. Threw a sticker in the box.', null, '{trade}', now() - interval '12 days 17 hours', now() - interval '12 days 17 hours', now() - interval '11 days 3 hours', now() - interval '9 days 2 hours', null, null, 'invoice', '52640001040'),
  ('HS-01082', 'buying@thegreengrocerdn.co.nz', 'wholesale', 'open', 'paid', 'delivered', 74400, 7440, 0, 8734, 66960, 0, 'Freightways overnight', 'Mainfreight', 'MF80435243', 'TRADE10', null, null, '{trade}', now() - interval '12 days 9 hours', now() - interval '12 days 9 hours', now() - interval '11 days 3 hours', now() - interval '9 days 2 hours', null, null, 'invoice', '52640001053'),
  ('HS-01083', 'reuben.matiu@xtra.co.nz', 'online', 'open', 'paid', 'delivered', 5400, 0, 990, 833, 6390, 0, 'NZ Post Courier', 'NZ Post', 'CE923841574NZ', null, null, null, '{}', now() - interval '10 days 10 hours', now() - interval '10 days 10 hours', now() - interval '9 days 3 hours', now() - interval '7 days 2 hours', null, null, 'shopify_payments', '52640001066'),
  ('HS-01084', 'grace.ihaka@gmail.com', 'online', 'open', 'paid', 'delivered', 3600, 0, 990, 599, 4590, 0, 'Post Haste overnight', 'Post Haste', 'PH2298441581', null, 'Gift — no invoice in the box, card written.', null, '{}', now() - interval '9 days 11 hours', now() - interval '9 days 11 hours', now() - interval '8 days 3 hours', now() - interval '6 days 2 hours', null, null, 'shopify_payments', '52640001079'),
  ('HS-01085', 'priya.nair@fastmail.com', 'online', 'open', 'paid', 'fulfilled', 4000, 0, 990, 651, 4990, 0, 'NZ Post Courier', 'NZ Post', 'CE923841588NZ', null, null, null, '{}', now() - interval '7 days 12 hours', now() - interval '7 days 12 hours', now() - interval '6 days 3 hours', null, null, null, 'shopify_payments', '52640001092'),
  ('HS-01086', 'tom.whitiora@gmail.com', 'online', 'open', 'paid', 'delivered', 5400, 0, 990, 833, 6390, 0, 'Post Haste overnight', 'Post Haste', 'PH2298441595', null, null, 'Gift for my brother — no invoice in the box please.', '{}', now() - interval '6 days 13 hours', now() - interval '6 days 13 hours', now() - interval '5 days 3 hours', now() - interval '3 days 2 hours', null, null, 'shopify_payments', '52640001105'),
  ('HS-01087', 'manu.paikea@xtra.co.nz', 'online', 'open', 'paid', 'delivered', 7800, 0, 990, 1147, 8790, 0, 'NZ Post Courier', 'NZ Post', 'CE923841602NZ', null, 'Asked for the smoke one to be double-wrapped.', null, '{}', now() - interval '5 days 14 hours', now() - interval '5 days 14 hours', now() - interval '4 days 3 hours', now() - interval '2 days 2 hours', null, null, 'shopify_payments', '52640001118'),
  ('HS-01088', 'buying@thegreengrocerdn.co.nz', 'wholesale', 'open', 'pending', 'unfulfilled', 67200, 6720, 0, 7889, 60480, 0, 'Freightways overnight', null, null, 'TRADE10', 'Invoice issued on the 20th. Confirmed by phone.', null, '{trade}', now() - interval '5 days 15 hours', null, null, null, null, null, 'invoice', '52640001131'),
  ('HS-01089', 'bencorrigan@gmail.com', 'online', 'open', 'paid', 'fulfilled', 8400, 0, 0, 1096, 8400, 0, 'NZ Post Courier', 'NZ Post', 'CE923841616NZ', null, null, 'Can you leave it with the neighbour at 16 if I''m out?', '{}', now() - interval '4 days 16 hours', now() - interval '4 days 16 hours', now() - interval '3 days 3 hours', null, null, null, 'shopify_payments', '52640001144'),
  ('HS-01090', 'hana.f@protonmail.com', 'online', 'open', 'paid', 'fulfilled', 4200, 0, 990, 677, 5190, 0, 'Post Haste overnight', 'Post Haste', 'PH2298441623', null, null, null, '{}', now() - interval '3 days 17 hours', now() - interval '3 days 17 hours', now() - interval '2 days 3 hours', null, null, null, 'shopify_payments', '52640001157'),
  ('HS-01091', 'aroha.wetere@gmail.com', 'online', 'open', 'paid', 'unfulfilled', 7800, 0, 990, 1147, 8790, 0, 'NZ Post Courier', null, null, null, 'Regular. Threw a sticker in the box.', null, '{}', now() - interval '1 days 9 hours', now() - interval '1 days 9 hours', null, null, null, null, 'shopify_payments', '52640001170'),
  ('HS-01092', 'kitchen@hallidayandsons.co.nz', 'wholesale', 'open', 'pending', 'unfulfilled', 72000, 7200, 0, 8452, 64800, 0, 'Freightways overnight', null, null, 'TRADE10', 'Invoice issued on the 20th. Confirmed by phone.', 'Is the smoked one back in stock soon?', '{trade}', now() - interval '1 days 10 hours', null, null, null, null, null, 'invoice', '52640001183'),
  ('HS-01093', 'rhys.ellingham@gmail.com', 'online', 'open', 'paid', 'unfulfilled', 5400, 0, 990, 833, 6390, 0, 'NZ Post Courier', null, null, null, null, null, '{}', now() - interval '0 days 11 hours', now() - interval '0 days 11 hours', null, null, null, null, 'shopify_payments', '52640001196'),
  ('HS-01094', 'wiremu.tahana@xtra.co.nz', 'online', 'open', 'paid', 'unfulfilled', 8000, 0, 0, 1043, 8000, 0, 'NZ Post Courier', null, null, null, 'Gift — no invoice in the box, card written.', null, '{}', now() - interval '0 days 12 hours', now() - interval '0 days 12 hours', null, null, null, null, 'shopify_payments', '52640001209'),
  ('HS-01095', 'buying@thegreengrocerdn.co.nz', 'wholesale', 'open', 'paid', 'unfulfilled', 67200, 6720, 0, 7889, 60480, 0, 'Freightways overnight', null, null, 'TRADE10', null, null, '{trade}', now() - interval '0 days 13 hours', now() - interval '0 days 13 hours', null, null, null, null, 'invoice', '52640001222')

) as o(order_number, email, channel, status, fin, ful,
       subtotal, discount, shipping, tax, total, refunded,
       ship_method, carrier, tracking, discount_code, note, customer_note, tags,
       placed_at, paid_at, fulfilled_at, delivered_at, cancelled_at,
       cancel_reason, gateway, gid_suffix)
join public.customers c on c.email = o.email
left join public.addresses addr
  on addr.customer_id = c.id and addr.address_type = 'shipping' and addr.is_default
left join public.discounts d on d.code = o.discount_code;

select setval('public.order_number_seq', 1096, false);

insert into public.order_items
  (order_id, currency, product_id, variant_id, shopify_gid, sku, title, variant_title,
   quantity, quantity_fulfilled, quantity_refunded, unit_price_cents, unit_cost_cents,
   discount_cents, tax_cents, line_total_cents, position)
select ord.id, 'NZD', v.product_id, v.id, 'gid://shopify/LineItem/' || li.gid_suffix,
       v.sku, p.title, v.title,
       li.qty,
       case when ord.fulfillment_status in ('fulfilled','delivered') then li.qty else 0 end,
       li.refunded_qty,
       li.price, v.unit_cost_cents, li.disc,
       ((li.qty * li.price - li.disc) * 3 + 11) / 23,
       li.qty * li.price - li.disc,
       li.pos
  from (values
    ('HS-01001', 'HS-SET-3', 1, 5400, 0, 0, 10, '63340000007'),
    ('HS-01002', 'HS-SET-3', 1, 5400, 0, 0, 10, '63340000014'),
    ('HS-01003', 'HS-02-500', 1, 2000, 0, 0, 10, '63340000021'),
    ('HS-01004', 'HS-02-500', 24, 2000, 4800, 0, 10, '63340000028'),
    ('HS-01004', 'HS-03-500', 12, 2200, 2640, 0, 20, '63340000035'),
    ('HS-01005', 'HS-SET-3', 1, 5400, 0, 0, 10, '63340000042'),
    ('HS-01005', 'HS-02-500', 1, 2000, 0, 0, 20, '63340000049'),
    ('HS-01006', 'HS-02-500', 1, 2000, 0, 0, 10, '63340000056'),
    ('HS-01007', 'HS-SET-3', 2, 5400, 0, 0, 10, '63340000063'),
    ('HS-01008', 'HS-SET-3', 1, 5400, 0, 0, 10, '63340000070'),
    ('HS-01009', 'HS-SET-3', 2, 5400, 0, 0, 10, '63340000077'),
    ('HS-01010', 'HS-01-500', 12, 1800, 2160, 0, 10, '63340000084'),
    ('HS-01010', 'HS-02-500', 12, 2000, 2400, 0, 20, '63340000091'),
    ('HS-01010', 'HS-03-500', 12, 2200, 2640, 0, 30, '63340000098'),
    ('HS-01011', 'HS-02-500', 2, 2000, 0, 0, 10, '63340000105'),
    ('HS-01012', 'HS-01-500', 12, 1800, 2160, 0, 10, '63340000112'),
    ('HS-01012', 'HS-02-500', 12, 2000, 2400, 0, 20, '63340000119'),
    ('HS-01012', 'HS-03-500', 12, 2200, 2640, 0, 30, '63340000126'),
    ('HS-01013', 'HS-SET-3', 1, 5400, 0, 0, 10, '63340000133'),
    ('HS-01014', 'HS-03-500', 2, 2200, 0, 0, 10, '63340000140'),
    ('HS-01015', 'HS-03-500', 1, 2200, 0, 0, 10, '63340000147'),
    ('HS-01016', 'HS-01-500', 24, 1800, 4320, 0, 10, '63340000154'),
    ('HS-01016', 'HS-02-500', 12, 2000, 2400, 0, 20, '63340000161'),
    ('HS-01017', 'HS-SET-3', 1, 5400, 0, 0, 10, '63340000168'),
    ('HS-01018', 'HS-02-500', 1, 2000, 0, 0, 10, '63340000175'),
    ('HS-01019', 'HS-SET-3', 1, 5400, 355, 0, 10, '63340000182'),
    ('HS-01019', 'HS-03-500', 1, 2200, 145, 0, 20, '63340000189'),
    ('HS-01020', 'HS-02-500', 24, 2000, 4800, 0, 10, '63340000196'),
    ('HS-01020', 'HS-03-500', 12, 2200, 2640, 0, 20, '63340000203'),
    ('HS-01021', 'HS-02-500', 24, 2000, 4800, 0, 10, '63340000210'),
    ('HS-01021', 'HS-03-500', 12, 2200, 2640, 0, 20, '63340000217'),
    ('HS-01022', 'HS-SET-3', 2, 5400, 0, 0, 10, '63340000224'),
    ('HS-01023', 'HS-SET-3', 1, 5400, 0, 1, 10, '63340000231'),
    ('HS-01024', 'HS-01-500', 1, 1800, 0, 0, 10, '63340000238'),
    ('HS-01025', 'HS-SET-3', 2, 5400, 0, 0, 10, '63340000245'),
    ('HS-01026', 'HS-03-500', 1, 2200, 0, 0, 10, '63340000252'),
    ('HS-01026', 'HS-01-500', 1, 1800, 0, 0, 20, '63340000259'),
    ('HS-01026', 'HS-02-500', 2, 2000, 0, 0, 30, '63340000266'),
    ('HS-01027', 'HS-02-500', 2, 2000, 166, 0, 10, '63340000273'),
    ('HS-01027', 'HS-01-500', 2, 1800, 150, 0, 20, '63340000280'),
    ('HS-01027', 'HS-03-500', 2, 2200, 184, 0, 30, '63340000287'),
    ('HS-01028', 'HS-SET-3', 2, 5400, 0, 0, 10, '63340000294'),
    ('HS-01029', 'HS-SET-3', 2, 5400, 500, 1, 10, '63340000301'),
    ('HS-01030', 'HS-02-500', 24, 2000, 4800, 0, 10, '63340000308'),
    ('HS-01030', 'HS-03-500', 12, 2200, 2640, 0, 20, '63340000315'),
    ('HS-01031', 'HS-03-500', 1, 2200, 0, 0, 10, '63340000322'),
    ('HS-01031', 'HS-01-500', 2, 1800, 0, 0, 20, '63340000329'),
    ('HS-01032', 'HS-SET-3', 1, 5400, 0, 0, 10, '63340000336'),
    ('HS-01033', 'HS-SET-3', 1, 5400, 0, 0, 10, '63340000343'),
    ('HS-01034', 'HS-SET-3', 1, 5400, 0, 0, 10, '63340000350'),
    ('HS-01035', 'HS-01-500', 1, 1800, 0, 0, 10, '63340000357'),
    ('HS-01036', 'HS-SET-3', 1, 5400, 0, 0, 10, '63340000364'),
    ('HS-01036', 'HS-03-500', 2, 2200, 0, 0, 20, '63340000371'),
    ('HS-01037', 'HS-03-500', 2, 2200, 0, 0, 10, '63340000378'),
    ('HS-01037', 'HS-01-500', 2, 1800, 0, 0, 20, '63340000385'),
    ('HS-01038', 'HS-SET-3', 2, 5400, 0, 1, 10, '63340000392'),
    ('HS-01039', 'HS-03-500', 2, 2200, 0, 0, 10, '63340000399'),
    ('HS-01040', 'HS-SET-3', 1, 5400, 0, 0, 10, '63340000406'),
    ('HS-01041', 'HS-01-500', 1, 1800, 0, 0, 10, '63340000413'),
    ('HS-01042', 'HS-02-500', 1, 2000, 0, 0, 10, '63340000420'),
    ('HS-01043', 'HS-SET-3', 2, 5400, 0, 0, 10, '63340000427'),
    ('HS-01044', 'HS-01-500', 24, 1800, 4320, 0, 10, '63340000434'),
    ('HS-01044', 'HS-02-500', 12, 2000, 2400, 0, 20, '63340000441'),
    ('HS-01045', 'HS-03-500', 1, 2200, 0, 0, 10, '63340000448'),
    ('HS-01045', 'HS-01-500', 1, 1800, 0, 0, 20, '63340000455'),
    ('HS-01046', 'HS-SET-3', 1, 5400, 0, 0, 10, '63340000462'),
    ('HS-01046', 'HS-03-500', 2, 2200, 0, 0, 20, '63340000469'),
    ('HS-01047', 'HS-SET-3', 1, 5400, 0, 0, 10, '63340000476'),
    ('HS-01048', 'HS-03-500', 2, 2200, 0, 0, 10, '63340000483'),
    ('HS-01049', 'HS-01-500', 2, 1800, 0, 0, 10, '63340000490'),
    ('HS-01049', 'HS-03-500', 1, 2200, 0, 0, 20, '63340000497'),
    ('HS-01049', 'HS-02-500', 1, 2000, 0, 0, 30, '63340000504'),
    ('HS-01050', 'HS-SET-3', 1, 5400, 0, 0, 10, '63340000511'),
    ('HS-01050', 'HS-02-500', 1, 2000, 0, 0, 20, '63340000518'),
    ('HS-01051', 'HS-02-500', 1, 2000, 0, 0, 10, '63340000525'),
    ('HS-01052', 'HS-01-500', 24, 1800, 4320, 0, 10, '63340000532'),
    ('HS-01052', 'HS-02-500', 12, 2000, 2400, 0, 20, '63340000539'),
    ('HS-01053', 'HS-01-500', 2, 1800, 0, 0, 10, '63340000546'),
    ('HS-01053', 'HS-02-500', 1, 2000, 0, 0, 20, '63340000553'),
    ('HS-01053', 'HS-03-500', 2, 2200, 0, 0, 30, '63340000560'),
    ('HS-01054', 'HS-SET-3', 1, 5400, 0, 0, 10, '63340000567'),
    ('HS-01054', 'HS-03-500', 1, 2200, 0, 0, 20, '63340000574'),
    ('HS-01055', 'HS-SET-3', 1, 5400, 0, 0, 10, '63340000581'),
    ('HS-01056', 'HS-SET-3', 2, 5400, 0, 0, 10, '63340000588'),
    ('HS-01057', 'HS-02-500', 1, 2000, 0, 0, 10, '63340000595'),
    ('HS-01057', 'HS-03-500', 2, 2200, 0, 0, 20, '63340000602'),
    ('HS-01058', 'HS-03-500', 2, 2200, 500, 0, 10, '63340000609'),
    ('HS-01059', 'HS-02-500', 2, 2000, 0, 0, 10, '63340000616'),
    ('HS-01060', 'HS-01-500', 24, 1800, 4320, 0, 10, '63340000623'),
    ('HS-01060', 'HS-02-500', 12, 2000, 2400, 0, 20, '63340000630'),
    ('HS-01061', 'HS-01-500', 2, 1800, 0, 0, 10, '63340000637'),
    ('HS-01061', 'HS-02-500', 2, 2000, 0, 0, 20, '63340000644'),
    ('HS-01061', 'HS-03-500', 2, 2200, 0, 0, 30, '63340000651'),
    ('HS-01062', 'HS-SET-3', 2, 5400, 0, 0, 10, '63340000658'),
    ('HS-01063', 'HS-02-500', 2, 2000, 0, 0, 10, '63340000665'),
    ('HS-01064', 'HS-SET-3', 1, 5400, 0, 0, 10, '63340000672'),
    ('HS-01065', 'HS-SET-3', 1, 5400, 0, 0, 10, '63340000679'),
    ('HS-01066', 'HS-01-500', 2, 1800, 0, 0, 10, '63340000686'),
    ('HS-01067', 'HS-SET-3', 1, 5400, 0, 0, 10, '63340000693'),
    ('HS-01068', 'HS-01-500', 36, 1800, 12960, 0, 10, '63340000700'),
    ('HS-01068', 'HS-02-500', 36, 2000, 14400, 0, 20, '63340000707'),
    ('HS-01068', 'HS-03-500', 24, 2200, 10560, 0, 30, '63340000714'),
    ('HS-01069', 'HS-03-500', 2, 2200, 0, 0, 10, '63340000721'),
    ('HS-01070', 'HS-02-500', 24, 2000, 4800, 0, 10, '63340000728'),
    ('HS-01070', 'HS-03-500', 12, 2200, 2640, 0, 20, '63340000735'),
    ('HS-01071', 'HS-01-500', 1, 1800, 0, 0, 10, '63340000742'),
    ('HS-01072', 'HS-SET-3', 1, 5400, 0, 0, 10, '63340000749'),
    ('HS-01073', 'HS-SET-3', 1, 5400, 0, 0, 10, '63340000756'),
    ('HS-01074', 'HS-03-500', 2, 2200, 0, 0, 10, '63340000763'),
    ('HS-01074', 'HS-01-500', 1, 1800, 0, 0, 20, '63340000770'),
    ('HS-01075', 'HS-02-500', 1, 2000, 0, 0, 10, '63340000777'),
    ('HS-01076', 'HS-01-500', 36, 1800, 12960, 0, 10, '63340000784'),
    ('HS-01076', 'HS-02-500', 36, 2000, 14400, 0, 20, '63340000791'),
    ('HS-01076', 'HS-03-500', 12, 2200, 5280, 0, 30, '63340000798'),
    ('HS-01077', 'HS-02-500', 1, 2000, 0, 0, 10, '63340000805'),
    ('HS-01078', 'HS-01-500', 1, 1800, 0, 0, 10, '63340000812'),
    ('HS-01078', 'HS-02-500', 2, 2000, 0, 0, 20, '63340000819'),
    ('HS-01079', 'HS-SET-3', 1, 5400, 0, 0, 10, '63340000826'),
    ('HS-01079', 'HS-01-500', 2, 1800, 0, 0, 20, '63340000833'),
    ('HS-01080', 'HS-03-500', 1, 2200, 0, 0, 10, '63340000840'),
    ('HS-01081', 'HS-02-500', 24, 2000, 4800, 0, 10, '63340000847'),
    ('HS-01081', 'HS-03-500', 12, 2200, 2640, 0, 20, '63340000854'),
    ('HS-01082', 'HS-02-500', 24, 2000, 4800, 0, 10, '63340000861'),
    ('HS-01082', 'HS-03-500', 12, 2200, 2640, 0, 20, '63340000868'),
    ('HS-01083', 'HS-SET-3', 1, 5400, 0, 0, 10, '63340000875'),
    ('HS-01084', 'HS-01-500', 2, 1800, 0, 0, 10, '63340000882'),
    ('HS-01085', 'HS-02-500', 2, 2000, 0, 0, 10, '63340000889'),
    ('HS-01086', 'HS-SET-3', 1, 5400, 0, 0, 10, '63340000896'),
    ('HS-01087', 'HS-01-500', 2, 1800, 0, 0, 10, '63340000903'),
    ('HS-01087', 'HS-02-500', 1, 2000, 0, 0, 20, '63340000910'),
    ('HS-01087', 'HS-03-500', 1, 2200, 0, 0, 30, '63340000917'),
    ('HS-01088', 'HS-01-500', 24, 1800, 4320, 0, 10, '63340000924'),
    ('HS-01088', 'HS-02-500', 12, 2000, 2400, 0, 20, '63340000931'),
    ('HS-01089', 'HS-02-500', 2, 2000, 0, 0, 10, '63340000938'),
    ('HS-01089', 'HS-03-500', 2, 2200, 0, 0, 20, '63340000945'),
    ('HS-01090', 'HS-02-500', 1, 2000, 0, 0, 10, '63340000952'),
    ('HS-01090', 'HS-03-500', 1, 2200, 0, 0, 20, '63340000959'),
    ('HS-01091', 'HS-01-500', 2, 1800, 0, 0, 10, '63340000966'),
    ('HS-01091', 'HS-02-500', 1, 2000, 0, 0, 20, '63340000973'),
    ('HS-01091', 'HS-03-500', 1, 2200, 0, 0, 30, '63340000980'),
    ('HS-01092', 'HS-01-500', 12, 1800, 2160, 0, 10, '63340000987'),
    ('HS-01092', 'HS-02-500', 12, 2000, 2400, 0, 20, '63340000994'),
    ('HS-01092', 'HS-03-500', 12, 2200, 2640, 0, 30, '63340001001'),
    ('HS-01093', 'HS-SET-3', 1, 5400, 0, 0, 10, '63340001008'),
    ('HS-01094', 'HS-02-500', 2, 2000, 0, 0, 10, '63340001015'),
    ('HS-01094', 'HS-03-500', 1, 2200, 0, 0, 20, '63340001022'),
    ('HS-01094', 'HS-01-500', 1, 1800, 0, 0, 30, '63340001029'),
    ('HS-01095', 'HS-01-500', 24, 1800, 4320, 0, 10, '63340001036'),
    ('HS-01095', 'HS-02-500', 12, 2000, 2400, 0, 20, '63340001043')

  ) as li(order_number, sku, qty, price, disc, refunded_qty, pos, gid_suffix)
  join public.orders ord on ord.order_number = li.order_number
  join public.product_variants v on v.sku = li.sku
  join public.products p on p.id = v.product_id;

insert into public.discount_redemptions (discount_id, order_id, customer_id, amount_cents, redeemed_at)
select o.discount_id, o.id, o.customer_id, o.discount_cents, o.placed_at
  from public.orders o
 where o.discount_id is not null and o.discount_cents > 0;

update public.discounts d
   set used_count = coalesce(r.n, 0)
  from (select discount_id, count(*) n from public.discount_redemptions group by discount_id) r
 where r.discount_id = d.id;

-- Lifetime value is derived from the order book, never typed.
update public.customers c set
  orders_count      = coalesce(agg.cnt, 0),
  total_spent_cents = coalesce(agg.spend, 0),
  first_ordered_at  = agg.first_at,
  last_ordered_at   = agg.last_at
from (
  select o.customer_id,
         count(*) as cnt,
         sum(case when o.financial_status in ('paid','partially_refunded')
                  then o.total_cents - o.refunded_cents else 0 end) as spend,
         min(o.placed_at) as first_at,
         max(o.placed_at) as last_at
    from public.orders o
   where o.customer_id is not null
   group by o.customer_id
) agg
where agg.customer_id = c.id;

-- =============================================================================
-- CARTS  (bearer-token authenticated; the storefront never sees a user id)
-- =============================================================================
insert into public.carts
  (token, customer_id, email, status, subtotal_cents, discount_cents, shipping_cents, tax_cents,
   total_cents, abandoned_at, recovery_email_sent_at, created_at, updated_at,
   provider, shopify_gid, sync_status, synced_at)
values
  ('7f3a91c04b28de65a1f7093c58bd2e4470a6c3159de824bf06a1c73e5d92f8b1', null, null, 'active',
   4000, 0, 990, 651, 4990, null, null, now() - interval '22 minutes', now() - interval '4 minutes',
   'shopify', 'gid://shopify/Cart/c1-7f3a91c04b28de65a1f7093c', 'synced', now() - interval '4 minutes'),
  ('c82d17e5904ab36f1e75c0d3948a2b6f5e19d47c03b8a6215fd0e93c7a4b8016', null, 'nadine.oputa@gmail.com', 'abandoned',
   5400, 0, 990, 833, 6390, now() - interval '3 days' + interval '6 hours', null,
   now() - interval '3 days', now() - interval '3 days' + interval '9 minutes',
   'shopify', 'gid://shopify/Cart/c1-c82d17e5904ab36f1e75c0d3', 'synced', now() - interval '3 days'),
  ('a4e0b9317dc6f28504ba71e3d95c8f062a7b3e14c0d95f8623ab7104ed3f9c25', null, null, 'active',
   6000, 0, 990, 912, 6990, null, null, now() - interval '2 hours', now() - interval '96 minutes',
   'local', null, 'local', null);

insert into public.cart_items (cart_id, currency, product_id, variant_id, quantity, unit_price_cents, created_at)
select ct.id, 'NZD', v.product_id, v.id, ci.qty, ci.price, ct.created_at + interval '2 minutes'
  from (values
    ('7f3a91c04b28de65a1f7093c58bd2e4470a6c3159de824bf06a1c73e5d92f8b1', 'HS-01-500', 1, 1800),
    ('7f3a91c04b28de65a1f7093c58bd2e4470a6c3159de824bf06a1c73e5d92f8b1', 'HS-02-500', 1, 2000),
    ('c82d17e5904ab36f1e75c0d3948a2b6f5e19d47c03b8a6215fd0e93c7a4b8016', 'HS-SET-3',  1, 5400),
    ('a4e0b9317dc6f28504ba71e3d95c8f062a7b3e14c0d95f8623ab7104ed3f9c25', 'HS-01-500', 1, 1800),
    ('a4e0b9317dc6f28504ba71e3d95c8f062a7b3e14c0d95f8623ab7104ed3f9c25', 'HS-02-500', 1, 2000),
    ('a4e0b9317dc6f28504ba71e3d95c8f062a7b3e14c0d95f8623ab7104ed3f9c25', 'HS-03-500', 1, 2200)
  ) as ci(token, sku, qty, price)
  join public.carts ct on ct.token = ci.token
  join public.product_variants v on v.sku = ci.sku;

-- =============================================================================
-- AGENT RUNS
-- =============================================================================
insert into public.agent_runs
  (agent_id, trigger, status, goal, outcome, error, queued_at, started_at, finished_at,
   input_tokens, output_tokens, cost_micros, tool_call_count, context)
select a.id, r.trigger::public.agent_run_trigger, r.status::public.agent_run_status, r.goal, r.outcome, r.error,
       now() - r.queued, case when r.started is null then null else now() - r.started end,
       case when r.finished is null then null else now() - r.finished end,
       r.in_tok, r.out_tok, r.cost, r.calls, r.context::jsonb
  from (values
    ('mirror', 'schedule', 'succeeded', 'Drain the Shopify webhook queue and reconcile any drifted rows.',
     'Processed 14 webhook events. One orders/updated arrived out of order and was discarded against a newer shopify_updated_at. No drift.',
     null, interval '6 minutes', interval '6 minutes', interval '5 minutes', 8420, 610, 41200, 6,
     '{"events_processed":14,"stale_discarded":1,"resources":["order","inventory_level"]}'),
    ('concierge', 'schedule', 'succeeded', 'Sweep new reviews and unanswered customer email since the last run.',
     'Three new reviews. Two are five stars and were replied to from the approved template. One is three stars about the smoke heat level — a reply is drafted and waiting on approval.',
     null, interval '52 minutes', interval '52 minutes', interval '49 minutes', 21440, 2180, 168400, 9,
     '{"reviews_seen":3,"replies_drafted":1,"escalations":0}'),
    -- These two are inserted as 'running' and flipped to 'awaiting_approval'
    -- below, once the approval they are blocked on exists: the check constraint
    -- will not let a blocked run exist without one, which is the point of it.
    ('brine-ops', 'schedule', 'running', 'Nightly stock sweep against reorder points and the forward production plan.',
     null, null, interval '4 hours', interval '4 hours', null, 18900, 3410, 214600, 7,
     '{"below_reorder":["BOTTLE_500"],"batches_expiring_60d":1,"po_drafted":"bottles"}'),
    ('social', 'schedule', 'running', 'Draft this fortnight''s content calendar and schedule against the brand rules.',
     null, null, interval '19 hours', interval '19 hours', null, 32100, 5640, 402800, 11,
     '{"drafts":4,"brand_rule_failures":1,"failed_rule":"no-health-claims"}'),
    ('ledger', 'schedule', 'succeeded', 'Recalculate unit cost from the last three batches per SKU and check margin.',
     'No 03 SMOKE unit cost has moved from 875c to 920c across the last three batches, mostly manzano. Margin at NZ$22.00 is now 58.2%, below the 60% floor. A price change to NZ$23.50 is queued for approval.',
     null, interval '2 days 3 hours', interval '2 days 3 hours', interval '2 days 2 hours 47 minutes',
     44800, 6120, 812400, 12, '{"skus_reviewed":4,"below_margin_floor":["HS-03-500"]}'),
    ('scout', 'schedule', 'succeeded', 'Build the Wellington trade prospect list and draft the first approach.',
     'Twelve venues shortlisted from the Wellington cocktail-bar set. One outreach email drafted, approved and sent. Two replies so far.',
     null, interval '5 days', interval '5 days', interval '5 days' + interval '-14 minutes',
     38200, 7440, 561000, 8, '{"prospects":12,"emails_drafted":1,"replies":2}'),
    ('mirror', 'webhook', 'failed', 'Process orders/create for a Shopify order with a line item we have no variant for.',
     null, 'Variant gid://shopify/ProductVariant/48231847723386 is not in the mirror. The order was parked in webhook_events for replay after the next product backfill.',
     interval '2 days 6 hours', interval '2 days 6 hours', interval '2 days 6 hours' + interval '-40 seconds',
     3100, 210, 14800, 2, '{"topic":"orders/create","missing_variant":true}'),
    ('brine-ops', 'manual', 'succeeded', 'Cost the No 01 HOUSE batch that came off the line and release it to stock.',
     'Batch costed at 600c a unit against a 620c standard. QA passed at pH 3.29. Released 660 units to Sale Street.',
     null, interval '26 days', interval '26 days', interval '26 days' + interval '-22 minutes',
     15600, 2890, 141200, 5, '{"batch":"no-01-house","units":660,"unit_cost_cents":600}'),
    ('concierge', 'manual', 'succeeded', 'Trace the cracked-bottle complaint back to a batch and decide whether it is a fault.',
     'Traced to one batch via order_item_batches. Both other orders from that batch were delivered without incident, and the outer carton was crushed, so this reads as carrier damage rather than a seam fault. Full refund and a free replacement.',
     null, interval '19 days', interval '19 days', interval '19 days' + interval '-9 minutes',
     12400, 1980, 98600, 6, '{"verdict":"carrier_damage","batch_recall":false}'),
    ('social', 'schedule', 'succeeded', 'Pull last fortnight''s post metrics and report what worked.',
     'The three-up line shot outperformed everything else at 4.1% engagement. Bar-pass video is still the best for saves. Nothing tripped a brand rule.',
     null, interval '4 days', interval '4 days', interval '4 days' + interval '-6 minutes',
     19800, 2140, 176400, 4, '{"posts_reviewed":8,"best_format":"three_up"}'),
    ('mirror', 'schedule', 'running', 'Nightly full reconciliation of products, variants and inventory against Shopify.',
     null, null, interval '3 minutes', interval '3 minutes', null, 2100, 180, 9800, 1,
     '{"phase":"products","page":2}')
  ) as r(agent_slug, trigger, status, goal, outcome, error, queued, started, finished,
         in_tok, out_tok, cost, calls, context)
  join public.agents a on a.slug = r.agent_slug;

-- =============================================================================
-- APPROVALS — the founder's inbox. One table, every queue.
-- subject_id is filled in further down, once the rows being approved exist.
-- =============================================================================
insert into public.approvals
  (subject_type, subject_table, title, summary, rationale, payload, preview, risk,
   amount_cents, status, requested_by_agent_id, requested_by_run_id, requested_at, expires_at,
   decided_by, decided_at, decision_note, applied_at, applied_result)
select
  ap.subject_type::public.approval_subject, ap.subject_table, ap.title, ap.summary, ap.rationale,
  ap.payload::jsonb, ap.preview::jsonb, ap.risk::public.approval_risk, ap.amount,
  ap.status::public.approval_status, a.id, run.id,
  now() - ap.requested, case when ap.expires is null then null else now() - ap.expires end,
  case when ap.decided is null then null else op.id end,
  case when ap.decided is null then null else now() - ap.decided end,
  ap.decision_note,
  case when ap.applied is null then null else now() - ap.applied end,
  ap.applied_result::jsonb
from (values
  ('social_post', 'social_posts',
   'Instagram: No 03 SMOKE back on the shelf Thursday',
   'A single still of the three-up line shot with a caption announcing the restock, scheduled for Thursday 5pm.',
   'No 03 has been out of stock for nine days and it is the second most asked-about thing in the inbox. Batch D lands Wednesday.',
   '{"action":"schedule","platform":"instagram","scheduled_for":"+2 days 17:00 Pacific/Auckland","caption_length":214}',
   '{"caption":"No 03 SMOKE is back on Thursday. Chipotle and manzano, manuka-smoked salt, the heat arrives about three seconds late. Batch D, bottled Tuesday.","asset":"three-up.jpg"}',
   'low', null, 'pending', 'social', 'Draft this fortnight''s content calendar and schedule against the brand rules.',
   interval '19 hours', interval '-29 hours', null, null, null, null),

  ('purchase_order', 'purchase_orders',
   'Reorder 2,400 x 500ml bottles from Onehunga Glass and Closures',
   'Bottle stock is 1,180 against a reorder point of 1,200. At the current run rate that is about nineteen days of cover and the lead time is fourteen.',
   'Bottles are the only input with a lead time longer than a production cycle. Running out stops the line entirely, and the last two orders both slipped by three days.',
   '{"action":"create_purchase_order","supplier":"GLASSCO","lines":[{"ingredient":"BOTTLE_500","quantity":2400,"unit_cost_cents":118}],"freight_cents":8500}',
   '{"supplier":"Onehunga Glass and Closures","total":"NZ$2,917.00","expected":"14 days","cover_after":"about 8 weeks"}',
   'high', 291700, 'pending', 'brine-ops', 'Nightly stock sweep against reorder points and the forward production plan.',
   interval '4 hours', interval '-44 hours', null, null, null, null),

  ('price_change', 'product_variants',
   'Lift No 03 SMOKE from NZ$22.00 to NZ$23.50',
   'Unit cost has moved from 875c to 920c across the last three batches. At NZ$22.00 the margin is 58.2%, under the 60% floor. NZ$23.50 puts it back at 60.9%.',
   'Manzano chilli is up 22% since February and the manuka-smoked salt went up with it. The other two SKUs are unaffected.',
   '{"action":"update_variant_price","sku":"HS-03-500","from_cents":2200,"to_cents":2350,"push_to_shopify":true}',
   '{"sku":"HS-03-500","current":"NZ$22.00","proposed":"NZ$23.50","margin_before":"58.2%","margin_after":"60.9%"}',
   'medium', 150, 'pending', 'ledger', 'Recalculate unit cost from the last three batches per SKU and check margin.',
   interval '2 days 2 hours', interval '-22 hours', null, null, null, null),

  ('review_reply', 'reviews',
   'Reply to a three-star review about the No 03 heat level',
   'A customer found No 03 hotter than expected. The draft acknowledges it, names the batch, and points them at No 01 rather than arguing.',
   'The heat does vary by manzano pick. Saying so is better than a template apology, and the batch code makes it checkable.',
   '{"action":"publish_review_reply","review_rating":3,"reply_length":186}',
   '{"reply":"That batch did run hot — the manzano pick was hotter than the one before it, which is the honest answer. If you want the same brine without the heat, No 01 HOUSE is the same base. Email us and we will sort you out."}',
   'low', null, 'pending', 'concierge', 'Sweep new reviews and unanswered customer email since the last run.',
   interval '49 minutes', interval '-47 hours', null, null, null, null),

  ('social_post', 'social_posts',
   'Instagram: the Dirty Martini build at Brass and Bitters',
   'A 22-second vertical of Kiri building a Dirty Martini with No 02 on the pass.',
   'Kiri agreed to be filmed and the venue is our biggest trade account. This is the strongest trade proof we have.',
   '{"action":"publish","platform":"instagram","asset":"dirty-martini-build.mp4"}',
   '{"caption":"Kiri at Brass and Bitters, building the house Dirty with No 02. Thirty martinis to a bottle and it does not cloud the glass."}',
   'low', null, 'approved', 'social', 'Draft this fortnight''s content calendar and schedule against the brand rules.',
   interval '12 days', null, interval '12 days' + interval '-3 hours', 'Yes. Ask Kiri before it goes up.',
   interval '11 days', '{"published":true,"external_post_id":"18042117993204411"}'),

  ('email_outreach', 'email_sends',
   'Cold approach to twelve Wellington cocktail bars',
   'One email, twelve recipients, offering a sample pack of all three and a trade price list. No attachment, no follow-up scheduled without a second approval.',
   'Wellington is 18% of retail orders and zero of trade. Twelve venues is small enough to handle by hand if they all say yes.',
   '{"action":"send_outreach","recipients":12,"template":"trade-intro-v2","follow_up":"requires_separate_approval"}',
   '{"subject":"A brine made for the Dirty, from Auckland","preview":"Twelve by 500ml, 18-month shelf life, 48-hour freight to Wellington."}',
   'medium', null, 'approved', 'scout', 'Build the Wellington trade prospect list and draft the first approach.',
   interval '5 days', null, interval '5 days' + interval '-2 hours', 'Send it. Do not follow up without asking me.',
   interval '5 days' + interval '-2 hours', '{"sent":12,"bounced":0,"replies":2}'),

  ('discount', 'discounts',
   '20% off sitewide for Labour Weekend',
   'A three-day sitewide code to lift a quiet weekend.',
   'Last Labour Weekend was the slowest three days of the quarter.',
   '{"action":"create_discount","code":"LABOUR20","value_bp":2000,"scope":"order"}',
   '{"code":"LABOUR20","value":"20%","window":"3 days","forecast_orders":31,"forecast_margin_cents":-42000}',
   'medium', 42000, 'rejected', 'ledger', 'Recalculate unit cost from the last three batches per SKU and check margin.',
   interval '9 days', null, interval '9 days' + interval '-5 hours',
   'No. We have never discounted sitewide and I do not want to teach people to wait for it. Do a free-freight code instead.',
   null, null),

  ('batch_release', 'batches',
   'Release No 01 HOUSE batch E to stock',
   '660 units, QA passed at pH 3.29 and 4.6% salinity, costed at 600c a unit against a 620c standard.',
   'Everything is inside spec and the bottle stock cannot hold it much longer.',
   '{"action":"release_batch","units":660,"location":"SALE_ST","ph":3.29,"salinity_pct":4.6}',
   '{"batch":"No 01 HOUSE batch E","units":660,"unit_cost":"NZ$6.00","expires_in_days":540}',
   'high', null, 'approved', 'brine-ops', 'Cost the No 01 HOUSE batch that came off the line and release it to stock.',
   interval '26 days', null, interval '26 days' + interval '-25 minutes', 'Released. Print the labels tonight.',
   interval '26 days' + interval '-30 minutes', '{"released":true,"units_to_stock":660}')
) as ap(subject_type, subject_table, title, summary, rationale, payload, preview, risk, amount,
        status, agent_slug, run_goal, requested, expires, decided, decision_note, applied, applied_result)
join public.agents a on a.slug = ap.agent_slug
join lateral (
  select r.id from public.agent_runs r
   where r.agent_id = a.id and r.goal = ap.run_goal
   order by r.queued_at desc limit 1
) run on true
cross join lateral (select id from public.operators where email = 'nadia@halfsour.co.nz') op;

-- The two runs that stopped and asked now point at what they are waiting on,
-- and only now can legally say they are awaiting approval.
update public.agent_runs r
   set status = 'awaiting_approval', blocking_approval_id = ap.id
  from public.approvals ap
 where ap.requested_by_run_id = r.id
   and ap.status = 'pending'
   and r.status = 'running'
   and r.finished_at is null;

-- =============================================================================
-- PRODUCTION — suppliers and ingredients
-- =============================================================================
insert into public.suppliers
  (code, name, contact_name, email, phone, website, address_line, suburb, city, region, postcode,
   status, payment_terms, lead_time_days, minimum_order_cents, nzbn, gst_number,
   is_organic_certified, food_safety_programme, food_safety_expires_on, rating, notes)
values
  ('PUKEKOHE', 'Pukekohe Market Gardens Co-operative', 'Manu Tipene', 'orders@pukekohegardens.co.nz', '+64 9 238 4410', 'https://pukekohegardens.co.nz', '188 Buckland Road', null, 'Pukekohe', 'Auckland', '2120', 'active', '20th of the month following', 3, 15000, '9429037718204', '076-118-442', false, 'NZGAP certified', (current_date + 214), 5, 'Telegraph cucumbers, garlic and manzano chillies. Cut to order Tuesday and Friday. Quality has never dropped.'),
  ('BOPSPICE', 'Bay of Plenty Spice Merchants', 'Ari Devlin', 'ari@bopspice.co.nz', '+64 7 573 6640', 'https://bopspice.co.nz', '7 Jellicoe Street', null, 'Te Puke', 'Bay of Plenty', '3119', 'active', 'Net 14', 5, 12000, '9429042230866', '129-007-513', true, 'Food Control Plan — MPI registered', (current_date + 402), 5, 'Whole spice only, nothing ground. A batch certificate comes with every delivery. Chipotle is imported and lands quarterly.'),
  ('MEDITER', 'Mediterranean Pantry Imports', 'Yiannis Petrou', 'trade@medpantry.co.nz', '+64 9 828 1170', null, '112 Rosebank Road', 'Avondale', 'Auckland', 'Auckland', '1026', 'active', 'Net 30', 12, 30000, '9429040551739', '093-770-215', false, 'Food Control Plan — MPI registered', (current_date + 51), 4, 'Cornichons, Spanish manzanilla olives and lemon peel. Everything is containerised, so a missed order is a two-month hole. Their control plan expires in seven weeks — Marlow is chasing.'),
  ('GRASSMERE', 'Grassmere Salt Works', 'Bridget Coates', 'sales@grassmeresalt.co.nz', '+64 3 575 7188', 'https://grassmeresalt.co.nz', '2140 State Highway 1', 'Lake Grassmere', 'Seddon', 'Marlborough', '7285', 'active', 'Net 30', 7, 25000, '9429030117744', '051-204-889', false, 'Food Control Plan — MPI registered', (current_date + 331), 5, 'Solar-evaporated sea salt in 25kg sacks, plus the manuka cold-smoked salt for No 03. Price locked until March.'),
  ('CANTVIN', 'Canterbury Vinegar Works', 'Rachel Fenn', 'accounts@cantvin.co.nz', '+64 3 344 9012', null, '19 Waterloo Road', 'Hornby', 'Christchurch', 'Canterbury', '8042', 'active', 'Net 30', 5, 20000, '9429035581093', '088-441-206', false, 'Food Control Plan — MPI registered', (current_date + 158), 4, 'White vinegar at 10% acetic in 200L drums, plus citric acid and cane sugar.'),
  ('GLASSCO', 'Onehunga Glass and Closures', 'Peter Yeung', 'sales@onehungaglass.co.nz', '+64 9 622 0180', 'https://onehungaglass.co.nz', '9 Victoria Street', 'Onehunga', 'Auckland', 'Auckland', '1061', 'active', 'Net 30', 14, 50000, '9429031104822', '042-116-395', false, null, null, 3, 'Flint glass and caps. Lead time crept from ten days to fourteen this year, and the last two orders both slipped another three. Plan around it.'),
  ('INKPRESS', 'Penrose Ink and Press', 'Delia Faraimo', 'jobs@penroseink.co.nz', '+64 9 525 7788', 'https://penroseink.co.nz', '58 Station Road', 'Penrose', 'Auckland', 'Auckland', '1061', 'active', 'Net 20', 8, 18000, '9429043309681', '118-552-004', false, null, null, 5, 'Wrap labels on uncoated stock, die-cut. They hold the plates, so a reprint is fast. Batch codes are overprinted by us at bottling, never by them.'),
  -- PLACEHOLDER. Invented, like every other row in this file, so the ops agent
  -- has something to reorder No 04's leaf against and the supply chain is not a
  -- hole in the demo. Unlike the other rows, this one names a thing the finished
  -- product is MADE OF, so it carries a rule the others do not:
  --
  --   Nothing here may reach a consumer surface until a real relationship
  --   exists. A place of origin for a food ingredient is a representation under
  --   Fair Trading Act s 13(j), and s 13(j) does not care that the row was
  --   seeded for a demo. `region` is deliberately left null for that reason —
  --   there is no district on this row to leak into a label or a product page.
  --
  -- Replace wholesale when the real grower is signed. Nothing else changes: the
  -- ingredient rows point at it by code.
  ('LEAFCO', 'Kaimai Leaf Company (PLACEHOLDER — not a real supplier)', 'TODO: verify with supplier', 'placeholder@example.invalid', null, null, 'TODO: verify with supplier', null, 'TODO: verify with supplier', null, null, 'active', 'TODO: verify with supplier', 14, 0, null, null, false, null, null, null, 'PLACEHOLDER ROW — invented for the demo, no relationship exists. Kawakawa leaf and bull kelp. Everything about this supplier is unverified: the name, the terms, the lead time, and above all the region, which is left null on purpose. Do not publish any of it. Rename to the real grower when one is signed and delete this note.');

insert into public.ingredients
  (code, name, category, unit, description, allergens, is_organic, storage, shelf_life_days,
   standard_cost_cents, stock_on_hand, reorder_point, reorder_quantity, preferred_supplier_id, notes)
select i.code, i.name, i.cat::public.ingredient_category, i.unit::public.unit_of_measure, i.descr,
       i.allergens::text[], i.organic, i.storage::public.storage_requirement, i.shelf,
       i.cost, i.stock, i.rp, i.rq, s.id, i.notes
  from (values
    ('CUCUMBER',   'Telegraph cucumbers',           'produce',   'kg', 'Grade 1 telegraph cucumbers, 300-400g each.',            '{}',          false, 'chilled',  14,   480, 142.000,  60.000, 240.000, 'PUKEKOHE',  'Cut to order. Anything more than five days off the vine goes soft in the brine.'),
    ('CORNICHON',  'Cornichon cucumbers',           'produce',   'kg', 'Small pickling cucumbers, 40-60mm.',                      '{}',          false, 'chilled',  10,  1150,  38.000,  20.000,  80.000, 'PUKEKOHE',  'Grown to order for No 02. Two rows at Pukekohe, picked small.'),
    ('OLIVE_MANZ', 'Spanish manzanilla olives',     'produce',   'kg', 'Whole green manzanilla in 10kg pails, brine packed.',     '{sulphites}', false, 'ambient', 720,  1980,  62.000,  30.000, 120.000, 'MEDITER',   'Contains sulphites, declared on the No 02 label. Two-month lead if a container is missed.'),
    ('LEMON_PEEL', 'Preserved lemon peel',          'produce',   'kg', 'Wide strips, salt-cured, no pith.',                       '{}',          false, 'chilled',  90,  2650,  11.400,   6.000,  24.000, 'MEDITER',   null),
    -- The two No 04 botanicals have NO preferred supplier and NO row in
    -- ingredient_suppliers, because there is no supplier. That is not an
    -- omission to be tidied up later: it is the constraint, written where the
    -- ops agent reads it. reorder_point is 0 on both, so neither can surface in
    -- the morning reorder queue and become a purchase order nobody can fill.
    ('KAWAKAWA',   'Kawakawa leaf',                 'herb',      'kg', 'Whole fresh leaf, stems off, picked to order.',            '{}',          false, 'chilled',   5,  9800,   1.400,   2.000,   6.000, 'LEAFCO',    'SUPPLIER IS A PLACEHOLDER — see the LEAFCO row. Pointed at it so the reorder queue works and No 04 has a supply chain in the demo; the cost is still an estimate off hand-picked lots, not a quoted price. Nothing about the source may reach a label or a product page until the relationship is real — Fair Trading Act s 13(j). This ingredient is the whole reason No 04 is supply-limited.'),
    ('KELP',       'Bull kelp blade',               'produce',   'kg', 'Storm-cast blade, rinsed, dried and cut.',                 '{}',          false, 'dry',     540,  4400,   3.200,   1.500,   6.000, 'LEAFCO',    'SUPPLIER IS A PLACEHOLDER — see the LEAFCO row. Gathered alongside the kawakawa; cost is an estimate. Do not publish an origin for this either.'),
    ('DILL_FRESH', 'Fresh dill heads',              'herb',      'kg', 'Whole flowering dill heads, stems attached.',              '{}',          true,  'chilled',   7,  2600,   5.100,   8.000,  24.000, 'PUKEKOHE',  'Supply tightens from late August. This is the one that stops No 01.'),
    ('GARLIC',     'Garlic bulbs',                  'produce',   'kg', 'New Zealand grown, cured.',                               '{}',          false, 'ambient', null,  1250,  13.200,   6.000,  20.000, 'PUKEKOHE',  null),
    ('MANZANO',    'Manzano chilli',                'produce',   'kg', 'Fresh manzano, roughly 20,000 SHU.',                      '{}',          false, 'chilled',  10,  3100,   7.800,   6.000,  24.000, 'PUKEKOHE',  'Heat varies a lot by pick. Every No 03 batch gets tasted before the chilli goes in. Up 22% since February.'),
    ('CHIPOTLE',   'Chipotle morita',               'spice',     'kg', 'Whole smoked jalapeno, morita grade.',                    '{}',          false, 'dry',     720,  5400,   4.600,   3.000,  12.000, 'BOPSPICE',  'Imported, lands quarterly. Order two quarters ahead.'),
    ('PEPPER_BLK', 'Black peppercorn',              'spice',     'kg', 'Whole Tellicherry.',                                      '{}',          false, 'dry',     720,  3900,   2.900,   1.500,   5.000, 'BOPSPICE',  null),
    ('PEPPER_WHT', 'White peppercorn',              'spice',     'kg', 'Whole Muntok.',                                           '{}',          false, 'dry',     720,  4300,   1.800,   1.200,   4.000, 'BOPSPICE',  'No 02 only. Black pepper muddies the colour.'),
    ('CORIAND',    'Coriander seed',                'spice',     'kg', 'Whole, unroasted.',                                       '{}',          false, 'dry',     720,  2100,   3.100,   2.000,   6.000, 'BOPSPICE',  null),
    ('MUSTARD',    'Yellow mustard seed',           'spice',     'kg', 'Whole yellow.',                                           '{mustard}',   false, 'dry',     720,  1450,   4.700,   3.000,   9.000, 'BOPSPICE',  'Declared allergen. Appears on every label that uses it.'),
    ('BAYLEAF',    'Bay leaf',                      'herb',      'kg', 'Whole dried leaf.',                                       '{}',          false, 'dry',     540,  5200,   0.900,   0.500,   2.000, 'BOPSPICE',  null),
    ('SALT_SEA',   'Marlborough sea salt',          'salt',      'kg', 'Solar-evaporated, medium flake, 25kg sacks.',              '{}',          false, 'dry',    1800,   640,  78.000,  40.000, 120.000, 'GRASSMERE', null),
    ('SALT_SMOKE', 'Manuka cold-smoked sea salt',   'salt',      'kg', 'Marlborough flake, cold-smoked over manuka for 14 hours.', '{}',          false, 'dry',     900,  2250,  16.400,  10.000,  40.000, 'GRASSMERE', 'No 03 only. Smoked in small runs, so order early.'),
    ('VIN_WHITE',  'White vinegar 10% acetic',      'acid',      'l',  '200L food-grade drums.',                                  '{}',          false, 'ambient', null,   310, 204.000, 100.000, 400.000, 'CANTVIN',   null),
    ('WATER_FILT', 'Filtered water',                'water',     'l',  'Reverse osmosis, made on site.',                          '{}',          false, 'ambient', null,     2,   0.000,   0.000,   0.000, null,        'Costed at the metered rate for batch costing only.'),
    ('CITRIC',     'Citric acid',                   'acid',      'kg', 'Anhydrous, food grade.',                                  '{}',          false, 'dry',     900,   880,   5.200,   3.000,  10.000, 'CANTVIN',   null),
    ('SUGAR_CANE', 'Raw cane sugar',                'sweetener', 'kg', 'Unrefined, 25kg sacks.',                                  '{}',          false, 'dry',     720,   290,  19.000,  15.000,  50.000, 'CANTVIN',   null),
    ('BOTTLE_500', '500ml flint glass bottle',      'packaging', 'ea', 'Flint glass, 38mm neck.',                                 '{}',          false, 'ambient', null,   118,1180.000,1200.000,2400.000, 'GLASSCO',   'BELOW REORDER POINT. Fourteen-day lead time and the last two orders slipped three days each. Nothing else stops the line the way this does.'),
    ('CAP_38',     '38mm tamper-evident cap',       'packaging', 'ea', 'Tamper band, four colourways.',                          '{}',          false, 'ambient', null,    22,4400.000,2500.000,7500.000, 'GLASSCO',   'Brine green for No 01, olive for No 02, ember for No 03, dill for No 04.'),
    ('LABEL_500',  '500ml wrap label',              'label',     'ea', 'Uncoated stock, die-cut, batch code overprinted by us.',   '{}',          false, 'ambient', null,    31,3250.000,1500.000,4500.000, 'INKPRESS',  'Never pre-print the batch code. It goes on at bottling.'),
    ('BOX_SET3',   'The Full Set rigid box',        'packaging', 'ea', 'Rigid three-bottle box with moulded pulp insert.',         '{}',          false, 'ambient', null,   420, 210.000, 100.000, 300.000, 'INKPRESS',  null),
    ('CARD_SET3',  'The Full Set recipe cards',     'label',     'ea', 'Three-card set: Dirty Martini, Bloody Mary, pickleback.',  '{}',          false, 'ambient', null,    38, 640.000, 300.000, 900.000, 'INKPRESS',  null)
  ) as i(code, name, cat, unit, descr, allergens, organic, storage, shelf, cost, stock, rp, rq, supplier_code, notes)
  left join public.suppliers s on s.code = i.supplier_code;

insert into public.ingredient_suppliers
  (ingredient_id, supplier_id, supplier_sku, unit, pack_size, pack_cost_cents, lead_time_days,
   minimum_quantity, is_preferred, last_quoted_at)
select i.id, s.id, x.sku, x.unit::public.unit_of_measure, x.pack, x.cost, x.lead, x.minq, x.preferred,
       now() - x.quoted_ago
  from (values
    ('CUCUMBER',  'PUKEKOHE', 'PKG-CUC-TEL',   'kg',   20.000,   9600,  3,  20.000, true,  interval '3 weeks'),
    ('CORNICHON', 'PUKEKOHE', 'PKG-CORN-SM',   'kg',   10.000,  11500,  5,  10.000, true,  interval '4 weeks'),
    ('OLIVE_MANZ','MEDITER',  'MPI-MANZ-10',   'kg',   10.000,  19800, 12,  20.000, true,  interval '3 months'),
    ('LEMON_PEEL','MEDITER',  'MPI-LEMPEEL',   'kg',    2.000,   5300, 12,   4.000, true,  interval '3 months'),
    ('DILL_FRESH','PUKEKOHE', 'PKG-DILL-HD',   'kg',    2.000,   5200,  3,   2.000, true,  interval '2 weeks'),
    ('GARLIC',    'PUKEKOHE', 'PKG-GAR',       'kg',   10.000,  12500,  3,  10.000, true,  interval '3 weeks'),
    ('MANZANO',   'PUKEKOHE', 'PKG-MANZ',      'kg',    5.000,  15500,  4,   5.000, true,  interval '2 weeks'),
    ('CHIPOTLE',  'BOPSPICE', 'BOP-CHIPMOR',   'kg',    5.000,  27000, 30,   5.000, true,  interval '7 weeks'),
    ('PEPPER_BLK','BOPSPICE', 'BOP-PEPBLK',    'kg',    5.000,  19500,  5,   5.000, true,  interval '5 weeks'),
    ('PEPPER_WHT','BOPSPICE', 'BOP-PEPWHT',    'kg',    5.000,  21500,  5,   5.000, true,  interval '5 weeks'),
    ('CORIAND',   'BOPSPICE', 'BOP-CORSD',     'kg',    5.000,  10500,  5,   5.000, true,  interval '5 weeks'),
    ('MUSTARD',   'BOPSPICE', 'BOP-MUSTYEL',   'kg',    5.000,   7250,  5,   5.000, true,  interval '5 weeks'),
    ('BAYLEAF',   'BOPSPICE', 'BOP-BAY',       'kg',    1.000,   5200,  5,   1.000, true,  interval '5 weeks'),
    ('SALT_SEA',  'GRASSMERE','GSW-MED-25',    'kg',   25.000,  16000,  7,  25.000, true,  interval '4 months'),
    ('SALT_SMOKE','GRASSMERE','GSW-MANUKA-10', 'kg',   10.000,  22500, 14,  10.000, true,  interval '9 weeks'),
    ('VIN_WHITE', 'CANTVIN',  'CVW-AC10-200',  'l',   200.000,  62000,  5, 200.000, true,  interval '7 weeks'),
    ('CITRIC',    'CANTVIN',  'CVW-CITRIC',    'kg',   10.000,   8800,  5,  10.000, true,  interval '7 weeks'),
    ('SUGAR_CANE','CANTVIN',  'CVW-SUGRAW25',  'kg',   25.000,   7250,  5,  25.000, true,  interval '7 weeks'),
    ('BOTTLE_500','GLASSCO',  'OGC-500FL-38',  'ea', 1200.000, 141600, 14,1200.000, true,  interval '5 weeks'),
    ('CAP_38',    'GLASSCO',  'OGC-CAP38',     'ea', 2500.000,  55000, 14,2500.000, true,  interval '5 weeks'),
    ('LABEL_500', 'INKPRESS', 'PIP-LBL500',    'ea', 1500.000,  46500,  8,1500.000, true,  interval '6 weeks'),
    ('BOX_SET3',  'INKPRESS', 'PIP-BOX3',      'ea',  100.000,  42000,  8, 100.000, true,  interval '10 weeks'),
    ('CARD_SET3', 'INKPRESS', 'PIP-CARD3',     'ea',  300.000,  11400,  8, 300.000, true,  interval '10 weeks')
  ) as x(ing, sup, sku, unit, pack, cost, lead, minq, preferred, quoted_ago)
  join public.ingredients i on i.code = x.ing
  join public.suppliers s on s.code = x.sup;

-- =============================================================================
-- RECIPES — versioned. A change is a new row, never an edit, because batches
-- point at the exact version they were made from.
-- =============================================================================
insert into public.recipes
  (slug, version, name, description, product_id, status, batch_size_litres, expected_yield_units,
   target_ph, target_salinity_pct, ferment_days, method, equipment, allergen_statement,
   estimated_cost_cents, change_note, is_current, approved_by, approved_at)
select r.slug, r.version, r.name, r.descr, p.id, r.status::public.recipe_status,
       r.size_l, r.yield, r.ph, r.salinity, r.ferment, r.method, r.equipment::text[], r.allergen,
       r.cost, r.change_note, r.is_current,
       case when r.status = 'draft' then null else o.id end,
       case when r.status = 'draft' then null else now() - r.approved_ago end
  from (values
    ('house-brine', 1, 'No 01 HOUSE v1', 'The original. 4.2% salt, ten days, no garlic.', 'no-01-house', 'retired',
     300.00, 560, 3.40, 4.20, 10,
     'Rack cucumbers, cover with 4.2% brine, hold at 18C for ten days, strain twice through muslin, bottle cold.',
     '{"300L fermenter","muslin","gravity filler"}', 'No declared allergens.', 62000, null, false, interval '15 months'),

    ('house-brine', 2, 'No 01 HOUSE v2', 'Garlic in, salt up to 4.6%, twelve days.', 'no-01-house', 'retired',
     400.00, 760, 3.35, 4.60, 12,
     'As v1 with 0.9% crushed garlic added at day two. Salt lifted to 4.6% after three batches came in soft. Twelve days at 18C.',
     '{"400L fermenter","muslin","gravity filler"}', 'No declared allergens.', 81000,
     'Three v1 batches finished above pH 3.5 and tasted flat. Lifted salt to 4.6%, added garlic at day two and extended to twelve days.',
     false, interval '10 months'),

    ('house-brine', 3, 'No 01 HOUSE v3', 'Current. Mustard seed in, second strain through a 5 micron pad.', 'no-01-house', 'active',
     330.00, 640, 3.30, 4.60, 12,
     'Rack 130kg cucumbers in the 400L fermenter. Cover with 4.6% brine. Dill heads, crushed garlic, cracked black peppercorn, yellow mustard seed and bay at day two. Hold 18C for twelve days. Strain through muslin, then a 5 micron pad. Chill to 4C, fill 500ml, cap, overprint the batch code on the neck label.',
     '{"400L fermenter","muslin","5 micron pad","plate chiller","gravity filler","code printer"}',
     'Contains mustard. Gluten free. Suitable for vegans.', 92000,
     'Added yellow mustard seed for length on the finish and a 5 micron second strain to stop the faint haze that showed up after six weeks in the bottle. Mustard is now a declared allergen on the label.',
     true, interval '6 months'),

    ('dirty-brine', 1, 'No 02 DIRTY v1', 'Cornichon and olive together from day one.', 'no-02-dirty', 'retired',
     200.00, 380, 3.30, 5.20, 14,
     'Cornichons and manzanilla olives brined together at 5.2% from day one with white peppercorn and lemon peel. Fourteen days.',
     '{"200L fermenter","muslin","gravity filler"}', 'Contains sulphites. Gluten free. Suitable for vegans.', 118000,
     null, false, interval '7 months'),

    ('dirty-brine', 2, 'No 02 DIRTY v2', 'Current. Olives rested separately, then blended at day seven.', 'no-02-dirty', 'active',
     220.00, 420, 3.28, 5.20, 14,
     'Brine 70kg cornichons at 5.2% with white peppercorn and coriander. Separately rest 24kg drained manzanilla olives in their own 5.2% brine with the lemon peel. Blend the two at day seven, 70:30 by volume, and hold another seven days. Strain through muslin then a 5 micron pad. Chill, fill 500ml.',
     '{"200L fermenter","100L rest tank","muslin","5 micron pad","plate chiller","gravity filler","code printer"}',
     'Contains sulphites. Gluten free. Suitable for vegans.', 132000,
     'Olives in from day one dominated everything and the brine went cloudy. Resting them separately and blending at day seven keeps the cornichon on top and the glass clear, which is the whole point of a martini brine.',
     true, interval '4 months'),

    ('smoke-brine', 1, 'No 03 SMOKE v1', 'Current. Chipotle and manzano at day four over manuka-smoked salt.', 'no-03-smoke', 'active',
     180.00, 340, 3.32, 4.80, 12,
     'Rack 68kg cucumbers. Brine at 4.8%, half Marlborough flake and half manuka cold-smoked salt. Whole chipotle and split manzano at day four so the heat infuses behind the smoke rather than in front of it. Taste before the chilli goes in — the manzano pick varies. Twelve days, strain twice, chill, fill 500ml. Shorter shelf life than the other two: 180 days.',
     '{"200L fermenter","muslin","5 micron pad","plate chiller","gravity filler","code printer"}',
     'Gluten free. Suitable for vegans.', 148000, null, true, interval '3 months'),

    ('smoke-brine', 2, 'No 03 SMOKE v2 (draft)', 'Trialling a longer smoke on the salt to cut the manzano back.', 'no-03-smoke', 'draft',
     180.00, 340, 3.32, 4.80, 12,
     'As v1 but with a 20-hour manuka smoke on the salt instead of 14, and manzano cut from 4.1% to 3.2%. Two trial batches so far. Not approved and not to be run in production.',
     '{"200L fermenter","muslin","5 micron pad","plate chiller","gravity filler","code printer"}',
     'Gluten free. Suitable for vegans.', 139000,
     'Manzano is up 22% since February and it is the single biggest line on the No 03 cost sheet. A longer smoke carries more of the flavour, so less chilli may get the same result. Waiting on a taste panel.',
     false, interval '3 weeks'),

    ('wild-brine', 1, 'No 04 WILD v1', 'Current. Kawakawa and kelp in at day three, short ferment.', 'no-04-wild', 'active',
     24.00, 46, 3.38, 4.40, 9,
     'Rack 9.5kg cucumbers in the 50L vessel. Cover with 4.4% brine. Kawakawa leaf and rinsed kelp blade go in whole at day three, lemon peel at day five. Nine days at 18C — longer and the leaf turns bitter. Strain through muslin, then a 5 micron pad. Chill to 4C, fill 500ml, cap, overprint the batch code. Run size is set by the leaf that arrived, never by the order book.',
     '{"50L fermenter","muslin","5 micron pad","plate chiller","gravity filler","code printer"}',
     'No declared allergens. Suitable for vegans.', 21000, null, true, interval '6 weeks'),

    ('full-set-pack', 1, 'The Full Set pack-out v1', 'Pack-out procedure, not a brine.', 'the-full-set', 'active',
     1.00, 200, null, null, null,
     'Pack one each of No 01, No 02 and No 03 into the rigid box on the moulded pulp insert, with the three recipe cards. Tape, weigh at 2.79kg plus or minus 40g, and record all three brine batch codes on the pack sheet. The box inherits its traceability from the bottles inside it.',
     '{"pack bench","scale","tape gun"}', 'Contains mustard and sulphites (No 01 and No 02). Gluten free.', 6800,
     null, true, interval '5 months')
  ) as r(slug, version, name, descr, product_handle, status, size_l, yield, ph, salinity, ferment,
         method, equipment, allergen, cost, change_note, is_current, approved_ago)
  join public.products p on p.handle = r.product_handle
  cross join lateral (select id from public.operators where email = 'nadia@halfsour.co.nz') o;

update public.recipes r
   set supersedes_recipe_id = prev.id
  from public.recipes prev
 where prev.slug = r.slug and prev.version = r.version - 1;

insert into public.recipe_ingredients
  (recipe_id, ingredient_id, quantity, unit, percentage_of_batch, step_order, preparation, is_optional)
select r.id, i.id, x.qty, x.unit::public.unit_of_measure, x.pct, x.step, x.prep, x.optional
  from (values
    ('house-brine', 3, 'CUCUMBER',   130.000, 'kg', 39.39, 1, 'Washed, ends trimmed, racked whole.', false),
    ('house-brine', 3, 'WATER_FILT', 313.000, 'l',  94.85, 2, 'Filtered, brought to 18C before racking.', false),
    ('house-brine', 3, 'SALT_SEA',    15.200, 'kg',  4.60, 3, 'Dissolved fully before the cucumbers go in.', false),
    ('house-brine', 3, 'VIN_WHITE',    6.600, 'l',   2.00, 4, 'Added at day two to set the starting acidity.', false),
    ('house-brine', 3, 'DILL_FRESH',   3.300, 'kg',  1.00, 5, 'Whole heads, added day two.', false),
    ('house-brine', 3, 'GARLIC',       2.970, 'kg',  0.90, 6, 'Crushed, skins on, added day two.', false),
    ('house-brine', 3, 'PEPPER_BLK',   0.660, 'kg',  0.20, 7, 'Cracked, not ground. Added day two.', false),
    ('house-brine', 3, 'MUSTARD',      0.495, 'kg',  0.15, 8, 'Whole yellow, added day two. Declared allergen.', false),
    ('house-brine', 3, 'BAYLEAF',      0.100, 'kg',  0.03, 9, 'Whole leaf, added day two.', false),

    ('dirty-brine', 2, 'CORNICHON',   70.000, 'kg', 31.82, 1, 'Washed, blossom ends removed, racked whole.', false),
    ('dirty-brine', 2, 'WATER_FILT', 209.000, 'l',  95.00, 2, 'Filtered, split 70:30 between the two tanks.', false),
    ('dirty-brine', 2, 'SALT_SEA',    11.440, 'kg',  5.20, 3, 'Dissolved into both tanks at the same strength.', false),
    ('dirty-brine', 2, 'OLIVE_MANZ',  24.000, 'kg', 10.91, 4, 'Drained, rested in their own tank, blended at day seven. Contains sulphites.', false),
    ('dirty-brine', 2, 'LEMON_PEEL',   2.200, 'kg',  1.00, 5, 'Wide strips, no pith. Into the olive tank at day one.', false),
    ('dirty-brine', 2, 'PEPPER_WHT',   0.440, 'kg',  0.20, 6, 'Whole Muntok, into the cornichon tank at day one.', false),
    ('dirty-brine', 2, 'CORIAND',      0.330, 'kg',  0.15, 7, 'Whole, into the cornichon tank at day one.', false),
    ('dirty-brine', 2, 'CITRIC',       0.110, 'kg',  0.05, 8, 'Only if the blend finishes above pH 3.35.', true),

    ('smoke-brine', 1, 'CUCUMBER',    68.000, 'kg', 37.78, 1, 'Washed, ends trimmed, racked whole.', false),
    ('smoke-brine', 1, 'WATER_FILT', 171.000, 'l',  95.00, 2, 'Filtered, brought to 18C.', false),
    ('smoke-brine', 1, 'SALT_SEA',     4.320, 'kg',  2.40, 3, 'Half the salt load.', false),
    ('smoke-brine', 1, 'SALT_SMOKE',   4.320, 'kg',  2.40, 4, 'The other half. Manuka cold-smoked, 14 hours.', false),
    ('smoke-brine', 1, 'CHIPOTLE',     1.260, 'kg',  0.70, 5, 'Whole morita, added day four.', false),
    ('smoke-brine', 1, 'MANZANO',      7.380, 'kg',  4.10, 6, 'Split lengthways, seeds in, added day four. Taste the pick first.', false),
    ('smoke-brine', 1, 'GARLIC',       1.620, 'kg',  0.90, 7, 'Crushed, skins on, added day two.', false),
    ('smoke-brine', 1, 'CORIAND',      0.360, 'kg',  0.20, 8, 'Whole, added day two.', false),

    ('wild-brine', 1, 'CUCUMBER',    9.500, 'kg', 39.58, 1, 'Washed, ends trimmed, racked whole.', false),
    ('wild-brine', 1, 'WATER_FILT', 22.800, 'l',  95.00, 2, 'Filtered, brought to 18C.', false),
    ('wild-brine', 1, 'SALT_SEA',    1.056, 'kg',  4.40, 3, 'Dissolved fully before the cucumbers go in.', false),
    ('wild-brine', 1, 'KELP',        0.360, 'kg',  1.50, 4, 'Rinsed twice to take the surface salt off, added whole at day three.', false),
    ('wild-brine', 1, 'KAWAKAWA',    0.240, 'kg',  1.00, 5, 'Whole leaf, added at day three. Out at day nine without fail.', false),
    ('wild-brine', 1, 'LEMON_PEEL',  0.192, 'kg',  0.80, 6, 'Wide strips, no pith, added at day five.', false),

    ('full-set-pack', 1, 'BOX_SET3',   1.000, 'ea', null, 1, 'One rigid box with the moulded pulp insert.', false),
    ('full-set-pack', 1, 'CARD_SET3',  3.000, 'ea', null, 2, 'Three cards: Dirty Martini, Bloody Mary, pickleback.', false)
  ) as x(slug, version, ing, qty, unit, pct, step, prep, optional)
  join public.recipes r on r.slug = x.slug and r.version = x.version
  join public.ingredients i on i.code = x.ing;

-- =============================================================================
-- BATCHES
-- Batch codes are HS-<sku>-<YYMMDD>-<run>, generated from the actual production
-- date so a code and its date can never disagree.
-- =============================================================================
insert into public.batches
  (batch_code, recipe_id, product_id, variant_id, location_id, status,
   planned_for, produced_at, bottled_at, released_at, expires_at,
   yield_litres, units_produced, units_rejected, units_remaining,
   ingredient_cost_cents, labour_cost_cents, packaging_cost_cents, overhead_cost_cents,
   ph_reading, salinity_pct, qa_passed, qa_notes, qa_checked_by, qa_checked_at, notes)
select
  'HS-' || b.code_part || '-' || to_char((now() - b.produced_ago)::date, 'YYMMDD') || '-' || b.run_letter,
  r.id, p.id, v.id, l.id, b.status::public.batch_status,
  now() - b.produced_ago - interval '2 days',
  now() - b.produced_ago,
  case when b.bottle_after is null then null else now() - b.produced_ago + b.bottle_after end,
  case when b.release_after is null then null else now() - b.produced_ago + b.release_after end,
  case when b.release_after is null then null else now() - b.produced_ago + (b.shelf_days || ' days')::interval end,
  b.yield_l, b.produced, b.rejected, b.remaining,
  b.ing, b.lab, b.pack, b.oh,
  b.ph, b.sal,
  case when b.release_after is null then null else true end,
  case when b.release_after is null then null else b.qa_note end,
  case when b.release_after is null then null else o.id end,
  case when b.release_after is null then null else now() - b.produced_ago + b.bottle_after + interval '4 hours' end,
  b.notes
from (values
  -- No 01 HOUSE
  ('01','no-01-house','house-brine',2,'F',interval '165 days', interval '12 days', interval '14 days','sold_out',540,240.00,480, 6,  0, 82000,56000,141000,28200,3.36,4.60,'pH 3.36, 4.6% salinity, clear at 24 hours. Passed.', 'First run bottled at 500ml. Sold out in five weeks.'),
  ('01','no-01-house','house-brine',3,'A',interval '118 days', interval '12 days', interval '14 days','sold_out',540,310.00,620, 4,  0, 96000,63000,185000,34200,3.31,4.58,'pH 3.31, 4.58% salinity. Passed.', null),
  ('01','no-01-house','house-brine',3,'B',interval  '86 days', interval '12 days', interval '14 days','sold_out',540,310.00,620, 8,  0, 96000,63000,185000,34200,3.33,4.61,'pH 3.33, 4.61% salinity. Eight bottles rejected on fill level. Passed.', null),
  ('01','no-01-house','house-brine',3,'C',interval  '58 days', interval '12 days', interval '14 days','released',540,320.00,640, 5, 42, 98000,64000,188000,34000,3.30,4.60,'pH 3.30, 4.6% salinity. Passed.', null),
  ('01','no-01-house','house-brine',3,'D',interval  '26 days', interval '12 days', interval '14 days','released',540,330.00,660, 3,418, 99000,65000,193000,33720,3.29,4.60,'pH 3.29, 4.6% salinity. Passed. Released on approval.', 'Costed at 600c a unit against a 620c standard.'),
  ('01','no-01-house','house-brine',3,'E',interval   '3 days', null, null,'fermenting',540,330.00,  0, 0,  0, 99000,    0,     0,     0,null,null,null, 'Day three of twelve. Aromatics went in yesterday.'),
  -- No 02 DIRTY
  ('02','no-02-dirty','dirty-brine',1,'A',interval '150 days', interval '14 days', interval '16 days','sold_out',540,180.00,360, 7,  0,118000,42000,106000,22000,3.29,5.18,'pH 3.29, 5.18% salinity. Slight haze, accepted. Passed.', 'Last v1 batch. The haze is what drove v2.'),
  ('02','no-02-dirty','dirty-brine',2,'B',interval  '92 days', interval '14 days', interval '16 days','sold_out',540,200.00,400, 4,  0,130000,46000,118000,22000,3.27,5.20,'pH 3.27, 5.2% salinity. Clear. Passed.', 'First v2 batch. Blend at day seven worked.'),
  ('02','no-02-dirty','dirty-brine',2,'C',interval  '37 days', interval '14 days', interval '16 days','released',540,210.00,420, 6,168,134000,48000,123500,20000,3.28,5.21,'pH 3.28, 5.21% salinity. Passed.', null),
  ('02','no-02-dirty','dirty-brine',2,'D',interval  '11 days', interval '14 days', interval '16 days','released',540,220.00,440, 2,396,139000,50000,128920,20000,3.28,5.19,'pH 3.28, 5.19% salinity. Passed.', null),
  -- No 03 SMOKE
  ('03','no-03-smoke','smoke-brine',1,'A',interval '150 days', interval '10 days', interval '12 days','released',180,140.00,280, 9, 22,112000,40000, 84600,21000,3.34,4.79,'pH 3.34, 4.79% salinity. Passed.', 'EXPIRES IN THIRTY DAYS with 22 units still on hand. Marlow has it on the sweep — either move it or write it off.'),
  ('03','no-03-smoke','smoke-brine',1,'B',interval  '95 days', interval '10 days', interval '12 days','sold_out',180,160.00,320, 5,  0,126000,44000, 96000,22000,3.31,4.80,'pH 3.31, 4.8% salinity. Passed.', null),
  ('03','no-03-smoke','smoke-brine',1,'C',interval  '44 days', interval '10 days', interval '12 days','released',180,170.00,340, 4,131,132000,46000,101900,21000,3.32,4.81,'pH 3.32, 4.81% salinity. Hotter pick than B — noted on the pack sheet. Passed.', 'This is the batch behind the three-star heat review.'),
  ('03','no-03-smoke','smoke-brine',1,'D',interval  '12 days', interval '10 days', interval '12 days','released',180,180.00,360, 3,318,139000,48000,106000,22000,3.33,4.78,'pH 3.33, 4.78% salinity. Passed.', null),
  ('03','no-03-smoke','smoke-brine',1,'E',interval   '1 days', null, null,'bottling',180,175.00,  0, 0,  0,141000,    0,     0,     0,null,null,null, 'On the filler now. Labels overprinting this afternoon.'),
  -- No 04 WILD. One run, ever. Forty bottles is not a soft launch, it is how
  -- much leaf came in — which is why nothing here plans a second one.
  ('04','no-04-wild','wild-brine',1,'A',interval  '31 days', interval  '9 days', interval '11 days','released',365, 22.00, 40, 2, 17, 21000, 9000, 12400, 3400,3.37,4.41,'pH 3.37, 4.41% salinity. Two rejected on fill level. Passed.', 'The entire No 04 stock, and there is no second run booked. Do not promise a restock date.'),
  -- The Full Set pack-outs
  ('SET','the-full-set','full-set-pack',1,'X',interval '128 days', interval '0 days', interval '0 days','sold_out',540,0.00,120, 3,  0,     0,20000,238000, 6000,null,null,'Pack sheet complete, all three component codes recorded. Passed.', 'Components: the first HOUSE run, DIRTY A, SMOKE A.'),
  ('SET','the-full-set','full-set-pack',1,'A',interval  '70 days', interval '0 days', interval '0 days','sold_out',540,0.00,160, 2,  0,     0,26000,318000, 8000,null,null,'Pack sheet complete. Passed.', 'Components: HOUSE B, DIRTY B, SMOKE B.'),
  ('SET','the-full-set','full-set-pack',1,'B',interval  '24 days', interval '0 days', interval '0 days','released',540,0.00,200, 1,118,     0,32000,388000,10000,null,null,'Pack sheet complete. Passed.', 'Components: HOUSE D, DIRTY C, SMOKE D.')
) as b(code_part, product_handle, recipe_slug, recipe_version, run_letter, produced_ago, bottle_after,
       release_after, status, shelf_days, yield_l, produced, rejected, remaining,
       ing, lab, pack, oh, ph, sal, qa_note, notes)
join public.products p on p.handle = b.product_handle
join public.recipes r on r.slug = b.recipe_slug and r.version = b.recipe_version
join public.product_variants v on v.product_id = p.id
join public.inventory_locations l on l.code = 'SALE_ST'
cross join lateral (select id from public.operators where email = 'nadia@halfsour.co.nz') o;

insert into public.batch_ingredients
  (batch_id, ingredient_id, supplier_id, quantity, unit, unit_cost_cents, total_cost_cents,
   supplier_lot_code, received_at, expires_at, notes)
select b.id, i.id, s.id,
       ri.quantity, ri.unit, i.standard_cost_cents,
       (ri.quantity * i.standard_cost_cents)::integer,
       -- one supplier lot per (ingredient, delivery week) — the upstream half of
       -- the traceability chain
       upper(left(i.code, 4)) || '-' || to_char((b.produced_at - interval '3 days')::date, 'YYWW') || '-' ||
         chr(65 + (('x' || substr(md5(i.code || b.batch_code), 1, 4))::bit(16)::int % 6)),
       b.produced_at - interval '3 days',
       case when i.shelf_life_days is null then null
            else b.produced_at - interval '3 days' + (i.shelf_life_days || ' days')::interval end,
       null
  from public.batches b
  join public.recipes r on r.id = b.recipe_id
  join public.recipe_ingredients ri on ri.recipe_id = r.id
  join public.ingredients i on i.id = ri.ingredient_id
  left join public.suppliers s on s.id = i.preferred_supplier_id
 where b.produced_at is not null;

-- =============================================================================
-- BATCH -> ORDER TRACEABILITY
--
-- Every shipped line is matched to the batch of the same product that was
-- available when it went out (latest produced_at at or before dispatch). The
-- composite foreign keys mean the product must agree on both sides, so a
-- mis-traced shipment cannot be written at all.
-- =============================================================================
insert into public.order_item_batches (order_item_id, batch_id, product_id, quantity, shipped_at)
select oi.id, b.id, oi.product_id, oi.quantity, o.fulfilled_at
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  join lateral (
    select bb.id
      from public.batches bb
     where bb.product_id = oi.product_id
       and bb.produced_at is not null
       and bb.released_at is not null
       and bb.released_at <= o.fulfilled_at
     order by bb.released_at desc
     limit 1
  ) b on true
 where o.fulfilled_at is not null;

-- =============================================================================
-- PURCHASE ORDERS — what "approve the reorder" actually creates
-- =============================================================================
insert into public.purchase_orders
  (po_number, supplier_id, status, subtotal_cents, freight_cents, tax_cents, total_cents,
   reference, notes, ordered_at, expected_at, received_at, cancelled_at, cancel_reason,
   created_by_agent_id, approval_id)
select po.po_number, s.id, po.status::public.purchase_order_status,
       po.subtotal, po.freight, po.tax, po.subtotal + po.freight + po.tax,
       po.reference, po.notes,
       case when po.ordered is null then null else now() - po.ordered end,
       case when po.expected is null then null else now() - po.expected end,
       case when po.received is null then null else now() - po.received end,
       null, null,
       a.id, ap.id
  from (values
    ('PO-0101','GLASSCO','pending_approval', 283200, 8500, 0, 'Bottle reorder — 2,400 x 500ml',
     'Drafted by Marlow off the nightly sweep. Bottle stock is under the reorder point and the lead time is fourteen days.',
     null::interval, null::interval, null::interval, 'brine-ops',
     'Reorder 2,400 x 500ml bottles from Onehunga Glass and Closures'),
    ('PO-0102','PUKEKOHE','received', 115200, 0, 0, 'Cucumbers for the No 01 run',
     '240kg telegraph, cut Friday.', interval '9 days', interval '6 days', interval '6 days', null, null),
    ('PO-0103','BOPSPICE','ordered', 68400, 2200, 0, 'Quarterly spice order',
     'Chipotle for the next two No 03 runs, plus the usual whole spice.', interval '4 days', interval '-1 days', null, null, null),
    ('PO-0104','MEDITER','received', 198000, 14500, 0, 'Olives and cornichons — container 4',
     'Manzanilla and lemon peel. Twelve-week lead, so this covers to February.', interval '38 days', interval '26 days', interval '25 days', null, null),
    ('PO-0105','INKPRESS','ordered', 93000, 1800, 0, 'Label reprint — all three',
     '3,000 of each. Plates are held, so this is a straight reprint.', interval '3 days', interval '-5 days', null, null, null),
    ('PO-0106','GRASSMERE','received', 96000, 4200, 0, 'Salt — flake and manuka smoked',
     '150kg flake, 40kg manuka cold-smoked.', interval '52 days', interval '45 days', interval '44 days', null, null)
  ) as po(po_number, supplier_code, status, subtotal, freight, tax, reference, notes,
          ordered, expected, received, agent_slug, approval_title)
  join public.suppliers s on s.code = po.supplier_code
  left join public.agents a on a.slug = po.agent_slug
  left join public.approvals ap on ap.title = po.approval_title;

select setval('public.purchase_order_number_seq', 107, false);

insert into public.purchase_order_items
  (purchase_order_id, currency, ingredient_id, description, quantity, quantity_received, unit,
   unit_cost_cents, line_total_cents, supplier_lot_code, expires_at)
select po.id, 'NZD', i.id, x.descr, x.qty,
       case when po.status = 'received' then x.qty else 0 end,
       x.unit::public.unit_of_measure, x.cost, (x.qty * x.cost)::integer,
       case when po.status = 'received'
            then upper(left(i.code, 4)) || '-' || to_char(po.received_at::date, 'YYWW') || '-R' else null end,
       case when po.status = 'received' and i.shelf_life_days is not null
            then po.received_at + (i.shelf_life_days || ' days')::interval else null end
  from (values
    ('PO-0101','BOTTLE_500','500ml flint glass bottle, 38mm neck',     2400.000,'ea',118),
    ('PO-0102','CUCUMBER',  'Telegraph cucumbers, grade 1',             240.000,'kg',480),
    ('PO-0103','CHIPOTLE',  'Chipotle morita, whole',                     8.000,'kg',5400),
    ('PO-0103','PEPPER_BLK','Black peppercorn, whole Tellicherry',        5.000,'kg',3900),
    ('PO-0103','CORIAND',   'Coriander seed, whole',                      5.000,'kg',2100),
    ('PO-0104','OLIVE_MANZ','Spanish manzanilla olives, 10kg pails',     80.000,'kg',1980),
    ('PO-0104','LEMON_PEEL','Preserved lemon peel, wide strips',         15.000,'kg',2650),
    ('PO-0105','LABEL_500', '500ml wrap labels, 3,000 of each design',  3000.000,'ea',31),
    ('PO-0106','SALT_SEA',  'Marlborough sea salt, medium flake',       150.000,'kg',640),
    ('PO-0106','SALT_SMOKE','Manuka cold-smoked sea salt',               40.000,'kg',2250)
  ) as x(po_number, ing, descr, qty, unit, cost)
  join public.purchase_orders po on po.po_number = x.po_number
  join public.ingredients i on i.code = x.ing;

update public.purchase_orders po
   set subtotal_cents = agg.subtotal,
       total_cents = agg.subtotal + po.freight_cents + po.tax_cents
  from (select purchase_order_id, sum(line_total_cents)::integer subtotal
          from public.purchase_order_items group by purchase_order_id) agg
 where agg.purchase_order_id = po.id;

-- =============================================================================
-- INVENTORY — the running totals, derived from what the batches actually left
-- behind and what open orders have committed.
-- =============================================================================
insert into public.inventory_levels
  (variant_id, location_id, on_hand, committed, incoming, reorder_point, reorder_quantity,
   last_counted_at, provider, shopify_gid, sync_status, synced_at)
select v.id, l.id,
       case when l.code = 'SALE_ST' then stock.on_hand - stock.on_hand / 5 else stock.on_hand / 5 end,
       case when l.code = 'SALE_ST' then coalesce(cm.committed, 0) else 0 end,
       0,
       case when l.code = 'SALE_ST' then rp.point else rp.point / 3 end,
       rp.qty,
       now() - interval '3 days',
       'shopify', 'gid://shopify/InventoryLevel/6123450' || lpad((row_number() over ())::text, 4, '0'),
       'synced', now() - interval '14 minutes'
  from public.product_variants v
  join public.products p on p.id = v.product_id
  cross join public.inventory_locations l
  cross join lateral (
    select coalesce(sum(b.units_remaining), 0)::integer as on_hand
      from public.batches b where b.product_id = v.product_id
  ) stock
  left join lateral (
    select sum(oi.quantity - oi.quantity_fulfilled)::integer as committed
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
     where oi.variant_id = v.id and o.status = 'open'
       and o.fulfillment_status in ('unfulfilled', 'partially_fulfilled')
  ) cm on true
  -- No 04 WILD sits at 0/0 deliberately. A reorder point is a promise that
  -- more can be bought; there is no kawakawa supplier to buy from, so putting a
  -- number here would put No 04 in the ops agent's morning reorder queue and
  -- have it raise a purchase order against nobody.
  cross join lateral (
    select case p.handle when 'no-01-house' then 120 when 'no-02-dirty' then 90
                         when 'no-03-smoke' then 90 when 'no-04-wild' then 0
                         else 40 end as point,
           case p.handle when 'no-01-house' then 360 when 'no-02-dirty' then 240
                         when 'no-03-smoke' then 240 when 'no-04-wild' then 0
                         else 120 end as qty
  ) rp
 where l.ships_orders;

insert into public.inventory_adjustments
  (variant_id, location_id, delta, reason, batch_id, order_item_id, note, actor_type, actor_id, occurred_at)
select b.variant_id, b.location_id, b.units_produced - b.units_rejected, 'batch_release', b.id, null,
       'Batch ' || b.batch_code || ' released to stock.', 'operator', o.id, b.released_at
  from public.batches b
  cross join lateral (select id from public.operators where email = 'nadia@halfsour.co.nz') o
 where b.released_at is not null;

insert into public.inventory_adjustments
  (variant_id, location_id, delta, reason, batch_id, order_item_id, note, actor_type, actor_id, occurred_at)
select oi.variant_id, l.id, -oi.quantity_fulfilled, 'sale', oib.batch_id, oi.id,
       'Shipped on ' || o.order_number || '.', 'system', null, o.fulfilled_at
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  join public.order_item_batches oib on oib.order_item_id = oi.id
  cross join lateral (select id from public.inventory_locations where code = 'SALE_ST') l
 where oi.quantity_fulfilled > 0;

insert into public.inventory_adjustments
  (variant_id, location_id, delta, reason, batch_id, order_item_id, note, actor_type, actor_id, occurred_at)
select v.id, l.id, x.delta, x.reason::public.inventory_reason, null, null, x.note, 'operator', o.id, now() - x.ago
  from (values
    ('HS-01-500',  -3, 'damage',    'Three bottles dropped off the pack bench. Written off.', interval '17 days'),
    ('HS-03-500', -12, 'sample',    'Sample pack for the twelve Wellington venues on the trade approach.', interval '5 days'),
    ('HS-02-500',  -6, 'sample',    'Six bottles to the Coastville market stall for tastings.', interval '9 days'),
    ('HS-01-500',  -2, 'stocktake', 'Count came in two under. Adjusted rather than argued with.', interval '3 days'),
    ('HS-04-500', -12, 'sample',    'Twelve of the forty to the oyster bars and two chefs. No 04 sells by being tasted, and there is not enough of it to sell any other way.', interval '17 days'),
    ('HS-04-500',  -9, 'sample',    'Nine to the Coastville stall for the seafood weekend.', interval '8 days')
  ) as x(sku, delta, reason, note, ago)
  join public.product_variants v on v.sku = x.sku
  cross join lateral (select id from public.inventory_locations where code = 'SALE_ST') l
  cross join lateral (select id from public.operators where email = 'nadia@halfsour.co.nz') o;

-- =============================================================================
-- SUBSCRIPTIONS
-- =============================================================================
insert into public.subscriptions
  (customer_id, status, interval_unit, interval_count, discount_bp, shipping_address_id,
   delivery_price_cents, started_at, next_billing_at, last_billed_at, paused_at, cycles_completed,
   provider, shopify_gid, shopify_updated_at, sync_status, synced_at)
select c.id, s.status::public.subscription_status, s.unit::public.subscription_interval, 1, s.disc, a.id, 0,
       now() - s.started,
       case when s.status = 'active' then now() + s.next else null end,
       now() - s.last_billed,
       case when s.status = 'paused' then now() - interval '12 days' else null end,
       s.cycles,
       'shopify', 'gid://shopify/SubscriptionContract/3344000000' || s.n, now() - s.last_billed,
       'synced', now() - interval '14 minutes'
  from (values
    ('aroha.wetere@gmail.com',    'active', 'month', 1000, interval '3 months', interval '9 days',  interval '21 days', 3, 1),
    ('sam.kerrison@outlook.co.nz','active', 'month', 1000, interval '2 months', interval '4 days',  interval '26 days', 2, 2),
    ('hana.f@protonmail.com',     'paused', 'month', 1000, interval '4 months', interval '30 days', interval '38 days', 3, 3)
  ) as s(email, status, unit, disc, started, next, last_billed, cycles, n)
  join public.customers c on c.email = s.email
  join public.addresses a on a.customer_id = c.id and a.address_type = 'shipping' and a.is_default;

insert into public.subscription_items (subscription_id, currency, product_id, variant_id, quantity, unit_price_cents)
select s.id, 'NZD', v.product_id, v.id, si.qty, si.price
  from (values
    ('aroha.wetere@gmail.com',     'HS-01-500', 2, 1800),
    ('aroha.wetere@gmail.com',     'HS-02-500', 1, 2000),
    ('sam.kerrison@outlook.co.nz', 'HS-SET-3',  1, 5400),
    ('hana.f@protonmail.com',      'HS-01-500', 1, 1800),
    ('hana.f@protonmail.com',      'HS-03-500', 1, 2200)
  ) as si(email, sku, qty, price)
  join public.customers c on c.email = si.email
  join public.subscriptions s on s.customer_id = c.id
  join public.product_variants v on v.sku = si.sku;

-- =============================================================================
-- MARKETING
-- =============================================================================
insert into public.social_accounts
  (platform, handle, display_name, profile_url, external_account_id, credential_ref,
   is_active, followers_count, following_count, posts_count, connected_at, token_expires_at, last_synced_at)
values
  ('instagram', 'halfsour.nz', 'Half Sour', 'https://instagram.com/halfsour.nz', '17841409928374651',
   'vault:instagram_graph_token', true, 4182, 214, 96, now() - interval '5 months', now() + interval '41 days', now() - interval '3 hours'),
  ('tiktok', 'halfsour.nz', 'Half Sour', 'https://tiktok.com/@halfsour.nz', '7291048372615948',
   'vault:tiktok_business_token', true, 1907, 62, 31, now() - interval '3 months', now() + interval '12 days', now() - interval '6 hours'),
  ('facebook', 'halfsournz', 'Half Sour', 'https://facebook.com/halfsournz', '104928374651093',
   'vault:meta_page_token', false, 386, 0, 11, now() - interval '5 months', now() - interval '9 days', now() - interval '9 days');

insert into public.content_assets
  (slug, title, asset_type, storage_path, public_url, mime_type, width_px, height_px, duration_seconds,
   file_size_bytes, alt_text, caption, body, tags, product_id, brand_asset_id,
   created_by_agent_id, approval_id, is_approved, usage_rights, credit, shot_at)
select ca.slug, ca.title, ca.atype::public.content_asset_type, ca.path, ca.url, ca.mime,
       ca.w, ca.h, ca.dur, ca.size, ca.alt, ca.caption, ca.body, ca.tags::text[],
       p.id, ba.id, ag.id, ap.id, ca.approved, ca.rights, ca.credit, now() - ca.shot_ago
  from (values
    ('three-up-cream', 'Three-up on cream', 'image', 'content/three-up-cream.jpg', 'https://cdn.halfsour.co.nz/content/three-up-cream.jpg', 'image/jpeg', 3000, 3000, null, 4820114,
     'No 01, No 02 and No 03 side by side on a cream ground, in numeric order', 'The whole range, in order.', null,
     '{range,hero,evergreen}', 'the-full-set', 'shot-three-up', null, null, true, 'Owned outright. Shot in-house.', 'Nadia Feldman', interval '5 weeks'),
    ('bar-pour-brass', 'Bar pour at Brass and Bitters', 'image', 'content/bar-pour-brass.jpg', 'https://cdn.halfsour.co.nz/content/bar-pour-brass.jpg', 'image/jpeg', 4000, 2667, null, 6120448,
     'No 02 DIRTY poured into a mixing glass on the pass at Brass and Bitters', 'Kiri on the pass.', null,
     '{trade,bar,proof}', 'no-02-dirty', 'shot-bar-pour', null, null, true, 'Venue release signed. Kiri Ngatai approved use.', 'Nadia Feldman', interval '13 days'),
    ('dirty-martini-build', 'Dirty Martini build', 'video', 'content/dirty-martini-build.mp4', 'https://cdn.halfsour.co.nz/content/dirty-martini-build.mp4', 'video/mp4', 1080, 1920, 22, 18442096,
     'A 22-second vertical of a Dirty Martini being built with No 02', 'Thirty martinis to a bottle.', null,
     '{video,trade,bar}', 'no-02-dirty', null, null, 'Instagram: the Dirty Martini build at Brass and Bitters', true, 'Venue release signed.', 'Nadia Feldman', interval '13 days'),
    ('fermenter-day-four', 'Day four in the fermenter', 'image', 'content/fermenter-day-four.jpg', 'https://cdn.halfsour.co.nz/content/fermenter-day-four.jpg', 'image/jpeg', 3000, 2000, null, 3918224,
     'Chipotle and split manzano going into the No 03 fermenter at day four', 'The chilli goes in late on purpose.', null,
     '{process,kitchen,smoke}', 'no-03-smoke', null, null, null, true, 'Owned outright.', 'Nadia Feldman', interval '12 days'),
    ('label-overprint', 'Batch code going on', 'video', 'content/label-overprint.mp4', 'https://cdn.halfsour.co.nz/content/label-overprint.mp4', 'video/mp4', 1080, 1920, 14, 11208960,
     'A batch code being overprinted onto a neck label on the line', 'Every bottle knows where it came from.', null,
     '{process,traceability,video}', 'no-01-house', null, null, null, true, 'Owned outright.', 'Nadia Feldman', interval '26 days'),
    ('restock-copy-smoke', 'No 03 restock caption', 'copy', null, null, null, null, null, null, null,
     null, null,
     'No 03 SMOKE is back on Thursday. Chipotle and manzano, manuka-smoked salt, the heat arrives about three seconds late. Batch D, bottled Tuesday.',
     '{caption,restock,smoke}', 'no-03-smoke', null, 'social', 'Instagram: No 03 SMOKE back on the shelf Thursday', false, null, null, interval '19 hours'),
    ('trade-one-pager', 'Trade one-pager', 'pdf', 'content/half-sour-trade-2026.pdf', 'https://cdn.halfsour.co.nz/content/half-sour-trade-2026.pdf', 'application/pdf', null, null, null, 842116,
     null, 'Case sizes, shelf life, freight and pour cost on one page.', null,
     '{trade,wholesale,collateral}', null, 'wordmark-primary', null, null, true, 'Owned outright.', null, interval '7 weeks'),
    ('market-stall-coastville', 'Coastville market stall', 'image', 'content/market-stall.jpg', 'https://cdn.halfsour.co.nz/content/market-stall.jpg', 'image/jpeg', 4000, 2667, null, 5402188,
     'The Half Sour stall at the Coastville market, all three bottles on a cream cloth', 'Saturdays at Coastville.', null,
     '{market,retail,community}', null, null, null, null, true, 'Owned outright.', 'Nadia Feldman', interval '9 days')
  ) as ca(slug, title, atype, path, url, mime, w, h, dur, size, alt, caption, body, tags,
          product_handle, brand_slug, agent_slug, approval_title, approved, rights, credit, shot_ago)
  left join public.products p on p.handle = ca.product_handle
  left join public.brand_assets ba on ba.slug = ca.brand_slug
  left join public.agents ag on ag.slug = ca.agent_slug
  left join public.approvals ap on ap.title = ca.approval_title;

insert into public.campaigns
  (slug, name, objective, channel, status, starts_at, ends_at, budget_cents, spend_cents,
   revenue_cents, target_audience, discount_id, utm_source, utm_medium, utm_campaign, owner_agent_id, notes)
select c.slug, c.name, c.objective, c.channel::public.campaign_channel, c.status::public.campaign_status,
       now() - c.starts, case when c.ends is null then null else now() - c.ends end,
       c.budget, c.spend, c.revenue, c.audience, d.id, c.utm_s, c.utm_m, c.utm_c, a.id, c.notes
  from (values
    ('no-03-launch', 'No 03 SMOKE launch', 'Get the third SKU onto shelves and into the Bloody Mary conversation.',
     'social_organic', 'completed', interval '3 months', interval '11 weeks', 0, 0, 184600,
     'Existing customers and the Auckland bar set.', 'SMOKE25', 'instagram', 'organic', 'no-03-launch', 'social',
     'Sold through the first two batches in five weeks. The launch discount did most of the work and we have not needed one since.'),
    ('wellington-trade', 'Wellington trade approach', 'Open the Wellington bar market. Zero trade accounts there at the start.',
     'wholesale', 'active', interval '6 days', null, 40000, 12400, 0,
     'Twelve Wellington cocktail bars shortlisted by Bex.', null, 'outreach', 'email', 'wellington-trade', 'scout',
     'Twelve sent, two replies, one sample pack requested. Nothing converted yet.'),
    ('summer-full-set', 'Summer gifting — The Full Set', 'Own December gifting before the category gets loud.',
     'social_paid', 'scheduled', interval '-3 weeks', interval '-3 months', 90000, 0, 0,
     'Gift buyers 28-55, Auckland and Wellington.', 'SETFREIGHT', 'meta', 'paid_social', 'summer-full-set', 'social',
     'Creative is in the library and the free-freight code is scheduled. Waiting on the December bottle order landing.'),
    ('coastville-market', 'Coastville market stall', 'Face-to-face sampling and list building every second Saturday.',
     'event', 'active', interval '4 months', null, 24000, 18600, 96400,
     'Grey Lynn locals.', null, 'market', 'offline', 'coastville', null,
     'Best conversion of anything we do, and it is where most of the newsletter list came from.')
  ) as c(slug, name, objective, channel, status, starts, ends, budget, spend, revenue, audience,
         discount_code, utm_s, utm_m, utm_c, agent_slug, notes)
  left join public.discounts d on d.code = c.discount_code
  left join public.agents a on a.slug = c.agent_slug;

insert into public.social_posts
  (account_id, platform, campaign_id, status, caption, hashtags, link_url, scheduled_for, published_at,
   external_post_id, permalink, impressions, reach, likes, comments_count, shares, saves, link_clicks,
   metrics_synced_at, error, product_id, created_by_agent_id, approval_id, brand_check_passed, brand_check_notes)
select acc.id, acc.platform, camp.id, sp.status::public.social_post_status, sp.caption, sp.hashtags::text[],
       sp.link, case when sp.scheduled is null then null else now() + sp.scheduled end,
       case when sp.published is null then null else now() - sp.published end,
       sp.ext, sp.permalink, sp.impressions, sp.reach, sp.likes, sp.comments, sp.shares, sp.saves, sp.clicks,
       case when sp.published is null then null else now() - interval '3 hours' end,
       sp.error, p.id, ag.id, ap.id, sp.brand_ok, sp.brand_notes
  from (values
    ('instagram', 'no-03-launch', 'published',
     'No 03 SMOKE. Chipotle and fresh manzano go in at day four, and the salt is cold-smoked over manuka before it ever touches water. The heat arrives about three seconds late and then sits there.',
     '{halfsour,pickle,brine,bloodymary,madeinauckland}', 'https://halfsour.co.nz/products/no-03-smoke',
     null, interval '3 months', '18042117993201188', 'https://instagram.com/p/DKx2mQ1pN3a/',
     18420, 14208, 1106, 84, 61, 342, 918, null, 'no-03-smoke', null, null, true, 'Passed. No health language, numerals correct.'),
    ('instagram', 'no-03-launch', 'published',
     'A Bloody Mary that does not need anything else in it. No 03, tomato, ice, one lemon wedge. That is the whole recipe.',
     '{halfsour,bloodymary,brine,cocktails}', null,
     null, interval '11 weeks', '18042117993201931', 'https://instagram.com/p/DK9tRb4pQ7f/',
     11340, 9012, 702, 41, 28, 188, 0, null, 'no-03-smoke', null, null, true, 'Passed.'),
    ('instagram', null, 'published',
     'Day four in the No 03 fermenter. The chilli goes in late on purpose — in at day one it strips everything else out and the heat lands in front of the smoke instead of behind it.',
     '{halfsour,process,fermentation,madeinauckland}', null,
     null, interval '12 days', '18042117993203044', 'https://instagram.com/p/DLm4Xc9pR2k/',
     9880, 7621, 588, 37, 22, 264, 0, null, 'no-03-smoke', null, null, true, 'Passed.'),
    ('instagram', null, 'published',
     'Kiri at Brass and Bitters, building the house Dirty with No 02. Thirty martinis to a bottle and it does not cloud the glass.',
     '{halfsour,dirtymartini,brine,aucklandbars,trade}', 'https://halfsour.co.nz/products/no-02-dirty',
     null, interval '11 days', '18042117993204411', 'https://instagram.com/p/DLp8Yd2pT6m/',
     22610, 17944, 1483, 112, 209, 611, 1204, null, 'no-02-dirty', 'social',
     'Instagram: the Dirty Martini build at Brass and Bitters', true, 'Passed. Venue named with permission.'),
    ('instagram', null, 'published',
     'Every bottle carries the batch it came from, overprinted on the neck at bottling. If something is ever wrong with one, we can tell you which day it was made and what went into it.',
     '{halfsour,traceability,smallbatch,madeinauckland}', null,
     null, interval '26 days', '18042117993202277', 'https://instagram.com/p/DLc1Wa7pM9j/',
     7420, 6108, 401, 29, 44, 302, 0, null, 'no-01-house', null, null, true, 'Passed. Batch code legible, per the brand rule.'),
    ('tiktok', null, 'published',
     'Fourteen seconds of a batch code going onto a label. Weirdly satisfying. Sorry.',
     '{halfsour,satisfying,smallbusinessnz}', null,
     null, interval '25 days', '7402918374651093822', 'https://tiktok.com/@halfsour.nz/video/7402918374651093822',
     41200, 33840, 2914, 168, 411, 1102, 0, null, 'no-01-house', null, null, true, 'Passed.'),
    ('instagram', 'coastville-market', 'published',
     'Coastville market this Saturday, second stall from the gate. All three open for tasting.',
     '{halfsour,coastvillemarket,auckland,farmersmarket}', null,
     null, interval '9 days', '18042117993205102', 'https://instagram.com/p/DLr2Ze5pV1n/',
     6210, 5402, 288, 19, 31, 74, 0, null, null, null, null, true, 'Passed.'),
    ('instagram', null, 'pending_approval',
     'No 03 SMOKE is back on Thursday. Chipotle and manzano, manuka-smoked salt, the heat arrives about three seconds late. Batch D, bottled Tuesday.',
     '{halfsour,restock,smoke,brine}', 'https://halfsour.co.nz/products/no-03-smoke',
     interval '2 days', null, null, null, 0, 0, 0, 0, 0, 0, 0, null, 'no-03-smoke', 'social',
     'Instagram: No 03 SMOKE back on the shelf Thursday', true, 'Passed all eleven active rules.'),
    ('instagram', 'summer-full-set', 'draft',
     'The Full Set. All three, boxed, with the three cards we actually use behind our own bar.',
     '{halfsour,gifts,thefullset}', 'https://halfsour.co.nz/products/the-full-set',
     null, null, null, null, 0, 0, 0, 0, 0, 0, 0, null, 'the-full-set', 'social', null, true, 'Passed. Held until the December bottle order lands.'),
    ('tiktok', null, 'failed',
     'Three ways with No 02 that are not a martini.',
     '{halfsour,cooking,brine}', null,
     null, null, null, null, 0, 0, 0, 0, 0, 0, 0,
     'TikTok rejected the upload: video is 1080x1350, the API requires a 9:16 aspect ratio. Re-crop and retry.',
     'no-02-dirty', 'social', null, true, 'Passed brand check. Failed on upload, not content.')
  ) as sp(platform, campaign_slug, status, caption, hashtags, link, scheduled, published, ext, permalink,
          impressions, reach, likes, comments, shares, saves, clicks, error,
          product_handle, agent_slug, approval_title, brand_ok, brand_notes)
  join public.social_accounts acc on acc.platform = sp.platform::public.social_platform
  left join public.campaigns camp on camp.slug = sp.campaign_slug
  left join public.products p on p.handle = sp.product_handle
  left join public.agents ag on ag.slug = sp.agent_slug
  left join public.approvals ap on ap.title = sp.approval_title;

insert into public.social_post_assets (post_id, asset_id, position)
select sp.id, ca.id, 10
  from public.social_posts sp
  join public.content_assets ca on ca.slug = case
    when sp.caption like 'Kiri at Brass%' then 'dirty-martini-build'
    when sp.caption like 'Day four%' then 'fermenter-day-four'
    when sp.caption like 'Every bottle carries%' then 'label-overprint'
    when sp.caption like 'Fourteen seconds%' then 'label-overprint'
    when sp.caption like 'The Full Set.%' then 'three-up-cream'
    when sp.caption like 'No 03 SMOKE is back%' then 'three-up-cream'
    when sp.caption like 'Coastville market%' then 'market-stall-coastville'
  end;

insert into public.email_sends
  (campaign_id, customer_id, order_id, to_email, to_name, subject, preheader, template, body_text,
   kind, status, provider, provider_message_id, scheduled_for, sent_at, delivered_at,
   first_opened_at, last_clicked_at, bounced_at, open_count, click_count, error,
   created_by_agent_id, approval_id)
select camp.id, c.id, o.id, e.to_email, e.to_name, e.subject, e.preheader, e.template, e.body,
       e.kind::public.email_send_kind, e.status::public.email_send_status, 'resend', e.msg_id,
       case when e.scheduled is null then null else now() + e.scheduled end,
       case when e.sent is null then null else now() - e.sent end,
       case when e.delivered is null then null else now() - e.delivered end,
       case when e.opened is null then null else now() - e.opened end,
       case when e.clicked is null then null else now() - e.clicked end,
       case when e.bounced is null then null else now() - e.bounced end,
       e.opens, e.clicks, e.error, ag.id, ap.id
  from (values
    ('order-confirmation', null, 'aroha.wetere@gmail.com', 'Aroha Wetere',
     'Your Half Sour order is confirmed', 'We will email again the moment it ships.', 'order-confirmation',
     'Thanks Aroha. Your order is in and we will pack it tomorrow morning.',
     'transactional', 'delivered', 'msg_2Kd91nRp', null::interval, interval '2 days', interval '2 days',
     interval '47 hours', null::interval, null::interval, 2, 0, null, null, null),
    ('shipping-notification', null, 'sam.kerrison@outlook.co.nz', 'Sam Kerrison',
     'Your Half Sour order is on its way', 'Tracking inside.', 'shipping-notification',
     'On its way. NZ Post have it and the tracking number is in the link below.',
     'transactional', 'delivered', 'msg_9Lm44bTq', null, interval '3 days', interval '3 days',
     interval '70 hours', interval '69 hours', null, 3, 1, null, null, null),
    (null, null, 'nadine.oputa@gmail.com', null,
     'You left The Full Set in your basket', 'Still there if you want it.', 'abandoned-cart',
     'Your basket is still sitting there with The Full Set in it. No pressure, but it is one of the last of batch B.',
     'lifecycle', 'queued', null, interval '4 hours', null, null, null, null, null, 0, 0, null, 'concierge', null),
    ('no-03-launch', null, 'aroha.wetere@gmail.com', 'Aroha Wetere',
     'No 03 SMOKE, and why the chilli goes in late', 'Chipotle, manzano, manuka-smoked salt.', 'campaign-launch',
     'The third one is here. Chipotle and fresh manzano at day four over manuka cold-smoked salt.',
     'marketing', 'delivered', 'msg_5Qb18zXk', null, interval '3 months', interval '3 months',
     interval '3 months' + interval '-4 hours', interval '3 months' + interval '-5 hours', null, 4, 2, null, null, null),
    ('wellington-trade', null, 'bar@thesaltroom.co.nz', 'Dev Ramanathan',
     'A brine made for the Dirty, from Auckland', 'Twelve by 500ml, 48-hour freight to Wellington.', 'trade-intro-v2',
     'Twelve by 500ml, eighteen-month shelf life on No 01 and No 02, 48-hour freight to Wellington. About thirty martinis to a bottle. Happy to send a sample pack.',
     'outreach', 'delivered', 'msg_7Wc23yLm', null, interval '5 days', interval '5 days',
     interval '4 days 21 hours', interval '4 days 20 hours', null, 2, 1, null, 'scout',
     'Cold approach to twelve Wellington cocktail bars'),
    ('wellington-trade', null, 'hello@nightjarqt.nz', 'Flynn Mackereth',
     'A brine made for the Dirty, from Auckland', 'Twelve by 500ml, 48-hour freight.', 'trade-intro-v2',
     'Twelve by 500ml, eighteen-month shelf life on No 01 and No 02. About thirty martinis to a bottle.',
     'outreach', 'delivered', 'msg_7Wc23yLn', null, interval '5 days', interval '5 days',
     interval '4 days 18 hours', null, null, 1, 0, null, 'scout',
     'Cold approach to twelve Wellington cocktail bars'),
    (null, null, 'orders@brassandbitters.co.nz', 'Kiri Ngatai',
     'Your Half Sour invoice — due the 20th', 'Net 20 as agreed.', 'trade-invoice',
     'Invoice attached, due the 20th as agreed. Shout if the quantities look wrong.',
     'transactional', 'delivered', 'msg_3Rn77aVp', null, interval '9 days', interval '9 days',
     interval '8 days 22 hours', null, null, 1, 0, null, null, null),
    (null, null, 'priya.nair@fastmail.com', 'Priya Nair',
     'How was the No 02?', 'One question, thirty seconds.', 'review-request',
     'You picked up No 02 a couple of weeks ago. If you have thirty seconds, we would love to know what you made with it.',
     'lifecycle', 'delivered', 'msg_8Th55cWq', null, interval '11 days', interval '11 days',
     interval '10 days 14 hours', interval '10 days 13 hours', null, 1, 1, null, 'concierge', null),
    (null, null, 'jesse.lam@gmail.com', 'Jesse Lam',
     'Welcome — here is NZ$5 off', 'Code BRINETIME, valid on your first order.', 'newsletter-welcome',
     'Thanks for signing up at the market. BRINETIME takes NZ$5 off your first order over NZ$30.',
     'marketing', 'delivered', 'msg_1Vy09dZr', null, interval '9 days', interval '9 days',
     interval '8 days 20 hours', null, null, 1, 0, null, null, null),
    (null, null, 'bounced.address@example.invalid', null,
     'Welcome — here is NZ$5 off', 'Code BRINETIME.', 'newsletter-welcome',
     'Thanks for signing up.', 'marketing', 'bounced', 'msg_0Zx31eAs', null, interval '14 days', null,
     null, null, interval '14 days', 0, 0, 'Hard bounce: recipient domain does not exist. Address removed from the list.', null, null)
  ) as e(campaign_slug, customer_email, to_email, to_name, subject, preheader, template, body, kind, status,
         msg_id, scheduled, sent, delivered, opened, clicked, bounced, opens, clicks, error, agent_slug, approval_title)
  left join public.campaigns camp on camp.slug = e.campaign_slug
  left join public.customers c on c.email = e.to_email
  left join public.orders o on o.id = (
    select o2.id from public.orders o2 where o2.email = e.to_email
     and e.kind = 'transactional' order by o2.placed_at desc limit 1)
  left join public.agents ag on ag.slug = e.agent_slug
  left join public.approvals ap on ap.title = e.approval_title;

insert into public.reviews
  (product_id, variant_id, customer_id, order_id, author_name, author_email, author_location,
   rating, title, body, status, is_verified_purchase, helpful_count,
   reply_body, replied_at, replied_by_agent_id, approval_id, published_at, rejected_reason, source)
select p.id, v.id, c.id, o.id, r.author, r.email, r.location, r.rating, r.title, r.body,
       r.status::public.review_status, o.id is not null, r.helpful,
       r.reply, case when r.reply is null then null else now() - r.replied_ago end,
       null, null,
       case when r.status = 'published' then now() - r.created_ago else null end,
       r.rejected_reason, 'storefront'
  from (values
    ('no-01-house', 'Aroha Wetere', 'aroha.wetere@gmail.com', 'Ponsonby, Auckland', 5,
     'The one I keep buying', 'I have gone through four bottles. It is properly sour rather than just salty, and a splash of it in a potato salad does more than a whole lemon. The dill is real dill, not dill flavouring.',
     'published', 12, 'Thanks Aroha. Four bottles is a good innings — the dill is from Hawke''s Bay and it goes in whole, heads and all.', interval '4 weeks', interval '30 days', null),
    ('no-02-dirty', 'Dev Ramanathan', 'bar@thesaltroom.co.nz', 'Te Aro, Wellington', 5,
     'It does not cloud the glass', 'We had been using the brine out of the olive jar like everyone else. This is a different thing entirely — it stays clear, it is consistent bottle to bottle, and we get about thirty martinis out of one. Now on the well.',
     'published', 31, 'Appreciated, Dev. Clear glass was the whole reason v2 exists — the olives now rest separately and get blended in at day seven.', interval '5 weeks', interval '38 days', null),
    ('no-03-smoke', 'Callum Speight', 'c.speight@me.com', 'Riccarton, Christchurch', 3,
     'Hotter than I expected', 'The smoke is excellent and I wanted to love it, but this bottle was properly hot — more than the one my brother has. Bloody Mary was great, straight over ice was too much for me.',
     'pending', 0, null, null, interval '2 days', null),
    ('no-01-house', 'Priya Nair', 'priya.nair@fastmail.com', 'Sydenham, Christchurch', 5,
     'Bought it for a pickleback, kept it for cooking', 'Came for the party trick, stayed because it turns out to be the best thing to deglaze a pan with. Also very good over ice with soda on a hot day.',
     'published', 8, 'That is exactly the arc we hoped for. Try it in a dressing with a bit of the olive oil you would normally use twice as much of.', interval '9 days', interval '12 days', null),
    ('the-full-set', 'Grace Ihaka', 'grace.ihaka@gmail.com', 'Devonport, Auckland', 5,
     'Best gift I have sent all year', 'Sent this to my father-in-law who has everything. He rang me. He has never rung me about a present. The box is genuinely nice and the cards are useful rather than decorative.',
     'published', 19, null, null, interval '19 days', null),
    ('no-02-dirty', 'Josh Verhoeven', 'josh.verhoeven@outlook.co.nz', 'Newtown, Wellington', 4,
     'Very good, wish the bottle were bigger', 'No complaints about what is in it. Thirty martinis sounds like a lot until you have people over twice. A litre bottle would sell.',
     'published', 6, 'Noted, and we hear this a lot. A larger format is on the list once the bottle supply is less exciting than it currently is.', interval '15 days', interval '17 days', null),
    ('no-03-smoke', 'Tom Whitiora', 'tom.whitiora@gmail.com', 'Mount Maunganui, Tauranga', 5,
     'The barbecue bottle', 'Half a bottle went into a brisket brine and the rest went into Bloody Marys. The manuka smoke is real smoke, not liquid smoke, and you can tell.',
     'published', 14, null, null, interval '23 days', null),
    ('no-01-house', 'Mereana Tuari', 'mereana.tuari@gmail.com', 'Hamilton East, Hamilton', 4,
     'Good, arrived fast', 'Ordered Sunday, here Tuesday. Sharper than I expected which I think is the point. The peppercorn comes through late.',
     'published', 3, null, null, interval '33 days', null),
    ('no-02-dirty', 'Anika Sharma', 'anika.sharma@fastmail.com', 'Remuera, Auckland', 5,
     'Finally', 'I have been making dirty martinis with jar brine for fifteen years like an idiot. This is what it is supposed to taste like. The lemon peel is doing a lot of quiet work.',
     'published', 22, null, null, interval '41 days', null),
    ('no-01-house', 'Freya Lindqvist', 'freya.lindqvist@gmail.com', 'Aro Valley, Wellington', 5,
     'Genuinely good', 'The batch code on the neck is a nice touch. Small thing but it tells you someone is paying attention.',
     'published', 5, null, null, interval '52 days', null),
    ('no-03-smoke', 'Rhys Ellingham', 'rhys.ellingham@gmail.com', 'Roslyn, Dunedin', 2,
     'Arrived cracked', 'Two of the three bottles in the box had cracked in transit. The brine itself, what I could taste of it, was good. Sorting a replacement was painless.',
     'published', 4, 'Sorry Rhys. That was carrier damage on a crushed outer, not a bottle fault — we checked the rest of that batch. Replacement went out the same day and we have changed the packing.', interval '18 days', interval '19 days', null),
    ('no-01-house', 'BRINEDEALS4U', null, null, 5,
     'CHECK OUT OUR STORE', 'Best prices on bulk brine visit our site for wholesale rates and free shipping worldwide click here now',
     'rejected', 0, null, null, interval '6 days', 'Spam. Link farm, no purchase, posted the same body on three products.')
  ) as r(product_handle, author, email, location, rating, title, body, status, helpful,
         reply, replied_ago, created_ago, rejected_reason)
  join public.products p on p.handle = r.product_handle
  join public.product_variants v on v.product_id = p.id
  left join public.customers c on c.email = r.email
  left join lateral (
    select o2.id from public.orders o2
     where o2.email = r.email and o2.financial_status <> 'pending'
     order by o2.placed_at desc limit 1
  ) o on r.email is not null;

-- Dot's drafted reply is a published statement from the brand, so it hangs off
-- an approval and stays unpublished until the founder says yes.
update public.reviews rv
   set approval_id = ap.id
  from public.approvals ap
 where ap.title = 'Reply to a three-star review about the No 03 heat level'
   and rv.rating = 3 and rv.status = 'pending';

-- =============================================================================
-- Wire each approval to the row it is about, now that those rows exist.
-- =============================================================================
update public.approvals ap set subject_id = t.id
  from (
   select distinct on (approval_id) approval_id, id from (
    select ap2.id as approval_id, sp.id
      from public.approvals ap2 join public.social_posts sp on sp.approval_id = ap2.id
    union all
    select ap2.id, po.id from public.approvals ap2 join public.purchase_orders po on po.approval_id = ap2.id
    union all
    select ap2.id, rv.id from public.approvals ap2 join public.reviews rv on rv.approval_id = ap2.id
    union all
    select ap2.id, v.id from public.approvals ap2, public.product_variants v
     where ap2.subject_type = 'price_change' and v.sku = 'HS-03-500'
    union all
    select ap2.id, b.id from public.approvals ap2, public.batches b
     where ap2.subject_type = 'batch_release' and b.batch_code like 'HS-01-%-D'
    union all
    select ap2.id, es.id from public.approvals ap2 join public.email_sends es on es.approval_id = ap2.id
   ) u order by approval_id, id
  ) t
 where t.approval_id = ap.id and ap.subject_id is null;

-- =============================================================================
-- AGENT TRANSCRIPTS, TOOL CALLS AND SPEND
-- =============================================================================
insert into public.agent_messages (run_id, seq, role, content, tool_name, tokens, model, created_at)
select r.id, m.seq, m.role::public.agent_message_role, m.content, m.tool_name, m.tokens,
       a.model, coalesce(r.started_at, r.queued_at) + (m.seq || ' seconds')::interval
  from (values
    ('Nightly stock sweep against reorder points and the forward production plan.', 0, 'system',
     'You are Marlow, Head of Brine Ops at Half Sour. Read brand_rules before writing anything customer-facing. You may act inside your spend cap; anything above it, or any purchase order, goes to an approval.', null, 412),
    ('Nightly stock sweep against reorder points and the forward production plan.', 1, 'user',
     'Run the nightly sweep. Stock against reorder points, batches inside sixty days of best-before, and the forward production plan for the next fortnight.', null, 44),
    ('Nightly stock sweep against reorder points and the forward production plan.', 2, 'assistant',
     'Starting with inventory. I will check ingredient stock against reorder points first, then finished goods, then the batch expiry window.', null, 61),
    ('Nightly stock sweep against reorder points and the forward production plan.', 3, 'tool',
     '{"below_reorder":[{"code":"BOTTLE_500","on_hand":1180,"reorder_point":1200,"lead_time_days":14,"supplier":"GLASSCO"}],"near_reorder":[{"code":"DILL_FRESH","on_hand":5.1,"reorder_point":8.0}]}',
     'inventory.read', 186),
    ('Nightly stock sweep against reorder points and the forward production plan.', 4, 'assistant',
     'Bottles are under the reorder point with a fourteen-day lead time, and the last two orders from Onehunga both slipped three days. At the current run rate 1,180 bottles is about nineteen days of cover, so a slip puts us on the line with nothing to fill into. Drafting a purchase order for 2,400.', null, 118),
    ('Nightly stock sweep against reorder points and the forward production plan.', 5, 'tool',
     '{"purchase_order":"draft","supplier":"GLASSCO","subtotal_cents":283200,"freight_cents":8500,"total_cents":291700}',
     'purchase_orders.draft', 74),
    ('Nightly stock sweep against reorder points and the forward production plan.', 6, 'assistant',
     'NZ$2,917.00 is over my single-action cap of NZ$250.00, so this needs a decision rather than an action. Raising an approval and stopping here. Also flagging one batch: No 03 SMOKE batch A has 22 units left and thirty days to best-before.', null, 96),

    ('Recalculate unit cost from the last three batches per SKU and check margin.', 0, 'system',
     'You are Teller, Finance and Pricing at Half Sour. Money is always integer cents. Never propose a price without showing the cost basis it came from.', null, 388),
    ('Recalculate unit cost from the last three batches per SKU and check margin.', 1, 'user',
     'Weekly cost and margin review. Use the last three released batches per SKU.', null, 28),
    ('Recalculate unit cost from the last three batches per SKU and check margin.', 2, 'tool',
     '{"HS-01-500":{"unit_cost_cents":[610,600,592],"price_cents":1800,"margin_pct":66.6},"HS-02-500":{"unit_cost_cents":[790,775,768],"price_cents":2000,"margin_pct":61.6},"HS-03-500":{"unit_cost_cents":[900,885,920],"price_cents":2200,"margin_pct":58.2}}',
     'batches.read', 214),
    ('Recalculate unit cost from the last three batches per SKU and check margin.', 3, 'assistant',
     'No 03 is the only one moving. Unit cost went 900, 885, then 920 — the last batch is the outlier and it is manzano, which is up 22% since February. At NZ$22.00 the margin is 58.2%, under the 60% floor in settings. NZ$23.50 puts it at 60.9% and keeps the shelf price under the psychological NZ$25 line. Raising it as an approval rather than changing it.', null, 142),

    ('Sweep new reviews and unanswered customer email since the last run.', 0, 'system',
     'You are Dot, Customer Concierge at Half Sour. Every reply you write is a public statement from the brand: read brand_rules first, and never publish without an approval.', null, 401),
    ('Sweep new reviews and unanswered customer email since the last run.', 1, 'user',
     'Sweep since the last run. Reviews, unanswered email, delivery exceptions.', null, 26),
    ('Sweep new reviews and unanswered customer email since the last run.', 2, 'tool',
     '{"new_reviews":3,"ratings":[5,5,3],"unanswered_email":0,"delivery_exceptions":0}', 'reviews.read', 58),
    ('Sweep new reviews and unanswered customer email since the last run.', 3, 'assistant',
     'The three-star is about heat on No 03. Before I write anything I want to know whether that batch actually ran hot or whether it is one palate.', null, 44),
    ('Sweep new reviews and unanswered customer email since the last run.', 4, 'tool',
     '{"batch_code":"HS-03-*-C","qa_notes":"Hotter pick than B — noted on the pack sheet.","other_orders_from_batch":37,"complaints_from_batch":1}',
     'batches.trace', 92),
    ('Sweep new reviews and unanswered customer email since the last run.', 5, 'assistant',
     'The pack sheet says that batch ran hot, so the customer is right and a template apology would be the wrong move. Drafting a reply that says so, names the batch and offers No 01 as the same base without the heat. Queued for approval — brand rule reply-within-day gives me until tomorrow midday.', null, 108),

    ('Process orders/create for a Shopify order with a line item we have no variant for.', 0, 'system',
     'You are Mirror, Storefront Sync. Never invent a row to make a webhook fit. Park it and say so.', null, 296),
    ('Process orders/create for a Shopify order with a line item we have no variant for.', 1, 'user',
     'Process webhook orders/create, event 8f2c-91ab.', null, 22),
    ('Process orders/create for a Shopify order with a line item we have no variant for.', 2, 'assistant',
     'The order has a line item pointing at ProductVariant/48231847723386, which is not in the mirror. That is either a variant created in Shopify since the last product sync or a variant we deleted locally. I am not going to guess a product for it — parking the event as failed so it replays after the next product backfill.', null, 88)
  ) as m(run_goal, seq, role, content, tool_name, tokens)
  join public.agent_runs r on r.goal = m.run_goal
  join public.agents a on a.id = r.agent_id;

insert into public.agent_tool_calls
  (run_id, message_id, seq, tool_name, arguments, result, status, error, is_mutation,
   approval_id, started_at, finished_at)
select r.id, msg.id, t.seq, t.tool_name, t.args::jsonb, t.result::jsonb,
       t.status::public.tool_call_status, t.error, t.mutation, ap.id,
       coalesce(r.started_at, r.queued_at) + (t.seq || ' seconds')::interval,
       case when t.status in ('pending','running') then null
            else coalesce(r.started_at, r.queued_at) + (t.seq || ' seconds')::interval + (t.ms || ' milliseconds')::interval end
  from (values
    ('Nightly stock sweep against reorder points and the forward production plan.', 0, 'inventory.read',
     '{"scope":"ingredients","below_reorder_only":false}',
     '{"checked":24,"below_reorder":1,"near_reorder":1}', 'succeeded', null, false, null, 412),
    ('Nightly stock sweep against reorder points and the forward production plan.', 1, 'batches.read',
     '{"expiring_within_days":60,"status":"released"}',
     '{"matches":1,"batch":"HS-03-*-A","units_remaining":22,"days_to_expiry":30}', 'succeeded', null, false, null, 288),
    ('Nightly stock sweep against reorder points and the forward production plan.', 2, 'purchase_orders.draft',
     '{"supplier":"GLASSCO","lines":[{"ingredient":"BOTTLE_500","quantity":2400,"unit_cost_cents":118}],"freight_cents":8500}',
     '{"po_number":"PO-0101","total_cents":291700,"status":"pending_approval"}', 'succeeded', null, true, null, 641),
    ('Nightly stock sweep against reorder points and the forward production plan.', 3, 'approvals.create',
     '{"subject_type":"purchase_order","risk":"high","amount_cents":291700}',
     '{"approval_created":true,"run_status":"awaiting_approval"}', 'succeeded', null, true,
     'Reorder 2,400 x 500ml bottles from Onehunga Glass and Closures', 194),

    ('Recalculate unit cost from the last three batches per SKU and check margin.', 0, 'batches.read',
     '{"last_n_per_product":3,"status":"released"}',
     '{"products":4,"batches":10}', 'succeeded', null, false, null, 366),
    ('Recalculate unit cost from the last three batches per SKU and check margin.', 1, 'pricing.model',
     '{"sku":"HS-03-500","unit_cost_cents":920,"margin_floor_pct":60}',
     '{"recommended_price_cents":2350,"margin_pct":60.9}', 'succeeded', null, false, null, 512),
    ('Recalculate unit cost from the last three batches per SKU and check margin.', 2, 'approvals.create',
     '{"subject_type":"price_change","sku":"HS-03-500","from_cents":2200,"to_cents":2350}',
     '{"approval_created":true}', 'succeeded', null, true,
     'Lift No 03 SMOKE from NZ$22.00 to NZ$23.50', 178),

    ('Sweep new reviews and unanswered customer email since the last run.', 0, 'reviews.read',
     '{"status":"pending","since":"last_run"}', '{"count":3}', 'succeeded', null, false, null, 142),
    ('Sweep new reviews and unanswered customer email since the last run.', 1, 'batches.trace',
     '{"product":"no-03-smoke","order_email_hash":"c9f4a1"}',
     '{"batch_run":"C","qa_note":"hotter pick","sibling_orders":37,"sibling_complaints":1}', 'succeeded', null, false, null, 298),
    ('Sweep new reviews and unanswered customer email since the last run.', 2, 'reviews.reply_draft',
     '{"rating":3,"tone":"direct","name_the_batch":true}',
     '{"draft_length":186,"brand_rules_passed":11}', 'succeeded', null, false, null, 1104),
    ('Sweep new reviews and unanswered customer email since the last run.', 3, 'approvals.create',
     '{"subject_type":"review_reply","risk":"low"}', '{"approval_created":true}', 'succeeded', null, true,
     'Reply to a three-star review about the No 03 heat level', 156),

    ('Draft this fortnight''s content calendar and schedule against the brand rules.', 0, 'brand_rules.read',
     '{"active":true}', '{"rules":11,"never_rules":2}', 'succeeded', null, false, null, 96),
    ('Draft this fortnight''s content calendar and schedule against the brand rules.', 1, 'social.draft',
     '{"count":4,"products":["no-03-smoke","the-full-set"]}',
     '{"drafted":4,"failed_brand_check":1,"failed_rule":"no-health-claims"}', 'succeeded', null, false, null, 2214),
    ('Draft this fortnight''s content calendar and schedule against the brand rules.', 2, 'social.schedule',
     '{"post":"no-03-restock","scheduled_for":"+2 days 17:00"}',
     '{"blocked":"requires_approval"}', 'rejected', null, true,
     'Instagram: No 03 SMOKE back on the shelf Thursday', 88),

    ('Process orders/create for a Shopify order with a line item we have no variant for.', 0, 'shopify.read',
     '{"gid":"gid://shopify/ProductVariant/48231847723386"}',
     null, 'failed', 'Variant not present in the local mirror. Refusing to invent a product row for it.', false, null, 204),

    ('Drain the Shopify webhook queue and reconcile any drifted rows.', 0, 'webhooks.drain',
     '{"max_events":50}',
     '{"processed":14,"skipped_stale":1,"failed":0}', 'succeeded', null, true, null, 1842),

    ('Nightly full reconciliation of products, variants and inventory against Shopify.', 0, 'sync.reconcile',
     '{"resource":"product","page":2}', null, 'running', null, false, null, 0)
  ) as t(run_goal, seq, tool_name, args, result, status, error, mutation, approval_title, ms)
  join public.agent_runs r on r.goal = t.run_goal
  left join public.agent_messages msg on msg.run_id = r.id and msg.role = 'tool' and msg.seq = t.seq + 3
  left join public.approvals ap on ap.title = t.approval_title;

update public.agent_runs r
   set tool_call_count = coalesce(tc.n, 0)
  from (select run_id, count(*) n from public.agent_tool_calls group by run_id) tc
 where tc.run_id = r.id;

-- Spend ledger. cost_micros is millionths of one NZD — integer minor units at a
-- resolution below one cent, because a single call rarely costs one.
insert into public.agent_costs
  (agent_id, run_id, incurred_on, incurred_at, provider, model, kind,
   input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_micros, note)
select r.agent_id, r.id,
       (coalesce(r.finished_at, r.started_at, r.queued_at) at time zone 'Pacific/Auckland')::date,
       coalesce(r.finished_at, r.started_at, r.queued_at),
       'anthropic', a.model, 'inference',
       r.input_tokens, r.output_tokens,
       (r.input_tokens * 6) / 10, case when r.input_tokens > 20000 then 4096 else 0 end,
       r.cost_micros, null
  from public.agent_runs r
  join public.agents a on a.id = r.agent_id
 where r.cost_micros > 0;

insert into public.agent_costs
  (agent_id, run_id, incurred_on, incurred_at, provider, model, kind,
   input_tokens, output_tokens, cost_micros, note)
select a.id, null,
       ((now() - x.ago) at time zone 'Pacific/Auckland')::date, now() - x.ago,
       x.provider, x.model, x.kind, 0, 0, x.micros, x.note
  from (values
    ('social',    'openai',    'text-embedding-3-small', 'embedding',   84000, interval '3 days',  'Re-embedded the caption archive after the brand rules changed.'),
    ('scout',     'exa',       'exa-search',             'search',     412000, interval '5 days',  'Wellington venue research, 62 queries.'),
    ('mirror',    'supabase',  'storage',                'storage',     18000, interval '1 days',  'Webhook payload retention, 30 days.'),
    ('concierge', 'anthropic', 'claude-haiku-4-5',       'inference',  126000, interval '2 days',  'Batched review sentiment pass over the archive.')
  ) as x(agent_slug, provider, model, kind, micros, ago, note)
  join public.agents a on a.slug = x.agent_slug;

-- =============================================================================
-- SHOPIFY WEBHOOK INBOX AND SYNC CURSORS
-- =============================================================================
insert into public.webhook_events
  (shopify_event_id, topic, resource_type, shopify_gid, api_version, payload, headers,
   hmac_verified, triggered_at, received_at, processed_at, process_status, attempts, error)
select w.event_id, w.topic, w.resource::public.sync_resource, w.gid, '2026-07',
       w.payload::jsonb,
       jsonb_build_object('x-shopify-topic', w.topic, 'x-shopify-shop-domain', 'sgu8sy-at.myshopify.com',
                          'x-shopify-api-version', '2026-07'),
       true, now() - w.triggered, now() - w.received,
       case when w.processed is null then null else now() - w.processed end,
       w.status::public.webhook_process_status, w.attempts, w.error
  from (values
    ('8f2c91ab-4d17-4a02-9e35-b7c1d0e2f4a6', 'orders/create', 'order', 'gid://shopify/Order/5264000001240',
     '{"id":5264000001240,"total_price":"54.00","currency":"NZD","line_items":[{"variant_id":48231847723386,"quantity":1}]}',
     interval '2 days 6 hours', interval '2 days 6 hours', null, 'failed', 3,
     'Variant gid://shopify/ProductVariant/48231847723386 is not in the mirror. Parked for replay after the next product backfill.'),
    ('c41d7e28-9a3b-4f61-8d02-5e7a9c1b3f80', 'orders/updated', 'order', 'gid://shopify/Order/5264000001110',
     '{"id":5264000001110,"financial_status":"paid","updated_at":"2026-08-25T09:14:02+12:00"}',
     interval '38 minutes', interval '31 minutes', interval '31 minutes', 'processed', 1, null),
    ('d92a4b17-6c58-4e39-b1f7-3a0d8e5c2947', 'orders/updated', 'order', 'gid://shopify/Order/5264000001110',
     '{"id":5264000001110,"financial_status":"pending","updated_at":"2026-08-25T09:11:47+12:00"}',
     interval '41 minutes', interval '30 minutes', interval '30 minutes', 'skipped', 1,
     null),
    ('a17f6d43-8b29-4c05-9e71-2f4a6c8d0b53', 'inventory_levels/update', 'inventory_level', 'gid://shopify/InventoryLevel/61234500001',
     '{"inventory_item_id":50412938471625,"location_id":78234501234,"available":418}',
     interval '3 hours', interval '3 hours', interval '3 hours', 'processed', 1, null),
    ('b58c0e92-1a47-4d63-8f20-9c3e5a7b1d46', 'products/update', 'product', 'gid://shopify/Product/9389912490234',
     '{"id":9389912490234,"handle":"no-03-smoke","status":"active","updated_at":"2026-08-25T08:02:11+12:00"}',
     interval '2 days', interval '2 days', interval '2 days', 'processed', 1, null),
    ('e63b1f07-5d84-4a29-b0c6-7e1f3a9d5c28', 'customers/create', 'customer', 'gid://shopify/Customer/71234510041',
     '{"id":71234510041,"email":"jesse.lam@gmail.com","accepts_marketing":true}',
     interval '9 days', interval '9 days', interval '9 days', 'processed', 1, null),
    ('f04d8a51-2e69-4b17-9c83-1a5b7d3f0e92', 'refunds/create', 'refund', 'gid://shopify/Refund/8812000000341',
     '{"order_id":5264000000442,"amount":"54.00","currency":"NZD","reason":"customer"}',
     interval '19 days', interval '19 days', interval '19 days', 'processed', 1, null),
    ('7b3e9d14-8c26-4051-af79-3d5b1e8c4a02', 'orders/fulfilled', 'order', 'gid://shopify/Order/5264000001196',
     '{"id":5264000001196,"fulfillment_status":"fulfilled","updated_at":"2026-08-27T11:58:40+12:00"}',
     interval '90 seconds', interval '75 seconds', null, 'received', 0, null)
  ) as w(event_id, topic, resource, gid, payload, triggered, received, processed, status, attempts, error);

insert into public.sync_state
  (resource_type, status, cursor, high_water_mark, page_size, started_at, last_synced_at,
   last_success_at, last_error_at, error, consecutive_failures, records_synced, records_failed, next_run_at)
values
  ('product',         'idle',        null, now() - interval '2 days',    100, null,                     now() - interval '14 minutes', now() - interval '14 minutes', null, null, 0, 4,    0, now() + interval '46 minutes'),
  ('product_variant', 'idle',        null, now() - interval '2 days',    100, null,                     now() - interval '14 minutes', now() - interval '14 minutes', null, null, 0, 4,    0, now() + interval '46 minutes'),
  ('collection',      'idle',        null, now() - interval '5 months',  100, null,                     now() - interval '14 minutes', now() - interval '14 minutes', null, null, 0, 1,    0, now() + interval '46 minutes'),
  ('inventory_level', 'idle',        null, now() - interval '3 hours',    50, null,                     now() - interval '14 minutes', now() - interval '14 minutes', null, null, 0, 8,    0, now() + interval '1 minute'),
  ('customer',        'idle',        null, now() - interval '3 days',    100, null,                     now() - interval '14 minutes', now() - interval '14 minutes', null, null, 0, 50,   0, now() + interval '46 minutes'),
  ('order',           'backfilling', 'eyJsYXN0X2lkIjo1MjY0MDAwMDAwODgyLCJsYXN0X3ZhbHVlIjoiMjAyNi0wNS0xMSJ9', now() - interval '3 days', 250,
                                     now() - interval '3 minutes', now() - interval '3 minutes', now() - interval '14 minutes', null, null, 0, 95, 0, null),
  ('discount',        'idle',        null, now() - interval '3 months',  100, null,                     now() - interval '14 minutes', now() - interval '14 minutes', null, null, 0, 5,    0, now() + interval '46 minutes'),
  ('refund',          'failed',      null, now() - interval '19 days',   100, null,                     now() - interval '2 days 6 hours', now() - interval '19 days',
                                     now() - interval '2 days 6 hours',
                                     'orders/create for gid://shopify/Order/5264000001240 references a variant that is not in the mirror. Backfill products, then replay webhook_events 8f2c91ab.', 3, 12, 1, now() + interval '20 minutes');

-- =============================================================================
-- AUDIT LOG — append-only. Every write the admin or an agent made.
-- =============================================================================
insert into public.audit_log
  (occurred_at, actor_type, actor_id, actor_label, action, entity_type, entity_id, entity_label,
   summary, before_data, after_data, agent_run_id, approval_id, ip_address, request_id)
select now() - al.ago, al.actor_type::public.actor_type,
       case al.actor_type when 'operator' then op.id when 'agent' then ag.id else null end,
       al.actor_label, al.action::public.audit_action, al.entity_type, null, al.entity_label,
       al.summary, al.before::jsonb, al.after::jsonb, r.id, ap.id,
       case when al.ip is null then null else al.ip::inet end, al.request_id
  from (values
    (interval '11 minutes', 'operator', 'Nadia Feldman', 'login', 'admin_session', 'MacBook Air — Grey Lynn',
     'Signed in from Grey Lynn.', null, null, null, null, '203.86.74.201', 'req_01K9Zc2mQ4'),
    (interval '52 minutes', 'agent', 'Dot', 'create', 'approvals', 'Reply to a three-star review about the No 03 heat level',
     'Raised an approval for a review reply after tracing the complaint to a batch that the pack sheet says ran hot.',
     null, '{"status":"pending","risk":"low"}',
     'Sweep new reviews and unanswered customer email since the last run.',
     'Reply to a three-star review about the No 03 heat level', null, 'req_01K9Za8bR1'),
    (interval '4 hours', 'agent', 'Marlow', 'create', 'purchase_orders', 'PO-0101',
     'Drafted a NZ$2,917.00 bottle reorder and stopped, because it is over the single-action cap.',
     null, '{"status":"pending_approval","total_cents":291700}',
     'Nightly stock sweep against reorder points and the forward production plan.',
     'Reorder 2,400 x 500ml bottles from Onehunga Glass and Closures', null, 'req_01K9Yx4cT7'),
    (interval '19 hours', 'agent', 'Vinnie', 'create', 'social_posts', 'No 03 SMOKE restock',
     'Drafted four posts, one failed the no-health-claims rule and was discarded, one scheduled pending approval.',
     null, '{"drafted":4,"discarded":1,"pending_approval":1}',
     'Draft this fortnight''s content calendar and schedule against the brand rules.',
     'Instagram: No 03 SMOKE back on the shelf Thursday', null, 'req_01K9Yc1dV2'),
    (interval '2 days 2 hours', 'agent', 'Teller', 'create', 'approvals', 'Lift No 03 SMOKE from NZ$22.00 to NZ$23.50',
     'Flagged No 03 below the margin floor at 58.2% and proposed NZ$23.50.',
     '{"price_cents":2200,"margin_pct":58.2}', '{"proposed_price_cents":2350,"margin_pct":60.9}',
     'Recalculate unit cost from the last three batches per SKU and check margin.',
     'Lift No 03 SMOKE from NZ$22.00 to NZ$23.50', null, 'req_01K9Wm7fX8'),
    (interval '2 days 6 hours', 'agent', 'Mirror', 'sync', 'webhook_events', 'orders/create 8f2c91ab',
     'Refused to process a webhook naming a variant that is not in the mirror. Parked for replay.',
     null, '{"process_status":"failed","attempts":3}',
     'Process orders/create for a Shopify order with a line item we have no variant for.', null, null, 'req_01K9Wd3gZ4'),
    (interval '5 days', 'operator', 'Nadia Feldman', 'approve', 'approvals', 'Cold approach to twelve Wellington cocktail bars',
     'Approved the Wellington trade approach with a condition: no follow-up without a second approval.',
     '{"status":"pending"}', '{"status":"approved"}', null,
     'Cold approach to twelve Wellington cocktail bars', '203.86.74.201', 'req_01K9Tb9hA5'),
    (interval '9 days', 'operator', 'Nadia Feldman', 'reject', 'approvals', '20% off sitewide for Labour Weekend',
     'Rejected the sitewide discount. Asked for a free-freight code instead.',
     '{"status":"pending"}', '{"status":"rejected"}', null, '20% off sitewide for Labour Weekend',
     '203.86.74.201', 'req_01K9Rf2jC9'),
    (interval '11 days', 'operator', 'Nadia Feldman', 'publish', 'social_posts', 'Dirty Martini build at Brass and Bitters',
     'Approved and published after checking with Kiri.', '{"status":"pending_approval"}', '{"status":"published"}',
     null, 'Instagram: the Dirty Martini build at Brass and Bitters', '121.99.230.14', 'req_01K9Qd4kE3'),
    (interval '19 days', 'operator', 'Nadia Feldman', 'refund', 'orders', 'Cracked bottles in transit',
     'Refunded in full and sent a replacement at our cost after tracing the batch and finding no fault.',
     '{"financial_status":"paid"}', '{"financial_status":"refunded"}', null, null, '203.86.74.201', 'req_01K9Nc8mG7'),
    (interval '19 days', 'agent', 'Dot', 'export', 'order_item_batches', 'Traceability trace',
     'Traced a complaint back through order_item_batches to a single batch and checked its 37 sibling orders.',
     null, '{"batch_sibling_orders":37,"sibling_complaints":1,"verdict":"carrier_damage"}',
     'Trace the cracked-bottle complaint back to a batch and decide whether it is a fault.', null, null, 'req_01K9Nb1nH2'),
    (interval '26 days', 'operator', 'Nadia Feldman', 'release', 'batches', 'No 01 HOUSE batch D',
     'Released 660 units to Sale Street after QA passed at pH 3.29.',
     '{"status":"qa_hold"}', '{"status":"released","units":660}', null,
     'Release No 01 HOUSE batch E to stock', '203.86.74.201', 'req_01K9Jd7pK1'),
    (interval '38 days', 'operator', 'Nadia Feldman', 'update', 'recipes', 'No 02 DIRTY v2',
     'Approved v2. Olives now rest separately and blend in at day seven.',
     '{"version":1,"status":"active"}', '{"version":2,"status":"active","is_current":true}',
     null, null, '203.86.74.201', 'req_01K9Fa3qM6'),
    (interval '3 months', 'operator', 'Nadia Feldman', 'publish', 'products', 'No 03 SMOKE',
     'Published No 03 SMOKE to the storefront and pushed it to Shopify.',
     '{"status":"draft"}', '{"status":"active"}', null, null, '203.86.74.201', 'req_01K8Xc2rP4'),
    (interval '8 days 22 hours', 'operator', 'Nadia Feldman', 'logout', 'admin_session', 'iPhone — market stall',
     'Revoked the market-stall session from a shared device.',
     '{"revoked_at":null}', '{"revoked_at":"now"}', null, null, '121.99.230.14', 'req_01K9Rb6sN8'),
    (interval '6 minutes', 'agent', 'Mirror', 'sync', 'webhook_events', 'Queue drain',
     'Drained 14 webhook events. One orders/updated lost to a newer shopify_updated_at and was skipped.',
     null, '{"processed":14,"skipped_stale":1}',
     'Drain the Shopify webhook queue and reconcile any drifted rows.', null, null, 'req_01K9Zd1tQ0')
  ) as al(ago, actor_type, actor_label, action, entity_type, entity_label, summary, before, after,
          run_goal, approval_title, ip, request_id)
  left join public.operators op on op.email = 'nadia@halfsour.co.nz'
  left join public.agents ag on ag.name = al.actor_label
  left join public.agent_runs r on r.goal = al.run_goal
  left join public.approvals ap on ap.title = al.approval_title;

commit;
