/**
 * A text field for CSS length values.
 *
 * Accepts anything CSS accepts (`24px`, `4rem`, `60ch`, `clamp(...)`) but adds
 * two conveniences borrowed from design tools: a bare number gains `px`, and
 * arrow keys step the numeric part — Shift for tens, Alt for tenths.
 *
 * When a value is inherited from a wider breakpoint it shows as a placeholder,
 * so the field reads as "this is what you'd get" rather than "this is set".
 */

import { useEffect, useRef, useState } from 'react';
import { TextInput } from '../../ui/controls';

export interface DimensionInputProps {
  value: string | undefined;
  /** Shown greyed when the value comes from a wider breakpoint. */
  inheritedValue?: string | undefined;
  placeholder?: string;
  onChange: (value: string, options?: { coalesce?: boolean }) => void;
  id?: string;
  'aria-label'?: string;
  disabled?: boolean;
}

const NUMERIC = /^(-?\d*\.?\d+)([a-z%]*)$/i;

export function stepValue(raw: string, delta: number): string | null {
  const match = NUMERIC.exec(raw.trim());
  if (!match) return null;
  const [, digits, unit] = match;
  const next = Number.parseFloat(digits!) + delta;
  const rounded = Math.round(next * 1000) / 1000;
  return `${rounded}${unit || 'px'}`;
}

/** A bare number is almost always pixels. */
export function normaliseDimension(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') return '';
  if (/^-?\d*\.?\d+$/.test(trimmed)) return `${trimmed}px`;
  return trimmed;
}

export function DimensionInput({
  value,
  inheritedValue,
  placeholder,
  onChange,
  id,
  disabled,
  ...rest
}: DimensionInputProps): React.ReactElement {
  const [draft, setDraft] = useState(value ?? '');
  const focused = useRef(false);

  // Track external changes (undo, Intent, breakpoint switch) unless the user
  // is mid-edit, where clobbering the field would be hostile.
  useEffect(() => {
    if (!focused.current) setDraft(value ?? '');
  }, [value]);

  return (
    <TextInput
      id={id}
      value={draft}
      disabled={disabled}
      placeholder={inheritedValue ?? placeholder ?? 'auto'}
      spellCheck={false}
      autoComplete="off"
      aria-label={rest['aria-label']}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={(event) => {
        focused.current = false;
        const next = normaliseDimension(event.target.value);
        setDraft(next);
        if (next !== (value ?? '')) onChange(next);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur();
          return;
        }
        if (event.key === 'Escape') {
          setDraft(value ?? '');
          event.currentTarget.blur();
          return;
        }
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;

        const base = draft.trim() === '' ? (inheritedValue ?? '0px') : draft;
        const magnitude = event.shiftKey ? 10 : event.altKey ? 0.1 : 1;
        const stepped = stepValue(base, event.key === 'ArrowUp' ? magnitude : -magnitude);
        if (stepped === null) return;

        event.preventDefault();
        setDraft(stepped);
        // Held arrow keys coalesce into one undo step.
        onChange(stepped, { coalesce: true });
      }}
    />
  );
}
