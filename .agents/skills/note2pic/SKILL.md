---
name: note2pic
description: Convert Chinese copy into a paginated Xiaohongshu-style image set using the repository's local Note2Pic CLI. Use when asked to turn a headline and article, parenting or lifestyle copy, notes, or a social-media carousel into cover, body, and ending PNG images.
---

# Note2pic

Generate the copy first. Keep the title readable, preserve paragraph breaks in the body, and use `<c:#RRGGBB>...</c>` or `<s:N>...</s>` only for deliberate emphasis.

Use a lowercase ASCII `titleDir` composed of letters, digits, `_`, and `-`. Write this request shape to a temporary JSON file:

```json
{"titleDir":"topic-slug","headline":"封面主标题","content":"完整正文"}
```

From the repository root, use Node 20 (run `nvm use` when available), build when `dist/src/cli.js` is absent or stale, then run:

```sh
npm run build
npm run render -- --input <request-json> --pretty
```

Read the JSON manifest from standard output and return the generated file paths. Do not start the HTTP or MCP server. Use `npm run validate -- --input <request-json>` before rendering when templates or fonts may be missing.
