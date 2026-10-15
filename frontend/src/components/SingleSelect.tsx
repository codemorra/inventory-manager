import { useEffect, useRef, useState, type KeyboardEvent } from "react";

// Define a named choice for a single-selection dropdown.
export interface SelectOption {
  value: string;
  label: string;
}

// Configure a controlled dropdown that inherits the application's theme.
interface SingleSelectProps {
  id: string;
  label: string;
  describedBy?: string;
  options: SelectOption[];
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}

/**
 * Render a styled single-choice dropdown with keyboard and pointer navigation.
 * @param id The stable identifier connecting the label and dropdown.
 * @param label The visible label and accessible name.
 * @param describedBy The optional identifier of explanatory text.
 * @param options The available values and their translated labels.
 * @param value The currently selected value.
 * @param disabled Whether selection is disabled.
 * @param onChange Apply a selected value to the containing form.
 * @returns The labeled combobox and its themed option list.
 */
export function SingleSelect({
  id,
  label,
  describedBy,
  options,
  value,
  disabled = false,
  onChange,
}: SingleSelectProps) {
  const [open, setOpen] = useState(false);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const search = useRef({ text: "", time: 0 });
  const expanded = open && !disabled;
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
        .item(active)
        ?.scrollIntoView?.({ block: "nearest" });
  }, [expanded, active, id]);

  // Start navigation at the selected option without committing a new value.
  function showOptions() {
    setActive(Math.max(0, selectedIndex));
    search.current = { text: "", time: 0 };
    setOpen(true);
  }

  /**
   * Commit a choice and return focus to the combobox.
   * @param index The selected option's index.
   */
  function choose(index: number) {
    const option = options[index];
    if (option) onChange(option.value);
    setOpen(false);
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
      const current = expanded ? active : Math.max(0, selectedIndex);
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
      if (expanded) choose(active);
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
      </label>
      <button
        id={id}
        type="button"
        role="combobox"
        aria-labelledby={`${id}-label`}
        aria-describedby={describedBy}
        aria-expanded={expanded}
        aria-controls={listId}
        aria-haspopup="listbox"
        aria-activedescendant={expanded ? `${id}-option-${active}` : undefined}
        disabled={disabled}
        className="mt-1.5 flex w-full items-center justify-between gap-3 rounded-md border border-shell bg-surface px-3 py-2.5 text-left text-sm text-foreground outline-none transition enabled:hover:border-accent/50 enabled:hover:bg-control-hover focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => {
          if (expanded) setOpen(false);
          else showOptions();
        }}
        onKeyDown={handleKeyDown}
      >
        <span className="truncate">{options[selectedIndex]?.label ?? ""}</span>
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
          aria-labelledby={`${id}-label`}
          className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-shell bg-surface p-1 text-sm shadow-raised"
        >
          {options.map((option, index) => (
            <li key={option.value} role="none">
              <button
                type="button"
                role="option"
                id={`${id}-option-${index}`}
                aria-selected={option.value === value}
                tabIndex={-1}
                className={`flex w-full items-center justify-between gap-3 rounded-sm px-3 py-2 text-left ${index === active ? "bg-control-hover" : "hover:bg-control-hover"} ${option.value === value ? "font-semibold text-accent" : "text-foreground"}`}
                onMouseDown={(event) => event.preventDefault()}
                onPointerMove={() => setActive(index)}
                onClick={() => choose(index)}
              >
                {option.label}
                {option.value === value && <span aria-hidden="true">✓</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
