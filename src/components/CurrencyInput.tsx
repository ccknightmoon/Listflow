"use client";

import { forwardRef, type InputHTMLAttributes } from "react";
import { sanitizeMoneyInput } from "@/lib/money-input";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "type" | "size" | "prefix"> & {
  value: string;
  onChange: (value: string) => void;
  /** Shown inside the field on the left ("$") or right ("%"). */
  prefix?: string | null;
  suffix?: string | null;
  allowNegative?: boolean;
  maxDecimals?: number;
  size?: "sm" | "md";
  /** Classes for the wrapper (width, margins). */
  className?: string;
  inputClassName?: string;
};

/**
 * The one money input. The "$" sits in its own reserved space (inline
 * padding, so the global `.input { padding }` rule can't override it and
 * squash the number under the sign — the bug this replaces). Text input with
 * inputMode="decimal": the phone shows the number pad, desktop gets a plain
 * field (no spinner arrows), Enter/keys work normally.
 */
const CurrencyInput = forwardRef<HTMLInputElement, Props>(function CurrencyInput(
  { value, onChange, prefix = "$", suffix = null, allowNegative = false, maxDecimals = 2, size = "md", className, inputClassName, style, ...rest },
  ref,
) {
  const sm = size === "sm";
  const pad = (s: string | null) => (s ? (sm ? 8 : 12) + s.length * (sm ? 7 : 9) + 4 : undefined);
  return (
    <div className={`relative ${className ?? ""}`}>
      {prefix && (
        <span aria-hidden className={`absolute top-1/2 -translate-y-1/2 pointer-events-none ${sm ? "left-2 text-xs" : "left-3 text-sm"}`} style={{ color: "var(--text-secondary)" }}>
          {prefix}
        </span>
      )}
      <input
        ref={ref}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(sanitizeMoneyInput(e.target.value, { allowNegative, maxDecimals }))}
        className={`input w-full ${sm ? "text-xs py-1" : ""} ${inputClassName ?? ""}`}
        style={{ ...style, paddingLeft: pad(prefix), paddingRight: pad(suffix) }}
        {...rest}
      />
      {suffix && (
        <span aria-hidden className={`absolute top-1/2 -translate-y-1/2 pointer-events-none ${sm ? "right-2 text-xs" : "right-3 text-sm"}`} style={{ color: "var(--text-secondary)" }}>
          {suffix}
        </span>
      )}
    </div>
  );
});

export default CurrencyInput;
