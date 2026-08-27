-- =============================================================================
-- HALF SOUR — SEED
--
-- A working month in the life of the business: a real pickle-juice line for a
-- bar-and-mixer brand, NZ customers and trade accounts, NZD money, production
-- batches traced through to the orders they shipped in, five AI staff with live
-- runs and a genuine approvals queue.
--
-- Timestamps are relative to now() so the store looks current whenever it is
-- seeded. Money is integer cents throughout; NZ retail prices are GST-inclusive
-- at 15%, so tax_cents is the GST component already inside total_cents.
--
-- Commerce rows are seeded as a Shopify MIRROR (provider = 'shopify', a real
-- shaped gid, sync_status = 'synced'), matching the live store. Reviews are
-- provider = 'local' because Half Sour owns those outright.
--
-- Idempotent: safe to re-run. Every insert is ON CONFLICT DO NOTHING on a
-- natural key, and the file starts by clearing what it owns.
-- =============================================================================

begin;

set local session_replication_role = 'replica';  -- seed writes bypass updated_at triggers

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

set local session_replication_role = 'origin';

-- =============================================================================
-- OPERATORS
-- =============================================================================
insert into public.operators (email, full_name, role, phone, timezone, last_seen_at) values
  ('nadia@halfsour.co.nz', 'Nadia Feldman', 'owner', '+64 21 447 118', 'Pacific/Auckland', now() - interval '11 minutes'),
  ('agents@halfsour.co.nz', 'Half Sour Agent Runtime', 'agent_service', null, 'Pacific/Auckland', now() - interval '2 minutes');

insert into public.admin_sessions
  (operator_id, session_token_hash, started_at, last_active_at, expires_at, ip_address, user_agent, device_label, revoked_at, revoked_reason)
select o.id, 'sha256:8f4c2b1a9e7d3f60c5a8b2e1d4f70963c8a5b2e1d4f7096328f4c2b1a9e7d3f6',
       now() - interval '3 hours', now() - interval '11 minutes', now() + interval '5 hours',
       '203.86.74.201'::inet, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0 Safari/537.36',
       'MacBook Air — Grey Lynn', null, null
  from public.operators o where o.email = 'nadia@halfsour.co.nz';

insert into public.admin_sessions
  (operator_id, session_token_hash, started_at, last_active_at, expires_at, ip_address, user_agent, device_label, revoked_at, revoked_reason)
select o.id, 'sha256:1d4f70963c8a5b2e8f4c2b1a9e7d3f60c5a8b2e1d4f7096328f4c2b1a9e7d3f6',
       now() - interval '9 days', now() - interval '9 days' + interval '40 minutes', now() - interval '8 days',
       '121.99.230.14'::inet, 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
       'iPhone — market stall', now() - interval '8 days 22 hours', 'signed out on a shared device at the Coastville market'
  from public.operators o where o.email = 'nadia@halfsour.co.nz';

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
  ('tax.gst_rate_bp', '1500', 'NZ GST at 15%, in basis points. Prices are GST-inclusive.', 'tax', true, false),
  ('shipping.free_threshold_cents', '8000', 'Orders at or above NZ$80.00 ship free within New Zealand.', 'shipping', true, false),
  ('shipping.standard_cents', '990', 'NZ Post standard urban rate charged below the free threshold.', 'shipping', true, false),
  ('shipping.rural_surcharge_cents', '500', 'Added for rural delivery addresses.', 'shipping', true, false),
  ('commerce.provider', '"shopify"', 'Active commerce adapter. "local" swaps the mock provider in for tests.', 'commerce', false, false),
  ('commerce.shop_domain', '"sgu8sy-at.myshopify.com"', 'Live Shopify store the commerce tables mirror.', 'commerce', false, false),
  ('commerce.currency', '"NZD"', 'Store currency. All money columns are cents of this.', 'commerce', true, false),
  ('commerce.shopify_admin_token_ref', '"vault:shopify_admin_api_token"', 'Vault key for the Shopify Admin API token. Never the token itself.', 'commerce', false, true),
  ('agents.default_daily_spend_cap_cents', '500', 'Per-agent daily inference budget before the run halts and asks.', 'agents', false, false),
  ('agents.approval_expiry_hours', '48', 'A pending approval nobody touches expires after this many hours.', 'agents', false, false),
  ('agents.autopublish_enabled', 'false', 'Master switch. While false, no agent may publish without a human decision.', 'agents', false, false),
  ('production.batch_code_prefix', '"HS"', 'Prefix for every batch code. Printed on the neck label.', 'production', false, false),
  ('production.default_shelf_life_days', '540', 'Eighteen months from production for unopened bottled brine.', 'production', true, false);

update public.settings s set updated_by = o.id
  from public.operators o where o.email = 'nadia@halfsour.co.nz';

-- =============================================================================
-- BRAND
-- =============================================================================
insert into public.brand_assets (slug, name, kind, description, storage_path, public_url, mime_type, width_px, height_px, hex_value, font_family, font_weight, usage_notes, is_public, is_primary, tags) values
  ('wordmark-primary', 'Half Sour wordmark', 'wordmark', 'The full wordmark, set in Kolo. Never re-type it — always place the file.', 'brand/wordmark-primary.svg', 'https://cdn.halfsour.co.nz/brand/wordmark-primary.svg', 'image/svg+xml', 1600, 320, null, null, null, 'Minimum width 24mm in print, 120px on screen. Clear space equal to the height of the S.', true, true, '{logo,primary}'),
  ('mark-jar', 'Jar mark', 'logo', 'The standalone jar glyph for avatars, favicons and the bottle cap.', 'brand/mark-jar.svg', 'https://cdn.halfsour.co.nz/brand/mark-jar.svg', 'image/svg+xml', 512, 512, null, null, null, 'Use where the wordmark will not read below 24mm.', true, true, '{logo,icon}'),
  ('colour-brine', 'Brine', 'colour', 'The house green. Everything else defers to it.', null, null, null, null, null, '#7A8B3C', null, null, 'Primary. Backgrounds, headings, the cap.', true, true, '{colour,primary}'),
  ('colour-caper', 'Caper', 'colour', 'Deep bottle green for type on light grounds.', null, null, null, null, null, '#2F3A1E', null, null, 'Body copy on cream. Never on Brine — it fails contrast.', true, false, '{colour}'),
  ('colour-cream', 'Cream', 'colour', 'The label stock colour.', null, null, null, null, null, '#F4EFE2', null, null, 'Page and label background.', true, false, '{colour}'),
  ('colour-chilli', 'Chilli', 'colour', 'Fire Brine accent only. Not a general highlight.', null, null, null, null, null, '#C2482B', null, null, 'Fire Brine SKU and heat warnings. Nothing else.', true, false, '{colour,accent}'),
  ('type-kolo', 'Kolo Display', 'typeface', 'Display face for the wordmark and headlines.', null, null, null, null, null, null, 'Kolo Display', 700, 'Headlines 32px and up. Never for body copy.', true, true, '{typeface}'),
  ('type-untitled', 'Untitled Sans', 'typeface', 'Working face for body copy, the admin and the storefront.', null, null, null, null, null, null, 'Untitled Sans', 400, 'Body, UI, labels. 16px minimum on screen.', true, false, '{typeface}'),
  ('label-classic-dill', 'Classic Dill label artwork', 'label', 'Print-ready 750ml wrap label, CMYK with 3mm bleed.', 'brand/labels/classic-dill-750-v4.pdf', null, 'application/pdf', null, null, null, null, null, 'v4 — current print file with the 2026 nutrition panel.', false, true, '{label,print}'),
  ('shot-bar-pour', 'Bar pour hero', 'photo', 'Brine poured over ice at a bar pass. The default hero shot.', 'brand/photos/bar-pour-hero.jpg', 'https://cdn.halfsour.co.nz/brand/photos/bar-pour-hero.jpg', 'image/jpeg', 3000, 2000, null, null, null, 'Crop from the left. Do not crop the jar out of frame.', true, true, '{photo,hero}');

insert into public.brand_rules (slug, kind, severity, title, rule, rationale, good_example, bad_example, applies_to, keywords, priority, is_active) values
  ('name-two-words', 'naming', 'must', 'Half Sour is two words', 'Always write "Half Sour" — two words, both capitalised. Never HalfSour, half-sour or HALF SOUR in body copy.', 'The name is a pickling term. Squashing it turns a real word into a startup.', 'Half Sour Classic Dill Brine', 'HalfSour classic dill brine', '{storefront,social,email,packaging}', '{halfsour,"half-sour","HALF SOUR"}', 10, true),
  ('no-health-claims', 'compliance', 'never', 'No health or therapeutic claims', 'Never claim the product cures cramp, cures a hangover, detoxes, aids recovery or replaces electrolytes. Say what it tastes like and what it does in a glass.', 'NZ Food Standards Code 1.2.7 restricts health claims to pre-approved ones. We hold none. A single Instagram caption is enough to breach it.', 'Sharp, salty, and it wakes up a whisky.', 'Beat cramp and rehydrate with electrolytes.', '{storefront,social,email,packaging,paid}', '{cramp,hangover,detox,electrolyte,electrolytes,cure,recovery,"immune","gut health",wellness}', 1, true),
  ('nz-spelling', 'voice', 'must', 'New Zealand English', 'Flavour, colour, litre, metre, organise, -ise not -ize. Prices are NZ$ and GST-inclusive.', 'We are an Auckland company selling to New Zealanders. American spelling reads as drop-shipping.', 'Full flavour, 750ml, NZ$18.00 including GST', 'Full flavor, 25 fl oz, $18 plus tax', '{storefront,social,email,packaging}', '{flavor,color,liter,organize,"fl oz"}', 20, true),
  ('voice-dry-not-zany', 'voice', 'must', 'Dry, not zany', 'Understated and confident. One idea per sentence. No exclamation marks, no puns on "pickle", no emoji stacks.', 'The category is full of novelty brands. Restraint is the whole differentiator.', 'The brine is the point. Everything else is garnish.', 'Get PICKLED!! 🥒🥒🥒 Dill-icious!!', '{storefront,social,email}', '{"dill-icious","pickle me","big dill",🥒}', 15, true),
  ('gst-inclusive', 'pricing', 'must', 'Every displayed price includes GST', 'Retail prices shown to consumers are GST-inclusive. Trade pricing may be shown GST-exclusive but must be labelled "+ GST".', 'Fair Trading Act 1986: an advertised price a consumer cannot actually pay is misleading.', 'NZ$18.00 (incl. GST)', 'NZ$15.65 + GST', '{storefront,email,social}', '{"plus gst","ex gst","excluding gst"}', 25, true),
  ('alcohol-adjacent', 'legal', 'never', 'We do not market alcohol', 'Half Sour contains no alcohol. Never imply the product is alcoholic, never target under-18s, and never depict intoxication in creative.', 'Sale and Supply of Alcohol Act 2012 applies to promotion of alcohol; a mixer brand that implies otherwise invites the whole regime.', 'A pickleback needs a whiskey. We make the other half.', 'Get wrecked on Half Sour this weekend.', '{social,paid,storefront}', '{"get drunk","get wrecked",shots,"blackout",smashed}', 5, true),
  ('batch-code-visible', 'product', 'must', 'Every product shot shows a legible batch code', 'Hero and packaging photography must show the neck label batch code in focus. Do not retouch it out.', 'Food Act 2014 traceability is a selling point for trade buyers. Hiding the code makes us look like a re-labeller.', 'HS-DILL-260714-B legible on the neck', 'Neck label blurred or cloned out', '{social,storefront,packaging}', '{}', 40, true),
  ('trade-tone', 'channel', 'should', 'Trade copy leads with logistics', 'For bars and distributors, lead with case size, shelf life, lead time and pour cost. Flavour language comes second.', 'A bar manager buys on margin and reliability. The romance is for the shelf.', '5L bag-in-box, 18-month shelf life, 48-hour Auckland delivery, 62 pours per box.', 'A brine that sings of a Freemans Bay summer.', '{email,wholesale}', '{}', 60, true),
  ('photo-no-stock', 'visual', 'must', 'No stock photography', 'Every image is our own product, our own kitchen or a bar we actually supply. No licensed stock, no generated food imagery.', 'Trade buyers recognise stock imagery instantly and read it as a brand with nothing to show.', 'Our bar-pour hero at Brass & Bitters', 'A smiling model with a generic jar', '{social,storefront,email,paid}', '{}', 35, true),
  ('reply-within-day', 'channel', 'should', 'Reviews get a reply within one working day', 'Reply to every review, positive or negative, within one working day. Name the batch if the review mentions a fault.', 'Traceability is only credible if we use it in public.', 'That was batch HS-FIRE-260702-A — we have pulled the remaining stock and a replacement is on its way.', 'Sorry to hear that! DM us.', '{storefront,social}', '{}', 70, true);

