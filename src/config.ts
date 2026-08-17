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
  /** Smallest size used when automatic fitting needs to shrink text. */
  minFontSize?: number;
  /** Largest size used when automatic fitting has room to grow text. */
  maxFontSize?: number;
  /** Set to false only when a caller needs to keep an exact font size. */
  autoFit?: boolean;
  /**
   * Legacy character-based wrapping setting. New layouts measure real glyph
   * widths, so this is retained only for backwards-compatible input.
   */
  charsPerLine?: number;
}

export interface OverlayConfig {
  enable: boolean;
  count: number;
  positions: Record<string, unknown>[];
  randomize: boolean;
  scaleRange: [number, number];
  rotationRange: [number, number];
  alphaRange: [number, number];
}

export interface ImageConfig {
  width: number;
  height: number;
}

export interface AppConfig {
  fonts: Record<string, FontDef>;
  templates: TemplatesConfig;
  output: OutputConfig;
  title: BaseTextStyle[];
  pages: BaseTextStyle[];
  overlay: OverlayConfig[];
  image: ImageConfig;
}

export const pageTemplate = {
  x: 100,
  y: 500,
  width: 880,
  height: 670,
  fontSize: 42,
  minFontSize: 32,
  maxFontSize: 46,
  autoFit: true,
  color: "#000000",
  fontFamily: "Yozai-Regular",
  textAlign: "left" as const,
  enableInlineMarkup: true,
  text: "",
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
      width: 580,
      minFontSize: 46,
      autoFit: true,
      text: "",
    },
    {
      x: 200,
      y: 650,
      fontSize: 120,
      color: "#000000",
      fontFamily: "Yozai-Medium",
      textAlign: "left",
      width: 680,
      minFontSize: 56,
      autoFit: true,
      text: "hello",
    },
    {
      x: 300,
      y: 900,
      fontSize: 72,
      color: "#000000",
      fontFamily: "Yozai-Regular",
      textAlign: "left",
      width: 580,
      minFontSize: 46,
      autoFit: true,
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
    height: 1440,
  },
} satisfies AppConfig;

export default config;
