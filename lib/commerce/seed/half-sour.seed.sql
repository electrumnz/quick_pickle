-- =============================================================================
-- HALF SOUR — commerce fixture for the mock provider
--
-- The real product line, as it exists in Shopify today: four brines plus the
-- three-bottle set, NZD, 500 ml bottles. No 04 WILD is stocked in genuinely
-- small numbers because its supply is limited by kawakawa leaf and not by
-- demand — the low-stock path is exercised by real fixture data, not by a
-- test that reaches in and sets it. Everything is written with provider = 'local' and
-- sync_status = 'local', which is the schema's discriminator for "this row was
-- never a mirror of a Shopify object" — so seeding a database does not make the
-- Shopify sync think it has work to do.
--
-- Historical orders are NOT in this file. They are placed through
-- `MockProvider.completeCheckout` by `lib/commerce/seed/index.ts` and then
-- backdated, so every order carries a real inventory ledger, a real discount
-- redemption and real customer rollups rather than hand-typed numbers that
-- happen to satisfy the check constraints.
--
-- Idempotent: safe to run twice.
-- =============================================================================

-- --- Locations ---------------------------------------------------------------
insert into public.inventory_locations
  (id, provider, sync_status, code, name, kind, address_line, suburb, city,
   region, postcode, country_code, is_active, is_default, ships_orders)
values
  ('44444444-0000-4000-8000-000000000001', 'local', 'local', 'KITCHEN',
   'Grey Lynn Kitchen', 'kitchen', '12 Elgin Street', 'Grey Lynn', 'Auckland',
   'Auckland', '1021', 'NZ', true, true, true),
  ('44444444-0000-4000-8000-000000000002', 'local', 'local', 'COOLSTORE',
   'Penrose Coolstore', 'coolstore', '6 Kerwyn Avenue', 'East Tamaki',
   'Auckland', 'Auckland', '2013', 'NZ', true, false, true),
  ('44444444-0000-4000-8000-000000000003', 'local', 'local', 'MARKET',
   'Saturday Market Stall', 'market_stall', 'Britomart Place', 'Britomart',
   'Auckland', 'Auckland', '1010', 'NZ', true, false, false)
on conflict (id) do nothing;

-- --- Products ----------------------------------------------------------------
insert into public.products
  (id, provider, sync_status, handle, title, subtitle, description, product_type,
   vendor, status, published_at, tags, seo_title, seo_description,
   requires_shipping, is_taxable, hero_image_url, position)
