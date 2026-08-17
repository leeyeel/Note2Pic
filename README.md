# note2pic

将封面标题和完整正文转换为图片。正文无需预先分成每页，也无需控制每行字数。

## CLI

CLI 是默认入口。准备请求 JSON 后执行：

```sh
nvm use
npm run build
npm run render -- --input request.json --pretty
```

项目使用 Node 20。`canvas@2.11.2` 不支持 Node 22 的预编译运行时。

也可以从标准输入读取：

```sh
echo '{"titleDir":"homework-habit","headline":"孩子写作业总拖延","content":"先不要急着催。"}' | npm run render -- --input -
```

默认产物位于 `output/<titleDir>/`。`render` 在标准输出返回 JSON manifest；使用 `validate` 可在不生成图片时检查模板和字体：

```sh
npm run validate -- --input request.json --template-root template --pretty
```

`titleDir` 是文件目录标识，只能使用字母、数字、`_` 和 `-`，且必须以字母或数字开头。`--output-dir` 与 `--template-root` 可以覆盖默认路径。

## MCP 兼容入口

`generate_simple` 只需要提供 `headline` 和 `content`：

```json
{
  "titleDir": "homework-habit",
  "headline": "孩子写作业总拖延",
  "content": "先不要急着催。把任务拆成一个能马上开始的小动作，例如拿出练习册、写下第一题。\n\n每完成一步就短暂休息，让孩子看到自己正在前进。",
  "disableOverlay": true
}
```

渲染器会：

- 根据实际字体宽度自动换行，中文、英文和标点都按真实宽度计算。
- 在 `src/config.ts` 的文字区内自动选择 32 到 46 px 的字号。
- 当一张正文图放不下时自动生成下一张，直到全文排完。
- 保留段落换行；`\n\n` 会形成段落间距。

旧版 `pages` 输入仍可用，但不再需要手动限制字数；其中任一段超出一页时也会自动续页。

## 调整模板文字区

默认文字区和字号范围位于 `src/config.ts` 的 `pageTemplate`。更换模板时通常只需要调整 `x`、`y`、`width`、`height`、`minFontSize` 和 `maxFontSize`，正文内容不需要改动。
