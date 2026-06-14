# simplify
description: Review changed code for reuse, simplification, efficiency, and altitude cleanups, then apply fixes.
type: prompt
promptTemplate: |
  Review the current diff for simplification opportunities:

  1. **Code reuse**: Can any new code reuse existing utilities, patterns, or abstractions?
  2. **Simplification**: Can the logic be expressed more clearly with fewer lines?
  3. **Efficiency**: Are there unnecessary allocations, iterations, or async operations?
  4. **Altitude**: Is the code at the right abstraction level? Are there leaky abstractions?

  For each finding, explain the issue and propose a specific fix.
  Only flag items where the improvement is clear and non-controversial.
  Apply the fixes directly to the working tree after review.
