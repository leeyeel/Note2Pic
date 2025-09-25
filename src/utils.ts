// utils.ts
import * as fs from "node:fs/promises";
import * as fssync from "node:fs";
import * as path from "node:path";
import type { Dirent } from "node:fs";

export const PROJECT_ROOT = path.resolve(__dirname, "../../");
export const TEMPLATE_DIR = path.join(PROJECT_ROOT, "template");
export const OUTPUT_DIR = path.join(PROJECT_ROOT, "output");

export interface FileInfo {
  relPath: string;
  absPath: string;
  size: number;
  mtime: string;
}

export interface TemplateFiles {
  templateDir: string;        // 模板目录绝对路径
  templateName: string;       // 模板名
  pngFiles: FileInfo[];       // 直接位于模板目录下的 *.png（cover.png / text.png / ending.png 等）
  assetFiles: FileInfo[];     // assets/*.png
}

export interface OutputList {
  outputDir: string;          // 输出目录绝对路径
  files: FileInfo[];          // 递归列出的所有文件
}

async function safeReaddir(dir: string, withTypes: true): Promise<Dirent[]>;
async function safeReaddir(dir: string, withTypes?: false): Promise<string[]>;

async function safeReaddir(dir: string, withTypes: boolean = false) {
  if (!fssync.existsSync(dir)) return [];
  if (withTypes === true) {
    return fs.readdir(dir, { withFileTypes: true });
  }
  return fs.readdir(dir);
}

async function toFileInfo(absPath: string, baseDir: string, relPath: string): Promise<FileInfo> {
  const st = await fs.stat(absPath);
  return {
    relPath,
    absPath,
    size: st.size,
    mtime: st.mtime.toISOString(),
  };
}

export async function rimraf(target: string): Promise<void> {
  if (!fssync.existsSync(target)) return;
  const st = await fs.lstat(target);
  if (st.isDirectory()) {
    const entries = await fs.readdir(target);
    for (const e of entries) {
      await rimraf(path.join(target, e));
    }
    await fs.rmdir(target);
  } else {
    await fs.unlink(target);
  }
}

export async function listTemplates(): Promise<string[]> {
  if (!fssync.existsSync(TEMPLATE_DIR)) return [];
  const entries = await fs.readdir(TEMPLATE_DIR, { withFileTypes: true });
  return entries.filter(e => e.isDirectory()).map(e => e.name);
}

export async function listTemplateFiles(templateName: string): Promise<TemplateFiles> {
  const templateDir = path.join(TEMPLATE_DIR, templateName);
  if (!fssync.existsSync(templateDir)) {
    throw new Error(`Template directory not found: ${templateDir}`);
  }

  const pngFiles: FileInfo[] = [];
  const assetFiles: FileInfo[] = [];

  const rootEntries = await safeReaddir(templateDir);
  for (const name of rootEntries as unknown as string[]) {
    if (name.toLowerCase().endsWith(".png")) {
      const abs = path.join(templateDir, name);
      const info = await toFileInfo(abs, templateDir, name);
      pngFiles.push(info);
    }
  }

  const assetsDir = path.join(templateDir, "assets");
  if (fssync.existsSync(assetsDir)) {
    const assetEntries = await safeReaddir(assetsDir);
    for (const name of assetEntries as unknown as string[]) {
      if (name.toLowerCase().endsWith(".png")) {
        const rel = path.join("assets", name);
        const abs = path.join(assetsDir, name);
        const info = await toFileInfo(abs, templateDir, rel);
        assetFiles.push(info);
      }
    }
  }

  return { templateDir, templateName, pngFiles, assetFiles };
}

export async function listOutputFiles(): Promise<OutputList> {
  async function walk(dir: string, baseDir: string, baseRel = ""): Promise<FileInfo[]> {
    if (!fssync.existsSync(dir)) return [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const out: FileInfo[] = [];
    for (const ent of entries) {
      const abs = path.join(dir, ent.name);
      const rel = path.join(baseRel, ent.name);
      if (ent.isDirectory()) {
        out.push(...(await walk(abs, baseDir, rel)));
      } else {
        out.push(await toFileInfo(abs, baseDir, rel));
      }
    }
    return out;
  }

  const files = await walk(OUTPUT_DIR, OUTPUT_DIR, "");
  return { outputDir: OUTPUT_DIR, files };
}

export async function checkFonts(fontsConfig: Record<string, { path: string; family: string }>) {
  const items = Object.entries(fontsConfig).map(([name, f]) => {
    const abs = path.isAbsolute(f.path) ? f.path : path.join(PROJECT_ROOT, f.path);
    const exists = fssync.existsSync(abs);
    return {
      name,
      family: f.family,
      path: abs,
      exists,
    };
  });
  return items;
}

/**
 * 将外部传入的相对路径限制在某个基目录内，避免目录穿越
 * @param baseDir 白名单基目录（绝对路径）
 * @param relPath 外部传入的相对路径（不允许以 / 或 .. 开头）
 * @returns 绝对路径（确保在 baseDir 范围内）
 */
export function resolveSafePath(baseDir: string, relPath: string): string {
  if (path.isAbsolute(relPath)) {
    throw new Error("Absolute paths are not allowed");
  }
  const safeRel = relPath.replace(/^[/\\]+/, "");
  const abs = path.resolve(baseDir, safeRel);

  const normBase = path.normalize(baseDir + path.sep);
  const normAbs = path.normalize(abs);
  if (!normAbs.startsWith(normBase)) {
    throw new Error("Path escape detected");
  }
  return abs;
}

export function existsSyncSafe(absPath: string): boolean {
  return fssync.existsSync(absPath);
}

