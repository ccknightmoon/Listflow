type ToastProps = {
  message: React.ReactNode;
  type?: "info" | "success" | "error";
  onClose?: () => void;
};

export default function Toast({ message, type = "info", onClose }: ToastProps) {
  const color = {
    info: "var(--accent)",
    success: "var(--success)",
    error: "var(--danger)",
  }[type];

  return (
    <div
      className="flex w-full items-start justify-between gap-3 rounded-xl px-3 py-2 text-sm animate-[rise_.3s_var(--spring)_both]"
      style={{
        background: "var(--glass-strong)",
        border: `1px solid ${color}`,
        color: "var(--text-primary)",
        boxShadow: "var(--shadow-card)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
      }}
    >
      <span className="block leading-5">{message}</span>
      {onClose && (
        <button
          type="button"
          aria-label="Dismiss notification"
          onClick={onClose}
          className="shrink-0 opacity-70 hover:opacity-100 transition-opacity"
          style={{ color: "var(--text-primary)" }}
        >
          ×
        </button>
      )}
    </div>
  );
}
