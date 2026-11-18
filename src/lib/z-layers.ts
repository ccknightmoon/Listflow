// THE stacking order for the whole app. Every fixed/sticky/overlay element
// takes its z-index from here -- never a hand-picked number.
//
//   content < sticky headers / bulk action bars < bottom nav / sidebar
//   < publish tray < row menus < sheets & modals (+ backdrop) < confirm dialogs < toasts
export const Z = {
  content: 0,
  popover: 10, // in-page dropdowns
  sticky: 20, // sticky headers, page footers (draft editor action bar)
  actionBar: 30, // Drafts/Listings bulk-select bars
  nav: 40, // bottom nav (+ AI-usage banner)
  tray: 45, // background publish/price tray
  menu: 50, // row "⋯" / right-click menus (desktop)
  sheet: 60, // bottom sheets & modals, with their backdrop
  confirm: 70, // confirm dialog (can open on top of a sheet)
  toast: 80,
} as const;

export type ZLayer = keyof typeof Z;

// Space the floating bottom nav takes (bar 64px + 12px gap + 12px breathing
// room), before the iPhone home-indicator inset.
export const NAV_SPACE_PX = 88;
