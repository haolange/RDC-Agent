# debug
description: Diagnose and fix issues by examining error logs, tracing execution, and proposing fixes.
type: prompt
promptTemplate: |
  Help debug the issue described above by:

  1. **Reproduce**: Identify the exact steps to trigger the issue
  2. **Isolate**: Narrow down which component/module is responsible
  3. **Root cause**: Explain WHY the bug occurs at the code level
  4. **Fix**: Propose the minimal surgical change to resolve it
  5. **Verify**: Describe how to confirm the fix works

  Prefer evidence over speculation. Read relevant source files before diagnosing.
  If the issue cannot be reproduced from available information, ask for more details.
