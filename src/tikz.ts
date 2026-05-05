import {
  identityMatrix,
  type IpeColor,
  type IpeDashStyle,
  type IpeDocument,
  type IpeGroupObject,
  type IpeImageObject,
  type IpeMatrix,
  type IpeObject,
  type IpeOpacity,
  type IpePage,
  type IpePathCommand,
  type IpePathObject,
  type IpePathStyle,
  type IpePen,
  type IpePoint,
  type IpeStylesheet,
  type IpeTextSize,
  type IpeTextObject,
  type IpeTextStyle,
  type IpeToTikzDiagnostic,
  type IpeUnsupportedPathEffect,
  type IpeUseObject
} from "./ir.js";

interface EmitContext {
  document: IpeDocument;
  diagnostics: IpeToTikzDiagnostic[];
  indent: string;
  symbolParameters?: {
    stroke: IpeColor;
    fill: IpeColor;
    pen: IpePen;
  };
}

export function emitTikz(
  document: IpeDocument,
  pageIndex: number,
  viewIndex: number | undefined,
  diagnostics: IpeToTikzDiagnostic[]
): string {
  const page = document.pages[pageIndex];
  if (!page) {
    diagnostics.push({
      severity: "error",
      code: "page-out-of-range",
      message: `Page ${pageIndex + 1} does not exist.`
    });
    return "";
  }

  const viewState = selectView(page, viewIndex, diagnostics);
  if (!viewState) {
    return "";
  }

  const lines = ["\\begin{tikzpicture}"];
  const context: EmitContext = { document, diagnostics, indent: "  " };
  for (const object of page.objects) {
    if (viewState.visibleLayers && (!object.layer || !viewState.visibleLayers.has(object.layer))) {
      continue;
    }

    const layerTransform = object.layer ? viewState.layerTransforms[object.layer] : undefined;
    if (layerTransform) {
      lines.push(...emitWithLayerTransform(object, layerTransform, context));
    } else {
      lines.push(...emitObject(object, context));
    }
  }
  lines.push("\\end{tikzpicture}", "");
  return lines.join("\n");
}

function selectView(
  page: IpePage,
  viewIndex: number | undefined,
  diagnostics: IpeToTikzDiagnostic[]
): { visibleLayers?: Set<string>; layerTransforms: Record<string, IpeMatrix> } | undefined {
  if (viewIndex === undefined) {
    return { layerTransforms: {} };
  }

  if (page.views.length === 0) {
    return {
      visibleLayers: new Set(page.layers.map((layer) => layer.name)),
      layerTransforms: {}
    };
  }

  const view = page.views[viewIndex];
  if (!view) {
    diagnostics.push({
      severity: "error",
      code: "view-out-of-range",
      message: `View ${viewIndex + 1} does not exist on page.`
    });
    return undefined;
  }

  return {
    visibleLayers: new Set(view.layers),
    layerTransforms: view.layerTransforms
  };
}

function emitWithLayerTransform(object: IpeObject, matrix: IpeMatrix, context: EmitContext): string[] {
  const lines = [`${context.indent}\\begin{scope}${formatOptions(matrixOptions(matrix))}`];
  const childContext: EmitContext = { ...context, indent: `${context.indent}  ` };
  lines.push(...emitObject(object, childContext));
  lines.push(`${context.indent}\\end{scope}`);
  return lines;
}

function emitObject(object: IpeObject, context: EmitContext): string[] {
  switch (object.kind) {
    case "path":
      return emitPath(object, context);
    case "text":
      return emitText(object, context);
    case "group":
      return emitGroup(object, context);
    case "use":
      return emitUse(object, context);
    case "image":
      return emitImage(object, context);
    case "unsupported":
      return [];
  }
}

