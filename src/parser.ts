import { XMLParser, XMLValidator } from "fast-xml-parser";

import {
  identityMatrix,
  type IpeColor,
  type IpeDashStyle,
  type IpeDocument,
  type IpeGroupObject,
  type IpeImageObject,
  type IpeLayer,
  type IpeLineCap,
  type IpeLineJoin,
  type IpeMatrix,
  type IpeObject,
  type IpeOpacity,
  type IpePage,
  type IpePathCommand,
  type IpePathObject,
  type IpePen,
  type IpePoint,
  type IpeStylesheet,
  type IpeTextSize,
  type IpeTextObject,
  type IpeToTikzDiagnostic,
  type IpeUseObject,
  type IpeView
} from "./ir.js";

interface XmlElement {
  name: string;
  attributes: Record<string, string>;
  children: XmlElement[];
  text: string;
}

type ParsedNode = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "#text",
  preserveOrder: true,
  trimValues: false
});

export function parseIpeXml(source: string): { document?: IpeDocument; diagnostics: IpeToTikzDiagnostic[] } {
  const validation = XMLValidator.validate(source);
  if (validation !== true) {
    return {
      diagnostics: [
        {
          severity: "error",
          code: "invalid-xml",
          message: `Invalid XML: ${validation.err.msg}`
        }
      ]
    };
  }

  const diagnostics: IpeToTikzDiagnostic[] = [];
  const nodes = parser.parse(source) as ParsedNode[];
  const root = readDocumentElement(nodes);

  if (!root || root.name !== "ipe") {
    return {
      diagnostics: [
        {
          severity: "error",
          code: "missing-ipe-root",
          message: "Expected an <ipe> document root."
        }
      ]
    };
  }

  const version = root.attributes.version;
  if (!version) {
    diagnostics.push({
      severity: "error",
      code: "missing-version",
      message: "The <ipe> root is missing its required version attribute."
    });
  }

  const stylesheets = root.children
    .filter((child) => child.name === "ipestyle")
    .map((stylesheet) => parseStylesheet(stylesheet, diagnostics));
  const preamble = root.children.find((child) => child.name === "preamble")?.text;
  const pages = root.children.filter((child) => child.name === "page").map((page) => parsePage(page, diagnostics));

  if (pages.length === 0) {
    diagnostics.push({
      severity: "error",
      code: "missing-page",
      message: "The Ipe document does not contain any <page> elements."
    });
  }

  if (!version || pages.length === 0) {
    return { diagnostics };
  }

  const document: IpeDocument = {
    version,
    stylesheets,
    pages
  };
  if (preamble !== undefined) {
    document.preamble = preamble;
  }

  return { document, diagnostics };
}

function readDocumentElement(nodes: ParsedNode[]): XmlElement | undefined {
  for (const node of nodes) {
    const element = readElement(node);
    if (element?.name === "ipe") {
      return element;
    }
  }

  return undefined;
}

function readElement(node: ParsedNode): XmlElement | undefined {
  const name = Object.keys(node).find((key) => key !== ":@" && key !== "#text");
  if (!name) {
    return undefined;
  }

  const rawChildren = Array.isArray(node[name]) ? (node[name] as ParsedNode[]) : [];
  const children: XmlElement[] = [];
  const text: string[] = [];

  for (const child of rawChildren) {
    if (typeof child["#text"] === "string") {
      text.push(child["#text"]);
      continue;
    }

    const element = readElement(child);
    if (element) {
      children.push(element);
    }
  }

  return {
    name,
    attributes: readAttributes(node[":@"]),
    children,
    text: text.join("")
  };
}

function readAttributes(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  const attributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    attributes[key] = String(value);
  }
  return attributes;
}

