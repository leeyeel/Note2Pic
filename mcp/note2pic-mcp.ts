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

const TitleSchema = z.object({
  line1: z.string().describe(
    "标题第1段（≤10个汉字）。用于引入，不宜过长。建议简短有力。"
  ),
  line2: z.string().describe(
    "标题第2段（重点，≤7个汉字）。整条标题视觉重心放在此处，建议突出利益点/痛点。"
  ),
  line3: z.string().describe(
    "标题第3段（≤10个汉字）。用于收束或补充信息，可加入行动号召。"
  ),
}).describe(
  "小红书三段式标题规范：第一段≤10汉字、第二段≤7汉字（重点）、第三段≤10汉字；整体风格和语气应贴合小红书的宝妈群体，亲切、有同理心、可读性强。"
);

const PageSchema = z.object({
  text: z.string().describe(
    "本页正文内容。建议每行≤24个汉字，工具会在合适位置自动换行；可使用内联样式标记关键词（示例：[c=#ff4d4f]重点词[/c] 或 [size=40]加大字号[/size]）。"
  ),
}).describe("正文段落：按行展示（需要换行，每行≤24汉字），支持简单内联样式以增强可读性。");

const MinimalRenderInputSchema = z.object({
    titleDir: z.string().min(1, "titleDir 不能为空,会作为输出图片的目录名,不要有空格"),
    templateName: z.string().optional().default("default"),
    title: TitleSchema.strict(),
    pages: z.array(PageSchema).min(1).max(7),
    disableOverlay: z.boolean().optional(),
}).strict();

const TextAlignEnum = z.enum(["left", "center", "right", "justify"]);

const TitleStyleSchema = z.object({
    font: z.string().optional(),
    size: z.number().positive().optional(),
    color: z.string().optional(),
    align: TextAlignEnum.optional(),
    lineGap: z.number().optional(),
}).strict().optional();

const PageStyleSchema = z.object({
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().optional(),
    lineHeight: z.number().optional(),
    font: z.string().optional(),
    size: z.number().optional(),
    color: z.string().optional(),
    align: TextAlignEnum.optional(),
    paragraphSpacing: z.number().optional(),
}).strict();

const AdvancedRenderInputSchema = z.object({
    titleDir: z.string(),
    templateName: z.string().optional().default("default"),
    disableOverlay: z.boolean().optional(),

    title: z.object({
        lines: z.array(z.string()).min(1).max(3),
        style: TitleStyleSchema,
    }).strict().optional(),

    contentDefaults: PageStyleSchema.optional(),

    pages: z.array(z.object({
        text: z.string(),
        style: PageStyleSchema.optional(),
        overlay: z.union([z.boolean(),z.object({ items: z.array(z.any()) }).strict(),]).optional(),
    }).strict() ).min(1).max(6),
    extra: z.record(z.string(), z.any()).optional(),
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
      {
        name: ToolName.GENERATE_ADVANCED,
        description: "高级渲染：在默认模板基础上，允许对标题与每页内容进行精细化样式覆盖；可选择关闭或自定义 overlay。",
        inputSchema: zodToJsonSchema(AdvancedRenderInputSchema) as ToolInput,
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

    throw new Error(`Unknown tool: ${name}`);
  });

  return server;
}
