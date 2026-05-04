import {
  type AudioPlayer,
  setAudioModeAsync,
  useAudioPlayer,
} from "expo-audio"
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  Vibration,
  View,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { theme } from "../../shared/theme"
import {
  DrillConfig,
  getDrillConfig,
  getPreferences,
  setDrillConfig,
  subscribePreferences,
} from "../profile/preferences-store"

type Phase = "idle" | "prep" | "work" | "rest" | "done"

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

const replay = (p: AudioPlayer | null) => {
  if (!p) return
  try {
    void p.seekTo(0)
    p.play()
  } catch {
    /* noop — audio failures shouldn't break the timer */
  }
}

// Drill state and actions live in a context provider so the timer keeps
// running and emitting cues even when the bottom-sheet UI is hidden. The
// view layer (modal, FAB, in-video chip) is a stateless reflection of this
// state — closing or re-opening any of them never disturbs the round.
type DrillContextValue = {
  config: DrillConfig
  phase: Phase
  round: number
  remaining: number
  paused: boolean
  setConfig: (config: DrillConfig) => void
  start: (config?: DrillConfig) => void
  stop: () => void
  togglePause: () => void
  skipRest: () => void
}

const DrillContext = createContext<DrillContextValue | null>(null)

export function useDrill(): DrillContextValue {
  const ctx = useContext(DrillContext)
  if (!ctx) {
    throw new Error("useDrill must be used inside <DrillProvider>")
  }
  return ctx
}

export const isDrillRunning = (phase: Phase): boolean =>
  phase === "prep" || phase === "work" || phase === "rest"

export function DrillProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfigState] = useState<DrillConfig>({
    rounds: 3,
    workSec: 300,
    restSec: 30,
  })
  const [phase, setPhase] = useState<Phase>("idle")
  const [round, setRound] = useState(1)
  const [remaining, setRemaining] = useState(0)
  const [paused, setPaused] = useState(false)

  // Refs follow the live state so the single setInterval doesn't need to be
  // torn down and re-created on every state transition (which would skew
  // timing because setInterval drift compounds with the recreation).
  const phaseRef = useRef<Phase>("idle")
  const roundRef = useRef(1)
  const remainingRef = useRef(0)
  const pausedRef = useRef(false)
  const configRef = useRef(config)

  const startSfx = useAudioPlayer(
    require("../../../assets/sounds/round-start.wav"),
  )
  const endSfx = useAudioPlayer(
    require("../../../assets/sounds/round-end.wav"),
  )
  const tickSfx = useAudioPlayer(require("../../../assets/sounds/tick.wav"))
  const blipSfx = useAudioPlayer(require("../../../assets/sounds/blip.wav"))

  useEffect(() => {
    void getDrillConfig().then(setConfigState)
    // Mix with the video's audio rather than ducking or interrupting it, and
    // honour the iPhone silent switch the way a workout app would: a coach
    // tapping "drill" on a quiet floor still gets the cues.
    void setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: "mixWithOthers",
    }).catch(() => {
      /* setting audio mode is best-effort */
    })
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
      replay(endSfx)
      Vibration.vibrate(200)
      if (roundRef.current >= configRef.current.rounds) {
        setPhase("done")
        return
      }
      setPhase("rest")
      setRemaining(configRef.current.restSec)
      return
    }
    if (next === "rest") {
      replay(startSfx)
      Vibration.vibrate(400)
      setRound((r) => r + 1)
      setPhase("work")
      setRemaining(configRef.current.workSec)
      return
    }
    if (next === "prep") {
      replay(startSfx)
      Vibration.vibrate(400)
      setPhase("work")
      setRemaining(configRef.current.workSec)
      return
    }
  }, [endSfx, startSfx])

  // Single 1Hz tick keeps the timer simple and accurate enough for class use.
  // We avoid wall-clock drift correction since rounds are minutes long and
  // ±1s over a 5-minute round is invisible to a drilling student.
  useEffect(() => {
    if (phase === "idle" || phase === "done") return
    const id = setInterval(() => {
      if (pausedRef.current) return
      const next = remainingRef.current - 1
      // Tick during the last 3 seconds of work/rest, and on every second of
      // the 3-second prep — same countdown cue the gym wall clock gives.
      if (
        next > 0 &&
        (phaseRef.current === "prep" ||
          ((phaseRef.current === "work" || phaseRef.current === "rest") &&
            next <= 3))
      ) {
        replay(tickSfx)
      }
      if (next <= 0) {
        advance()
      } else {
        setRemaining(next)
      }
    }, 1000)
    return () => clearInterval(id)
  }, [phase, advance, tickSfx])

  const setConfig = useCallback((nextConfig: DrillConfig) => {
    setConfigState(nextConfig)
  }, [])

  const start = useCallback(
    (override?: DrillConfig) => {
      const nextConfig = override ?? configRef.current
      if (override) setConfigState(override)
      void setDrillConfig(nextConfig)
      setRound(1)
      setPhase("prep")
      setRemaining(3)
      setPaused(false)
      // Fire a tick for the leading "3" beat — the interval delivers the
      // next tick a second later for "2", then "1", and the round-start cue
      // lands on "GO". Without this the user would see "3" silently.
      replay(tickSfx)
    },
    [tickSfx],
  )

  const stop = useCallback(() => {
    setPhase("idle")
    setRound(1)
    setRemaining(0)
    setPaused(false)
    replay(blipSfx)
  }, [blipSfx])

  const togglePause = useCallback(() => {
    setPaused((p) => !p)
    replay(blipSfx)
  }, [blipSfx])

  const skipRest = useCallback(() => {
    if (phaseRef.current !== "rest") return
    setRemaining(0)
    advance()
  }, [advance])

  const value = useMemo<DrillContextValue>(
    () => ({
      config,
      phase,
      round,
      remaining,
      paused,
      setConfig,
      start,
      stop,
      togglePause,
      skipRest,
    }),
    [
      config,
      phase,
      round,
      remaining,
      paused,
      setConfig,
      start,
      stop,
      togglePause,
      skipRest,
    ],
  )

  return (
    <DrillContext.Provider value={value}>{children}</DrillContext.Provider>
  )
}

