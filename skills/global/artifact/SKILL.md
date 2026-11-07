---
name: artifact
description: Use when asked to OR you need to build a file that may be updated in following messages from the user.
---

# Artifact

An artifact is a temporary file. It can be code, it can be markdown, it can be any text based file. 

## Details

- When the user asks to mock up an HTML page or sends a large chunk of text or file that needs a small update, an artifact should be used. 
- An artifact will be used so that the agent does not need to send back and forth a full file, but rather the user can just view this one file that the agent is editing.
- Let's say the user asks to mock up a simple HTML page for something. Rather than sending back the full HTML in the chat, we create an artifact and send a preview of that artifact to the user. This is so that if the user asks for a small or large or just any change, we can just edit that artifact directly rather than resending the full file in the chat.

## Storing

- Artifacts should be name descriptively in `.agents/artifacts/` at the project root, creating the directory if needed. The beginning of the file name should start with a date and timestamp. Example: `2026-10-28-18-44-12-descriptive-name-of-artifact.md` or `2026-11-03-12-47-02-descriptive-name-of-artifact.html`
- Make sure that the `.agents/artifacts/` folder is ignored by Git. To do this, put a .gitignore file in the `.agents/artifacts/` folder that just has an asterisk in it. This .gitignore file should just exclude specifically the `.agents/artifacts/` folder from git, not the entire `.agents/` folder.