-- =============================================================================
-- AGENTS — the staff
-- =============================================================================
insert into public.agents (slug, name, job_title, purpose, model, tools, status, autonomy, requires_approval_for, daily_spend_cap_cents, monthly_spend_cap_cents, single_action_cap_cents, schedule_cron, colour_hex, last_run_at, runs_count) values
  ('brine-ops', 'Marlow', 'Head of Brine Ops',
   'Watches stock against the reorder points, plans the production calendar off forward demand, drafts purchase orders and flags batches approaching best-before.',
   'claude-sonnet-4-5',
   '{inventory.read,inventory.adjust,batches.read,batches.plan,suppliers.read,purchase_orders.draft,approvals.create}',
   'active', 'act_with_limits', '{purchase_order,inventory_adjustment,batch_release}', 800, 16000, 25000,
   '0 19 * * *', '#7A8B3C', now() - interval '4 hours', 214),

  ('social', 'Vinnie', 'Social and Content Lead',
   'Drafts the fortnightly content calendar against the brand rules, writes captions, schedules posts and reports back on what actually landed.',
   'claude-sonnet-4-5',
   '{brand_rules.read,content_assets.read,social.draft,social.schedule,social.metrics,approvals.create}',
   'active', 'propose', '{social_post,content_asset,email_campaign}', 600, 12000, null,
   '0 20 * * 1,4', '#C2482B', now() - interval '19 hours', 96),

  ('concierge', 'Dot', 'Customer Concierge',
   'Handles order questions, drafts review replies, chases delivery exceptions and escalates anything that smells like a product fault.',
   'claude-sonnet-4-5',
   '{orders.read,customers.read,reviews.read,reviews.reply_draft,email.draft,batches.trace,approvals.create}',
   'active', 'propose', '{review_reply,customer_message,refund}', 500, 10000, 15000,
   '0 */4 * * *', '#2F3A1E', now() - interval '52 minutes', 431),

  ('ledger', 'Teller', 'Finance and Pricing',
   'Recalculates unit cost from the last three batches, watches margin by SKU, models price moves and reconciles Shopify payouts.',
   'claude-opus-4-1',
   '{orders.read,batches.read,products.read,pricing.model,reports.write,approvals.create}',
   'active', 'propose', '{price_change,discount,settings_change}', 900, 18000, null,
   '0 8 * * 1', '#7A8B3C', now() - interval '2 days 3 hours', 41),

  ('scout', 'Bex', 'Wholesale Outreach',
   'Builds the trade prospect list from bar and bottle-shop data, writes the first approach, and keeps the follow-up cadence honest.',
   'claude-sonnet-4-5',
   '{customers.read,crm.read,email.draft,campaigns.read,approvals.create}',
   'active', 'propose', '{email_outreach,customer_message}', 700, 14000, null,
   '30 9 * * 2', '#C2482B', now() - interval '5 days', 63),

  ('mirror', 'Mirror', 'Storefront Sync',
   'Keeps the local mirror honest against Shopify: drains the webhook queue, reconciles drift nightly and reports anything the mirror and the store disagree about.',
   'claude-haiku-4-5',
   '{shopify.read,webhooks.drain,sync.reconcile,inventory.write}',
   'active', 'act_with_limits', '{}', 400, 8000, null,
   '*/15 * * * *', '#2F3A1E', now() - interval '6 minutes', 4812);

update public.agents a set operator_id = o.id
  from public.operators o where o.email = 'agents@halfsour.co.nz';

-- =============================================================================
-- COMMERCE — locations, catalogue
-- =============================================================================
insert into public.inventory_locations (code, name, kind, address_line, suburb, city, region, postcode, is_default, ships_orders, provider, shopify_gid, sync_status, synced_at) values
  ('SALE_ST', 'Sale Street Kitchen', 'kitchen', 'Unit 4, 62 Sale Street', 'Freemans Bay', 'Auckland', 'Auckland', '1010', true, true, 'shopify', 'gid://shopify/Location/78234501234', 'synced', now() - interval '14 minutes'),
  ('COOLSTORE', 'Penrose Coolstore', 'coolstore', '19 Gabador Place', 'Mount Wellington', 'Auckland', 'Auckland', '1060', false, true, 'shopify', 'gid://shopify/Location/78234501235', 'synced', now() - interval '14 minutes'),
  ('MARKET', 'Coastville Market Stall', 'market_stall', 'Coastville Primary School grounds', 'Grey Lynn', 'Auckland', 'Auckland', '1021', false, false, 'local', null, 'local', null);

insert into public.products (handle, title, subtitle, description, product_type, status, published_at, tags, seo_title, seo_description, hero_image_url, position, provider, shopify_gid, shopify_updated_at, sync_status, synced_at) values
  ('classic-dill-brine', 'Classic Dill Brine', 'The house brine. Twelve days on cucumbers, dill and Marlborough sea salt.',
   'Our first and still our best. Telegraph cucumbers from Pukekohe go into a live brine with whole dill heads, garlic, black peppercorn and Marlborough sea salt, and stay there for twelve days. We then pull the cucumbers out and bottle what is left, which is the part most people throw away and the part we built a company on. Sharp, salty, faintly grassy. Drink it cold, shoot it after whiskey, or use it anywhere a recipe asks for vinegar and means it.',
   'Brine', 'active', now() - interval '14 months', '{core,dill,bestseller,vegan,gluten-free}',
   'Classic Dill Brine — Half Sour', 'The original Half Sour pickle brine. Twelve days on cucumbers, dill and Marlborough sea salt. Made in Auckland.',
   'https://cdn.shopify.com/s/files/1/0912/3456/7890/files/classic-dill-750-hero.jpg', 10,
   'shopify', 'gid://shopify/Product/8123456789012', now() - interval '6 days', 'synced', now() - interval '14 minutes'),

  ('fire-brine', 'Fire Brine', 'Chilli, dill and a slow burn that arrives late.',
   'The Classic recipe with Hawke''s Bay long red chillies added at day four, so the heat infuses rather than stings. It builds about three seconds after you swallow and then sits there. Our most-ordered SKU behind the bar, mostly because it makes a Bloody Mary that does not need anything else.',
   'Brine', 'active', now() - interval '11 months', '{core,chilli,spicy,vegan,gluten-free}',
   'Fire Brine — Half Sour', 'Chilli dill pickle brine with a slow build. Made in Auckland from Hawke''s Bay long reds.',
   'https://cdn.shopify.com/s/files/1/0912/3456/7890/files/fire-brine-750-hero.jpg', 20,
   'shopify', 'gid://shopify/Product/8123456789013', now() - interval '6 days', 'synced', now() - interval '14 minutes'),

  ('golden-hour-brine', 'Golden Hour Brine', 'Turmeric, ginger and a brine that glows.',
   'Fresh turmeric and ginger pressed into a lighter, less aggressive brine with coriander seed and a little cane sugar to round the edges. It is the one we send to people who say they do not like pickle juice. It stains everything, which is the price.',
   'Brine', 'active', now() - interval '7 months', '{core,turmeric,ginger,vegan,gluten-free}',
   'Golden Hour Brine — Half Sour', 'Turmeric and ginger pickle brine. Lighter, warmer, and it glows.',
   'https://cdn.shopify.com/s/files/1/0912/3456/7890/files/golden-hour-750-hero.jpg', 30,
   'shopify', 'gid://shopify/Product/8123456789014', now() - interval '6 days', 'synced', now() - interval '14 minutes'),

  ('sour-cherry-fennel', 'Sour Cherry and Fennel Brine', 'Central Otago sour cherries, fennel seed, one run a year.',
   'A seasonal run built around Central Otago sour cherries picked in January and held frozen until we brine in autumn. Fennel seed, a little star anise, and no dill at all. Darker and rounder than anything else we make. When it is gone it is gone until next year.',
   'Brine', 'active', now() - interval '3 months', '{seasonal,limited,cherry,vegan,gluten-free}',
   'Sour Cherry and Fennel Brine — Half Sour', 'Seasonal pickle brine with Central Otago sour cherries and fennel seed. One run a year.',
   'https://cdn.shopify.com/s/files/1/0912/3456/7890/files/sour-cherry-750-hero.jpg', 40,
   'shopify', 'gid://shopify/Product/8123456789015', now() - interval '9 days', 'synced', now() - interval '14 minutes'),

  ('brine-concentrate', 'Bar Strength Concentrate', 'Five to one. Built for a busy pass.',
   'The Classic brine reduced and salt-adjusted to pour at five parts water to one part concentrate. A 250ml bottle makes 1.5 litres of working brine, which is roughly sixty pours. Designed for bars that were buying 750ml bottles and running out mid-service.',
   'Concentrate', 'active', now() - interval '9 months', '{trade,concentrate,bar,vegan,gluten-free}',
   'Bar Strength Brine Concentrate — Half Sour', 'Pickle brine concentrate at 5:1. One 250ml bottle makes sixty pours.',
   'https://cdn.shopify.com/s/files/1/0912/3456/7890/files/concentrate-250-hero.jpg', 50,
   'shopify', 'gid://shopify/Product/8123456789016', now() - interval '20 days', 'synced', now() - interval '14 minutes'),

  ('pickleback-kit', 'The Pickleback Kit', 'A bottle of Classic, two heavy-base shot glasses and instructions nobody needs.',
   'A 750ml Classic Dill Brine, two heavy-base 45ml shot glasses made in Whanganui, and a card explaining a ritual that takes about four seconds to learn. Our best-selling gift, and the reason our December is what it is.',
   'Kit', 'active', now() - interval '13 months', '{gift,kit,bestseller}',
   'The Pickleback Kit — Half Sour', 'Classic Dill Brine and two heavy-base shot glasses. The pickleback, boxed.',
   'https://cdn.shopify.com/s/files/1/0912/3456/7890/files/pickleback-kit-hero.jpg', 60,
   'shopify', 'gid://shopify/Product/8123456789017', now() - interval '25 days', 'synced', now() - interval '14 minutes'),

  ('half-sour-spritz', 'Half Sour Spritz', 'Brine, soda, lime. Cold, canned, ready.',
   'Classic Dill Brine cut with sparkling water and a squeeze of lime, canned at 250ml. Non-alcoholic. It exists because too many people were making it badly at home. Four percent brine by volume, no sugar, and it stays sharp all the way down.',
   'Ready to drink', 'active', now() - interval '5 months', '{rtd,canned,summer,vegan,gluten-free,no-sugar}',
   'Half Sour Spritz — Half Sour', 'Canned pickle brine spritz. Non-alcoholic, no sugar, 250ml.',
   'https://cdn.shopify.com/s/files/1/0912/3456/7890/files/spritz-4pack-hero.jpg', 70,
   'shopify', 'gid://shopify/Product/8123456789018', now() - interval '2 days', 'synced', now() - interval '14 minutes'),

  ('bar-cart-trio', 'Bar Cart Trio', 'Classic, Fire and Golden Hour in a box built to be given away.',
   'All three core brines at 250ml in a rigid box with a recipe card for a Dirty Martini, a Bloody Mary and a Pickleback. The gift we send when we do not know what someone drinks.',
   'Gift', 'active', now() - interval '10 months', '{gift,bundle,trio}',
   'Bar Cart Trio Gift Box — Half Sour', 'Three Half Sour brines at 250ml in a gift box with recipe cards.',
   'https://cdn.shopify.com/s/files/1/0912/3456/7890/files/bar-cart-trio-hero.jpg', 80,
   'shopify', 'gid://shopify/Product/8123456789019', now() - interval '30 days', 'synced', now() - interval '14 minutes');

