import { z } from "zod";
import type { RenderRequest } from "./render";

export const TitleSchema = z.object({
  line1: z.string().describe(
    "标题第1段（≤10个汉字）。用于引入，不宜过长。可使用内联语法更改颜色及字号。"
  ),
  line2: z.string().describe(
    "标题第2段（重点，≤7个汉字）。整条标题的视觉重心。可使用内联语法更改颜色及字号。"
  ),
  line3: z.string().describe(
    "标题第3段（≤10个汉字）。用于收束或补充信息。可使用内联语法更改颜色及字号。"
  ),
}).describe("小红书三段式标题规范。");

export const PageSchema = z.object({
  text: z.string().describe(
    "兼容旧调用的单段正文。内容超出一页时自动续页，支持内联样式标记。"
  ),
}).describe("兼容旧版的分页面输入。新调用优先使用 content。");

export const SimpleRenderInputSchema = z.object({
  titleDir: z.string().min(1, "titleDir 不能为空，会作为输出图片的目录名"),
  templateName: z.string().optional().default("default"),
  headline: z.string().min(1).optional().describe(
    "封面主标题。系统会放入封面主标题区域并自动缩放。"
  ),
  title: TitleSchema.strict().optional().describe(
    "可选的三段式标题。需要更细致地控制封面文案时使用。"
  ),
  content: z.string().min(1).optional().describe(
    "完整正文文案。系统会按实际字体宽度自动换行、自动选择字号和分页。"
  ),
  pages: z.array(PageSchema).min(1).optional().describe(
    "旧版分页面输入，仍受支持。"
  ),
  disableOverlay: z.boolean().optional(),
}).strict().refine((data) => Boolean(data.content || data.pages?.length), {
  message: "content 或 pages 至少提供一个",
  path: ["content"],
}).refine((data) => Boolean(data.headline || data.title), {
  message: "headline 或 title 至少提供一个",
  path: ["headline"],
});

export type SimpleRenderInput = z.infer<typeof SimpleRenderInputSchema>;

export interface RenderLocations {
  outputDirectory?: string;
  templateDirectory?: string;
}

export function toRenderRequest(
  input: SimpleRenderInput,
  locations: RenderLocations = {}
): RenderRequest {
  const overrides: NonNullable<RenderRequest["overrides"]> = {};
  if (locations.outputDirectory) {
    overrides.output = { directory: locations.outputDirectory };
  }
  if (locations.templateDirectory) {
    overrides.templates = { baseDir: locations.templateDirectory };
  }

  return {
    titleDir: input.titleDir,
    templateName: input.templateName,
    titleTexts: input.title
      ? [input.title.line1, input.title.line2, input.title.line3]
      : ["", input.headline ?? "", ""],
    content: input.content,
    pages: input.pages?.map((page) => page.text),
    overlayCover: input.disableOverlay ? [] : undefined,
    overlayPages: input.disableOverlay ? [] : undefined,
    overlayEnding: input.disableOverlay ? [] : undefined,
    overrides: Object.keys(overrides).length > 0 ? overrides : undefined,
  };
}