function parsePage(element: XmlElement, diagnostics: IpeToTikzDiagnostic[]): IpePage {
  const layers = element.children.filter((child) => child.name === "layer").map(parseLayer);
  const resolvedLayers = layers.length > 0 ? layers : [{ name: "alpha", edit: true, snap: "visible" as const }];
  const views = element.children.filter((child) => child.name === "view").map(parseView);
  const objects = parsePageObjects(element.children, resolvedLayers[0]?.name ?? "alpha", diagnostics);

  const page: IpePage = {
    layers: resolvedLayers,
    views,
    objects
  };
  if (element.attributes.title) {
    page.title = element.attributes.title;
  }
  return page;
}

function parseLayer(element: XmlElement): IpeLayer {
  const snap = element.attributes.snap;
  return {
    name: element.attributes.name ?? "alpha",
    edit: element.attributes.edit !== "no",
    snap: snap === "never" || snap === "always" ? snap : "visible"
  };
}

function parseView(element: XmlElement): IpeView {
  const view: IpeView = {
    layers: splitWords(element.attributes.layers ?? ""),
    active: element.attributes.active ?? "",
    layerTransforms: {}
  };
  if (element.attributes.name) {
    view.name = element.attributes.name;
  }
  for (const child of element.children) {
    if (child.name === "transform" && child.attributes.layer && child.attributes.matrix) {
      const matrix = parseMatrix(child.attributes.matrix, []);
      view.layerTransforms[child.attributes.layer] = matrix;
    }
  }
  return view;
}

function parseStylesheet(element: XmlElement, diagnostics: IpeToTikzDiagnostic[]): IpeStylesheet {
  const stylesheet: IpeStylesheet = {
    colors: {},
    pens: {},
    opacities: {},
    dashStyles: {},
    textSizes: {},
    textStyles: {},
    symbols: {},
    symbolSizes: {},
    arrowSizes: {},
    gradients: {},
    tilings: {}
  };
  if (element.attributes.name) {
    stylesheet.name = element.attributes.name;
  }

  for (const child of element.children) {
    switch (child.name) {
      case "color":
        if (child.attributes.name && child.attributes.value) {
          stylesheet.colors[child.attributes.name] = parseColor(child.attributes.value);
        }
        break;
      case "pen":
        if (child.attributes.name && child.attributes.value) {
          stylesheet.pens[child.attributes.name] = parsePen(child.attributes.value);
        }
        break;
      case "opacity":
        if (child.attributes.name && child.attributes.value) {
          stylesheet.opacities[child.attributes.name] = parseOpacity(child.attributes.value);
        }
        break;
      case "dashstyle":
        if (child.attributes.name && child.attributes.value) {
          stylesheet.dashStyles[child.attributes.name] = parseDashStyle(child.attributes.value);
        }
        break;
      case "textsize":
        if (child.attributes.name && child.attributes.value) {
          stylesheet.textSizes[child.attributes.name] = parseTextSizeValue(child.attributes.value);
        }
        break;
      case "textstyle":
        if (child.attributes.name && child.attributes.begin !== undefined && child.attributes.end !== undefined) {
          stylesheet.textStyles[child.attributes.name] = {
            type: child.attributes.type === "label" ? "label" : "minipage",
            begin: child.attributes.begin,
            end: child.attributes.end
          };
        }
        break;
      case "pathstyle": {
        const cap = parseLineCap(child.attributes.cap);
        const join = parseLineJoin(child.attributes.join);
        const fillRule = parseFillRule(child.attributes.fillrule);
        if (cap || join || fillRule) {
          stylesheet.pathStyle = {
            ...(cap ? { lineCap: cap } : {}),
            ...(join ? { lineJoin: join } : {}),
            ...(fillRule ? { fillRule } : {})
          };
        }
        break;
      }
      case "symbol": {
        const object = parseObjects(child.children, diagnostics)[0];
        if (child.attributes.name && object) {
          stylesheet.symbols[child.attributes.name] = {
            name: child.attributes.name,
            object
          };
        }
        break;
      }
      case "symbolsize": {
        const value = Number(child.attributes.value);
        if (child.attributes.name && Number.isFinite(value)) {
          stylesheet.symbolSizes[child.attributes.name] = value;
        }
        break;
      }
      case "arrowsize": {
        const value = Number(child.attributes.value);
        if (child.attributes.name && Number.isFinite(value)) {
          stylesheet.arrowSizes[child.attributes.name] = value;
        }
        break;
      }
      case "gradient": {
        const gradient = parseGradient(child);
        if (gradient) {
          stylesheet.gradients[gradient.name] = gradient;
        }
        break;
      }
      case "tiling": {
        const tiling = parseTiling(child);
        if (tiling) {
          stylesheet.tilings[tiling.name] = tiling;
        }
        break;
      }
    }
  }

  return stylesheet;
}

