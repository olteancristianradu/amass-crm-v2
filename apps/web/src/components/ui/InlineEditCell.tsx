import { useState } from 'react';

/**
 * Inline-edit primitive for table cells. Click → text input; Enter or
 * blur → save (callback returns a promise); Esc → revert. Pending state
 * dims the input + disables it during the round trip.
 *
 * Empty values render as a faint italic "— click —" placeholder so the
 * editing affordance is visible without a visual handle hovering on
 * every row.
 *
 * Designed to be drop-in for any list page that wants a single-field
 * inline edit. For multi-field row editing, build a dedicated form.
 *
 * Drift-resistance: when `editing` is false and the prop value changes
 * (the row refetched from the server), the local draft snaps back to
 * the new value. Doesn't compete with the user's in-progress edit.
 */
export function InlineEditCell({
  value,
  placeholder,
  onSave,
  ariaLabel,
}: {
  value: string;
  placeholder: string;
  onSave: (next: string) => Promise<unknown>;
  ariaLabel?: string;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  if (!editing && draft !== value) setDraft(value);

  async function commit(): Promise<void> {
    if (draft === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={ariaLabel ?? `Editează ${placeholder}`}
        className="w-full rounded px-1 py-0.5 text-left text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
        title="Click pentru editare"
      >
        {value || <span className="italic text-muted-foreground/60">— click —</span>}
      </button>
    );
  }

  return (
    <input
      type="text"
      autoFocus
      value={draft}
      placeholder={placeholder}
      disabled={saving}
      aria-label={ariaLabel ?? placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          setDraft(value);
          setEditing(false);
        }
      }}
      className={`w-full rounded border border-ring/30 bg-background px-2 py-0.5 text-sm focus:border-ring focus:outline-none ${
        saving ? 'opacity-50' : ''
      }`}
    />
  );
}
