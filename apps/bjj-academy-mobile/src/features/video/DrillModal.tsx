import React from "react"
import { Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native"

import { useTheme, useThemedStyles } from "../../shared/theme-context"
import type { Theme } from "../../shared/theme"
import { type DrillConfig } from "../profile/preferences-store"
import { formatClock, isDrillRunning, useDrill } from "./drill-context"

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

export function DrillModal({ onClose }: { onClose: () => void }) {
  const styles = useThemedStyles(makeStyles)
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
  const styles = useThemedStyles(makeStyles)
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
  const styles = useThemedStyles(makeStyles)
  const theme = useTheme()
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
  const styles = useThemedStyles(makeStyles)
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

const makeStyles = (theme: Theme) => StyleSheet.create({
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
