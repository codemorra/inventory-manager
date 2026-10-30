import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { containsChoiceTarget } from "./choiceSelectTargets";

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
  // Escape clipping ancestors only where the containing panel supports choice portals.
  portal?: boolean;
  compact?: boolean;
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
    portal = false,
    compact = false,
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
  const [keyboardNavigation, setKeyboardNavigation] = useState(false);
  const activeIndex = Math.max(0, Math.min(active, options.length - 1));
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const search = useRef({ text: "", time: 0 });
  const expanded = open && !disabled && options.length > 0;
  const listId = `${id}-options`;

  useLayoutEffect(() => {
    if (!expanded || !portal) return;
    /** Anchor the popup to its control while constraining only its window edges. */
    function position() {
      const element = list.current;
      const anchor = trigger.current?.getBoundingClientRect();
      if (!element || !anchor) return;
      const maximumWidth = Math.max(0, window.innerWidth - 16);
      element.style.minWidth = `${Math.min(anchor.width, maximumWidth)}px`;
      element.style.maxWidth = `${maximumWidth}px`;
      const rect = element.getBoundingClientRect();
      const width = Math.min(maximumWidth, rect.width || anchor.width);
      const below = Math.max(0, window.innerHeight - anchor.bottom - 12);
      const above = Math.max(0, anchor.top - 12);
      const desiredHeight = Math.min(
        192,
        element.scrollHeight || rect.height || 192,
      );
      const upward = below < desiredHeight && above > below;
      const maximumHeight = Math.min(192, upward ? above : below);
      const height = Math.min(desiredHeight, maximumHeight);
      element.style.maxHeight = `${maximumHeight}px`;
      element.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8))}px`;
      element.style.top = `${Math.max(8, upward ? anchor.top - height - 4 : anchor.bottom + 4)}px`;
    }
    /** Follow scrolling of the panel without reacting to the popup's own scroll. */
    function repositionOnScroll(event: Event) {
      if (event.target instanceof Node && list.current?.contains(event.target))
        return;
      position();
    }
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", repositionOnScroll, true);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", repositionOnScroll, true);
    };
  }, [expanded, portal, options]);

  useEffect(() => {
    if (!expanded) return;
    /**
     * Close the dropdown when a pointer is pressed outside its control.
     * @param event The pointer event to inspect.
     */
    function dismiss(event: PointerEvent) {
      if (!containsChoiceTarget(root.current, event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const element = list.current;
    const option = element
      ?.querySelectorAll<HTMLElement>('[role="option"]')
      .item(activeIndex);
    if (!element || !option) return;
    if (!portal) option.scrollIntoView?.({ block: "nearest" });
    else {
      // Scroll only the popup, keeping its panel and the page stationary.
      const bottom = option.offsetTop + option.offsetHeight;
      if (option.offsetTop < element.scrollTop)
        element.scrollTop = option.offsetTop;
      else if (bottom > element.scrollTop + element.clientHeight)
        element.scrollTop = bottom - element.clientHeight;
    }
  }, [expanded, activeIndex, id, portal]);

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
    setKeyboardNavigation(true);
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
      const now = event.timeStamp;
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

  const optionList = expanded ? (
    <ul
      ref={list}
      data-choice-owner={id}
      id={listId}
      role="listbox"
      aria-multiselectable={props.multiple || undefined}
      aria-labelledby={`${id}-label`}
      className={`overflow-y-auto overscroll-contain rounded-md border border-shell bg-surface p-1 text-sm text-foreground shadow-raised ${portal ? "fixed z-60 w-max" : "absolute z-10 mt-1 max-h-48 w-full"}`}
    >
      {options.map((option, index) => (
        <li key={option.value} role="none">
          <button
            type="button"
            role="option"
            id={`${id}-option-${index}`}
            aria-selected={selectedValues.includes(option.value)}
            tabIndex={-1}
            className={`flex w-full items-center justify-between gap-3 rounded-sm px-3 py-2 text-left ${keyboardNavigation && index === activeIndex ? "bg-control-hover" : "hover:bg-control-hover"} ${selectedValues.includes(option.value) ? "font-semibold text-accent-text" : "text-foreground"}`}
            onMouseDown={(event) => event.preventDefault()}
            onPointerEnter={() => {
              setKeyboardNavigation(false);
              setActive(index);
            }}
            onPointerMove={() => {
              setKeyboardNavigation(false);
              setActive(index);
            }}
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
  ) : null;

  return (
    <div
      className="relative min-w-0"
      ref={root}
      onBlur={(event) => {
        if (!containsChoiceTarget(event.currentTarget, event.relatedTarget))
          setOpen(false);
      }}
    >
      <label
        id={`${id}-label`}
        htmlFor={id}
        className={`block font-medium text-foreground ${compact ? "text-xs" : "text-sm"}`}
      >
        {label}
        {required && (
          <span aria-hidden="true" className="ml-1 text-accent-text">
            *
          </span>
        )}
      </label>
      <button
        ref={trigger}
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
        className={`mt-1.5 flex w-full items-center justify-between rounded-md border border-shell bg-surface text-left text-sm text-foreground outline-none transition enabled:hover:border-accent/50 enabled:hover:bg-control-hover focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-50 ${compact ? "gap-2 px-2.5 py-1.5" : "gap-3 px-3 py-2.5"}`}
        onClick={(event) => {
          setKeyboardNavigation(event.detail === 0);
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
      {portal && optionList
        ? createPortal(optionList, document.body)
        : optionList}
    </div>
  );
}
