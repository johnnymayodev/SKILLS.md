# SKILLS.md

My collection of skills

## Download

Download all the global skills into your current directory:

```bash
(
  set -e
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT

  curl -fsSL https://github.com/johnnymayodev/SKILLS.md/archive/refs/heads/main.tar.gz \
    | tar -xzf - -C "$tmp" --strip-components=2 SKILLS.md-main/skills/global

  for d in "$tmp"/global/*; do
    [ -d "$d" ] || continue
    rm -rf "./$(basename "$d")"
    mv "$d" .
  done
)
```

Re-running the command replaces each global skill folder, so updates and new skills are applied cleanly. Other files in the directory are left untouched.

## Credits

Some skills are copies or adaptations from these sources

- [tstack](https://github.com/t3dotgg/tstack) by [Theo Browne - t3dotgg](https://github.com/t3dotgg)
- [i-have-adhd](https://github.com/ayghri/i-have-adhd) by [Ayoub Ghriss - ayghri](https://github.com/ayghri)
- [andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills) by [multica-ai](https://github.com/multica-ai)