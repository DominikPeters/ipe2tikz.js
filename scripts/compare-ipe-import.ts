import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

import { convertIpeToTikz, parseIpeXml } from "../src/index.js";

const { values } = parseArgs({
  options: {
    input: { type: "string" },
    all: { type: "boolean", default: false },
    outDir: { type: "string", default: "artifacts/compare-ipe-import" }
  },
  allowPositionals: true
});

if (!values.input && !values.all) {
  console.error("Usage: npm run compare:ipe -- --input test/fixtures/ipe/line.ipe");
  process.exitCode = 1;
} else {
  const outDir = resolve(values.outDir);
  mkdirSync(outDir, { recursive: true });

  const inputs = values.all ? fixtureInputs() : [resolve(values.input)];
  const tools = {
    iperender: findExecutable("iperender"),
    pdflatex: findExecutable("pdflatex"),
    pdftoppm: findExecutable("pdftoppm"),
    magick: findExecutable("magick")
  };

  const reports = inputs.map((input) => {
    const source = readText(input);
    const parsed = parseIpeXml(source);
    const selectedView = parsed.document?.pages[0]?.views.length ? 0 : undefined;
    const conversion = convertIpeToTikz(source, { view: selectedView });
    const stem = basename(input, ".ipe");
    const tikzPath = join(outDir, `${stem}.tikz`);
    writeFileSync(tikzPath, conversion.tikz);
    const tikzRender = renderTikz(stem, conversion.tikz, parsed.document?.preamble, outDir, tools.pdflatex);
    const ipeRender = renderIpe(stem, input, outDir, tools.iperender, selectedView);

    return {
      input,
      selectedView,
      tikzPath,
      tikzRender,
      ipeRender,
      imageDiff: compareRenderedPdfs(stem, outDir, ipeRender, tikzRender, tools.pdftoppm, tools.magick),
      diagnostics: conversion.diagnostics,
      tools,
      visualComparison:
        ipeRender.status === "rendered" && tikzRender.status === "rendered"
          ? tools.pdftoppm && tools.magick
            ? "compared"
            : "skipped-missing-image-tools"
          : "skipped-missing-renderer"
    };
  });

  const reportPath = join(outDir, "report.json");
  const generatedAt = new Date().toISOString();
  writeFileSync(reportPath, `${JSON.stringify({ generatedAt, reports }, null, 2)}\n`);
  const htmlPath = join(outDir, "report.html");
  writeFileSync(htmlPath, htmlReport({ generatedAt, reports }, htmlPath));
  console.log(`Wrote ${reports.length} comparison report(s) to ${reportPath}`);
  console.log(`Wrote HTML comparison report to ${htmlPath}`);
}

type ComparisonReport = {
  generatedAt: string;
  reports: Array<{
    input: string;
    selectedView: number | undefined;
    tikzPath: string;
    tikzRender: ReturnType<typeof renderTikz>;
    ipeRender: ReturnType<typeof renderIpe>;
    imageDiff: ReturnType<typeof compareRenderedPdfs>;
    diagnostics: ReturnType<typeof convertIpeToTikz>["diagnostics"];
    tools: Record<string, string | undefined>;
    visualComparison: string;
  }>;
};

function fixtureInputs(): string[] {
  const fixtureDir = resolve("test/fixtures/ipe");
  return readdirSync(fixtureDir)
    .filter((name) => name.endsWith(".ipe"))
    .sort()
    .map((name) => join(fixtureDir, name));
}

function readText(path: string): string {
  return readFileSync(path, "utf8");
}

function findExecutable(name: string): string | undefined {
  const result = spawnSync("which", [name], { encoding: "utf8" });
  if (result.status === 0) {
    return result.stdout.trim();
  }

  const macAppFallbacks: Record<string, string> = {
    iperender: "/Applications/Ipe.app/Contents/MacOS/iperender",
    ipetoipe: "/Applications/Ipe.app/Contents/MacOS/ipetoipe",
    ipe: "/Applications/Ipe.app/Contents/MacOS/ipe"
  };
  const fallback = macAppFallbacks[name];
  if (fallback && spawnSync("test", ["-x", fallback]).status === 0) {
    return fallback;
  }

  return undefined;
}

