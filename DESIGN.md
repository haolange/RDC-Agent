# RDC-Agent Design and Architecture Guide

`DESIGN.md` is the authority for product boundary, runtime architecture, UI standards, and verification gates in this repository. If `README.md`, `AGENTS.md`, or `docs/architecture/*` conflict with this file, update the other document and keep this file as the source of truth.

## Product Boundary

RDC-Agent is a general agent workbench with first-class RDC/RDX and RenderDoc `.rdc` capabilities. It must feel useful as a normal agent workbench for reading, planning, editing, searching, tool use, handoff, memory, and subagent orchestration, while retaining specialist workflows for capture opening, replay context, RDX actions, diagnostics, and RenderDoc investigation.

The product is not a fixed-mode wizard. Ask, Plan, Edit, Debugger, Analyzer, and Optimizer are agent profiles with different instructions, tools, approval policy, handoffs, and visibility. A profile may appear in the composer orchestrator menu only when it is user-invocable. Plan is not a hardcoded `AppMode`; it emerges from a `.agent.md` profile that can research, ask the user, write plan artifacts, call allowed subagents, and hand off implementation.

## Runtime Boundary

The only agent runtime path is the agent loop:

1. resolve profile, model route, policy, and available tools;
2. call the LLM;
3. execute approved tools;
4. feed tool results back into the loop;
5. produce a final answer.

Renderer code must not create fake reasoning stages. Runtime events project into `ConversationWorkTrace`, not visible chain-of-thought. Hidden CoT is never displayed or persisted as UI content; provider-visible thinking may appear only as an explicit `ThinkingArtifact` with controlled Work Process visibility.

`ConversationWorkTrace` is the visible progress contract. Blocks may be:

- `llm_turn`: one model loop, including optional thinking, loop result text, requested tool calls, and tool results;
- `reasoning`: short visible summaries only;
- `approval`: permission requests and decisions;
- `user_input`: explicit `ask_user` questions and answers;
- `compaction`: context compaction summaries;
- `subagent`: delegated agent activity;
- `handoff`: next-agent or next-action handoffs;
- `diagnostic`: provider, route, runtime, or RDX diagnostics;
- `output`: final answer preparation.

Historical `workTrace` entries that do not match the current canonical schema are discarded at storage read boundaries (`workTrace: null`). Runtime code and visible UI use only the canonical contract; no legacy normalization or migration shims are applied.

## Provider Account Boundary

Account providers are login products, not API-key shortcuts. Super Grok Account is the xAI account-OAuth provider: RDC-Agent uses the xAI public native-client registration and Authorization Code + PKCE. Browser code is the default: xAI completes consent by showing a one-time code, the user pastes it back into RDC-Agent, and RDC-Agent exchanges it with the active PKCE verifier; the registered loopback-shaped redirect URI remains an OAuth request field but RDC-Agent does not bind a localhost callback server. Device Code is the explicit remote/headless alternative, with no silent fallback between modes. RDC-Agent obtains and refreshes its own token set, never stores or logs the one-time code, and must not import `~/.grok/auth.json`, proxy the Grok CLI session, or share a rotating refresh token with another client. xAI (Grok) remains the separate API-key provider for console keys, and normal users are never asked to paste a public OAuth client id.

## Profiles

Profiles are `.agent.md` files resolved by the RDX Runtime scope system. Bundled defaults may seed missing user resources, `~/.rdx/agents` is the editable user truth, and `<project-root>/.rdx/agents` may replace a same-id user profile for that project. Profile resources are replaced as a whole; runtime code must not field-merge two profile files or fall back to JSON mode profiles.

Required baseline profiles:

- Ask: read-only clarification, project search, web lookup, and guidance.
- Plan: research, questions, subagent exploration, memory/plan artifact writing, and implementation handoff without direct mutation.
- Edit: ordinary implementation work with read/search/web/bash/write/edit/task/memory/agent capabilities governed by approval policy.
- Debugger: RDC/RDX and RenderDoc investigation.
- Analyzer: evidence analysis, triage, and reportable findings.
- Optimizer: bottleneck analysis, optimization ordering, and validation.

Do not add mode-specific runtime branches when profile instructions, tool permissions, approval policy, or handoffs can express the behavior.

## RDX Runtime Scope and Storage

RDC-Agent has one canonical resource namespace. User resources live under `~/.rdx`; project resources live under `<project-root>/.rdx`. The application does not expose a configurable workspace root and does not resolve legacy resource directories.

```text
~/.rdx/
  config.json
  RDX.md
  agents/
  skills/<skill-id>/SKILL.md
  mcp/
  hooks/
  policies/
  knowledge/
  memory/

<project-root>/
  RDX.md
  <nested-dir>/RDX.md
  .rdx/
    project.yaml
    agents/
    skills/
    mcp/
    hooks/
    policies/
    knowledge/
    memory/
    inputs/
    artifacts/
```