values
  ('11111111-0000-4000-8000-000000000001', 'local', 'local', 'no-01-house',
   'No 01 HOUSE', 'Dill, garlic, black pepper',
   'The brine our cucumbers come out of. Dill, garlic, cracked black pepper and sea salt, fermented slow and bottled unfiltered. Pour it as a pickleback chaser, split it with gin for a dirty martini, or build a Bloody Mary on it.',
   'Brine', 'Half Sour', 'active', now() - interval '240 days',
   array['brine','bar','mixer','pickleback','dill'],
   'No 01 HOUSE pickle brine — Half Sour',
   'Dill, garlic and black pepper pickle brine from Auckland. 500ml, made for the back bar.',
   true, true, '/products/no-01-house-500ml.jpg', 1),

  ('11111111-0000-4000-8000-000000000002', 'local', 'local', 'no-02-dirty',
   'No 02 DIRTY', 'Green olive, caper, lemon',
   'Built for one job. Green olive and caper brine sharpened with lemon peel, so a martini gets the salt and the cloud without the jar of olives going soft in your fridge door. Three parts gin, one part this.',
   'Brine', 'Half Sour', 'active', now() - interval '180 days',
   array['brine','bar','mixer','martini','olive'],
   'No 02 DIRTY olive brine — Half Sour',
   'Green olive and caper brine for dirty martinis. 500ml, NZ made.',
   true, true, '/products/no-02-dirty-500ml.jpg', 2),

  ('11111111-0000-4000-8000-000000000003', 'local', 'local', 'no-03-smoke',
   'No 03 SMOKE', 'Manuka-smoked chilli, bay',
   'Chillies smoked over manuka before they go in the crock, with bay and coriander seed behind them. The one to reach for when the spirit is mezcal or a peated whisky and you want the drink to taste like it came off a fire.',
   'Brine', 'Half Sour', 'active', now() - interval '90 days',
   array['brine','bar','mixer','smoke','chilli'],
   'No 03 SMOKE chilli brine — Half Sour',
   'Manuka-smoked chilli and bay pickle brine. 500ml, NZ made.',
   true, true, '/products/no-03-smoke-500ml.jpg', 3),

  ('11111111-0000-4000-8000-000000000004', 'local', 'local', 'the-full-set',
   'The Full Set', 'All three, one box',
   'One of each: HOUSE, DIRTY and SMOKE, 500ml apiece, in a box that survives the courier. The cheapest way to find out which one you actually reach for.',
   'Set', 'Half Sour', 'active', now() - interval '150 days',
   array['set','gift','bar','brine'],
   'The Full Set — three Half Sour brines',
   'All three Half Sour brines in one box. 3 x 500ml, NZ made.',
   true, true, '/products/the-full-set.jpg', 5),

  -- No sourcing relationship is asserted here. The leaf supply is a fact about
  -- how much can be made; naming a grower would be a place-of-origin claim
  -- (Fair Trading Act s 13(j)) and there is no verified grower yet.
  ('11111111-0000-4000-8000-000000000005', 'local', 'local', 'no-04-wild',
   'No 04 WILD', 'Kawakawa, kelp, lemon peel',
   'Kawakawa, kelp and lemon peel. Peppery off the leaf, maritime underneath, and the least like anything else on the shelf. Built for seafood: a capful over oysters, the acid in a ceviche, a martini that tastes like the coast. Made in small runs, because the leaf is what limits it and not the demand.',
   'Brine', 'Half Sour', 'active', now() - interval '40 days',
   array['brine','bar','mixer','seafood','kawakawa','kelp','limited'],
   'No 04 WILD kawakawa and kelp brine — Half Sour',
   'Kawakawa, kelp and lemon peel brine, made for seafood. 500ml, NZ made. Limited by leaf supply.',
   true, true, '/products/no-04-wild-500ml.jpg', 4)
on conflict (id) do nothing;

-- --- Variants ----------------------------------------------------------------
insert into public.product_variants
  (id, product_id, provider, sync_status, sku, barcode, title, size_ml,
   pack_count, price_cents, compare_at_price_cents, unit_cost_cents, currency,
   weight_grams, track_inventory, inventory_policy, is_trade_only,
   shelf_life_days, position)
values
  ('22222222-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001',
   'local', 'local', 'HS-01-500', '9421900110015', '500ml', 500, 1,
   1800, null, 640, 'NZD', 780, true, 'deny', false, 540, 1),

  ('22222222-0000-4000-8000-000000000002', '11111111-0000-4000-8000-000000000002',
   'local', 'local', 'HS-02-500', '9421900110022', '500ml', 500, 1,
   2000, null, 720, 'NZD', 780, true, 'deny', false, 540, 1),

  ('22222222-0000-4000-8000-000000000003', '11111111-0000-4000-8000-000000000003',
   'local', 'local', 'HS-03-500', '9421900110039', '500ml', 500, 1,
   2200, null, 810, 'NZD', 780, true, 'deny', false, 540, 1),

  ('22222222-0000-4000-8000-000000000004', '11111111-0000-4000-8000-000000000004',
   'local', 'local', 'HS-SET-3', '9421900110046', '3 x 500ml', 500, 3,
   5400, 6000, 2170, 'NZD', 2450, true, 'deny', false, 540, 1),

  -- Barcode is null because HS-04-500 has not been allocated a GTIN — the live
  -- Shopify variant carries none, and a made-up one is a made-up identifier.
  -- 'deny' and track_inventory, deliberately: a bottle that cannot be made to
  -- order must not be backorderable.
  ('22222222-0000-4000-8000-000000000005', '11111111-0000-4000-8000-000000000005',
   'local', 'local', 'HS-04-500', null, '500ml', 500, 1,
   2600, null, 1015, 'NZD', 780, true, 'deny', false, 365, 1)
on conflict (id) do nothing;

-- --- Images ------------------------------------------------------------------
insert into public.product_images
  (id, product_id, variant_id, provider, sync_status, url, alt_text, position,
   width_px, height_px)
