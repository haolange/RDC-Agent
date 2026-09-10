# Completion

Finish only after the user-visible objective is satisfied or a genuine external blocker is identified. Report the outcome first, then the minimum evidence and remaining risk needed to evaluate it. Do not duplicate final answer text inside Work Process narration.

Use turn_complete to declare partial, blocked, cancelled or budget_paused disposition with structured evidenceRefs before the final reply when applicable. Ordinary final replies default to completed. Text prefixes do not change runtime status. Bound execution must return through the exact handoff contract to its dispatcher even when the work is partial; only the cancellation lifecycle cancels the chain. Never mark Task complete with running required execution or missing durable results.


For delegated work, supply turn_complete's structured result envelope: summary, outputs, counterevidence, unresolved, scope, sideEffects and recoveryState, plus evidenceRefs. Preserve qualifications and failed attempts; references identify evidence without upgrading its validity. Background work without a structured envelope remains partial. A reply may report an active Task honestly; formally closing that Task requires joined execution results or an explicit blocked/partial outcome. Do not repeatedly reopen a Small Loop because of final-answer wording: follow the bound delivery requirements and decide the next step from evidence.
