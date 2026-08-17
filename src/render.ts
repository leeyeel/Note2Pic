// render.ts
import * as fs from "node:fs/promises";
import * as fssync from "node:fs";
import * as path from "node:path";
import { createCanvas, loadImage, registerFont, CanvasRenderingContext2D } from "canvas";
import config, { AppConfig } from "./config";

const PROJECT_ROOT = path.resolve(__dirname, "../../");

type TextAlign = "left" | "center" | "right" | "justify";

interface BaseTextStyle {
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
  minFontSize?: number;
  maxFontSize?: number;
  autoFit?: boolean;
  charsPerLine?: number;
}

interface OverlayPosition {
  asset?: string;
  x?: number; 
  y?: number;
  scale?: number;
  rotation?: number;
  alpha?: number;
}

interface OverlayConfig {
  enable: boolean;
  count: number;
  positions: OverlayPosition[];
  randomize: boolean;
  scaleRange: [number, number];
  rotationRange: [number, number];
  alphaRange: [number, number];
}

interface TemplatesConfig {
  baseDir: string;
  defaultName: string;
}

export interface RenderRequest {
  titleDir: string;

  templateName?: string;

  overrides?: Partial<Pick<AppConfig,
    "output" | "image" | "templates">> & {
      title?: Partial<BaseTextStyle>[];
      pages?: Partial<BaseTextStyle>[];
      overlay?: Partial<OverlayConfig>[];
    };

  titleTexts?: string[];

  /** Full article text. It is wrapped and split into as many images as needed. */
  content?: string;

  /** Legacy page input. Overflowing items continue on additional images. */
  pages?: string[];

  overlayCover?: Partial<OverlayConfig>[];
  overlayPages?: Partial<OverlayConfig>[][];
  overlayEnding?: Partial<OverlayConfig>[];
}

export interface RenderResult {
  cover: string;
  texts: string[];
  ending: string;
  outputDir: string;
}

function ensureDirSync(dir: string) {
  if (!fssync.existsSync(dir)) fssync.mkdirSync(dir, { recursive: true });
}

function applyEnvOverrides(cfg: AppConfig): AppConfig {
  const updated = structuredClone(cfg);

  const pageFontEnv = process.env.PAGE_FONT_SIZE;
  if (pageFontEnv && !isNaN(Number(pageFontEnv))) {
    const fontSize = Number(pageFontEnv);
    updated.pages = updated.pages.map((page) => ({
      ...page,
      fontSize,
      minFontSize: fontSize,
      maxFontSize: fontSize,
      autoFit: false,
    }));
  }

  const titleFontEnv = process.env.TITLE_LINE1_FONT_SIZE;
  if (titleFontEnv && !isNaN(Number(titleFontEnv))) {
    if (updated.title.length > 2 && updated.title[1]) {
      const fontSize = Number(titleFontEnv);
      updated.title[1].fontSize = fontSize;
      updated.title[1].minFontSize = fontSize;
      updated.title[1].maxFontSize = fontSize;
      updated.title[1].autoFit = false;
    }
  }

  return updated;
}

function applyOverrides(base: AppConfig, req: RenderRequest): AppConfig {
  const merged: AppConfig = structuredClone(base);

  if (req.overrides?.output) Object.assign(merged.output, req.overrides.output);
  if (req.overrides?.image) Object.assign(merged.image, req.overrides.image);
  if (req.overrides?.templates) Object.assign(merged.templates, req.overrides.templates);

  if (req.overrides?.title && Array.isArray(merged.title)) {
    req.overrides.title.forEach((partial, i) => {
      if (merged.title[i]) Object.assign(merged.title[i], partial);
    });
  }
  if (req.overrides?.pages && Array.isArray(req.overrides.pages)) {
    req.overrides.pages.forEach((partial, i) => {
      if (!merged.pages[i] && merged.pages[0]) {
        merged.pages[i] = structuredClone(merged.pages[0]);
      }
      if (merged.pages[i]) Object.assign(merged.pages[i], partial);
    });
  }
  if (req.overrides?.overlay && Array.isArray(req.overrides.overlay)) {
    req.overrides.overlay.forEach((partial, i) => {
      if (merged.overlay[i]) Object.assign(merged.overlay[i], partial);
    });
  }

  if (req.titleTexts && Array.isArray(merged.title)) {
    req.titleTexts.forEach((txt, i) => {
      if (!merged.title[i]) return;
      merged.title[i].text = (txt ?? "").toString();
    });
  }

  if (req.pages && Array.isArray(merged.pages)) {
    req.pages.forEach((txt, i) => {
      if (!merged.pages[i] && merged.pages[0]) {
        merged.pages[i] = structuredClone(merged.pages[0]);
      }
      if (!merged.pages[i]) return;
      merged.pages[i].text = (txt ?? "").toString();
    });
  }

  return merged;
}

