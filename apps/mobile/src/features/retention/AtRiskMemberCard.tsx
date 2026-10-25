import React, { useState } from "react"
import { Linking, StyleSheet, Text, View } from "react-native"

import {
  logAtRiskContact,
  type AtRiskContact,
  type AtRiskMember,
} from "../../shared/api/retention"
import { showAlert } from "../../shared/alert"
import { Card } from "../../shared/Card"
import { Pressable } from "../../shared/components/Pressable"
import { TextInput } from "../../shared/components/TextInput"
import { useToast } from "../../shared/components/Toast"
import { errorMessage } from "../../shared/error-message"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import {
  contactLine,
  REASON_LABEL,
  REASON_TONE,
  telUrl,
} from "./retention-helpers"

/** One at-risk member: the facts, a call button and the «Связались» note. */
export function AtRiskMemberCard({
  member,
  workspaceId,
  onContacted,
}: {
  member: AtRiskMember
  workspaceId: string
  onContacted: (userId: string, contact: AtRiskContact) => void
}) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { showToast } = useToast()
  const [editing, setEditing] = useState(false)
  const [note, setNote] = useState("")
  const [saving, setSaving] = useState(false)

  const name =
    [member.firstname, member.lastname].filter(Boolean).join(" ") ||
    member.email
  const tone = REASON_TONE[member.reason]
  const groups = member.groups
    .map((g) => (g.gymName ? `${g.name} · ${g.gymName}` : g.name))
    .join(", ")

  const call = () => {
    if (!member.phone) return
    const phone = member.phone
    Linking.openURL(telUrl(phone)).catch(() =>
      showAlert("Не удалось открыть звонок", phone),
    )
  }

  const save = async () => {
    if (saving) return
    setSaving(true)
    try {
      const contact = await logAtRiskContact({
        workspaceId,
        userId: member.userId,
        note: note.trim() || null,
      })
      onContacted(member.userId, contact)
      setEditing(false)
      setNote("")
      showToast("Отмечено — скроем на 2 недели", "success")
    } catch (err) {
      showToast(errorMessage(err, "Не удалось сохранить отметку"), "error")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <View style={[styles.chip, { backgroundColor: theme.colors[tone.bg] }]}>
          <Text style={[styles.chipText, { color: theme.colors[tone.fg] }]}>
            {REASON_LABEL[member.reason]}
          </Text>
        </View>
      </View>
      <Text style={styles.facts}>{member.factsText}</Text>
      {groups !== "" && <Text style={styles.caption}>{groups}</Text>}
      {member.lastContact && (
        <Text style={styles.caption}>
          {contactLine(member.lastContact, new Date())}
        </Text>
      )}

      {editing ? (
        <View style={styles.editor}>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Заметка (необязательно): о чём договорились"
            placeholderTextColor={theme.colors.muted}
            multiline
            maxLength={500}
            style={styles.input}
          />
          <View style={styles.row}>
            <Pressable
              onPress={() => void save()}
              disabled={saving}
              accessibilityRole="button"
              style={[styles.primary, saving && styles.disabled]}
            >
              <Text style={styles.primaryText}>
                {saving ? "Сохраняю…" : "Сохранить"}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setEditing(false)}
              disabled={saving}
              accessibilityRole="button"
              style={styles.secondary}
            >
              <Text style={styles.secondaryText}>Отмена</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.row}>
          <Pressable
            onPress={call}
            disabled={!member.phone}
            accessibilityRole="button"
            style={[styles.primary, !member.phone && styles.disabled]}
          >
            <Text style={styles.primaryText}>Позвонить</Text>
          </Pressable>
          {member.canContact && (
            <Pressable
              onPress={() => setEditing(true)}
              accessibilityRole="button"
              style={styles.secondary}
            >
              <Text style={styles.secondaryText}>Связались</Text>
            </Pressable>
          )}
        </View>
      )}
      {!member.phone && !editing && (
        <Text style={styles.caption}>Телефон не указан</Text>
      )}
    </Card>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    card: { padding: theme.spacing(4), gap: theme.spacing(2) },
    head: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing(2),
    },
    name: { ...theme.typography.bodyStrong, color: theme.colors.text, flex: 1 },
    chip: {
      paddingHorizontal: theme.spacing(2),
      paddingVertical: 2,
      borderRadius: theme.radius.full,
    },
    chipText: { fontSize: 12, fontWeight: "600" },
    facts: { ...theme.typography.body, color: theme.colors.text },
    caption: { ...theme.typography.caption, color: theme.colors.muted },
    row: { flexDirection: "row", gap: theme.spacing(2), flexWrap: "wrap" },
    editor: { gap: theme.spacing(2) },
    input: {
      minHeight: 64,
      maxHeight: 160,
      color: theme.colors.text,
      fontSize: 15,
      textAlignVertical: "top",
      padding: theme.spacing(3),
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surfaceMuted,
    },
    primary: {
      paddingHorizontal: theme.spacing(4),
      paddingVertical: theme.spacing(2),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.accent,
    },
    primaryText: {
      color: theme.colors.accentText,
      fontSize: 14,
      fontWeight: "600",
    },
    secondary: {
      paddingHorizontal: theme.spacing(4),
      paddingVertical: theme.spacing(2),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surfaceMuted,
    },
    secondaryText: {
      color: theme.colors.text,
      fontSize: 14,
      fontWeight: "600",
    },
    disabled: { opacity: 0.5 },
  })
