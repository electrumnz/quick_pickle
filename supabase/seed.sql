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