function parseObjects(elements: XmlElement[], diagnostics: IpeToTikzDiagnostic[]): IpeObject[] {
  return elements.flatMap<IpeObject>((element) => {
    switch (element.name) {
      case "path":
        return [parsePathObject(element, diagnostics)];
      case "text":
        return parseTextObject(element, diagnostics);
      case "group":
        return [parseGroupObject(element, diagnostics)];
      case "use":
        return parseUseObject(element, diagnostics);
      case "image":
        return parseImageObject(element, diagnostics);
      default:
        return [];
    }
  });
}

function parsePageObjects(elements: XmlElement[], defaultLayer: string, diagnostics: IpeToTikzDiagnostic[]): IpeObject[] {
  const objects: IpeObject[] = [];
  let currentLayer = defaultLayer;

  for (const element of elements) {
    const parsed = parseObjects([element], diagnostics);
    for (const object of parsed) {
      if (object.layer) {
        currentLayer = object.layer;
      } else {
        object.layer = currentLayer;
      }
      objects.push(object);
    }
  }

  return objects;
}

function parsePathObject(element: XmlElement, diagnostics: IpeToTikzDiagnostic[]): IpePathObject {
  const path: IpePathObject = {
    kind: "path",
    matrix: parseMatrix(element.attributes.matrix, diagnostics),
    pen: parsePen(element.attributes.pen),
    dashStyle: parseDashStyle(element.attributes.dash),
    opacity: parseOpacity(element.attributes.opacity),
    unsupportedEffects: parseUnsupportedPathEffects(element.attributes),
    commands: parsePathCommands(element.text, diagnostics)
  };

  if (element.attributes.layer) {
    path.layer = element.attributes.layer;
  }
  if (element.attributes.stroke) {
    path.stroke = parseColor(element.attributes.stroke);
  }
  if (element.attributes.fill) {
    path.fill = parseColor(element.attributes.fill);
  }
  if (element.attributes.fillrule === "wind" || element.attributes.fillrule === "eofill") {
    path.fillRule = element.attributes.fillrule;
  }
  if (element.attributes["stroke-opacity"]) {
    path.strokeOpacity = parseOpacity(element.attributes["stroke-opacity"]);
  }
  const cap = parseLineCap(element.attributes.cap);
  if (cap) {
    path.lineCap = cap;
  }
  const join = parseLineJoin(element.attributes.join);
  if (join) {
    path.lineJoin = join;
  }
  if (element.attributes.arrow) {
    path.arrow = element.attributes.arrow;
  }
  if (element.attributes.rarrow) {
    path.reverseArrow = element.attributes.rarrow;
  }
  return path;
}

