# Testing Strategy

The converter should be tested at three levels.

1. Structural tests: parse `.ipe` XML fixtures, convert to TikZ, and assert
   semantic facts such as path count, coordinates, styles, text, transforms, and
   diagnostics.

2. Snapshot tests: snapshot generated TikZ and diagnostics for small fixtures so
   readable output does not drift accidentally.

3. Visual black-box tests: render the source `.ipe` file with Ipe command-line
   tools such as `iperender`, render generated TikZ with a TikZ/SVG renderer, and
   write side-by-side artifacts plus a JSON report.

The visual harness should treat Ipe as an external executable. It should not
read Ipe implementation source.