insert into public.product_variants
  (product_id, sku, barcode, title, size_ml, pack_count, price_cents, compare_at_price_cents, unit_cost_cents, weight_grams, is_trade_only, shelf_life_days, position, provider, shopify_gid, shopify_inventory_item_gid, shopify_updated_at, sync_status, synced_at)
select p.id, v.sku, v.barcode, v.title, v.size_ml, v.pack_count, v.price_cents, v.compare_at, v.cost, v.weight, v.trade, v.shelf, v.pos,
       'shopify', v.gid, v.inv_gid, now() - interval '6 days', 'synced', now() - interval '14 minutes'
  from (values
    ('classic-dill-brine', 'HS-DILL-750',    '9421903880014', '750ml bottle',              750,  1, 1600, null,  520, 1180, false, 540, 10, 'gid://shopify/ProductVariant/45123456789012', 'gid://shopify/InventoryItem/47123456789012'),
    ('classic-dill-brine', 'HS-DILL-750-6',  '9421903880021', '750ml — six pack',          750,  6, 8400, 9600, 3120, 7200, false, 540, 20, 'gid://shopify/ProductVariant/45123456789013', 'gid://shopify/InventoryItem/47123456789013'),
    ('classic-dill-brine', 'HS-DILL-5L',     '9421903880038', '5L bag-in-box (trade)',    5000,  1, 9500, null, 3400, 5400, true,  365, 30, 'gid://shopify/ProductVariant/45123456789014', 'gid://shopify/InventoryItem/47123456789014'),
    ('fire-brine',         'HS-FIRE-750',    '9421903880045', '750ml bottle',              750,  1, 1800, null,  610, 1180, false, 540, 10, 'gid://shopify/ProductVariant/45123456789015', 'gid://shopify/InventoryItem/47123456789015'),
    ('fire-brine',         'HS-FIRE-750-6',  '9421903880052', '750ml — six pack',          750,  6, 9600,10800, 3660, 7200, false, 540, 20, 'gid://shopify/ProductVariant/45123456789016', 'gid://shopify/InventoryItem/47123456789016'),
    ('golden-hour-brine',  'HS-GOLD-750',    '9421903880069', '750ml bottle',              750,  1, 1800, null,  640, 1180, false, 450, 10, 'gid://shopify/ProductVariant/45123456789017', 'gid://shopify/InventoryItem/47123456789017'),
    ('sour-cherry-fennel', 'HS-CHRY-750',    '9421903880076', '750ml bottle',              750,  1, 2100, null,  810, 1180, false, 400, 10, 'gid://shopify/ProductVariant/45123456789018', 'gid://shopify/InventoryItem/47123456789018'),
    ('brine-concentrate',  'HS-CONC-250',    '9421903880083', '250ml bottle',              250,  1, 2400, null,  720,  460, false, 540, 10, 'gid://shopify/ProductVariant/45123456789019', 'gid://shopify/InventoryItem/47123456789019'),
    ('brine-concentrate',  'HS-CONC-250-12', '9421903880090', '250ml — twelve (trade)',    250, 12,25200,28800, 8640, 5800, true,  540, 20, 'gid://shopify/ProductVariant/45123456789020', 'gid://shopify/InventoryItem/47123456789020'),
    ('pickleback-kit',     'HS-KIT-PB',      '9421903880106', 'Kit',                       750,  1, 4900, null, 1980, 1740, false, 540, 10, 'gid://shopify/ProductVariant/45123456789021', 'gid://shopify/InventoryItem/47123456789021'),
    ('half-sour-spritz',   'HS-SPZ-250-4',   '9421903880113', '250ml — four pack',         250,  4, 2200, null,  880, 1120, false, 300, 10, 'gid://shopify/ProductVariant/45123456789022', 'gid://shopify/InventoryItem/47123456789022'),
    ('half-sour-spritz',   'HS-SPZ-250-24',  '9421903880120', '250ml — case of 24',        250, 24,12000,13200, 5280, 6720, false, 300, 20, 'gid://shopify/ProductVariant/45123456789023', 'gid://shopify/InventoryItem/47123456789023'),
    ('bar-cart-trio',      'HS-GIFT-TRIO',   '9421903880137', 'Gift box',                  250,  3, 5400, null, 2100, 1620, false, 450, 10, 'gid://shopify/ProductVariant/45123456789024', 'gid://shopify/InventoryItem/47123456789024')
  ) as v(handle, sku, barcode, title, size_ml, pack_count, price_cents, compare_at, cost, weight, trade, shelf, pos, gid, inv_gid)
  join public.products p on p.handle = v.handle;

insert into public.product_images (product_id, url, alt_text, position, width_px, height_px, provider, shopify_gid, sync_status, synced_at)
select p.id, i.url, i.alt, i.pos, 2400, 3000, 'shopify', i.gid, 'synced', now() - interval '14 minutes'
  from (values
    ('classic-dill-brine', 'https://cdn.shopify.com/s/files/1/0912/3456/7890/files/classic-dill-750-front.jpg', 'A 750ml bottle of Half Sour Classic Dill Brine on a cream ground, batch code HS-DILL-260714-B legible on the neck', 10, 'gid://shopify/MediaImage/34123456789012'),
    ('classic-dill-brine', 'https://cdn.shopify.com/s/files/1/0912/3456/7890/files/classic-dill-pour.jpg', 'Classic Dill Brine poured over ice at a bar pass', 20, 'gid://shopify/MediaImage/34123456789013'),
    ('fire-brine',         'https://cdn.shopify.com/s/files/1/0912/3456/7890/files/fire-brine-750-front.jpg', 'A 750ml bottle of Half Sour Fire Brine with a chilli-red cap', 10, 'gid://shopify/MediaImage/34123456789014'),
    ('golden-hour-brine',  'https://cdn.shopify.com/s/files/1/0912/3456/7890/files/golden-hour-750-front.jpg', 'A 750ml bottle of Golden Hour Brine backlit so the turmeric glows', 10, 'gid://shopify/MediaImage/34123456789015'),
    ('sour-cherry-fennel', 'https://cdn.shopify.com/s/files/1/0912/3456/7890/files/sour-cherry-750-front.jpg', 'A 750ml bottle of Sour Cherry and Fennel Brine beside a bowl of Central Otago sour cherries', 10, 'gid://shopify/MediaImage/34123456789016'),
    ('brine-concentrate',  'https://cdn.shopify.com/s/files/1/0912/3456/7890/files/concentrate-250-front.jpg', 'A 250ml bottle of Bar Strength Concentrate on a stainless bar top', 10, 'gid://shopify/MediaImage/34123456789017'),
    ('pickleback-kit',     'https://cdn.shopify.com/s/files/1/0912/3456/7890/files/pickleback-kit-open.jpg', 'The Pickleback Kit open, showing a bottle of Classic Dill Brine and two heavy-base shot glasses', 10, 'gid://shopify/MediaImage/34123456789018'),
    ('half-sour-spritz',   'https://cdn.shopify.com/s/files/1/0912/3456/7890/files/spritz-4pack-front.jpg', 'A four pack of 250ml Half Sour Spritz cans, condensation on the sides', 10, 'gid://shopify/MediaImage/34123456789019'),
    ('bar-cart-trio',      'https://cdn.shopify.com/s/files/1/0912/3456/7890/files/bar-cart-trio-open.jpg', 'The Bar Cart Trio gift box open, three 250ml bottles and recipe cards', 10, 'gid://shopify/MediaImage/34123456789020')
  ) as i(handle, url, alt, pos, gid)
  join public.products p on p.handle = i.handle;

insert into public.collections (handle, title, description, is_published, published_at, position, is_smart, rules, provider, shopify_gid, sync_status, synced_at) values
  ('core-range', 'The Core Range', 'The three brines we make every fortnight, all year.', true, now() - interval '14 months', 10, false, null, 'shopify', 'gid://shopify/Collection/45023456789012', 'synced', now() - interval '14 minutes'),
  ('bar-and-trade', 'Bar and Trade', 'Case sizes, concentrate and bag-in-box. Trade pricing on application.', true, now() - interval '9 months', 20, false, null, 'shopify', 'gid://shopify/Collection/45023456789013', 'synced', now() - interval '14 minutes'),
  ('gifts-and-bundles', 'Gifts and Bundles', 'Boxed, wrapped, and posted anywhere in New Zealand.', true, now() - interval '13 months', 30, false, null, 'shopify', 'gid://shopify/Collection/45023456789014', 'synced', now() - interval '14 minutes'),
  ('seasonal', 'Seasonal', 'One run a year, and then it is gone.', true, now() - interval '3 months', 40, false, null, 'shopify', 'gid://shopify/Collection/45023456789015', 'synced', now() - interval '14 minutes'),
  ('whats-new', 'What''s New', 'Anything published in the last ninety days.', true, now() - interval '5 months', 50, true, '{"conditions":[{"field":"published_at","op":"gte","value":"now-90d"}]}', 'shopify', 'gid://shopify/Collection/45023456789016', 'synced', now() - interval '14 minutes'),
  ('summer-2027', 'Summer 2027', 'Holding collection for the December range. Not published.', false, null, 60, false, null, 'local', null, 'local', null);

insert into public.collection_products (collection_id, product_id, position)
select c.id, p.id, cp.pos
  from (values
    ('core-range', 'classic-dill-brine', 10),
    ('core-range', 'fire-brine', 20),
    ('core-range', 'golden-hour-brine', 30),
    ('bar-and-trade', 'brine-concentrate', 10),
    ('bar-and-trade', 'classic-dill-brine', 20),
    ('bar-and-trade', 'fire-brine', 30),
    ('gifts-and-bundles', 'pickleback-kit', 10),
    ('gifts-and-bundles', 'bar-cart-trio', 20),
    ('seasonal', 'sour-cherry-fennel', 10),
    ('whats-new', 'half-sour-spritz', 10),
    ('whats-new', 'sour-cherry-fennel', 20)
  ) as cp(coll, handle, pos)
  join public.collections c on c.handle = cp.coll
  join public.products p on p.handle = cp.handle;

insert into public.inventory_levels (variant_id, location_id, on_hand, committed, incoming, reorder_point, reorder_quantity, last_counted_at, provider, shopify_gid, sync_status, synced_at)
select v.id, l.id, il.on_hand, il.committed, il.incoming, il.reorder_point, il.reorder_qty,
       now() - interval '3 days', 'shopify',
       'gid://shopify/InventoryLevel/' || il.gid_suffix, 'synced', now() - interval '14 minutes'
  from (values
    ('HS-DILL-750',    'SALE_ST',  184,  12,   0,  60, 240, '61234500001'),
    ('HS-DILL-750-6',  'SALE_ST',   38,   6,   0,  18,  60, '61234500002'),
    ('HS-DILL-5L',     'COOLSTORE', 22,   4,  16,  10,  30, '61234500003'),
    ('HS-FIRE-750',    'SALE_ST',   47,   3,  90,  60, 180, '61234500004'),
    ('HS-FIRE-750-6',  'SALE_ST',   14,   2,   0,  12,  36, '61234500005'),
    ('HS-GOLD-750',    'SALE_ST',  126,   5,   0,  50, 150, '61234500006'),
    ('HS-CHRY-750',    'COOLSTORE', 63,   1,   0,   0,   0, '61234500007'),
    ('HS-CONC-250',    'SALE_ST',   91,   0,   0,  40, 120, '61234500008'),
    ('HS-CONC-250-12', 'COOLSTORE',  7,   1,   0,   4,  12, '61234500009'),
    ('HS-KIT-PB',      'SALE_ST',   52,   2,   0,  25,  75, '61234500010'),
    ('HS-SPZ-250-4',   'COOLSTORE',108,   8,   0,  48, 144, '61234500011'),
    ('HS-SPZ-250-24',  'COOLSTORE', 19,   0,   0,   8,  24, '61234500012'),
    ('HS-GIFT-TRIO',   'SALE_ST',   31,   1,   0,  20,  60, '61234500013')
  ) as il(sku, loc, on_hand, committed, incoming, reorder_point, reorder_qty, gid_suffix)
  join public.product_variants v on v.sku = il.sku
  join public.inventory_locations l on l.code = il.loc;