function parseTextObject(element: XmlElement, diagnostics: IpeToTikzDiagnostic[]): IpeTextObject[] {
  const position = parsePoint(element.attributes.pos);
  if (!position) {
    diagnostics.push({
      severity: "error",
      code: "invalid-text-position",
      message: "A <text> object is missing a valid pos attribute."
    });
    return [];
  }

  const text: IpeTextObject = {
    kind: "text",
    matrix: parseMatrix(element.attributes.matrix, diagnostics),
    type: element.attributes.type === "minipage" ? "minipage" : "label",
    stroke: parseColor(element.attributes.stroke ?? "black"),
    opacity: parseOpacity(element.attributes.opacity),
    size: parseTextSizeReference(element.attributes.size),
    position,
    text: element.text.trim(),
    horizontalAlign: parseHorizontalAlign(element.attributes.halign),
    verticalAlign: parseVerticalAlign(element.attributes.valign, element.attributes.type)
  };
  if (element.attributes.layer) {
    text.layer = element.attributes.layer;
  }
  if (element.attributes.style) {
    text.style = element.attributes.style;
  }
  if (element.attributes.width !== undefined) {
    const width = Number(element.attributes.width);
    if (Number.isFinite(width)) {
      text.width = width;
    }
  }
  if (element.attributes.height !== undefined) {
    const height = Number(element.attributes.height);
    if (Number.isFinite(height)) {
      text.height = height;
    }
  }
  if (element.attributes.depth !== undefined) {
    const depth = Number(element.attributes.depth);
    if (Number.isFinite(depth)) {
      text.depth = depth;
    }
  }

  return [text];
}

function parseGroupObject(element: XmlElement, diagnostics: IpeToTikzDiagnostic[]): IpeGroupObject {
  const group: IpeGroupObject = {
    kind: "group",
    matrix: parseMatrix(element.attributes.matrix, diagnostics),
    objects: parseObjects(element.children, diagnostics)
  };
  if (element.attributes.layer) {
    group.layer = element.attributes.layer;
  }
  if (element.attributes.clip) {
    group.clip = parsePathCommands(element.attributes.clip, diagnostics);
  }
  return group;
}

function parseUseObject(element: XmlElement, diagnostics: IpeToTikzDiagnostic[]): IpeUseObject[] {
  if (!element.attributes.name) {
    diagnostics.push({
      severity: "error",
      code: "missing-use-name",
      message: "A <use> object is missing its required name attribute."
    });
    return [];
  }

  const useObject: IpeUseObject = {
    kind: "use",
    matrix: parseMatrix(element.attributes.matrix, diagnostics),
    name: element.attributes.name,
    position: parsePoint(element.attributes.pos) ?? { x: 0, y: 0 },
    stroke: parseColor(element.attributes.stroke ?? "black"),
    fill: parseColor(element.attributes.fill ?? "black"),
    pen: parsePen(element.attributes.pen)
  };
  if (element.attributes.layer) {
    useObject.layer = element.attributes.layer;
  }
  if (element.attributes.size) {
    useObject.size = element.attributes.size;
  }
  return [useObject];
}

function parseImageObject(element: XmlElement, diagnostics: IpeToTikzDiagnostic[]): IpeImageObject[] {
  const rect = parseRect(element.attributes.rect);
  if (!rect) {
    diagnostics.push({
      severity: "error",
      code: "invalid-image-rect",
      message: "An <image> object is missing a valid rect attribute."
    });
    return [];
  }

  const image: IpeImageObject = {
    kind: "image",
    matrix: parseMatrix(element.attributes.matrix, diagnostics),
    rect
  };
  if (element.attributes.layer) {
    image.layer = element.attributes.layer;
  }
  if (element.attributes.bitmap) {
    image.bitmap = element.attributes.bitmap;
  }
  return [image];
}

