import { useState, type ComponentProps, type RefObject } from 'react';
import { Textarea } from '../../ui/Textarea';
import { COMPOSER_PROMPT_MAX_HEIGHT, COMPOSER_PROMPT_MIN_HEIGHT } from './composerPromptGeometry';
import { useComposerMarkdownInput } from './composerMarkdownLoader';
import { SlashCommandPopover } from './SlashCommandPopover';
import { useComposerView } from './ComposerControllerContext';
import type { ComposerMarkdownInput } from './ComposerMarkdownInput';

type MarkdownEditor = typeof ComposerMarkdownInput;

/** The loaded editor takes over from the plain field; a field that had focus hands it over with the caret at the end. */
function MarkdownEditorTakeover({
  Editor,
  plainField,
  ...props
}: Omit<ComponentProps<MarkdownEditor>, 'focusOnCreate'> & {
  Editor: MarkdownEditor;
  plainField: RefObject<HTMLTextAreaElement>;
}) {
  // Read while the plain field is still mounted: this render is the one that replaces it.
  const [focused] = useState(() => plainField.current !== null && document.activeElement === plainField.current);
  return <Editor {...props} focusOnCreate={focused} />;
}

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
  // The Markdown editor loads on demand. Until it arrives the plain field stands in with identical metrics and the
  // same draft, so typing is never lost and nothing moves when the editor takes over.
  const MarkdownInput = useComposerMarkdownInput(composerMarkdown);
  return (
    <div className="composer-input-row">
      {composerMarkdown && MarkdownInput ? (
        <MarkdownEditorTakeover
          key={composerScopeKey}
          Editor={MarkdownInput}
          plainField={promptInputRef}
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