values
  ('88888888-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001',
   null, 'local', 'local', '/products/no-01-house-500ml.jpg',
   'A 500ml bottle of Half Sour No 01 HOUSE brine', 1, 1600, 2000),
  ('88888888-0000-4000-8000-000000000002', '11111111-0000-4000-8000-000000000001',
   '22222222-0000-4000-8000-000000000001', 'local', 'local',
   '/products/no-01-house-pour.jpg',
   'No 01 HOUSE brine poured into a shot glass beside a whiskey', 2, 1600, 2000),
  ('88888888-0000-4000-8000-000000000003', '11111111-0000-4000-8000-000000000002',
   null, 'local', 'local', '/products/no-02-dirty-500ml.jpg',
   'A 500ml bottle of Half Sour No 02 DIRTY brine', 1, 1600, 2000),
  ('88888888-0000-4000-8000-000000000004', '11111111-0000-4000-8000-000000000003',
   null, 'local', 'local', '/products/no-03-smoke-500ml.jpg',
   'A 500ml bottle of Half Sour No 03 SMOKE brine', 1, 1600, 2000),
  ('88888888-0000-4000-8000-000000000005', '11111111-0000-4000-8000-000000000004',
   null, 'local', 'local', '/products/the-full-set.jpg',
   'All three Half Sour brines in their shipping box', 1, 2000, 2000),
  ('88888888-0000-4000-8000-000000000006', '11111111-0000-4000-8000-000000000005',
   null, 'local', 'local', '/products/no-04-wild-500ml.jpg',
   'A 500ml bottle of Half Sour No 04 WILD brine', 1, 1600, 2000)
on conflict (id) do nothing;

-- --- Collections -------------------------------------------------------------
insert into public.collections
  (id, provider, sync_status, handle, title, description, image_url,
   is_published, published_at, position, is_smart, seo_title, seo_description)
values
  ('33333333-0000-4000-8000-000000000001', 'local', 'local', 'brines',
   'The Brines', 'Four brines, one bottle size, no filler.',
   '/collections/brines.jpg', true, now() - interval '240 days', 1, false,
   'Pickle brines — Half Sour', 'Every Half Sour brine, 500ml each.'),
  ('33333333-0000-4000-8000-000000000002', 'local', 'local', 'bar-and-mixers',
   'Bar & Mixers', 'What to put behind the bar. Every bottle we make earns its place next to a spirit.',
   '/collections/bar-and-mixers.jpg', true, now() - interval '200 days', 2, false,
   'Bar mixers — Half Sour', 'Pickle brines built for picklebacks, martinis and Bloody Marys.'),
  ('33333333-0000-4000-8000-000000000003', 'local', 'local', 'sets-and-gifts',
   'Sets & Gifts', 'Boxed, and packed to survive a courier.',
   '/collections/sets-and-gifts.jpg', true, now() - interval '150 days', 3, false,
   'Gift sets — Half Sour', 'Half Sour brine sets, boxed and ready to send.')
on conflict (id) do nothing;

insert into public.collection_products (collection_id, product_id, position)
values
  ('33333333-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001', 1),
  ('33333333-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000002', 2),
  ('33333333-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000003', 3),
  ('33333333-0000-4000-8000-000000000002', '11111111-0000-4000-8000-000000000002', 1),
  ('33333333-0000-4000-8000-000000000002', '11111111-0000-4000-8000-000000000001', 2),
  ('33333333-0000-4000-8000-000000000002', '11111111-0000-4000-8000-000000000003', 3),
  ('33333333-0000-4000-8000-000000000002', '11111111-0000-4000-8000-000000000004', 4),
  ('33333333-0000-4000-8000-000000000003', '11111111-0000-4000-8000-000000000004', 1),
  ('33333333-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000005', 4),
  ('33333333-0000-4000-8000-000000000002', '11111111-0000-4000-8000-000000000005', 5)
on conflict (collection_id, product_id) do nothing;

-- --- Inventory ---------------------------------------------------------------
insert into public.inventory_levels
  (variant_id, location_id, provider, sync_status, on_hand, committed, incoming,
   reorder_point, reorder_quantity, last_counted_at)
