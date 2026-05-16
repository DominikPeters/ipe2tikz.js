import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { convertIpeToTikz, parseIpeXml } from "../src/index.js";

const fixtureDir = join(import.meta.dirname, "fixtures", "ipe");

function fixture(name: string): string {
  return readFileSync(join(fixtureDir, name), "utf8");
}

const advancedFixtures = [
  "advanced-bayes-network.ipe",
  "advanced-control-loop.ipe",
  "advanced-convex-level-sets.ipe",
  "advanced-distributed-trace.ipe",
  "advanced-graph-cut.ipe",
  "advanced-kernel-svm.ipe",
  "advanced-message-passing.ipe",
  "advanced-phase-portrait.ipe",
  "advanced-robot-trajectory.ipe",
  "advanced-type-lattice.ipe"
] as const;

const fidelityFixtures = [
  "fidelity-arrow-grid.ipe",
  "fidelity-arrow-kinds.ipe",
  "fidelity-arrowheads.ipe",
  "fidelity-text-anchors.ipe",
  "fidelity-text-grid.ipe"
] as const;

const hardFixtures = ["hard-composite-science.ipe"] as const;

describe("convertIpeToTikz", () => {
  it("parses Ipe XML into a typed IR", () => {
    const result = parseIpeXml(fixture("polyline.ipe"));

    expect(result.diagnostics).toEqual([]);
    expect(result.document).toMatchObject({
      version: "70200",
      pages: [
        {
          layers: [{ name: "alpha", edit: true, snap: "visible" }],
          views: [],
          objects: [
            {
              kind: "path",
              layer: "alpha",
              pen: { kind: "width", value: 1 },
              commands: [
                { kind: "move", to: { x: 0, y: 0 } },
                { kind: "line", to: { x: 72, y: 0 } },
                { kind: "line", to: { x: 72, y: 36 } }
              ]
            }
          ]
        }
      ]
    });
  });

  it("ignores an XML declaration before the Ipe root", () => {
    const result = parseIpeXml(`<?xml version="1.0"?>\n${fixture("polyline.ipe")}`);

    expect(result.diagnostics).toEqual([]);
    expect(result.document?.version).toBe("70200");
  });

  it("preserves document preamble source in the IR", () => {
    const result = parseIpeXml(fixture("preamble.ipe"));

    expect(result.diagnostics).toEqual([]);
    expect(result.document?.preamble).toContain("\\usepackage{amsmath}");
    expect(result.document?.preamble).toContain("\\newcommand{\\vect}");
  });

  it("converts a stroked polyline path to TikZ", () => {
    const result = convertIpeToTikz(fixture("polyline.ipe"));

    expect(result.diagnostics).toEqual([]);
    expect(result.tikz).toBe(
      "\\begin{tikzpicture}\n" +
        "  \\path[draw=black, line width=1pt] (0pt,0pt) -- (72pt,0pt) -- (72pt,36pt);\n" +
        "\\end{tikzpicture}\n"
    );
  });

  it("converts a filled closed path and label text to TikZ", () => {
    const result = convertIpeToTikz(fixture("polygon-and-text.ipe"));

    expect(result.diagnostics).toEqual([]);
    expect(result.tikz).toContain(
      "  \\path[draw=black, fill={rgb,1:red,1;green,0;blue,0}, line width=0.5pt, even odd rule] (0pt,0pt) -- (36pt,0pt) -- (36pt,36pt) -- (0pt,36pt) -- cycle;"
    );
    expect(result.tikz).toContain("  \\node[anchor=center, inner sep=0pt, text=black] at (18pt,18pt) {Hello $x$};");
  });

  it("resolves symbolic colors and pens through the stylesheet cascade", () => {
    const result = parseIpeXml(fixture("styles.ipe"));

    expect(result.diagnostics).toEqual([]);
    expect(result.document?.stylesheets).toHaveLength(2);
    expect(result.document?.stylesheets[0]?.colors.accent).toEqual({
      kind: "rgb",
      red: 0,
      green: 0.25,
      blue: 1
    });

    const converted = convertIpeToTikz(fixture("styles.ipe"));

    expect(converted.diagnostics).toEqual([]);
    expect(converted.tikz).toContain(
      "  \\path[draw={rgb,1:red,1;green,0.5;blue,0}, line width=2pt] (0pt,0pt) -- (24pt,0pt);"
    );
    expect(converted.tikz).toContain("  \\node[anchor=south west, inner sep=0pt, text={rgb,1:red,1;green,0.5;blue,0}] at (0pt,12pt) {Styled};");
  });

  it("resolves symbolic opacity for paths and text", () => {
    const parsed = parseIpeXml(fixture("opacity.ipe"));

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document?.stylesheets[0]?.opacities.half).toEqual({ kind: "value", value: 0.5 });

    const converted = convertIpeToTikz(fixture("opacity.ipe"));

    expect(converted.diagnostics).toEqual([]);
    expect(converted.tikz).toContain(
      "\\path[draw=black, fill=white, opacity=0.5, draw opacity=0.25] (0pt,0pt) -- (20pt,0pt) -- (20pt,20pt) -- cycle;"
    );
    expect(converted.tikz).toContain("\\node[anchor=south west, inner sep=0pt, text=black, text opacity=0.5] at (0pt,30pt) {Faded};");
  });

  it("converts symbolic and inline dash styles", () => {
    const parsed = parseIpeXml(fixture("dashstyles.ipe"));

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document?.stylesheets[0]?.dashStyles.dottedish).toEqual({
      kind: "pattern",
      pattern: [1, 2],
      phase: 0
    });

    const converted = convertIpeToTikz(fixture("dashstyles.ipe"));

    expect(converted.diagnostics).toEqual([]);
    expect(converted.tikz).toContain("\\path[draw=black, dash pattern=on 1pt off 2pt] (0pt,0pt) -- (20pt,0pt);");
    expect(converted.tikz).toContain(
      "\\path[draw=black, dash pattern=on 3pt off 1pt, dash phase=2pt] (0pt,10pt) -- (20pt,10pt);"
    );
  });

  it("emits line cap and join while diagnosing unsupported path effects", () => {
    const parsed = parseIpeXml(fixture("path-styles-and-effects.ipe"));

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document?.pages[0]?.objects[0]).toMatchObject({
      kind: "path",
      lineCap: "round",
      lineJoin: "bevel",
      arrow: "normal/normal",
      unsupportedEffects: [{ kind: "gradient", value: "fade" }]
    });

    const converted = convertIpeToTikz(fixture("path-styles-and-effects.ipe"));

    expect(converted.tikz).toContain(
      "\\path[draw=black, line cap=round, line join=bevel, -{Stealth[inset=0pt,length=7pt,width=7pt]}] (0pt,0pt) -- (20pt,0pt);"
    );
    expect(converted.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["unsupported-gradient"]);
  });

  it("resolves pathstyle defaults through the stylesheet cascade", () => {
    const parsed = parseIpeXml(fixture("pathstyle.ipe"));

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document?.stylesheets[0]?.pathStyle).toEqual({
      lineCap: "round",
      lineJoin: "round",
      fillRule: "eofill"
    });
    expect(parsed.document?.stylesheets[1]?.pathStyle).toEqual({
      lineJoin: "bevel"
    });

    const converted = convertIpeToTikz(fixture("pathstyle.ipe"));

    expect(converted.diagnostics).toEqual([]);
    expect(converted.tikz).toContain(
      "\\path[draw=black, fill=white, line join=bevel] (0pt,0pt) -- (20pt,0pt) -- (20pt,20pt) -- cycle;"
    );
    expect(converted.tikz).toContain(
      "\\path[draw=black, line cap=butt, line join=bevel, nonzero rule] (30pt,0pt) -- (50pt,0pt) -- (50pt,20pt) -- cycle;"
    );
  });

  it("parses gradient and tiling stylesheet definitions while diagnosing unsupported fill effects", () => {
    const parsed = parseIpeXml(fixture("gradients-and-tilings.ipe"));

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document?.stylesheets[0]?.gradients.fade).toMatchObject({
      name: "fade",
      type: "axial",
      extend: true,
      coords: [0, 0, 20, 0],
      stops: [
        { offset: 0, color: { kind: "rgb", red: 1, green: 0, blue: 0 } },
        { offset: 1, color: { kind: "rgb", red: 0, green: 0, blue: 1 } }
      ]
    });
    expect(parsed.document?.stylesheets[0]?.gradients.spot).toMatchObject({
      name: "spot",
      type: "radial",
      coords: [10, 10, 0, 10, 10, 12],
      stops: [
        { offset: 0, color: { kind: "rgb", red: 1, green: 1, blue: 1 } },
        { offset: 1, color: { kind: "rgb", red: 1, green: 0, blue: 0 } }
      ]
    });
    expect(parsed.document?.stylesheets[0]?.tilings.hatch).toEqual({
      name: "hatch",
      angle: 45,
      step: 6,
      width: 0.5
    });

    const converted = convertIpeToTikz(fixture("gradients-and-tilings.ipe"));

    expect(converted.tikz).toContain(
      "\\path[fill=white, shade, left color={rgb,1:red,1;green,0;blue,0}, right color={rgb,1:red,0;green,0;blue,1}, shading angle=90]"
    );
    expect(converted.tikz).toContain(
      "\\path[fill=white, shade, inner color={rgb,1:red,1;green,1;blue,1}, outer color={rgb,1:red,1;green,0;blue,0}]"
    );
    expect(converted.tikz).toContain(
      "\\path[fill=white, pattern={Lines[angle=45,distance=6pt,line width=0.5pt]}, pattern color=white]"
    );
    expect(converted.diagnostics).toEqual([]);
  });

  it("resolves text sizes and label text styles", () => {
    const parsed = parseIpeXml(fixture("text-styles.ipe"));

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document?.stylesheets[0]?.textSizes.tinyish).toEqual({
      kind: "latex",
      source: "\\scriptsize"
    });
    expect(parsed.document?.stylesheets[0]?.textStyles.bold).toEqual({
      type: "label",
      begin: "\\textbf{",
      end: "}"
    });

    const converted = convertIpeToTikz(fixture("text-styles.ipe"));

    expect(converted.diagnostics).toEqual([]);
    expect(converted.tikz).toContain("\\node[anchor=south west, inner sep=0pt, text=black, font={\\scriptsize}] at (0pt,0pt) {\\textbf{Styled}};");
    expect(converted.tikz).toContain(
      "\\node[anchor=south west, inner sep=0pt, text=black, font={\\fontsize{14pt}{16.8pt}\\selectfont}] at (0pt,12pt) {Numeric};"
    );
  });

  it("assigns inherited object layers and filters/applies transforms for selected views", () => {
    const parsed = parseIpeXml(fixture("layers-and-views.ipe"));

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document?.pages[0]?.objects.map((object) => object.layer)).toEqual(["alpha", "beta", "beta"]);
    expect(parsed.document?.pages[0]?.views[1]?.layerTransforms.beta).toEqual([1, 0, 0, 1, 10, 20]);

    const alphaOnly = convertIpeToTikz(fixture("layers-and-views.ipe"), { view: 0 });
    expect(alphaOnly.diagnostics).toEqual([]);
    expect(alphaOnly.tikz).toContain("(0pt,0pt) -- (10pt,0pt)");
    expect(alphaOnly.tikz).not.toContain("(0pt,10pt) -- (10pt,10pt)");
    expect(alphaOnly.tikz).not.toContain("Inherited beta");

    const both = convertIpeToTikz(fixture("layers-and-views.ipe"), { view: 1 });
    expect(both.diagnostics).toEqual([]);
    expect(both.tikz).toContain("\\begin{scope}[cm={1,0,0,1,(10pt,20pt)}]");
    expect(both.tikz).toContain("(0pt,10pt) -- (10pt,10pt)");
    expect(both.tikz).toContain("Inherited beta");
  });

  it("emits group scopes and object transforms", () => {
    const result = convertIpeToTikz(fixture("groups-and-transforms.ipe"));

    expect(result.diagnostics).toEqual([]);
    expect(result.tikz).toContain("\\begin{scope}[cm={1,0,0,1,(10pt,20pt)}]");
    expect(result.tikz).toContain(
      "\\path[cm={0,-1,1,0,(0pt,0pt)}, draw=black] (0pt,0pt) -- (10pt,0pt);"
    );
    expect(result.tikz).toContain("\\node[anchor=south west, inner sep=0pt, text=black] at (5pt,5pt) {Grouped};");
  });

  it("parses stylesheet symbols and expands simple use objects", () => {
    const parsed = parseIpeXml(fixture("symbols.ipe"));

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document?.stylesheets[0]?.symbols["mark/disk"]).toMatchObject({
      name: "mark/disk",
      object: { kind: "path" }
    });
    expect(parsed.document?.pages[0]?.objects[0]).toMatchObject({
      kind: "use",
      name: "mark/disk",
      position: { x: 10, y: 20 }
    });

    const converted = convertIpeToTikz(fixture("symbols.ipe"));

    expect(converted.tikz).toContain("\\begin{scope}[shift={(10pt,20pt)}]");
    expect(converted.tikz).toContain("\\path[cm={2,0,0,2,(0pt,0pt)}, draw=black, fill=black] (0pt,0pt) circle [radius=1pt];");
    expect(converted.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["unsupported-symbol"]);
  });

  it("expands parameterized symbols with use stroke, fill, pen, and numeric size", () => {
    const result = convertIpeToTikz(fixture("parameterized-symbols.ipe"));

    expect(result.diagnostics).toEqual([]);
    expect(result.tikz).toContain("\\begin{scope}[shift={(10pt,20pt)}, scale=2]");
    expect(result.tikz).toContain("\\begin{scope}[shift={(30pt,20pt)}, scale=3]");
    expect(result.tikz).toContain(
      "\\path[draw={rgb,1:red,1;green,0;blue,0}, fill={rgb,1:red,0;green,1;blue,0}, line width=1.5pt] (-2pt,-2pt) -- (2pt,-2pt) -- (2pt,2pt) -- (-2pt,2pt) -- cycle;"
    );
    expect(result.tikz).toContain(
      "\\path[draw=black, fill=white, line width=0.5pt] (-2pt,-2pt) -- (2pt,-2pt) -- (2pt,2pt) -- (-2pt,2pt) -- cycle;"
    );
  });

  it("emits supported group clipping paths", () => {
    const parsed = parseIpeXml(fixture("clipping.ipe"));

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document?.pages[0]?.objects[0]).toMatchObject({
      kind: "group",
      clip: [
        { kind: "move", to: { x: 0, y: 0 } },
        { kind: "line", to: { x: 10, y: 0 } },
        { kind: "line", to: { x: 10, y: 10 } },
        { kind: "line", to: { x: 0, y: 10 } },
        { kind: "close" }
      ]
    });

    const converted = convertIpeToTikz(fixture("clipping.ipe"));

    expect(converted.diagnostics).toEqual([]);
    expect(converted.tikz).toContain("\\clip (0pt,0pt) -- (10pt,0pt) -- (10pt,10pt) -- (0pt,10pt) -- cycle;");
    expect(converted.tikz).toContain("\\path[draw=black] (-5pt,5pt) -- (15pt,5pt);");
  });

  it("selects pages and emits minipage text width", () => {
    const parsed = parseIpeXml(fixture("multipage-and-minipage.ipe"));

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document?.pages.map((page) => page.title)).toEqual(["first", "second"]);

    const first = convertIpeToTikz(fixture("multipage-and-minipage.ipe"), { page: 0 });
    expect(first.diagnostics).toEqual([]);
    expect(first.tikz).toContain("\\path[draw=black] (0pt,0pt) -- (10pt,0pt);");
    expect(first.tikz).not.toContain("Line one");

    const second = convertIpeToTikz(fixture("multipage-and-minipage.ipe"), { page: 1 });
    expect(second.diagnostics).toEqual([]);
    expect(second.tikz).toContain(
      "\\node[anchor=north west, inner sep=0pt, text=black, text width=48pt] at (0pt,0pt) {Line one\\\\Line two};"
    );
  });

  it("parses image metadata and emits includegraphics when an image path resolver is provided", () => {
    const parsed = parseIpeXml(fixture("images.ipe"));

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document?.bitmaps["1"]).toMatchObject({
      width: 1,
      height: 1,
      colorSpace: "DeviceGray",
      data: "00"
    });
    expect(parsed.document?.pages[0]?.objects[0]).toMatchObject({
      kind: "image",
      rect: [0, 0, 10, 20],
      bitmap: "1"
    });

    const converted = convertIpeToTikz(fixture("images.ipe"), { imagePath: (bitmapId) => `images/${bitmapId}.pgm` });

    expect(converted.tikz).toContain(
      "\\node[anchor=south west, inner sep=0pt] at (0pt,0pt) {\\includegraphics[width=10pt,height=20pt]{images/1.pgm}};"
    );
    expect(converted.diagnostics).toEqual([]);
  });

  it("reports unsupported path operators without failing the whole conversion", () => {
    const result = convertIpeToTikz(
      "<ipe version=\"70200\"><page><path stroke=\"black\">0 0 m 1 0 1 1 0 1 -1 1 L</path></page></ipe>"
    );

    expect(result.tikz).toBe("\\begin{tikzpicture}\n  \\path[draw=black] (0pt,0pt);\n\\end{tikzpicture}\n");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "unsupported-path-operator",
      "omitted-path-operator"
    ]);
  });

  it("converts clothoid path operators when Ipe provides a Bezier approximation", () => {
    const result = convertIpeToTikz(
      "<ipe version=\"70200\"><page><path stroke=\"black\">0 0 m 10 0 20 10 * 10 0 20 10 30 0 L</path></page></ipe>"
    );
    const resultWithRepeatedStart = convertIpeToTikz(
      "<ipe version=\"70200\"><page><path stroke=\"black\">0 0 m 10 0 20 10 * 0 0 10 0 20 10 30 0 L</path></page></ipe>"
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.tikz).toContain(
      "\\path[draw=black] (0pt,0pt) .. controls (10pt,0pt) and (20pt,10pt) .. (30pt,0pt);"
    );
    expect(resultWithRepeatedStart.diagnostics).toEqual([]);
    expect(resultWithRepeatedStart.tikz).toBe(result.tikz);
  });

  it("converts closed uniform spline path operators into cubic Bezier loops", () => {
    const result = convertIpeToTikz(
      "<ipe version=\"70200\"><page><path stroke=\"black\">0 0 30 0 30 30 0 30 u</path></page></ipe>"
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.tikz).toContain(
      "\\path[draw=black] (25pt,5pt) .. controls (30pt,10pt) and (30pt,20pt) .. (25pt,25pt) .. controls (20pt,30pt) and (10pt,30pt) .. (5pt,25pt) .. controls (0pt,20pt) and (0pt,10pt) .. (5pt,5pt) .. controls (10pt,0pt) and (20pt,0pt) .. (25pt,5pt) -- cycle;"
    );
  });

  it("converts cubic and quadratic Bezier path segments", () => {
    const result = convertIpeToTikz(fixture("beziers.ipe"));

    expect(result.diagnostics).toEqual([]);
    expect(result.tikz).toContain(
      "\\path[draw=black] (0pt,0pt) .. controls (10pt,20pt) and (20pt,20pt) .. (30pt,0pt) .. controls (36.666667pt,-13.333333pt) and (43.333333pt,-13.333333pt) .. (50pt,0pt);"
    );
  });

  it("converts mixed arc operators into cubic Bezier path segments", () => {
    const result = convertIpeToTikz(
      "<ipe version=\"70200\"><page><path stroke=\"black\">30 0 m 30 0 0 30 0 0 0 30 a 0 30 l</path></page></ipe>"
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.tikz).toContain(
      "\\path[draw=black] (30pt,0pt) .. controls (30pt,16.568542pt) and (16.568542pt,30pt) .. (0pt,30pt) -- (0pt,30pt);"
    );
  });

  it("converts multi-point uniform and cardinal splines into cubic Bezier chains", () => {
    const result = convertIpeToTikz(
      "<ipe version=\"70200\"><page><path stroke=\"black\">0 0 m 10 30 20 30 30 0 40 10 c 50 10 60 30 70 10 0.5 C</path></page></ipe>"
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.tikz).toContain(".. controls");
    expect(result.tikz).toContain("(70pt,10pt)");
  });

  it("converts deprecated q path operators as Bezier segments", () => {
    const result = convertIpeToTikz(fixture("deprecated-q.ipe"));

    expect(result.diagnostics).toEqual([]);
    expect(result.tikz).toContain(
      "\\path[draw=black] (0pt,0pt) .. controls (6.666667pt,13.333333pt) and (13.333333pt,13.333333pt) .. (20pt,0pt);"
    );
  });

  it("converts ellipse path operators as transformed unit circles", () => {
    const result = convertIpeToTikz(fixture("ellipses.ipe"));

    expect(result.tikz).toContain(
      "\\path[cm={10,0,0,5,(20pt,30pt)}, draw=black, fill=black!20] (0pt,0pt) circle [radius=1pt];"
    );
    expect(result.tikz).toContain(
      "\\path[cm={10,3,0,5,(0pt,0pt)}, draw=black] (0pt,0pt) circle [radius=1pt];"
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("converts standalone arc path operators as transformed unit arcs", () => {
    const parsed = parseIpeXml(fixture("arcs.ipe"));

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document?.pages[0]?.objects[0]).toMatchObject({
      kind: "path",
      commands: [
        { kind: "move", to: { x: 30, y: 0 } },
        { kind: "arc", matrix: [30, 0, 0, 30, 0, 0], to: { x: 0, y: 30 } }
      ]
    });

    const result = convertIpeToTikz(fixture("arcs.ipe"));

    expect(result.diagnostics).toEqual([]);
    expect(result.tikz).toContain(
      "\\path[cm={30,0,0,30,(0pt,0pt)}, draw=black, -{Stealth[inset=0pt,length=7pt,width=7pt]}] (1pt,0pt) arc[start angle=0, end angle=90, radius=1pt];"
    );
  });

  it.each(advancedFixtures)("converts richer scientific fixture %s without diagnostics", (name) => {
    const source = fixture(name);
    const parsed = parseIpeXml(source);
    expect(parsed.diagnostics).toEqual([]);
    expect((source.match(/<(path|text|group|use)\b/gu) ?? []).length).toBeGreaterThan(5);

    const converted = convertIpeToTikz(source, { view: parsed.document?.pages[0]?.views.length ? 0 : undefined });
    expect(converted.diagnostics).toEqual([]);
    expect(converted.tikz).toContain("\\begin{tikzpicture}");
    expect(converted.tikz).toContain("\\path");
  });

  it.each(fidelityFixtures)("converts zoomed fidelity fixture %s without diagnostics", (name) => {
    const source = fixture(name);
    const parsed = parseIpeXml(source);
    expect(parsed.diagnostics).toEqual([]);

    const converted = convertIpeToTikz(source);
    expect(converted.diagnostics).toEqual([]);
    expect(converted.tikz).toContain("\\begin{tikzpicture}");
    expect(converted.tikz).toContain("\\path");
  });

  it.each(hardFixtures)("converts hard visual fixture %s without diagnostics", (name) => {
    const source = fixture(name);
    const parsed = parseIpeXml(source);
    expect(parsed.diagnostics).toEqual([]);

    const converted = convertIpeToTikz(source, { imagePath: (bitmapId) => `fixtures/${bitmapId}.png` });
    expect(converted.diagnostics).toEqual([]);
    expect(converted.tikz).toContain("\\includegraphics");
    expect(converted.tikz).toContain("shade");
    expect(converted.tikz).toContain("pattern={Lines");
  });

  it("parses text metrics while letting TikZ anchor ordinary labels to their natural text boxes", () => {
    const parsed = parseIpeXml(fixture("fidelity-text-grid.ipe"));

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document?.pages[0]?.objects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "text",
          text: "bottom",
          height: 13,
          depth: 4
        })
      ])
    );

    const converted = convertIpeToTikz(fixture("fidelity-text-grid.ipe"));
    expect(converted.diagnostics).toEqual([]);
    expect(converted.tikz).toContain(
      "\\node[anchor=south west, inner sep=0pt, text=black, font={\\fontsize{18pt}{21.6pt}\\selectfont}] at (20pt,70pt) {bottom};"
    );
    expect(converted.tikz).toContain(
      "\\node[anchor=center, inner sep=0pt, text=black, font={\\fontsize{18pt}{21.6pt}\\selectfont}] at (115pt,70pt) {center};"
    );
    expect(converted.tikz).toContain(
      "\\begin{scope}[cm={0.866,0.5,-0.5,0.866,(0pt,0pt)}]"
    );
    expect(converted.tikz).toContain(
      "\\node[anchor=south west, inner sep=0pt, text=black, transform shape, font={\\fontsize{18pt}{21.6pt}\\selectfont}] at (160pt,10pt) {rot};"
    );
  });

  it("calibrates bottom and baseline text anchors without TikZ node padding", () => {
    const converted = convertIpeToTikz(fixture("fidelity-text-anchors.ipe"));

    expect(converted.diagnostics).toEqual([]);
    expect(converted.tikz).toContain(
      "\\node[anchor=south west, inner sep=0pt, text=black, font={\\fontsize{24pt}{28.8pt}\\selectfont}] at (35pt,70pt) {g};"
    );
    expect(converted.tikz).toContain(
      "\\node[anchor=base east, inner sep=0pt, text=black, font={\\fontsize{24pt}{28.8pt}\\selectfont}] at (145pt,30pt) {g};"
    );
  });

  it("resolves symbolic Ipe arrow sizes into TikZ arrow tip dimensions", () => {
    const parsed = parseIpeXml(fixture("fidelity-arrow-grid.ipe"));

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document?.stylesheets[0]?.arrowSizes).toMatchObject({
      small: 4,
      normal: 7,
      large: 12
    });

    const converted = convertIpeToTikz(fixture("fidelity-arrow-grid.ipe"));
    expect(converted.diagnostics).toEqual([]);
    expect(converted.tikz).toContain(
      "\\path[draw={rgb,1:red,0.02;green,0.16;blue,0.24}, line width=1pt, -{Stealth[inset=0pt,length=4pt,width=4pt]}] (20pt,95pt) -- (160pt,95pt);"
    );
    expect(converted.tikz).toContain(
      "\\path[draw={rgb,1:red,0.02;green,0.16;blue,0.24}, line width=1pt, {Stealth[inset=0pt,length=12pt,width=12pt]}-{Stealth[inset=0pt,length=4pt,width=4pt]}] (20pt,20pt) -- (160pt,20pt);"
    );
  });

  it("maps pointed and white-filled Ipe arrow variants to configurable TikZ tips", () => {
    const converted = convertIpeToTikz(fixture("fidelity-arrowheads.ipe"));

    expect(converted.diagnostics).toEqual([]);
    expect(converted.tikz).toContain(
      "\\path[draw={rgb,1:red,0.02;green,0.16;blue,0.24}, line width=1pt, -{Stealth[inset=4.4pt,length=22pt,width=22pt]}] (35pt,12pt) -- (85pt,12pt);"
    );
    expect(converted.tikz).toContain(
      "\\path[draw={rgb,1:red,0.02;green,0.16;blue,0.24}, line width=1pt, -{Stealth[inset=0pt,length=14pt,width=14pt,fill=white]}] (105pt,12pt) -- (155pt,12pt);"
    );
  });
});
