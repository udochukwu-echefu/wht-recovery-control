"use client";

import {
  useState,
  useRef,
  useId,
  useEffect,
  KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { ChevronDown, Check } from "lucide-react";

type SelectOption<T extends string> = { value: T; label: string };

export function CustomSelect<T extends string>({
  id,
  value,
  options,
  onChange,
  ariaLabel,
  disabled = false,
  className = "",
}: {
  id?: string;
  value: T;
  options: Array<SelectOption<T>>;
  onChange: (value: T) => void;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(
    Math.max(
      0,
      options.findIndex((option) => option.value === value),
    ),
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const selected = options[selectedIndex] ?? options[0];

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", closeOutside);
    return () => window.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  const choose = (index: number) => {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setActiveIndex(index);
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIndex(selectedIndex);
        return;
      }
      setActiveIndex((current) =>
        event.key === "ArrowDown"
          ? (current + 1) % options.length
          : (current - 1 + options.length) % options.length,
      );
    }
    if ((event.key === "Enter" || event.key === " ") && open) {
      event.preventDefault();
      choose(activeIndex);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex(selectedIndex);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
    if (event.key === "Home" && open) {
      event.preventDefault();
      setActiveIndex(0);
    }
    if (event.key === "End" && open) {
      event.preventDefault();
      setActiveIndex(options.length - 1);
    }
  };

  return (
    <div
      className={`custom-select ${open ? "is-open" : ""} ${className}`}
      ref={rootRef}
    >
      <button
        id={id}
        type="button"
        ref={triggerRef}
        className="custom-select-trigger"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listboxId}
        aria-haspopup="listbox"
        aria-activedescendant={open ? `${listboxId}-${activeIndex}` : undefined}
        disabled={disabled}
        onClick={() => {
          setOpen((current) => !current);
          setActiveIndex(selectedIndex);
        }}
        onKeyDown={onKeyDown}
        onBlur={(event) => {
          if (!rootRef.current?.contains(event.relatedTarget as Node | null))
            setOpen(false);
        }}
      >
        <span>{selected?.label ?? value}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open && (
        <div
          className="custom-select-menu"
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
        >
          {options.map((option, index) => (
            <button
              type="button"
              tabIndex={-1}
              id={`${listboxId}-${index}`}
              role="option"
              aria-selected={option.value === value}
              className={index === activeIndex ? "active" : ""}
              key={option.value}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(index)}
            >
              <span>{option.label}</span>
              {option.value === value && <Check size={14} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
