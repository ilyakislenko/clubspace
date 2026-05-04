import React, { useCallback, useEffect, useRef, useState } from "react"
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  Vibration,
  View,
} from "react-native"

import { theme } from "../../shared/theme"
import {
  DrillConfig,
  getDrillConfig,
  setDrillConfig,
} from "../profile/preferences-store"

type Phase = "idle" | "prep" | "work" | "rest" | "done"

type DrillPlayerControl = {
  play: () => void
  pause: () => void
}

type Preset = {
  label: string
  config: DrillConfig
}

// Battle-tested grappling round formats. Order is "softer → harder" so the
// first preset matches a typical first-time drill round.
const PRESETS: Preset[] = [
  { label: "3×5 / 30s", config: { rounds: 3, workSec: 300, restSec: 30 } },
  { label: "5×5 / 30s", config: { rounds: 5, workSec: 300, restSec: 30 } },
  { label: "6×3 / 15s", config: { rounds: 6, workSec: 180, restSec: 15 } },
  { label: "10×1 / 10s", config: { rounds: 10, workSec: 60, restSec: 10 } },
]

const formatClock = (sec: number): string => {
  const safe = Math.max(0, Math.ceil(sec))
  const m = Math.floor(safe / 60)
  const s = safe % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

// Vibration patterns. iOS ignores arrays beyond the first value, so we keep
// each cue short and call vibrate() in sequence rather than relying on long
// patterns that wouldn't play on iPhone.
const cueRoundStart = () => Vibration.vibrate(600)
const cueRoundEnd = () => {
  Vibration.vibrate(200)
  setTimeout(() => Vibration.vibrate(200), 300)
  setTimeout(() => Vibration.vibrate(200), 600)
}
const cueLastSecond = () => Vibration.vibrate(80)

type Props = {
  player: DrillPlayerControl | null
  style?: object
}

export function DrillModeButton({ player, style }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={[styles.triggerButton, style]}
      >
        <Text style={styles.triggerText}>⏱ Дрилл</Text>
      </Pressable>
      {open && (
        <DrillModal player={player} onClose={() => setOpen(false)} />
      )}
    </>
  )
}

function DrillModal({
  player,
  onClose,
}: {
  player: DrillPlayerControl | null
  onClose: () => void
}) {
  const [config, setConfig] = useState<DrillConfig>({
    rounds: 3,
    workSec: 300,
    restSec: 30,
  })
  const [phase, setPhase] = useState<Phase>("idle")
  const [round, setRound] = useState(1)
  const [remaining, setRemaining] = useState(0)
  const [paused, setPaused] = useState(false)

  // Refs follow the live phase/round so the single setInterval doesn't need to
  // be torn down and re-created on every state transition (which would skew
  // timing because setInterval drift compounds with the recreation).
  const phaseRef = useRef<Phase>("idle")
  const roundRef = useRef(1)
  const remainingRef = useRef(0)
  const pausedRef = useRef(false)
  const configRef = useRef(config)

  useEffect(() => {
    void getDrillConfig().then(setConfig)
  }, [])

  useEffect(() => {
    configRef.current = config
  }, [config])
  useEffect(() => {
    phaseRef.current = phase
  }, [phase])
  useEffect(() => {
    roundRef.current = round
  }, [round])
  useEffect(() => {
    remainingRef.current = remaining
  }, [remaining])
  useEffect(() => {
    pausedRef.current = paused
  }, [paused])

  const advance = useCallback(() => {
    const next = phaseRef.current
    if (next === "work") {
      // End of work — go to rest, or finish if it was the last round.
      cueRoundEnd()
      if (roundRef.current >= configRef.current.rounds) {
        player?.pause()
        setPhase("done")
        return
      }
      player?.pause()
      setPhase("rest")
      setRemaining(configRef.current.restSec)
      return
    }
    if (next === "rest") {
      cueRoundStart()
      setRound((r) => r + 1)
      setPhase("work")
      setRemaining(configRef.current.workSec)
      player?.play()
      return
    }
    if (next === "prep") {
      cueRoundStart()
      setPhase("work")
      setRemaining(configRef.current.workSec)
      player?.play()
      return
    }
  }, [player])

  // Single 1Hz tick keeps the timer simple and accurate enough for class use.
  // We avoid wall-clock drift correction since rounds are minutes long and
  // ±1s over a 5-minute round is invisible to a drilling student.
  useEffect(() => {
    if (phase === "idle" || phase === "done") return
    const id = setInterval(() => {
      if (pausedRef.current) return
      const next = remainingRef.current - 1
      if (next <= 3 && next > 0 && phaseRef.current === "work") {
        cueLastSecond()
      }
      if (next <= 0) {
        advance()
      } else {
        setRemaining(next)
      }
    }, 1000)
    return () => clearInterval(id)
  }, [phase, advance])

  // Stop the video when the modal goes away mid-drill (Android back button,
  // explicit close while a round was running). If the user only opened the
  // sheet to look at the config and closed it, the player should keep
  // playing — so we check the phase before pausing.
  useEffect(() => {
    return () => {
      const lastPhase = phaseRef.current
      if (lastPhase === "work" || lastPhase === "rest" || lastPhase === "prep") {
        player?.pause()
      }
    }
  }, [player])

  const start = useCallback(() => {
    void setDrillConfig(config)
    setRound(1)
    setPhase("prep")
    setRemaining(3)
    setPaused(false)
  }, [config])

  const stop = useCallback(() => {
    player?.pause()
    setPhase("idle")
    setRound(1)
    setRemaining(0)
    setPaused(false)
  }, [player])

  const togglePause = useCallback(() => {
    setPaused((p) => {
      const next = !p
      if (next) {
        player?.pause()
      } else if (phaseRef.current === "work") {
        player?.play()
      }
      return next
    })
  }, [player])

  const skipRest = useCallback(() => {
    if (phaseRef.current !== "rest") return
    setRemaining(0)
    advance()
  }, [advance])

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          {(phase === "idle" || phase === "done") && (
            <ConfigView
              config={config}
              onChange={setConfig}
              onStart={start}
              onClose={onClose}
              completedSummary={
                phase === "done"
                  ? `${configRef.current.rounds}×${formatClock(configRef.current.workSec)} — готово 💪`
                  : null
              }
            />
          )}
          {(phase === "prep" || phase === "work" || phase === "rest") && (
            <RunningView
              phase={phase}
              round={round}
              totalRounds={config.rounds}
              remaining={remaining}
              paused={paused}
              onTogglePause={togglePause}
              onSkipRest={skipRest}
              onStop={stop}
            />
          )}
        </View>
      </View>
    </Modal>
  )
}

