import { MessageMarkdown } from '../../../../patterns/Markdown/MessageMarkdown';
import { isSafeKnowledgePreviewPath, normalizeKnowledgePreviewPath } from '../knowledgeCardImages';
import { KnowledgeCardImage } from './KnowledgeCardImage';

export function KnowledgeMarkdown({ content, spaceId }: { content: string; spaceId: string }) {
  return (
    <MessageMarkdown
      content={content}
      renderImage={({ src, alt }) => (
        <KnowledgeCardImage
          spaceId={spaceId}
          relativePath={src && isSafeKnowledgePreviewPath(src) ? normalizeKnowledgePreviewPath(src) : (src ?? '')}
          role="illustration"
          alt={alt}
        />
      )}
    />
  );
}