function emitPath(path: IpePathObject, context: EmitContext): string[] {
  if (path.commands.length === 1 && path.commands[0]?.kind === "ellipse") {
    const options = pathOptions({ ...path, matrix: identityMatrix }, context);
    options.unshift(...matrixOptions(composeMatrix(path.matrix, path.commands[0].matrix)));
    return [`${context.indent}\\path${formatOptions(options)} (0pt,0pt) circle [radius=1pt];`];
  }

  const arcPath = emitSingleArcPath(path, context);
  if (arcPath) {
    return [arcPath];
  }

  const segments: string[] = [];
  let currentPoint: IpePoint | undefined;
  for (const command of path.commands) {
    const emitted = emitPathCommand(command, currentPoint, context);
    if (emitted) {
      segments.push(emitted);
    }
    currentPoint = pathCommandEndPoint(command, currentPoint);
  }

  if (segments.length === 0) {
    context.diagnostics.push({
      severity: "warning",
      code: "empty-path",
      message: "A <path> object produced no supported TikZ path commands."
    });
    return [];
  }

  const options = pathOptions(path, context);
  return [`${context.indent}\\path${formatOptions(options)} ${segments.join(" ")};`];
}

function emitPathCommand(command: IpePathCommand, currentPoint: IpePoint | undefined, context: EmitContext): string | undefined {
  switch (command.kind) {
    case "move":
      return formatPoint(command.to);
    case "line":
      return `-- ${formatPoint(command.to)}`;
    case "cubic":
      return `.. controls ${formatPoint(command.control1)} and ${formatPoint(command.control2)} .. ${formatPoint(command.to)}`;
    case "ellipse":
      return emitEllipse(command.matrix, context);
    case "arc":
      return emitArcAsCubics(command, currentPoint, context);
    case "close":
      return "-- cycle";
    case "unsupported":
      context.diagnostics.push({
        severity: "warning",
        code: "omitted-path-operator",
        message: `Path operator '${command.operator}' was omitted from TikZ output.`
      });
      return undefined;
  }
}

function pathCommandEndPoint(command: IpePathCommand, currentPoint: IpePoint | undefined): IpePoint | undefined {
  switch (command.kind) {
    case "move":
    case "line":
    case "cubic":
    case "arc":
      return command.to;
    case "ellipse":
      return undefined;
    case "close":
    case "unsupported":
      return currentPoint;
  }
}

function emitEllipse(matrix: IpeMatrix, context: EmitContext): string | undefined {
  const [a, b, c, d, s, t] = matrix;
  if (b !== 0 || c !== 0) {
    context.diagnostics.push({
      severity: "warning",
      code: "unsupported-ellipse-transform",
      message: "Rotated or sheared ellipse path operators are parsed but not emitted yet."
    });
    return undefined;
  }

  return `(${formatNumber(s)}pt,${formatNumber(t)}pt) ellipse [x radius=${formatNumber(Math.abs(a))}pt, y radius=${formatNumber(Math.abs(d))}pt]`;
}

function emitSingleArcPath(path: IpePathObject, context: EmitContext): string | undefined {
  if (path.commands.length !== 2 || path.commands[0]?.kind !== "move" || path.commands[1]?.kind !== "arc") {
    return undefined;
  }

  const move = path.commands[0];
  const arc = path.commands[1];
  const start = inverseTransformPoint(arc.matrix, move.to);
  const end = inverseTransformPoint(arc.matrix, arc.to);
  if (!start || !end) {
    context.diagnostics.push({
      severity: "warning",
      code: "unsupported-arc-transform",
      message: "Arc path operator has a singular transformation matrix and was omitted from TikZ output."
    });
    return undefined;
  }

  const options = pathOptions({ ...path, matrix: identityMatrix }, context);
  options.unshift(...matrixOptions(composeMatrix(path.matrix, arc.matrix)));
  const startAngle = angleDegrees(start);
  const endAngle = angleDegrees(end);
  return `${context.indent}\\path${formatOptions(options)} ${formatPoint(start)} arc[start angle=${formatNumber(startAngle)}, end angle=${formatNumber(endAngle)}, radius=1pt];`;
}