// ---- Trigger components --------------------------------------------------

type ButtonProps = {
  style?: object
}

export function DrillModeButton({ style }: ButtonProps) {
  const [open, setOpen] = useState(false)
  const { phase, remaining } = useDrill()
  const running = isDrillRunning(phase)

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={[styles.triggerButton, running && styles.triggerButtonRunning, style]}
      >
        <Text
          style={[
            styles.triggerText,
            running && styles.triggerTextRunning,
          ]}
        >
          {running ? `⏱ ${formatClock(remaining)}` : "⏱ Дрилл"}
        </Text>
      </Pressable>
      {open && <DrillModal onClose={() => setOpen(false)} />}
    </>
  )
}

// Floating action button — keeps the drill timer one tap away from any
// authed screen, not just the video player. When a drill is running it
// expands into a pill showing the live countdown so the user knows it's
// alive even with the modal hidden.
export function DrillModeFab() {
  const [open, setOpen] = useState(false)
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const insets = useSafeAreaInsets()
  const { phase, round, remaining } = useDrill()

  useEffect(() => {
    void getPreferences().then((p) => setEnabled(p.drillFabEnabled))
    return subscribePreferences((p) => setEnabled(p.drillFabEnabled))
  }, [])

  const running = isDrillRunning(phase)
  // While a drill is running, the FAB is also the only way back into the
  // modal — keep it visible even if the user disabled it in settings,
  // otherwise they'd be stuck with a timer they can't pause.
  if (!enabled && !running) return null
  const phaseHint =
    phase === "work" ? `R${round}` : phase === "rest" ? "Отдых" : "…"

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={[
          running ? styles.fabPill : styles.fab,
          {
            bottom: Math.max(insets.bottom, theme.spacing(2)) + theme.spacing(4),
            right: theme.spacing(4),
          },
          phase === "rest" && styles.fabRest,
        ]}
        accessibilityRole="button"
        accessibilityLabel={
          running ? "Дрилл идёт — открыть таймер" : "Открыть дрилл-таймер"
        }
      >
        {running ? (
          <View style={styles.fabPillContent}>
            <Text style={styles.fabPillIcon}>⏱</Text>
            <View>
              <Text style={styles.fabPillHint}>{phaseHint}</Text>
              <Text style={styles.fabPillTime}>{formatClock(remaining)}</Text>
            </View>
          </View>
        ) : (
          <Text style={styles.fabIcon}>⏱</Text>
        )}
      </Pressable>
      {open && <DrillModal onClose={() => setOpen(false)} />}
    </>
  )
}

// ---- Modal --------------------------------------------------------------

function DrillModal({ onClose }: { onClose: () => void }) {
  const drill = useDrill()
  const { phase, config, setConfig, start, stop, togglePause, skipRest } =
    drill
  const running = isDrillRunning(phase)

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <View style={styles.dragHandle} />
          {!running && (
            <ConfigView
              config={config}
              onChange={setConfig}
              onStart={() => start(config)}
              onClose={onClose}
              completedSummary={
                phase === "done"
                  ? `${config.rounds}×${formatClock(config.workSec)} — готово 💪`
                  : null
              }
            />
          )}
          {running && (
            <RunningView
              phase={phase as "prep" | "work" | "rest"}
              round={drill.round}
              totalRounds={config.rounds}
              remaining={drill.remaining}
              paused={drill.paused}
              onTogglePause={togglePause}
              onSkipRest={skipRest}
              onStop={stop}
            />
          )}
        </Pressable>
      </Pressable>
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
          Зацикленный таймер для отработки приёма. Тап мимо шита сворачивает
          его — таймер и звуки идут дальше, кнопка ⏱ внизу остаётся живой.
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
  triggerButtonRunning: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  triggerText: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: "600",
  },
  triggerTextRunning: {
    color: "#fff",
    fontVariant: ["tabular-nums"],
  },
  fab: {
    position: "absolute",
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: theme.colors.accent,
    alignItems: "center",
    justifyContent: "center",
    ...(Platform.OS === "ios"
      ? {
          shadowColor: "#000",
          shadowOpacity: 0.25,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
        }
      : { elevation: 6 }),
  },
  fabIcon: {
    fontSize: 24,
    color: "#fff",
  },
  fabPill: {
    position: "absolute",
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(2),
    borderRadius: 32,
    backgroundColor: theme.colors.accent,
    flexDirection: "row",
    alignItems: "center",
    minWidth: 120,
    ...(Platform.OS === "ios"
      ? {
          shadowColor: "#000",
          shadowOpacity: 0.25,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
        }
      : { elevation: 6 }),
  },
  fabRest: {
    backgroundColor: "#f4a261",
  },
  fabPillContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(2),
  },
  fabPillIcon: {
    fontSize: 22,
    color: "#fff",
  },
  fabPillHint: {
    fontSize: 10,
    color: "rgba(255,255,255,0.75)",
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  fabPillTime: {
    fontSize: 16,
    color: "#fff",
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    lineHeight: 18,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: theme.colors.background,
    paddingHorizontal: theme.spacing(3),
    paddingTop: theme.spacing(2),
    paddingBottom: theme.spacing(4) + (Platform.OS === "ios" ? 16 : 0),
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    gap: theme.spacing(2),
  },
  dragHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.borderStrong,
    marginBottom: theme.spacing(1),
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
