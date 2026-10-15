import { useEffect, useRef, useState, type KeyboardEvent } from "react";

// Define a named choice for inventory and field configuration dropdowns.
export interface SelectOption {
  value: string;
  label: string;
}

// Configure a controlled dropdown that inherits the application's theme.
interface CommonChoiceProps {
  id: string;
  label: string;
  describedBy?: string;
  options: SelectOption[];
  disabled?: boolean;
  required?: boolean;
  emptyLabel?: string;
}

// Keep single and multiple selection values type-safe for their change callbacks.
export type ChoiceSelectProps = CommonChoiceProps &
  (
    | { multiple?: false; value: string; onChange: (value: string) => void }
    | { multiple: true; value: string[]; onChange: (value: string[]) => void }
  );

/**
 * Render single or multiple choices with shared themed and keyboard behavior.
 * @param props The label, options, selection mode, current value, and change callback.
 * @returns The labeled combobox and its themed option list.
 */
export function ChoiceSelect(props: ChoiceSelectProps) {
  const {
    id,
    label,
    describedBy,
    options,
    value,
    disabled = false,
    required = false,
    emptyLabel = "",
  } = props;
  const [open, setOpen] = useState(false);
  const selectedValues = typeof value === "string" ? [value] : value;
  const selectedIndex = options.findIndex((option) =>
    selectedValues.includes(option.value),
  );
  const selectedLabel = selectedValues
    .map(
      (selected) =>
        options.find((option) => option.value === selected)?.label ?? selected,
    )
    .join(", ");
  const [active, setActive] = useState(0);
  const activeIndex = Math.max(0, Math.min(active, options.length - 1));
  const root = useRef<HTMLDivElement>(null);
  const search = useRef({ text: "", time: 0 });
  const expanded = open && !disabled && options.length > 0;
  const listId = `${id}-options`;

  useEffect(() => {
    if (!expanded) return;
    /**
     * Close the dropdown when a pointer is pressed outside its control.
     * @param event The pointer event to inspect.
     */
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setOpen(false);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [expanded]);

  useEffect(() => {
    if (expanded)
      root.current
        ?.querySelectorAll('[role="option"]')
        .item(activeIndex)
        ?.scrollIntoView?.({ block: "nearest" });
  }, [expanded, activeIndex, id]);

  // Start navigation at the selected option without committing a new value.
  function showOptions() {
    setActive(Math.max(0, selectedIndex));
    search.current = { text: "", time: 0 };
    if (options.length > 0) setOpen(true);
  }

  /**
   * Commit a choice and return focus to the combobox.
   * @param index The selected option's index.
   */
  function choose(index: number) {
    const option = options[index];
    if (option) {
      if (props.multiple)
        props.onChange(
          props.value.includes(option.value)
            ? props.value.filter((selected) => selected !== option.value)
            : [...props.value, option.value],
        );
      else props.onChange(option.value);
    }
    if (!props.multiple) setOpen(false);
    root.current
      ?.querySelector<HTMLButtonElement>('[role="combobox"]')
      ?.focus();
  }

  /**
   * Navigate options without letting Escape dismiss the containing modal.
   * @param event The combobox keyboard event.
   */
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape" && expanded) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    } else if (event.key === "Tab") {
      setOpen(false);
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      if (!expanded) showOptions();
      const current = expanded ? activeIndex : Math.max(0, selectedIndex);
      setActive(
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? options.length - 1
            : expanded
              ? (current +
                  (event.key === "ArrowUp" ? -1 : 1) +
                  options.length) %
                options.length
              : current,
      );
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (expanded) choose(activeIndex);
      else showOptions();
    } else if (
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      const now = Date.now();
      const text =
        (now - search.current.time < 700 ? search.current.text : "") +
        event.key.toLocaleLowerCase();
      search.current = { text, time: now };
      const index = options.findIndex((option) =>
        option.label.toLocaleLowerCase().startsWith(text),
      );
      if (index >= 0) {
        event.preventDefault();
        setActive(index);
        setOpen(true);
      }
    }
  }

  return (
    <div
      className="relative min-w-0"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <label
        id={`${id}-label`}
        htmlFor={id}
        className="block text-sm font-medium text-foreground"
      >
        {label}
        {required && (
          <span aria-hidden="true" className="ml-1 text-accent">
            *
          </span>
        )}
      </label>
      <button
        id={id}
        type="button"
        role="combobox"
        aria-labelledby={`${id}-label`}
        aria-describedby={describedBy}
        aria-required={required || undefined}
        aria-expanded={expanded}
        aria-controls={listId}
        aria-haspopup="listbox"
        aria-activedescendant={
          expanded ? `${id}-option-${activeIndex}` : undefined
        }
        disabled={disabled || options.length === 0}
        className="mt-1.5 flex w-full items-center justify-between gap-3 rounded-md border border-shell bg-surface px-3 py-2.5 text-left text-sm text-foreground outline-none transition enabled:hover:border-accent/50 enabled:hover:bg-control-hover focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => {
          if (expanded) setOpen(false);
          else showOptions();
        }}
        onKeyDown={handleKeyDown}
      >
        <span
          className="min-w-0 flex-1 truncate"
          title={selectedLabel || emptyLabel}
        >
          {selectedLabel || emptyLabel}
        </span>
        <svg
          aria-hidden="true"
          className={`size-4 shrink-0 text-muted transition-transform ${expanded ? "rotate-180" : ""}`}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>
      {expanded && (
        <ul
          id={listId}
          role="listbox"
          aria-multiselectable={props.multiple || undefined}
          aria-labelledby={`${id}-label`}
          className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-shell bg-surface p-1 text-sm shadow-raised"
        >
          {options.map((option, index) => (
            <li key={option.value} role="none">
              <button
                type="button"
                role="option"
                id={`${id}-option-${index}`}
                aria-selected={selectedValues.includes(option.value)}
                tabIndex={-1}
                className={`flex w-full items-center justify-between gap-3 rounded-sm px-3 py-2 text-left ${index === activeIndex ? "bg-control-hover" : "hover:bg-control-hover"} ${selectedValues.includes(option.value) ? "font-semibold text-accent" : "text-foreground"}`}
                onMouseDown={(event) => event.preventDefault()}
                onPointerMove={() => setActive(index)}
                onClick={() => choose(index)}
              >
                {props.multiple && (
                  <span
                    aria-hidden="true"
                    className={`flex size-4 shrink-0 items-center justify-center rounded-sm border ${selectedValues.includes(option.value) ? "border-accent bg-accent text-surface" : "border-shell"}`}
                  >
                    {selectedValues.includes(option.value) ? "✓" : ""}
                  </span>
                )}
                <span className="min-w-0 flex-1 wrap-break-word">
                  {option.label}
                </span>
                {!props.multiple && selectedValues.includes(option.value) && (
                  <span aria-hidden="true">✓</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
