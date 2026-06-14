# remember
description: Extract and persist key facts, preferences, and learnings from the current conversation into memory.
type: prompt
promptTemplate: |
  Review the conversation above and extract any key facts, user preferences, decisions, 
  or learnings that should be remembered for future sessions. 

  For each item, determine:
  - **type**: user | feedback | project | reference
  - **name**: short kebab-case slug
  - **description**: one-line summary
  - **content**: the fact with **Why:** and **How to apply:** if applicable

  Only extract information that is NOT already obvious from the codebase or git history.
  Output each memory as a markdown file with YAML frontmatter.