function ConfigView({
  config,
  onChange,
  onStart,
  onClose,
  completedSummary,
}: {
  config: DrillConfig
  onChange: (c: DrillConfig) => void
  onStart: () => void
  onClose: () => void
  completedSummary: string | null
}) {
  return (
    <View>
      <Text style={styles.title}>
        {completedSummary ? "Готово" : "Дрилл-таймер"}
      </Text>
      {completedSummary ? (
        <Text style={styles.summary}>{completedSummary}</Text>
      ) : (
        <Text style={styles.subtitle}>
          Зацикленный таймер для отработки приёма. Видео ставится на паузу
          между раундами.
        </Text>
      )}

      <View style={styles.presetsRow}>
        {PRESETS.map((p) => {
          const active =
            p.config.rounds === config.rounds &&
            p.config.workSec === config.workSec &&
            p.config.restSec === config.restSec
          return (
            <Pressable
              key={p.label}
              onPress={() => onChange(p.config)}
              style={[styles.presetChip, active && styles.presetChipActive]}
            >
              <Text
                style={[
                  styles.presetChipText,
                  active && styles.presetChipTextActive,
                ]}
              >
                {p.label}
              </Text>
            </Pressable>
          )
        })}
      </View>

      <Stepper
        label="Раунды"
        value={config.rounds}
        format={(v) => String(v)}
        min={1}
        max={20}
        step={1}
        onChange={(rounds) => onChange({ ...config, rounds })}
      />
      <Stepper
        label="Раунд"
        value={config.workSec}
        format={(v) => formatClock(v)}
        min={30}
        max={20 * 60}
        step={30}
        onChange={(workSec) => onChange({ ...config, workSec })}
      />
      <Stepper
        label="Отдых"
        value={config.restSec}
        format={(v) => formatClock(v)}
        min={5}
        max={5 * 60}
        step={5}
        onChange={(restSec) => onChange({ ...config, restSec })}
      />

      <View style={styles.footer}>
        <Pressable onPress={onClose} style={styles.footerSecondary}>
          <Text style={styles.footerSecondaryText}>Закрыть</Text>
        </Pressable>
        <Pressable onPress={onStart} style={styles.footerPrimary}>
          <Text style={styles.footerPrimaryText}>
            {completedSummary ? "Ещё раз" : "Старт"}
          </Text>
        </Pressable>
      </View>
    </View>
  )
}