Application-owned session, task, trace, UI, log, cache, and secret state stays below the Electron OS data locations. It is not a scoped resource and must not be written into `~/.rdx` or a project repository. Project `.rdx/.gitignore` excludes `inputs`, `artifacts`, `memory`, and runtime state; declarative agents, skills, MCP, hooks, policies, knowledge structure, and project metadata may be committed.

Resource precedence is `builtin < user < project`. Agents, skills, MCP servers, and hooks use stable ids and whole-resource replacement. A project disabled override may intentionally shadow an inherited resource. Every effective result carries scope, path, content hash, overridden source, and effective status. Policies are additive restrictions: deny sets are unioned, approval strength may only increase, and numeric limits may only decrease. Invalid or weaker project policy is rejected fail-closed.

Settings scoped editors (Skills / Tools MCP / Hooks / Policies) use a full-width User | Project scope row, then an Agents-style master-detail body: Import + New toolbar, resource list, and a labeled detail editor. Agents keeps the same scope row without a duplicate New; create/import stay on the Agents toolbar only. They do not show a decorative “RDX Runtime” kicker. Workspace path cards and Control Panel runtime context remain separate surfaces and may still name the RDX Runtime roots.

RDX CLI actions are device configuration. Project resources cannot replace their commands, environment, catalog, or executable path. Project MCP servers are reconciled only for the active project.

## Project Instructions

Prompt instructions resolve in deterministic order: `~/.rdx/RDX.md`, project-root `RDX.md`, then each `RDX.md` from the project root to every active target directory. Active targets include the session working directory, attachments, the opened capture, and path-bearing tool calls. Shell instructions follow the resolved command working directory.

The resolver rejects traversal and symlink escape, records provenance and diagnostics, and enforces a visible byte budget. It never silently truncates or automatically imports `AGENTS.md` or `CLAUDE.md`. Instructions are model context; they do not expand filesystem, command, tool, or permission authority.

## Skills

Skills use the standard directory form `skills/<skill-id>/SKILL.md` with optional `scripts`, `references`, and `assets`. The runtime initially exposes a bounded metadata catalog. Skills named by `.agent.md` are preloaded before the first model call; other effective skills remain discoverable and are loaded through `skill_read`. An empty profile `skills` list means no preload, not no discovery. Explicit `$skill` invocation preloads the selected skill before the first call.

Skill `allowed-tools` may narrow but never expand the effective profile tool set. Reference files are lazy and scripts execute only through normal tool and permission policy. The metadata catalog consumes at most two percent of the active context estimate, or 8000 characters when no estimate is available; overflow emits diagnostics without truncating selected full skill instructions.

## Hooks

Hooks are deterministic lifecycle commands stored as `.hook.yml`; they are not hidden prompt fragments. Definitions use structured `command` and `args`, explicit working directory, environment references, timeout, `block` or `warn` failure policy, and agent/tool matchers. Raw `shell: true` execution is forbidden. Project hooks require trust keyed by project identity and hook content hash; content changes revoke trust. Hook requests, bounded output, failures, and decisions are recorded in the canonical trace.

## Memory and Knowledge

Memory is explicit and scope-aware. The runtime exposes search, read, write, and delete operations for User and Project memory. Writes require explicit user intent or an interactive approval and deletes require confirmation. Conversation turns never trigger extraction or consolidation, and no memory index is automatically injected into a prompt.

`knowledge/` is a top-level scoped resource location only in this architecture wave. It has no prescribed case, invariant, workflow, retrieval, ranking, or prompt-injection schema. A future Knowledge Engine must be designed as a separate runtime capability rather than reactivating automatic memory behavior.

## Prompt and Request Contract

Every model call follows one provider-neutral pipeline:

```text
Scoped Runtime Resolution
  -> EffectiveCatalogService (account + model + protocol snapshot)
  -> PromptPlanBuilder
  -> Context and Message Transformation
  -> RequestEnvelopeBuilder
  -> RequestPlanner (closed RequestPlan)
  -> Provider Adapter
  -> Provider Wire Request
```

`PromptPlan` is the complete instruction plan. Each segment has an id, kind, scope, source path, source hash, precedence, content, and token estimate. It combines source-controlled core contracts, the effective agent, the active `RDX.md` chain, preloaded skills, the discovery catalog, effective tools and MCP schemas, policies, permissions, runtime facts, and context summaries. Capability prose is generated from actual effective tools; generic hardcoded capability claims are forbidden.

Session context has one canonical, append-only reconstruction path. `conversation.jsonl` stores the conversation transcript, `conversation-branches.json` is the authority for forks and the active leaf, and `session-context.jsonl` stores one provider-neutral terminal delta per turn. Before each request, the shared branch resolver selects the active branch's visible turn ids and the route materializer joins those journal entries with the current `PromptPlan`, tools, provider route, and turn controls. Agent changes, Fast mode, 1M context, and reasoning effort affect the next request configuration; they do not create private Agent histories or replace canonical session history.

