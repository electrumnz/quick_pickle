-- =============================================================================
-- HALF SOUR — 12 RENAME: "The Full Set" becomes "The First Three"
--
-- WHY
--
-- HS-SET-3 holds No 01 HOUSE, No 02 DIRTY and No 03 SMOKE. It was named "The
-- Full Set" when those three were the entire range. No 04 WILD is now a live
-- SKU (see 20260103000100_catalogue_no_04_wild.sql), so a box sold as the FULL
-- set while missing a quarter of the range stopped being a name and became a
-- representation about composition — Fair Trading Act 1986 s 13(a) covers a
-- false or misleading representation that goods are of a particular kind,
-- quantity or composition, and s 40(1) makes that an offence. A customer
-- reported it, which is the fact that settles the argument about whether a
-- reasonable consumer reads it that way.
--
-- "The First Three" leans on numbering the labels already carry, is literally
-- true of what is in the box, and reads as though No 04 sits beyond it rather
-- than having been forgotten.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--
--   * It does not change the SKU. HS-SET-3 is an identifier, not a name.
--     Changing it would orphan the Shopify variant, the seeded orders, the
--     inventory rows and every order line already shipped against it.
--   * It does not change the handle. `the-full-set` is a live URL on
--     half-sour.vercel.app and there is no redirect layer to catch a 404. A
--     stale slug is cheaper than a dead link.
--   * It does not change the price, the variant, the pack-out recipe, the
--     batches, or the composition. No 04 WILD is NOT added to the box: there
--     are 17 sellable bottles of it and it is limited by leaf supply, so
--     putting it in a standard set would sell the set out and break it for
--     everybody. This is a rename, not a recomposition.
--   * It does not rewrite anything that has already happened. Delivered email,
--     published social posts, agent transcripts and decided approvals keep the
--     words that were actually used at the time. Only rows that are still
--     ahead of the customer — draft, queued, scheduled, pending — are updated.
--
-- WHY A MIGRATION AND NOT AN EDIT TO seed.sql
--
-- Same reason as 20260103000100: `supabase/seed.sql` opens with a truncate. It
-- builds a database and cannot edit one. The seeds carry the new name for a
-- database built from scratch; this file carries it to a database that already
-- exists. Every statement is guarded on the old string, so it is idempotent and
-- a no-op on a fresh build.
-- =============================================================================

-- --- Catalogue ---------------------------------------------------------------
-- The Shopify product title was changed to match on 30 Aug 2026, so the mirror
-- and the source agree and sync_status is left alone rather than being dirtied.
update public.products
   set title     = 'The First Three',
       seo_title = 'The First Three — Nos 01, 02 and 03 boxed | Half Sour'
 where handle = 'the-full-set'
   and title = 'The Full Set';

update public.product_images
   set alt_text = replace(alt_text, 'The Full Set', 'The First Three')
 where alt_text like '%The Full Set%';

update public.collections
   set description = replace(description, 'The Full Set', 'The First Three'),
       seo_description = replace(seo_description, 'The Full Set', 'The First Three')
 where description like '%The Full Set%'
    or seo_description like '%The Full Set%';

-- Codes are unchanged (FULLSET5, SETFREIGHT are identifiers a customer types);
-- only the names a customer reads move.
update public.discounts
   set title = replace(title, 'The Full Set', 'The First Three'),
       description = replace(description, 'The Full Set', 'The First Three')
 where title like '%The Full Set%'
    or description like '%The Full Set%';

-- --- Production --------------------------------------------------------------
-- Ingredient codes (BOX_SET3, CARD_SET3) and the recipe slug (full-set-pack)
-- are identifiers and stay. Batch codes and pack sheets are history and stay.
update public.ingredients
   set name = replace(name, 'The Full Set', 'The First Three')
 where name like '%The Full Set%';

update public.recipes
   set name = replace(name, 'The Full Set', 'The First Three')
 where name like '%The Full Set%';

-- --- Marketing that has not gone out yet -------------------------------------
update public.campaigns
   set name = replace(name, 'The Full Set', 'The First Three')
 where name like '%The Full Set%'
   and status in ('draft', 'scheduled', 'paused');

update public.social_posts
   set caption = replace(caption, 'The Full Set', 'The First Three'),
       first_comment = replace(first_comment, 'The Full Set', 'The First Three'),
       hashtags = array_replace(hashtags, 'thefullset', 'thefirstthree')
 where status in ('draft', 'pending_approval', 'scheduled')
   and (caption like '%The Full Set%'
     or first_comment like '%The Full Set%'
     or 'thefullset' = any (hashtags));

-- A delivered email is a record of what was sent. Only mail still in the queue
-- is rewritten.
update public.email_sends
   set subject = replace(subject, 'The Full Set', 'The First Three'),
       preheader = replace(preheader, 'The Full Set', 'The First Three'),
       body_text = replace(body_text, 'The Full Set', 'The First Three')
 where status in ('draft', 'queued')
   and (subject like '%The Full Set%'
     or preheader like '%The Full Set%'
     or body_text like '%The Full Set%');

-- --- What the agents read ----------------------------------------------------
-- These rows are the standing instruction an agent is handed before it writes a
-- word. Leaving the old name here is how the rename gets undone by the next
-- draft that quotes it back.
update public.brand_rules
   set rule = replace(rule, 'The Full Set', 'The First Three'),
       rationale = replace(rationale, 'The Full Set', 'The First Three'),
       good_example = replace(good_example, 'The Full Set', 'The First Three')
 where rule like '%The Full Set%'
    or rationale like '%The Full Set%'
    or good_example like '%The Full Set%';

-- Held whole as jsonb, so the rewrite is on the document text and back. The
-- market model's own figures are untouched: $54 across three bottles still
-- realises $18 a bottle, which is what the rationale says.
update public.strategy_documents
   set body = replace(body::text, 'The Full Set', 'The First Three')::jsonb
 where body::text like '%The Full Set%';

update public.strategy_assumptions
   set rationale = replace(rationale, 'The Full Set', 'The First Three')
 where rationale like '%The Full Set%';

-- One assumption's rationale was reworded rather than substituted, because
-- "The First Three's three" reads as a stammer where "The Full Set's three"
-- did not.
update public.strategy_assumptions
   set rationale = replace(
         rationale,
         'Between a single bottle and The First Three''s three.',
         'Between a single bottle and the three bottles in The First Three.')
 where slug = 'bottlesPerDtcOrder'
   and rationale like '%The First Three''s three.%';

update public.strategy_avatars
   set body = replace(body::text, 'The Full Set', 'The First Three')::jsonb
 where body::text like '%The Full Set%';

-- --- The approvals queue -----------------------------------------------------
-- A pending approval is a thing the founder is about to say yes to, and this
-- one is an email to the lapsed list naming the product. Approve it with the
-- old title and the rename ships to customers in the same breath as the fix.
-- Decided approvals are history and are left exactly as they were decided.
update public.approvals
   set title   = replace(title, 'The Full Set', 'The First Three'),
       summary = replace(summary, 'The Full Set', 'The First Three'),
       preview = replace(preview::text, 'The Full Set', 'The First Three')::jsonb
 where status = 'pending'
   and (title like '%The Full Set%'
     or summary like '%The Full Set%'
     or preview::text like '%The Full Set%');