function emitArcAsCubics(
  arc: Extract<IpePathCommand, { kind: "arc" }>,
  currentPoint: IpePoint | undefined,
  context: EmitContext
): string | undefined {
  if (!currentPoint) {
    context.diagnostics.push({
      severity: "warning",
      code: "unsupported-arc-composition",
      message: "Arc path operator has no current point and was omitted from TikZ output."
    });
    return undefined;
  }

  const start = inverseTransformPoint(arc.matrix, currentPoint);
  const end = inverseTransformPoint(arc.matrix, arc.to);
  if (!start || !end) {
    context.diagnostics.push({
      severity: "warning",
      code: "unsupported-arc-transform",
      message: "Arc path operator has a singular transformation matrix and was omitted from TikZ output."
    });
    return undefined;
  }

  const startAngle = Math.atan2(start.y, start.x);
  const endAngle = Math.atan2(end.y, end.x);
  const delta = normalizeArcDelta(endAngle - startAngle);
  const pieces = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)));
  const segments: string[] = [];
  for (let index = 0; index < pieces; index += 1) {
    const a0 = startAngle + (delta * index) / pieces;
    const a1 = startAngle + (delta * (index + 1)) / pieces;
    const cubic = unitArcSegmentToCubic(a0, a1).map((point) => transformPoint(arc.matrix, point));
    const [control1, control2, to] = cubic;
    if (!control1 || !control2 || !to) {
      continue;
    }
    segments.push(`.. controls ${formatPoint(control1)} and ${formatPoint(control2)} .. ${formatPoint(to)}`);
  }
  return segments.join(" ");
}

function normalizeArcDelta(delta: number): number {
  while (delta <= -Math.PI) {
    delta += Math.PI * 2;
  }
  while (delta > Math.PI) {
    delta -= Math.PI * 2;
  }
  return delta;
}

function unitArcSegmentToCubic(startAngle: number, endAngle: number): [IpePoint, IpePoint, IpePoint] {
  const delta = endAngle - startAngle;
  const alpha = (4 / 3) * Math.tan(delta / 4);
  const start = { x: Math.cos(startAngle), y: Math.sin(startAngle) };
  const end = { x: Math.cos(endAngle), y: Math.sin(endAngle) };
  return [
    { x: start.x - alpha * start.y, y: start.y + alpha * start.x },
    { x: end.x + alpha * end.y, y: end.y - alpha * end.x },
    end
  ];
}

function transformPoint(matrix: IpeMatrix, point: IpePoint): IpePoint {
  const [a, b, c, d, s, t] = matrix;
  return { x: a * point.x + c * point.y + s, y: b * point.x + d * point.y + t };
}

function inverseTransformPoint(matrix: IpeMatrix, point: IpePoint): IpePoint | undefined {
  const [a, b, c, d, s, t] = matrix;
  const determinant = a * d - b * c;
  if (determinant === 0) {
    return undefined;
  }

  const x = point.x - s;
  const y = point.y - t;
  return {
    x: (d * x - c * y) / determinant,
    y: (-b * x + a * y) / determinant
  };
}

function angleDegrees(point: IpePoint): number {
  return (Math.atan2(point.y, point.x) * 180) / Math.PI;
}

function emitText(text: IpeTextObject, context: EmitContext): string[] {
  const options = [`anchor=${anchorFor(text)}`, "inner sep=0pt", `text=${emitColor(text.stroke, context)}`];
  const transformed = !isIdentityMatrix(text.matrix);
  if (transformed) {
    options.push("transform shape");
  }
  const font = textSizeFontOption(resolveTextSize(text.size, context), context);
  if (font) {
    options.push(`font={${font}}`);
  }
  const opacity = resolveOpacity(text.opacity, context);
  if (opacity.kind === "value") {
    options.push(`text opacity=${formatNumber(opacity.value)}`);
  }
  if (text.type === "minipage") {
    if (text.width !== undefined) {
      options.push(`text width=${formatNumber(text.width)}pt`);
    } else {
      context.diagnostics.push({
        severity: "warning",
        code: "minipage-without-width",
        message: "A minipage text object has no width; emitting it as a label node."
      });
    }
  }
  if (text.type === "minipage" && text.height !== undefined) {
    options.push(`text height=${formatNumber(text.height)}pt`);
  }
  if (text.type === "minipage" && text.depth !== undefined) {
    options.push(`text depth=${formatNumber(text.depth)}pt`);
  }

  const node = `${transformed ? `${context.indent}  ` : context.indent}\\node${formatOptions(options)} at ${formatPoint(text.position)} {${textContent(text, context)}};`;
  if (!transformed) {
    return [node];
  }

  return [`${context.indent}\\begin{scope}${formatOptions(matrixOptions(text.matrix))}`, node, `${context.indent}\\end{scope}`];
}

