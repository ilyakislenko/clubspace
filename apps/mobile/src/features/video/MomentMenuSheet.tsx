// «⋯» on a chapter or bookmark row (side panel and fullscreen drawer): the
// row's tap seeks, everything else lives here. A choice closes the sheet
// first, then runs. Rows a caller omits aren't shown; delete comes last.
import React from "react"
import { View } from "react-native"

import { Sheet } from "../../shared/components/Sheet"
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
  const run = (fn: () => void) => () => {
    onClose()
    fn()
  }
  return (
    <Sheet title={title} onClose={onClose}>
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