function parsePathCommands(source: string, diagnostics: IpeToTikzDiagnostic[]): IpePathCommand[] {
  const tokens = splitWords(source);
  const operands: number[] = [];
  const commands: IpePathCommand[] = [];
  let currentPoint: IpePoint | undefined;

  for (const token of tokens) {
    const value = Number(token);
    if (Number.isFinite(value)) {
      operands.push(value);
      continue;
    }

    switch (token) {
      case "m":
      case "l": {
        const point = readOperandPoint(operands);
        if (!point || operands.length !== 0) {
          diagnostics.push({
            severity: "error",
            code: "invalid-path-operands",
            message: `Path operator '${token}' expects exactly one point argument.`
          });
          operands.length = 0;
          break;
        }
        commands.push({ kind: token === "m" ? "move" : "line", to: point });
        currentPoint = point;
        break;
      }
      case "c":
      case "q": {
        const curves = readBezierCurves(operands, currentPoint);
        if (curves) {
          commands.push(...curves);
          currentPoint = curves[curves.length - 1]?.to;
        } else {
          commands.push({ kind: "unsupported", operator: token, operands: operands.splice(0) });
          diagnostics.push({
            severity: "warning",
            code: "unsupported-path-operator",
            message: `Path operator '${token}' is only emitted for quadratic and cubic Bezier segments.`
          });
        }
        break;
      }
      case "e": {
        const matrix = readOperandMatrix(operands);
        if (matrix) {
          commands.push({ kind: "ellipse", matrix });
        } else {
          diagnostics.push({
            severity: "error",
            code: "invalid-path-operands",
            message: "Path operator 'e' expects exactly one matrix argument."
          });
          operands.length = 0;
        }
        break;
      }
      case "a": {
        const arc = readArc(operands);
        if (arc) {
          commands.push(arc);
          currentPoint = arc.to;
        } else {
          diagnostics.push({
            severity: "error",
            code: "invalid-path-operands",
            message: "Path operator 'a' expects one matrix argument followed by one endpoint."
          });
          operands.length = 0;
        }
        break;
      }
      case "h":
        if (operands.length !== 0) {
          diagnostics.push({
            severity: "error",
            code: "invalid-path-operands",
            message: "Path operator 'h' does not accept operands."
          });
          operands.length = 0;
        }
        commands.push({ kind: "close" });
        break;
      case "s": {
        const curves = readBezierCurves(operands, currentPoint);
        if (curves) {
          commands.push(...curves);
          currentPoint = curves[curves.length - 1]?.to;
        } else {
          commands.push({ kind: "unsupported", operator: token, operands: operands.splice(0) });
          diagnostics.push({
            severity: "warning",
            code: "unsupported-path-operator",
            message: `Path operator '${token}' is parsed but not emitted yet.`
          });
        }
        break;
      }
      case "C": {
        const curves = readCardinalSpline(operands, currentPoint);
        if (curves) {
          commands.push(...curves);
          currentPoint = curves[curves.length - 1]?.to;
        } else {
          commands.push({ kind: "unsupported", operator: token, operands: operands.splice(0) });
          diagnostics.push({
            severity: "warning",
            code: "unsupported-path-operator",
            message: `Path operator '${token}' is parsed but not emitted yet.`
          });
        }
        break;
      }
      case "L":
      case "u":
        commands.push({ kind: "unsupported", operator: token, operands: operands.splice(0) });
        diagnostics.push({
          severity: "warning",
          code: "unsupported-path-operator",
          message: `Path operator '${token}' is parsed but not emitted yet.`
        });
        break;
      default:
        diagnostics.push({
          severity: "error",
          code: "unknown-path-token",
          message: `Unknown path token '${token}'.`
        });
        operands.length = 0;
    }
  }

  if (operands.length > 0) {
    diagnostics.push({
      severity: "error",
      code: "dangling-path-operands",
      message: "Path data ended with numeric operands but no operator."
    });
  }

  return commands;
}

function readOperandPoint(operands: number[]): IpePoint | undefined {
  if (operands.length !== 2) {
    return undefined;
  }

  const [x, y] = operands.splice(0);
  if (x === undefined || y === undefined) {
    return undefined;
  }

  return { x, y };
}

function readBezierCurves(
  operands: number[],
  currentPoint: IpePoint | undefined
): Extract<IpePathCommand, { kind: "cubic" }>[] | undefined {
  if (operands.length === 6) {
    const control1 = readPointAt(operands, 0);
    const control2 = readPointAt(operands, 2);
    const to = readPointAt(operands, 4);
    operands.length = 0;
    if (control1 && control2 && to) {
      return [{ kind: "cubic", control1, control2, to }];
    }
  }

  if (operands.length === 4 && currentPoint) {
    const quadraticControl = readPointAt(operands, 0);
    const to = readPointAt(operands, 2);
    operands.length = 0;
    if (quadraticControl && to) {
      return [{
        kind: "cubic",
        control1: interpolate(currentPoint, quadraticControl, 2 / 3),
        control2: interpolate(to, quadraticControl, 2 / 3),
        to
      }];
    }
  }

  if (operands.length > 6 && operands.length % 2 === 0 && currentPoint) {
    const points = [currentPoint, ...readPoints(operands)];
    operands.length = 0;
    return uniformSplineToCubics(points);
  }

  return undefined;
}