function emitGroup(group: IpeGroupObject, context: EmitContext): string[] {
  const options = matrixOptions(group.matrix);
  const lines = [`${context.indent}\\begin{scope}${formatOptions(options)}`];
  const childContext: EmitContext = { ...context, indent: `${context.indent}  ` };
  if (group.clip) {
    const clip = emitClip(group.clip, childContext);
    if (clip) {
      lines.push(clip);
    }
  }
  for (const object of group.objects) {
    lines.push(...emitObject(object, childContext));
  }
  lines.push(`${context.indent}\\end{scope}`);
  return lines;
}

function emitClip(commands: IpePathCommand[], context: EmitContext): string | undefined {
  let currentPoint: IpePoint | undefined;
  const segments = commands.flatMap((command) => {
    const emitted = emitPathCommand(command, currentPoint, context);
    currentPoint = pathCommandEndPoint(command, currentPoint);
    return emitted ? [emitted] : [];
  });

  if (segments.length === 0) {
    context.diagnostics.push({
      severity: "warning",
      code: "empty-clip",
      message: "A group clipping path produced no supported TikZ path commands."
    });
    return undefined;
  }

  return `${context.indent}\\clip ${segments.join(" ")};`;
}

function emitUse(useObject: IpeUseObject, context: EmitContext): string[] {
  const symbol = lookupSymbol(context.document.stylesheets, useObject.name);
  if (!symbol) {
    context.diagnostics.push({
      severity: "warning",
      code: "unsupported-symbol",
      message: `Symbol '${useObject.name}' is not defined in the document stylesheets.`
    });
    return [];
  }

  const scopeOptions = [
    ...matrixOptions(useObject.matrix),
    `shift={${formatPoint(useObject.position)}}`
  ];
  if (useObject.size) {
    const scale = resolveSymbolSize(useObject.size, context);
    if (scale !== undefined) {
      scopeOptions.push(`scale=${formatNumber(scale)}`);
    } else {
      context.diagnostics.push({
        severity: "warning",
        code: "unsupported-symbol-size",
        message: `Symbol size '${useObject.size}' is parsed but not emitted yet.`
      });
    }
  }

  const lines = [`${context.indent}\\begin{scope}${formatOptions(scopeOptions)}`];
  const childContext: EmitContext = {
    ...context,
    indent: `${context.indent}  `,
    symbolParameters: {
      stroke: useObject.stroke,
      fill: useObject.fill,
      pen: useObject.pen
    }
  };
  lines.push(...emitObject(symbol.object, childContext));
  lines.push(`${context.indent}\\end{scope}`);
  return lines;
}

function emitImage(image: IpeImageObject, context: EmitContext): string[] {
  context.diagnostics.push({
    severity: "warning",
    code: "unsupported-image",
    message: image.bitmap
      ? `Image object referencing bitmap '${image.bitmap}' is parsed but not emitted yet.`
      : "Inline image object is parsed but not emitted yet."
  });
  return [];
}