function renderIpe(
  stem: string,
  input: string,
  outDir: string,
  iperender: string | undefined,
  viewIndex: number | undefined
):
  | { status: "skipped"; reason: "missing-iperender" }
  | { status: "rendered"; pdfPath: string; logPath: string }
  | { status: "failed"; pdfPath: string; logPath: string; exitCode: number | null } {
  if (!iperender) {
    return { status: "skipped", reason: "missing-iperender" };
  }

  const pdfPath = join(outDir, `${stem}.ipe.pdf`);
  const logPath = join(outDir, `${stem}.iperender.log`);
  const args = ["-pdf"];
  if (viewIndex !== undefined) {
    args.push("-view", String(viewIndex + 1));
  }
  args.push(input, pdfPath);
  const result = spawnSync(iperender, args, {
    encoding: "utf8",
    timeout: 30_000
  });
  writeFileSync(logPath, `${result.stdout ?? ""}${result.stderr ?? ""}`);

  if (result.status === 0) {
    return { status: "rendered", pdfPath, logPath };
  }

  return { status: "failed", pdfPath, logPath, exitCode: result.status };
}

function renderTikz(
  stem: string,
  tikz: string,
  preamble: string | undefined,
  outDir: string,
  pdflatex: string | undefined
):
  | { status: "skipped"; reason: "missing-pdflatex" }
  | { status: "rendered"; texPath: string; pdfPath: string; logPath: string }
  | { status: "failed"; texPath: string; logPath: string; exitCode: number | null } {
  if (!pdflatex) {
    return { status: "skipped", reason: "missing-pdflatex" };
  }

  const texPath = join(outDir, `${stem}.tex`);
  const pdfPath = join(outDir, `${stem}.pdf`);
  const logPath = join(outDir, `${stem}.pdflatex.log`);
  writeFileSync(texPath, standaloneTikzDocument(tikz, preamble));

  const result = spawnSync(
    pdflatex,
    ["-interaction=nonstopmode", "-halt-on-error", "-file-line-error", basename(texPath)],
    { cwd: outDir, encoding: "utf8", timeout: 30_000 }
  );
  writeFileSync(logPath, `${result.stdout ?? ""}${result.stderr ?? ""}`);

  if (result.status === 0) {
    return { status: "rendered", texPath, pdfPath, logPath };
  }

  return { status: "failed", texPath, logPath, exitCode: result.status };
}

function compareRenderedPdfs(
  stem: string,
  outDir: string,
  ipeRender: ReturnType<typeof renderIpe>,
  tikzRender: ReturnType<typeof renderTikz>,
  pdftoppm: string | undefined,
  magick: string | undefined
):
  | { status: "skipped"; reason: "missing-render" | "missing-image-tools" }
  | {
      status: "compared";
      ipePngPath: string;
      tikzPngPath: string;
      trimmedIpePngPath: string;
      trimmedTikzPngPath: string;
      diffPngPath: string;
      rmse: number;
      normalizedRmse: number;
    }
  | { status: "failed"; reason: string; exitCode: number | null } {
  if (ipeRender.status !== "rendered" || tikzRender.status !== "rendered") {
    return { status: "skipped", reason: "missing-render" };
  }
  if (!pdftoppm || !magick) {
    return { status: "skipped", reason: "missing-image-tools" };
  }

  const ipePrefix = join(outDir, `${stem}.ipe`);
  const tikzPrefix = join(outDir, `${stem}.tikz`);
  const ipePngPath = `${ipePrefix}.png`;
  const tikzPngPath = `${tikzPrefix}.png`;
  const trimmedIpePngPath = join(outDir, `${stem}.ipe.trim.png`);
  const trimmedTikzPngPath = join(outDir, `${stem}.tikz.trim.png`);
  const diffPngPath = join(outDir, `${stem}.diff.png`);

  const ipeRaster = spawnSync(pdftoppm, ["-singlefile", "-png", "-r", "144", ipeRender.pdfPath, ipePrefix], {
    encoding: "utf8",
    timeout: 30_000
  });
  if (ipeRaster.status !== 0) {
    return { status: "failed", reason: `Failed to rasterize Ipe PDF: ${ipeRaster.stderr}`, exitCode: ipeRaster.status };
  }

  const tikzRaster = spawnSync(pdftoppm, ["-singlefile", "-png", "-r", "144", tikzRender.pdfPath, tikzPrefix], {
    encoding: "utf8",
    timeout: 30_000
  });
  if (tikzRaster.status !== 0) {
    return { status: "failed", reason: `Failed to rasterize TikZ PDF: ${tikzRaster.stderr}`, exitCode: tikzRaster.status };
  }

  const trimIpe = trimImage(magick, ipePngPath, trimmedIpePngPath);
  if (trimIpe.status !== 0) {
    return { status: "failed", reason: `Failed to trim Ipe PNG: ${trimIpe.stderr}`, exitCode: trimIpe.status };
  }
  const trimTikz = trimImage(magick, tikzPngPath, trimmedTikzPngPath);
  if (trimTikz.status !== 0) {
    return { status: "failed", reason: `Failed to trim TikZ PNG: ${trimTikz.stderr}`, exitCode: trimTikz.status };
  }

  const comparison = spawnSync(magick, ["compare", "-metric", "RMSE", trimmedIpePngPath, trimmedTikzPngPath, diffPngPath], {
    encoding: "utf8",
    timeout: 30_000
  });
  if (comparison.status !== 0 && comparison.status !== 1) {
    return { status: "failed", reason: comparison.stderr || comparison.stdout, exitCode: comparison.status };
  }

  const metric = parseRmse(comparison.stderr || comparison.stdout);
  return {
    status: "compared",
    ipePngPath,
    tikzPngPath,
    trimmedIpePngPath,
    trimmedTikzPngPath,
    diffPngPath,
    rmse: metric.rmse,
    normalizedRmse: metric.normalizedRmse
  };
}

