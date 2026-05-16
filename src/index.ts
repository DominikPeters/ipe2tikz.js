import { parseIpeXml } from "./parser.js";
import { emitTikz } from "./tikz.js";
import type { RgbToXcolorOptions } from "xcolor-rgb-convert";
import type { EmitTikzOptions } from "./tikz.js";

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
  useXcolorRgbConvert?: boolean;
  xcolorRgbConvertOptions?: RgbToXcolorOptions;
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

  const emitOptions: EmitTikzOptions = {};
  if (options.imagePath) emitOptions.imagePath = options.imagePath;
  if (options.useXcolorRgbConvert !== undefined) emitOptions.useXcolorRgbConvert = options.useXcolorRgbConvert;
  if (options.xcolorRgbConvertOptions) emitOptions.xcolorRgbConvertOptions = options.xcolorRgbConvertOptions;

  return {
    tikz: emitTikz(parseResult.document, options.page ?? 0, options.view, diagnostics, emitOptions),
    diagnostics
  };
}
