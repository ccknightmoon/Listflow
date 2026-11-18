// Curated value lists for common clothing aspects, used ONLY when eBay's
// metadata for the category marks the aspect FREE_TEXT and lists no values
// (eBay accepts any text there, so these are safe suggestions). Never used
// for SELECTION_ONLY aspects — those only ever show eBay's own list.
import type { AspectDef } from "@/lib/item-specifics";

export const CURATED_VALUES: Record<string, string[]> = {
  "sleeve length": ["Short Sleeve", "Long Sleeve", "3/4 Sleeve", "Sleeveless", "Cap Sleeve", "Half Sleeve", "Elbow Sleeve"],
  neckline: ["Crew Neck", "V-Neck", "Scoop Neck", "Mock Neck", "Turtleneck", "Henley", "Collared", "Hooded", "Boat Neck", "Square Neck"],
  fit: ["Regular", "Slim", "Relaxed", "Oversized", "Athletic", "Classic", "Loose", "Tailored"],
  pattern: ["Solid", "Graphic Print", "Striped", "Plaid", "Floral", "Camouflage", "Tie-Dye", "Checkered", "Color Block", "Logo", "Polka Dot", "Paisley"],
  season: ["Fall", "Winter", "Spring", "Summer", "All Seasons"],
  closure: ["Button", "Zip", "Snap", "Pullover", "Hook & Loop", "Drawstring", "Toggle", "Buckle", "Elastic"],
  occasion: ["Casual", "Activewear", "Workwear", "Formal", "Party/Cocktail", "Business", "Travel", "Outdoor"],
  "size type": ["Regular", "Big & Tall", "Plus", "Petite", "Tall", "Juniors"],
  rise: ["Low", "Mid", "High"],
  "leg style": ["Straight", "Slim", "Skinny", "Bootcut", "Wide", "Relaxed", "Tapered", "Flare"],
  "fabric wash": ["Dark", "Medium", "Light", "Black", "Distressed", "Acid", "Stonewash"],
  "fabric type": ["Jersey", "Knit", "Fleece", "Denim", "Canvas", "Twill", "Mesh", "Woven", "Corduroy", "French Terry"],
  vintage: ["Yes", "No"],
  department: ["Men", "Women", "Unisex Adult", "Boys", "Girls"],
  theme: ["Sports", "Retro", "Music", "Movies", "TV", "Western", "Outdoor", "Workwear", "Streetwear", "Y2K", "90s", "80s"],
};

/** The options a dropdown shows for this aspect: eBay's list, else a curated list for free text only. */
export function optionsFor(def: Pick<AspectDef, "name" | "mode" | "values">): { values: string[]; curated: boolean } {
  if (def.values.length > 0) return { values: def.values, curated: false };
  if (def.mode === "SELECTION_ONLY") return { values: [], curated: false };
  const c = CURATED_VALUES[def.name.toLowerCase()];
  return c ? { values: c, curated: true } : { values: [], curated: false };
}
