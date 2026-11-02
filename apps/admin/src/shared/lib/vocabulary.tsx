"use client"

import { createContext, useContext } from "react"

import {
  type ClubVocabulary,
  vocabularyForWorkspaceType,
} from "@clubspace/ui-kit/brand"

// The words of the club open in the admin («тренировка/тренер» or
// «занятие/педагог»), set by the club layout from its settings. Outside a
// club, and until the settings load, the base words apply.
const VocabularyContext = createContext<ClubVocabulary>(
  vocabularyForWorkspaceType(null),
)

export const VocabularyProvider = VocabularyContext.Provider

export const useVocabulary = (): ClubVocabulary => useContext(VocabularyContext)
