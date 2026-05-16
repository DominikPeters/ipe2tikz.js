import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const rootDir = fileURLToPath(new URL("..", import.meta.url));
const tempDir = await mkdtemp(join(tmpdir(), "ipe2tikz-package-"));

try {
  const packDir = join(tempDir, "pack");
  const consumerDir = join(tempDir, "consumer");
  await mkdir(packDir);
  await mkdir(consumerDir);

  const { stdout: packStdout } = await execFileAsync(
    "npm",
    ["pack", "--ignore-scripts", "--pack-destination", packDir, "--json"],
    { cwd: rootDir }
  );
  const [packed] = JSON.parse(packStdout);
  if (!packed?.filename) {
    throw new Error(`npm pack did not report a tarball filename: ${packStdout}`);
  }

  await execFileAsync("npm", ["install", "--prefix", consumerDir, join(packDir, packed.filename)], {
    cwd: rootDir
  });

  const binPath =
    process.platform === "win32"
      ? join(consumerDir, "node_modules", ".bin", "ipe2tikz.cmd")
      : join(consumerDir, "node_modules", ".bin", "ipe2tikz");
  const { stdout: helpStdout } = await execFileAsync(binPath, ["--help"], { cwd: consumerDir });
  if (!helpStdout.includes("Usage: ipe2tikz [input.ipe] [options]")) {
    throw new Error(`installed bin did not print help output:\n${helpStdout}`);
  }

  const { stdout: importStdout } = await execFileAsync(
    process.execPath,
    ["-e", "import('ipe2tikz').then((m) => console.log(Object.keys(m).sort().join('\\n')))"],
    { cwd: consumerDir }
  );
  if (!importStdout.includes("convertIpeToTikz") || !importStdout.includes("parseIpeXml")) {
    throw new Error(`installed package import did not expose the public API:\n${importStdout}`);
  }
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
