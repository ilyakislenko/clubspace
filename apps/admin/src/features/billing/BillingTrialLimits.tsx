import type { WorkspaceBilling } from "../../shared/api/billing"
import { trialLimitRows } from "./billing-view"
import { UsageMeter } from "./UsageMeter"

// «Ограничения пробного периода»: the caps in force while the club is on the
// trial and has paid nothing yet. Paying lifts them.
export function BillingTrialLimits({ billing }: { billing: WorkspaceBilling }) {
  if (!billing.trial.limited) return null
  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <h2 className="text-sm font-medium">Ограничения пробного периода</h2>
      {trialLimitRows(billing).map((row) => (
        <UsageMeter
          key={row.label}
          label={row.label}
          usedLabel={row.usedLabel}
          percent={row.percent}
        />
      ))}
      <p className="text-xs text-muted-foreground">
        Оплатите тариф, чтобы снять ограничение.
      </p>
    </section>
  )
}
