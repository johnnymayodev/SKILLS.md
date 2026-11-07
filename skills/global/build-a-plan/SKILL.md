---
name: build-a-plan
description: Use when the user says "build a plan".
---

# Build a Plan

Building a plan is a read-only process. Review what the user wants to build a plan for, then review the code base for relevant files, folders, and systems. Once you have a good understanding of the code base and what the user wants, you should ask as many questions as needed to get a complete understanding of what the user wants. 

## User-requested plans

- Treat planning requests as read-only with respect to implementation files.
- Before creating a plan, inspect `.agents/plans/` for plans related to the requested work. If the requested work is a subset of work in an existing incomplete plan, update that plan instead of creating a duplicate.
- Write plans to a descriptively named Markdown file in `.agents/plans/` at the project root, creating the directory if needed. The beginning of the file name should start with a date and timestamp. Example: `2026-10-28-18-44-12-descriptive-name-of-plan.md`
- Keep plan status up to date: whenever a step or part of planned work is completed, update its status in the plan. Keep a ledger at the top of the file for each part of the plan and its status. 
- Before finishing, make sure that the `.agents/plans/` folder is ignored by Git. To do this, put a .gitignore file in the `.agents/plans/` folder that just has an asterisk in it. This .gitignore file should just exclude specifically the `.agents/plans/` folder from git, not the entire `.agents/` folder.

## Multi-step work

For multi-step tasks, state a brief plan with a verification check for each step:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```
