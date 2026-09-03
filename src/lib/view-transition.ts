// The "container transform" mechanism prototyped by hand in the design
// mockups (a tapped tile growing into the next screen), done properly:
// the native View Transitions API interpolates position/size/opacity
// between the old and new DOM automatically, keyed by a shared
// `viewTransitionName` set on both the source tile and the destination
// screen's matching content block.
//
// ~91% global support (Chrome/Edge 111+, Safari 18+, Firefox 144+, per
// caniuse) with a one-line feature-detect fallback below, so it's safe to
// use outright — unsupported browsers just get an ordinary navigation.
export function morphNavigate(router: { push(href: string): void }, href: string) {
  if (typeof document === "undefined" || !("startViewTransition" in document)) {
    router.push(href);
    return;
  }
  (document as unknown as { startViewTransition: (cb: () => void) => void }).startViewTransition(() => {
    router.push(href);
  });
}