Provider continuation artifacts replay only when `providerId + modelId + protocol` exactly match the route that produced them. Incompatible signed, encrypted, or readable reasoning continuation state is removed while ordinary assistant text and paired tool facts remain. Context compaction changes only the derived request view when the active model window requires it; it never overwrites the journal. A compaction or journal failure fails closed rather than silently dropping history.

Edit-and-resend and branch switching are lifecycle transactions. They first stop and await the active turn's scheduler, provider abort, human/tool cleanup, terminal conversation persistence, journal append or error publication, and active-turn cleanup. A rewrite then atomically commits one concrete branch containing the new user anchor and root turn before it starts exactly one resend. Journal entries retain the branch, turn, and message identity captured at turn start; sibling entries remain append-only and a late old turn must never infer ownership from the current active leaf. Legacy per-Agent thread files are neither read nor written by runtime or migration.

`RequestEnvelopeBuilder` combines the prompt plan, transformed messages, tool schemas, controls, effective route, and reasoning contract. `RequestPlanner` compiles those controls and the selected `EffectiveModel` into the required closed `RequestPlan`; every adapter call carries that plan. Provider adapters only translate the envelope and plan into provider wire shapes and must not re-resolve model capability. Each call persists a sanitized provider-neutral snapshot under application session state. Snapshots retain provenance, route, protocol mapping, messages, tools, resources, and reported or explicitly estimated token usage, while credentials, capture binaries, protected continuation payloads, and opaque reasoning plaintext are removed and represented only by safe metadata or hashes.

## Provider Reasoning Contract

Reasoning semantics are model/provider facts, not protocol facts. The canonical semantic values are `raw`, `summary`, `opaque`, `none`, and `unknown`. Native providers may be classified only from maintained evidence. App-managed vendors with documented readable CoT (DeepSeek, Moonshot/Kimi, GLM, MiniMax, MiMo, and their coding/token plans) resolve to `raw` on both Anthropic-compatible and OpenAI Chat Completions routes; they must never inherit native Anthropic `summary` semantics. Truly unverified third-party routes default to `unknown`.

Work Process product copy separates the top-level transcript header from loop thinking folds. The header uses “工作中” (English: Working) with Active Signal while the turn is running, and “工作过程” (English: Work process) after settle, plus duration/action meta. Loop thinking folds use a quiet spark icon before the label, “正在思考” (English: Thinking) while streaming/running, and “已思考 · {duration}” (English: Thought for {duration}) after settle—or “已思考” / “Thought” when duration is unavailable. Do not use “深度思考” or settled “思考了”. Readable `raw`, `summary`, and `unknown` thinking share these labels; the UI must not scare users with “语义未验证” or split copy such as “原始思考”. Request Inspector may still show the contract `semantic` for debugging. Loop commentary is narrative prose rendered with markdown (never promoted into the thinking slot). Final answers render only in the assistant message body as full-bleed prose—not a raised bubble.

Providers that officially expose multiple wire protocols must offer an explicit protocol selector that distinguishes `AnthropicMessages`, `OpenAICompatibleChatCompletions`, and `OpenAIResponses`. Switching protocol updates the catalog default Base URL when the user has not customized it.

## Tool and Command Catalog

Tools must be declared with name, permission level, input schema, result summary, UI icon, and approval requirement. The canonical builtin catalog is the 36 ids in `BUILTIN_AGENT_TOOL_IDS` (`src/shared/constants/agentToolTokens.ts`):

- file and search: `read_file`, `glob`, `grep` (`search_codebase` has been removed; use `glob`/`grep`);
- web: `web_fetch`, `web_search`;
- execution and mutation: `bash`, `write_file`, `edit_file`, `delete_file`, `move_file`, `copy_file`, `notebook_edit`;
- git: `git_status`, `git_diff`, `git_log`, `git_add`, `git_unstage`, `git_commit`;
- workflow: `ask_user`, `task_create`, `task_update`, `task_get`, `task_list`, `task_stop`, `agent_handoff`, `subagent`, `plan_artifact`;
- discovery: `tool_search`;
- context: `memory_search`, `memory_read`, `memory_write`, `memory_delete`, `skills`, `skill_read`, `mcp`;
- RDC/RDX: `rdx_context`, plus Settings-managed capture open/preview/close, remote connection, and RDX shell actions.

Manifest-facing tokens expand through `CANONICAL_TOOL_TOKEN_EXPANSIONS`. The `task` token expands to `task_create`, `task_update`, `task_get`, `task_list`, and `task_stop`. Removed tokens such as `todo` and `search_codebase` are rejected via `REJECTED_TOOL_TOKENS` with no silent fallback. Catalog includes `subagent`, `tool_search`, and `task_stop`.

MCP tools load deferred on `native-structured` routes: builtin tool schemas are injected in full every request, while `mcp__*` schemas stay out of the provider tools list until activated. Discovery goes through the `mcp` catalog tool and `tool_search`; a `tool_search` hit or a direct call to a not-yet-injected `mcp__*` tool activates it (execution stays fail-open, metering stays honest), and the activated schema rides along from the next LLM call in the same turn. The activation set is keyed by session, agent, and the full tool signature; it resets when the available tool set changes. `RequestEnvelopeSnapshot.tools` always reflects the actually sent set.

