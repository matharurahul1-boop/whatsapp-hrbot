'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils/cn';

interface SelectOrCustomProps {
  value:       string;
  onChange:    (v: string) => void;
  options:     string[];
  placeholder?: string;
  required?:   boolean;
  className?:  string;
}

/** Dropdown of preset options with an "Other" escape hatch that swaps in a
 *  free-text input — used wherever a field should stay consistent across
 *  most entries but still allow a value that isn't on the list yet. */
export function SelectOrCustom({ value, onChange, options, placeholder, required, className }: SelectOrCustomProps) {
  const isPreset = value === '' || options.includes(value);
  const [customMode, setCustomMode] = useState(!isPreset);

  if (customMode) {
    return (
      <div className="relative">
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          autoFocus
          className={cn(className, 'pr-24')}
        />
        <button
          type="button"
          onClick={() => { setCustomMode(false); onChange(''); }}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-2xs font-medium text-brand-400 hover:text-brand-300"
        >
          Choose from list
        </button>
      </div>
    );
  }

  return (
    <select
      value={value}
      onChange={e => {
        if (e.target.value === '__other__') { setCustomMode(true); onChange(''); }
        else onChange(e.target.value);
      }}
      required={required}
      className={className}
    >
      <option value="" disabled>{placeholder ?? 'Select…'}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
      <option value="__other__">Other (specify)…</option>
    </select>
  );
}