-- =============================================================================
-- CUSTOMERS AND ADDRESSES
-- =============================================================================
insert into public.customers
  (email, first_name, last_name, phone, customer_type, company_name, nzbn, gst_number, accepts_marketing, marketing_opt_in_at, tags, note, orders_count, total_spent_cents, first_ordered_at, last_ordered_at, provider, shopify_gid, shopify_updated_at, sync_status, synced_at)
values
  ('aroha.wetere@gmail.com', 'Aroha', 'Wetere', '+64 21 903 442', 'retail', null, null, null, true, now() - interval '8 months', '{repeat,auckland}', null, 4, 31600, now() - interval '8 months', now() - interval '6 days', 'shopify', 'gid://shopify/Customer/71234500001', now() - interval '6 days', 'synced', now() - interval '14 minutes'),
  ('sam.kerrison@outlook.co.nz', 'Sam', 'Kerrison', '+64 27 118 664', 'retail', null, null, null, true, now() - interval '5 months', '{wellington}', null, 2, 14290, now() - interval '5 months', now() - interval '11 days', 'shopify', 'gid://shopify/Customer/71234500002', now() - interval '11 days', 'synced', now() - interval '14 minutes'),
  ('priya.nair@fastmail.com', 'Priya', 'Nair', null, 'retail', null, null, null, false, null, '{christchurch}', null, 1, 5390, now() - interval '17 days', now() - interval '17 days', 'shopify', 'gid://shopify/Customer/71234500003', now() - interval '17 days', 'synced', now() - interval '14 minutes'),
  ('orders@brassandbitters.co.nz', 'Kiri', 'Ngatai', '+64 9 302 7741', 'trade', 'Brass and Bitters Limited', '9429041827365', '128-449-006', true, now() - interval '10 months', '{trade,auckland,britomart}', 'Orders on the first Tuesday. Kiri prefers a text over an email.', 9, 271400, now() - interval '10 months', now() - interval '9 days', 'shopify', 'gid://shopify/Customer/71234500004', now() - interval '9 days', 'synced', now() - interval '14 minutes'),
  ('bar@thesaltroom.co.nz', 'Dev', 'Ramanathan', '+64 4 385 1120', 'trade', 'Salt Room Hospitality Limited', '9429046612840', '104-772-318', true, now() - interval '7 months', '{trade,wellington}', 'Runs the concentrate on the well. Never wants 750ml bottles.', 6, 151200, now() - interval '7 months', now() - interval '13 days', 'shopify', 'gid://shopify/Customer/71234500005', now() - interval '13 days', 'synced', now() - interval '14 minutes'),
  ('hello@nightjarqt.nz', 'Flynn', 'Mackereth', '+64 3 442 8890', 'trade', 'Nightjar Bar Limited', '9429048830175', '117-205-664', false, null, '{trade,queenstown,new-account}', 'First order. Invoice on the 20th, confirmed by Flynn on the phone.', 1, 0, now() - interval '4 days', now() - interval '4 days', 'shopify', 'gid://shopify/Customer/71234500006', now() - interval '4 days', 'synced', now() - interval '14 minutes'),
  ('tom.whitiora@gmail.com', 'Tom', 'Whitiora', '+64 22 447 001', 'retail', null, null, null, true, now() - interval '2 months', '{tauranga}', null, 1, 4690, now() - interval '2 days', now() - interval '2 days', 'shopify', 'gid://shopify/Customer/71234500007', now() - interval '2 days', 'synced', now() - interval '14 minutes'),
  ('elise@marchetti.nz', 'Elise', 'Marchetti', '+64 21 660 908', 'retail', null, null, null, true, now() - interval '3 months', '{napier,refunded}', 'Case arrived with two split cans. Refunded in full, replacement sent free.', 1, 0, now() - interval '21 days', now() - interval '21 days', 'shopify', 'gid://shopify/Customer/71234500008', now() - interval '19 days', 'synced', now() - interval '14 minutes'),
  ('hana.f@protonmail.com', 'Hana', 'Fujimoto', '+64 27 883 215', 'retail', null, null, null, true, now() - interval '6 weeks', '{subscriber,dunedin}', null, 1, 7560, now() - interval '5 weeks', now() - interval '5 weeks', 'shopify', 'gid://shopify/Customer/71234500009', now() - interval '5 weeks', 'synced', now() - interval '14 minutes'),
  ('accounts@moxieprovisions.co.nz', 'Wiremu', 'Paterson', '+64 9 579 4402', 'wholesale', 'Moxie Provisions Limited', '9429039914628', '099-663-114', true, now() - interval '14 months', '{wholesale,distributor,auckland}', 'Distributes to 40 grocers across Auckland and Waikato. Net 30.', 14, 512800, now() - interval '14 months', now() - interval '8 days', 'shopify', 'gid://shopify/Customer/71234500010', now() - interval '8 days', 'synced', now() - interval '14 minutes'),
  ('jesse.lam@gmail.com', 'Jesse', 'Lam', null, 'retail', null, null, null, true, now() - interval '9 days', '{newsletter}', 'Signed up at the Coastville market. No order yet.', 0, 0, null, null, 'shopify', 'gid://shopify/Customer/71234500011', now() - interval '9 days', 'synced', now() - interval '14 minutes');

insert into public.addresses
  (customer_id, label, address_type, first_name, last_name, company, line1, line2, suburb, city, region, postcode, phone, delivery_instructions, is_default, provider, shopify_gid, sync_status, synced_at)
select c.id, a.label, a.atype::public.address_type, a.fname, a.lname, a.company, a.line1, a.line2, a.suburb, a.city, a.region, a.postcode, a.phone, a.instructions, a.is_default,
       'shopify', a.gid, 'synced', now() - interval '14 minutes'
  from (values
    ('aroha.wetere@gmail.com',        'Home',        'shipping', 'Aroha', 'Wetere', null, '14A Norfolk Street', null, 'Ponsonby', 'Auckland', 'Auckland', '1011', '+64 21 903 442', 'Green gate, leave in the porch.', true, 'gid://shopify/MailingAddress/81234500001'),
    ('sam.kerrison@outlook.co.nz',    'Home',        'shipping', 'Sam', 'Kerrison', null, '9 Reef Street', null, 'Island Bay', 'Wellington', 'Wellington', '6023', '+64 27 118 664', null, true, 'gid://shopify/MailingAddress/81234500002'),
    ('priya.nair@fastmail.com',       'Home',        'shipping', 'Priya', 'Nair', null, '212 Colombo Street', 'Flat 3', 'Sydenham', 'Christchurch', 'Canterbury', '8023', null, 'Buzzer is broken — phone on arrival.', true, 'gid://shopify/MailingAddress/81234500003'),
    ('orders@brassandbitters.co.nz',  'Bar',         'shipping', 'Kiri', 'Ngatai', 'Brass and Bitters Limited', '30 Tyler Street', 'Rear delivery door', 'Britomart', 'Auckland', 'Auckland', '1010', '+64 9 302 7741', 'Deliveries before 11am only. Ring the bell at the rear door.', true, 'gid://shopify/MailingAddress/81234500004'),
    ('bar@thesaltroom.co.nz',         'Bar',         'shipping', 'Dev', 'Ramanathan', 'Salt Room Hospitality Limited', '118 Cuba Street', null, 'Te Aro', 'Wellington', 'Wellington', '6011', '+64 4 385 1120', 'Loading zone out front, 15 minutes max.', true, 'gid://shopify/MailingAddress/81234500005'),
    ('hello@nightjarqt.nz',           'Bar',         'shipping', 'Flynn', 'Mackereth', 'Nightjar Bar Limited', '7 Hawthorne Drive', 'Unit 2', 'Frankton', 'Queenstown', 'Otago', '9300', '+64 3 442 8890', null, true, 'gid://shopify/MailingAddress/81234500006'),
    ('tom.whitiora@gmail.com',        'Home',        'shipping', 'Tom', 'Whitiora', null, '55 Marine Parade', null, 'Mount Maunganui', 'Tauranga', 'Bay of Plenty', '3116', '+64 22 447 001', null, true, 'gid://shopify/MailingAddress/81234500007'),
    ('elise@marchetti.nz',            'Home',        'shipping', 'Elise', 'Marchetti', null, '3 Battery Road', null, 'Ahuriri', 'Napier', 'Hawke''s Bay', '4110', '+64 21 660 908', null, true, 'gid://shopify/MailingAddress/81234500008'),
    ('hana.f@protonmail.com',         'Home',        'shipping', 'Hana', 'Fujimoto', null, '78 Clyde Street', null, 'Dunedin North', 'Dunedin', 'Otago', '9016', '+64 27 883 215', 'Flat 4, up the side path.', true, 'gid://shopify/MailingAddress/81234500009'),
    ('accounts@moxieprovisions.co.nz','Warehouse',   'shipping', 'Wiremu', 'Paterson', 'Moxie Provisions Limited', '42 Hugo Johnston Drive', null, 'Penrose', 'Auckland', 'Auckland', '1061', '+64 9 579 4402', 'Pallet deliveries to dock 3. Booking required.', true, 'gid://shopify/MailingAddress/81234500010'),
    ('accounts@moxieprovisions.co.nz','Accounts',    'billing',  'Wiremu', 'Paterson', 'Moxie Provisions Limited', 'PO Box 12-884', null, 'Penrose', 'Auckland', 'Auckland', '1642', null, null, true, 'gid://shopify/MailingAddress/81234500011')
  ) as a(email, label, atype, fname, lname, company, line1, line2, suburb, city, region, postcode, phone, instructions, is_default, gid)
  join public.customers c on c.email = a.email;

update public.customers c
   set default_address_id = a.id
  from public.addresses a
 where a.customer_id = c.id and a.address_type = 'shipping' and a.is_default;

-- =============================================================================
-- DISCOUNTS
-- =============================================================================
insert into public.discounts
  (code, title, description, value_type, value_bp, value_cents, applies_to, target_product_id, minimum_subtotal_cents, customer_type_restriction, usage_limit, usage_limit_per_customer, used_count, starts_at, ends_at, status, provider, shopify_gid, sync_status, synced_at)
values
  ('TRADE10', 'Trade standing discount', '10% off for approved bar and restaurant accounts on orders of NZ$200 or more.', 'percentage', 1000, null, 'order', null, 20000, 'trade', null, null, 4, now() - interval '10 months', null, 'active', 'shopify', 'gid://shopify/DiscountCodeNode/91234500001', 'synced', now() - interval '14 minutes'),
  ('WHOLESALE20', 'Distributor rate', '20% off for distributor accounts on orders of NZ$400 or more. Net 30 terms.', 'percentage', 2000, null, 'order', null, 40000, 'wholesale', null, null, 11, now() - interval '14 months', null, 'active', 'shopify', 'gid://shopify/DiscountCodeNode/91234500002', 'synced', now() - interval '14 minutes'),
  ('SUBSCRIBER10', 'Standing order discount', '10% off every delivery on an active subscription.', 'percentage', 1000, null, 'order', null, null, null, null, null, 27, now() - interval '11 months', null, 'active', 'shopify', 'gid://shopify/DiscountCodeNode/91234500003', 'synced', now() - interval '14 minutes'),
  ('BRINETIME', 'Newsletter welcome', 'NZ$5.00 off a first order of NZ$30 or more.', 'fixed_amount', null, 500, 'order', null, 3000, null, 500, 1, 118, now() - interval '6 months', null, 'active', 'shopify', 'gid://shopify/DiscountCodeNode/91234500004', 'synced', now() - interval '14 minutes'),
  ('SPRITZFREIGHT', 'Spritz free freight', 'Free shipping on any order containing Half Sour Spritz. Starts with the summer push.', 'free_shipping', null, null, 'shipping', null, 5000, null, null, null, 0, now() + interval '3 weeks', now() + interval '3 months', 'scheduled', 'shopify', 'gid://shopify/DiscountCodeNode/91234500005', 'synced', now() - interval '14 minutes'),
  ('PICKLEBACK25', 'Matariki kit promotion', '25% off The Pickleback Kit for the Matariki gifting window.', 'percentage', 2500, null, 'product', (select id from public.products where handle = 'pickleback-kit'), null, null, null, 2, 86, now() - interval '4 months', now() - interval '3 months', 'expired', 'shopify', 'gid://shopify/DiscountCodeNode/91234500006', 'synced', now() - interval '14 minutes');

