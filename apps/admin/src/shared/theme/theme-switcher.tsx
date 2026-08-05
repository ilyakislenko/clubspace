"use client"

import { Check, Monitor, Moon, Palette, Sun } from "lucide-react"

import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@clubspace/ui-kit/ui"
import { THEME_KEYS, THEMES, type ThemeMode } from "@clubspace/ui-kit/util"

import { useTheme } from "./theme-provider"

const MODES: { value: ThemeMode; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Светлая", Icon: Sun },
  { value: "dark", label: "Тёмная", Icon: Moon },
  { value: "auto", label: "Авто", Icon: Monitor },
]

export function ThemeSwitcher() {
  const { themeKey, mode, setThemeKey, setMode } = useTheme()

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Тема оформления">
          <Palette />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-4">
        <div>
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            Тема
          </div>
          <div className="grid grid-cols-3 gap-2">
            {THEME_KEYS.map((key) => {
              const t = THEMES[key]
              const active = key === themeKey
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setThemeKey(key)}
                  className={`flex flex-col items-center gap-1.5 rounded-md border p-2 text-xs transition-colors ${
                    active
                      ? "border-primary ring-1 ring-primary"
                      : "border-border hover:bg-accent"
                  }`}
                >
                  <span
                    className="flex h-6 w-6 items-center justify-center rounded-full"
                    style={{ background: `hsl(${t.light.primary})` }}
                  >
                    {active && <Check className="h-3.5 w-3.5 text-white" />}
                  </span>
                  <span className="text-muted-foreground">{t.name}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            Режим
          </div>
          <div className="grid grid-cols-3 gap-1 rounded-md bg-muted p-1">
            {MODES.map(({ value, label, Icon }) => {
              const active = value === mode
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMode(value)}
                  className={`flex items-center justify-center gap-1 rounded px-2 py-1.5 text-xs transition-colors ${
                    active
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
