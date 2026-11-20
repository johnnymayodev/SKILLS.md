---
name: no-comments
description: "Replace comments that state rules with enforced checks (lint, tests, CI) and delete comment noise. Use when writing or editing code, when tempted to add a comment, or when the user runs /no-comments or asks to clean up comments."
---

# No comments

A rule written in a comment is a rule nothing enforces. Turn those rules into checks the project runs, and delete the comments. Delete noise comments along the way.

## While coding

This applies whenever you write or edit code, even if `/no-comments` was not run.

- Do not write narration, banners, or commented-out code.
- Do not write a comment to state a rule such as "do not remove", "keep in sync with X", or "must be called before Y". Propose a check that enforces it instead, following the approval rules below.
- Allowed: license headers, doc comments on public APIs, and notes on behavior forced by something outside our code, such as a dependency, platform, vendor, or protocol.

## Scope

When run as `/no-comments`, use the caller's files or diff. Otherwise use the current diff against the base branch, default `main`, including the working tree. Deletions and new checks come from comments in scope. Reading the rest of the repo is allowed and expected.

Never change application code. New checks live in lint config, lint rules, tests, or CI. If the only good encoding needs an application-code change, such as a new type, flag it and leave the code alone.

## Pass 1: Sort the comments

Put every comment in scope into one bucket.

- **Keep:** license and legal headers, doc comments on public APIs, `// prettier-ignore`, issue or RFC links, and notes on behavior forced by something outside our code. A note about a surprise in our own code is not a keep. Delete it and flag the symbol as needing a clearer name or shape.
- **Rule:** the comment states a constraint, such as "do not remove", "do not change wording", "talk to X before changing", "keep in sync with", or "must run before". `IMPORTANT` and long justifications usually belong here.
- **Suppression:** `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, and similar. Look up the rule. Keep the suppression if the rule is wrong, pedantic, or style-only. Otherwise flag the suppressed code. Do not remove the suppression, because the lint would then fail.
- **Noise:** everything else. Delete it.

If a comment claims a rule of something outside our code, check that thing's docs or source. If the claim is false or not ours, it is noise. If you cannot check it, keep it and list it under `REVIEW`, quoted word for word.

If a claim is not obvious from nearby code, trace the symbol it names, run `/why` from the **why** skill, or both.

## Pass 2: Audit

Re-read the buckets and the diff before acting.

- Undo any change to application code, any edit outside scope, and any deletion of a keep.
- A keep survives only with evidence it is about something we cannot change. If the evidence is refuted or ambiguous, move it to noise or rule.
- A flag must name code in scope and a problem it has today. Drop flags that do not.
- Check for suppressions you missed.
- If the audit finds a pass was wrong, redo that part once. If it is still wrong, report it as open.

## Pass 3: Encode the rules

1. Group the rule comments by the rule they state, not their wording.
2. For each group, search the whole repo for other comments stating the same rule. Record each match by file and line.
3. Pick the cheapest check that enforces the rule. Prefer, in order: a rule the project's linter or type checker already has, a test, then new rule code or a CI check script. When the group has matches across the repo, the check covers all of them.
4. The check must pass on the whole repo today. If it would flag code outside scope, narrow it or report the violations. Never fix them.
5. If no reasonable check can enforce the rule, delete the comment and report it as unenforced.
6. Propose each check before adding it. A proposal names the rule, where the check lives, whether it is existing config or new code, the comments it replaces, and the matches outside scope it covers. Wait for approval. Unattended runs need approval given up front.
7. If approved, add the check, run it to prove it passes, then delete the comments in scope. Delete matches outside scope only if the approval says to. Otherwise list them as enforced and safe to delete.
8. If not approved, delete the comments in scope and report the rule as unenforced.

## Report

- Comments deleted, by bucket.
- Checks proposed, approved, and added, with proof that each passes.
- Matching comments outside scope that are now enforced.
- Rules left unenforced.
- Flagged code: our-code surprises and suppressed code, one line each.
- `REVIEW` keeps with the rule each claims.
- Anything redone or left open by the audit.