values
  ('22222222-0000-4000-8000-000000000001', '44444444-0000-4000-8000-000000000001',
   'local', 'local', 132, 0, 0, 48, 240, now() - interval '9 days'),
  ('22222222-0000-4000-8000-000000000001', '44444444-0000-4000-8000-000000000002',
   'local', 'local', 264, 0, 120, 96, 480, now() - interval '9 days'),
  ('22222222-0000-4000-8000-000000000002', '44444444-0000-4000-8000-000000000001',
   'local', 'local', 74, 0, 0, 36, 180, now() - interval '9 days'),
  ('22222222-0000-4000-8000-000000000002', '44444444-0000-4000-8000-000000000002',
   'local', 'local', 158, 0, 0, 72, 360, now() - interval '9 days'),
  ('22222222-0000-4000-8000-000000000003', '44444444-0000-4000-8000-000000000001',
   'local', 'local', 41, 0, 0, 24, 120, now() - interval '9 days'),
  ('22222222-0000-4000-8000-000000000003', '44444444-0000-4000-8000-000000000002',
   'local', 'local', 96, 0, 60, 48, 240, now() - interval '9 days'),
  ('22222222-0000-4000-8000-000000000004', '44444444-0000-4000-8000-000000000001',
   'local', 'local', 26, 0, 0, 12, 60, now() - interval '9 days'),
  ('22222222-0000-4000-8000-000000000004', '44444444-0000-4000-8000-000000000002',
   'local', 'local', 63, 0, 0, 24, 120, now() - interval '9 days'),
  ('22222222-0000-4000-8000-000000000001', '44444444-0000-4000-8000-000000000003',
   'local', 'local', 18, 0, 0, 0, 0, now() - interval '2 days'),
  -- No 04 WILD. Fourteen bottles across the two locations that ship, which is
  -- under the storefront's low-stock threshold on purpose: this is what the
  -- last kawakawa harvest yielded. reorder_point is 0 because there is nothing
  -- to reorder — the ops agent's morning queue must not raise a purchase order
  -- against a constraint no supplier can fill.
  ('22222222-0000-4000-8000-000000000005', '44444444-0000-4000-8000-000000000001',
   'local', 'local', 9, 0, 0, 0, 0, now() - interval '4 days'),
  ('22222222-0000-4000-8000-000000000005', '44444444-0000-4000-8000-000000000002',
   'local', 'local', 5, 0, 0, 0, 0, now() - interval '4 days')
on conflict (variant_id, location_id) do nothing;

-- --- Customers ---------------------------------------------------------------
insert into public.customers
  (id, provider, sync_status, email, first_name, last_name, phone, customer_type,
   company_name, accepts_marketing, marketing_opt_in_at, tags, note, currency)
values
  ('55555555-0000-4000-8000-000000000001', 'local', 'local',
   'aroha.ngata@example.co.nz', 'Aroha', 'Ngata', '+64 21 447 992', 'retail',
   null, true, now() - interval '210 days', array['newsletter'], null, 'NZD'),
  ('55555555-0000-4000-8000-000000000002', 'local', 'local',
   'tom.blackwood@example.co.nz', 'Tom', 'Blackwood', '+64 27 118 640', 'retail',
   null, false, null, array[]::text[], null, 'NZD'),
  ('55555555-0000-4000-8000-000000000003', 'local', 'local',
   'meiling.chen@example.co.nz', 'Mei-Ling', 'Chen', '+64 22 903 517', 'retail',
   null, true, now() - interval '64 days', array['newsletter','gift-buyer'],
   null, 'NZD'),
  ('55555555-0000-4000-8000-000000000004', 'local', 'local',
   'orders@brasspenny.example.nz', 'Dan', 'Petersen', '+64 9 361 2280', 'trade',
   'The Brass Penny', false, null, array['trade','ponsonby'],
   'Orders Thursdays for the weekend. Deliver to the Vermont Street door.', 'NZD'),
  ('55555555-0000-4000-8000-000000000005', 'local', 'local',
   'sione.tuilagi@example.co.nz', 'Sione', 'Tuilagi', '+64 21 660 204', 'retail',
   null, false, null, array[]::text[], null, 'NZD')
on conflict (id) do nothing;

insert into public.addresses
  (id, customer_id, provider, sync_status, label, address_type, first_name,
   last_name, company, line1, line2, suburb, city, region, postcode,
   country_code, phone, delivery_instructions, is_default)
