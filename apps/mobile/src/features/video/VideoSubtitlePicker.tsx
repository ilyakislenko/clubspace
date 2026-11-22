// The subtitle choice «Выкл · Русский · English»: the player's CC popover
// (native) and the rows of the lesson's «⋯» menu (web, where Plyr's own
// controls have no CC button of ours).
import React, { useMemo } from "react"
import type { StyleProp, ViewStyle } from "react-native"

import { MenuOption } from "./MenuOption"
import { PlayerChoicePopover } from "./PlaybackSpeedPicker"
import { subtitleMenuOptions } from "./subtitle-choice"

type SubtitleTrack = { id: string; label: string }

type Props = {
  subtitles: ReadonlyArray<SubtitleTrack>
  activeId: string | null
  onSelect: (id: string | null) => void
}

export function SubtitlePopover({
  subtitles,
  activeId,
  onSelect,
  style,
}: Props & { style?: StyleProp<ViewStyle> }) {
  const choices = useMemo(
    () =>
      subtitleMenuOptions(subtitles).map((o) => ({
        value: o.id,
        label: o.label,
        accessibilityLabel: o.id ? `Субтитры: ${o.label}` : "Субтитры выключены",
      })),
    [subtitles],
  )
  return (
    <PlayerChoicePopover
      choices={choices}
      selected={activeId}
      onSelect={onSelect}
      style={style}
    />
  )
}

export function SubtitleMenuOptions({ subtitles, activeId, onSelect }: Props) {
  return (
    <>
      {subtitleMenuOptions(subtitles).map((o) => (
        <MenuOption
          key={o.id ?? "off"}
          role="radio"
          label={o.id ? `Субтитры: ${o.label}` : "Без субтитров"}
          selected={o.id === activeId}
          onPress={() => onSelect(o.id)}
        />
      ))}
    </>
  )
}
