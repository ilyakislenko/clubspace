const NAMES_SHOWN = 5

// "Иван, Анна, … и ещё 2" for refusals that name the people involved.
export const nameList = (names: string[]): string =>
    names.length > NAMES_SHOWN
        ? `${names.slice(0, NAMES_SHOWN).join(', ')} и ещё ${names.length - NAMES_SHOWN}`
        : names.join(', ')
