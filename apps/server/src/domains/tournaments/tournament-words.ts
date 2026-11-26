import { pluralRu } from '../../shared/utils/plural-ru'

// The discipline's words in tournament copy (pushes, errors), by the org type
// (`Organization.type`, the WorkspaceType values). Grappling fights «схватки»
// on «пояса»; other disciplines have «выступления» on «уровни» — the same
// split as the admin's `levelWord` and `matchFinishLabel`. The mat stays
// «ковёр» everywhere (it is the place, not the sport).

type MatchNoun = {
    // «ваша схватка» / «ваше выступление»
    your: string
    nom: string
    gen: string
    genPl: string
    // «следующая» / «следующее»
    next: string
}

export type TournamentWords = {
    match: MatchNoun
    // «Укажите пояс …» / «Укажите уровень …»
    levelAcc: string
    // «Пояс не найден …» / «Уровень не найден …»
    levelNom: string
}

const GRAPPLING: TournamentWords = {
    match: { your: 'ваша', nom: 'схватка', gen: 'схватки', genPl: 'схваток', next: 'следующая' },
    levelAcc: 'пояс',
    levelNom: 'Пояс',
}

const OTHER: TournamentWords = {
    match: {
        your: 'ваше',
        nom: 'выступление',
        gen: 'выступления',
        genPl: 'выступлений',
        next: 'следующее',
    },
    levelAcc: 'уровень',
    levelNom: 'Уровень',
}

export const tournamentWords = (orgType: string | null | undefined): TournamentWords =>
    (orgType ?? '').toUpperCase() === 'GRAPPLING' ? GRAPPLING : OTHER

// «1 схватка», «3 выступления», «5 схваток».
export const countMatches = (n: number, w: TournamentWords): string =>
    `${n} ${pluralRu(n, w.match.nom, w.match.gen, w.match.genPl)}`

// «1 ковёр», «3 ковра», «5 ковров».
export const countMats = (n: number): string => `${n} ${pluralRu(n, 'ковёр', 'ковра', 'ковров')}`