Slash commands are runtime inputs, not bypasses around profile permission. Baseline commands are `/help`, `/compact`, `/context`, `/memory`, `/agents`, `/skills`, `/mcp`, `/status`, and `/model`.

Runtime permissions are profile-aware and mode-aware. The composer exposes `Default`, `Auto-review`, `Full access`, and `Custom(config.toml)` permission modes, but the main process remains authoritative. `Default` allows routine workspace inspection and pauses for external files, network, mutation, destructive shell, or unrecognized commands. `Auto-review` records a reviewer decision before continuing. `Full access` is an explicit trusted mode for local file and command access. `Custom(config.toml)` uses configured readable roots, writable roots, and command allow/deny lists. Work Process must show the real `Requested approval`, `Approved`, `Denied`, or `Auto-reviewed` transcript; it must not present a policy pause as an ordinary failed shell command.

## RDX Boundary

This repository does not vendor an RDX toolchain. RDX and RenderDoc capabilities must come from user-configured external CLI actions in Settings. Do not hardcode CLI paths, catalog paths, shell commands, or repository fallbacks in `src/main`, `src/preload`, `src/renderer`, or packaging configuration.

The only UI entrance for opening a `.rdc` into a session is the session context panel. Project-level surfaces may browse, import, and refresh project captures, but must not provide a hidden or duplicate open action. An opened `.rdc` is owned by the app session that opened it via `ownerSessionId`; RDX replay `sessionId` remains a runtime identifier and must not be used as the app-session owner. Session UI and agent context injection must fail closed when `ownerSessionId` does not match the current app session, so a new or switched session never inherits another session's opened capture.

## UI / UX Boundary

Agent messages are structured as:

1. user message;
2. Work Process block;
3. final answer.

Transcript layout uses one content rail (`--chat-transcript-width`, aligned with the composer). User prompts are right-aligned raised bubbles (`fit-content`, `--token-surface-raised`). Assistant final answers, Work Process (including tool cards), and loop commentary render full-bleed across that rail—transparent prose with no bg/border bubble chrome.

The Work Process block is a real runtime transcript, not a stage status log. While running, the header uses dynamic Active Signal copy such as `工作中`; after the turn settles, the header is process-first copy such as `工作过程 · 持续 7.5s · 5 个动作` (English: `Work process`). Terminal status like `执行完成` must not become the visible headline or primary meta copy. It is expanded while running and keeps its latest expanded/collapsed state after terminal states; users collapse or expand it manually. Approvals and pending `ask_user` interactions may auto-expand as blocking signals; ordinary tool cards stay collapsed by default (including while running or thinking) so live observation stays quiet—users expand individual cards when they want content detail or Raw. Tool calls render as a flat list of unified single-disclosure cards (no `toolGroup` shell): collapsed state shows an `icon + verb` header plus an **outcome-first** family body—when results are available, show the content-layer summary (e.g. `42 files` + path samples for `glob`, match counts + lines for `grep`, path · line count for `read_file`); while running or before results arrive, fall back to the args anchor (`pattern` / path / `$ command` / url / target). Clicking the header expands family detail content plus a styled Raw panel (`参数` / `返回值`). There is no dual toggle that splits verb-vs-target disclosure. Preview shows only the content layer—never transport envelope fields `ok` / `data` / `trace_id` / `duration_ms`. Conversation `resultPreview` must store a projection-friendly truncated envelope (content text + structured `details` counts), not a blind mid-JSON byte slice. Family templates cover file, search, shell, git, web, and generic (task/memory/skill/mcp/subagent/rdx/plan/tool_search). File cards use mono path with copy; shell/git expand into `$ command` + stdout; search expands into a match list; web may show source pills (favicon + domain) with `web_fetch` body as an outbound link.

