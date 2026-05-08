export interface IpeToTikzDiagnostic {
  severity: "warning" | "error";
  code: string;
  message: string;
}

export interface IpeDocument {
  version: string;
  preamble?: string;
  bitmaps: Record<string, IpeBitmap>;
  stylesheets: IpeStylesheet[];
  pages: IpePage[];
}

export interface IpeBitmap {
  id: string;
  width: number;
  height: number;
  colorSpace: "DeviceGray" | "DeviceGrayAlpha" | "DeviceRGB" | "DeviceRGBAlpha";
  filter?: "FlateDecode" | "DCTDecode";
  encoding?: "base64";
  data: string;
}

export interface IpeStylesheet {
  name?: string;
  colors: Record<string, IpeColor>;
  pens: Record<string, IpePen>;
  opacities: Record<string, IpeOpacity>;
  dashStyles: Record<string, IpeDashStyle>;
  textSizes: Record<string, IpeTextSize>;
  textStyles: Record<string, IpeTextStyle>;
  symbols: Record<string, IpeSymbol>;
  symbolSizes: Record<string, number>;
  arrowSizes: Record<string, number>;
  gradients: Record<string, IpeGradient>;
  tilings: Record<string, IpeTiling>;
  pathStyle?: IpePathStyle;
}

export interface IpePage {
  title?: string;
  layers: IpeLayer[];
  views: IpeView[];
  objects: IpeObject[];
}

export interface IpeLayer {
  name: string;
  edit: boolean;
  snap: "never" | "visible" | "always";
}

export interface IpeView {
  layers: string[];
  active: string;
  name?: string;
  layerTransforms: Record<string, IpeMatrix>;
}

export type IpeObject = IpePathObject | IpeTextObject | IpeGroupObject | IpeUseObject | IpeImageObject | IpeUnsupportedObject;

export interface IpeObjectBase {
  layer?: string;
  matrix: IpeMatrix;
}

export type IpeMatrix = readonly [number, number, number, number, number, number];

export interface IpePoint {
  x: number;
  y: number;
}

export interface IpePathObject extends IpeObjectBase {
  kind: "path";
  stroke?: IpeColor;
  fill?: IpeColor;
  pen: IpePen;
  dashStyle: IpeDashStyle;
  opacity: IpeOpacity;
  strokeOpacity?: IpeOpacity;
  lineCap?: IpeLineCap;
  lineJoin?: IpeLineJoin;
  arrow?: string;
  reverseArrow?: string;
  fillRule?: "wind" | "eofill";
  unsupportedEffects: IpeUnsupportedPathEffect[];
  commands: IpePathCommand[];
}

export interface IpeTextObject extends IpeObjectBase {
  kind: "text";
  type: "label" | "minipage";
  stroke: IpeColor;
  opacity: IpeOpacity;
  size: IpeTextSize;
  style?: string;
  position: IpePoint;
  text: string;
  width?: number;
  height?: number;
  depth?: number;
  horizontalAlign: "left" | "center" | "right";
  verticalAlign: "top" | "bottom" | "center" | "baseline";
}

export interface IpeGroupObject extends IpeObjectBase {
  kind: "group";
  objects: IpeObject[];
  clip?: IpePathCommand[];
}

export interface IpeUseObject extends IpeObjectBase {
  kind: "use";
  name: string;
  position: IpePoint;
  stroke: IpeColor;
  fill: IpeColor;
  pen: IpePen;
  size?: string;
}

export interface IpeImageObject extends IpeObjectBase {
  kind: "image";
  rect: readonly [number, number, number, number];
  bitmap?: string;
}

export interface IpeUnsupportedObject extends IpeObjectBase {
  kind: "unsupported";
  element: string;
}

export type IpePathCommand =
  | { kind: "move"; to: IpePoint }
  | { kind: "line"; to: IpePoint }
  | { kind: "cubic"; control1: IpePoint; control2: IpePoint; to: IpePoint }
  | { kind: "ellipse"; matrix: IpeMatrix }
  | { kind: "arc"; matrix: IpeMatrix; to: IpePoint }
  | { kind: "close" }
  | { kind: "unsupported"; operator: string; operands: number[] };

export type IpeColor =
  | { kind: "named"; name: "black" | "white" }
  | { kind: "gray"; value: number }
  | { kind: "rgb"; red: number; green: number; blue: number }
  | { kind: "symbolic"; name: string };

export type IpePen = { kind: "normal" } | { kind: "width"; value: number } | { kind: "symbolic"; name: string };

export type IpeOpacity = { kind: "opaque" } | { kind: "value"; value: number } | { kind: "symbolic"; name: string };

export type IpeDashStyle =
  | { kind: "solid" }
  | { kind: "pattern"; pattern: number[]; phase: number }
  | { kind: "symbolic"; name: string }
  | { kind: "invalid"; source: string };

export type IpeLineCap = "butt" | "round" | "rect";

export type IpeLineJoin = "miter" | "round" | "bevel";

export interface IpePathStyle {
  lineCap?: IpeLineCap;
  lineJoin?: IpeLineJoin;
  fillRule?: "wind" | "eofill";
}

export interface IpeUnsupportedPathEffect {
  kind: "gradient" | "tiling";
  value: string;
}

export type IpeTextSize =
  | { kind: "normal" }
  | { kind: "absolute"; value: number }
  | { kind: "latex"; source: string }
  | { kind: "symbolic"; name: string };

export interface IpeTextStyle {
  type: "label" | "minipage";
  begin: string;
  end: string;
}

export interface IpeSymbol {
  name: string;
  object: IpeObject;
}

export interface IpeGradient {
  name: string;
  type: "axial" | "radial";
  extend: boolean;
  matrix: IpeMatrix;
  coords: number[];
  stops: IpeGradientStop[];
}

export interface IpeGradientStop {
  offset: number;
  color: IpeColor;
}

export interface IpeTiling {
  name: string;
  angle: number;
  step: number;
  width: number;
}

export const identityMatrix: IpeMatrix = [1, 0, 0, 1, 0, 0];
