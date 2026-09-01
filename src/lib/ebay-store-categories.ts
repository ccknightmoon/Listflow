// eBay Seller Hub "Store Categories" — the custom categories a seller
// creates to organize their own Store (Account → Store → Categories), NOT
// eBay's global item-category taxonomy (that's handled in ebay-inventory.ts
// via getCategoryIdForTitle). Two things live here:
//   1. fetchStoreCategories() — reads the seller's actual category list via
//      the Trading API's GetStore call, so the AI can suggest one and the
//      seller picks from a real dropdown instead of the app guessing blind.
//   2. setListingStoreCategory() — the REST Inventory API's Offer resource
//      has a documented `storeCategoryNames` field, but it's flaky in
//      practice (see eBay's own developer forum — bare names vs. paths,
//      escaping issues). The reliable path sellers/devs actually use is the
//      Trading API's ReviseFixedPriceItem with Item.Storefront.StoreCategoryID,
//      called once after publishOffer() returns a real ItemID — so that's
//      the only write path implemented here.
import { tradingRequest, isValidEbayItemId } from "./ebay-inventory";
import { getEbayContext } from "./ebay-request-context";

export interface StoreCategory {
  id: string;
  name: string;
  // Full "Parent / Child" path for nested categories, just the name for a
  // top-level one — shown in the dropdown so a nested category isn't
  // ambiguous with a same-named sibling under a different parent.
  path: string;
}

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function makeGetStoreXml() {
  return `<?xml version="1.0" encoding="utf-8"?><GetStoreRequest xmlns="urn:ebay:apis:eBLBaseComponents"><CategoryStructureOnly>true</CategoryStructureOnly></GetStoreRequest>`;
}

interface RawNode {
  start: number;
  end: number;
  children: RawNode[];
}

// eBay's store categories can nest up to 3 levels. A plain non-greedy regex
// over repeated <CustomCategory>...</CustomCategory> blocks silently drops
// nested children — the outer block's non-greedy match stops at the FIRST
// closing tag it finds (which belongs to the innermost child), consuming
// that child's own opening tag along the way, so the next global-regex
// match never sees it. This walks a depth-tracked stack of open/close
// tokens instead (same technique as matching parentheses), which is correct
// regardless of nesting depth.
function parseCustomCategoryTree(xml: string): RawNode[] {
  type Tok = { type: "open" | "close"; pos: number };
  const toks: Tok[] = [];
  const openRe = /<CustomCategory(?:\s[^>]*)?>/g;
  const closeRe = /<\/CustomCategory>/g;
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(xml))) toks.push({ type: "open", pos: m.index + m[0].length });
  while ((m = closeRe.exec(xml))) toks.push({ type: "close", pos: m.index });
  toks.sort((a, b) => a.pos - b.pos);

  const stack: RawNode[] = [];
  const roots: RawNode[] = [];
  for (const t of toks) {
    if (t.type === "open") {
      const node: RawNode = { start: t.pos, end: -1, children: [] };
      (stack.length > 0 ? stack[stack.length - 1].children : roots).push(node);
      stack.push(node);
    } else {
      const node = stack.pop();
      if (node) node.end = t.pos;
    }
  }
  return roots;
}

// CategoryID/Name always appear before any nested child block in eBay's
// schema, so slicing up to the first child's start (or the node's own end,
// if it has no children) isolates just this node's own fields.
function extractOwnFields(xml: string, node: RawNode): { id: string; name: string } {
  const ownEnd = node.children.length > 0 ? node.children[0].start : node.end;
  const ownBlock = xml.slice(node.start, ownEnd);
  const idMatch = ownBlock.match(/<CategoryID>(\d+)<\/CategoryID>/);
  const nameMatch = ownBlock.match(/<Name>([\s\S]*?)<\/Name>/);
  return { id: idMatch?.[1] ?? "", name: decodeXml((nameMatch?.[1] ?? "").trim()) };
}

// Only leaf categories can hold items on eBay — a listing assigned to a
// parent category silently reroutes to "Other" with a warning — so parent
// (non-leaf) categories are walked but not offered as selectable.
function flattenLeaves(xml: string, nodes: RawNode[], parentPath: string[] = []): StoreCategory[] {
  const out: StoreCategory[] = [];
  for (const node of nodes) {
    const { id, name } = extractOwnFields(xml, node);
    if (!id || !name) continue;
    const path = [...parentPath, name];
    if (node.children.length === 0) {
      out.push({ id, name, path: path.join(" / ") });
    } else {
      out.push(...flattenLeaves(xml, node.children, path));
    }
  }
  return out;
}

// Categories rarely change, so cache across requests instead of hitting
// eBay on every single AI analysis call. Phase 2: keyed per-user (used to
// be one shared slot) — each seller's Store has its own category list, and
// two users' requests can land on the same warm serverless instance.
const categoryCacheByUser = new Map<string, { categories: StoreCategory[]; expiresAt: number }>();
const CATEGORY_CACHE_TTL_MS = 30 * 60 * 1000;

export async function fetchStoreCategories(forceRefresh = false): Promise<StoreCategory[]> {
  const { userId } = getEbayContext();
  const cached = categoryCacheByUser.get(userId);
  if (!forceRefresh && cached && Date.now() < cached.expiresAt) {
    return cached.categories;
  }
  try {
    const { body } = await tradingRequest("GetStore", makeGetStoreXml());
    if (!body.includes("<Ack>Success</Ack>") && !body.includes("<Ack>Warning</Ack>")) {
      return cached?.categories ?? [];
    }
    const nodes = parseCustomCategoryTree(body);
    const categories = flattenLeaves(body, nodes);
    categoryCacheByUser.set(userId, { categories, expiresAt: Date.now() + CATEGORY_CACHE_TTL_MS });
    return categories;
  } catch {
    return cached?.categories ?? [];
  }
}

const NUMERIC_ID_RE = /^\d+$/;

// Best-effort — called once, right after publishOffer() returns a real
// ItemID. Never blocks or fails the listing itself; the caller surfaces
// failure as a warning, not an error.
export async function setListingStoreCategory(
  itemId: string,
  categoryId: string
): Promise<{ success: boolean; error?: string }> {
  if (!isValidEbayItemId(itemId)) {
    return { success: false, error: `Invalid eBay item ID: "${itemId}"` };
  }
  if (!NUMERIC_ID_RE.test(categoryId)) {
    return { success: false, error: `Invalid store category ID: "${categoryId}"` };
  }
  try {
    const { body } = await tradingRequest(
      "ReviseFixedPriceItem",
      `<?xml version="1.0" encoding="utf-8"?><ReviseFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><Item><ItemID>${itemId}</ItemID><Storefront><StoreCategoryID>${categoryId}</StoreCategoryID></Storefront></Item></ReviseFixedPriceItemRequest>`
    );
    if (body.includes("<Ack>Success</Ack>") || body.includes("<Ack>Warning</Ack>")) {
      return { success: true };
    }
    const match = body.match(/<LongMessage>(.*?)<\/LongMessage>/);
    const shortMatch = body.match(/<ShortMessage>(.*?)<\/ShortMessage>/);
    return { success: false, error: decodeXml(match?.[1] ?? shortMatch?.[1] ?? body.slice(0, 300)) };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}
