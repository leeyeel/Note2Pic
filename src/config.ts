// config.ts
import * as path from "node:path";

type TextAlign = "left" | "center" | "right" | "justify";
type OutputFormat = "png" | "jpg" | "jpeg" | "webp";

export interface FontDef {
  path: string;
  family: string;
  name: string;
}

export interface TemplatesConfig {
  baseDir: string;
  defaultName: string;
}

export interface OutputConfig {
  directory: string;
  format: OutputFormat;
  quality: number;
}

export interface BaseTextStyle {
  x: number;
  y: number;
  fontSize: number;
  color: string;
  fontFamily: string;
  textAlign: TextAlign;
  lineHeight?: number;
  width?: number;
  height?: number;
  maxLines?: number;
  text?: string;
  enableInlineMarkup?: boolean;
  charsPerLine?: number;
}

type TitleArray =
  | []
  | [BaseTextStyle]
  | [BaseTextStyle, BaseTextStyle]
  | [BaseTextStyle, BaseTextStyle, BaseTextStyle];

type PagesArray =
  | []
  | [BaseTextStyle]
  | [BaseTextStyle, BaseTextStyle]
  | [BaseTextStyle, BaseTextStyle, BaseTextStyle]
  | [BaseTextStyle, BaseTextStyle, BaseTextStyle, BaseTextStyle]
  | [BaseTextStyle, BaseTextStyle, BaseTextStyle, BaseTextStyle, BaseTextStyle]
  | [BaseTextStyle, BaseTextStyle, BaseTextStyle, BaseTextStyle, BaseTextStyle, BaseTextStyle]
  | [BaseTextStyle, BaseTextStyle, BaseTextStyle, BaseTextStyle, BaseTextStyle, BaseTextStyle, BaseTextStyle];

export interface OverlayConfig {
  enable: boolean;
  count: number;
  positions: Record<string, unknown>[];
  randomize: boolean;
  scaleRange: [number, number];
  rotationRange: [number, number];
  alphaRange: [number, number];
}

type OverlayArray = | [] | [OverlayConfig]

export interface ImageConfig {
  width: number;
  height: number;
}

export interface AppConfig {
  fonts: Record<string, FontDef>;
  templates: TemplatesConfig;
  output: OutputConfig;
  title: TitleArray;
  pages: PagesArray;
  overlay: OverlayArray;
  image: ImageConfig;
}

export const pageTemplate = {
  x: 100,
  y: 500,
  width: 1080,
  height: 1350,
  fontSize: 36,
  lineHeight: 45,
  color: "#000000",
  fontFamily: "Yozai-Regular",
  textAlign: "left" as const,
  maxLines: 10,
  enableInlineMarkup: true,
  charsPerLine: 20,
  text:''
};

export const overlayTemplate:OverlayConfig = {
  enable: true,
  count: 2,
  positions: [{}, {}],
  randomize: true,
  scaleRange: [0.1, 0.2],
  rotationRange: [-15, 15],
  alphaRange: [0.75, 1.0],
}

const config = {
  fonts: {
    "yozai-regular": {
      path: "./fonts/Yozai-Regular.ttf",
      family: "Yozai-Regular",
      name: "Yozai-Regular",
    },
    "yozai-medium": {
      path: "./fonts/Yozai-Medium.ttf",
      family: "Yozai-Medium",
      name: "Yozai-Medium",
    },
    "yozai-light": {
      path: "./fonts/Yozai-Light.ttf",
      family: "Yozai-Light",
      name: "Yozai-Light",
    },
  },

  templates: {
    baseDir: "./template",
    defaultName: "default",
  },

  output: {
    directory: "output",
    format: "png",
    quality: 0.9,
  },

  title: [
    {
      x: 300,
      y: 500,
      fontSize: 72,
      color: "#000000",
      fontFamily: "Yozai-Regular",
      textAlign: "left",
      text: "",
    },
    {
      x: 200,
      y: 650,
      fontSize: 120,
      color: "#000000",
      fontFamily: "Yozai-Medium",
      textAlign: "left",
      text: "hello",
    },
    {
      x: 300,
      y: 900,
      fontSize: 72,
      color: "#000000",
      fontFamily: "Yozai-Regular",
      textAlign: "left",
      text: "world!",
    },
  ],

  pages: [
    { ...pageTemplate },
    { ...pageTemplate },
    { ...pageTemplate },
    { ...pageTemplate },
    { ...pageTemplate },
    { ...pageTemplate },
    { ...pageTemplate },
  ],

  overlay: [
    { ...overlayTemplate},
  ],

  image: {
    width: 1080,
    height: 1350,
  },
} satisfies AppConfig;

export default config;

