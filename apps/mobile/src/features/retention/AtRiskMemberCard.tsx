import { useNavigation } from "@react-navigation/native"
import React, { useState } from "react"
import { Linking, StyleSheet, Text, View } from "react-native"

import type { AppNavigation } from "../../app/navigation"

import { logAtRiskContact, type AtRiskMember } from "../../shared/api/retention"
import { showAlert } from "../../shared/alert"
import { Card } from "../../shared/Card"
import { Pressable } from "../../shared/components/Pressable"
import { TextInput } from "../../shared/components/TextInput"
import { useToast } from "../../shared/components/Toast"
import { errorMessage } from "../../shared/error-message"
import { formatPhone } from "../../shared/format-ru"
import { telUrl } from "../../shared/link-helpers"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import {
  callContact,
  contactLine,
  REASON_LABEL,
  REASON_TONE,
} from "./retention-helpers"
import { withoutGymEcho } from "../schedule/schedule-helpers"

/** One at-risk member: the facts, a call button and the «Связались» note. */
export function AtRiskMemberCard({
  member,
  workspaceId,
  onContacted,
}: {
  member: AtRiskMember
  workspaceId: string
  onContacted: (userId: string) => void
}) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { showToast } = useToast()
  const [editing, setEditing] = useState(false)
  const [note, setNote] = useState("")
  const [saving, setSaving] = useState(false)
  const navigation = useNavigation<AppNavigation>()

  const name =
    [member.firstname, member.lastname].filter(Boolean).join(" ") ||
    member.email ||
    "Без имени"
  // A child is reached through a parent.
  const contact = callContact(member)
  const tone = REASON_TONE[member.reason]
  const groups = member.groups
    .map((g) =>
      g.gymName
        ? `${withoutGymEcho(g.name, { name: g.gymName })} · ${g.gymName}`
        : g.name,
    )
    .join(", ")

  const call = () => {
    if (!contact.phone) return
    const phone = contact.phone
    Linking.openURL(telUrl(phone)).catch(() =>
      showAlert("Не удалось открыть звонок", formatPhone(phone)),
    )
  }

  const save = async () => {
    if (saving) return
    setSaving(true)
    try {
      await logAtRiskContact({
        workspaceId,
        userId: member.userId,
        note: note.trim() || null,
      })
      onContacted(member.userId)
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
        <Text style={styles.name} numberOfLines={2}>
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
      {contact.guardian && (
        <Text style={styles.guardian}>
          {contact.guardian.label}: {contact.guardian.name}
          {[contact.phone ? formatPhone(contact.phone) : null, contact.email]
            .filter(Boolean)
            .map((part) => ` · ${part}`)
            .join("")}
        </Text>
      )}
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
            disabled={!contact.phone}
            accessibilityRole="button"
            accessibilityLabel={
              contact.guardian
                ? `Позвонить: ${contact.guardian.name}`
                : "Позвонить"
            }
            style={[styles.call, !contact.phone && styles.disabled]}
          >
            <Text style={styles.callText}>
              {contact.guardian ? "Позвонить родителю" : "Позвонить"}
            </Text>
          </Pressable>
          {/* Every listed member is the caller's to call; the contacted ones
              are already marked. Writing counts as «Связались» too. */}
          {!member.snoozed && (
            <>
            <Pressable
              onPress={() => setEditing(true)}
              accessibilityRole="button"
              style={styles.secondary}
            >
              <Text style={styles.secondaryText}>Связались</Text>
            </Pressable>
            <Pressable
              onPress={() =>
                navigation.navigate("ComposeClubMessage", {
                  segment: "MEMBERS",
                  memberIds: [member.userId],
                  audienceLabel: name,
                  logContact: true,
                })
              }
              accessibilityRole="button"
              accessibilityLabel={`Написать сообщение: ${name}`}
              style={styles.secondary}
            >
              <Text style={styles.secondaryText}>Написать</Text>
            </Pressable>
            </>
          )}
        </View>
      )}
      {!contact.phone && !editing && (
        <Text style={styles.caption}>
          {contact.guardian ? "Телефон родителя не указан" : "Телефон не указан"}
        </Text>
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
    guardian: {
      ...theme.typography.caption,
      color: theme.colors.text,
      fontWeight: "600",
    },
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
    // A tonal button: every card carries one, so none of them shouts.
    // Horizontal padding 12: «Позвонить · Связались · Написать» then fit one
    // row on a 375–393 pt iPhone (16 wrapped «Написать» onto a second line).
    call: {
      paddingHorizontal: theme.spacing(3),
      paddingVertical: theme.spacing(2),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.accentSoft,
    },
    callText: {
      color: theme.colors.accent,
      fontSize: 14,
      fontWeight: "600",
    },
    secondary: {
      paddingHorizontal: theme.spacing(3),
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
