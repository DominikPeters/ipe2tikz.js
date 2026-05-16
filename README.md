# ipe2tikz

JavaScript/TypeScript converter from Ipe XML (`.ipe`) documents to
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

The converter parses Ipe XML into a typed intermediate representation before
emitting TikZ. The supported subset is fixture-driven and includes:

- document roots with preambles, pages, layers, views, groups, paths, text
  objects, image objects, and bitmap metadata,
- inherited top-level object layers, view-based layer filtering, and view layer
  transforms,
- group scopes, clipping paths, object matrices, and text transforms,
- stylesheet parsing and last-stylesheet-wins resolution for colors, pens,
  opacities, dash styles, text sizes/styles, path styles, symbols, symbol
  sizes, arrow sizes, gradients, and tilings,
- stylesheet symbols and `use` objects, including `sym-stroke`, `sym-fill`,
  `sym-pen`, numeric/symbolic symbol sizes, and unresolved-symbol diagnostics,
- path operators `m`, `l`, `h`, cubic/quadratic Beziers, supported `s`/`C`
  spline forms, `u` closed splines, `L` clothoid splines with Ipe-provided
  Bezier approximations, `e` ellipses, standalone arcs, and mixed arc paths,
  converted to cubic Beziers where needed,
- stroke/fill, numeric and symbolic pen widths, dash styles, line cap/join,
  fill rule, opacity/stroke opacity, object matrices, and approximate
  `arrows.meta` arrowheads with symbolic arrow sizes,
- axial two-color gradient shading and simple line tiling patterns,
- label and minipage nodes with anchors, text size/style handling, opacity,
  width/height/depth metrics, object transforms, and raw LaTeX text content,
- image nodes as `\includegraphics` when a programmatic caller supplies
  `imagePath` to map bitmap IDs to existing image files,
- structured diagnostics for invalid XML, invalid required attributes,
  unsupported objects, unresolved symbolic styles, unsupported path effects,
  unsupported path operators, and unsupported image output.

Unsupported or approximate areas include clothoid `L` path operators without
Ipe-provided Bezier approximations, radial gradients, full gradient
stop/matrix/extend fidelity, exact Ipe tiling fidelity, bitmap
extraction/decoding for the CLI and demo, exact Ipe arrow geometry, full text
layout fidelity, and richer multi-object/special-symbol behavior. Unsupported
operators and effects are preserved or diagnosed where possible and omitted
from TikZ when they cannot be emitted.

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
