---
name: context-window
description: Use when asked to show the context window, what is in it, how full it is, or what consumes it.
---

# Context Window

Show measured context occupancy with an interactive source breakdown. Keep measured totals, estimated source shares, and unattributed tokens visibly distinct.

## Find the measurement

- Identify the current session before reading logs. In T3, inspect the available thread tools when useful; thread metadata may omit token usage. For Codex, look for the matching JSONL session under `~/.codex/sessions/`. Verify its `session_meta.cwd` and session identity against the current workspace/thread; a workspace can have multiple sessions. Do not select a log merely because it is newest.
- Read only the selected session. Do not print whole logs, private instruction bodies, reasoning content, account details, or credentials. Report safe source labels and counts instead.
- Use the selected request's `last_token_usage` or `token_usage_record.usage` and its session-reported `model_context_window`. Cumulative thread billing and rate-limit percentages are not context occupancy. Cached input remains part of context. Do not add reasoning twice when it is already included in output.
- If reliable telemetry or the configured capacity is missing, show an unknown state. Do not substitute an advertised model limit, guess a percentage, or use an arbitrary file's size as total context usage.

## Build the explorer

For a supported local Codex log, use the bundled dependency-free Node script. Run it from the user's workspace, with absolute paths to the script and selected session:

```sh
node /path/to/context-window/scripts/render.mjs \
  --session /path/to/selected-session.jsonl \
  --before-message INSPECTION_REQUEST_MESSAGE_ID \
  --out .agents/artifacts/YYYY-MM-DD-HH-MM-SS-context-window.html
```

Freeze the report before the user message that triggered the inspection. Capture its message ID and pass `--before-message`; this excludes the inspection prompt, skill reads, tool calls, and rendering work performed afterward. With no selector, the helper uses the latest actual user request, excluding injected instruction/environment messages. On follow-up edits, reuse the original `telemetry.beforeRequest.id` stored in the report rather than moving the boundary to the follow-up.

The displayed total is the last completed recorded measurement before that boundary, not a claim to exact occupancy at the instant before the prompt. If there is no earlier reading, explain that pre-request usage is unavailable; do not use an inspection-time reading or estimate a replacement percentage. This can happen when the first message in a session asks to inspect context. An explicit `--at ISO_TIMESTAMP` selects a historical reading instead; it bypasses the pre-request mode, so label it as historical and do not present it as guaranteed pre-inspection. The command verifies the log's workspace against the current directory; use `--cwd /actual/workspace` when invoking it elsewhere. Keep generated artifacts ignored with an artifact-directory `.gitignore` containing `*`.

The helper reuses [assets/context-window.html](assets/context-window.html). It provides a full-window segmented bar, an expanded occupied-region bar, selectable categories, per-source percentages, input/response switching, and searchable inventory. Agent-instruction files have their own category and inventory tab, separate from skill catalogs, full `SKILL.md` reads, and other files. Recognize supplied instruction headings and successful reads of files such as `AGENT.md`, `AGENTS.md`, `AGENTS.override.md`, `CLAUDE.md`, and `GEMINI.md`; do not infer a read merely from a filename mention. Inventory represents observed session entries, not proof that every entry is still retained after compaction. Do not hard-code this conversation's model, counts, paths, percentages, or catalog.

## Attribution limits

- Show recorded source paths for instruction files, skill catalog entries and reads, other returned files, and conversation attachments. Preserve relative paths as recorded and expand catalog aliases only from explicit skill-root mappings. Do not manufacture a workspace path for inline instructions or filename-only attachments; show “Path not recorded.” Paths should be searchable and visible in source details and inventory. Attachment references do not establish a separate token cost; never embed their payloads or provider IDs.
- The bundled estimator uses `ceil(UTF-8 bytes / 4)` for logged text. It is a rough attribution aid, not model-tokenizer accounting. Show the method and label estimated counts and shares accordingly.
- Count file contents when returned to the model, catalog descriptions when listed, tool definitions when supplied, and tool inputs/results when logged. A file on disk, a registered tool, and a full tool schema are different things. Repeated returned text consumes context repeatedly.
- Keep unitemized startup setup, images, prior opaque reasoning, and encoding/framing differences in an explicit remainder. Do not distribute that remainder among files to make estimates look exact. Leave mixed results bundled when their shares cannot be separated reliably.
- If compaction or incompatible logs prevent reconstruction, preserve the measured total and mark input attribution unavailable. If text estimates exceed the measured input, fall back to unattributed input rather than normalizing guesses to fit.
- Private instructions may be summarized at a high level; never reproduce them or hidden reasoning. Generated HTML must contain source labels and sizes, not raw session messages, tool output, encrypted payloads, or account telemetry.

## Verify and display

Run `node --test scripts/render.test.mjs` from the skill folder after changing its helper. Check that source totals reconcile with the selected input/response totals, percentages use the full-window denominator, and response switching preserves the selected snapshot.

Preview the generated HTML at desktop and mobile widths. In T3, use `html_preview`, then `html_render` to display it inline; do not start a server. Without those tools, provide the HTML file link and state which visual checks could not run. Keep the timestamp visible and call the result a static snapshot, not a live meter.
