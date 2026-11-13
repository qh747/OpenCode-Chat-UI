import { useEffect, useRef, useState } from "react";

export interface DropdownOption {
  value: string;
  label: string;
  group?: string;
}

interface DropdownProps {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  /** Shown on the closed button when no option matches `value`. */
  placeholder?: string;
  title?: string;
  /** Wider variant for long model names. */
  wide?: boolean;
}

/**
 * Styled dropdown (button + popup menu) replacing native <select> — themed
 * via CSS variables, closes on outside click / Escape.
 */
export function Dropdown({ value, options, onChange, placeholder = "…", title, wide }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const groups: { group?: string; items: DropdownOption[] }[] = [];
  for (const option of options) {
    const last = groups[groups.length - 1];
    if (option.group !== undefined && last?.group === option.group) {
      last.items.push(option);
    } else {
      groups.push({ group: option.group, items: [option] });
    }
  }

  return (
    <div className={`dropdown${wide ? " dropdown-wide" : ""}`} ref={rootRef}>
      <button
        className="dropdown-button"
        onClick={() => setOpen((current) => !current)}
        title={title ?? selected?.label ?? placeholder}
      >
        <span className="dropdown-label">{selected?.label ?? placeholder}</span>
        <span className="dropdown-caret">▾</span>
      </button>
      {open && (
        <div className="dropdown-menu" role="listbox">
          {groups.map((entry, index) => (
            <div key={entry.group ?? `g${index}`}>
              {entry.group && <div className="dropdown-group">{entry.group}</div>}
              {entry.items.map((option) => (
                <button
                  key={option.value}
                  className={`dropdown-item${option.value === value ? " selected" : ""}`}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  {option.label}
                  {option.value === value && <span className="dropdown-check">✓</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
