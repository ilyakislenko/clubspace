'use client';

import { useParams } from 'next/navigation';

import { AiChat } from '../../../../../features/ai-chat/AiChat';

// «ИИ-ассистент» (Аналитика): a chat with the club's data — streaming answers,
// tool progress, links to members, groups and abonements. Admins and
// руководители направлений (the server scopes the data).
export default function AiAssistantPage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params?.workspaceId;
  return (
    <div className="flex h-full flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">ИИ-ассистент</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Вопросы о клубе обычными словами. Ассистент только читает данные в
          пределах ваших прав.
        </p>
      </div>
      {workspaceId && (
        <div className="min-h-0 flex-1">
          <AiChat workspaceId={workspaceId} />
        </div>
      )}
    </div>
  );
}
