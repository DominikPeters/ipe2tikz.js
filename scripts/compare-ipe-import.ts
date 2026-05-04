import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    input: { type: "string" },
    all: { type: "boolean", default: false }
  },
  allowPositionals: true
});

if (!values.input && !values.all) {
  console.error("Usage: npm run compare:ipe -- --input test/fixtures/ipe/line.ipe");
  process.exitCode = 1;
} else {
  console.log("compare-ipe-import is a placeholder for the future black-box visual comparison harness.");
}
