"use client"

// Accessible on/off switch. The visible caption lives next to the control;
// `label` is the full sentence announced to screen readers.
export function SettingSwitch({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean
  disabled?: boolean
  label: string
  onChange: (next: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? "bg-primary" : "bg-input"
      }`}
    >
      <span
        aria-hidden
        className={`inline-block size-5 rounded-full bg-background shadow transition-transform ${
          checked ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  )
}

// One switch row: caption and explanation on the left, the switch on the right.
export function SettingRow({
  title,
  description,
  children,
  note,
}: {
  title: string
  description: React.ReactNode
  // Extra line under the description (who pinned the value, what is missing).
  note?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        {note}
      </div>
      {children}
    </li>
  )
}
