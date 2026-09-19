import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import test from "node:test";
import assert from "node:assert/strict";
import { extractDocumentComments, stripCommentElements, stripDocumentComments } from "../src/comments.ts";
import { buildTemplateContext, mergeTemplateAiResponse } from "../src/template-ai.ts";
import type { TemplateInfo } from "../src/template.ts";

function createMockDocWithComments() {
  const docxEditRequire = createRequire(require.resolve("docx-edit"));
  const { DOMParser } = docxEditRequire("@xmldom/xmldom");
  const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

  const docXml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<w:document xmlns:w="${WORD_NS}">` +
    `<w:body>` +
    `<w:p>` +
    `<w:bookmarkStart w:id="0" w:name="hrseg0001"/>` +
    `<w:commentReference w:id="0"/>` +
    `<w:r><w:t>章标题内容</w:t></w:r>` +
    `<w:bookmarkEnd w:id="0"/>` +
    `</w:p>` +
    `<w:p>` +
    `<w:bookmarkStart w:id="1" w:name="hrseg0002"/>` +
    `<w:commentReference w:id="1"/>` +
    `<w:r><w:t>图1 示例流程图</w:t></w:r>` +
    `<w:bookmarkEnd w:id="1"/>` +
    `</w:p>` +
    `</w:body></w:document>`;

  const commentsXml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<w:comments xmlns:w="${WORD_NS}">` +
    `<w:comment w:id="0" w:author="指导教师">章标题：黑体小2加粗，居中</w:comment>` +
    `<w:comment w:id="1" w:author="指导教师">图标题：黑体5号居中</w:comment>` +
    `</w:comments>`;

  const docDom = new DOMParser().parseFromString(docXml, "application/xml");
  const commentsDom = new DOMParser().parseFromString(commentsXml, "application/xml");

  return {
    partsData: [
      { path: "word/document.xml", xmlDocument: docDom },
      { path: "word/comments.xml", xmlDocument: commentsDom },
    ],
  };
}

test("extractDocumentComments: 提取批注并关联到锚点与段落文本", () => {
  const mockDoc = createMockDocWithComments();
  const comments = extractDocumentComments(mockDoc as any);
  assert.equal(comments.length, 2);

  assert.equal(comments[0].id, "0");
  assert.equal(comments[0].author, "指导教师");
  assert.equal(comments[0].text, "章标题：黑体小2加粗，居中");
  assert.equal(comments[0].paragraphRef, "hrseg0001");
  assert.equal(comments[0].paragraphText, "章标题内容");

  assert.equal(comments[1].id, "1");
  assert.equal(comments[1].text, "图标题：黑体5号居中");
  assert.equal(comments[1].paragraphRef, "hrseg0002");
  assert.equal(comments[1].paragraphText, "图1 示例流程图");
});

test("buildTemplateContext: 将已检测到的 styleSchema 与批注格式要求展示在 AI 上下文中", () => {
  const info: TemplateInfo = {
    version: 2,
    kind: "hustreport/template",
    meta: { source: "test.docx", createdAt: "2026-01-01", generator: "test" },
    anchorPrefix: "hrseg",
    defaultProfile: "default",
    anchors: {
      hrseg0001: { kind: "slot", label: "标题" },
    },
    profiles: {
      default: { styles: {}, rules: [] },
    },
    comments: [
      {
        id: "0",
        author: "教师",
        text: "正文：宋体小4号",
        paragraphRef: "hrseg0001",
        paragraphText: "正文测试",
      },
    ],
    styleSchema: [
      {
        styleId: 0,
        anchorRef: "hrseg0001",
        summary: "pStyle=Normal | 中文=宋体 字号=小四 (12pt)",
        examples: ["正文测试样例"],
      },
    ],
  };

  const context = buildTemplateContext(info);
  assert.match(context, /文档批注与排版要求/);
  assert.match(context, /批注0 \(教师\): "正文：宋体小4号"/);
  assert.match(context, /已检测到的文档样式列表/);
  assert.match(context, /styleId=0/);
  assert.match(context, /中文=宋体 字号=小四/);
});