-- =============================================================================
-- CARTS  (one live shopper, one abandoned, one that became order HS-01006)
-- =============================================================================
insert into public.carts (token, customer_id, email, status, subtotal_cents, discount_cents, shipping_cents, tax_cents, total_cents, abandoned_at, recovery_email_sent_at, created_at, updated_at, provider, shopify_gid, sync_status, synced_at) values
  -- Live shopper, mid-session right now.
  ('7f3a91c04b28de65a1f7093c58bd2e4470a6c3159de824bf06a1c73e5d92f8b1', null, null, 'active',
   6000, 0, 990, 912, 6990, null, null,
   now() - interval '22 minutes', now() - interval '4 minutes',
   'shopify', 'gid://shopify/Cart/c1-7f3a91c04b28de65a1f7093c', 'synced', now() - interval '4 minutes'),
  -- Abandoned three days ago; the recovery email has not gone out yet, which is
  -- what puts it in Dot's queue.
  ('c82d17e5904ab36f1e75c0d3948a2b6f5e19d47c03b8a6215fd0e93c7a4b8016', null, 'nadine.oputa@gmail.com', 'abandoned',
   9600, 0, 0, 1252, 9600, now() - interval '3 days' + interval '6 hours', null,
   now() - interval '3 days', now() - interval '3 days' + interval '9 minutes',
   'shopify', 'gid://shopify/Cart/c1-c82d17e5904ab36f1e75c0d3', 'synced', now() - interval '3 days'),
  -- The cart that became order HS-01006; flipped to 'converted' after the order
  -- rows exist, because carts_converted_has_order will not allow it before.
  ('a4e0b9317dc6f28504ba71e3d95c8f062a7b3e14c0d95f8623ab7104ed3f9c25', null, 'tom.whitiora@gmail.com', 'active',
   3700, 0, 990, 612, 4690, null, null,
   now() - interval '2 days' - interval '31 minutes', now() - interval '2 days',
   'local', null, 'local', null);

insert into public.cart_items (cart_id, currency, product_id, variant_id, quantity, unit_price_cents, created_at)
select ct.id, 'NZD', v.product_id, v.id, ci.qty, ci.price, ct.created_at + interval '2 minutes'
  from (values
    ('7f3a91c04b28de65a1f7093c58bd2e4470a6c3159de824bf06a1c73e5d92f8b1', 'HS-FIRE-750',   1, 1800),
    ('7f3a91c04b28de65a1f7093c58bd2e4470a6c3159de824bf06a1c73e5d92f8b1', 'HS-GOLD-750',   1, 1800),
    ('7f3a91c04b28de65a1f7093c58bd2e4470a6c3159de824bf06a1c73e5d92f8b1', 'HS-CONC-250',   1, 2400),
    ('c82d17e5904ab36f1e75c0d3948a2b6f5e19d47c03b8a6215fd0e93c7a4b8016', 'HS-FIRE-750-6', 1, 9600),
    ('a4e0b9317dc6f28504ba71e3d95c8f062a7b3e14c0d95f8623ab7104ed3f9c25', 'HS-CHRY-750',   1, 2100),
    ('a4e0b9317dc6f28504ba71e3d95c8f062a7b3e14c0d95f8623ab7104ed3f9c25', 'HS-DILL-750',   1, 1600)
  ) as ci(token, sku, qty, price)
  join public.carts ct on ct.token = ci.token
  join public.product_variants v on v.sku = ci.sku;

-- =============================================================================
-- ORDERS
-- NZ retail prices are GST-inclusive, so tax_cents is the GST already inside
-- total_cents (total = subtotal - discount + shipping, which is what the
-- orders_total_balances check enforces).
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
  now() - o.placed_ago,
  case when o.paid_ago      is null then null else now() - o.paid_ago end,
  case when o.fulfilled_ago is null then null else now() - o.fulfilled_ago end,
  case when o.delivered_ago is null then null else now() - o.delivered_ago end,
  case when o.cancelled_ago is null then null else now() - o.cancelled_ago end,
  o.cancel_reason, o.gateway,
  'shopify', 'gid://shopify/Order/' || o.gid_suffix, now() - o.placed_ago,
  'synced', now() - interval '14 minutes'
from (values
  ('HS-01001', 'aroha.wetere@gmail.com', 'online', 'open', 'paid', 'delivered', 10200, 0, 0, 1330, 10200, 0, 'NZ Post Courier', 'NZ Post', 'CE923841077NZ', null, 'Regular. Threw a sticker in the box.', null, '{}', interval '6 days', interval '6 days', interval '5 days', interval '3 days', null, null, 'shopify_payments', '52340000001'),
  ('HS-01002', 'orders@brassandbitters.co.nz', 'wholesale', 'open', 'paid', 'delivered', 38000, 3800, 0, 4461, 34200, 0, 'Own van — Auckland CBD', null, null, 'TRADE10', 'Before 11am, rear door on Tyler Street.', 'Same as last time please.', '{trade,auckland}', interval '9 days', interval '9 days', interval '8 days', interval '7 days', null, null, 'invoice', '52340000002'),
  ('HS-01003', 'sam.kerrison@outlook.co.nz', 'online', 'open', 'paid', 'fulfilled', 6700, 0, 990, 1003, 7690, 0, 'NZ Post Courier', 'NZ Post', 'CE923841184NZ', null, null, 'Gift for my brother — no invoice in the box.', '{gift}', interval '11 days', interval '11 days', interval '9 days', null, null, null, 'shopify_payments', '52340000003'),
  ('HS-01004', 'priya.nair@fastmail.com', 'online', 'open', 'paid', 'delivered', 4400, 0, 990, 703, 5390, 0, 'NZ Post Courier', 'NZ Post', 'CE923840912NZ', null, null, null, '{}', interval '17 days', interval '17 days', interval '16 days', interval '14 days', null, null, 'shopify_payments', '52340000004'),
  ('HS-01005', 'bar@thesaltroom.co.nz', 'wholesale', 'open', 'paid', 'delivered', 25200, 0, 0, 3287, 25200, 0, 'Freightways overnight', 'Post Haste', 'PH2298410043', null, null, null, '{trade,wellington}', interval '13 days', interval '13 days', interval '12 days', interval '11 days', null, null, 'invoice', '52340000005'),
  ('HS-01006', 'tom.whitiora@gmail.com', 'online', 'open', 'paid', 'unfulfilled', 3700, 0, 990, 612, 4690, 0, 'NZ Post Courier', null, null, null, null, 'Is the cherry one back next year?', '{}', interval '2 days', interval '2 days', null, null, null, null, 'shopify_payments', '52340000006'),
  ('HS-01007', 'elise@marchetti.nz', 'online', 'cancelled', 'refunded', 'cancelled', 12000, 0, 0, 1565, 12000, 12000, 'NZ Post Courier', 'NZ Post', 'CE923840455NZ', null, 'Batch HS-SPZ-260625-A. Two cans split in transit — carrier damage, not a seam fault. Replacement case sent free.', null, '{refunded,damage}', interval '21 days', interval '21 days', interval '20 days', null, interval '19 days', 'Two cans split in transit. Refunded in full and a replacement case sent at our cost.', 'shopify_payments', '52340000007'),
  ('HS-01008', 'hana.f@protonmail.com', 'subscription', 'open', 'paid', 'delivered', 8400, 840, 0, 986, 7560, 0, 'NZ Post Courier', 'NZ Post', 'CE923840108NZ', 'SUBSCRIBER10', null, null, '{subscription}', interval '5 weeks', interval '5 weeks', interval '34 days', interval '32 days', null, null, 'shopify_payments', '52340000008'),
  ('HS-01009', 'hello@nightjarqt.nz', 'wholesale', 'open', 'pending', 'unfulfilled', 28700, 0, 0, 3743, 28700, 0, 'Freightways to Queenstown', null, null, null, 'First order. Flynn confirmed invoice on the 20th by phone.', null, '{trade,queenstown,new-account}', interval '4 days', null, null, null, null, null, 'invoice', '52340000009'),
  ('HS-01010', 'accounts@moxieprovisions.co.nz', 'wholesale', 'open', 'paid', 'fulfilled', 50400, 10080, 0, 5259, 40320, 0, 'Pallet — Mainfreight', 'Mainfreight', 'MF80442917', 'WHOLESALE20', 'Dock 3, booked for 7am.', null, '{wholesale,pallet}', interval '8 days', interval '8 days', interval '6 days', null, null, null, 'invoice', '52340000010'),
  ('HS-01011', 'aroha.wetere@gmail.com', 'online', 'archived', 'paid', 'delivered', 8400, 0, 0, 1096, 8400, 0, 'NZ Post Courier', 'NZ Post', 'CE923839114NZ', null, null, null, '{}', interval '5 weeks', interval '5 weeks', interval '34 days', interval '31 days', null, null, 'shopify_payments', '52340000011'),
  ('HS-01012', 'aroha.wetere@gmail.com', 'online', 'archived', 'paid', 'delivered', 6500, 0, 990, 977, 7490, 0, 'NZ Post Courier', 'NZ Post', 'CE923835002NZ', null, null, 'Birthday present — could you write on the card?', '{gift}', interval '3 months', interval '3 months', interval '3 months' - interval '2 days', interval '3 months' - interval '5 days', null, null, 'shopify_payments', '52340000012'),
  ('HS-01013', 'aroha.wetere@gmail.com', 'online', 'archived', 'paid', 'delivered', 3600, 0, 990, 599, 4590, 0, 'NZ Post Courier', 'NZ Post', 'CE923829771NZ', null, null, null, '{}', interval '7 months', interval '7 months', interval '7 months' - interval '1 day', interval '7 months' - interval '4 days', null, null, 'shopify_payments', '52340000013'),
  ('HS-01014', 'orders@brassandbitters.co.nz', 'wholesale', 'archived', 'paid', 'delivered', 53700, 5370, 0, 6304, 48330, 0, 'Own van — Auckland CBD', null, null, 'TRADE10', null, null, '{trade,auckland}', interval '6 weeks', interval '6 weeks', interval '41 days', interval '41 days', null, null, 'invoice', '52340000014'),
  ('HS-01015', 'bar@thesaltroom.co.nz', 'wholesale', 'archived', 'paid', 'delivered', 50400, 5040, 0, 5917, 45360, 0, 'Freightways overnight', 'Post Haste', 'PH2298402118', 'TRADE10', null, null, '{trade,wellington}', interval '2 months', interval '2 months', interval '2 months' - interval '1 day', interval '2 months' - interval '2 days', null, null, 'invoice', '52340000015'),
  ('HS-01016', 'accounts@moxieprovisions.co.nz', 'wholesale', 'archived', 'paid', 'delivered', 144000, 28800, 0, 15026, 115200, 0, 'Pallet — Mainfreight', 'Mainfreight', 'MF80441002', 'WHOLESALE20', 'Summer Spritz load-in.', null, '{wholesale,pallet,spritz}', interval '6 weeks', interval '6 weeks', interval '40 days', interval '38 days', null, null, 'invoice', '52340000016'),
  ('HS-01017', 'accounts@moxieprovisions.co.nz', 'wholesale', 'archived', 'paid', 'delivered', 100800, 20160, 0, 10518, 80640, 0, 'Pallet — Mainfreight', 'Mainfreight', 'MF80435566', 'WHOLESALE20', null, null, '{wholesale,pallet}', interval '4 months', interval '4 months', interval '4 months' - interval '2 days', interval '4 months' - interval '5 days', null, null, 'invoice', '52340000017'),
  ('HS-01018', 'sam.kerrison@outlook.co.nz', 'online', 'archived', 'paid', 'delivered', 6600, 0, 990, 990, 7590, 0, 'NZ Post Courier', 'NZ Post', 'CE923832240NZ', null, null, null, '{}', interval '5 months', interval '5 months', interval '5 months' - interval '1 day', interval '5 months' - interval '4 days', null, null, 'shopify_payments', '52340000018')
) as o(order_number, email, channel, status, fin, ful,
       subtotal, discount, shipping, tax, total, refunded,
       ship_method, carrier, tracking, discount_code, note, customer_note, tags,
       placed_ago, paid_ago, fulfilled_ago, delivered_ago, cancelled_ago,
       cancel_reason, gateway, gid_suffix)
