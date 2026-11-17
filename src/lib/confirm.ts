// Promise-based confirm that renders the app's styled bottom sheet
// (ConfirmHost, mounted once in the root layout) instead of the browser's
// grey `confirm()` box. Falls back to window.confirm if the host isn't
// mounted (e.g. tests).
export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

type Handler = (opts: ConfirmOptions) => Promise<boolean>;
let handler: Handler | null = null;

export function registerConfirmHost(h: Handler | null): void {
  handler = h;
}

export function confirmAction(opts: ConfirmOptions): Promise<boolean> {
  if (handler) return handler(opts);
  if (typeof window !== "undefined") return Promise.resolve(window.confirm([opts.title, opts.message].filter(Boolean).join("\n\n")));
  return Promise.resolve(false);
}
