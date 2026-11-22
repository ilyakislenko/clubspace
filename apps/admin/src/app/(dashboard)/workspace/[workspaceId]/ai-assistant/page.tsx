'use client';

import { useParams } from 'next/navigation';

import { AiChat } from '../../../../../features/ai-chat/AiChat';
import { useVocabulary } from '../../../../../shared/lib/vocabulary';
import { SectionTabs } from '../../../../../shared/workspace/section-tabs';
import { reportTabs } from '../sections';

// «Отчёты → Спросить ИИ»: a chat with the club's data — streaming answers,
// tool progress, links to members, groups and abonements. Sport leads and
// руководители направлений (the server scopes the data and keeps the money
// tools for club admins).
export default function AiAssistantPage() {
  const params = useParams<{ workspaceId: string }>();
  const vocabulary = useVocabulary();
  const workspaceId = params?.workspaceId;
  return (
    <div className="flex h-full flex-col gap-4">
      <SectionTabs title="Отчёты" tabs={reportTabs(vocabulary)} />
      <p className="text-sm text-muted-foreground">
        Вопросы о клубе обычными словами. Ассистент только читает данные в
        пределах ваших прав.
      </p>
      {workspaceId && (
        <div className="min-h-0 flex-1">
          <AiChat workspaceId={workspaceId} />
        </div>
      )}
    </div>
  );
}
