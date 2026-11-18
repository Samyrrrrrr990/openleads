/**
 * Editor control primitives.
 *
 * Every control here is keyboard reachable and labelled. Inspector rows use
 * `Field`, which pairs a visible label with its input so the panel stays
 * navigable without a mouse.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import styles from './controls.module.css';

type Variant = 'default' | 'primary' | 'ghost' | 'outline' | 'danger';

const VARIANT_CLASS: Record<Variant, string> = {
  default: '',
  primary: styles.primary!,
  ghost: styles.ghost!,
  outline: styles.outline!,
  danger: styles.danger!,
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'default' | 'large';
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'default', className = '', type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={[styles.button, VARIANT_CLASS[variant], size === 'large' ? styles.large : '', className]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    />
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: icon-only controls must still announce themselves. */
  label: string;
  active?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, active = false, className = '', children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={rest['aria-pressed'] ?? (active ? true : undefined)}
      className={[styles.iconButton, active ? styles.iconButtonActive : '', className]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {children}
    </button>
  );
});

export function Field({
  label,
  children,
  overridden,
  pinned,
  onUnpin,
  wide,
  htmlFor,
}: {
  label: string;
  children: ReactNode;
  /** Marks a value overridden at the current breakpoint. */
  overridden?: boolean;
  /** Marks a value set on this instance rather than following its component. */
  pinned?: boolean;
  /** Gives a pinned value back to the component. */
  onUnpin?: () => void;
  wide?: boolean;
  htmlFor?: string;
}): React.ReactElement {
  return (
    <div className={styles.field}>
      {pinned && onUnpin ? (
        <button
          type="button"
          className={styles.pinDot}
          onClick={onUnpin}
          title={`${label} is set on this instance. Click to follow the component again.`}
          aria-label={`${label} is set on this instance. Follow the component again`}
        />
      ) : overridden ? (
        <span className={styles.overrideDot} title="Overridden at this breakpoint" />
      ) : (
        <span className={styles.overrideSlot} aria-hidden="true" />
      )}
      <label className={`${styles.label} ${wide ? styles.labelWide : ''}`} htmlFor={htmlFor}>
        {label}
      </label>
      <div className={styles.control}>{children}</div>
    </div>
  );
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function TextInput({ className = '', ...rest }, ref) {
    return <input ref={ref} className={`${styles.input} ${className}`} {...rest} />;
  },
);

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function TextArea({ className = '', ...rest }, ref) {
    return <textarea ref={ref} className={`${styles.input} ${styles.textarea} ${className}`} {...rest} />;
  },
);

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: readonly { value: string; label: string }[];
  /** Shown when the value is inherited rather than explicitly set. */
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { options, placeholder, className = '', value, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={`${styles.select} ${className}`} value={value ?? ''} {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
});

export interface SegmentedProps<T extends string> {
  label: string;
  value: T | null;
  options: readonly { value: T; label: string; title?: string; icon?: ReactNode }[];
  onChange: (value: T) => void;
  full?: boolean;
}

/**
 * A radio group styled as a segmented control. Uses real radio semantics so
 * arrow keys move between options.
 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  full,
}: SegmentedProps<T>): React.ReactElement {
  return (
    <div
      className={`${styles.segmented} ${full ? styles.segmentedFull : ''}`}
      role="radiogroup"
      aria-label={label}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          aria-label={option.title ?? option.label}
          title={option.title ?? option.label}
          tabIndex={value === option.value || (value === null && option === options[0]) ? 0 : -1}
          className={`${styles.segment} ${value === option.value ? styles.segmentActive : ''}`}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => {
            const index = options.findIndex((o) => o.value === value);
            if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
              event.preventDefault();
              onChange(options[(index + 1 + options.length) % options.length]!.value);
            }
            if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
              event.preventDefault();
              onChange(options[(index - 1 + options.length) % options.length]!.value);
            }
          }}
        >
          {option.icon ?? option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * A colour swatch paired with a hex field.
 *
 * The native picker fires continuously while dragging, so those updates are
 * marked as coalescing by the caller — one drag becomes one undo step.
 */
