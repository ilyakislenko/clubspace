// The warning the club owner accepts before a token may return members' names,
// phones and e-mails to an AI assistant. The acceptance is evidence
// (AiDataTransferAcceptance) and counts only for the edition the owner saw:
// bump `version` whenever the text changes.
export const AI_PERSONAL_DATA_WARNING = {
    version: '2026-11-01',
    title: 'Передача персональных данных ИИ-сервису',
    text: [
        'В режиме «с персональными данными» ИИ-ассистент получает имена, телефоны и e-mail участников клуба.',
        'Эти данные уйдут поставщику ИИ-сервиса (например, Anthropic, OpenAI, Cursor) — третьему лицу, серверы которого, как правило, находятся за пределами России. Это трансграничная передача персональных данных.',
        'Клуб как оператор персональных данных отвечает за законность такой передачи: у участников должно быть согласие на неё, а о трансграничной передаче нужно уведомить Роскомнадзор (152-ФЗ, ст. 12).',
        'Если таких оснований нет, используйте режим «обезличено»: ассистент увидит участников только под псевдонимами, без имён и контактов.',
    ].join('\n\n'),
} as const
