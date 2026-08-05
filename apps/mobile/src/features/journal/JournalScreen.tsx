import React, { useCallback, useEffect, useState } from "react"
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { showAlert } from "../../shared/alert"
import { Pressable } from "../../shared/components/Pressable"
import { TextInput } from "../../shared/components/TextInput"
import { SafeAreaView } from "react-native-safe-area-context"
import { CenteredColumn } from "../../shared/components/CenteredColumn"

import {
  createJournalEntry,
  deleteJournalEntry,
  getMyJournal,
  type JournalEntry,
} from "../../shared/api/journal"
import { useAuth } from "../../shared/auth-context"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { errorMessage } from "../../shared/error-message"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"

const fmtDate = (ymd: string): string =>
  new Date(`${ymd}T00:00:00Z`).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })

export function JournalScreen() {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { workspace } = useAuth()

  const [entries, setEntries] = useState<JournalEntry[] | null>(null)
  const [body, setBody] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!workspace) return
    setError(null)
    try {
      const res = await getMyJournal({ workspaceId: workspace.workspaceId })
      setEntries(res.entries)
    } catch (err) {
      setError(errorMessage(err, "Не удалось загрузить дневник"))
    }
  }, [workspace])

  useEffect(() => {
    void load()
  }, [load])

  const add = async () => {
    if (!workspace || saving) return
    const text = body.trim()
    if (!text) return
    setSaving(true)
    setError(null)
    try {
      const entry = await createJournalEntry({
        workspaceId: workspace.workspaceId,
        body: text,
      })
      setEntries((prev) => [entry, ...(prev ?? [])])
      setBody("")
    } catch (err) {
      setError(errorMessage(err, "Не удалось сохранить запись"))
    } finally {
      setSaving(false)
    }
  }

  const remove = (entry: JournalEntry) => {
    if (!workspace) return
    showAlert("Удалить запись?", undefined, [
      { text: "Отмена", style: "cancel" },
      {
        text: "Удалить",
        style: "destructive",
        onPress: () => {
          void (async () => {
            const prev = entries
            // Optimistic removal.
            setEntries((list) => (list ?? []).filter((e) => e.id !== entry.id))
            try {
              await deleteJournalEntry({
                workspaceId: workspace.workspaceId,
                entryId: entry.id,
              })
            } catch (err) {
              setEntries(prev)
              setError(errorMessage(err, "Не удалось удалить запись"))
            }
          })()
        },
      },
    ])
  }

  if (!workspace) return null

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <CenteredColumn>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.title}>Дневник тренировок</Text>
        <Text style={styles.subtitle}>
          Личные заметки после занятий — видны только вам.
        </Text>

        <View style={styles.composer}>
          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder="Что отработали, что получилось, над чем поработать…"
            placeholderTextColor={theme.colors.muted}
            multiline
            maxLength={5000}
            style={styles.input}
          />
          <Pressable
            style={({ pressed }) => [
              styles.addBtn,
              (pressed || saving || !body.trim()) && styles.addBtnDim,
            ]}
            onPress={() => void add()}
            disabled={saving || !body.trim()}
          >
            <Text style={styles.addBtnText}>
              {saving ? "Сохраняем…" : "Добавить запись"}
            </Text>
          </Pressable>
        </View>

        {error && <ErrorRetry message={error} onRetry={() => void load()} />}

        {!entries && !error ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.colors.accent} />
          </View>
        ) : entries && entries.length === 0 ? (
          <Text style={styles.empty}>
            Пока пусто. Добавьте первую запись после тренировки.
          </Text>
        ) : (
          <View style={styles.rows}>
            {entries?.map((entry) => (
              <View key={entry.id} style={styles.card}>
                <View style={styles.cardHead}>
                  <Text style={styles.cardDate}>{fmtDate(entry.entryDate)}</Text>
                  <Pressable
                    onPress={() => remove(entry)}
                    hitSlop={8}
                    accessibilityLabel="Удалить запись"
                  >
                    <Text style={styles.delete}>✕</Text>
                  </Pressable>
                </View>
                <Text style={styles.cardBody}>{entry.body}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
      </CenteredColumn>
    </SafeAreaView>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    body: { padding: theme.spacing(5), gap: theme.spacing(3) },
    center: { paddingVertical: theme.spacing(6), alignItems: "center" },
    title: { ...theme.typography.title, fontSize: 22, color: theme.colors.text },
    subtitle: {
      ...theme.typography.body,
      color: theme.colors.muted,
      marginTop: -theme.spacing(1),
    },
    composer: {
      padding: theme.spacing(4),
      borderRadius: theme.radius.lg,
      backgroundColor: theme.colors.surfaceElevated,
      borderWidth: 1,
      borderColor: theme.colors.border,
      gap: theme.spacing(3),
    },
    input: {
      minHeight: 72,
      color: theme.colors.text,
      fontSize: 15,
      textAlignVertical: "top",
      padding: 0,
    },
    addBtn: {
      alignSelf: "flex-start",
      paddingHorizontal: theme.spacing(4),
      paddingVertical: theme.spacing(2),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.accent,
    },
    addBtnDim: { opacity: 0.5 },
    addBtnText: {
      color: theme.colors.accentText,
      fontWeight: "700",
      fontSize: 14,
    },
    empty: { color: theme.colors.muted, fontSize: 14, lineHeight: 20 },
    rows: { gap: theme.spacing(3) },
    card: {
      padding: theme.spacing(4),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
      gap: theme.spacing(2),
    },
    cardHead: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    cardDate: { ...theme.typography.label, color: theme.colors.muted },
    delete: { color: theme.colors.muted, fontSize: 16, fontWeight: "700" },
    cardBody: {
      color: theme.colors.text,
      fontSize: 15,
      lineHeight: 21,
    },
  })
