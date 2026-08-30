"use server";

import { revalidatePath } from "next/cache";

import {
  adminSql,
  commerce,
  decimal,
  int,
  text,
  textOrNull,
} from "@/components/admin/data/db";
import { count, money, quantity } from "@/components/admin/data/format";
import {
  audit,
  authorise,
  done,
  readChoice,
  readDate,
  readId,
  readOptionalText,
  readQuantity,
  readReturnPath,
  readWholeNumber,
  refuse,
} from "@/components/admin/write/guard";
import { CommerceError } from "@/lib/commerce";
import type { SqlExecutor } from "@/lib/commerce";

import { COUNT_REASON_WORDS, INVENTORY_REASONS } from "./words";

/**
 * Stock & Batches — correcting a count, opening a batch, letting one go.
 *
 * Two doors, and which one each write goes through is deliberate.
 *
 * **Correcting a count goes through the commerce provider.** Bottles on a
 * shelf are inventory, inventory is Shopify's, and `adjustInventory` is
 * `inventoryAdjustQuantities`. It writes the level and the ledger entry in one
 * transaction and refuses to take a count below zero.
 *
 * **A batch does not, because Shopify has no idea what one is.** There is no
 * `batch_release` in the provider's reason set for exactly that reason, so
 * opening and releasing a batch is SQL against Half Sour's own production
 * tables — and it writes the same `inventory_adjustments` ledger the provider
 * writes to, with `batch_id` filled in, in the same transaction as the level.
 *
 * That last detail is the traceability rule, and it is the reason none of this
 * is a couple of one-line updates. Opening a batch copies the recipe's
 * ingredients onto the batch, so every bottle traces back to what went in it
 * and to the supplier it came from. Releasing one stamps the ledger entry that
 * put those bottles on the shelf with the batch that made them. Neither link
 * can be reconstructed later if it is not written at the time, and the Food Act
 * does not accept "we can work it out".
 */

const BACK = "/admin/stock";

/* -------------------------------------------------------- correcting counts */

export async function adjustStockAction(formData: FormData): Promise<void> {
  const operator = await authorise(formData);
  const back = readReturnPath(formData, BACK);
  const variantId = readId(formData, "variantId");
  const locationId = readId(formData, "locationId");
  const direction = readChoice(formData, "direction", [
    "add",
    "remove",
  ] as const);
  const size = readWholeNumber(formData, "size", { min: 1, max: 100_000 });
  const reason = readChoice(formData, "reason", INVENTORY_REASONS);
  const note = readOptionalText(formData, "note", 300);
  const delta = direction === "add" ? size : -size;

  const before = await levelNow(variantId, locationId);

  try {
    const result = await commerce().adjustInventory({
      reason,
      changes: [{ variantId, locationId, delta }],
      ...(note === null ? {} : { note }),
    });
    const applied = result.changes[0];
    await audit({
      operator,
      action: "adjust",
      entityType: "inventory_levels",
      entityId: variantId,
      entityLabel: before.label,
      summary: `${direction === "add" ? "Added" : "Took off"} ${count(size)} of ${before.label} at ${before.locationName} — ${(COUNT_REASON_WORDS[reason] ?? reason).toLowerCase()}.${note === null ? "" : ` ${note}`}`,
      before: { on_hand: before.onHand, location: before.locationName },
      after: {
        on_hand: applied?.quantityAfterChange ?? before.onHand + delta,
        delta,
        reason,
      },
    });
  } catch (cause) {
    // The provider refuses a count that would go below zero, and it is right
    // to: a negative number of bottles on a shelf is not a thing.
    if (
      cause instanceof CommerceError &&
      cause.code === "INVENTORY_WOULD_GO_NEGATIVE"
    ) {
      refuse(back, "stock-would-go-negative");
    }
    throw cause;
  }

  revalidateStock();
  done(back, "adjusted");
}

/* ------------------------------------------------------------- reorder point */

