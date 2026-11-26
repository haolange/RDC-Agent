import { Textarea } from '../../ui/Textarea';
import { COMPOSER_PROMPT_MAX_HEIGHT, COMPOSER_PROMPT_MIN_HEIGHT } from './composerPromptGeometry';
import { ComposerMarkdownInput } from './ComposerMarkdownInput';
import { SlashCommandPopover } from './SlashCommandPopover';
import { useComposerView } from './ComposerControllerContext';

export function ComposerEditor() {
  const {
    composer,
    scopeKey: composerScopeKey,
    markdown: composerMarkdown,
    markdownMode,
    slashCommand,
  } = useComposerView();
  const {
    promptValue,
    setPromptValue,
    promptInputRef,
    isComposerBusy,
    promptPlaceholder,
    handlePromptSend,
    handleFilesIngest,
    handlePromptKeyDown,
  } = composer;
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
