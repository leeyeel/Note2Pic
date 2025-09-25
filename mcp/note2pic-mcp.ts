/* eslint-disable @typescript-eslint/no-explicit-any */
// note2pic-mcp.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ClientCapabilities,
  CompleteRequestSchema,
  CreateMessageRequest,
  CreateMessageResultSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  LoggingLevel,
  ReadResourceRequestSchema,
  Resource,
  RootsListChangedNotificationSchema,
  SubscribeRequestSchema,
  Tool,
  ToolSchema,
  UnsubscribeRequestSchema,
  type Root
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

import { renderAll } from "../src/render";

const ToolInputSchema = ToolSchema.shape.inputSchema;
type ToolInput = z.infer<typeof ToolInputSchema>;
const ToolOutputSchema = ToolSchema.shape.outputSchema;
type ToolOutput = z.infer<typeof ToolOutputSchema>;

const MinimalRenderInputSchema = z.object({
    titleDir: z.string().min(1, "titleDir 不能为空"),
    templateName: z.string().optional().default("default"),
    title: z.array(z.string()).min(1).max(3),
    pages: z.array(z.string()).min(1).max(20),
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

const ReadFileSchema = z.object({
    filename: z.string().min(1, "filename 不能为空"), // 相对 output/ 的路径
    encoding: z.enum(["base64", "utf8"]).optional().default("base64"),
}).strict();

const ListTemplateFilesSchema = z.object({
    templateName: z.string().min(1),
}).strict();

const RmOutputSchema = z.object({
    target: z.string().min(1),
    recursive: z.boolean().optional().default(true),
    force: z.boolean().optional().default(false),
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

  const ALL_RESOURCES: Resource[] = Array.from({ length: 100 }, (_, i) => {
    const uri = `test://static/resource/${i + 1}`;
      if (i % 2 === 0) {
      return {
        uri,
        name: `Resource ${i + 1}`,
        mimeType: "text/plain",
        text: `Resource ${i + 1}: This is a plaintext resource`,
      };
    } else {
      const buffer = Buffer.from(`Resource ${i + 1}: This is a base64 blob`);
      return {
        uri,
        name: `Resource ${i + 1}`,
        mimeType: "application/octet-stream",
        blob: buffer.toString("base64"),
      };
    }
  });

  const PAGE_SIZE = 10;

  server.setRequestHandler(ListResourcesRequestSchema, async (request) => {
    const cursor = request.params?.cursor;
    let startIndex = 0;

    if (cursor) {
      const decodedCursor = parseInt(atob(cursor), 10);
      if (!isNaN(decodedCursor)) {
        startIndex = decodedCursor;
      }
    }

    const endIndex = Math.min(startIndex + PAGE_SIZE, ALL_RESOURCES.length);
    const resources = ALL_RESOURCES.slice(startIndex, endIndex);

    let nextCursor: string | undefined;
    if (endIndex < ALL_RESOURCES.length) {
      nextCursor = btoa(endIndex.toString());
    }

    return {
      resources,
      nextCursor,
    };
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools: Tool[] = [
      {
        name: ToolName.GENERATE_SIMPLE,
        description: "最简渲染入口：只传少量参数（titleDir、title[≤3]、pages[≤20]、可选 templateName/disableOverlay），其余走 config 默认。",
        inputSchema: zodToJsonSchema(MinimalRenderInputSchema) as ToolInput,
      },

      {
        name: ToolName.GENERATE_ADVANCED,
        description: "高级渲染：在默认模板基础上，允许对标题与每页内容进行精细化样式覆盖；可选择关闭或自定义 overlay。",
        inputSchema: zodToJsonSchema(AdvancedRenderInputSchema) as ToolInput,
      },

      {
        name: ToolName.READ_FILE,
        description: "从 output/ 目录读取文件并返回内容（默认 base64）。仅允许相对 output/ 的安全路径。",
        inputSchema: zodToJsonSchema(ReadFileSchema) as ToolInput,
      },

      {
        name: ToolName.LIST_TEMPLATES,
        description: "列出 template/ 目录下可用的模板名。",
        inputSchema: { type: "object", properties: {}, additionalProperties: false } ,
      },
      {
        name: ToolName.LIST_TEMPLATE_FILES,
        description: "查看指定模板下的 *.png 与 assets/*.png。",
        inputSchema: zodToJsonSchema(ListTemplateFilesSchema) as ToolInput,
      },
      {
        name: ToolName.LIST_OUTPUT,
        description: "列出 output/ 目录下已有文件（相对路径）。",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
      },
      {
        name: ToolName.CHECK_FONTS,
        description: "检查 config.ts 中声明的字体文件是否存在。",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
      },

      {
        name: ToolName.RM_OUTPUT,
        description: "安全删除 output/ 下的文件或目录（限制相对路径；默认递归删除）。",
        inputSchema: zodToJsonSchema(RmOutputSchema) as ToolInput,
      },
      {
        name: ToolName.DOCS,
        description: "返回简要使用说明。",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
      },
    ];
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request,extra) => {
    const { name, arguments: args } = request.params;
    console.error(extra)
    if (name === ToolName.GENERATE_SIMPLE) {
      const input = MinimalRenderInputSchema.parse(args);
      const {
        titleDir,
        templateName = "default",
          title,
        pages,
        disableOverlay,
      } = input;

      const request: any = {
        templateName,
        titleDir,
        title: {
          lines: title,
        },
        pages: pages.map((txt) => ({
          text: txt,
        })),
        ...(disableOverlay ? { overlay: [] } : {}),
      };

      const result = await renderAll(request);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  });

  return server;
}

