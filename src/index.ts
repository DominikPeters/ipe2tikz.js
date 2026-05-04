export interface IpeToTikzDiagnostic {
  severity: "warning" | "error";
  code: string;
  message: string;
}

export interface IpeToTikzResult {
  tikz: string;
  diagnostics: IpeToTikzDiagnostic[];
}

export interface ConvertIpeToTikzOptions {
  page?: number;
  view?: number;
}

export function convertIpeToTikz(_source: string, _options: ConvertIpeToTikzOptions = {}): IpeToTikzResult {
  return {
    tikz: "\\begin{tikzpicture}\n\\end{tikzpicture}\n",
    diagnostics: [
      {
        severity: "warning",
        code: "not-implemented",
        message: "Ipe XML conversion is not implemented yet."
      }
    ]
  };
}