Work Process section semantics are stable: each section represents one `llm_turn` only when that loop has visible process evidence: provider-visible thinking, loop commentary prose, tool calls, approvals, diagnostics, or user input. The section hierarchy is fixed: thinking disclosure (footnote-level chrome—quieter type and muted color, not a narrow content column) when present; commentary markdown prose next; tool calls, approvals, and `ask_user` interactions nested below as execution evidence. Thinking body text, commentary prose, and tool cards all span the full transcript rail (`width: 100%`) and share the same content-column left edge; do not reintroduce measure caps such as `62ch` on thinking preview, and do not indent nested tool lists to align with the thinking spark icon. Within a loop, consecutive tool-card outer spacing uses `--space-3` so heavy evidence cards do not visually glue together; thinking/commentary → first tool keeps a larger entrance breath (about `--space-2` content gap plus `--space-2` list margin) so narrative-to-evidence hierarchy stays clearer than sibling-tool rhythm. Rail markers are loop-level only (quiet 6px stroke nodes on a 1px subtle vertical line): complete = low-saturation fill, running = info pulse, error = error color; nested tool rows have no rail dots. The Work Process header uses `工作过程` / `Work process` when settled and `工作中` / `Working` while active. Loop-level thinking folds use a quiet spark icon plus `已思考 · {duration}` / `Thought for {duration}` when settled and `正在思考` / `Thinking` while active; they must not reuse the header’s process title or say `深度思考` / settled `思考了`. Assistant final-answer text streams only in the assistant message body; Work Process must not duplicate that body or final-answer tokens as loop prose. Provider summary thinking is shown as a user-collapsible disclosure, raw provider-visible thinking is collapsed but user-expandable, and hidden/opaque provider continuation state never reveals plaintext. A loop without thinking may still show commentary prose when it has tool evidence; a loop with neither thinking, commentary, nor tool evidence is skipped as answer-body-only. Within a loop, ≤7 tool rows stay flat; ≥8 consecutive tools collapse into one natural-language aggregate summary row that expands to the flat tool details. Tool-call cards stay collapsed by default at every lifecycle stage (requested, running, completed, error); only pending approvals / `ask_user` may auto-expand as blocking signals—users open Raw and content detail manually when needed.

Work Process trace and presentation have separate contracts. The trace model records canonical runtime events immediately, including tool starts/completions, approvals, `ask_user`, provider-visible thinking deltas, and loop result deltas. The renderer is a causal disclosure projection over that trace: when a loop has visible thinking or result text still streaming, child tool/user-input evidence remains in the model for counts and replay but the body details are not expanded until the visible loop text settles. Pending `ask_user` and approval headers may stay visible as blocking interaction signals, but their internal completion/result details must not pre-empt the active loop transcript. Disclosure timing is driven only by canonical event lifecycle and loop boundaries; timers, artificial delays, fake stages, and hidden chain-of-thought placeholders are not product paths. New assistant content events after a tool-use loop, including thinking-only events before text deltas, start a new `llm_turn`; tool and human-in-the-loop evidence continues to belong to the loop that requested it.


When an answer-only `llm_turn` follows visible process evidence, the renderer does **not** project a Reply / final-response boundary row. Provider-visible closing thinking folds into a quiet thinking-only section (same spark + `已思考 · {duration}` / `Thought for {duration}` pattern as other loops). If that turn has no visible thinking, it produces no Work Process row. The final answer body itself still renders only in the assistant message body and must not be copied into Work Process. Duplicate late summary thinking that was already shown in a preceding process section is suppressed rather than rendered as a new empty row. Spacing between the whole Work Process block and the assistant body is the sole process-to-result visual break: both expanded and collapsed use a true `10px` (stack `gap` cancelled for this pair; last step bottom padding zeroed), with quieter caption chrome when collapsed. The leading status dot shares the assistant prose left edge (title and meta follow; trailing caret); do not hang the dot past the answer body or reserve a wider leading column that shifts the mark inward. Loop turns nest under the header with `space-4` so gray rail nodes stay hierarchically inset from the green status dot.

Request Inspector (desensitized `RequestEnvelopeSnapshot` browser) remains available as code-level debug tooling only. It must not mount in the default Session or Trace right panels, must not render inside the Work Process transcript body, and must not compete with thinking/tool evidence for attention.

Each canonical `llm_turn` may carry provider/runtime metadata: `stopReason`, `outputPhase` (`commentary` vs `final_answer`), and `reasoningState` (`raw`, `summary`, `unknown`, `opaque`, `hidden`, `none`). `final_answer` must be inferred from stop metadata and pending-continuation state, not from fragile text heuristics. Commentary is always narrative prose (`proseText`) and must never be promoted into the thinking slot. Final answers render only in the assistant message body as full-bleed prose—not a raised bubble.

Work Process is a single narrative stream of `llm_turn` loop units in canonical order. There is no semantic step-group shell and no grouped/detail view toggle. Hierarchy comes from commentary prose rhythm (model-authored markdown headings and short paragraphs) plus quiet loop-level rail nodes; silent loops without commentary stack under the preceding prose naturally.

Active Signal text is a shared visual primitive for live Work Process activity. When active, the phrase uses a left-to-right energy shimmer via tokenized clipped-gradient text (`background-clip: text`) with a `prefers-reduced-motion` fallback to a static highlight and no animation. It must not use spinners, progress bars, or trailing pulse dots as the primary live cue. It may appear only on primary active phrases backed by canonical `running`, `pending`, or thinking `streaming` state: the Work Process header while running, active thinking labels, pending `ask_user` interaction headers, and composer human-in-the-loop panel kickers. It must not appear on completed, failed, stopped, or historical transcript rows; it must not animate ordinary tool verbs, aggregate summary text, subagent/task child labels, raw arguments, tool results, answers, metadata, or hidden/opaque reasoning content. Newly disclosed Work Process rows may use a short CSS appear animation driven by real event insertion; timers and artificial stagger that fake streaming order are not product paths. The signal communicates that real runtime work or human-in-the-loop waiting is still in progress; it is not a fake progress stage, not a completion indicator, and not a way to disclose hidden chain-of-thought.