export async function setReorderPointAction(formData: FormData): Promise<void> {
  const operator = await authorise(formData);
  const back = readReturnPath(formData, BACK);
  const ingredientId = readId(formData, "ingredientId");
  const reorderPoint = readQuantity(formData, "reorderPoint", {
    min: 0,
    max: 1_000_000,
  });
  const reorderQuantity = readQuantity(formData, "reorderQuantity", {
    min: 0,
    max: 1_000_000,
  });

  const sql = adminSql();
  const current = await sql.query(
    `select name, unit, reorder_point, reorder_quantity
       from public.ingredients where id = $1`,
    [ingredientId],
  );
  const row = current.rows[0];
  if (row === undefined) refuse(back, "order-gone");

  await sql.query(
    `update public.ingredients
        set reorder_point = $2, reorder_quantity = $3, updated_at = now()
      where id = $1`,
    [ingredientId, reorderPoint, reorderQuantity],
  );

  const unit = text(row, "unit");
  await audit({
    operator,
    action: "update",
    entityType: "ingredients",
    entityId: ingredientId,
    entityLabel: text(row, "name"),
    summary: `${text(row, "name")} now flags as low at ${quantity(reorderPoint, unit)}, and the usual order is ${quantity(reorderQuantity, unit)}.`,
    before: {
      reorder_point: decimal(row, "reorder_point"),
      reorder_quantity: decimal(row, "reorder_quantity"),
    },
    after: { reorder_point: reorderPoint, reorder_quantity: reorderQuantity },
  });
  revalidateStock();
  done(back, "reorder-set");
}

/* --------------------------------------------------------------- open a batch */

/**
 * Start a batch, and write down what went into it.
 *
 * The ingredient lines are copied from the recipe and scaled by how much brine
 * she is actually making, then the store room comes down by that much. That
 * copy is the one-step-back half of traceability: a recipe can be edited
 * tomorrow, and the batch has to keep saying what was in it today.
 */
