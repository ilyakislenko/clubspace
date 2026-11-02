import type { ClubVocabulary } from '../../shared/utils/club-vocabulary'

// The warning the club owner accepts before the admin's «ИИ-ассистент» chat may
// send anything to the AI provider. Kept as AiDataTransferAcceptance evidence
// like the PERSONAL-token warning, under its own edition (the `chat-` prefix
// keeps the two apart in the same table): bump `version` whenever the text
// changes, and the chat waits for the owner again. The text names the coaches
// in the club's own words («тренеры» / «педагоги») — the same meaning in every
// club, so the edition does not depend on them.
export const AI_CHAT_DATA_WARNING = {
    version: 'chat-2026-11-01',
    title: 'Передача данных клуба ИИ-сервису',
} as const

export const aiChatDataWarning = (vocabulary: ClubVocabulary) => ({
    ...AI_CHAT_DATA_WARNING,
    text: [
        'Чат «ИИ-ассистент» отправляет вопросы сотрудников и ответы инструментов ClubSpace (сводки, выручку, расписание, списки учеников) поставщику ИИ-сервиса — третьему лицу, серверы которого, как правило, находятся за пределами России.',
        `Участники и ${vocabulary.coach.nomPl} передаются только под псевдонимами (m_…, c_…): имён, телефонов и e-mail в данных нет. Если сотрудник сам напишет в вопросе телефон или e-mail, ClubSpace скроет их до отправки, а полные имена людей клуба заменит псевдонимами.`,
        'Имена и ссылки на карточки видит только сотрудник в админке — ИИ-сервис их не получает. Каждый вопрос попадает в «Историю изменений».',
        'Включая чат, клуб как оператор персональных данных подтверждает, что такая передача ему подходит (152-ФЗ, ст. 12).',
    ].join('\n\n'),
})