function pathOptions(path: IpePathObject, context: EmitContext): string[] {
  const options = matrixOptions(path.matrix);
  const pathStyle = resolvePathStyle(context.document.stylesheets);
  if (path.stroke) {
    options.push(`draw=${emitColor(path.stroke, context)}`);
  }
  if (path.fill) {
    options.push(`fill=${emitColor(path.fill, context)}`);
  }
  const handledEffects = new Set<IpeUnsupportedPathEffect>();
  for (const effect of path.unsupportedEffects) {
    if (effect.kind === "gradient" && applyGradientOptions(effect.value, options, context)) {
      handledEffects.add(effect);
    }
  }
  const pen = resolvePen(path.pen, context);
  if (pen.kind === "width") {
    options.push(`line width=${formatNumber(pen.value)}pt`);
  }
  const lineCap = path.lineCap ?? pathStyle.lineCap;
  if (lineCap) {
    options.push(`line cap=${lineCap}`);
  }
  const lineJoin = path.lineJoin ?? pathStyle.lineJoin;
  if (lineJoin) {
    options.push(`line join=${lineJoin}`);
  }
  const arrow = arrowOption(path, context);
  if (arrow) {
    options.push(arrow);
  }
  options.push(...dashOptions(resolveDashStyle(path.dashStyle, context), context));
  const opacity = resolveOpacity(path.opacity, context);
  if (opacity.kind === "value") {
    options.push(`opacity=${formatNumber(opacity.value)}`);
  }
  const strokeOpacity = path.strokeOpacity ? resolveOpacity(path.strokeOpacity, context) : undefined;
  if (strokeOpacity?.kind === "value") {
    options.push(`draw opacity=${formatNumber(strokeOpacity.value)}`);
  }
  const fillRule = path.fillRule ?? pathStyle.fillRule;
  if (fillRule === "eofill") {
    options.push("even odd rule");
  } else if (fillRule === "wind") {
    options.push("nonzero rule");
  }
  for (const effect of path.unsupportedEffects) {
    if (handledEffects.has(effect)) {
      continue;
    }
    context.diagnostics.push({
      severity: "warning",
      code: `unsupported-${effect.kind}`,
      message: `Path ${effect.kind} '${effect.value}' is parsed but not emitted yet.`
    });
  }
  return options;
}

function applyGradientOptions(name: string, options: string[], context: EmitContext): boolean {
  const gradient = lookupGradient(context.document.stylesheets, name);
  if (!gradient || gradient.type !== "axial" || gradient.coords.length < 4 || gradient.stops.length < 2) {
    return false;
  }

  const first = gradient.stops[0];
  const last = gradient.stops[gradient.stops.length - 1];
  if (!first || !last) {
    return false;
  }

  const [x1, y1, x2, y2] = gradient.coords;
  if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
    return false;
  }

  options.push("shade");
  options.push(`left color=${emitColor(first.color, context)}`);
  options.push(`right color=${emitColor(last.color, context)}`);
  options.push(`shading angle=${formatNumber((Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI)}`);
  return true;
}

function arrowOption(path: IpePathObject, context: EmitContext): string | undefined {
  if (path.arrow && path.reverseArrow) {
    return `${arrowTipOption(path.reverseArrow, context)}-${arrowTipOption(path.arrow, context)}`;
  }
  if (path.arrow) {
    return `-${arrowTipOption(path.arrow, context)}`;
  }
  if (path.reverseArrow) {
    return `${arrowTipOption(path.reverseArrow, context)}-`;
  }
  return undefined;
}

function arrowTipOption(source: string, context: EmitContext): string {
  const spec = parseArrowSpec(source);
  const length = resolveArrowSize(spec.size, context);
  const width = length;
  const inset = isPointedArrow(spec.kind) ? length * 0.2 : 0;
  const options = [
    `inset=${formatNumber(inset)}pt`,
    `length=${formatNumber(length)}pt`,
    `width=${formatNumber(width)}pt`
  ];
  if (isWhiteFilledArrow(spec.kind)) {
    options.push("fill=white");
  }
  return `{Stealth[${options.join(",")}]}`;
}

function isPointedArrow(kind: string): boolean {
  return kind === "pointed" || kind === "fpointed" || kind === "ptarc" || kind === "fptarc";
}

function isWhiteFilledArrow(kind: string): boolean {
  return kind === "fnormal" || kind === "farc" || kind === "fpointed" || kind === "fptarc";
}

function parseArrowSpec(source: string): { kind: string; size: string } {
  const [kind, size] = source.split("/", 2);
  return {
    kind: kind && kind.length > 0 ? kind : "normal",
    size: size && size.length > 0 ? size : "normal"
  };
}

function resolveArrowSize(size: string, context: EmitContext): number {
  const numeric = Number(size);
  if (Number.isFinite(numeric)) {
    return numeric;
  }

  const resolved = lookupArrowSize(context.document.stylesheets, size);
  if (resolved !== undefined) {
    return resolved;
  }

  if (size !== "normal") {
    context.diagnostics.push({
      severity: "warning",
      code: "symbolic-arrowsize",
      message: `Arrow size '${size}' is not resolved yet.`
    });
  }
  return 7;
}

