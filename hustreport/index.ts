/**
 * hustreport —— 基于 docx-edit 的报告文档样式分析。
 *
 * Part 1：读取 docx → 按样式切分 segment → 样式去重为数字 XML Style ID
 *        → 导出带路径索引的 CSV（多媒体以 `img_xxxx` handle 表示）。
 */

export { analyzeDocument } from "./src/analyze.ts";
export type { AnalyzeOptions, AnalyzableDocument } from "./src/analyze.ts";
export { analyzeDocx, openDocx } from "./src/docx.ts";
export type { AnalyzedDocx, VirtualWordDocument } from "./src/docx.ts";

export {
  formatSegmentsCsv,
  formatMediaCsv,
  parseSegmentsCsv,
} from "./src/csv.ts";
export type {
  SegmentCsvColumn,
  SegmentCsvOptions,
  ParseCsvOptions,
  ParsedCsvRow,
} from "./src/csv.ts";

export { applyEdits, applyTextEdits, editDocx, selectSegments } from "./src/edits.ts";
export type {
  AppliedDelete,
  AppliedEdit,
  AppliedInsert,
  ApplyEditsOptions,
  DeleteEdit,
  EditPlan,
  EditResult,
  InsertEdit,
  SegmentSelector,
  TextEdit,
} from "./src/edits.ts";

export { AnchorRegistry } from "./src/anchors.ts";
export type { AnchorRecord } from "./src/anchors.ts";

export { DocumentEditor, createEditor, summarize } from "./src/editor.ts";
export type {
  EditStats,
  EditorDeleteOptions,
  EditorInsertOptions,
  EditorOptions,
  EditorTarget,
  EditorTargets,
} from "./src/editor.ts";

export { stampAnchors, readAnchors, stripAnchors } from "./src/stamp.ts";
export type { BookmarkRange, StampOptions, StampedAnchor } from "./src/stamp.ts";

export {
  buildTemplate,
  createTemplate,
  inferTemplate,
  isTemplateInfo,
  listProfiles,
  pruneTemplateRefs,
  remapDanglingAnchors,
  resolveProfile,
  TEMPLATE_KIND,
  TEMPLATE_VERSION,
} from "./src/template.ts";
export type {
  AnchorInfo,
  AnchorKind,
  BuildTemplateOptions,
  MarkdownNodeType,
  StyleRef,
  TemplateBundle,
  TemplateDefaults,
  TemplateInfo,
  TemplateMatcher,
  TemplateProfile,
  TemplateRule,
} from "./src/template.ts";

export {
  buildTemplateAiMessages,
  buildTemplateContext,
  buildTemplateWithAi,
  mergeTemplateAiResponse,
  DEFAULT_TEMPLATE_SYSTEM_PROMPT,
  GENERIC_TEMPLATE_SYSTEM_PROMPT,
  LAB_REPORT_TEMPLATE_SYSTEM_PROMPT,
  TEMPLATE_SYSTEM_PRESETS,
} from "./src/template-ai.ts";
export type {
  BuildTemplateAiOptions,
  BuildTemplateAiResult,
  MergeResult,
  TemplateAiResponse,
  TemplatePromptOptions,
  TemplateSystemPreset,
} from "./src/template-ai.ts";

export {
  displayWidth,
  padToWidth,
  parseDocument,
  parseInline,
  parseSkeleton,
  renderTemplate,
  renderTemplateFile,
} from "./src/render.ts";
export type {
  BlockType,
  ListItem,
  MarkdownBlock,
  ParsedDocument,
  RenderFill,
  RenderOptions,
  RenderResult,
} from "./src/render.ts";

export { EDITOR_API_DOC, runEditSandbox } from "./src/sandbox.ts";
export type { SandboxRunOptions, SandboxRunResult } from "./src/sandbox.ts";

export { chatCompletion, extractCode, extractJson } from "./src/ai.ts";
export type { ChatConfig, ChatFn, ChatMessage } from "./src/ai.ts";

export { walkParagraphs } from "./src/walk.ts";
export type { CollectedParagraph, CollectedRun, WalkOptions, WalkResult } from "./src/walk.ts";

export {
  canonicalize,
  cloneStyle,
  describeFontSize,
  mergeStyles,
  summarizeStylePair,
} from "./src/util.ts";

export type {
  DocumentAnalysis,
  MediaEntry,
  PartType,
  Segment,
  SegmentRef,
  StyleEntry,
  StyleObject,
  StyleSnapshot,
} from "./src/types.ts";

export { highlightCode } from "./src/highlight.ts";
export type {
  CodeHighlightLine,
  CodeHighlightResult,
  CodeHighlightRun,
  HighlightOptions,
} from "./src/highlight.ts";

export {
  getCodeTemplatesDir,
  loadCodeTheme,
  loadCodeThemeSync,
  normalizeHexColor,
  parseBorderSizeToEighths,
  parseCodeThemeCss,
  parseFontSizeToHalfPoints,
} from "./src/code-theme.ts";
export type {
  CodeTheme,
  CodeThemeContainer,
  CodeThemeGutter,
  CodeTokenStyle,
} from "./src/code-theme.ts";

export {
  mergeConfig,
  parseExtraConfig,
  resolveReportConfig,
  resolveReportConfigSync,
} from "./src/config.ts";
export type {
  CodeBlockConfig,
  ImageBlockConfig,
  ReportConfig,
  TableBlockConfig,
} from "./src/config.ts";

export {
  calculateImageEmuSize,
  DEFAULT_MAX_IMAGE_WIDTH_EMU,
  DEFAULT_MAX_IMAGE_WIDTH_PT,
  EMU_PER_PT,
  EMU_PER_PX,
  getImageDimensions,
} from "./src/image-size.ts";
export type { ImageDimensions, ImageEmuSize } from "./src/image-size.ts";