type InlineSpan = { text: string; color?: string; fontSize?: number; };
type RichLine = { spans: InlineSpan[]; width: number; height: number; };

interface TextLayoutStyle {
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  minFontSize?: number;
  maxFontSize?: number;
  autoFit?: boolean;
  lineHeight?: number;
  maxLines?: number;
  fontFamily: string;
  textAlign: TextAlign;
  color: string;
}

function parseInline(text: string, base: { color: string; fontSize: number; }): InlineSpan[] {
  const spans: InlineSpan[] = [];
  const stack: { color?: string; fontSize?: number }[] = [ { color: base.color, fontSize: base.fontSize } ];
  let i = 0, buf = "";

  const pushBuf = () => {
    if (!buf) return;
    const top = stack[stack.length - 1]!;
    spans.push({ text: buf, color: top.color, fontSize: top.fontSize });
    buf = "";
  };

  while (i < text.length) {
    if (text[i] === "<") {
      const closeIdx = text.indexOf(">", i);
      if (closeIdx === -1) { buf += text[i++]; continue; }
      const tag = text.slice(i + 1, closeIdx).trim();
      if (tag === "/c" || tag === "/s") {
        pushBuf();
        const prev = stack.pop();
        if (stack.length === 0) stack.push(prev ?? { color: base.color, fontSize: base.fontSize });
        i = closeIdx + 1;
        continue;
      }
      if (tag.startsWith("c:") || tag.startsWith("s:")) {
        pushBuf();
        const top = { ...stack[stack.length - 1] };
        if (tag.startsWith("c:")) top.color = tag.slice(2);
        if (tag.startsWith("s:")) {
          const num = Number(tag.slice(2));
          if (!Number.isNaN(num) && num > 0) top.fontSize = num;
        }
        stack.push(top);
        i = closeIdx + 1;
        continue;
      }
      buf += text.slice(i, closeIdx + 1);
      i = closeIdx + 1;
    } else {
      buf += text[i++];
    }
  }
  pushBuf();
  return spans;
}

function normalizeNewlines(s: string): string {
  if (!s) return s;
  return s
    .replace(/\r\n/g, "\n")  // CRLF -> LF
    .replace(/\r/g, "\n")    // CR -> LF
    .replace(/\\n/g, "\n");  // 字面量 \n -> 真换行
}

function setFont(ctx: CanvasRenderingContext2D, fontSize: number, fontFamily: string) {
  ctx.font = `${fontSize}px "${fontFamily}"`;
}

function measureSpan(ctx: CanvasRenderingContext2D, span: InlineSpan, fontFamily: string, fallbackSize: number) {
  setFont(ctx, span.fontSize ?? fallbackSize, fontFamily);
  return ctx.measureText(span.text).width;
}

function addSpan(spans: InlineSpan[], span: InlineSpan, text: string) {
  if (!text) return;
  const last = spans[spans.length - 1];
  if (last && last.color === span.color && last.fontSize === span.fontSize) {
    last.text += text;
  } else {
    spans.push({ text, color: span.color, fontSize: span.fontSize });
  }
}