function readCardinalSpline(
  operands: number[],
  currentPoint: IpePoint | undefined
): Extract<IpePathCommand, { kind: "cubic" }>[] | undefined {
  if (!currentPoint || operands.length < 5 || operands.length % 2 !== 1) {
    return undefined;
  }

  const tension = operands[operands.length - 1];
  if (tension === undefined) {
    return undefined;
  }

  const pointOperands = operands.slice(0, -1);
  const points = [currentPoint, ...readPoints(pointOperands)];
  operands.length = 0;
  if (points.length < 2) {
    return undefined;
  }

  const curves: Extract<IpePathCommand, { kind: "cubic" }>[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[Math.max(0, index - 1)] ?? points[index];
    const from = points[index];
    const to = points[index + 1];
    const next = points[Math.min(points.length - 1, index + 2)] ?? to;
    if (!previous || !from || !to || !next) {
      continue;
    }
    curves.push({
      kind: "cubic",
      control1: addScaled(from, subtract(to, previous), tension / 3),
      control2: addScaled(to, subtract(from, next), tension / 3),
      to
    });
  }
  return curves;
}

function uniformSplineToCubics(points: IpePoint[]): Extract<IpePathCommand, { kind: "cubic" }>[] | undefined {
  if (points.length < 3) {
    return undefined;
  }
  if (points.length === 3) {
    const from = points[0];
    const control = points[1];
    const to = points[2];
    if (!from || !control || !to) {
      return undefined;
    }
    return [{
      kind: "cubic",
      control1: interpolate(from, control, 2 / 3),
      control2: interpolate(to, control, 2 / 3),
      to
    }];
  }
  if (points.length === 4) {
    const control1 = points[1];
    const control2 = points[2];
    const to = points[3];
    if (!control1 || !control2 || !to) {
      return undefined;
    }
    return [{ kind: "cubic", control1, control2, to }];
  }

  const padded = [points[0], points[0], ...points, points[points.length - 1], points[points.length - 1]].filter(
    (point): point is IpePoint => point !== undefined
  );
  const curves: Extract<IpePathCommand, { kind: "cubic" }>[] = [];
  for (let index = 0; index <= padded.length - 4; index += 1) {
    const p0 = padded[index];
    const p1 = padded[index + 1];
    const p2 = padded[index + 2];
    const p3 = padded[index + 3];
    if (!p0 || !p1 || !p2 || !p3) {
      continue;
    }
    curves.push({
      kind: "cubic",
      control1: weightedPoint([p0, p1, p2], [0, 4 / 6, 2 / 6]),
      control2: weightedPoint([p1, p2], [2 / 6, 4 / 6]),
      to: weightedPoint([p1, p2, p3], [1 / 6, 4 / 6, 1 / 6])
    });
  }
  return curves;
}

function readArc(operands: number[]): Extract<IpePathCommand, { kind: "arc" }> | undefined {
  if (operands.length !== 8) {
    return undefined;
  }

  const matrixOperands = operands.splice(0, 6);
  const matrix = readOperandMatrix(matrixOperands);
  const to = readOperandPoint(operands);
  if (!matrix || !to) {
    return undefined;
  }

  return { kind: "arc", matrix, to };
}

function readOperandMatrix(operands: number[]): IpeMatrix | undefined {
  if (operands.length !== 6) {
    return undefined;
  }

  const [a, b, c, d, s, t] = operands.splice(0);
  if (
    a === undefined ||
    b === undefined ||
    c === undefined ||
    d === undefined ||
    s === undefined ||
    t === undefined
  ) {
    return undefined;
  }

  return [a, b, c, d, s, t];
}