join public.customers c on c.email = o.email
left join public.addresses addr
  on addr.customer_id = c.id and addr.address_type = 'shipping' and addr.is_default
left join public.discounts d on d.code = o.discount_code;

select setval('public.order_number_seq', 1019, false);

insert into public.order_items
  (order_id, currency, product_id, variant_id, shopify_gid, sku, title, variant_title,
   quantity, quantity_fulfilled, quantity_refunded, unit_price_cents, unit_cost_cents,
   discount_cents, tax_cents, line_total_cents, position)
select ord.id, 'NZD', v.product_id, v.id,
       'gid://shopify/LineItem/' || li.gid_suffix,
       v.sku, p.title, v.title,
       li.qty,
       case when ord.fulfillment_status in ('fulfilled','delivered') then li.qty else 0 end,
       case when ord.financial_status = 'refunded' then li.qty else 0 end,
       li.price, v.unit_cost_cents, li.disc,
       ((li.qty * li.price - li.disc) * 3 + 11) / 23,
       li.qty * li.price - li.disc,
       li.pos
  from (values
    ('HS-01001','HS-DILL-750-6',  1, 8400,     0, 10, '63340000001'),
    ('HS-01001','HS-FIRE-750',    1, 1800,     0, 20, '63340000002'),
    ('HS-01002','HS-DILL-5L',     4, 9500,  3800, 10, '63340000003'),
    ('HS-01003','HS-KIT-PB',      1, 4900,     0, 10, '63340000004'),
    ('HS-01003','HS-GOLD-750',    1, 1800,     0, 20, '63340000005'),
    ('HS-01004','HS-SPZ-250-4',   2, 2200,     0, 10, '63340000006'),
    ('HS-01005','HS-CONC-250-12', 1,25200,     0, 10, '63340000007'),
    ('HS-01006','HS-CHRY-750',    1, 2100,     0, 10, '63340000008'),
    ('HS-01006','HS-DILL-750',    1, 1600,     0, 20, '63340000009'),
    ('HS-01007','HS-SPZ-250-24',  1,12000,     0, 10, '63340000010'),
    ('HS-01008','HS-DILL-750-6',  1, 8400,   840, 10, '63340000011'),
    ('HS-01009','HS-FIRE-750-6',  2, 9600,     0, 10, '63340000012'),
    ('HS-01009','HS-DILL-5L',     1, 9500,     0, 20, '63340000013'),
    ('HS-01010','HS-DILL-750-6',  6, 8400, 10080, 10, '63340000014'),
    ('HS-01011','HS-DILL-750-6',  1, 8400,     0, 10, '63340000015'),
    ('HS-01012','HS-KIT-PB',      1, 4900,     0, 10, '63340000016'),
    ('HS-01012','HS-DILL-750',    1, 1600,     0, 20, '63340000017'),
    ('HS-01013','HS-FIRE-750',    2, 1800,     0, 10, '63340000018'),
    ('HS-01014','HS-DILL-5L',     3, 9500,  2850, 10, '63340000019'),
    ('HS-01014','HS-CONC-250-12', 1,25200,  2520, 20, '63340000020'),
    ('HS-01015','HS-CONC-250-12', 2,25200,  5040, 10, '63340000021'),
    ('HS-01016','HS-SPZ-250-24', 12,12000, 28800, 10, '63340000022'),
    ('HS-01017','HS-DILL-750-6', 12, 8400, 20160, 10, '63340000023'),
    ('HS-01018','HS-SPZ-250-4',   3, 2200,     0, 10, '63340000024')
  ) as li(order_number, sku, qty, price, disc, pos, gid_suffix)
  join public.orders ord on ord.order_number = li.order_number
  join public.product_variants v on v.sku = li.sku
  join public.products p on p.id = v.product_id;

-- The cart that became HS-01006.
update public.orders o
   set cart_id = c.id
  from public.carts c
 where o.order_number = 'HS-01006'
   and c.token = 'a4e0b9317dc6f28504ba71e3d95c8f062a7b3e14c0d95f8623ab7104ed3f9c25';

update public.carts c
   set status = 'converted', converted_order_id = o.id
  from public.orders o
 where o.order_number = 'HS-01006' and c.id = o.cart_id;

insert into public.discount_redemptions (discount_id, order_id, customer_id, amount_cents, redeemed_at)
select o.discount_id, o.id, o.customer_id, o.discount_cents, o.placed_at
  from public.orders o
 where o.discount_id is not null and o.discount_cents > 0;

-- Customer lifetime figures are derived, never typed. Anything else drifts.
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

update public.customers set orders_count = 0, total_spent_cents = 0,
       first_ordered_at = null, last_ordered_at = null
 where id not in (select distinct customer_id from public.orders where customer_id is not null);

-- =============================================================================
-- SUBSCRIPTIONS
-- =============================================================================
insert into public.subscriptions
  (customer_id, status, interval_unit, interval_count, discount_bp, shipping_address_id,
   delivery_price_cents, started_at, next_billing_at, last_billed_at, cycles_completed,
   provider, shopify_gid, shopify_updated_at, sync_status, synced_at)
select c.id, 'active', 'month', 1, 1000, a.id, 0,
       now() - interval '5 weeks', now() + interval '2 weeks', now() - interval '5 weeks', 1,
       'shopify', 'gid://shopify/SubscriptionContract/33440000001', now() - interval '5 weeks', 'synced', now() - interval '14 minutes'
  from public.customers c
  join public.addresses a on a.customer_id = c.id and a.address_type = 'shipping' and a.is_default
 where c.email = 'hana.f@protonmail.com';

insert into public.subscription_items (subscription_id, currency, product_id, variant_id, quantity, unit_price_cents)
select s.id, 'NZD', v.product_id, v.id, 1, 8400
  from public.subscriptions s
  join public.customers c on c.id = s.customer_id and c.email = 'hana.f@protonmail.com'
  join public.product_variants v on v.sku = 'HS-DILL-750-6';

-- =============================================================================
-- PRODUCTION — suppliers, ingredients, versioned recipes
-- =============================================================================
insert into public.suppliers
  (code, name, contact_name, email, phone, website, address_line, suburb, city, region, postcode,
   status, payment_terms, lead_time_days, minimum_order_cents, nzbn, gst_number,
   is_organic_certified, food_safety_programme, food_safety_expires_on, rating, notes)
values
  ('PUKEKOHE', 'Pukekohe Market Gardens Co-operative', 'Manu Tipene', 'orders@pukekohegardens.co.nz', '+64 9 238 4410', 'https://pukekohegardens.co.nz', '188 Buckland Road', null, 'Pukekohe', 'Auckland', '2120', 'active', '20th of the month following', 3, 15000, '9429037718204', '076-118-442', false, 'NZGAP certified — GlobalG.A.P. equivalent', (current_date + 214), 5, 'Telegraph cucumbers and alliums. Cut to order Tuesday and Friday. Quality has never dropped.'),
  ('HBHERBS', 'Hawke''s Bay Herb Growers', 'Sione Latu', 'sione@hbherbs.co.nz', '+64 6 878 2201', 'https://hbherbs.co.nz', '44 Kereru Road', null, 'Hastings', 'Hawke''s Bay', '4120', 'active', 'Net 14', 4, 8000, '9429041008372', '113-990-227', true, 'Food Control Plan — MPI registered', (current_date + 96), 4, 'Fresh dill heads and long red chillies. Dill supply gets tight from late August.'),
  ('GRASSMERE', 'Grassmere Salt Works', 'Bridget Coates', 'sales@grassmeresalt.co.nz', '+64 3 575 7188', 'https://grassmeresalt.co.nz', '2140 State Highway 1', 'Lake Grassmere', 'Seddon', 'Marlborough', '7285', 'active', 'Net 30', 7, 25000, '9429030117744', '051-204-889', false, 'Food Control Plan — MPI registered', (current_date + 331), 5, 'Solar-evaporated sea salt, 25kg sacks. Price locked until March.'),
  ('CANTVIN', 'Canterbury Vinegar Works', 'Rachel Fenn', 'accounts@cantvin.co.nz', '+64 3 344 9012', null, '19 Waterloo Road', 'Hornby', 'Christchurch', 'Canterbury', '8042', 'active', 'Net 30', 5, 20000, '9429035581093', '088-441-206', false, 'Food Control Plan — MPI registered', (current_date + 58), 4, 'White vinegar at 10% acetic in 200L drums, plus cane sugar and citric acid. Certificate is up for renewal — Marlow is chasing.'),
  ('BOPSPICE', 'Bay of Plenty Spice Merchants', 'Ari Devlin', 'ari@bopspice.co.nz', '+64 7 573 6640', 'https://bopspice.co.nz', '7 Jellicoe Street', null, 'Te Puke', 'Bay of Plenty', '3119', 'active', 'Net 14', 5, 12000, '9429042230866', '129-007-513', true, 'Food Control Plan — MPI registered', (current_date + 402), 5, 'Whole spice only, nothing ground. Batch certificates come with every delivery.'),
  ('ORCHARD', 'Central Otago Orchard Collective', 'Nell Brooking', 'nell@centralorchard.nz', '+64 3 445 1177', null, '1180 Ripponvale Road', null, 'Cromwell', 'Otago', '9310', 'active', 'Net 30', 10, 40000, '9429044519028', '134-882-770', false, 'Food Control Plan — MPI registered', (current_date + 168), 4, 'Sour cherries, picked in January and held frozen. One order a year, placed in February.'),
  ('GLASSCO', 'Onehunga Glass and Closures', 'Peter Yeung', 'sales@onehungaglass.co.nz', '+64 9 622 0180', 'https://onehungaglass.co.nz', '9 Victoria Street', 'Onehunga', 'Auckland', 'Auckland', '1061', 'active', 'Net 30', 14, 50000, '9429031104822', '042-116-395', false, null, null, 3, 'Flint glass, caps, labels and cans. Lead time crept from 10 to 14 days this year — plan around it.');

insert into public.ingredients
  (code, name, category, unit, description, allergens, is_organic, storage, shelf_life_days,
   standard_cost_cents, stock_on_hand, reorder_point, reorder_quantity, preferred_supplier_id, notes)
