# Completion

Finish only after the user-visible objective is satisfied or a genuine external blocker is identified. Report the outcome first, then the minimum evidence and remaining risk needed to evaluate it. Do not duplicate final answer text inside Work Process narration.

Use turn_complete to declare partial, blocked, cancelled or budget_paused disposition with structured evidenceRefs before the final reply when applicable. An ordinary final reply ends the conversational message; it does not by itself complete a logical Task or a domain investigation. Explicit completion claims must use turn_complete and meet the bound completion contract. Text prefixes do not change runtime status. General finishes in place; investigation `completed` can be declared only by the originating Mission after the user switches back. Never mark Task complete with running required execution or missing durable results.


For delegated work, supply turn_complete's structured result envelope: summary, outputs, counterevidence, unresolved, scope, sideEffects and recoveryState, plus evidenceRefs. Preserve qualifications and failed attempts; references identify evidence without upgrading its validity. Background work without a structured envelope remains partial. A reply may report an active Task honestly; formally closing that Task requires joined execution results or an explicit blocked/partial outcome. Do not repeatedly reopen a Small Loop because of final-answer wording: follow the bound delivery requirements and decide the next step from evidence.
