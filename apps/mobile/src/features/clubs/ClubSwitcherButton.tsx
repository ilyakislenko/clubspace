import React, { useState } from "react"
import { StyleSheet, Text, View } from "react-native"

import { useAuth } from "../../shared/auth-context"
import { brand } from "../../shared/brand"
import { Icon } from "../../shared/components/Icon"
import { Pressable } from "../../shared/components/Pressable"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { ClubSwitcherSheet } from "./ClubSwitcherSheet"
import { unreadElsewhere } from "./club-switcher-helpers"

/**
 * The current club's name with a «▾», opening the club switcher. `eyebrow` is
 * the small label above Home's greeting; `header` is a tab header's title — the
 * screen title with the club underneath. Shown for a single club too: the
 * sheet is also where another club is added.
 */
export function ClubSwitcherButton({
  variant,
  title,
}: {
  variant: "eyebrow" | "header"
  /** The screen title above the club name (header variant). */
  title?: string
}) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { workspace, workspaces } = useAuth()
  const [open, setOpen] = useState(false)
  const name = workspace?.name ?? brand.displayName
  // A dot, not a number: the bell already counts this club's inbox.
  const elsewhere = unreadElsewhere(workspaces, workspace?.workspaceId) > 0
  const header = variant === "header"

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${title ? `${title}, ` : ""}клуб ${name}${
          elsewhere ? ", есть непрочитанное в других клубах" : ""
        }`}
        accessibilityHint="Сменить клуб"
        hitSlop={8}
        style={header ? styles.headerRoot : styles.eyebrowRoot}
      >
        {header && title && (
          <Text style={styles.headerTitle} numberOfLines={1}>
            {title}
          </Text>
        )}
        <View style={styles.nameRow}>
          <Text
            style={header ? styles.headerClub : styles.eyebrow}
            numberOfLines={1}
          >
            {name}
          </Text>
          <Icon
            name="chevron-down"
            size={header ? 14 : 16}
            color={header ? theme.colors.muted : theme.colors.accent}
          />
          {elsewhere && <View style={styles.dot} />}
        </View>
      </Pressable>
      {open && <ClubSwitcherSheet onClose={() => setOpen(false)} />}
    </>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    eyebrowRoot: { alignSelf: "flex-start", marginBottom: 4, maxWidth: "100%" },
    headerRoot: { maxWidth: 260 },
    nameRow: { flexDirection: "row", alignItems: "center", gap: 4 },
    eyebrow: { ...theme.typography.label, flexShrink: 1 },
    headerTitle: { fontSize: 17, fontWeight: "600", color: theme.colors.text },
    headerClub: { fontSize: 12, color: theme.colors.muted, flexShrink: 1 },
    dot: {
      width: 8,
      height: 8,
      borderRadius: theme.radius.full,
      backgroundColor: theme.colors.accent,
    },
  })