select i.code, i.name, i.cat::public.ingredient_category, i.unit::public.unit_of_measure, i.descr,
       i.allergens::text[], i.organic, i.storage::public.storage_requirement, i.shelf,
       i.cost, i.stock, i.rp, i.rq, s.id, i.notes
  from (values
    ('CUCUMBER',  'Telegraph cucumbers',            'produce',   'kg', 'Grade 1 telegraph cucumbers, 300-400g each.', '{}', false, 'chilled',  14,   480, 138.000,  60.000, 240.000, 'PUKEKOHE', 'Cut to order. Anything over five days off the vine goes soft in the brine.'),
    ('DILL_FRESH','Fresh dill heads',               'herb',      'kg', 'Whole flowering dill heads, stems attached.', '{}', true,  'chilled',   7,  2600,   4.200,   8.000,  24.000, 'HBHERBS',  'Supply tightens from late August. This is the one that stops production.'),
    ('DILL_SEED', 'Dill seed',                      'spice',     'kg', 'Whole dill seed for the concentrate.',        '{}', false, 'dry',     720,  4200,   3.400,   2.000,   6.000, 'BOPSPICE', null),
    ('GARLIC',    'Garlic bulbs',                   'produce',   'kg', 'New Zealand grown, cured.',                   '{}', false, 'ambient', null, 1250,  11.500,   6.000,  20.000, 'PUKEKOHE', null),
    ('SALT_SEA',  'Marlborough sea salt',           'salt',      'kg', 'Solar-evaporated, medium flake, 25kg sacks.', '{}', false, 'dry',    1800,   640,  74.000,  40.000, 120.000, 'GRASSMERE',null),
    ('VIN_WHITE', 'White vinegar 10% acetic',       'acid',      'l',  '200L food-grade drums.',                      '{}', false, 'ambient', null,  310, 196.000, 100.000, 400.000, 'CANTVIN',  null),
    ('WATER_FILT','Filtered water',                 'water',     'l',  'Reverse osmosis, in-house.',                  '{}', false, 'ambient', null,     2,   0.000,   0.000,   0.000, null,       'Made on site. Costed at the metered rate for batch costing only.'),
    ('PEPPER_BLK','Black peppercorn',               'spice',     'kg', 'Whole Tellicherry.',                          '{}', false, 'dry',     720,  3900,   2.100,   1.500,   5.000, 'BOPSPICE', null),
    ('CORIAND',   'Coriander seed',                 'spice',     'kg', 'Whole, unroasted.',                           '{}', false, 'dry',     720,  2100,   2.800,   2.000,   6.000, 'BOPSPICE', null),
    ('MUSTARD',   'Yellow mustard seed',            'spice',     'kg', 'Whole yellow.',                               '{mustard}', false, 'dry', 720, 1450,   4.300,   3.000,   9.000, 'BOPSPICE', 'Declared allergen. Appears on every label that uses it.'),
    ('BAYLEAF',   'Bay leaf',                       'herb',      'kg', 'Whole dried leaf.',                           '{}', false, 'dry',     540,  5200,   0.850,   0.500,   2.000, 'BOPSPICE', null),
    ('CHILLI_LR', 'Hawke''s Bay long red chilli',   'produce',   'kg', 'Fresh long reds, roughly 12,000 SHU.',        '{}', true,  'chilled',  10,  1900,  10.400,   8.000,  30.000, 'HBHERBS',  'Heat varies by pick. Every batch gets tasted before the chilli goes in.'),
    ('TURMERIC',  'Fresh turmeric',                 'produce',   'kg', 'Fresh rhizome.',                              '{}', false, 'chilled',  21,  2400,   6.600,   5.000,  15.000, 'PUKEKOHE', 'Stains everything it touches. Dedicated boards.'),
    ('GINGER',    'Fresh ginger',                   'produce',   'kg', 'Fresh rhizome.',                              '{}', false, 'chilled',  30,  1650,   8.200,   6.000,  18.000, 'PUKEKOHE', null),
    ('CHERRY_SR', 'Central Otago sour cherries',    'produce',   'kg', 'Pitted, individually quick frozen.',          '{}', false, 'frozen',  365,  2950,  41.000,  20.000,  80.000, 'ORCHARD',  'One order a year in February. What we hold is what we get.'),
    ('FENNEL_SD', 'Fennel seed',                    'spice',     'kg', 'Whole.',                                      '{}', false, 'dry',     720,  2400,   1.900,   1.500,   5.000, 'BOPSPICE', null),
    ('SUGAR_CANE','Raw cane sugar',                 'sweetener', 'kg', 'Unrefined, 25kg sacks.',                      '{}', false, 'dry',     720,   290,  22.000,  15.000,  50.000, 'CANTVIN',  null),
    ('CITRIC',    'Citric acid',                    'acid',      'kg', 'Anhydrous, food grade.',                      '{}', false, 'dry',     900,   880,   4.900,   3.000,  10.000, 'CANTVIN',  null),
    ('BOTTLE_750','750ml flint glass bottle',       'packaging', 'ea', 'Flint glass, 38mm neck.',                     '{}', false, 'ambient', null,   118,1980.000,1200.000,3600.000, 'GLASSCO', 'Fourteen day lead time. Never let this one go short.'),
    ('CAP_38',    '38mm tamper-evident cap',        'packaging', 'ea', 'Brine-green, tamper band.',                   '{}', false, 'ambient', null,    22,4400.000,2500.000,7500.000, 'GLASSCO', null),
    ('LABEL_750', '750ml wrap label',               'label',     'ea', 'Uncoated stock, batch code overprinted.',     '{}', false, 'ambient', null,    31,2650.000,1500.000,4500.000, 'GLASSCO', 'Overprinted with the batch code at bottling. Never pre-printed.'),
    ('CAN_250',   '250ml sleek can',                'packaging', 'ea', 'Sleek 250ml, brine-green print.',             '{}', false, 'ambient', null,    44,1420.000,1500.000,6000.000, 'GLASSCO', 'Below reorder point. Marlow flagged it on the last sweep.')
  ) as i(code, name, cat, unit, descr, allergens, organic, storage, shelf, cost, stock, rp, rq, supplier_code, notes)
  left join public.suppliers s on s.code = i.supplier_code;

insert into public.ingredient_suppliers
  (ingredient_id, supplier_id, supplier_sku, unit, pack_size, pack_cost_cents, lead_time_days, minimum_quantity, is_preferred, last_quoted_at)
select i.id, s.id, x.sku, x.unit::public.unit_of_measure, x.pack, x.cost, x.lead, x.minq, x.preferred, now() - x.quoted_ago
  from (values
    ('CUCUMBER',  'PUKEKOHE', 'PKG-CUC-TEL',  'kg', 20.000,   9600,  3, 20.000, true,  interval '3 weeks'),
    ('DILL_FRESH','HBHERBS',  'HBH-DILL-HD',  'kg',  2.000,   5200,  4,  2.000, true,  interval '2 weeks'),
    ('DILL_FRESH','PUKEKOHE', 'PKG-DILL',     'kg',  1.000,   3100,  3,  5.000, false, interval '9 weeks'),
    ('DILL_SEED', 'BOPSPICE', 'BOP-DILLSD',   'kg',  5.000,  20500,  5,  5.000, true,  interval '5 weeks'),
    ('GARLIC',    'PUKEKOHE', 'PKG-GAR',      'kg', 10.000,  12200,  3, 10.000, true,  interval '3 weeks'),
    ('SALT_SEA',  'GRASSMERE','GSW-MED-25',   'kg', 25.000,  15600,  7, 25.000, true,  interval '4 months'),
    ('VIN_WHITE', 'CANTVIN',  'CVW-AC10-200', 'l', 200.000,  60500,  5,200.000, true,  interval '7 weeks'),
    ('PEPPER_BLK','BOPSPICE', 'BOP-PEPBLK',   'kg',  5.000,  19200,  5,  5.000, true,  interval '5 weeks'),
    ('CORIAND',   'BOPSPICE', 'BOP-CORSD',    'kg',  5.000,  10300,  5,  5.000, true,  interval '5 weeks'),
    ('MUSTARD',   'BOPSPICE', 'BOP-MUSTYEL',  'kg',  5.000,   7100,  5,  5.000, true,  interval '5 weeks'),
    ('BAYLEAF',   'BOPSPICE', 'BOP-BAY',      'kg',  1.000,   5200,  5,  1.000, true,  interval '5 weeks'),
    ('CHILLI_LR', 'HBHERBS',  'HBH-CHILR',    'kg',  5.000,   9300,  4,  5.000, true,  interval '2 weeks'),
    ('TURMERIC',  'PUKEKOHE', 'PKG-TURM',     'kg',  5.000,  11800,  3,  5.000, true,  interval '6 weeks'),
    ('GINGER',    'PUKEKOHE', 'PKG-GING',     'kg',  5.000,   8100,  3,  5.000, true,  interval '6 weeks'),
    ('CHERRY_SR', 'ORCHARD',  'COC-SRCH-IQF', 'kg', 10.000,  29000, 10, 20.000, true,  interval '7 months'),
    ('FENNEL_SD', 'BOPSPICE', 'BOP-FENSD',    'kg',  5.000,  11700,  5,  5.000, true,  interval '5 weeks'),
    ('SUGAR_CANE','CANTVIN',  'CVW-SUGRAW25', 'kg', 25.000,   7100,  5, 25.000, true,  interval '7 weeks'),
    ('CITRIC',    'CANTVIN',  'CVW-CITRIC',   'kg', 10.000,   8600,  5, 10.000, true,  interval '7 weeks'),
    ('BOTTLE_750','GLASSCO',  'OGC-750FL-38', 'ea',1200.000,140400, 14,1200.000, true, interval '5 weeks'),
    ('CAP_38',    'GLASSCO',  'OGC-CAP38-GRN','ea',2500.000, 54000, 14,2500.000, true, interval '5 weeks'),
    ('LABEL_750', 'GLASSCO',  'OGC-LBL750',   'ea',1500.000, 45500, 14,1500.000, true, interval '5 weeks'),
    ('CAN_250',   'GLASSCO',  'OGC-CAN250SL', 'ea',3000.000,130500, 21,3000.000, true, interval '8 weeks')
  ) as x(ing, sup, sku, unit, pack, cost, lead, minq, preferred, quoted_ago)
  join public.ingredients i on i.code = x.ing
  join public.suppliers s on s.code = x.sup;

insert into public.recipes
  (slug, version, name, description, product_id, status, batch_size_litres, expected_yield_units,
   target_ph, target_salinity_pct, ferment_days, steep_hours, method, equipment, allergen_statement,
   estimated_cost_cents, change_note, is_current, approved_by, approved_at)
