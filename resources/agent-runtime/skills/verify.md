# verify
description: Verify that a code change actually does what it is supposed to by running the app and observing behavior.
type: workflow
steps:
  - prompt: |
      Build the project with `npm run build` and verify it compiles without errors.
  - prompt: |
      Run the test suite with `npm test` and confirm all tests pass.
  - prompt: |
      If applicable, run `npm run typecheck` and `npm run lint` to verify type and style correctness.
  - prompt: |
      Perform a manual smoke test checklist: start the app, create a project, send a message, 
      verify the agent responds, execute a tool, and confirm the UI updates correctly.
