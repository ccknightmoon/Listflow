# Desktop layout and interactions (Nov 2026, branch `feat/desktop-layout`)

Phones (below 1024px) keep the existing layout. From Tailwind `lg` (1024px) up, the app switches to the desktop layout. The switch point lives in `src/lib/nav-config.ts`, and a test checks it matches Tailwind's `lg`.

| Phone interaction | On a computer | Verified by |
|---|---|---|
| Bottom bar + "More" sheet | Left sidebar: New listing button, then Home, Listings, Sales, Drafts, Messages, Offers, Ship, Settings. The current section is highlighted, sub-pages included. | `nav-config.test.ts`, `desktop-layout.render.test.ts` |
| Swipe a row (Listings, Drafts) | Table with hover buttons, a "⋯" menu, right-click menu, checkboxes, shift-click range select | `data-table.render.test.ts`, `row-keys.test.ts` |
| Swipe (narrow desktop window, cards) | Right-click menu with the same actions (mouse only; phone long-press untouched) | Code review (`SwipeRow.tsx`) |
| Keyboard in tables | ↑/↓ (j/k), Home/End, Space select, ⌘/Ctrl+A all, Enter open, Shift+F10 / Menu key / "." for actions; one row in the Tab order | `row-keys.test.ts`, `data-table.render.test.ts` |
| Camera ("Snap one item", "Next photo") | File picker (multi-select, no `capture`), drag-and-drop, paste ⌘V / Ctrl+V. New listing, draft editor, batch upload and the Start-a-listing sheet | `photo-files.test.ts`; code review |
| Hold-and-drag photo reorder | Mouse drags right away (grip or drag-to-move); ←/→ keys on the grip; move buttons in the editor | Code review |
| Pull to refresh (Ship) | Refresh button (also on Offers and Messages) | Code review |
| Bottom sheets | Centred modal (bulk edit as a right drawer); Esc and click-outside close it; focus is trapped and returned | `desktop-layout.render.test.ts`, `sheet-focus.test.ts` |
| Number pad | Normal keyboard; Enter applies the price sheet, bulk edit, counter offer and cost entry; ⌘/Ctrl+Enter sends a buyer reply | Code review |
| Destructive confirm | Focus starts on Cancel, so a stray Enter can't delete | Code review |
| Tap targets | Hover styles only on mouse devices; visible focus rings for the keyboard | Code review (`globals.css`) |
| Add to Home Screen | Manifest only; the app shows no install prompt of its own, so there is nothing broken on desktop | Code review |
| Publish tray | Bottom-right, 380px wide, above content; bottom action bars sit above it | Code review |
| Sales chart tap-for-details | Bars are buttons: hover tooltip, click or Enter/Space for details (`aria-pressed`) | Code review |
| Photo viewer | Esc closes; focus moves to Close and back afterwards | Code review |
