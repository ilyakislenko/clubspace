import type { WorkspaceOnboarding } from "../../shared/api/billing"

type Step = WorkspaceOnboarding["steps"][number]

// Steps a club can launch without: online payment (cash and transfers work)
// and video (a club may never film). They are offered, never awaited.
const OPTIONAL: Partial<Record<Step["key"], true>> = { payments: true, video: true }

/**
 * What the launch checklist shows: the steps still to do (required first, in
 * the server's order) and the required progress. `complete` once every
 * required step is done, whatever the optional ones say.
 */
export const checklistState = (steps: readonly Step[]) => {
  const required = steps.filter((s) => !OPTIONAL[s.key])
  const requiredDone = required.filter((s) => s.done).length
  const todo = steps
    .filter((s) => !s.done)
    .map((s) => ({ key: s.key, optional: OPTIONAL[s.key] === true }))
    .sort((a, b) => Number(a.optional) - Number(b.optional))
  return {
    todo,
    requiredDone,
    requiredTotal: required.length,
    complete: requiredDone === required.length,
  }
}
