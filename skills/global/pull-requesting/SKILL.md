---
name: pull-requesting
description: Use when asked to file, open, or create a PR.
---

# Pull Requesting

Before filing, check whether a PR for this branch already exists. Open the PR from the task's feature branch, never from `main`. Review the diff locally against the base branch (usually `origin/main`) to make sure its contents match the goal.

PR titles usually become commit messages, so follow the repository's title conventions. Look at recently merged PRs and Git history for examples. Keep the title simple and easy to understand, and prefer a concise title that explains why the change matters. If the repo has no convention, use a conventional commit subject such as `fix(server): parse CLI version in update preflight`.

BAD ❌

> perf(server): negotiate permessage-deflate on the websocket

GOOD ✅

> perf(server): cut websocket frame size by 70%+ with gzipping

Open the description with a simple explanation of the problem based on the user's original prompt, then briefly explain the solution. Do not lead with an implementation inventory:

BAD ❌

> Removed implicit workspace carry-over from every "new thread" entry point (cmd+n / cmd+shift+o, sidebar v1/v2 buttons, command palette). New threads inherit only the project from context; branch, worktree, and env mode always come from the configured defaults. Deleted buildContextualThreadOptions, startNewThreadInProjectFromContext, and the v1 sidebar's seed-context machinery.

GOOD ✅

> My "new worktree" default was ignored when starting new threads on existing worktrees. Super unintuitive. Now your preferences always apply.

Do not add co-author trailers or mention the model or harness that made the change.

If the branch has not been pushed yet, fetch and rebase it onto the latest base branch (usually `main`) before opening. Once it is pushed, do not force-push; merge the base in, and ask before rewriting published history. A request to open a PR includes pushing the branch.

Before submission, check the title, description, quotes, and attachments for secrets and private details.

Open a real PR rather than a draft. If `gh pr create` fails because the GraphQL rate limit is used up, open it through REST with `gh api repos/<owner>/<repo>/pulls -f title=... -f head=... -f base=... -F body=@<file>`. If the user also asked to babysit it, continue with the `babysit-pr` skill.