function trimImage(magick: string, input: string, output: string) {
  return spawnSync(magick, [input, "-fuzz", "1%", "-trim", "+repage", output], {
    encoding: "utf8",
    timeout: 30_000
  });
}

function parseRmse(output: string): { rmse: number; normalizedRmse: number } {
  const match = /([0-9.]+)\s+\(([0-9.]+)\)/u.exec(output);
  if (!match) {
    return { rmse: Number.NaN, normalizedRmse: Number.NaN };
  }

  return {
    rmse: Number(match[1]),
    normalizedRmse: Number(match[2])
  };
}

function standaloneTikzDocument(tikz: string, preamble: string | undefined): string {
  return [
    "\\documentclass[tikz,border=2pt]{standalone}",
    "\\usepackage{tikz}",
    "\\usetikzlibrary{arrows.meta}",
    preamble?.trim() ?? "",
    "\\begin{document}",
    tikz,
    "\\end{document}",
    ""
  ].join("\n");
}

function htmlReport(report: ComparisonReport, htmlPath: string): string {
  const rows = report.reports.map((entry) => fixtureRow(entry, htmlPath)).join("\n");
  const compared = report.reports.filter((entry) => entry.imageDiff.status === "compared").length;
  const diagnostics = report.reports.filter((entry) => entry.diagnostics.length > 0).length;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Ipe to TikZ comparison report</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f7f4;
      --panel: #ffffff;
      --text: #1f2933;
      --muted: #64707d;
      --border: #d9ddd6;
      --accent: #1f6f8b;
      --warn: #9a5b00;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    header {
      position: sticky;
      top: 0;
      z-index: 1;
      border-bottom: 1px solid var(--border);
      background: color-mix(in srgb, var(--bg) 92%, white);
      padding: 16px 24px;
    }

    h1 {
      margin: 0 0 8px;
      font-size: 22px;
      font-weight: 650;
      letter-spacing: 0;
    }

    .summary {
      display: flex;
      flex-wrap: wrap;
      gap: 12px 20px;
      color: var(--muted);
    }

    main {
      padding: 20px 24px 32px;
    }

    .fixture {
      margin: 0 0 18px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel);
      overflow: hidden;
    }

    .fixture-header {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px 16px;
      border-bottom: 1px solid var(--border);
      padding: 12px 14px;
    }

    .fixture-name {
      font-size: 16px;
      font-weight: 650;
    }

    .meta {
      color: var(--muted);
      font-size: 13px;
    }

    .images {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0;
    }

    figure {
      margin: 0;
      padding: 14px;
      border-right: 1px solid var(--border);
      min-width: 0;
    }

    figure:last-child {
      border-right: 0;
    }

    figcaption {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 10px;
      color: var(--muted);
      font-size: 13px;
      font-weight: 600;
    }

    img {
      display: block;
      max-width: 100%;
      height: auto;
      border: 1px solid var(--border);
      background: white;
      image-rendering: auto;
    }

    .placeholder {
      min-height: 120px;
      display: grid;
      place-items: center;
      border: 1px dashed var(--border);
      color: var(--muted);
      background: #fafafa;
      text-align: center;
      padding: 16px;
    }

    .diagnostics {
      border-top: 1px solid var(--border);
      padding: 10px 14px;
      color: var(--warn);
      background: #fff9ed;
      font-size: 13px;
    }

    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
    }

    a {
      color: var(--accent);
      text-decoration: none;
    }

    a:hover {
      text-decoration: underline;
    }

    @media (max-width: 760px) {
      header,
      main {
        padding-left: 14px;
        padding-right: 14px;
      }

      .images {
        grid-template-columns: 1fr;
      }

      figure {
        border-right: 0;
        border-bottom: 1px solid var(--border);
      }

      figure:last-child {
        border-bottom: 0;
      }
    }
  </style>
