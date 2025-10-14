// note2pic-mcp.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  ToolSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import path from "node:path";
import config from "../src/config";
import { renderAll } from "../src/render";

const PROJECT_ROOT = path.resolve(__dirname, "../../");
export const outputBase = path.isAbsolute(config.output.directory)
  ? config.output.directory
  : path.resolve(PROJECT_ROOT, config.output.directory);
export const PUBLIC_BASE = process.env.PUBLIC_BASE ?? `http://localhost:${process.env.PORT ?? 3001}`;

const ToolInputSchema = ToolSchema.shape.inputSchema;
type ToolInput = z.infer<typeof ToolInputSchema>;

//simple schema
const TitleSchema = z.object({
  line1: z.string().describe(
    "标题第1段（≤10个汉字）。用于引入，不宜过长。建议简短有力。可使用内联语法更改颜色及字号:（示例：<c:#ff4d4f>重点词</c> 或 <s:70>加大字号</s>）"
  ),
  line2: z.string().describe(
    "标题第2段（重点，≤7个汉字）。整条标题视觉重心放在此处，建议突出利益点/痛点。可使用内联语法更改颜色及字号:（示例：<c:#ff4d4f>重点词</c> 或 <s:70>加大字号</s>）"
  ),
  line3: z.string().describe(
    "标题第3段（≤10个汉字）。用于收束或补充信息，可加入行动号召。可使用内联语法更改颜色及字号:（示例：<c:#ff4d4f>重点词</c> 或 <s:70>加大字号</s>）"
  ),
}).describe(
  "小红书三段式标题规范：第一段≤10汉字、第二段≤7汉字（重点）、第三段≤10汉字；整体风格和语气应贴合小红书的宝妈群体，亲切、有同理心、可读性强。"
);

const PageSchema = z.object({
  text: z.string().describe(
    "本页正文内容。建议每行≤20个汉字，工具会在合适位置自动换行；可使用内联样式标记关键词（示例：<c:#ff4d4f>重点词</c> 或 <s:70>加大字号</s>）。"
  ),
}).describe("正文段落：按行展示（需要换行，每行≤20汉字），内容最好在6-10行之间。支持简单内联样式以增强可读性。");

const MinimalRenderInputSchema = z.object({
    titleDir: z.string().min(1, "titleDir 不能为空,会作为输出图片的目录名,不要有空格"),
    templateName: z.string().optional().default("default"),
    title: TitleSchema.strict(),
    pages: z.array(PageSchema).min(1).max(7),
    disableOverlay: z.boolean().optional(),
}).strict();

//advanced schema
const FontDefSchema = z.object({
    path: z.string().min(1, "字体文件路径必填"),
    family: z.string().min(1, "font family 必填"),
    name: z.string().min(1, "font name 必填"),
}).strict();

const OverlayItemSchema = z.object({
    file: z.string().min(1, "overlay 文件路径必填"),
    x: z.number().optional(),
    y: z.number().optional(),
    w: z.number().optional(),
    h: z.number().optional(),
    opacity: z.number().min(0).max(1).optional(),
    rotate: z.number().optional(),
    zIndex: z.number().optional(),
}).strict();

const AdvancedTitleSchema = z.object({
    line1: z.string().optional(),
    line2: z.string().min(1, "标题 line2 不能为空"),
    line3: z.string().optional(),
    style: z.object({
        fontSize: z.number().positive().optional(),
        color: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "必须是有效的十六进制颜色值").optional(),
        fontFamily: z.string().optional(),
        textAlign: z.enum(["left", "center", "right"]).optional(),
    }).optional(),
}).strict();

const AdvancedPageSchema = z.object({
    text: z.string().min(1, "页面文本不能为空"),
    style: z.object({
        fontSize: z.number().positive().optional(),
        color: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "必须是有效的十六进制颜色值").optional(),
        fontFamily: z.string().optional(),
        textAlign: z.enum(["left", "center", "right"]).optional(),
      }).optional(),
    overlay: z.array(OverlayItemSchema).optional(),
}).strict();

const OutputFormatEnum = z.enum(["png", "jpg", "jpeg", "webp"]);

const AdvancedRenderInputSchema = z.object({
    titleDir: z.string().min(1, "titleDir 不能为空,会作为输出图片的目录名,不要有空格"),
    templateName: z.string().optional().default("default"),

    title: AdvancedTitleSchema.strict(),
    pages: z.array(AdvancedPageSchema).min(1).max(7),

    disableOverlay: z.boolean().optional(),
    overlay: z.object({
        cover: z.array(OverlayItemSchema).optional(),
        pages: z.array(OverlayItemSchema).optional(),
        ending: z.array(OverlayItemSchema).optional(),
      }).optional(),

    output: z.object({
        format: OutputFormatEnum.optional().default("png"),
        quality: z.number().min(1).max(100).optional().default(92),
        width: z.number().positive().optional(),
        height: z.number().positive().optional(),
      }).optional(),
    fonts: z.array(FontDefSchema).optional(),
}).strict();