function matrixOptions(matrix: IpeMatrix): string[] {
  if (isIdentityMatrix(matrix)) {
    return [];
  }

  const [a, b, c, d, s, t] = matrix;
  return [
    `cm={${formatNumber(a)},${formatNumber(b)},${formatNumber(c)},${formatNumber(d)},(${formatNumber(s)}pt,${formatNumber(t)}pt)}`
  ];
}

function isIdentityMatrix(matrix: IpeMatrix): boolean {
  return matrix.every((value, index) => value === identityMatrix[index]);
}

function composeMatrix(outer: IpeMatrix, inner: IpeMatrix): IpeMatrix {
  const [a1, b1, c1, d1, s1, t1] = outer;
  const [a2, b2, c2, d2, s2, t2] = inner;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * s2 + c1 * t2 + s1,
    b1 * s2 + d1 * t2 + t1
  ];
}

function emitColor(color: IpeColor, context: EmitContext): string {
  const resolved = resolveColor(color, context);
  if (resolved.kind !== "symbolic") {
    return emitResolvedColor(resolved);
  }

  context.diagnostics.push({
    severity: "warning",
    code: "symbolic-color",
    message: `Symbolic color '${resolved.name}' is not resolved yet.`
  });
  return resolved.name;
}

function emitResolvedColor(color: Exclude<IpeColor, { kind: "symbolic" }>): string {
  switch (color.kind) {
    case "named":
      return color.name;
    case "gray":
      return `black!${formatNumber((1 - color.value) * 100)}`;
    case "rgb":
      return `{rgb,1:red,${formatNumber(color.red)};green,${formatNumber(color.green)};blue,${formatNumber(color.blue)}}`;
  }
}

function resolveColor(color: IpeColor, context: EmitContext, seen: Set<string> = new Set()): IpeColor {
  if (color.kind !== "symbolic") {
    return color;
  }
  if (color.name === "sym-stroke" && context.symbolParameters) {
    return resolveColor(context.symbolParameters.stroke, context, seen);
  }
  if (color.name === "sym-fill" && context.symbolParameters) {
    return resolveColor(context.symbolParameters.fill, context, seen);
  }
  if (seen.has(color.name)) {
    context.diagnostics.push({
      severity: "warning",
      code: "cyclic-symbolic-color",
      message: `Symbolic color '${color.name}' resolves cyclically.`
    });
    return color;
  }

  const resolved = lookupColor(context.document.stylesheets, color.name);
  if (!resolved) {
    return color;
  }

  seen.add(color.name);
  return resolveColor(resolved, context, seen);
}

function resolvePen(pen: IpePen, context: EmitContext, seen: Set<string> = new Set()): IpePen {
  if (pen.kind === "width" || pen.kind === "normal") {
    return pen;
  }
  if (pen.name === "sym-pen" && context.symbolParameters) {
    return resolvePen(context.symbolParameters.pen, context, seen);
  }
  if (seen.has(pen.name)) {
    context.diagnostics.push({
      severity: "warning",
      code: "cyclic-symbolic-pen",
      message: `Symbolic pen '${pen.name}' resolves cyclically.`
    });
    return { kind: "normal" };
  }

  const resolved = lookupPen(context.document.stylesheets, pen.name);
  if (!resolved) {
    context.diagnostics.push({
      severity: "warning",
      code: "symbolic-pen",
      message: `Symbolic pen '${pen.name}' is not resolved yet.`
    });
    return { kind: "normal" };
  }

  seen.add(pen.name);
  return resolvePen(resolved, context, seen);
}

function resolveOpacity(opacity: IpeOpacity, context: EmitContext, seen: Set<string> = new Set()): IpeOpacity {
  if (opacity.kind === "value" || opacity.kind === "opaque") {
    return opacity;
  }
  if (seen.has(opacity.name)) {
    context.diagnostics.push({
      severity: "warning",
      code: "cyclic-symbolic-opacity",
      message: `Symbolic opacity '${opacity.name}' resolves cyclically.`
    });
    return { kind: "opaque" };
  }

  const resolved = lookupOpacity(context.document.stylesheets, opacity.name);
  if (!resolved) {
    context.diagnostics.push({
      severity: "warning",
      code: "symbolic-opacity",
      message: `Symbolic opacity '${opacity.name}' is not resolved yet.`
    });
    return { kind: "opaque" };
  }

  seen.add(opacity.name);
  return resolveOpacity(resolved, context, seen);
}