</head>
<body>
  <header>
    <h1>Ipe to TikZ comparison report</h1>
    <div class="summary">
      <span>${report.reports.length} fixture${report.reports.length === 1 ? "" : "s"}</span>
      <span>${compared} rendered comparison${compared === 1 ? "" : "s"}</span>
      <span>${diagnostics} fixture${diagnostics === 1 ? "" : "s"} with diagnostics</span>
      <span>Generated ${escapeHtml(report.generatedAt)}</span>
    </div>
  </header>
  <main>
${rows}
  </main>
</body>
</html>
`;
}

function fixtureRow(entry: ComparisonReport["reports"][number], htmlPath: string): string {
  const name = basename(entry.input);
  const diff = entry.imageDiff;
  const rmse =
    diff.status === "compared" && Number.isFinite(diff.normalizedRmse)
      ? `RMSE ${formatPercent(diff.normalizedRmse)}`
      : entry.visualComparison;
  const diagnostics = entry.diagnostics.length
    ? `<div class="diagnostics">${entry.diagnostics
        .map((diagnostic) => `<code>${escapeHtml(diagnostic.code)}</code>: ${escapeHtml(diagnostic.message)}`)
        .join("<br>")}</div>`
    : "";
  const view = entry.selectedView === undefined ? "all objects" : `view ${entry.selectedView + 1}`;

  return `    <section class="fixture">
      <div class="fixture-header">
        <div>
          <div class="fixture-name">${escapeHtml(name)}</div>
          <div class="meta"><code>${escapeHtml(entry.input)}</code></div>
        </div>
        <div class="meta">${escapeHtml(view)} · ${escapeHtml(rmse)}</div>
      </div>
      <div class="images">
        ${imageFigure("Ipe", diff.status === "compared" ? diff.trimmedIpePngPath : undefined, htmlPath)}
        ${imageFigure("TikZ", diff.status === "compared" ? diff.trimmedTikzPngPath : undefined, htmlPath)}
      </div>
      ${diagnostics}
    </section>`;
}

function imageFigure(label: string, imagePath: string | undefined, htmlPath: string): string {
  const body = imagePath
    ? `<a href="${escapeAttribute(relativeAssetPath(htmlPath, imagePath))}"><img src="${escapeAttribute(
        relativeAssetPath(htmlPath, imagePath)
      )}" alt="${escapeAttribute(label)} trimmed PNG"></a>`
    : `<div class="placeholder">No trimmed PNG available</div>`;
  return `<figure>
          <figcaption><span>${escapeHtml(label)}</span>${imagePath ? `<code>${escapeHtml(basename(imagePath))}</code>` : ""}</figcaption>
          ${body}
        </figure>`;
}

function relativeAssetPath(fromHtmlPath: string, assetPath: string): string {
  return relative(dirname(fromHtmlPath), assetPath).split("\\").join("/");
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
