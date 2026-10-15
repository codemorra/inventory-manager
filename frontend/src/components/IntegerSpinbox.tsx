import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

// Configure a bounded, non-negative integer input with explicit step controls.
interface IntegerSpinboxProps {
  id: string;
  label: string;
  describedBy?: string;
  value: string;
  min: number;
  max: number;
  required?: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
}

/**
 * Render a themed spinbox without permitting native number-input syntax.
 * @param id The identifier connecting the input and label.
 * @param label The visible and accessible field name.
 * @param describedBy The optional identifier of a help text.
 * @param value The controlled integer string, or an empty editing value.
 * @param min The smallest permitted non-negative integer.
 * @param max The largest permitted integer.
 * @param required Whether an empty value prevents form submission.
 * @param disabled Whether editing and stepping are disabled.
 * @param onChange Apply a valid edit or a bounded step to the parent form.
 * @returns The labeled spinbox with increment and decrement buttons.
 */
export function IntegerSpinbox({
  id,
  label,
  describedBy,
  value,
  min,
  max,
  required = false,
  disabled = false,
  onChange,
}: IntegerSpinboxProps) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const control = useRef<HTMLDivElement>(null);
  const latest = useRef({ value, min, max, disabled, onChange });
  const timer = useRef<number | null>(null);
  const pointerStepped = useRef(false);

  // Cancel any pending repeat without scheduling another render.
  const stopRepeating = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useLayoutEffect(() => {
    latest.current = { value, min, max, disabled, onChange };
    if (disabled) stopRepeating();
  }, [value, min, max, disabled, onChange, stopRepeating]);

  useEffect(() => {
    // Losing the page or pointer must never leave a background counter running.
    function stopWhenHidden() {
      if (document.hidden) stopRepeating();
    }
    window.addEventListener("pointerup", stopRepeating);
    window.addEventListener("pointercancel", stopRepeating);
    window.addEventListener("blur", stopRepeating);
    document.addEventListener("visibilitychange", stopWhenHidden);
    return () => {
      stopRepeating();
      window.removeEventListener("pointerup", stopRepeating);
      window.removeEventListener("pointercancel", stopRepeating);
      window.removeEventListener("blur", stopRepeating);
      document.removeEventListener("visibilitychange", stopWhenHidden);
    };
  }, [stopRepeating]);

  /**
   * Validate the complete input, including pasted text, before changing the value.
   * @param next The requested input value.
   */
  function edit(next: string) {
    const number = Number(next);
    if (
      !disabled &&
      (next === "" ||
        (/^(0|[1-9][0-9]*)$/.test(next) &&
          Number.isSafeInteger(number) &&
          number >= min &&
          number <= max))
    )
      onChange(next);
  }

  /**
   * Step within the bounds; an empty input starts at the minimum in either direction.
   * @param direction Whether to increase or decrease by one.
   * @param focus Whether stepping should focus the input rather than preserve existing focus.
   * @returns Whether further steps in this direction remain possible.
   */
  const step = useCallback((direction: -1 | 1, focus = true) => {
    const current = latest.current;
    if (current.disabled) return false;
    const next =
      current.value === ""
        ? current.min
        : Math.min(
            current.max,
            Math.max(current.min, Number(current.value) + direction),
          );
    if (String(next) !== current.value) {
      // Keep repeated events current even when React batches their parent updates.
      latest.current = { ...current, value: String(next) };
      current.onChange(String(next));
    }
    if (focus) input.current?.focus();
    return direction === 1 ? next < current.max : next > current.min;
  }, []);

  /**
   * Start one immediate pointer step, then repeat after a short hold delay.
   * @param direction Whether the held arrow increases or decreases the value.
   */
  function startRepeating(direction: -1 | 1) {
    stopRepeating();
    if (latest.current.disabled) return;
    pointerStepped.current = true;
    if (!step(direction)) return;
    // A delay distinguishes clicks from holds; subsequent steps run at a steady rate.
    function repeat() {
      if (step(direction)) timer.current = window.setTimeout(repeat, 75);
      else stopRepeating();
    }
    timer.current = window.setTimeout(repeat, 400);
  }

  useEffect(() => {
    const element = control.current;
    if (!element) return;
    /**
     * Adjust the hovered control without scrolling its surrounding modal or page.
     * @param event The native wheel event, including unfocused hover interactions.
     */
    function handleWheel(event: WheelEvent) {
      if (
        latest.current.disabled ||
        event.ctrlKey ||
        event.metaKey ||
        event.deltaY === 0
      )
        return;
      event.preventDefault();
      stopRepeating();
      step(event.deltaY < 0 ? 1 : -1, false);
    }
    // React's passive wheel listener cannot cancel page scrolling.
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [step, stopRepeating]);

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-foreground">
        {label}
      </label>
      <div
        ref={control}
        className={`relative mt-1.5 w-24 max-w-full overflow-hidden rounded-md border border-shell bg-surface transition focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20 ${disabled ? "opacity-50" : ""}`}
      >
        <input
          ref={input}
          id={id}
          type="text"
          role="spinbutton"
          inputMode="numeric"
          pattern="[0-9]+"
          maxLength={String(max).length}
          aria-describedby={describedBy}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value === "" ? undefined : Number(value)}
          className="block w-full min-w-0 bg-transparent py-1.5 pl-2.5 pr-7 text-sm text-foreground outline-none disabled:cursor-not-allowed"
          value={value}
          required={required}
          disabled={disabled}
          onChange={(event) => edit(event.target.value)}
          onKeyDown={(event) => {
            if (event.ctrlKey || event.metaKey || event.altKey) return;
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              step(event.key === "ArrowUp" ? 1 : -1);
            } else if (event.key === "Home" || event.key === "End") {
              event.preventDefault();
              edit(String(event.key === "Home" ? min : max));
            }
          }}
        />
        <div className="absolute inset-y-0 right-0 grid w-5 grid-rows-2 border-l border-shell">
          {([1, -1] as const).map((direction) => (
            <button
              key={direction}
              type="button"
              tabIndex={-1}
              aria-controls={id}
              aria-label={t(
                direction === 1
                  ? "common.actions.increase"
                  : "common.actions.decrease",
                { field: label },
              )}
              disabled={
                disabled ||
                (value !== "" &&
                  (direction === 1
                    ? Number(value) >= max
                    : Number(value) <= min))
              }
              className={`flex items-center justify-center text-muted transition enabled:hover:bg-control-hover enabled:hover:text-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-40 ${direction === -1 ? "border-t border-shell" : ""}`}
              onMouseDown={(event) => event.preventDefault()}
              onPointerDown={(event) => {
                if (event.button !== 0 || !event.isPrimary) return;
                event.preventDefault();
                startRepeating(direction);
              }}
              onPointerUp={stopRepeating}
              onPointerCancel={stopRepeating}
              onPointerLeave={stopRepeating}
              onClick={(event) => {
                // Pointer presses already stepped; assistive and keyboard clicks still need a step.
                if (!pointerStepped.current || event.detail === 0)
                  step(direction);
                pointerStepped.current = false;
              }}
            >
              <svg
                aria-hidden="true"
                className="size-3"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <path d={direction === 1 ? "m4 10 4-4 4 4" : "m4 6 4 4 4-4"} />
              </svg>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
