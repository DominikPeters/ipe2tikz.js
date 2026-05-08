import { parseIpeXml } from "./parser.js";
import { emitTikz } from "./tikz.js";

export type {
  IpeColor,
  IpeBitmap,
  IpeDashStyle,
  IpeDocument,
  IpeGroupObject,
  IpeGradient,
  IpeGradientStop,
  IpeImageObject,
  IpeLayer,
  IpeLineCap,
  IpeLineJoin,
  IpeMatrix,
  IpeObject,
  IpeOpacity,
  IpePage,
  IpePathCommand,
  IpePathObject,
  IpePathStyle,
  IpePen,
  IpePoint,
  IpeStylesheet,
  IpeTextSize,
  IpeTextObject,
  IpeTextStyle,
  IpeTiling,
  IpeToTikzDiagnostic,
  IpeUnsupportedPathEffect,
  IpeUseObject,
  IpeView
} from "./ir.js";

export { parseIpeXml } from "./parser.js";

import type { IpeToTikzDiagnostic } from "./ir.js";

export interface IpeToTikzResult {
  tikz: string;
  diagnostics: IpeToTikzDiagnostic[];
}

export interface ConvertIpeToTikzOptions {
  page?: number;
  view?: number;
  imagePath?: (bitmapId: string) => string | undefined;
}

export function convertIpeToTikz(source: string, options: ConvertIpeToTikzOptions = {}): IpeToTikzResult {
  const parseResult = parseIpeXml(source);
  const diagnostics = [...parseResult.diagnostics];

  if (!parseResult.document || diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return {
      tikz: "",
      diagnostics
    };
  }

  return {
    tikz: emitTikz(
      parseResult.document,
      options.page ?? 0,
      options.view,
      diagnostics,
      options.imagePath ? { imagePath: options.imagePath } : {}
    ),
    diagnostics
  };
}