function RunningView({
  phase,
  round,
  totalRounds,
  remaining,
  paused,
  onTogglePause,
  onSkipRest,
  onStop,
}: {
  phase: "prep" | "work" | "rest"
  round: number
  totalRounds: number
  remaining: number
  paused: boolean
  onTogglePause: () => void
  onSkipRest: () => void
  onStop: () => void
}) {
  const phaseColor =
    phase === "work"
      ? theme.colors.accent
      : phase === "rest"
        ? "#f4a261"
        : theme.colors.muted
  const phaseLabel =
    phase === "work" ? "РАУНД" : phase === "rest" ? "ОТДЫХ" : "ГОТОВЬСЯ"

  return (
    <View style={styles.runningRoot}>
      <Text style={[styles.runningPhase, { color: phaseColor }]}>
        {phaseLabel}
      </Text>
      <Text style={styles.runningClock}>{formatClock(remaining)}</Text>
      <Text style={styles.runningRound}>
        {phase === "prep"
          ? `Через ${remaining}…`
          : `${round} из ${totalRounds}`}
      </Text>

      <View style={styles.runningActions}>
        <Pressable onPress={onStop} style={styles.runningSecondary}>
          <Text style={styles.runningSecondaryText}>Стоп</Text>
        </Pressable>
        {phase === "rest" && (
          <Pressable onPress={onSkipRest} style={styles.runningSecondary}>
            <Text style={styles.runningSecondaryText}>Пропустить</Text>
          </Pressable>
        )}
        <Pressable onPress={onTogglePause} style={styles.runningPrimary}>
          <Text style={styles.runningPrimaryText}>
            {paused ? "Продолжить" : "Пауза"}
          </Text>
        </Pressable>
      </View>
    </View>
  )
}

function Stepper({
  label,
  value,
  format,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  value: number
  format: (v: number) => string
  min: number
  max: number
  step: number
  onChange: (v: number) => void
}) {
  const dec = () => onChange(Math.max(min, value - step))
  const inc = () => onChange(Math.min(max, value + step))
  return (
    <View style={styles.stepperRow}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <View style={styles.stepperControls}>
        <Pressable onPress={dec} style={styles.stepperButton}>
          <Text style={styles.stepperButtonText}>−</Text>
        </Pressable>
        <Text style={styles.stepperValue}>{format(value)}</Text>
        <Pressable onPress={inc} style={styles.stepperButton}>
          <Text style={styles.stepperButtonText}>+</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  triggerButton: {
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(2),
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  triggerText: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: "600",
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: theme.colors.background,
    paddingHorizontal: theme.spacing(3),
    paddingTop: theme.spacing(3),
    paddingBottom: theme.spacing(4) + (Platform.OS === "ios" ? 16 : 0),
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    gap: theme.spacing(2),
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: theme.colors.text,
  },
  subtitle: {
    fontSize: 13,
    color: theme.colors.muted,
    lineHeight: 18,
  },
  summary: {
    fontSize: 14,
    color: theme.colors.text,
  },
  presetsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing(1),
    marginVertical: theme.spacing(1),
  },
  presetChip: {
    paddingHorizontal: theme.spacing(2),
    paddingVertical: theme.spacing(1),
    borderRadius: 999,
    backgroundColor: theme.colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  presetChipActive: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  presetChipText: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: "500",
  },
  presetChipTextActive: {
    color: "#fff",
  },
  stepperRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: theme.spacing(1),
  },
  stepperLabel: {
    color: theme.colors.text,
    fontSize: 15,
  },
  stepperControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(2),
  },
  stepperButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperButtonText: {
    color: theme.colors.text,
    fontSize: 20,
    lineHeight: 22,
  },
  stepperValue: {
    color: theme.colors.text,
    fontSize: 16,
    fontVariant: ["tabular-nums"],
    minWidth: 56,
    textAlign: "center",
  },
  footer: {
    flexDirection: "row",
    gap: theme.spacing(2),
    marginTop: theme.spacing(2),
  },
  footerSecondary: {
    flex: 1,
    paddingVertical: theme.spacing(2),
    borderRadius: 12,
    backgroundColor: theme.colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    alignItems: "center",
  },
  footerSecondaryText: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: "500",
  },
  footerPrimary: {
    flex: 1,
    paddingVertical: theme.spacing(2),
    borderRadius: 12,
    backgroundColor: theme.colors.accent,
    alignItems: "center",
  },
  footerPrimaryText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  runningRoot: {
    alignItems: "center",
    gap: theme.spacing(1),
    paddingVertical: theme.spacing(2),
  },
  runningPhase: {
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 2,
  },
  runningClock: {
    fontSize: 88,
    fontWeight: "200",
    color: theme.colors.text,
    fontVariant: ["tabular-nums"],
    lineHeight: 96,
  },
  runningRound: {
    fontSize: 15,
    color: theme.colors.muted,
  },
  runningActions: {
    flexDirection: "row",
    gap: theme.spacing(2),
    marginTop: theme.spacing(3),
    width: "100%",
  },
  runningSecondary: {
    flex: 1,
    paddingVertical: theme.spacing(2),
    borderRadius: 12,
    backgroundColor: theme.colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    alignItems: "center",
  },
  runningSecondaryText: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: "500",
  },
  runningPrimary: {
    flex: 1,
    paddingVertical: theme.spacing(2),
    borderRadius: 12,
    backgroundColor: theme.colors.accent,
    alignItems: "center",
  },
  runningPrimaryText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
})