select r.slug, r.version, r.name, r.descr, p.id, r.status::public.recipe_status,
       r.size_l, r.yield, r.ph, r.salinity, r.ferment, r.steep, r.method, r.equipment::text[],
       r.allergen, r.cost, r.change_note, r.is_current, o.id,
       case when r.status = 'draft' then null else now() - r.approved_ago end
  from (values
    ('house-dill-brine', 1, 'House Dill Brine v1', 'The original. 4.2% salt, ten days, no garlic.', 'classic-dill-brine', 'retired', 300.00, 390, 3.40, 4.20, 10, null,
     'Rack cucumbers, cover with 4.2% brine, hold at 18C for ten days, strain twice through muslin, bottle cold.',
     '{"300L fermenter","muslin","gravity filler"}', 'No declared allergens.', 68000, null, false, interval '26 months'),
    ('house-dill-brine', 2, 'House Dill Brine v2', 'Garlic added, salt lifted to 4.6%, twelve days.', 'classic-dill-brine', 'retired', 400.00, 520, 3.35, 4.60, 12, null,
     'As v1 with 0.9% crushed garlic added at day two. Salt lifted to 4.6% after three batches came in soft. Twelve days at 18C.',
     '{"400L fermenter","muslin","gravity filler"}', 'No declared allergens.', 89000,
     'Three v1 batches finished above pH 3.5 and tasted flat. Lifted salt to 4.6%, added garlic at day two and extended to twelve days.', false, interval '19 months'),
    ('house-dill-brine', 3, 'House Dill Brine v3', 'Current. Mustard seed in, second strain through a 5 micron pad.', 'classic-dill-brine', 'active', 480.00, 620, 3.30, 4.60, 12, null,
     'Rack 190kg cucumbers in the 480L fermenter. Cover with 4.6% brine. Dill heads, crushed garlic, black peppercorn, yellow mustard seed and bay at day two. Hold 18C for twelve days. Strain through muslin, then a 5 micron pad. Chill to 4C, bottle, cap, overprint the batch code.',
     '{"480L fermenter","muslin","5 micron pad","plate chiller","gravity filler","code printer"}',
     'Contains mustard. Gluten free. Suitable for vegans.', 92000,
     'Added yellow mustard seed for length on the finish and a 5 micron second strain to stop the faint haze that showed up after six weeks in the bottle. Mustard is now a declared allergen on the label.', true, interval '8 months'),
    ('fire-brine', 1, 'Fire Brine v1', 'v2 of the house brine with chilli at day one.', 'fire-brine', 'retired', 400.00, 520, 3.35, 4.60, 12, null,
     'House Dill v2 with 3.5% long red chilli added at day one.', '{"400L fermenter","muslin","gravity filler"}',
     'No declared allergens.', 96000, 'Chilli in at day one stripped the dill out. Heat was sharp and front-loaded.', false, interval '17 months'),
    ('fire-brine', 2, 'Fire Brine v2', 'Current. Chilli at day four, split whole rather than sliced.', 'fire-brine', 'active', 480.00, 610, 3.30, 4.60, 12, null,
     'House Dill v3 base. Split 17kg long reds lengthways and add at day four so the capsaicin infuses behind the dill rather than in front of it. Taste every batch before the chilli goes in — heat varies by pick.',
     '{"480L fermenter","muslin","5 micron pad","plate chiller","gravity filler","code printer"}',
     'Contains mustard. Gluten free. Suitable for vegans.', 108000,
     'Moved chilli from day one to day four and switched from sliced to split whole. Heat now arrives about three seconds late, which is what we wanted.', true, interval '11 months'),
    ('golden-hour', 1, 'Golden Hour v1', 'Turmeric and ginger, no dill, lighter salt.', 'golden-hour-brine', 'active', 300.00, 380, 3.45, 3.80, 8, null,
     'Lighter 3.8% brine, no dill. Fresh turmeric and ginger pressed and added at day one with coriander seed and 1.2% cane sugar. Eight days at 18C. Strain twice. Dedicated turmeric boards and a dedicated filler line — it stains.',
     '{"300L fermenter","press","muslin","5 micron pad","dedicated turmeric line"}',
     'No declared allergens. Gluten free. Suitable for vegans.', 74000, null, true, interval '9 months'),
    ('sour-cherry-fennel', 1, 'Sour Cherry and Fennel v1', 'Seasonal. Frozen Central Otago sour cherries, fennel seed, no dill.', 'sour-cherry-fennel', 'active', 200.00, 260, 3.25, 4.00, 14, null,
     'Thaw 48kg sour cherries overnight at 4C. 4.0% brine, fennel seed and a little star anise at day one, cherries at day three so the colour does not bleach. Fourteen days. Strain three times — the cherry pulp blinds a 5 micron pad fast.',
     '{"200L fermenter","muslin","5 micron pad","spare pads"}',
     'No declared allergens. Gluten free. Suitable for vegans.', 118000, null, true, interval '5 months'),
    ('bar-concentrate', 1, 'Bar Strength Concentrate v1', 'House Dill v3 reduced and salt-adjusted to pour at 5:1.', 'brine-concentrate', 'active', 120.00, 460, 3.10, 12.40, null, 6,
     'Take House Dill v3 finished brine and reduce under vacuum at 55C to one fifth volume. Adjust salt to 12.4% and acid with citric to pH 3.10. Steep dill seed six hours off heat. Strain, chill, bottle at 250ml.',
     '{"vacuum evaporator","refractometer","pH meter","250ml filler"}',
     'Contains mustard. Gluten free. Suitable for vegans.', 62000, null, true, interval '8 months'),
    ('spritz-base', 1, 'Half Sour Spritz base v1', 'House Dill v3 at 4% by volume with lime and carbonation.', 'half-sour-spritz', 'active', 600.00, 2400, 3.60, 0.19, null, null,
     'Blend House Dill v3 to 4% by volume with chilled filtered water and 0.6% lime. Carbonate to 3.4 volumes at 2C. Can at 250ml, seam check every fiftieth can, pasteurise in-can at 72C for ten minutes.',
     '{"blend tank","carbonator","seamer","seam gauge","tunnel pasteuriser"}',
     'Contains mustard. Gluten free. Suitable for vegans. Non-alcoholic.', 96000, null, true, interval '6 months'),
    ('pickleback-pack', 1, 'Pickleback Kit pack-out v1', 'Pack-out procedure, not a brine.', 'pickleback-kit', 'active', 1.00, 120, null, null, null, null,
     'Pack one 750ml Classic Dill, two Whanganui shot glasses in moulded pulp, one instruction card. Tape, weigh, and record the brine batch code on the pack sheet — the kit inherits its traceability from the bottle inside it.',
     '{"pack bench","scale","tape gun"}', 'Contains mustard (brine). Gluten free.', 4200, null, true, interval '13 months'),
    ('trio-pack', 1, 'Bar Cart Trio pack-out v1', 'Pack-out procedure for the gift box.', 'bar-cart-trio', 'active', 1.00, 90, null, null, null, null,
     'Pack one 250ml each of Classic, Fire and Golden Hour into the rigid box with three recipe cards. Record all three brine batch codes on the pack sheet.',
     '{"pack bench","scale"}', 'Contains mustard (Classic and Fire). Gluten free.', 5100, null, true, interval '10 months'),
    ('house-dill-brine', 4, 'House Dill Brine v4 (draft)', 'Trialling a 5% salt at ten days to shorten the cycle.', 'classic-dill-brine', 'draft', 480.00, 620, 3.28, 5.00, 10, null,
     'As v3 but at 5.0% salt and ten days instead of twelve. Two trial batches so far. Not approved and not to be run in production.',
     '{"480L fermenter","muslin","5 micron pad","plate chiller","gravity filler","code printer"}',
     'Contains mustard. Gluten free. Suitable for vegans.', 90000,
     'Trial only. Shortens the cycle by two days, which is roughly one extra batch a month. Waiting on a taste panel before it goes anywhere near a customer.', false, interval '3 weeks')
  ) as r(slug, version, name, descr, product_handle, status, size_l, yield, ph, salinity, ferment, steep,
         method, equipment, allergen, cost, change_note, is_current, approved_ago)
  left join public.products p on p.handle = r.product_handle
  cross join lateral (select id from public.operators where email = 'nadia@halfsour.co.nz') o;

update public.recipes r
   set supersedes_recipe_id = prev.id
  from public.recipes prev
 where prev.slug = r.slug and prev.version = r.version - 1;

update public.recipes set approved_by = null where status = 'draft';

insert into public.recipe_ingredients (recipe_id, ingredient_id, quantity, unit, percentage_of_batch, step_order, preparation, is_optional)
select r.id, i.id, x.qty, x.unit::public.unit_of_measure, x.pct, x.step, x.prep, x.optional
  from (values
    ('house-dill-brine', 3, 'CUCUMBER',   190.000, 'kg',  39.58, 1, 'Washed, ends trimmed, racked whole.', false),
    ('house-dill-brine', 3, 'WATER_FILT', 455.000, 'l',   94.79, 2, 'Filtered, held at 18C.', false),
    ('house-dill-brine', 3, 'SALT_SEA',    22.100, 'kg',   4.60, 3, 'Dissolved fully before racking.', false),
    ('house-dill-brine', 3, 'DILL_FRESH',   4.800, 'kg',   1.00, 4, 'Whole heads, added day two.', false),
    ('house-dill-brine', 3, 'GARLIC',       4.300, 'kg',   0.90, 5, 'Crushed, skins on, added day two.', false),
    ('house-dill-brine', 3, 'PEPPER_BLK',   0.960, 'kg',   0.20, 6, 'Whole, added day two.', false),
    ('house-dill-brine', 3, 'MUSTARD',      0.720, 'kg',   0.15, 7, 'Whole yellow, added day two. Declared allergen.', false),
    ('house-dill-brine', 3, 'BAYLEAF',      0.120, 'kg',   0.03, 8, 'Whole leaf, added day two.', false),
    ('fire-brine',       2, 'CUCUMBER',   190.000, 'kg',  39.58, 1, 'Washed, ends trimmed, racked whole.', false),
    ('fire-brine',       2, 'WATER_FILT', 455.000, 'l',   94.79, 2, 'Filtered, held at 18C.', false),
    ('fire-brine',       2, 'SALT_SEA',    22.100, 'kg',   4.60, 3, 'Dissolved fully before racking.', false),
    ('fire-brine',       2, 'DILL_FRESH',   4.800, 'kg',   1.00, 4, 'Whole heads, added day two.', false),
    ('fire-brine',       2, 'GARLIC',       4.300, 'kg',   0.90, 5, 'Crushed, skins on, added day two.', false),
    ('fire-brine',       2, 'CHILLI_LR',   17.000, 'kg',   3.54, 6, 'Split lengthways, seeds in, added day four.', false),
    ('fire-brine',       2, 'MUSTARD',      0.720, 'kg',   0.15, 7, 'Whole yellow, added day two.', false),
    ('fire-brine',       2, 'PEPPER_BLK',   0.960, 'kg',   0.20, 8, 'Whole, added day two.', false),
    ('golden-hour',      1, 'CUCUMBER',   112.000, 'kg',  37.33, 1, 'Washed, ends trimmed.', false),
    ('golden-hour',      1, 'WATER_FILT', 288.000, 'l',   96.00, 2, 'Filtered.', false),
    ('golden-hour',      1, 'SALT_SEA',    11.400, 'kg',   3.80, 3, 'Dissolved before racking.', false),
    ('golden-hour',      1, 'TURMERIC',     5.400, 'kg',   1.80, 4, 'Pressed, added day one. Dedicated boards.', false),
    ('golden-hour',      1, 'GINGER',       6.600, 'kg',   2.20, 5, 'Pressed, added day one.', false),
    ('golden-hour',      1, 'CORIAND',      0.900, 'kg',   0.30, 6, 'Whole, added day one.', false),
    ('golden-hour',      1, 'SUGAR_CANE',   3.600, 'kg',   1.20, 7, 'Dissolved into the brine.', false),
    ('sour-cherry-fennel',1,'CUCUMBER',    62.000, 'kg',  31.00, 1, 'Washed, ends trimmed.', false),
    ('sour-cherry-fennel',1,'WATER_FILT', 192.000, 'l',   96.00, 2, 'Filtered.', false),
    ('sour-cherry-fennel',1,'SALT_SEA',     8.000, 'kg',   4.00, 3, 'Dissolved before racking.', false),
    ('sour-cherry-fennel',1,'CHERRY_SR',   48.000, 'kg',  24.00, 4, 'Thawed overnight at 4C, added day three.', false),
    ('sour-cherry-fennel',1,'FENNEL_SD',    1.200, 'kg',   0.60, 5, 'Whole, added day one.', false),
    ('sour-cherry-fennel',1,'CITRIC',       0.300, 'kg',   0.15, 6, 'To final pH only if needed.', true),
    ('bar-concentrate',  1, 'WATER_FILT', 600.000, 'l',  500.00, 1, 'House Dill v3 finished brine, reduced to one fifth.', false),
    ('bar-concentrate',  1, 'SALT_SEA',    14.900, 'kg',  12.42, 2, 'Adjusted post-reduction against a refractometer.', false),
    ('bar-concentrate',  1, 'CITRIC',       0.480, 'kg',   0.40, 3, 'To pH 3.10.', false),
    ('bar-concentrate',  1, 'DILL_SEED',    0.600, 'kg',   0.50, 4, 'Steeped six hours off heat, then strained.', false),
    ('spritz-base',      1, 'WATER_FILT', 570.000, 'l',   95.00, 1, 'Chilled to 2C before blending.', false),
    ('spritz-base',      1, 'CITRIC',       0.180, 'kg',   0.03, 2, 'Acid trim only.', true),
    ('spritz-base',      1, 'CAN_250',   2400.000, 'ea',   null, 3, 'Seam check every fiftieth can.', false),
    ('pickleback-pack',  1, 'BOTTLE_750',   1.000, 'ea',   null, 1, 'One filled 750ml Classic Dill per kit.', false),
    ('trio-pack',        1, 'BOTTLE_750',   3.000, 'ea',   null, 1, 'Three 250ml bottles per box.', false)
  ) as x(slug, version, ing, qty, unit, pct, step, prep, optional)
  join public.recipes r on r.slug = x.slug and r.version = x.version
  join public.ingredients i on i.code = x.ing;
