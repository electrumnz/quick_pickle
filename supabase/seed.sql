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
