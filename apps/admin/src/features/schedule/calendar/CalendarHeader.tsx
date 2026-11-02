"use client"

import {
  Building2,
  CalendarDays,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Grid2x2,
  Grid3x3,
  Layers,
  List,
  Settings2,
} from "lucide-react"

import {
  Button,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@clubspace/ui-kit/ui"
import { cn } from "@clubspace/ui-kit/util"

import type { Direction } from "../../../shared/api/directions"
import { pluralRu } from "../../../shared/lib/plural-ru"
import { DirectionFilter } from "../../directions/DirectionFilter"
import {
  formatHm,
  monthShort,
  monthTitle,
  navigateAnchor,
  rangeLabel,
  type CalendarView,
  type DayLayout,
  type HourRange,
} from "./calendar-helpers"
import { activeFilterCount, ALL, EMPTY_FILTERS, type CalendarFilters } from "./calendar-items"

const VIEW_OPTIONS: Array<{ view: CalendarView; label: string; icon: typeof List }> = [
  { view: "day", label: "День", icon: CalendarDays },
  { view: "week", label: "Неделя", icon: Columns3 },
  { view: "month", label: "Месяц", icon: Grid2x2 },
  { view: "year", label: "Год", icon: Grid3x3 },
  { view: "agenda", label: "Список", icon: List },
]

const DAY_LAYOUT_OPTIONS: Array<{ layout: DayLayout; label: string; icon: typeof List }> = [
  { layout: "halls", label: "По залам", icon: Building2 },
  { layout: "combined", label: "Общая", icon: Layers },
]

type Option = { id: string; label: string }

type Props = {
  view: CalendarView
  onViewChange: (view: CalendarView) => void
  // Day view with every hall: one shared column or a column per hall.
  dayLayout: DayLayout | null
  onDayLayoutChange: (layout: DayLayout) => void
  anchor: string
  onAnchorChange: (anchor: string) => void
  today: string
  classCount: number
  filters: CalendarFilters
  onFiltersChange: (filters: CalendarFilters) => void
  gyms: Option[]
  coaches: Option[]
  groups: Option[]
  directions: Direction[]
  hours: HourRange
  onHoursChange: (hours: HourRange) => void
  workingHours: HourRange
  onWorkingHoursChange: (hours: HourRange) => void
}

/** Today button, date navigator, view switcher and filters (volt's calendar header). */
export function CalendarHeader(props: Props) {
  const { view, anchor, today, filters, onFiltersChange } = props
  const set = (patch: Partial<CalendarFilters>) => onFiltersChange({ ...filters, ...patch })

  return (
    <div className="space-y-3">
      {/* Wraps by its own width, not the window's: with the sidebar expanded a
          1280 window leaves ~980px, and `lg:` rows overflowed the content. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => props.onAnchorChange(today)}
            title="Сегодня"
            className="flex size-14 flex-col items-start overflow-hidden rounded-lg border border-border text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <span className="flex h-6 w-full items-center justify-center bg-primary text-[11px] font-semibold uppercase text-primary-foreground">
              {monthShort(today)}
            </span>
            <span className="flex w-full flex-1 items-center justify-center text-lg font-bold">
              {Number(today.slice(8, 10))}
            </span>
          </button>
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold">
                {view === "year" ? anchor.slice(0, 4) : monthTitle(anchor)}
              </span>
              <span className="rounded-md border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
                {props.classCount} {pluralRu(props.classCount, "занятие", "занятия", "занятий")}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                className="size-7"
                aria-label="Назад"
                onClick={() => props.onAnchorChange(navigateAnchor(view, anchor, -1))}
              >
                <ChevronLeft />
              </Button>
              <p className="min-w-[13rem] text-center text-sm text-muted-foreground">
                {rangeLabel(view, anchor)}
              </p>
              <Button
                variant="outline"
                size="icon"
                className="size-7"
                aria-label="Вперёд"
                onClick={() => props.onAnchorChange(navigateAnchor(view, anchor, 1))}
              >
                <ChevronRight />
              </Button>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="Вид календаря" className="inline-flex rounded-md border border-border p-0.5">
            {VIEW_OPTIONS.map(({ view: v, label, icon: Icon }) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                data-calendar-view={v}
                onClick={() => props.onViewChange(v)}
                className={cn(
                  "inline-flex items-center gap-1.5 whitespace-nowrap rounded px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
                  view === v && "bg-primary text-primary-foreground shadow hover:text-primary-foreground",
                )}
              >
                <Icon className="size-4" />
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>
          {props.dayLayout && (
            <div role="group" aria-label="Раскладка дня" className="inline-flex rounded-md border border-border p-0.5">
              {DAY_LAYOUT_OPTIONS.map(({ layout, label, icon: Icon }) => (
                <button
                  key={layout}
                  type="button"
                  aria-pressed={props.dayLayout === layout}
                  data-calendar-day-layout={layout}
                  onClick={() => props.onDayLayoutChange(layout)}
                  className={cn(
                    "inline-flex items-center gap-1.5 whitespace-nowrap rounded px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
                    props.dayLayout === layout && "bg-accent text-foreground shadow-sm",
                  )}
                >
                  <Icon className="size-4" />
                  <span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </div>
          )}
          <HoursSettings {...props} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          label="Зал"
          all="Все залы"
          value={filters.gymId}
          options={props.gyms}
          onChange={(gymId) => set({ gymId })}
        />
        <DirectionFilter
          directions={props.directions}
          value={filters.directionId}
          onChange={(directionId) => set({ directionId })}
        />
        <FilterSelect
          label="Тренер"
          all="Все тренеры"
          value={filters.coachId}
          options={props.coaches}
          onChange={(coachId) => set({ coachId })}
        />
        <FilterSelect
          label="Группа"
          all="Все группы"
          value={filters.groupId}
          options={props.groups}
          onChange={(groupId) => set({ groupId })}
        />
        {activeFilterCount(filters) > 0 && (
          <Button variant="ghost" size="sm" onClick={() => onFiltersChange(EMPTY_FILTERS)}>
            Сбросить фильтры
          </Button>
        )}
      </div>
    </div>
  )
}

function FilterSelect({
  label,
  all,
  value,
  options,
  onChange,
}: {
  label: string
  all: string
  value: string
  options: Option[]
  onChange: (value: string) => void
}) {
  if (options.length < 2 && value === ALL) return null
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 w-48" aria-label={`Фильтр: ${label}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{all}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

const HOUR_OPTIONS = Array.from({ length: 25 }, (_, h) => h)

function HourSelect({
  value,
  onChange,
  min,
  max,
  id,
}: {
  value: number
  onChange: (h: number) => void
  min: number
  max: number
  id: string
}) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger id={id} className="h-8 w-24">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {HOUR_OPTIONS.filter((h) => h >= min && h <= max).map((h) => (
          <SelectItem key={h} value={String(h)}>
            {formatHm(h * 60)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// Volt's visible / working hours inputs, folded into one popover.
function HoursSettings({
  hours,
  onHoursChange,
  workingHours,
  onWorkingHoursChange,
}: Props) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Настройки календаря">
          <Settings2 />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <CalendarRange className="size-4" /> Видимые часы
          </div>
          <div className="flex items-center gap-2">
            <HourSelect id="visible-from" value={hours.from} min={0} max={hours.to - 1} onChange={(from) => onHoursChange({ ...hours, from })} />
            <span className="text-muted-foreground">—</span>
            <HourSelect id="visible-to" value={hours.to} min={hours.from + 1} max={24} onChange={(to) => onHoursChange({ ...hours, to })} />
          </div>
          <p className="text-xs text-muted-foreground">
            Занятия вне этих часов всё равно видны — сетка расширяется.
          </p>
        </div>
        <div className="space-y-2">
          <Label className="text-sm font-medium">Рабочие часы клуба</Label>
          <div className="flex items-center gap-2">
            <HourSelect id="work-from" value={workingHours.from} min={0} max={workingHours.to - 1} onChange={(from) => onWorkingHoursChange({ ...workingHours, from })} />
            <span className="text-muted-foreground">—</span>
            <HourSelect id="work-to" value={workingHours.to} min={workingHours.from + 1} max={24} onChange={(to) => onWorkingHoursChange({ ...workingHours, to })} />
          </div>
          <p className="text-xs text-muted-foreground">Часы вне рабочих затенены.</p>
        </div>
      </PopoverContent>
    </Popover>
  )
}
