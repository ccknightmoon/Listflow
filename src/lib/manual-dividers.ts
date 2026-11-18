// Manual grouping on the Batch Upload screen, no AI needed. Two markers:
//
//  - "SKU photo" (✂): this photo is the item's number card/tag/bag shot. It
//    ENDS the current item and is left out of the listing photos.
//  - "New item starts here" (⊕): this photo is the first photo of a new
//    item. It's kept (it's a real item photo, usually the front view).
//
// Both can be mixed in one batch. A photo can carry only one marker.
export function buildGroupsFromDividers(skuPhotos: Set<number>, newItemStarts: Set<number>, totalPhotos: number): number[][] {
  const groups: number[][] = [];
  let current: number[] = [];
  for (let i = 0; i < totalPhotos; i++) {
    if (skuPhotos.has(i)) {
      if (current.length) groups.push(current);
      current = [];
      continue; // the SKU photo itself is excluded
    }
    if (newItemStarts.has(i) && current.length) {
      groups.push(current);
      current = [];
    }
    current.push(i);
  }
  if (current.length) groups.push(current);
  return groups;
}

/** How many items the current markers will produce (for the "N items marked" hint). */
export function countMarkedItems(skuPhotos: Set<number>, newItemStarts: Set<number>, totalPhotos: number): number {
  return buildGroupsFromDividers(skuPhotos, newItemStarts, totalPhotos).length;
}
