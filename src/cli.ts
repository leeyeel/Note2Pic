#!/usr/bin/env node

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { SimpleRenderInputSchema, toRenderRequest } from "./schema";
import type { RenderResult } from "./render";

type Command = "render" | "validate";

interface CliOptions {
  command: Command;
  input: string;
  outputDirectory?: string;
  templateDirectory?: string;
  pretty: boolean;
}

const titleDirectoryPattern = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function usage() {
  return [
    "Usage: note2pic <render|validate> --input <file|-> [options]",
    "",
    "Options:",
    "  --input <file|->          JSON request file, or - to read stdin",
    "  --output-dir <directory>  Output root; defaults to ./output",
    "  --template-root <dir>     Template root containing <templateName>/",
    "  --pretty                  Pretty-print the JSON manifest",
    "  --help                    Show this help text",
  ].join("\n");
}

function parseArgs(argv: string[]): CliOptions | null {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") return null;

  const command = argv[0];
  if (command !== "render" && command !== "validate") {
    throw new Error(`Unknown command: ${command}`);
  }

  const options: Partial<CliOptions> = { command, pretty: false };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--pretty") {
      options.pretty = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") return null;
    if (argument === "--input" || argument === "--output-dir" || argument === "--template-root") {
      const value = argv[index + 1];
      if (!value) throw new Error(`Missing value for ${argument}`);
      index += 1;
      if (argument === "--input") options.input = value;
      if (argument === "--output-dir") options.outputDirectory = value;
      if (argument === "--template-root") options.templateDirectory = value;
      continue;
    }
    throw new Error(`Unknown option: ${argument}`);
  }

  if (!options.input) throw new Error("--input is required");
  return options as CliOptions;
}

async function readInput(input: string) {
  const raw = input === "-"
    ? await new Promise<string>((resolve, reject) => {
        let body = "";
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", (chunk) => { body += chunk; });
        process.stdin.on("end", () => resolve(body));
        process.stdin.on("error", reject);
      })
    : await fs.readFile(path.resolve(process.cwd(), input), "utf8");

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Input is not valid JSON: ${(error as Error).message}`);
  }
}

function resolveOptionalPath(value: string | undefined) {
  return value ? path.resolve(process.cwd(), value) : undefined;
}

function assertSafeTitleDirectory(titleDir: string) {
  if (!titleDirectoryPattern.test(titleDir)) {
    throw new Error("titleDir must use letters, numbers, _ or -, and cannot start with _ or -");
  }
}

function assertSupportedNodeVersion() {
  const major = Number(process.versions.node.split(".", 1)[0]);
  if (!Number.isInteger(major) || major < 20 || major >= 22) {
    throw new Error("note2pic requires Node 20.x because canvas@2.11.2 is not supported by this runtime");
  }
}

function manifest(result: RenderResult) {
  return {
    ok: true,
    outputDir: result.outputDir,
    files: [
      { kind: "cover", path: result.cover },
      ...result.texts.map((file, index) => ({ kind: `text_${index + 1}`, path: file })),
      { kind: "ending", path: result.ending },
    ],
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  assertSupportedNodeVersion();
  const input = SimpleRenderInputSchema.parse(await readInput(options.input));
  assertSafeTitleDirectory(input.titleDir);
  const request = toRenderRequest(input, {
    outputDirectory: resolveOptionalPath(options.outputDirectory),
    templateDirectory: resolveOptionalPath(options.templateDirectory),
  });
  const { renderAll, validateRenderRequest } = await import("./render");
  const validation = await validateRenderRequest(request);

  const result = options.command === "validate"
    ? { ok: true, ...validation }
    : manifest(await renderAll(request));
  process.stdout.write(`${JSON.stringify(result, null, options.pretty ? 2 : undefined)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`note2pic: ${message}\n`);
  process.exitCode = 1;
});