function readPointAt(operands: number[], index: number): IpePoint | undefined {
  const x = operands[index];
  const y = operands[index + 1];
  if (x === undefined || y === undefined) {
    return undefined;
  }

  return { x, y };
}

function readPoints(operands: number[]): IpePoint[] {
  const points: IpePoint[] = [];
  for (let index = 0; index < operands.length; index += 2) {
    const point = readPointAt(operands, index);
    if (point) {
      points.push(point);
    }
  }
  return points;
}

function interpolate(from: IpePoint, to: IpePoint, fraction: number): IpePoint {
  return {
    x: from.x + (to.x - from.x) * fraction,
    y: from.y + (to.y - from.y) * fraction
  };
}

function subtract(to: IpePoint, from: IpePoint): IpePoint {
  return { x: to.x - from.x, y: to.y - from.y };
}

function addScaled(point: IpePoint, vector: IpePoint, scale: number): IpePoint {
  return { x: point.x + vector.x * scale, y: point.y + vector.y * scale };
}

function weightedPoint(points: IpePoint[], weights: number[]): IpePoint {
  return points.reduce(
    (sum, point, index) => ({
      x: sum.x + point.x * (weights[index] ?? 0),
      y: sum.y + point.y * (weights[index] ?? 0)
    }),
    { x: 0, y: 0 }
  );
}

function parseMatrix(source: string | undefined, diagnostics: IpeToTikzDiagnostic[]): IpeMatrix {
  if (!source) {
    return identityMatrix;
  }

  const values = splitWords(source).map(Number);
  if (values.length !== 6 || values.some((value) => !Number.isFinite(value))) {
    diagnostics.push({
      severity: "error",
      code: "invalid-matrix",
      message: `Invalid matrix '${source}'.`
    });
    return identityMatrix;
  }

  return [values[0]!, values[1]!, values[2]!, values[3]!, values[4]!, values[5]!];
}

function parsePoint(source: string | undefined): IpePoint | undefined {
  if (!source) {
    return undefined;
  }

  const values = splitWords(source).map(Number);
  if (values.length !== 2 || values.some((value) => !Number.isFinite(value))) {
    return undefined;
  }

  return { x: values[0]!, y: values[1]! };
}

function parseRect(source: string | undefined): IpeImageObject["rect"] | undefined {
  if (!source) {
    return undefined;
  }

  const values = splitWords(source).map(Number);
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
    return undefined;
  }

  return [values[0]!, values[1]!, values[2]!, values[3]!];
}

function parseColor(source: string): IpeColor {
  const values = splitWords(source).map(Number);
  if (source === "black" || source === "white") {
    return { kind: "named", name: source };
  }
  if (values.length === 1 && Number.isFinite(values[0])) {
    return { kind: "gray", value: values[0]! };
  }
  if (values.length === 3 && values.every((value) => Number.isFinite(value))) {
    return { kind: "rgb", red: values[0]!, green: values[1]!, blue: values[2]! };
  }
  return { kind: "symbolic", name: source };
}

function parsePen(source: string | undefined): IpePen {
  if (!source || source === "normal") {
    return { kind: "normal" };
  }

  const value = Number(source);
  if (Number.isFinite(value)) {
    return { kind: "width", value };
  }

  return { kind: "symbolic", name: source };
}

function parseOpacity(source: string | undefined): IpeOpacity {
  if (!source || source === "normal") {
    return { kind: "opaque" };
  }

  const value = Number(source);
  if (Number.isFinite(value)) {
    return { kind: "value", value };
  }

  return { kind: "symbolic", name: source };
}