export async function openBatchAction(formData: FormData): Promise<void> {
  const operator = await authorise(formData);
  const back = readReturnPath(formData, BACK);
  const recipeId = readId(formData, "recipeId");
  const locationId = readId(formData, "locationId");
  const litres = readQuantity(formData, "litres", { min: 1, max: 10_000 });
  const notes = readOptionalText(formData, "notes", 500);

  const opened = await adminSql().transaction(async (tx) => {
    const recipeRow = await tx.query(
      `select r.id, r.name, r.batch_size_litres, r.product_id,
              p.title as product_title,
              (select v.id from public.product_variants v
                where v.product_id = r.product_id and v.deleted_at is null
                order by v.position limit 1) as variant_id,
              (select v.sku from public.product_variants v
                where v.product_id = r.product_id and v.deleted_at is null
                order by v.position limit 1) as sku
         from public.recipes r
         join public.products p on p.id = r.product_id
        where r.id = $1 and r.status = 'active' and r.product_id is not null`,
      [recipeId],
    );
    const recipe = recipeRow.rows[0];
    if (recipe === undefined) return null;

    const code = await nextBatchCode(tx, text(recipe, "sku"));
    const scale =
      decimal(recipe, "batch_size_litres") > 0
        ? litres / decimal(recipe, "batch_size_litres")
        : 1;

    const lines = await tx.query(
      `select ri.ingredient_id, ri.quantity, ri.unit, i.name,
              i.standard_cost_cents, i.preferred_supplier_id, i.stock_on_hand
         from public.recipe_ingredients ri
         join public.ingredients i on i.id = ri.ingredient_id
        where ri.recipe_id = $1 and not ri.is_optional
        order by ri.step_order`,
      [recipeId],
    );

    let ingredientCostCents = 0;
    const used: { name: string; used: number; unit: string }[] = [];
    for (const line of lines.rows) {
      const needed =
        Math.round(decimal(line, "quantity") * scale * 1000) / 1000;
      if (needed <= 0) continue;
      // Money stays integer cents: the per-unit cost is a whole number of
      // cents and the line total is rounded once, here, not accumulated.
      const lineCents = Math.round(int(line, "standard_cost_cents") * needed);
      ingredientCostCents += lineCents;
      used.push({
        name: text(line, "name"),
        used: needed,
        unit: text(line, "unit"),
      });
    }

    const inserted = await tx.query(
      `insert into public.batches
         (batch_code, recipe_id, product_id, variant_id, location_id, status,
          planned_for, produced_at, yield_litres, ingredient_cost_cents, notes)
       values ($1, $2, $3, $4, $5, 'fermenting', now(), now(), $6, $7, $8)
       returning id`,
      [
        code,
        recipeId,
        text(recipe, "product_id"),
        textOrNull(recipe, "variant_id"),
        locationId,
        litres,
        ingredientCostCents,
        notes,
      ],
    );
    const batchId = text(inserted.rows[0] ?? {}, "id");

    for (const line of lines.rows) {
      const needed =
        Math.round(decimal(line, "quantity") * scale * 1000) / 1000;
      if (needed <= 0) continue;
      await tx.query(
        `insert into public.batch_ingredients
           (batch_id, ingredient_id, supplier_id, quantity, unit,
            unit_cost_cents, total_cost_cents)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          batchId,
          text(line, "ingredient_id"),
          textOrNull(line, "preferred_supplier_id"),
          needed,
          text(line, "unit"),
          int(line, "standard_cost_cents"),
          Math.round(int(line, "standard_cost_cents") * needed),
        ],
      );
      // The store room comes down by what the recipe uses. Floored at zero,
      // because a negative weight of dill is not a fact — if a line floors, the
      // count was already wrong and "I counted them" is how she fixes it.
      await tx.query(
        `update public.ingredients
            set stock_on_hand = greatest(0, stock_on_hand - $2), updated_at = now()
          where id = $1`,
        [text(line, "ingredient_id"), needed],
      );
    }

    return {
      batchId,
      code,
      productTitle: text(recipe, "product_title"),
      recipeName: text(recipe, "name"),
      ingredientCostCents,
      used,
    };
  });

  if (opened === null) refuse(back, "batch-gone");

  await audit({
    operator,
    action: "create",
    entityType: "batches",
    entityId: opened.batchId,
    entityLabel: opened.code,
    summary: `Opened batch ${opened.code} — ${quantity(litres, "litres")} of ${opened.productTitle} on ${opened.recipeName}. ${money(opened.ingredientCostCents)} of ingredients, taken off the store room.`,
    before: null,
    after: {
      batch_code: opened.code,
      status: "fermenting",
      yield_litres: litres,
      ingredient_cost_cents: opened.ingredientCostCents,
      ingredients: opened.used,
    },
  });
  revalidateStock();
  done(back, "batch-opened");
}

/* ------------------------------------------------------------ release a batch */

/**
 * Let a batch go, and put its bottles on the shelf.
 *
 * The ledger entry carries `batch_id`, which is the forward half of
 * traceability: a bottle that ships later can be walked back through
 * `order_item_batches` to this batch, and from this batch to the ingredient
 * lots written when it was opened.
 */
export async function releaseBatchAction(formData: FormData): Promise<void> {
  const operator = await authorise(formData);
  const back = readReturnPath(formData, BACK);
  const batchId = readId(formData, "batchId");
  const produced = readWholeNumber(formData, "unitsProduced", {
    min: 1,
    max: 1_000_000,
  });
  const rejected = readWholeNumber(formData, "unitsRejected", {
    min: 0,
    max: 1_000_000,
  });
  const bestBefore = readDate(formData, "bestBefore");
  const locationId = readId(formData, "locationId");
  const qaNotes = readOptionalText(formData, "qaNotes", 500);
  if (formData.get("qaPassed") !== "on") refuse(back, "batch-not-ready");
  if (rejected > produced) refuse(back, "batch-not-ready");
  if (Date.parse(bestBefore) <= Date.now()) refuse(back, "batch-not-ready");

  const onShelf = produced - rejected;
  const released = await adminSql().transaction(async (tx) => {
    const found = await tx.query(
      `select b.id, b.batch_code, b.status, b.variant_id, b.product_id,
              p.title as product_title
         from public.batches b
         join public.products p on p.id = b.product_id
        where b.id = $1 for update`,
      [batchId],
    );
    const batch = found.rows[0];
    if (batch === undefined) return { problem: "batch-gone" } as const;
    const was = text(batch, "status");
    if (was === "released" || was === "sold_out") {
      return { problem: "batch-already-released" } as const;
    }
    if (!["bottling", "conditioning", "fermenting", "qa_hold"].includes(was)) {
      return { problem: "batch-not-ready" } as const;
    }
    const variantId = textOrNull(batch, "variant_id");
    if (variantId === null) return { problem: "batch-not-ready" } as const;

    await tx.query(
      `update public.batches
          set status = 'released',
              produced_at = coalesce(produced_at, now()),
              bottled_at  = coalesce(bottled_at, now()),
              released_at = now(),
              expires_at  = $2::date,
              units_produced = $3, units_rejected = $4, units_remaining = $5,
              qa_passed = true, qa_checked_by = $6, qa_checked_at = now(),
              qa_notes = coalesce($7, qa_notes),
              location_id = $8,
              updated_at = now()
        where id = $1`,
      [
        batchId,
        bestBefore,
        produced,
        rejected,
        onShelf,
        operator.id,
        qaNotes,
        locationId,
      ],
    );

    if (onShelf > 0) {
      // The level and the ledger move together, in one transaction. A level
      // without its adjustment row is stock nobody can account for.
      await tx.query(
        `insert into public.inventory_levels
           (variant_id, location_id, provider, sync_status, on_hand)
         values ($1, $2, 'local', 'local', $3)
         on conflict (variant_id, location_id)
         do update set on_hand = public.inventory_levels.on_hand + $3`,
        [variantId, locationId, onShelf],
      );
      await tx.query(
        `insert into public.inventory_adjustments
           (variant_id, location_id, delta, reason, batch_id, actor_type,
            actor_id, note)
         values ($1, $2, $3, 'batch_release', $4, 'operator', $5, $6)`,
        [
          variantId,
          locationId,
          onShelf,
          batchId,
          operator.id,
          `Batch ${text(batch, "batch_code")} released for sale.`,
        ],
      );
    }

    return {
      problem: null,
      was,
      code: text(batch, "batch_code"),
      productTitle: text(batch, "product_title"),
    } as const;
  });

  if (released.problem !== null) refuse(back, released.problem);

  await audit({
    operator,
    action: "release",
    entityType: "batches",
    entityId: batchId,
    entityLabel: released.code,
    summary: `Released batch ${released.code} of ${released.productTitle} — ${count(onShelf)} bottles on the shelf${rejected > 0 ? `, ${count(rejected)} thrown` : ""}, best before ${bestBefore}.`,
    before: { status: released.was, units_remaining: 0 },
    after: {
      status: "released",
      units_produced: produced,
      units_rejected: rejected,
      units_remaining: onShelf,
      expires_at: bestBefore,
      qa_passed: true,
    },
  });
  revalidateStock();
  done(back, "batch-released");
}

/* ------------------------------------------------------------------ helpers */

async function levelNow(
  variantId: string,
  locationId: string,
): Promise<{
  readonly label: string;
  readonly locationName: string;
  readonly onHand: number;
}> {
  const result = await adminSql().query(
    `select coalesce(p.title, v.sku) as label, v.sku,
            l.name as location_name,
            coalesce(il.on_hand, 0)::int as on_hand
       from public.product_variants v
       join public.products p on p.id = v.product_id
       cross join public.inventory_locations l
       left join public.inventory_levels il
              on il.variant_id = v.id and il.location_id = l.id
      where v.id = $1 and l.id = $2`,
    [variantId, locationId],
  );
  const row = result.rows[0] ?? {};
  return {
    label: text(row, "label") === "" ? text(row, "sku") : text(row, "label"),
    locationName: text(row, "location_name"),
    onHand: int(row, "on_hand"),
  };
}

/**
 * The next free batch code, `HS-<sku part>-<yymmdd>-<run letter>`.
 *
 * The format is a check constraint, so this cannot invent one: it takes the
 * middle from the product's own SKU and walks A to Z until it finds a letter
 * that day has not used.
 */
async function nextBatchCode(tx: SqlExecutor, sku: string): Promise<string> {
  const middle =
    (sku.split("-")[1] ?? sku)
      .replace(/[^A-Z0-9]/gi, "")
      .toUpperCase()
      .slice(0, 10) || "XX";
  const now = new Date();
  const stamp = [
    String(now.getFullYear()).slice(2),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("");
  const taken = await tx.query(
    `select batch_code from public.batches where batch_code like $1`,
    [`HS-${middle}-${stamp}-%`],
  );
  const used = new Set(taken.rows.map((row) => text(row, "batch_code")));
  for (let index = 0; index < 26; index += 1) {
    const code = `HS-${middle}-${stamp}-${String.fromCharCode(65 + index)}`;
    if (!used.has(code)) return code;
  }
  throw new Error(`Twenty-six batches of ${middle} in one day is not a thing.`);
}

function revalidateStock(): void {
  revalidatePath("/admin/stock");
  revalidatePath("/admin");
  revalidatePath("/admin/orders");
}
