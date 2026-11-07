// «⋯» on a chapter or bookmark row (side panel and fullscreen drawer): the
// row's tap seeks, everything else lives here. A choice closes the sheet
// first and runs once it's gone (iOS: a rename modal, a confirm or the share
// sheet can't open over a dismissing one); `onClose` fires then too. Rows a
// caller omits aren't shown; delete comes last.
import React from "react"
import { View } from "react-native"

import { Sheet, useSheetAction } from "../../shared/components/Sheet"
import { MenuOption } from "./MenuOption"

export function MomentMenuSheet({
  title,
  onClose,
  onRename,
  onEditNote,
  hasNote = false,
  onAddToPlan,
  onShare,
  onRemove,
}: {
  title: string
  onClose: () => void
  onRename?: () => void
  onEditNote?: () => void
  hasNote?: boolean
  onAddToPlan?: () => void
  onShare: () => void
  onRemove?: () => void
}) {
  const sheet = useSheetAction({ initiallyOpen: true, onClosed: onClose })
  const run = (fn: () => void) => () => sheet.run(fn)
  return (
    <Sheet title={title} {...sheet.sheetProps}>
      <View>
        {onRename && <MenuOption label="Переименовать" onPress={run(onRename)} />}
        {onEditNote && (
          <MenuOption
            label={hasNote ? "Изменить заметку" : "Заметка"}
            onPress={run(onEditNote)}
          />
        )}
        {onAddToPlan && <MenuOption label="В план" onPress={run(onAddToPlan)} />}
        <MenuOption label="Поделиться моментом" onPress={run(onShare)} />
        {onRemove && (
          <MenuOption label="Удалить" destructive onPress={run(onRemove)} />
        )}
      </View>
    </Sheet>
  )
}
