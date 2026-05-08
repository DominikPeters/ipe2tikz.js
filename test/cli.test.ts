import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runCli, type CliIo } from "../src/cli.js";

const simpleIpe = `<ipe version="70200"><page><path stroke="black" pen="1">0 0 m 72 0 l 72 36 l</path></page></ipe>`;
const multipageIpe = `<ipe version="70200">
<page title="first"><path stroke="black">0 0 m 10 0 l</path></page>
<page title="second">
  <layer name="alpha"/>
  <layer name="beta"/>
  <view layers="alpha" active="alpha"/>
  <view layers="beta" active="beta"/>
  <path layer="alpha" stroke="black">0 0 m 10 0 l</path>
  <path layer="beta" stroke="black">0 20 m 10 20 l</path>
</page>
</ipe>`;

describe("ipe2tikz CLI", () => {
  it("converts a file to stdout", async () => {
    await withTempDir(async (dir) => {
      const inputPath = join(dir, "input.ipe");
      await writeFile(inputPath, simpleIpe, "utf8");
      const io = memoryIo();

      const exitCode = await runCli([inputPath], io);

      expect(exitCode).toBe(0);
      expect(io.stdoutText()).toContain("\\begin{tikzpicture}");
      expect(io.stdoutText()).toContain("(72pt,36pt)");
      expect(io.stderrText()).toBe("");
    });
  });

  it("writes output to --output", async () => {
    await withTempDir(async (dir) => {
      const inputPath = join(dir, "input.ipe");
      const outputPath = join(dir, "output.tex");
      await writeFile(inputPath, simpleIpe, "utf8");
      const io = memoryIo();

      const exitCode = await runCli([inputPath, "--output", outputPath], io);

      expect(exitCode).toBe(0);
      expect(io.stdoutText()).toBe("");
      expect(await readFile(outputPath, "utf8")).toContain("\\path[draw=black, line width=1pt]");
    });
  });

  it("reads stdin when no input file is provided", async () => {
    const io = memoryIo(simpleIpe);

    const exitCode = await runCli([], io);

    expect(exitCode).toBe(0);
    expect(io.stdoutText()).toContain("(72pt,0pt)");
  });

  it("maps --page and --view from 1-based CLI values to the API", async () => {
    const io = memoryIo(multipageIpe);

    const exitCode = await runCli(["--page", "2", "--view", "2"], io);

    expect(exitCode).toBe(0);
    expect(io.stdoutText()).toContain("(0pt,20pt) -- (10pt,20pt)");
    expect(io.stdoutText()).not.toContain("(0pt,0pt) -- (10pt,0pt)");
  });

  it("rejects unknown options", async () => {
    const io = memoryIo(simpleIpe);

    const exitCode = await runCli(["--bogus"], io);

    expect(exitCode).toBe(1);
    expect(io.stderrText()).toContain("unknown option: --bogus");
  });

  it("rejects missing option values", async () => {
    const io = memoryIo(simpleIpe);

    const exitCode = await runCli(["--output"], io);

    expect(exitCode).toBe(1);
    expect(io.stderrText()).toContain("missing value for --output");
  });

  it("rejects invalid numeric options", async () => {
    const io = memoryIo(simpleIpe);

    const exitCode = await runCli(["--page", "0"], io);

    expect(exitCode).toBe(1);
    expect(io.stderrText()).toContain("invalid --page value: 0");
  });

  it("rejects empty input", async () => {
    const io = memoryIo("   \n");

    const exitCode = await runCli([], io);

    expect(exitCode).toBe(1);
    expect(io.stderrText()).toContain("no Ipe input provided");
  });

  it("prints diagnostics to stderr and exits nonzero for conversion errors", async () => {
    const io = memoryIo(simpleIpe);

    const exitCode = await runCli(["--page", "2"], io);

    expect(exitCode).toBe(1);
    expect(io.stdoutText()).toBe("");
    expect(io.stderrText()).toContain("error: Page 2 does not exist. [page-out-of-range]");
  });

  it("prints warnings to stderr while exiting successfully", async () => {
    const source = `<ipe version="70200"><page><path stroke="black">0 0 m 1 0 1 1 0 1 -1 1 L</path></page></ipe>`;
    const io = memoryIo(source);

    const exitCode = await runCli([], io);

    expect(exitCode).toBe(0);
    expect(io.stdoutText()).toContain("\\begin{tikzpicture}");
    expect(io.stderrText()).toContain("warning:");
    expect(io.stderrText()).toContain("unsupported-path-operator");
  });
});

function memoryIo(stdin = ""): CliIo & { stdoutText: () => string; stderrText: () => string } {
  let stdout = "";
  let stderr = "";

  return {
    stdin: async () => stdin,
    readFile: (path) => readFile(path, "utf8"),
    writeFile: (path, contents) => writeFile(path, contents, "utf8"),
    stdout: (message) => {
      stdout += message;
    },
    stderr: (message) => {
      stderr += message;
    },
    stdoutText: () => stdout,
    stderrText: () => stderr
  };
}

async function withTempDir(callback: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "ipe2tikz-cli-"));
  try {
    await callback(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