function splitTextTokens(text: string): string[] {
  const tokens: string[] = [];
  let asciiWord = "";
  const flushWord = () => {
    if (asciiWord) tokens.push(asciiWord);
    asciiWord = "";
  };

  for (const char of Array.from(text)) {
    if (char === "\n") {
      flushWord();
      tokens.push(char);
    } else if (/\s/.test(char)) {
      flushWord();
      tokens.push(char);
    } else if (/[A-Za-z0-9_@#%&+=:/?.-]/.test(char)) {
      asciiWord += char;
    } else {
      flushWord();
      tokens.push(char);
    }
  }
  flushWord();
  return tokens;
}

function lineHeightFor(spans: InlineSpan[], style: TextLayoutStyle, baseFontSize: number) {
  const largest = spans.reduce((size, span) => Math.max(size, span.fontSize ?? baseFontSize), baseFontSize);
  const ratio = style.lineHeight ? style.lineHeight / style.fontSize : 1.45;
  return Math.ceil(Math.max(baseFontSize * ratio, largest * ratio));
}

function wrapRichText(
  ctx: CanvasRenderingContext2D,
  content: string,
  style: TextLayoutStyle,
  fontSize: number
): RichLine[] {
  const lines: RichLine[] = [];
  let spans: InlineSpan[] = [];
  let width = 0;
  const maxWidth = Math.max(1, style.width);

  const flush = (force = false) => {
    if (spans.length > 0 || force) {
      lines.push({
        spans,
        width,
        height: lineHeightFor(spans, style, fontSize),
      });
      spans = [];
      width = 0;
    }
  };

  const append = (span: InlineSpan, text: string) => {
    addSpan(spans, span, text);
    width += measureSpan(ctx, { ...span, text }, style.fontFamily, fontSize);
  };

  const appendLongToken = (span: InlineSpan, token: string) => {
    for (const char of Array.from(token)) {
      const charWidth = measureSpan(ctx, { ...span, text: char }, style.fontFamily, fontSize);
      if (spans.length > 0 && width + charWidth > maxWidth) flush();
      append(span, char);
    }
  };

  const takeLastCharacter = (): InlineSpan | undefined => {
    const last = spans[spans.length - 1];
    if (!last) return undefined;
    const characters = Array.from(last.text);
    const text = characters.pop();
    if (!text) return undefined;

    last.text = characters.join("");
    if (!last.text) spans.pop();
    width -= measureSpan(ctx, { ...last, text }, style.fontFamily, fontSize);
    return { ...last, text };
  };

  for (const originalSpan of parseInline(normalizeNewlines(content), { color: style.color, fontSize })) {
    const span = { ...originalSpan, fontSize: originalSpan.fontSize ?? fontSize };
    for (const token of splitTextTokens(span.text)) {
      if (token === "\n") {
        flush(true);
        continue;
      }

      const isWhitespace = /^\s+$/.test(token);
      if (isWhitespace && spans.length === 0) continue;

      const tokenWidth = measureSpan(ctx, { ...span, text: token }, style.fontFamily, fontSize);
      if (width + tokenWidth <= maxWidth) {
        append(span, token);
      } else if (isWhitespace) {
        flush();
      } else if (/^[,.;:!?，。！？；：、】【》」』”’]$/.test(token) && spans.length > 0) {
        // Keep closing punctuation with the preceding character instead of
        // producing a visually awkward one-character punctuation line.
        const previousCharacter = takeLastCharacter();
        flush();
        if (previousCharacter) append(previousCharacter, previousCharacter.text);
        append(span, token);
      } else if (spans.length > 0) {
        flush();
        if (tokenWidth <= maxWidth) append(span, token);
        else appendLongToken(span, token);
      } else {
        appendLongToken(span, token);
      }
    }
  }

  flush();
  return lines;
}

function totalHeight(lines: RichLine[]) {
  return lines.reduce((height, line) => height + line.height, 0);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function chooseTextLayout(ctx: CanvasRenderingContext2D, content: string, style: TextLayoutStyle) {
  const min = Math.max(1, Math.round(style.minFontSize ?? style.fontSize));
  const max = Math.max(min, Math.round(style.maxFontSize ?? style.fontSize));
  const preferred = clamp(Math.round(style.fontSize), min, max);
  const fits = (lines: RichLine[]) => {
    if (lines.length === 0) return true;
    const lastLine = lines[lines.length - 1];
    const lastLineCharacters = Array.from(lastLine.spans.map((span) => span.text).join(""))
      .filter((character) => !/\s/.test(character)).length;
    const hasOrphanedLastLine =
      lines.length > 1 && (lastLine.width < style.width * 0.13 || lastLineCharacters <= 2);
    return (
      totalHeight(lines) <= style.height &&
      (!style.maxLines || lines.length <= style.maxLines) &&
      !hasOrphanedLastLine
    );
  };

  if (style.autoFit !== false) {
    for (let size = max; size >= min; size--) {
      const lines = wrapRichText(ctx, content, style, size);
      if (fits(lines)) return { fontSize: size, lines };
    }
  }

  return { fontSize: preferred, lines: wrapRichText(ctx, content, style, preferred) };
}

function paginateLines(lines: RichLine[], style: TextLayoutStyle): RichLine[][] {
  if (lines.length === 0) return [];

  const pages: RichLine[][] = [];
  let page: RichLine[] = [];
  let pageHeight = 0;
  const maxLines = style.maxLines ?? Number.POSITIVE_INFINITY;

  for (const line of lines) {
    const exceedsHeight = page.length > 0 && pageHeight + line.height > style.height;
    const exceedsLineCount = page.length >= maxLines;
    if (exceedsHeight || exceedsLineCount) {
      pages.push(page);
      page = [];
      pageHeight = 0;
    }
    page.push(line);
    pageHeight += line.height;
  }
  if (page.length > 0) pages.push(page);
  return pages;
}

function drawRichLines(ctx: CanvasRenderingContext2D, lines: RichLine[], style: TextLayoutStyle) {
  let y = style.y;
  for (const line of lines) {
    let cursorX = style.x;
    if (style.textAlign === "center") cursorX += Math.max(0, (style.width - line.width) / 2);
    if (style.textAlign === "right") cursorX += Math.max(0, style.width - line.width);

    for (const span of line.spans) {
      const size = span.fontSize ?? style.fontSize;
      setFont(ctx, size, style.fontFamily);
      ctx.fillStyle = span.color ?? style.color;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(span.text, cursorX, y);
      cursorX += ctx.measureText(span.text).width;
    }
    y += line.height;
  }
}

function drawRichBlock(ctx: CanvasRenderingContext2D, content: string, style: TextLayoutStyle) {
  const layout = chooseTextLayout(ctx, content, style);
  const firstPage = paginateLines(layout.lines, style)[0] ?? [];
  drawRichLines(ctx, firstPage, { ...style, fontSize: layout.fontSize });
  return layout.fontSize;
}

async function loadTemplateImages(templates: TemplatesConfig, templateName?: string) {
  const name = templateName || templates.defaultName;
  const baseDirAbs = path.isAbsolute(templates.baseDir)
    ? templates.baseDir
    : path.resolve(PROJECT_ROOT, templates.baseDir);
  const base = path.join(baseDirAbs, name);
  const coverPath = path.join(base, "cover.png");
  const textPath = path.join(base, "text.png");
  const endingPath = path.join(base, "ending.png");
  const assetsDir = path.join(base, "assets");

  await Promise.all([coverPath, textPath, endingPath].map(async p => {
    const st = await fs.stat(p).catch(() => null);
    if (!st) throw new Error(`Template image missing: ${p}`);
  }));

  const assets: string[] = [];
  if (fssync.existsSync(assetsDir)) {
    const files = await fs.readdir(assetsDir);
    files.filter(f => f.toLowerCase().endsWith(".png")).forEach(f => {
      assets.push(path.join(assetsDir, f));
    });
  }

  return { coverPath, textPath, endingPath, assets };
}

function registerAllFonts(appcfg: AppConfig) {
    Object.values(appcfg.fonts).forEach(f => {
        const absPath = path.isAbsolute(f.path)
            ? f.path
            : path.resolve(PROJECT_ROOT, f.path);

            try {
                registerFont(absPath, { family: f.family });
            } catch (e) {
                console.warn(`Font register warning for ${absPath}:`, (e as Error).message);
            }
    });
}

function chooseAssets(pool: string[], n: number, preferDistinct = true): string[] {
  if (n <= 0 || pool.length === 0) return [];
  if (!preferDistinct) {
    const out: string[] = [];
    for (let i = 0; i < n; i++) out.push(pool[i % pool.length]);
    return out;
  }
  const shuffled = pool.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const k = Math.min(n, shuffled.length);
  const out = shuffled.slice(0, k);
  while (out.length < n) out.push(shuffled[out.length % shuffled.length]);
  return out;
}

function randBetween(a: number, b: number) {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return lo + Math.random() * (hi - lo);
}

async function drawOverlays(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  layers: OverlayConfig[] | undefined,
  assetsPool: string[]
) {
  if (!layers || layers.length === 0) return;

  for (const layer of layers) {
    if (!layer?.enable) continue;

    const count = Math.max(0, Math.floor(layer.count ?? 0));
    if (count === 0) continue;


    const chosenAssets = chooseAssets(assetsPool, count, /*preferDistinct*/ true);

    for (let i = 0; i < count; i++) {
      const pos = (layer.positions && layer.positions[i]) ? layer.positions[i] as any : {};

      let assetPath: string | undefined;
      if (pos.asset) {
        const base = String(pos.asset).trim().toLowerCase();
        assetPath = assetsPool.find(p => p.toLowerCase().endsWith("/" + base) || p.toLowerCase().endsWith("\\" + base));
      }
      if (!assetPath) assetPath = chosenAssets[i];

      if (!assetPath) continue;

      const img = await loadImage(assetPath);

      const scale = (pos.scale ?? (layer.randomize ? randBetween(layer.scaleRange[0], layer.scaleRange[1]) : 1));
      const rotDeg = (pos.rotation ?? (layer.randomize ? randBetween(layer.rotationRange[0], layer.rotationRange[1]) : 0));
      const alpha = (pos.alpha ?? (layer.randomize ? randBetween(layer.alphaRange[0], layer.alphaRange[1]) : 1));

      const w = img.width * scale;
      const h = img.height * scale;

      let x = pos.x;
      let y = pos.y;
      if (typeof x !== "number" || typeof y !== "number") {
        if (layer.randomize) {
          x = randBetween(0, Math.max(0, canvasW - w));
          y = randBetween(0, Math.max(0, canvasH - h));
        } else {
          x = x ?? 0;
          y = y ?? 0;
        }
      }

      ctx.save();
      ctx.globalAlpha = alpha;

      ctx.translate(x, y);
      ctx.rotate(rotDeg * Math.PI / 180);

      ctx.drawImage(img, 0, 0, w, h);
      ctx.restore();
    }
  }
}

function cloneOverlay(base: OverlayConfig[] | undefined, patch?: Partial<OverlayConfig>[]) {
  if (!base) return undefined;
  const arr = base.map(o => ({ ...o, positions: o.positions?.map(p => ({...p})) ?? [] }));
  if (!patch) return arr;
  patch.forEach((p, i) => {
    if (!arr[i]) return;
    Object.assign(arr[i], p);
    if (p.positions) arr[i].positions = p.positions.map(pp => ({...pp}));
  });
  return arr;
}

function resolveOverlay(base: OverlayConfig[] | undefined, patch?: Partial<OverlayConfig>[]): OverlayConfig[] | undefined {
  if (!patch) {
    return cloneOverlay(base);
  }
  if (patch.length === 0) return [];
  return cloneOverlay(base, patch);
}

export async function renderAll(request: RenderRequest): Promise<RenderResult> {
  const config_env = applyEnvOverrides(config);
  const appcfg = applyOverrides(config_env, request);
  registerAllFonts(appcfg);

  const { coverPath, textPath, endingPath, assets } =
    await loadTemplateImages(appcfg.templates, request.templateName);

  const outputBase = path.isAbsolute(appcfg.output.directory)
  ? appcfg.output.directory
  : path.resolve(PROJECT_ROOT, appcfg.output.directory);

  const outDir = path.join(outputBase, request.titleDir);
  ensureDirSync(outDir);

  const coverBase = await loadImage(coverPath);
  const textBase  = await loadImage(textPath);
  const endingBase= await loadImage(endingPath);

  const W = appcfg.image.width || textBase.width;
  const H = appcfg.image.height || textBase.height;

  //title
  {
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");

    ctx.drawImage(coverBase, 0, 0, W, H);

    const layers = resolveOverlay(appcfg.overlay, request.overlayCover);
    await drawOverlays(ctx, W, H, layers, assets);

    const titleTexts = appcfg.title;
    for (let i = 0; i < titleTexts.length; i++) {
      const t = appcfg.title[i];
      if (!t) continue;
      drawRichBlock(ctx, t.text || "", {
        x: t.x,
        y: t.y,
        fontFamily: t.fontFamily,
        fontSize: t.fontSize ?? 36,
        minFontSize: t.minFontSize,
        maxFontSize: t.maxFontSize,
        autoFit: t.autoFit,
        lineHeight: t.lineHeight,
        textAlign: t.textAlign,
        color: t.color ?? "#000000",
        maxLines: 1,
        width: Math.max(1, Math.min(t.width ?? W - t.x - 80, W - t.x)),
        height: Math.max(1, Math.min(t.height ?? t.fontSize * 1.6, H - t.y)),
      });
    }

    const coverOut = path.join(outDir, "cover.png");
    await fs.writeFile(coverOut, canvas.toBuffer("image/png"));
  }

  //text
  const textOutputs: string[] = [];
  {
    const hasContent = typeof request.content === "string" && request.content.trim().length > 0;
    const sources = hasContent
      ? [{ text: request.content!, style: appcfg.pages[0] }]
      : appcfg.pages
          .filter((page) => page?.text?.trim())
          .map((page) => ({ text: page.text!, style: page }));

    for (const source of sources) {
      const ps = source.style;
      if (!ps) continue;

      const style: TextLayoutStyle = {
        x: ps.x,
        y: ps.y,
        width: Math.max(1, Math.min(ps.width ?? W - ps.x - 80, W - ps.x)),
        height: Math.max(1, Math.min(ps.height ?? H - ps.y - 80, H - ps.y)),
        fontFamily: ps.fontFamily,
        fontSize: ps.fontSize ?? 32,
        minFontSize: ps.minFontSize,
        maxFontSize: ps.maxFontSize,
        autoFit: ps.autoFit,
        lineHeight: ps.lineHeight,
        textAlign: ps.textAlign,
        color: ps.color ?? "#000000",
        maxLines: ps.maxLines,
      };
      const measureCanvas = createCanvas(1, 1);
      const layout = chooseTextLayout(measureCanvas.getContext("2d"), source.text, style);
      const pageGroups = paginateLines(layout.lines, style);

      for (const pageLines of pageGroups) {
        const canvas = createCanvas(W, H);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(textBase, 0, 0, W, H);
        const pageOver = request.overlayPages?.[textOutputs.length];
        const layers = resolveOverlay(appcfg.overlay, pageOver);
        await drawOverlays(ctx, W, H, layers, assets);
        drawRichLines(ctx, pageLines, { ...style, fontSize: layout.fontSize });

        const out = path.join(outDir, `text_${textOutputs.length + 1}.png`);
        await fs.writeFile(out, canvas.toBuffer("image/png"));
        textOutputs.push(out);
      }
    }
  }

  //ending
  {
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(endingBase, 0, 0, W, H);

    const layers = resolveOverlay(appcfg.overlay, request.overlayEnding);
    await drawOverlays(ctx, W, H, layers, assets);

    const endingOut = path.join(outDir, "ending.png");
    await fs.writeFile(endingOut, canvas.toBuffer("image/png"));
  }

  return {
    cover: path.join(outDir, "cover.png"),
    texts: textOutputs,
    ending: path.join(outDir, "ending.png"),
    outputDir: outDir,
  };
}
