type ToastProps = {
  message: React.ReactNode;
  type?: "info" | "success" | "error";
  onClose?: () => void;
};

export default function Toast({ message, type = "info", onClose }: ToastProps) {
  const tone = {
    info: "border-blue-200 bg-blue-50 text-blue-900",
    success: "border-emerald-200 bg-emerald-50 text-emerald-900",
    error: "border-red-200 bg-red-50 text-red-900",
  }[type];

  return (
    <div className={`flex w-full items-start justify-between gap-3 rounded-xl border px-3 py-2 text-sm shadow-sm ${tone}`}>
      <span className="block leading-5">{message}</span>
      {onClose && (
        <button
          type="button"
          aria-label="Dismiss notification"
          onClick={onClose}
          className="shrink-0 text-current/80 hover:text-current"
        >
          ×
        </button>
      )}
    </div>
  );
}
