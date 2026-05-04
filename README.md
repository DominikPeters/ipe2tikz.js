# ipe2tikz

Clean-room JavaScript/TypeScript converter from Ipe XML (`.ipe`) documents to
TikZ.

This repository is intentionally set up around the public Ipe XML format
documentation, not Ipe implementation source. The initial scope is:

- parse `.ipe` XML files,
- convert common paths, text, groups, layers, and styles to readable TikZ,
- report unsupported Ipe features with diagnostics,
- compare generated output against Ipe command-line rendering as a black-box
  reference.

## Clean-room boundary

Do not copy or inspect Ipe implementation source while implementing converter
logic. The documentation copied under `third_party/ipe-spec` is intended as the
allowed reference set for the XML format and command-line tools.

Allowed references in this repo:

- `third_party/ipe-spec/README.md`
- `third_party/ipe-spec/doc/ipe.dtd`
- `third_party/ipe-spec/manual/*.rst`
- `third_party/ipe-spec/man/*.1`

Avoid using Ipe `src/`, Lua scripts, ipelets, stylesheets, artwork, or existing
Ipe-to-TikZ exporter code as implementation material.

## Development

```sh
npm install
npm run check
npm test
npm run build
```

Future visual comparison harness:

```sh
npm run compare:ipe -- --input test/fixtures/ipe/line.ipe
```
