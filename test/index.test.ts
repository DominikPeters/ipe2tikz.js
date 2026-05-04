import { describe, expect, it } from "vitest";

import { convertIpeToTikz } from "../src/index.js";

describe("convertIpeToTikz", () => {
  it("returns a placeholder TikZ document while implementation is scaffolded", () => {
    const result = convertIpeToTikz("<ipe version=\"70200\"><page /></ipe>");

    expect(result.tikz).toContain("\\begin{tikzpicture}");
    expect(result.diagnostics).toEqual([
      {
        severity: "warning",
        code: "not-implemented",
        message: "Ipe XML conversion is not implemented yet."
      }
    ]);
  });
});
