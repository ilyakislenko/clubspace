import { useNavigation } from "@react-navigation/native"
import React from "react"
import { Modal, ScrollView, StyleSheet, Text } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import type { AppNavigation } from "../../app/navigation"
import { useAuth } from "../../shared/auth-context"
import { Pressable } from "../../shared/components/Pressable"
import { haptics } from "../../shared/haptics"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { useResponsive } from "../../shared/useResponsive"
import { AddClubRow, ClubRow } from "./ClubRow"
import { sortClubs } from "./club-switcher-helpers"

/**
 * Every club the member is in, opened from the club name in a tab header. A
 * tap switches the active club; the last row joins another one by code. A
 * bottom sheet on phones, a centered card on larger windows.
 */
export function ClubSwitcherSheet({ onClose }: { onClose: () => void }) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const insets = useSafeAreaInsets()
  const { sizeClass, height } = useResponsive()
  const navigation = useNavigation<AppNavigation>()
  const { workspace, workspaces, switchWorkspace, actingAs } = useAuth()
  const compact = sizeClass === "compact"

  const pick = (workspaceId: string) => {
    if (workspaceId !== workspace?.workspaceId) {
      haptics.selection()
      switchWorkspace(workspaceId)
    }
    onClose()
  }

  const addClub = () => {
    onClose()
    navigation.navigate("JoinClub")
  }

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable
        style={[
          styles.backdrop,
          compact ? styles.backdropBottom : styles.backdropCenter,
        ]}
        onPress={onClose}
        // Structural, not a control: it only catches taps outside the sheet.
        accessibilityRole="none"
      >
        <Pressable
          style={[
            styles.sheet,
            compact ? styles.sheetBottom : styles.sheetCenter,
            {
              maxHeight: height * 0.85,
              // Android draws edge-to-edge: keep the last row above the
              // system navigation bar.
              paddingBottom: theme.spacing(4) + (compact ? insets.bottom : 0),
            },
          ]}
          accessibilityRole="none"
          onPress={() => {
            /* swallow, so a tap inside the sheet doesn't dismiss it */
          }}
        >
          <Text style={styles.title} accessibilityRole="header">
            Мои клубы
          </Text>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
          >
            {sortClubs(workspaces).map((w) => (
              <ClubRow
                key={w.workspaceId}
                club={w}
                current={w.workspaceId === workspace?.workspaceId}
                onPress={() => pick(w.workspaceId)}
              />
            ))}
            <AddClubRow onPress={addClub} forChild={!!actingAs} />
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: theme.colors.overlay },
    backdropBottom: { justifyContent: "flex-end" },
    backdropCenter: {
      justifyContent: "center",
      alignItems: "center",
      padding: theme.spacing(5),
    },
    sheet: {
      width: "100%",
      backgroundColor: theme.colors.surfaceElevated,
      paddingTop: theme.spacing(5),
      gap: theme.spacing(2),
      ...theme.shadows.sm,
    },
    sheetBottom: {
      borderTopLeftRadius: theme.radius.lg,
      borderTopRightRadius: theme.radius.lg,
    },
    sheetCenter: { maxWidth: 460, borderRadius: theme.radius.lg },
    title: {
      fontSize: 20,
      fontWeight: "700",
      color: theme.colors.text,
      paddingHorizontal: theme.spacing(5),
    },
    scroll: { flexGrow: 0 },
    list: { paddingBottom: theme.spacing(1) },
  })
