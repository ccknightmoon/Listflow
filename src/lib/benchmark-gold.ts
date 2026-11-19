// Server-side: Sel's live listing (GetItem) → benchmark gold item.
import { xmlFind, xmlFindAll } from "@/lib/ebay-listings";
import { decodeEntities } from "@/lib/html-entities";
import type { Aspects } from "@/lib/item-specifics";
import type { GoldItem } from "@/lib/benchmark";

/** eBay GetItem (IncludeItemSpecifics) → gold item. */
export function parseGetItem(body: string): GoldItem | null {
  const item = xmlFind(body, "Item");
  const itemId = xmlFind(item, "ItemID");
  if (!itemId) return null;
  const cat = xmlFind(item, "PrimaryCategory");
  const specifics: Aspects = {};
  for (const nv of xmlFindAll(xmlFind(item, "ItemSpecifics"), "NameValueList")) {
    const name = decodeEntities(xmlFind(nv, "Name"));
    const values = xmlFindAll(nv, "Value").map((v) => decodeEntities(v)).filter(Boolean);
    if (name && values.length) specifics[name] = values;
  }
  return {
    itemId,
    title: decodeEntities(xmlFind(item, "Title")),
    categoryId: xmlFind(cat, "CategoryID"),
    categoryPath: decodeEntities(xmlFind(cat, "CategoryName")).split(":").join(" > "),
    specifics,
    pictures: xmlFindAll(xmlFind(item, "PictureDetails"), "PictureURL").filter((u) => /^https:\/\//.test(u)).slice(0, 8),
  };
}

