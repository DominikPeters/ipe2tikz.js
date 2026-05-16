#!/usr/bin/env node

import { readFile, realpath, writeFile } from "node:fs/promises";
import process from "node:process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { convertIpeToTikz, type ConvertIpeToTikzOptions, type IpeToTikzResult } from "./index.js";
import type { IpeToTikzDiagnostic } from "./ir.js";

export interface CliArgs {
  inputPath?: string;
  outputPath?: string;
  page?: number;
  view?: number;
  useXcolorRgbConvert: boolean;
  help: boolean;
}

export interface CliIo {
  stdin: () => Promise<string>;
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, contents: string) => Promise<void>;
  stdout: (message: string) => void;
  stderr: (message: string) => void;
}

export function printHelp(): string {
  return `Usage: ipe2tikz [input.ipe] [options]

Convert an Ipe XML file to TikZ.

Options:
  -o, --output FILE       Write TikZ output to FILE
  --page N                Convert page N (1-based, default: 1)
  --view N                Convert view N on the selected page (1-based)
  --no-xcolor-rgb-convert Emit explicit xcolor rgb model syntax for RGB colors
  -h, --help              Show this help message

If no input file is provided, Ipe XML is read from stdin.
`;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { help: false, useXcolorRgbConvert: true };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;

    if (arg === "-h" || arg === "--help") {
      args.help = true;
      continue;
    }

    if (arg === "-o" || arg === "--output") {
      const value = argv[++i];
      if (!value) throw new Error(`missing value for ${arg}`);
      args.outputPath = value;
      continue;
    }

    if (arg === "--page") {
      args.page = parsePositiveIntegerOption(arg, argv[++i]);
      continue;
    }

    if (arg === "--view") {
      args.view = parsePositiveIntegerOption(arg, argv[++i]);
      continue;
    }

    if (arg === "--no-xcolor-rgb-convert") {
      args.useXcolorRgbConvert = false;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`unknown option: ${arg}`);
    }

    if (args.inputPath) {
      throw new Error("only one input file may be provided");
    }
    args.inputPath = arg;
  }

  return args;
}

export async function runCli(argv: string[], io: CliIo = nodeIo()): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    io.stderr(`ipe2tikz: ${messageFromError(error)}\n`);
    return 1;
  }

  if (args.help) {
    io.stdout(printHelp());
    return 0;
  }

  let source: string;
  try {
    source = args.inputPath ? await io.readFile(args.inputPath) : await io.stdin();
  } catch (error) {
    io.stderr(`ipe2tikz: ${messageFromError(error)}\n`);
    return 1;
  }

  if (!source.trim()) {
    io.stderr("ipe2tikz: no Ipe input provided\n");
    return 1;
  }

  const options: ConvertIpeToTikzOptions = {};
  if (args.page !== undefined) options.page = args.page - 1;
  if (args.view !== undefined) options.view = args.view - 1;
  options.useXcolorRgbConvert = args.useXcolorRgbConvert;
  const result = convertIpeToTikz(source, options);

  printDiagnostics(result.diagnostics, io);

  if (hasError(result)) {
    return 1;
  }

  try {
    if (args.outputPath) {
      await io.writeFile(args.outputPath, result.tikz);
    } else {
      io.stdout(result.tikz);
    }
  } catch (error) {
    io.stderr(`ipe2tikz: ${messageFromError(error)}\n`);
    return 1;
  }

  return 0;
}

function parsePositiveIntegerOption(option: string, value: string | undefined): number {
  if (!value) throw new Error(`missing value for ${option}`);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || String(parsed) !== value) {
    throw new Error(`invalid ${option} value: ${value}`);
  }
  return parsed;
}

function printDiagnostics(diagnostics: IpeToTikzDiagnostic[], io: CliIo): void {
  for (const diagnostic of diagnostics) {
    io.stderr(`${diagnostic.severity}: ${diagnostic.message} [${diagnostic.code}]\n`);
  }
}

function hasError(result: IpeToTikzResult): boolean {
  return result.diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function nodeIo(): CliIo {
  return {
    stdin: readStdin,
    readFile: (path) => readFile(path, "utf8"),
    writeFile: (path, contents) => writeFile(path, contents, "utf8"),
    stdout: (message) => process.stdout.write(message),
    stderr: (message) => process.stderr.write(message)
  };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function isCliEntrypoint(invokedPath = process.argv[1], moduleUrl = import.meta.url): Promise<boolean> {
  if (!invokedPath) return false;
  const [realInvokedPath, realModulePath] = await Promise.all([
    resolveRealPath(resolve(invokedPath)),
    resolveRealPath(fileURLToPath(moduleUrl))
  ]);
  return realInvokedPath === realModulePath;
}

async function resolveRealPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

if (await isCliEntrypoint()) {
  process.exitCode = await runCli(process.argv.slice(2));
}