function resolveDashStyle(
  dashStyle: IpeDashStyle,
  context: EmitContext,
  seen: Set<string> = new Set()
): IpeDashStyle {
  if (dashStyle.kind !== "symbolic") {
    return dashStyle;
  }
  if (seen.has(dashStyle.name)) {
    context.diagnostics.push({
      severity: "warning",
      code: "cyclic-symbolic-dashstyle",
      message: `Symbolic dashstyle '${dashStyle.name}' resolves cyclically.`
    });
    return { kind: "solid" };
  }

  const resolved = lookupDashStyle(context.document.stylesheets, dashStyle.name);
  if (!resolved) {
    context.diagnostics.push({
      severity: "warning",
      code: "symbolic-dashstyle",
      message: `Symbolic dashstyle '${dashStyle.name}' is not resolved yet.`
    });
    return { kind: "solid" };
  }

  seen.add(dashStyle.name);
  return resolveDashStyle(resolved, context, seen);
}

function resolveTextSize(textSize: IpeTextSize, context: EmitContext, seen: Set<string> = new Set()): IpeTextSize {
  if (textSize.kind !== "symbolic") {
    return textSize;
  }
  if (seen.has(textSize.name)) {
    context.diagnostics.push({
      severity: "warning",
      code: "cyclic-symbolic-textsize",
      message: `Symbolic text size '${textSize.name}' resolves cyclically.`
    });
    return { kind: "normal" };
  }

  const resolved = lookupTextSize(context.document.stylesheets, textSize.name);
  if (!resolved) {
    if (textSize.name !== "normal") {
      context.diagnostics.push({
        severity: "warning",
        code: "symbolic-textsize",
        message: `Symbolic text size '${textSize.name}' is not resolved yet.`
      });
    }
    return { kind: "normal" };
  }

  seen.add(textSize.name);
  return resolveTextSize(resolved, context, seen);
}

function textSizeFontOption(textSize: IpeTextSize, context: EmitContext): string | undefined {
  switch (textSize.kind) {
    case "normal":
    case "symbolic":
      return undefined;
    case "absolute":
      return `\\fontsize{${formatNumber(textSize.value)}pt}{${formatNumber(textSize.value * 1.2)}pt}\\selectfont`;
    case "latex":
      if (textSize.source.trim().length === 0) {
        context.diagnostics.push({
          severity: "warning",
          code: "empty-textsize",
          message: "A text size stylesheet entry resolved to an empty LaTeX font command."
        });
        return undefined;
      }
      return textSize.source;
  }
}

function textContent(text: IpeTextObject, context: EmitContext): string {
  if (!text.style) {
    return text.text;
  }

  const style = lookupTextStyle(context.document.stylesheets, text.style);
  if (!style) {
    if (text.style !== "normal") {
      context.diagnostics.push({
        severity: "warning",
        code: "symbolic-textstyle",
        message: `Text style '${text.style}' is not resolved yet.`
      });
    }
    return text.text;
  }

  if (style.type !== text.type) {
    context.diagnostics.push({
      severity: "warning",
      code: "textstyle-type-mismatch",
      message: `Text style '${text.style}' is for ${style.type} text, not ${text.type} text.`
    });
    return text.text;
  }

  return `${style.begin}${text.text}${style.end}`;
}

function dashOptions(dashStyle: IpeDashStyle, context: EmitContext): string[] {
  switch (dashStyle.kind) {
    case "solid":
    case "symbolic":
      return [];
    case "invalid":
      context.diagnostics.push({
        severity: "warning",
        code: "invalid-dashstyle",
        message: `Dashstyle '${dashStyle.source}' could not be parsed.`
      });
      return [];
    case "pattern": {
      const parts = dashStyle.pattern.map((value, index) => `${index % 2 === 0 ? "on" : "off"} ${formatNumber(value)}pt`);
      const options = [`dash pattern=${parts.join(" ")}`];
      if (dashStyle.phase !== 0) {
        options.push(`dash phase=${formatNumber(dashStyle.phase)}pt`);
      }
      return options;
    }
  }
}

