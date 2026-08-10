// Styling for the bare `<input>`/`<select>`/`<textarea>` elements the admin
// forms use directly. This is deliberately NOT `@clubspace/ui-kit/ui` `Input`:
// that component is a taller, ring-focused control (h-9, shadow, focus ring),
// and these forms are built around the flatter border-highlight look. Swapping
// them is a design decision, not a refactor — until someone makes it, the look
// lives here once instead of in six files.
//
// `w-full` is not baked in: several call sites pin a width (`w-20`, `w-28`,
// `max-w-xs`), and a `w-full` in the base would collide with those. Use
// `inputClsFull` where the control should stretch.
export const inputCls =
  "rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"

export const inputClsFull = `w-full ${inputCls}`