values
  ('66666666-0000-4000-8000-000000000001', '55555555-0000-4000-8000-000000000001',
   'local', 'local', 'Home', 'shipping', 'Aroha', 'Ngata', null,
   '48 Surrey Crescent', null, 'Grey Lynn', 'Auckland', 'Auckland', '1021',
   'NZ', '+64 21 447 992', 'Leave by the side gate.', true),
  ('66666666-0000-4000-8000-000000000002', '55555555-0000-4000-8000-000000000002',
   'local', 'local', 'Home', 'shipping', 'Tom', 'Blackwood', null,
   '9 Ellice Street', 'Flat 2', 'Mount Victoria', 'Wellington', 'Wellington',
   '6011', 'NZ', '+64 27 118 640', null, true),
  ('66666666-0000-4000-8000-000000000003', '55555555-0000-4000-8000-000000000003',
   'local', 'local', 'Home', 'shipping', 'Mei-Ling', 'Chen', null,
   '132 Papanui Road', null, 'Merivale', 'Christchurch', 'Canterbury', '8014',
   'NZ', '+64 22 903 517', null, true),
  ('66666666-0000-4000-8000-000000000004', '55555555-0000-4000-8000-000000000004',
   'local', 'local', 'Bar', 'shipping', 'Dan', 'Petersen', 'The Brass Penny',
   '14 Vermont Street', null, 'Ponsonby', 'Auckland', 'Auckland', '1011',
   'NZ', '+64 9 361 2280', 'Deliveries before 3pm, Vermont Street door.', true),
  ('66666666-0000-4000-8000-000000000005', '55555555-0000-4000-8000-000000000005',
   'local', 'local', 'Home', 'shipping', 'Sione', 'Tuilagi', null,
   '27 Ruakura Road', null, 'Hamilton East', 'Hamilton', 'Waikato', '3216',
   'NZ', '+64 21 660 204', null, true)
on conflict (id) do nothing;

update public.customers c
   set default_address_id = a.id
  from public.addresses a
 where a.customer_id = c.id
   and a.is_default
   and a.address_type = 'shipping'
   and c.default_address_id is null;

-- --- Discounts ---------------------------------------------------------------
insert into public.discounts
  (id, provider, sync_status, code, title, description, value_type, value_bp,
   value_cents, currency, applies_to, target_product_id, target_collection_id,
   minimum_subtotal_cents, minimum_quantity, customer_type_restriction,
   once_per_customer, usage_limit, usage_limit_per_customer, used_count,
   starts_at, ends_at, status)
values
  ('77777777-0000-4000-8000-000000000001', 'local', 'local', 'WELCOME10',
   '10% off your first order', 'Ten percent off orders over $40.',
   'percentage', 1000, null, 'NZD', 'order', null, null,
   4000, null, null, true, null, null, 0,
   now() - interval '300 days', null, 'active'),

  ('77777777-0000-4000-8000-000000000002', 'local', 'local', 'FULLSET5',
   '$5 off The Full Set', 'Five dollars off the three-bottle set.',
   'fixed_amount', null, 500, 'NZD', 'product',
   '11111111-0000-4000-8000-000000000004', null,
   null, null, null, false, 500, 2, 0,
   now() - interval '120 days', null, 'active'),

  ('77777777-0000-4000-8000-000000000003', 'local', 'local', 'FREIGHTFREE',
   'Free shipping over $90', 'Free NZ-wide shipping on orders over $90.',
   'free_shipping', null, null, 'NZD', 'shipping', null, null,
   9000, null, null, false, null, null, 0,
   now() - interval '60 days', null, 'active'),

  ('77777777-0000-4000-8000-000000000004', 'local', 'local', 'BARFLY',
   'Trade: 15% off', 'Fifteen percent off for stocked bars and restaurants.',
   'percentage', 1500, null, 'NZD', 'order', null, null,
   null, 6, 'trade', false, null, null, 0,
   now() - interval '150 days', null, 'active'),

  ('77777777-0000-4000-8000-000000000005', 'local', 'local', 'LAUNCH20',
   'Launch week', 'Twenty percent off, launch week only.',
   'percentage', 2000, null, 'NZD', 'order', null, null,
   null, null, null, false, null, null, 214,
   now() - interval '240 days', now() - interval '233 days', 'expired'),

  ('77777777-0000-4000-8000-000000000006', 'local', 'local', 'SUMMERSET',
   'Summer set offer', 'Scheduled for the summer gift push.',
   'percentage', 1200, null, 'NZD', 'collection', null,
   '33333333-0000-4000-8000-000000000003',
   null, null, null, false, null, null, 0,
   now() + interval '30 days', now() + interval '75 days', 'scheduled')
on conflict (id) do nothing;