enum ToolName {
    GENERATE_SIMPLE = "generate_simple",
    GENERATE_ADVANCED = "generate_advanced",
    READ_FILE = "read_file",
    LIST_TEMPLATES = "list_templates",
    LIST_TEMPLATE_FILES = "list_template_files",
    LIST_OUTPUT = "list_output",
    CHECK_FONTS = "check_fonts",
    RM_OUTPUT = "rm_output",
    DOCS = "docs",
}

function toPublicUrl(absPath: string) {
  const rel = path.relative(outputBase, absPath).split(path.sep).join("/");
  return `${PUBLIC_BASE}/outputs/${encodeURI(rel)}`;
}

export function createMCPServer() {
  const server = new Server(
  { 
      name: "note2pic-mcp-server", 
      title: "note2pic mcp server", 
      version: "0.1.0" 
  },
  { 
      capabilities: {
        prompts: {},
        resources: { subscribe: true },
        tools: {},
        completions: {}
      },
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools: Tool[] = [
      {
        name: ToolName.GENERATE_SIMPLE,
        description: "生成适配小红书（目标用户：宝妈）的图片海报：三段式标题（1≤10汉字、2≤7汉字、3≤10汉字，重点在第二段）+ 正文自动换行（每行≤24汉字, 每页最多10行，总共7页内容），标题及征文均支持内联样式高亮关键词（颜色/字号）。返回HTTP下载链接。",
        inputSchema: zodToJsonSchema(MinimalRenderInputSchema) as ToolInput,
      },
    ];
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    if (name === ToolName.GENERATE_SIMPLE) {
      const input = MinimalRenderInputSchema.parse(args);
      const {titleDir, templateName = "default", title, pages, disableOverlay} = input;
      const titleTexts = [
        title.line1 ?? "",
        title.line2 ?? "",
        title.line3 ?? "",
      ];
      const pageTexts = pages.map(p => p.text ?? "");
      const request: any = {
        titleDir,
        templateName,
        titleTexts, 
        pages: pageTexts,
      };
      if (disableOverlay === true) {
        request.overlayCover = [];
        request.overlayPages = [];
        request.overlayEnding = [];
      }
      const result = await renderAll(request);
      const files = [
        { kind: "cover",  abs: result.cover },
        ...result.texts.map((p, i) => ({ kind: `text_${i+1}`, abs: p })),
          { kind: "ending", abs: result.ending },
      ];
      const outputs = files.map(f => ({
        kind:     f.kind,
        filename: path.basename(f.abs),
        url:      toPublicUrl(f.abs),
      }));

      return {
        content: [
          { type: "text", text: "✅ Image(s) generated. Download URLs are ready." },
          { type: "text", text: outputs.map(o => `${o.kind}: ${o.url}`).join("\n") }
        ],
        metadata: {
          outputs,
          outputDir: result.outputDir,
          publicBase: PUBLIC_BASE,
        },
      };
    }
    if (name === ToolName.GENERATE_ADVANCED) {
      const input = AdvancedRenderInputSchema.parse(args);
      const {titleDir, templateName = "default", title, pages, disableOverlay, overlay, output: outputOpts, fonts} = input;
      const titleTexts = [
        title.line1 ?? "",
        title.line2 ?? "",
        title.line3 ?? "",
      ];
      const pageTexts = pages.map(p => p.text ?? "");
      const request: any = {
        titleDir,
        templateName,
        titleTexts, 
        pages: pageTexts,
        advancedTitleStyle: title.style,
        advancedPageStyles: pages.map(p => p.style),
      };
      if (disableOverlay === true) {
        request.overlayCover = [];
        request.overlayPages = [];
        request.overlayEnding = [];
      } else {
        if (overlay?.cover)   request.overlayCover = overlay.cover;
        if (overlay?.pages)   request.overlayPages = overlay.pages;
        if (overlay?.ending)  request.overlayEnding = overlay.ending;
      }
      if (outputOpts) {
        request.outputFormat = outputOpts.format;
        request.outputQuality = outputOpts.quality;
        if (outputOpts.width)  request.outputWidth = outputOpts.width;
        if (outputOpts.height) request.outputHeight = outputOpts.height;
      }
      if (fonts) {
        request.fonts = fonts;
      }

      const result = await renderAll(request);
      const files = [
        { kind: "cover",  abs: result.cover },
        ...result.texts.map((p, i) => ({ kind: `text_${i+1}`, abs: p })),
          { kind: "ending", abs: result.ending },
      ];
      const outputs = files.map(f => ({
        kind:     f.kind,
        filename: path.basename(f.abs),
        url:      toPublicUrl(f.abs),
      }));

      return {
        content: [
          { type: "text", text: "✅ Image(s) generated. Download URLs are ready." },
          { type: "text", text: outputs.map(o => `${o.kind}: ${o.url}`).join("\n") }
        ],
        metadata: {
          outputs,
          outputDir: result.outputDir,
          publicBase: PUBLIC_BASE,
        },
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  });

  return server;
}
