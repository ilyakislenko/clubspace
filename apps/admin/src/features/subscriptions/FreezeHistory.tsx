import type { MemberSubscriptions } from "../../shared/api/subscriptions"
import { formatDayRange, freezePhaseLabel, todayYmd } from "./freeze-utils"

// Every freeze the member has had, newest first (the server orders them).
export function FreezeHistory({
  freezes,
  history,
}: {
  freezes: MemberSubscriptions["freezes"]
  history: MemberSubscriptions["history"]
}) {
  if (freezes.length === 0) return null
  const today = todayYmd(new Date())
  const planName = (subscriptionId: string): string =>
    history.find((s) => s.id === subscriptionId)?.planName ?? "Абонемент"

  return (
    <div className="space-y-1">
      <h3 className="text-sm font-medium">Заморозки</h3>
      <ul className="divide-y divide-border rounded-md border border-border text-sm">
        {freezes.map((f) => (
          <li
            key={f.id}
            className="flex items-center justify-between gap-2 px-3 py-2"
          >
            <span className="min-w-0">
              {planName(f.subscriptionId)} ·{" "}
              {formatDayRange(f.fromDate, f.untilDate)} · {f.days} дн.
              {f.reason ? ` · ${f.reason}` : ""}
            </span>
            <span className="text-muted-foreground">
              {freezePhaseLabel(f, today)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