function parseDashStyle(source: string | undefined): IpeDashStyle {
  if (!source || source === "normal") {
    return { kind: "solid" };
  }

  const match = /^\s*\[([^\]]*)\]\s+([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*$/u.exec(source);
  if (!match) {
    return { kind: "symbolic", name: source };
  }

  const pattern = splitWords(match[1] ?? "").map(Number);
  const phase = Number(match[2]);
  if (pattern.length === 0 || pattern.some((value) => !Number.isFinite(value)) || !Number.isFinite(phase)) {
    return { kind: "invalid", source };
  }

  return { kind: "pattern", pattern, phase };
}

function parseTextSizeReference(source: string | undefined): IpeTextSize {
  if (!source || source === "normal") {
    return { kind: "normal" };
  }

  const value = Number(source);
  if (Number.isFinite(value)) {
    return { kind: "absolute", value };
  }

  return { kind: "symbolic", name: source };
}

function parseTextSizeValue(source: string): IpeTextSize {
  const value = Number(source);
  if (Number.isFinite(value)) {
    return { kind: "absolute", value };
  }
  return { kind: "latex", source };
}

function parseLineCap(source: string | undefined): IpeLineCap | undefined {
  switch (source) {
    case "0":
      return "butt";
    case "1":
      return "round";
    case "2":
      return "rect";
    default:
      return undefined;
  }
}

function parseLineJoin(source: string | undefined): IpeLineJoin | undefined {
  switch (source) {
    case "0":
      return "miter";
    case "1":
      return "round";
    case "2":
      return "bevel";
    default:
      return undefined;
  }
}

function parseFillRule(source: string | undefined): "wind" | "eofill" | undefined {
  return source === "wind" || source === "eofill" ? source : undefined;
}

function parseGradient(element: XmlElement): IpeStylesheet["gradients"][string] | undefined {
  if (!element.attributes.name || !element.attributes.coords) {
    return undefined;
  }

  const coords = splitWords(element.attributes.coords).map(Number);
  if (coords.length === 0 || coords.some((value) => !Number.isFinite(value))) {
    return undefined;
  }

  const stops = element.children.flatMap((child) => {
    if (child.name !== "stop" || !child.attributes.offset || !child.attributes.color) {
      return [];
    }

    const offset = Number(child.attributes.offset);
    if (!Number.isFinite(offset)) {
      return [];
    }

    return [{ offset, color: parseColor(child.attributes.color) }];
  });

  if (stops.length === 0) {
    return undefined;
  }

  return {
    name: element.attributes.name,
    type: element.attributes.type === "radial" ? "radial" : "axial",
    extend: element.attributes.extend === "yes",
    matrix: parseMatrix(element.attributes.matrix, []),
    coords,
    stops
  };
}

function parseTiling(element: XmlElement): IpeStylesheet["tilings"][string] | undefined {
  const angle = Number(element.attributes.angle);
  const step = Number(element.attributes.step);
  const width = Number(element.attributes.width);
  if (!element.attributes.name || !Number.isFinite(angle) || !Number.isFinite(step) || !Number.isFinite(width)) {
    return undefined;
  }

  return {
    name: element.attributes.name,
    angle,
    step,
    width
  };
}

function parseUnsupportedPathEffects(attributes: Record<string, string>): IpePathObject["unsupportedEffects"] {
  const effects: IpePathObject["unsupportedEffects"] = [];
  if (attributes.gradient && attributes.gradient !== "normal") {
    effects.push({ kind: "gradient", value: attributes.gradient });
  }
  if (attributes.tiling && attributes.tiling !== "normal") {
    effects.push({ kind: "tiling", value: attributes.tiling });
  }
  return effects;
}

function parseHorizontalAlign(source: string | undefined): IpeTextObject["horizontalAlign"] {
  return source === "center" || source === "right" ? source : "left";
}

function parseVerticalAlign(source: string | undefined, type: string | undefined): IpeTextObject["verticalAlign"] {
  if (source === "top" || source === "bottom" || source === "center" || source === "baseline") {
    return source;
  }
  return type === "minipage" ? "top" : "bottom";
}

function splitWords(source: string): string[] {
  return source.trim().split(/\s+/u).filter(Boolean);
}
