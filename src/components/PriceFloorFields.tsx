"use client";

import CurrencyInput from "@/components/CurrencyInput";
import { checkPriceAndFloor } from "@/lib/offer-floor";

type Props = {
  /** Price as typed. */
  price: string;
  /** Best Offer floor as typed ("" = no offers). */
  floor: string;
  onPriceChange: (v: string) => void;
  onFloorChange: (v: string) => void;
  /** AI suggestions, shown as hints + "use suggested" taps. */
  suggestedPrice?: number | null;
  suggestedFloor?: number | null;
  disabled?: boolean;
  className?: string;
  /** Unique per card, for label/input ids. */
  idPrefix: string;
};

/**
 * Price + "Lowest offer I'll take" (Best Offer auto-decline floor), side by
 * side with big number-pad inputs. Inline errors come from the same rules
 * the drafts API and the eBay publish path use (src/lib/offer-floor.ts).
 */
export default function PriceFloorFields({ price, floor, onPriceChange, onFloorChange, suggestedPrice, suggestedFloor, disabled, className, idPrefix }: Props) {
  const check = checkPriceAndFloor(price, floor);
  const errColor = { color: "var(--danger)" };
  const hint = { color: "var(--text-tertiary)" };
  const showSuggestedPrice = typeof suggestedPrice === "number" && suggestedPrice > 0 && check.price !== suggestedPrice;
  const showSuggestedFloor =
    typeof suggestedFloor === "number" && suggestedFloor > 0 && check.floor !== suggestedFloor && (check.price == null || suggestedFloor < check.price);

  return (
    <div className={`grid grid-cols-2 gap-2 ${className ?? ""}`} data-testid="price-floor-fields">
      <div>
        <label htmlFor={`${idPrefix}-price`} className="text-xs font-medium text-[var(--text-secondary)] mb-1 block">
          Price
        </label>
        <CurrencyInput
          id={`${idPrefix}-price`}
          value={price}
          onChange={onPriceChange}
          placeholder="0.00"
          disabled={disabled}
          aria-label="Price"
          aria-invalid={!!check.priceError}
          inputClassName="text-lg font-semibold"
          style={{ minHeight: 48 }}
        />
        {check.priceError ? (
          <p className="text-[11px] mt-1" style={errColor} role="alert">{check.priceError}</p>
        ) : showSuggestedPrice ? (
          <button type="button" className="text-[11px] mt-1 underline" style={hint} disabled={disabled} onClick={() => onPriceChange(String(suggestedPrice))}>
            Suggested ${suggestedPrice}
          </button>
        ) : (
          <p className="text-[11px] mt-1" style={hint}>What buyers pay</p>
        )}
      </div>
      <div>
        <label htmlFor={`${idPrefix}-floor`} className="text-xs font-medium text-[var(--text-secondary)] mb-1 block">
          Lowest offer (floor)
        </label>
        <CurrencyInput
          id={`${idPrefix}-floor`}
          value={floor}
          onChange={onFloorChange}
          placeholder="No offers"
          disabled={disabled}
          aria-label="Lowest Best Offer you'll take"
          aria-invalid={!!check.floorError}
          inputClassName="text-lg font-semibold"
          style={{ minHeight: 48 }}
        />
        {check.floorError ? (
          <p className="text-[11px] mt-1" style={errColor} role="alert">{check.floorError}</p>
        ) : showSuggestedFloor ? (
          <button type="button" className="text-[11px] mt-1 underline" style={hint} disabled={disabled} onClick={() => onFloorChange(String(suggestedFloor))}>
            Suggested ${suggestedFloor}
          </button>
        ) : (
          <p className="text-[11px] mt-1" style={hint}>
            {check.floor != null ? "Offers below this are auto-declined" : "Blank = no Best Offer"}
          </p>
        )}
      </div>
    </div>
  );
}