`ask_user` and tool approvals are human-in-the-loop interactions. The canonical `ask_user` contract is a batch `questions[]` payload; a single question is represented as an array with one item. `ConversationToolCall.userInputQuestions` is the only cross-layer question payload. `argsPreview` is display-only and must never be parsed as product state or used to fabricate a fallback question. Each question may include `questionId`, `prompt`, `description`, structured `options[]` (`optionId`, `label`, `description`) and `allowFreeform` (default true). Runtime-generated ids fill missing ids before the request reaches renderer state; missing structured data fails closed and disables submission. The runtime pauses the active tool call, and the composer area owns the answer controls: a wizard with `current of count` navigation, option descriptions and freeform multiline answers whose submission resolves once with `answers[]`. Work Process records a compact question-and-answer transcript in one disclosure: pending requests default expanded, completed requests default collapsed, and incomplete/error requests default expanded. Its header reports the real question count and progress; the body renders each prompt with its submitted answer in order, but does not repeat option descriptions or answer controls. It must not wrap tools in a nested group shell, collapse a batch into a single Q/A card, render raw choices JSON, internal ids, policy JSON, fake assistant text responses or duplicate completed tool result blocks. Profile handoff events are recorded in Work Process and the agent event stream; ordinary completed assistant messages must not append automatic Next actions buttons.

Composer profile menus show profile name and status. Long descriptions belong in hover tooltips, not inline list clutter.

Composer footer controls are grouped by intent: left side is pre-send context and policy (`attach`, agent profile, permission mode); right side is execution telemetry and action (effort control, `context usage`, send/stop). Permission mode must not sit beside the send button as if it were an execution action.

Global stacking follows one contract: composer/sticky content is below the modal backdrop, the modal is above its backdrop, and tooltip/notification layers remain above the modal (`composer < modal backdrop < modal < tooltip < notification`). A composer-local popover may cover the composer only inside the composer's own stacking context; it must never escape above Settings.

The effort control sits immediately left of the context usage ring. It is a pill that opens an upward popup containing one capability-driven reasoning rail plus two switches: `1M context` and `Fast mode`. `Auto` is not a product state. The rail is generated from `reasoningControl`: `unknown` renders neutral `Unverified / Provider managed` and no invented stops; `none` means confirmed unsupported and renders one locked `Off`; `toggle` renders `Off | On`; `always-on` renders one locked `On`; `levels` renders only the exact model's named levels and prepends `Off` only when the model can really disable reasoning. Product labels are `On`, `Minimal`, `Low`, `Medium`, `High`, `XHigh`, `Max`, and `Ultra`; canonical internal `xhigh` is mapped to the `XHigh` label, not retained as an `extra` alias. A model-variant reasoning family may expose `Off | On`, but selecting it changes only `RequestPlan.effectiveModelId` between the two live canonical model ids and never emits a fabricated reasoning parameter.

Dragging the reasoning rail is continuous: the thumb follows pointer position, preview color follows the level that would be committed, and pointer release selects `round(ratio * (visibleStops - 1))`, clamps it to the visible subset, and animates back to that stop. Release must keep a snap hold so `turnControls` commit cannot briefly drop below `Max`/`Ultra`. Ordinary levels use one solid `--token-effort-*` tone across the full track with stop dots always visible. Only product top-tier `Max` (and `Ultra` when exposed) uses the translucent dark-gray rail plus soft lavender canvas pixel-field evolution: a stable coordinate-noise field grows leftward over the shared ~800ms clock while stop dots fade, and reverses through the same topology when leaving the tier. It must never use a whole-field opacity fade, a dark-to-solid track crossfade, or per-frame noise reshuffling. `prefers-reduced-motion` jumps to the corresponding static state. The `1M context` and `Fast mode` rows stay visible, terse, and capability-driven; disabled rows show no provider prose, numeric range, or hidden model id. Reasoning, `1M context`, and Fast choices are remembered per `agentId + providerId + modelId`, snapshotted as `turnControls.reasoningLevel`, `turnControls.maxContextMode`, and `turnControls.fastModel`, and persisted as the active route's last-sent controls.

Compact Composer controls must stay state-first and terse. They may show labels, values, and short disabled reasons only. Do not render provider documentation excerpts, source claims, marketing/model notes, catalog research notes, or explanatory paragraphs inside the popup. Longer provider capability rationale belongs in Settings details, catalog source metadata, or architecture docs, not beside the send controls.

### Transcript Markdown

Shared `MessageMarkdown` renders commentary, final answers, and (when enabled) user bubbles and composer preview. It supports GFM, fenced code blocks with language label and copy, KaTeX math, Mermaid diagrams (fail-closed on parse/render errors), and extended syntax highlighting. Thinking/CoT folds stay plain text. Raw HTML stays disabled.

### Appearance Settings

