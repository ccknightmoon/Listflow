// Shared GPT-4o-mini vision prompt used by both /api/analyze-item (single
// item) and /api/analyze-batch (grouped batch items). Previously duplicated
// verbatim in both route files — keep it here so the two flows can't drift
// out of sync with each other.
//
// Originally written clothing-only. The app's category detection
// (src/lib/ebay-inventory.ts) now also routes jewelry (necklaces, earrings,
// rings, bracelets) and accessories (belts, wallets, hats, sunglasses,
// scarves) to their real eBay categories — but this prompt was still forcing
// every item into garment framing (fabric materials, sleeve length, fit),
// which reads oddly and mis-fills fields on a necklace or a pair of
// sunglasses. The field NAMES stay the same (nothing downstream — ai-result
// types, the eBay aspect mapping, the drafts table — needed to change),
// only the per-field guidance now branches on what kind of item this
// actually is, with clothing fields explicitly left empty for non-garments.
export const ITEM_VISION_PROMPT = `You are helping a reseller list a secondhand item on eBay.
This reseller handles clothing as well as jewelry and accessories (necklaces,
earrings, rings, bracelets, belts, wallets, hats, sunglasses, scarves) — first
work out which of those this actually is, then fill in the fields below
accordingly. Several fields only make sense for clothing; leave those as an
empty string for jewelry/accessories rather than forcing a garment-style
answer onto them.

Look at these photos (front/back, measurements or close-ups, and any flaw
close-ups) and respond with ONLY a JSON object (no markdown, no extra text)
in this exact shape:

{
  "itemType": "eBay Type value — clothing e.g. 'T-Shirt', 'Hoodie', 'Jeans', 'Jacket', 'Shorts', 'Sweatshirt', 'Polo', 'Vest'; jewelry/accessories e.g. 'Necklace', 'Pendant Necklace', 'Stud Earrings', 'Bracelet', 'Ring', 'Belt', 'Wallet', 'Sunglasses', 'Baseball Cap', 'Scarf'",
  "brand": "brand name visible on item/tag, or 'Unbranded' if none",
  "color": "primary color, e.g. White, Black, Blue, Red, Grey, Green, Brown, Beige, Gold, Silver",
  "size": "CLOTHING/SHOES: size from tag/label if visible, e.g. S, M, L, XL, XXL, 32x30, or a shoe size like 9.5. JEWELRY/ACCESSORIES: ring size or adjustable-length if marked (e.g. 'Size 7', 'Adjustable'), otherwise 'One Size'. 'Unknown' if nothing is visible or size doesn't apply (e.g. a necklace with no marked length).",
  "condition": "one of: New with tags, New without tags, Excellent used, Good - minor flaws, Fair - notable flaws",
  "flaws": "specific visible flaws — fabric: stains, holes, fading, pilling; jewelry/accessories: scratches, tarnish, missing stones, broken clasp, scuffed leather. Empty string if none.",
  "vintage": "'Yes' if the item appears to be from before 2000, otherwise 'No'",
  "style": "CLOTHING ONLY — eBay Style value, one of: Graphic Tee, Polo, Henley, V-Neck, Crewneck, Relaxed Fit, Athletic, Activewear, Workwear, Preppy, Casual. Empty string for jewelry/accessories or if none apply.",
  "material": "CLOTHING: primary fabric — one of Cotton, Polyester, Denim, Fleece, Wool, Nylon, Linen, Velvet, Corduroy, Silk, Synthetic, or a blend e.g. Cotton/Polyester. JEWELRY/ACCESSORIES: the actual material — e.g. Gold Tone, Sterling Silver, Cubic Zirconia, Pearl, Leather, Acrylic, Metal. Empty string if unknown.",
  "sleeveLength": "TOPS ONLY — one of: Short Sleeve, Long Sleeve, Sleeveless, 3/4 Sleeve. Empty string for bottoms/outerwear/jewelry/accessories.",
  "neckline": "TOPS ONLY — one of: Crew Neck, V-Neck, Hooded, Turtleneck, Mock Neck, Collared. Empty string for bottoms/outerwear/jewelry/accessories.",
  "fit": "CLOTHING ONLY — one of: Regular, Slim, Relaxed, Oversized, Athletic. Empty string for jewelry/accessories.",
  "pattern": "eBay Pattern value — one of: Graphic Print, Solid, Striped, Plaid, Floral, Camouflage, Tie Dye, Checkered, Abstract. Use 'Graphic Print' for items with text, logos, or character prints. Applies to scarves/patterned accessories too; empty string if plain or not applicable (most jewelry).",
  "theme": "comma-separated eBay Theme values that apply, e.g. '90s', 'Vintage', 'Sports', 'Music', 'TV & Movie', 'Holiday', 'Halloween', 'Military', 'Animal', 'Nature', 'Humor'. Empty string if none.",
  "character": "specific character name if item features one, e.g. 'Mickey Mouse', 'SpongeBob', 'Bugs Bunny', 'Stitch', 'Tupac'. Empty string if no character.",
  "characterFamily": "franchise/brand of character if any, e.g. 'Disney', 'Nickelodeon', 'Looney Tunes', 'Marvel', 'DC Comics'. Empty string if no character.",
  "yearManufactured": "estimated decade range — one of: Pre-1960, 1960-1969, 1970-1979, 1980-1989, 1990-1999, 2000-2009, 2010-2019, 2020-2029. Base on style, font, printing technique, tag style, or (for jewelry) design era. Empty string if truly unknown.",
  "season": "one of: All Seasons, Fall, Spring, Summer, Winter. Default to 'All Seasons' for most clothing and for jewelry; use the actual season for weather-specific accessories like a winter scarf or summer sunhat.",
  "pitToPit": "TOPS ONLY — armpit to armpit (chest width) read from the measuring tape in the photo, e.g. '22 inches'. Read the tape carefully. Empty string if no tape visible, not a top, or unclear.",
  "length": "TOPS ONLY — shoulder seam to bottom hem read from the measuring tape, e.g. '28 inches'. Empty string if not visible or not a top.",
  "waist": "BOTTOMS ONLY — waist measurement from tape. If tape is folded flat across the waistband, double the value shown. Return the full circumference, e.g. '32 inches'. Empty string if not a bottom or not visible.",
  "inseam": "BOTTOMS ONLY — inseam length read from tape, e.g. '30 inches'. Empty string if not visible or not a bottom.",
  "description": "2-3 sentences, buyer-facing. Describe what the item actually is (do not describe a necklace as if it were a garment) — for jewelry/accessories mention the metal/stone/material and closure or fastening if visible; for clothing mention fit and fabric. Note notable design details, who'd wear it, and key selling points. No filler phrases.",
  "suggestedTitle": "eBay listing title — keyword-rich, MAXIMUM 80 characters (count carefully, never exceed 80). Clothing: pack in Brand + Men's/Women's/Unisex + Item Type + Color + Size + keywords like Vintage, Y2K, 90s, Graphic Tee, Band Tee, Streetwear, Distressed, Oversized. Jewelry/accessories: pack in Brand + Item Type + Material/Stone + Color + a selling keyword like Vintage, Statement, Boho, Minimalist. No filler phrases. Aim for all 80 characters."
}`;
