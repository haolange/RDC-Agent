import { Textarea } from '../../ui/Textarea';
import { COMPOSER_PROMPT_MAX_HEIGHT, COMPOSER_PROMPT_MIN_HEIGHT } from './composerPromptGeometry';
import { ComposerMarkdownInput, type ComposerMarkdownMode } from './ComposerMarkdownInput';
import { SlashCommandPopover } from './SlashCommandPopover';
import type { useSlashCommand } from './useSlashCommand';
import type { ComposerController } from './useComposer';

type ComposerEditorProps = Pick<ComposerController,
  'promptValue'
  | 'setPromptValue'
  | 'promptInputRef'
  | 'isComposerBusy'
  | 'promptPlaceholder'
  | 'handlePromptSend'
  | 'handleFilesIngest'
  | 'handlePromptKeyDown'> & {
  composerMarkdown: boolean;
  composerScopeKey: string;
  markdownMode: ComposerMarkdownMode;
  slashCommand: ReturnType<typeof useSlashCommand>;
};

export function ComposerEditor({
  promptValue, setPromptValue, promptInputRef, isComposerBusy, promptPlaceholder, handlePromptSend, handleFilesIngest, handlePromptKeyDown,
  composerMarkdown, composerScopeKey, markdownMode, slashCommand,
}: ComposerEditorProps) {
  return (
      <div className="composer-input-row">
        {composerMarkdown ? (
          <ComposerMarkdownInput
            key={composerScopeKey}
            value={promptValue}
            onChange={setPromptValue}
            onSend={() => void handlePromptSend()}
            onPasteFiles={(files) => void handleFilesIngest(files)}
            placeholder={promptPlaceholder}
            mode={markdownMode}
            disabled={isComposerBusy}
          />
        ) : (
          <Textarea
            key={composerScopeKey}
            ref={promptInputRef}
            chrome="plain"
            minHeight={COMPOSER_PROMPT_MIN_HEIGHT}
            maxHeight={COMPOSER_PROMPT_MAX_HEIGHT}
            className="composer-textarea"
            name="debuggerPrompt"
            value={promptValue}
            onChange={(event) => setPromptValue(event.target.value)}
            onKeyDown={handlePromptKeyDown}
            placeholder={promptPlaceholder}
            aria-label={promptPlaceholder}
          />
        )}
        {slashCommand.visible ? (
          <SlashCommandPopover
            filterText={slashCommand.filterText}
            onSelect={slashCommand.onSelect}
            onDismiss={slashCommand.onDismiss}
          />
        ) : null}
      </div>
  );
}