Settings > General > Appearance preference rows stretch to the content rail: Theme / Language / Font Size segmented controls fill the row after the label (no card or pill-group max-width cap). Switch rows keep copy left and control right-aligned.

Settings page chrome uses a single-line header (section title + close), with no page-level marketing subtitle under the title. Content cards provide the visual weight below the hairline.

Settings > General > Appearance exposes two opt-in toggles; both default **off**:

- `composerMarkdown`: Markdown highlight plus Write/Preview tabs in the composer; when on, sent user bubbles also render through `MessageMarkdown`.
- `usePointerCursors`: sets `html[data-pointer-cursors='true']` so interactive elements use a pointer cursor (`src/renderer/styles/global/pointer-cursors.css`).

## Model Capability and Context Window

Model capability is account- and surface-specific. `EffectiveCatalogService` is the only capability authority and produces `EffectiveModel` records by field-level merging of bundled seed, provider discovery, protocol overlay, account entitlement, observed evidence, and allowed user preferences. Every effective field carries provenance. Runtime, renderer, Settings, and workflow services must not import a static model catalog or infer capability from model names; they consume effective catalog snapshots and closed `RequestPlan` values. `reasoningControl` remains the canonical reasoning contract inside `EffectiveModel`.

Provider catalog ownership is explicit. For app-managed providers RDC-Agent locks route/base URL, tier definitions, and account entitlement; users may only enable models, choose the default reasoning level, and set a client-side context budget. Settings renders the complete current effective snapshot for these providers, while persisted model rows contain only those allowed preferences and never become a second catalog. User-managed providers retain editable endpoints, protocols, credentials, and model definitions. Provider identity remains flat—one provider entry represents one product surface—while `vendorId` is display-only grouping metadata. A model-level fixed route wins over the user's protocol selection, which wins over the preset default. Protocol changes trigger discovery refresh, capability reprojection, and turn-control clamping.

Changing the selected model uses the scoped agent-definition save path shared by Settings and `/model`: renderer state updates optimistically, monotonically increasing `clientRevision` values discard stale A→B→C responses, and only a failed latest revision rolls back with a local error. This path atomically writes the agent manifest, derives its route, and refreshes only the affected agent; it must not rebuild the workspace, reinitialize all IPC, reload all LLM settings, or broadcast every provider catalog. A running turn keeps the `RequestPlan` captured at creation; a change affects only the next send.

Context tiers describe provider limits, activation, billing, and entitlement; client budgets are independent policy. `maxTotalTokens` is the complete window, `maxPromptTokens` the input cap, `maxOutputTokens` the output reserve, and `defaultBudgetTokens` the normal client prompt budget. The active prompt budget is the smaller of the selected client budget and the known prompt cap; a missing cap stays unknown. `1M context` is eligible only when the complete window is at least one million tokens, so Copilot's 922K prompt plus 128K output is 1M-class. One 1M-class tier may serve both modes: normal uses the provider default or a 256K client budget, while enabled 1M uses `min(1M, prompt cap)`. Sub-1M models expose their real window without a switch. Windows above 1M are still capped to this explicit 1M product mode until a separate higher-tier design exists. An unknown entitlement is shown as `1M · Unverified`; a short request cannot promote it to granted. Fast remains a separate exact-surface capability. Auto-compaction stays at 80% of the active `RequestPlan.contextBudgetTokens`.

Capability probes are explicit user actions, never background traffic. They use the same `PromptPlan -> RequestEnvelope -> RequestPlan -> adapter` path with no tools and a one-token output limit. Only deterministic success or rejection changes observed evidence; quota responses remain transient, and an unknown implicit long-context tier stays inconclusive until a real request crosses the provider's default threshold.

`ProviderPreset` is an in-repository, schema-versioned, JSON-serializable declaration of provider lifecycle, authentication modes, routes, discovery, seed models, and overlays. Presets contain no executable functions or credentials. Adapter code is reserved for a new wire protocol, OAuth/device/refresh flow, request signing, non-standard catalog parsing, or subprocess/ACP integration. `RequestPlanner` compiles tier activation, Fast mode, reasoning wire shape, temperature, and context budget into a closed `RequestPlan`; provider adapters translate that plan into wire requests and do not re-resolve capability.

Provider lifecycle is a truthful admission contract, not a progress label. A provider is `stable` and available only when its configured authentication mode, route, discovery path, request translation, and deterministic contract fixtures are complete. A provider whose upstream login or catalog contract cannot be verified is unavailable with one shared reason in Settings and Runtime; it must not register a guessed flow, expose a dead control, or remain as a user-visible half implementation.

Context usage metering is hybrid and honest. The composer ring is the revisioned `Estimated` projection for the next request, produced by a read-only IPC that reuses the canonical `PromptPlan -> RequestEnvelope -> RequestPlan` path, active journal branch, tools, skills, attachments, and current draft. Model, controls, attachment, tool/skill, or draft changes schedule a new projection; late revisions are discarded. It returns estimated input, prompt budget, complete window, category breakdown, compaction intent, and a blocking reason. Provider-reported usage remains `Last actual` in the popover; optional cache/read/write and reasoning totals render only when reported, never as fake zeroes. The latest `RunContextUsageSummary` still persists to `<sessionDir>/usage.json` for that historical actual snapshot (subagent-isolated sessions excluded).

