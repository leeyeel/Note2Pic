// render.ts
import * as fs from "node:fs/promises";
import * as fssync from "node:fs";
import * as path from "node:path";
import { createCanvas, loadImage, registerFont, CanvasRenderingContext2D } from "canvas";
import config, { AppConfig } from "./config";

const PROJECT_ROOT = path.resolve(__dirname, "../../");
console.log(PROJECT_ROOT)

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
      if (merged.pages[i]) Object.assign(merged.pages[i], partial);
    });
  }
  if (req.overrides?.overlay && Array.isArray(req.overrides.overlay)) {
    req.overrides.overlay.forEach((partial, i) => {
      if (merged.overlay[i]) Object.assign(merged.overlay[i], partial);
    });
  }

  return merged;
}

function splitIntoInlineSafeLines(content: string, charsPerLine: number): string[] {
  const lines: string[] = [];
  let i = 0;
  let visible = 0;
  let buf = "";
  const openStack: string[] = [];

  const isOpenTag = (tag: string) => tag.startsWith("c:") || tag.startsWith("s:");
  const isCloseTag = (tag: string) => tag === "/c" || tag === "/s";
  const closeTokenFor = (openTok: string) => {
    if (openTok.startsWith("c:")) return "</c>";
    if (openTok.startsWith("s:")) return "</s>";
    return "";
  };
  const openTokenToTag = (openTok: string) => `<${openTok}>`;

  const flushLine = (force = false) => {
    if (buf.length > 0 || force) {
      for (let k = openStack.length - 1; k >= 0; k--) {
        buf += closeTokenFor(openStack[k]);
      }
      lines.push(buf);
      buf = openStack.map(openTok => openTokenToTag(openTok)).join("");
      visible = 0;
    }
  };

  while (i < content.length) {
    const ch = content[i];

    if (ch === "\n") {
      flushLine(true);
      i++;
      continue;
    }

    if (ch === "<") {
      const closeIdx = content.indexOf(">", i);
      if (closeIdx !== -1) {
        const rawTag = content.slice(i + 1, closeIdx).trim();
        if (isOpenTag(rawTag)) {
          buf += `<${rawTag}>`;
          openStack.push(rawTag);
          i = closeIdx + 1;
          continue;
        } else if (isCloseTag(rawTag)) {
          buf += `<${rawTag}>`;
          const expected = rawTag === "/c" ? "c:" : "s:";
          for (let k = openStack.length - 1; k >= 0; k--) {
            if (openStack[k].startsWith(expected)) {
              openStack.splice(k, 1);
              break;
            }
          }
          i = closeIdx + 1;
          continue;
        }
        const token = content.slice(i, closeIdx + 1);
        if (visible + token.length > charsPerLine) {
          flushLine();
        }
        buf += token;
        visible += token.length;
        i = closeIdx + 1;
        continue;
      }
    }

    if (visible + 1 > charsPerLine) {
      flushLine();
    }
    buf += ch;
    visible += 1;
    i++;
  }

  if (buf.length > 0 || openStack.length > 0) {
    for (let k = openStack.length - 1; k >= 0; k--) {
      buf += closeTokenFor(openStack[k]);
    }
    lines.push(buf);
  }

  return lines;
}


type InlineSpan = { text: string; color?: string; fontSize?: number; };
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

function drawRichBlock(
  ctx: CanvasRenderingContext2D,
  content: string,
  base: Required<Pick<BaseTextStyle, "x"|"y"|"fontFamily"|"fontSize"|"lineHeight"|"textAlign"|"color">> & { maxLines?: number; charsPerLine?: number; width?: number; }
) {
  const charsPerLine = base.charsPerLine ?? 24;
  const lineHeight = base.lineHeight ?? Math.round(base.fontSize * 1.4);

  const allLines = splitIntoInlineSafeLines(content, charsPerLine);
  const maxLines = base.maxLines ?? allLines.length;
  const lines = allLines.slice(0, maxLines);

  for (let li = 0; li < lines.length; li++) {
    const lineText = lines[li];
    const spans = parseInline(lineText, { color: base.color, fontSize: base.fontSize });

    let cursorX = base.x;
    const y = base.y + li * lineHeight;

    for (const sp of spans) {
      ctx.font = `${sp.fontSize ?? base.fontSize}px "${base.fontFamily}"`;
      ctx.fillStyle = sp.color ?? base.color;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(sp.text, cursorX, y);
      const w = ctx.measureText(sp.text).width;
      cursorX += w;
    }
  }
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
  while (out.length < n) out.push(shuffled[out.length % shuffled.length]); // 池子不够 → 循环补齐
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
  if (!patch || patch.length === 0) {
    return cloneOverlay(base);
  }
  return cloneOverlay(base, patch);
}

export async function renderAll(request: RenderRequest): Promise<RenderResult> {
  const appcfg = applyOverrides(config, request);
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

  const W = appcfg.image.width;
  const H = appcfg.image.height;

  //title
  {
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");

    ctx.drawImage(coverBase, 0, 0, W, H);

    const layers = resolveOverlay(appcfg.overlay, request.overlayCover);
    await drawOverlays(ctx, W, H, layers, assets);

    const titleTexts = appcfg.title;
    for (let i = 0;  i < titleTexts.length; i++) {
      const t = appcfg.title[i];
      if (!t) continue;
      const lineHeight = t.lineHeight ?? Math.round((t.fontSize ?? 36) * 1.4);
      drawRichBlock(ctx, t.text || "", {
        x: t.x,
        y: t.y,
        fontFamily: t.fontFamily,
        fontSize: t.fontSize ?? 36,
        lineHeight,
        textAlign: t.textAlign,
        color: t.color ?? "#000000",
        maxLines: 1,
        charsPerLine: t.charsPerLine ?? 100,
        width: t.width,
      });
    }

    const coverOut = path.join(outDir, "cover.png");
    await fs.writeFile(coverOut, canvas.toBuffer("image/png"));
  }

  //text
  const textOutputs: string[] = [];
  {
    const pages = appcfg.pages;
    const pageCount = Math.max(1, Math.min(pages.length || 1, 6));
    for (let p = 0; p < pageCount; p++) {
      const ps = appcfg.pages[p];
      if (!ps.text) continue;
      const canvas = createCanvas(W, H);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(textBase, 0, 0, W, H);
      const pageOver = request.overlayPages?.[p];
      const layers = resolveOverlay(appcfg.overlay, pageOver);
      await drawOverlays(ctx, W, H, layers, assets);

      const lineHeight = ps.lineHeight ?? Math.round((ps.fontSize ?? 32) * 1.4);
      drawRichBlock(ctx, ps.text, {
        x: ps.x,
        y: ps.y,
        fontFamily: ps.fontFamily,
        fontSize: ps.fontSize ?? 32,
        lineHeight,
        textAlign: ps.textAlign,
        color: ps.color ?? "#000000",
        maxLines: ps.maxLines,
        charsPerLine: ps.charsPerLine ?? 24,
        width: ps.width,
      });

      const out = path.join(outDir, `text_${p + 1}.png`);
      await fs.writeFile(out, canvas.toBuffer("image/png"));
      textOutputs.push(out);
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

