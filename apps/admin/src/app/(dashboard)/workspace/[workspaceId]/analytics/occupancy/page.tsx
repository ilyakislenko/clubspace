"use client"

import { useParams } from "next/navigation"
import { useCallback, useEffect, useState } from "react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@clubspace/ui-kit/ui"

import {
  getScheduleOccupancy,
  type OccupancySlot,
  type ScheduleOccupancy,
} from "../../../../../../shared/api/analytics"
import {
  EMPTY_ANALYTICS_FILTER,
  WEEKDAYS,
  WEEKDAY_SHORT,
  analyticsScope,
  fillCellClass,
  formatAverage,
  formatPercent,
  heatmapGrid,
  slotLabel,
} from "../../../../../../shared/lib/analytics"
import { errorMessage } from "../../../../../../shared/lib/error-message"
import {
  AnalyticsError,
  AnalyticsFilters,
  AnalyticsFreshness,
  AnalyticsSkeleton,
} from "../analytics-toolbar"

const WEEK_OPTIONS = [4, 8, 12, 26]

export default function OccupancyPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId

  const [filter, setFilter] = useState(EMPTY_ANALYTICS_FILTER)
  const [weeks, setWeeks] = useState(8)
  const [data, setData] = useState<ScheduleOccupancy | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!workspaceId) return
    try {
      setData(
        await getScheduleOccupancy({
          workspaceId,
          weeks,
          ...analyticsScope(filter),
        }),
      )
      setError(null)
    } catch (err) {
      setError(errorMessage(err, "Не удалось загрузить загрузку расписания."))
    } finally {
      setLoading(false)
    }
  }, [workspaceId, weeks, filter])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Загрузка расписания</h1>
        <p className="text-sm text-muted-foreground">
          Сколько в среднем приходит на каждое занятие относительно состава
          группы — по отметкам посещаемости.
        </p>
        <AnalyticsFreshness
          workspaceId={workspaceId}
          computedAt={data?.computedAt}
          onRefreshed={load}
        />
      </div>

      <AnalyticsFilters
        workspaceId={workspaceId}
        value={filter}
        onChange={setFilter}
      >
        <div className="w-40">
          <Select
            value={String(weeks)}
            onValueChange={(v) => setWeeks(Number(v))}
          >
            <SelectTrigger aria-label="Период">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WEEK_OPTIONS.map((w) => (
                <SelectItem key={w} value={String(w)}>
                  {w} недель
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </AnalyticsFilters>

      <AnalyticsError message={error} />

      {loading ? (
        <AnalyticsSkeleton />
      ) : !data || data.slots.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          В расписании пока нет занятий с отметками посещаемости.
        </p>
      ) : (
        <>
          {data.suggestions.length > 0 && (
            <section className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-4">
              <h2 className="text-sm font-medium">Что сделать</h2>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {data.suggestions.map((s, i) => (
                  <li key={`${s.kind}:${s.slotId}:${i}`}>{s.text}</li>
                ))}
              </ul>
            </section>
          )}

          {data.heatmap.map((gym) => (
            <Heatmap
              key={gym.gymId ?? "none"}
              title={gym.gymName ?? "Без зала"}
              cells={gym.cells}
            />
          ))}

          <div className="grid gap-4 lg:grid-cols-2">
            <SlotList title="Слабые слоты" slots={data.weakest} />
            <SlotList title="Сильные слоты" slots={data.strongest} />
          </div>

          <section className="space-y-2">
            <h2 className="text-sm font-medium">Все слоты</h2>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="p-3">Когда</th>
                    <th className="p-3">Группа</th>
                    <th className="p-3">Зал</th>
                    <th className="p-3 text-right">Проведено</th>
                    <th className="p-3 text-right">Приходят</th>
                    <th className="p-3 text-right">Мест</th>
                    <th className="p-3 text-right">Заполненность</th>
                    <th className="p-3 text-right">Записи / не пришли</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.slots.map((s) => (
                    <tr key={s.slotId}>
                      <td className="whitespace-nowrap p-3">
                        {WEEKDAY_SHORT[s.dayOfWeek]} {s.startTime}
                      </td>
                      <td className="p-3">{s.groupName}</td>
                      <td className="p-3 text-muted-foreground">
                        {s.gymName ?? "—"}
                      </td>
                      <td className="p-3 text-right tabular-nums">
                        {s.held} из {s.scheduled}
                      </td>
                      <td className="p-3 text-right tabular-nums">
                        {formatAverage(s.avgAttendance)}
                      </td>
                      <td className="p-3 text-right tabular-nums">
                        {s.capacity}
                      </td>
                      <td className="p-3 text-right">
                        <span
                          className={`inline-block rounded px-2 py-0.5 tabular-nums ${fillCellClass(s.fill)}`}
                        >
                          {formatPercent(s.fill)}
                        </span>
                      </td>
                      <td className="p-3 text-right tabular-nums">
                        {s.booked} / {s.missedBookings}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function Heatmap({
  title,
  cells,
}: {
  title: string
  cells: ScheduleOccupancy["heatmap"][number]["cells"]
}) {
  const grid = heatmapGrid(cells)
  if (grid.hours.length === 0) return null
  return (
    <section className="space-y-2 rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-medium">{title}</h2>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-1 text-xs">
          <thead>
            <tr>
              <th className="w-14" />
              {WEEKDAYS.map((d) => (
                <th key={d} className="font-medium text-muted-foreground">
                  {WEEKDAY_SHORT[d]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.hours.map((h) => (
              <tr key={h}>
                <td className="pr-2 text-right tabular-nums text-muted-foreground">
                  {String(h).padStart(2, "0")}:00
                </td>
                {WEEKDAYS.map((d) => {
                  const cell = grid.at(d, h)
                  return (
                    <td
                      key={d}
                      className={`h-9 rounded text-center tabular-nums ${
                        cell ? fillCellClass(cell.fill) : "bg-muted/30"
                      }`}
                      title={
                        cell
                          ? `${WEEKDAY_SHORT[d]} ${h}:00 — в среднем ${formatAverage(cell.avgAttendance)} из ${cell.capacity}${
                              cell.slots > 1 ? ` (занятий: ${cell.slots})` : ""
                            }`
                          : undefined
                      }
                    >
                      {cell ? formatPercent(cell.fill) : ""}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function SlotList({
  title,
  slots,
}: {
  title: string
  slots: readonly OccupancySlot[]
}) {
  return (
    <section className="space-y-2 rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-medium">{title}</h2>
      {slots.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Мало проведённых занятий, чтобы судить.
        </p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {slots.map((s) => (
            <li
              key={s.slotId}
              className="flex items-center justify-between gap-3 py-2"
            >
              <span className="min-w-0 truncate">{slotLabel(s)}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {formatAverage(s.avgAttendance)} из {s.capacity} ·{" "}
                <span
                  className={`rounded px-1.5 py-0.5 text-foreground ${fillCellClass(s.fill)}`}
                >
                  {formatPercent(s.fill)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