The context breakdown popover anchors above the composer shell at full input width. Its hero shows the next request's estimated occupancy, complete window, mode, and `--token-context-*` breakdown; `Last actual` is visually separate. Shrinking the target window never rewrites history in advance: the projection says “next send will compact,” and the send rematerializes the complete canonical journal before deriving a compact view for the new budget. Ordinary messages and paired tool facts replay across providers; provider-native reasoning artifacts replay only for an exact `providerId + modelId + protocol` match. Incompatible vision attachments or a tool schema that cannot fit fail closed. The grouped legend collapses by default, and its expand state remains `appearance.contextBreakdownExpanded` UI memory rather than a Settings option.

## Design System

Use semantic tokens from `src/renderer/styles/design-system.css`. Component CSS must prefer `--token-*`, `--text-*`, and `--space-*` variables. Buttons must use the shared `.button` system or `Button` component. Do not introduce new hardcoded color systems, duplicate button classes, or unrelated visual rewrites.

The visual language is macOS-flavored: depth comes from layered soft shadows and a glassy top edge, not from hard 1px outlines. Raised surfaces (user message bubbles, cards, popovers) express elevation through the `--token-shadow-raised` / `--token-shadow-card` / `--token-shadow-popover` tokens paired with `--token-elevation-edge`, keep borders at `--token-border-muted`, and use the softened radius scale (`--radius-*`; user bubbles use `--radius-bubble`). Assistant prose and Work Process are not raised bubbles. `--token-surface-raised` is the raised fill with a faint vertical sheen; `--token-surface-sunken` is the inset fill for code/result blocks. Monospace (`--font-mono`) is reserved for code and raw tool/result previews only; transcript meta, paths, tool-name chips, timestamps, and labels use the sans stack.

Every new component must cover rest, hover, active, focus, disabled, and relevant loading/error states. Avoid nested cards, unrelated decorative gradients, and layout shifts caused by dynamic text or controls.

## Legacy Cleanup

Legacy or deprecated compatibility is not retained. Cutover uses verified one-time operational staging and leaves no fallback, duplicate active schema, old-named wrapper, or user-visible dual path. A versioned, idempotent persisted-data migrator is allowed only when existing user sessions cannot be staged centrally: it must read the canonical source data rather than deprecated runtime state, commit its marker only after complete success, resume partial writes safely, and permanently leave the old path inactive. Removed terms and pseudo-stage ids are guarded by architecture checks.

## Source Development and Release Boundary

The source checkout has one package-manager contract: Node.js `>=22.13.0`, pnpm `11.7.0`, `pnpm-lock.yaml`, and the per-user store `~/.cache/rdc-agent/pnpm-store`. Source launchers may create ignored `node_modules/`, `out/`, and prepare-state files. They conditionally prepare dependencies and build outputs from stable fingerprints; `--force-prepare` is the explicit recovery path. No npm/Yarn fallback, root-drive package store, or launcher path that bypasses the shared environment contract is retained.

Packaged applications contain compiled output, runtime dependencies, and distributable resources only. They do not invoke or include pnpm, lockfiles, source launchers, prepare state, or development caches. End users launch the platform package directly.

## Verification Gate

Code changes should run:

- `pnpm run check:repository-hygiene` for dependency, entrypoint, repository-output, or packaging changes;
- `pnpm run typecheck`;
- `pnpm run check:architecture`;
- `pnpm run check:fidelity`;
- `pnpm run check:shared-exports`;
- `pnpm run check:agent-runtime`;
- `pnpm run check:provider-system`;
- `pnpm run check:tool-system`;
- `pnpm run check:work-process` and `pnpm run check:work-process-tool-coverage` when Work Process projection, tool catalog labels, or transcript UI changes;
- `pnpm run check:reasoning-delivery` when provider thinking delivery or reasoning artifact projection changes;
- `pnpm run check:settings-agents`;
- `pnpm run build` when entry, runtime, renderer, or packaging behavior changes.

UI and workflow changes must be verified in the real browser session that connects to the real main process bridge. Browser verification should cover at least Settings > Agents, Settings > Skills and Tools, Project/Session sidebars, Ask/Plan/Edit profile behavior, Work Process rendering, dark/light themes, narrow viewport, long paths, Chinese filenames, and long tool output.

The headless browser-session process and the visible Electron desktop are parallel surfaces over the same canonical runtime state. Headless mode must not own Electron's visible desktop single-instance lock; its localhost bridge port is its singleton boundary. All `pnpm run start:*`, Windows `.cmd`, and macOS/Linux `.sh` entrypoints share `scripts/launch-rdc-agent.mjs`; their platform wrappers only locate Node and forward arguments. Visible desktop launchers must always open or focus a real app even while Browser Use QA is running.
