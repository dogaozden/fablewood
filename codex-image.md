---
name: gen-image
description: Generate or edit images with OpenAI's gpt-image-2 by shelling out to Codex CLI. Use whenever the user asks to generate, create, draw, or edit an image, icon, illustration, diagram art, or visual asset.
---

# Generate images via Codex CLI (gpt-image-2)

Codex CLI ships an `imagegen` skill backed by gpt-image-2. It works with a
ChatGPT-account login — no OpenAI API key required. Invoke it
non-interactively with `codex exec` from Bash.

## Preflight (fail fast, don't guess)

1. `codex --version` — if missing, stop and tell the user to install:
   `npm install -g @openai/codex` (or `brew install codex`).
2. `codex login status` — if not logged in, stop and tell the user to run
   `codex login` in their own terminal (it opens a browser; can't be done
   from here).

## Generate

1. `mkdir -p ./images`
2. Run ONE non-interactive command (never bare `codex` — it needs a TTY):

```bash
codex exec -C "$(pwd)" -s workspace-write --skip-git-repo-check \
  "Use your image generation skill (gpt-image-2) to generate: <DETAILED PROMPT — subject, style, composition, colors, size>. Save the final PNG to ./images/<slug>.png. Do not ask clarifying questions; make reasonable choices."
```

3. Verify the file exists (`ls -la ./images/`) and Read the PNG to confirm
   it matches the request before reporting success.
4. Expect roughly a minute per image. Time out no lower than 5 minutes.

## Edits

To edit an existing image, include its path in the prompt:
"Edit ./images/logo.png: make the background navy... save to ./images/logo-v2.png".

## Notes and limits

- Codex saves to `~/.codex/generated_images/` unless the prompt explicitly
  says where to save — always specify the output path.
- gpt-image-2 has no transparent-background mode. For transparency, generate
  on a flat #00ff00 background and chroma-key it out (Codex's imagegen skill
  knows this workaround — ask for "transparent PNG" and let it handle it).
- If `~/.codex` permission errors appear on first run:
  `sudo chown -R $(whoami) ~/.codex`.