function lookupColor(stylesheets: IpeStylesheet[], name: string): IpeColor | undefined {
  for (let index = stylesheets.length - 1; index >= 0; index -= 1) {
    const value = stylesheets[index]?.colors[name];
    if (value) {
      return value;
    }
  }
  return undefined;
}

function lookupPen(stylesheets: IpeStylesheet[], name: string): IpePen | undefined {
  for (let index = stylesheets.length - 1; index >= 0; index -= 1) {
    const value = stylesheets[index]?.pens[name];
    if (value) {
      return value;
    }
  }
  return undefined;
}

function lookupOpacity(stylesheets: IpeStylesheet[], name: string): IpeOpacity | undefined {
  for (let index = stylesheets.length - 1; index >= 0; index -= 1) {
    const value = stylesheets[index]?.opacities[name];
    if (value) {
      return value;
    }
  }
  return undefined;
}

function lookupDashStyle(stylesheets: IpeStylesheet[], name: string): IpeDashStyle | undefined {
  for (let index = stylesheets.length - 1; index >= 0; index -= 1) {
    const value = stylesheets[index]?.dashStyles[name];
    if (value) {
      return value;
    }
  }
  return undefined;
}

function lookupTextSize(stylesheets: IpeStylesheet[], name: string): IpeTextSize | undefined {
  for (let index = stylesheets.length - 1; index >= 0; index -= 1) {
    const value = stylesheets[index]?.textSizes[name];
    if (value) {
      return value;
    }
  }
  return undefined;
}

function lookupTextStyle(stylesheets: IpeStylesheet[], name: string): IpeTextStyle | undefined {
  for (let index = stylesheets.length - 1; index >= 0; index -= 1) {
    const value = stylesheets[index]?.textStyles[name];
    if (value) {
      return value;
    }
  }
  return undefined;
}

function lookupSymbol(stylesheets: IpeStylesheet[], name: string) {
  for (let index = stylesheets.length - 1; index >= 0; index -= 1) {
    const value = stylesheets[index]?.symbols[name];
    if (value) {
      return value;
    }
  }
  return undefined;
}

function lookupArrowSize(stylesheets: IpeStylesheet[], name: string): number | undefined {
  for (let index = stylesheets.length - 1; index >= 0; index -= 1) {
    const value = stylesheets[index]?.arrowSizes[name];
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function lookupGradient(stylesheets: IpeStylesheet[], name: string) {
  for (let index = stylesheets.length - 1; index >= 0; index -= 1) {
    const value = stylesheets[index]?.gradients[name];
    if (value) {
      return value;
    }
  }
  return undefined;
}

function resolvePathStyle(stylesheets: IpeStylesheet[]): IpePathStyle {
  for (let index = stylesheets.length - 1; index >= 0; index -= 1) {
    const value = stylesheets[index]?.pathStyle;
    if (value) {
      return value;
    }
  }
  return {};
}

function resolveSymbolSize(size: string, context: EmitContext): number | undefined {
  const absolute = Number(size);
  if (Number.isFinite(absolute)) {
    return absolute;
  }

  for (let index = context.document.stylesheets.length - 1; index >= 0; index -= 1) {
    const value = context.document.stylesheets[index]?.symbolSizes[size];
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function anchorFor(text: IpeTextObject): string {
  const vertical =
    text.verticalAlign === "top"
      ? "north"
      : text.verticalAlign === "bottom"
        ? "south"
        : text.verticalAlign === "baseline"
        ? "base"
        : "";
  const horizontal =
    text.horizontalAlign === "left" ? "west" : text.horizontalAlign === "right" ? "east" : "";

  return [vertical, horizontal].filter(Boolean).join(" ") || "center";
}

function formatOptions(options: string[]): string {
  return options.length > 0 ? `[${options.join(", ")}]` : "";
}

function formatPoint(point: IpePoint): string {
  return `(${formatNumber(point.x)}pt,${formatNumber(point.y)}pt)`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
}
