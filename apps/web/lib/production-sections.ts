/**
 * Central categorization for the Production page's item selectors.
 *
 * Previous approach (buggy):
 *   The production detail page had inline filters like
 *     i.sku?.startsWith('CTN') || i.name?.includes('كرتون')
 *   which excluded every inventory item whose SKU/name didn't match
 *   those exact strings. Any item created through /inventory with a
 *   different SKU convention (e.g. INV-042, WH-A-15) or a different
 *   Arabic label (e.g. "علبة كرتون كبيرة") vanished from the
 *   production dropdowns even though it clearly existed in stock.
 *
 * New approach:
 *   Categorization uses the SCHEMA fields the item already carries —
 *   `type` (ItemType enum), `unit`, and `category` — and falls back to
 *   an Arabic/English keyword hint on `name` ONLY when the structural
 *   signals are missing. That way legacy items keep working while
 *   any new item picked up via /inventory shows up in the right
 *   dropdown as soon as its type/unit/category is set correctly.
 *
 * ItemType enum (from prisma/schema.prisma):
 *   POWDER_BULK   → raw ingredients (milk powder, etc.)
 *   PACKAGING     → cartons, aluminum rolls, sachets
 *   POWDER_RETAIL → finished product ready to ship
 *   CONSUMABLE    → everything else
 *
 * Units (from the inventory form):
 *   PCS, CTN, KG, G, BAG (25kg), ROLL
 */

export type ProductionSection =
  | 'raw_milk'   // الحليب الخام
  | 'carton'     // الكرتون
  | 'aluminum'   // الألمنيوم
  | 'finished'   // المنتج النهائي
  | null;        // does not belong to any production selector

export interface CategorizableItem {
  name?: string | null;
  sku?: string | null;
  type?: string | null;    // ItemType — POWDER_BULK / PACKAGING / POWDER_RETAIL / CONSUMABLE
  unit?: string | null;    // PCS / CTN / KG / G / BAG / ROLL
  category?: string | null;
  active?: boolean;
}

/** Normalise for keyword matching — lowercase + trim + fold diacritics-ish. */
function n(s: string | null | undefined): string {
  return (s || '').toString().toLowerCase().trim();
}

/**
 * Free-text hints ONLY used when type/unit/category don't already
 * classify the item. We include English + Arabic tokens so the system
 * is resilient to naming conventions.
 */
const HINTS = {
  raw_milk: ['حليب خام', 'raw milk', 'حليب مسحوق', 'milk powder', 'powder', 'حليب البودرة'],
  carton: ['كرتون', 'كارتون', 'carton', 'ctn', 'علبة كرتون'],
  aluminum: ['ألمنيوم', 'الومنيوم', 'aluminium', 'aluminum', 'رول ألمنيوم', 'roll'],
} as const;

function matchesAny(str: string, hints: readonly string[]): boolean {
  if (!str) return false;
  const low = n(str);
  return hints.some((h) => low.includes(n(h)));
}

/**
 * Which production section does this inventory item belong in?
 *
 * Decision order — structural signals BEFORE keyword hints:
 *   1. Inactive items → null (never show).
 *   2. type === POWDER_RETAIL → 'finished'.
 *   3. type === POWDER_BULK   → 'raw_milk'.
 *   4. type === PACKAGING     → look at unit and category to split
 *      into carton vs aluminum.
 *   5. category matches a Carton / Aluminum / Raw-milk hint → route there.
 *   6. Last resort: name/SKU keyword hint (legacy items with no type/category).
 *   7. Otherwise → null (does not belong in any production selector).
 */
export function productionSectionOf(item: CategorizableItem | null | undefined): ProductionSection {
  if (!item) return null;
  if (item.active === false) return null;

  const type = n(item.type);
  const unit = n(item.unit);
  const category = n(item.category);
  const name = n(item.name);
  const sku = n(item.sku);

  // 2 & 3 — direct enum mapping
  if (type === 'powder_retail') return 'finished';
  if (type === 'powder_bulk') return 'raw_milk';

  // 4 — packaging is split by unit + keyword
  if (type === 'packaging') {
    if (unit === 'ctn') return 'carton';
    if (unit === 'roll') return 'aluminum';
    // Ambiguous packaging — fall through to category / keyword hints.
  }

  // 5 — explicit category from the inventory form
  if (category) {
    if (matchesAny(category, HINTS.aluminum)) return 'aluminum';
    if (matchesAny(category, HINTS.carton)) return 'carton';
    if (matchesAny(category, HINTS.raw_milk)) return 'raw_milk';
  }

  // 6 — legacy keyword fallback on NAME and SKU. Order matters — check
  // aluminum before raw_milk before carton so a mixed name doesn't
  // land in the wrong bucket (e.g. "غطاء كرتون ألمنيوم" → aluminum).
  if (matchesAny(name, HINTS.aluminum) || matchesAny(sku, ['alu'])) return 'aluminum';
  if (matchesAny(name, HINTS.raw_milk) || matchesAny(sku, ['raw-milk', 'raw_milk', 'milk-powder'])) return 'raw_milk';
  if (matchesAny(name, HINTS.carton) || matchesAny(sku, ['ctn', 'carton'])) return 'carton';

  return null;
}

/**
 * Split a full item list into the four production dropdowns in ONE pass.
 * Faster than four .filter() calls and guarantees an item is only in the
 * section productionSectionOf() picked for it.
 */
export function splitItemsBySection<T extends CategorizableItem>(
  items: readonly T[] | null | undefined,
): {
  raw_milk: T[];
  carton: T[];
  aluminum: T[];
  finished: T[];
  uncategorized: T[];
} {
  const raw_milk: T[] = [];
  const carton: T[] = [];
  const aluminum: T[] = [];
  const finished: T[] = [];
  const uncategorized: T[] = [];

  for (const it of items ?? []) {
    switch (productionSectionOf(it)) {
      case 'raw_milk': raw_milk.push(it); break;
      case 'carton':   carton.push(it); break;
      case 'aluminum': aluminum.push(it); break;
      case 'finished': finished.push(it); break;
      default:         uncategorized.push(it); break;
    }
  }

  return { raw_milk, carton, aluminum, finished, uncategorized };
}
