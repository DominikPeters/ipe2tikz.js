# ipe2tikz

Clean-room JavaScript/TypeScript converter from Ipe XML (`.ipe`) documents to
TikZ.

## Installation

```sh
npm install ipe2tikz
```

## CLI usage

```sh
# Convert an Ipe file and write TikZ to stdout
ipe2tikz diagram.ipe

# Write TikZ to a file
ipe2tikz diagram.ipe -o diagram.tex

# Read from stdin
cat diagram.ipe | ipe2tikz

# Select a page or view using 1-based CLI indices
ipe2tikz diagram.ipe --page 2 --view 1 -o page-2-view-1.tex
```

Options:

| Option | Description |
|--------|-------------|
| `-o, --output FILE` | Write TikZ output to `FILE` |
| `--page N` | Convert page `N`; defaults to page 1 |
| `--view N` | Convert view `N` on the selected page |
| `-h, --help` | Show help |

Diagnostics are printed to stderr. Errors exit with status 1; warnings still
emit TikZ and exit successfully.

## Web demo

Build the package, then open or serve the static demo:

```sh
npm run build
python3 -m http.server 8123
```

Then visit `http://localhost:8123/demo/`. The demo imports
`dist/browser/ipe2tikz.js`, runs entirely in the browser, and includes a small
built-in sample.

On pushes to `main`, GitHub Actions builds and deploys the same static demo to
GitHub Pages.

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

## Public API

```ts
import { convertIpeToTikz, parseIpeXml } from "ipe2tikz";

const result = convertIpeToTikz(ipeXmlSource, { page: 0, view: 0 });
```

`convertIpeToTikz(source, options)` returns `{ tikz, diagnostics }`. `page`
and `view` are zero-based indices; omitted `page` defaults to the first page,
and omitted `view` emits all page objects without view-layer filtering.

`parseIpeXml(source)` returns the typed intermediate representation plus parse
diagnostics. The package exports the IR and diagnostic TypeScript types from
`src/ir.ts`, including `IpeDocument`, `IpeObject`, `IpePathCommand`, and
`IpeToTikzDiagnostic`.

## Current implementation status

The converter currently parses Ipe XML into a typed intermediate
representation before emitting TikZ. The supported subset is intentionally
small and fixture-driven:

- document roots with preambles, pages, layers, views, groups, paths, text
  objects, and image metadata,
- inherited top-level object layers, view-based layer filtering, and view layer
  transforms,
- group scopes, clipping paths, and object matrices,
- document stylesheet parsing for color, pen, opacity, dashstyle, textsize,
  textstyle, pathstyle, gradient, and tiling definitions, resolved using Ipe's
  last-stylesheet-wins cascade where applicable,
- stylesheet symbols, simple symbol references, symbol sizes, and
  stroke/fill/pen symbol parameters, plus symbolic arrow sizes,
- path operators `m`, `l`, `h`, Bezier forms of `c`/`q`, `e` ellipses, and
  standalone `a` arcs,
- basic stroke, fill, numeric pen width, dash style, line cap/join,
  `arrows.meta` arrowheads, fill rule, opacity, and object matrix output,
- label text and simple minipage nodes with text size/style handling,
  height/depth metrics, and object transforms,
- structured diagnostics for invalid XML, invalid required attributes,
  unsupported objects, unresolved symbolic colors/pens/opacities/dash
  styles/text sizes/text styles, unsupported path effects, and unsupported path
  operators.

Unsupported path operators are preserved in the IR as unsupported commands and
omitted from TikZ with diagnostics. Image emission, mixed arc paths, general
B-splines, gradients, tilings, exact arrow shape/size mapping, and fuller text
layout handling are future work.

Embedded Ipe bitmaps are parsed as metadata. They currently emit an
`unsupported-image` diagnostic unless a programmatic caller supplies
`imagePath` to map bitmap IDs to existing image files; the CLI and demo do not
extract bitmap files.

Black-box comparison harness:

```sh
npm run compare:ipe -- --input test/fixtures/ipe/polyline.ipe
npm run compare:ipe -- --all
```

The harness converts fixtures, writes TikZ artifacts plus `report.json` and
`report.html` under `artifacts/compare-ipe-import`, and records whether
external renderers such as `iperender` and `pdflatex` are available. On macOS
it also checks the standard `/Applications/Ipe.app/Contents/MacOS/iperender`
location. When both renderers are available, it writes Ipe-rendered and
TikZ-rendered PDFs, rasterizes them to PNG with `pdftoppm`, trims whitespace,
and records an ImageMagick RMSE diff plus a diff PNG when `magick` is
available. Open `report.html` to scan every fixture with the trimmed Ipe and
TikZ PNGs side by side.