test("mergeTemplateAiResponse: 正确保留 AI 返回的 feedback 诊断建议", () => {
  const info: TemplateInfo = {
    version: 2,
    kind: "hustreport/template",
    meta: { source: "test.docx", createdAt: "2026-01-01", generator: "test" },
    anchorPrefix: "hrseg",
    defaultProfile: "default",
    anchors: {
      hrseg0001: { kind: "slot", label: "测试" },
    },
    profiles: {
      default: { styles: {}, rules: [] },
    },
  };

  const aiOutput = JSON.stringify({
    rules: [
      { match: { type: "paragraph" }, style: { anchor: "hrseg0001" } },
    ],
    feedback: {
      missingStyles: [
        {
          name: "代码块",
          requirement: "等宽字体",
          instruction: "请在文档中添加一行代码样本",
        },
      ],
      notes: "已自动绑定图标题",
    },
    skeleton: "# 实验 {ref:hrseg0001}\n",
  });

  const merged = mergeTemplateAiResponse(aiOutput, info);
  assert.ok(merged.info.feedback);
  assert.equal(merged.info.feedback.missingStyles?.length, 1);
  assert.equal(merged.info.feedback.missingStyles?.[0].name, "代码块");
  assert.equal(merged.info.feedback.notes, "已自动绑定图标题");
});

test("stripCommentElements: 同步彻底清除正文中的批注标记和包裹批注的空 run", () => {
  const mockDoc = createMockDocWithComments();
  const removed = stripCommentElements(mockDoc as any);
  assert.equal(removed, 2);

  const docPart = mockDoc.partsData.find((p) => p.path === "word/document.xml");
  const docXml = docPart!.xmlDocument;
  assert.equal(docXml.getElementsByTagName("w:commentReference").length, 0);
  assert.equal(docXml.getElementsByTagName("w:commentRangeStart").length, 0);
  assert.equal(docXml.getElementsByTagName("w:commentRangeEnd").length, 0);

  // 正文文字依然完好保留
  assert.match(docXml.documentElement.textContent, /章标题内容/);
  assert.match(docXml.documentElement.textContent, /图1 示例流程图/);
});

test("stripDocumentComments: 彻底移除批注部件、DOM标记、rels 与 Content_Types 映射", async () => {
  const mockDoc = createMockDocWithComments() as any;
  mockDoc.parts = [{ type: "document" }, { type: "comments" }];
  const files: Record<string, string> = {
    "word/comments.xml": "<w:comments/>",
    "word/commentsExtended.xml": "<w15:commentsEx/>",
    "word/commentsIds.xml": "<w16cid:commentsIds/>",
    "word/_rels/document.xml.rels": `<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/></Relationships>`,
    "[Content_Types].xml": `<Types><Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/></Types>`,
  };
  mockDoc.zip = {
    remove: (name: string) => {
      delete files[name];
    },
    file: (name: string, content?: string) => {
      if (content !== undefined) {
        files[name] = content;
        return;
      }
      if (!(name in files)) return null;
      return {
        async: async (type: string) => files[name],
      };
    },
  };

  const removed = await stripDocumentComments(mockDoc);
  assert.equal(removed, 2);

  // partsData 与 parts 中的 comments 已被过滤
  assert.equal(mockDoc.partsData.some((p: any) => p.path === "word/comments.xml"), false);
  assert.equal(mockDoc.parts.some((p: any) => p.type === "comments"), false);

  // zip 中的 comments 文件已被移除
  assert.equal("word/comments.xml" in files, false);
  assert.equal("word/commentsExtended.xml" in files, false);
  assert.equal("word/commentsIds.xml" in files, false);

  // rels 和 Content_Types 对应行已清理
  assert.equal(files["word/_rels/document.xml.rels"].includes("comments"), false);
  assert.equal(files["[Content_Types].xml"].includes("comments"), false);
});