export interface ColorToken {
  /** Stored value, e.g. `var(--color-accent)`. */
  value: string;
  /** The literal behind it, for the swatch. */
  resolved: string;
  label: string;
}

export function ColorInput({
  value,
  onChange,
  onCommit,
  placeholder = 'inherit',
  id,
  tokens,
  resolved,
}: {
  value: string;
  onChange: (value: string) => void;
  onCommit?: () => void;
  placeholder?: string;
  id?: string;
  /**
   * Project design tokens offered as one-click choices.
   *
   * Picking one stores a reference rather than a colour, which is what makes a
   * later theme change reach this element. Typing a hex is still allowed and
   * still means "exactly this colour, forever".
   */
  tokens?: readonly ColorToken[];
  /** The literal behind `value` when it is a token reference. */
  resolved?: string;
}): React.ReactElement {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  const fallbackId = useId();
  const inputId = id ?? fallbackId;

  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  const commitText = useCallback(
    (raw: string) => {
      const trimmed = raw.trim();
      if (trimmed === '') {
        onChange('');
        return;
      }
      const normalised = /^[0-9a-f]{3,8}$/i.test(trimmed) ? `#${trimmed}` : trimmed;
      onChange(normalised);
    },
    [onChange],
  );

  const literal = resolved ?? value;

  const field = (
    <div className={styles.colorField}>
      <span className={styles.swatch}>
        <span className={styles.swatchFill} style={{ background: literal || 'transparent' }} />
        <input
          type="color"
          className={styles.swatchInput}
          aria-label="Pick a colour"
          value={toHex(literal)}
          onChange={(event) => {
            setDraft(event.target.value);
            onChange(event.target.value);
          }}
          onBlur={onCommit}
        />
      </span>
      <input
        id={inputId}
        className={styles.colorText}
        value={draft}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => {
          focused.current = false;
          commitText(event.target.value);
          onCommit?.();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            setDraft(value);
            event.currentTarget.blur();
          }
        }}
      />

    </div>
  );

  if (!tokens || tokens.length === 0) return field;

  return (
    <div className={styles.colorStack}>
      {field}
      <span className={styles.tokenRow} role="group" aria-label="Project colours">
        {tokens.map((token) => (
          <button
            key={token.value}
            type="button"
            className={`${styles.tokenChip} ${value === token.value ? styles.tokenChipActive : ''}`}
            style={{ background: token.resolved }}
            title={`${token.label} — follows the project`}
            aria-label={`Use the project ${token.label.toLowerCase()} colour`}
            aria-pressed={value === token.value}
            onClick={() => {
              setDraft(token.value);
              onChange(token.value);
              onCommit?.();
            }}
          />
        ))}
      </span>
    </div>
  );
}

/** The native colour input only accepts `#rrggbb`. */
function toHex(value: string): string {
  const match = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (match) return `#${match[1]!.toLowerCase()}`;
  const short = /^#([0-9a-f]{3})$/i.exec(value.trim());
  if (short) {
    const [r, g, b] = short[1]!.toLowerCase();
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return '#000000';
}

export function CollapsibleSection({
  title,
  children,
  defaultOpen = true,
  action,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  action?: ReactNode;
}): React.ReactElement {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  return (
    <section className={styles.section}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <button
          type="button"
          className={styles.sectionHeader}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={bodyId}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <svg
              className={`${styles.sectionChevron} ${open ? styles.sectionChevronOpen : ''}`}
              width="8"
              height="8"
              viewBox="0 0 8 8"
              aria-hidden="true"
            >
              <path d="M2.5 1L5.5 4L2.5 7" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {title}
          </span>
        </button>
        {action}
      </div>
      {open && (
        <div className={styles.sectionBody} id={bodyId}>
          {children}
        </div>
      )}
    </section>
  );
}

export function Kbd({ children }: { children: ReactNode }): React.ReactElement {
  return <kbd className={styles.kbd}>{children}</kbd>;
}

export { styles as controlStyles };
