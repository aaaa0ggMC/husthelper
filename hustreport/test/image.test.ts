import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { calculateImageEmuSize, getImageDimensions, EMU_PER_PT } from "../src/image-size.ts";
import { parseDocument, renderTemplate } from "../src/render.ts";
import type { TemplateInfo } from "../src/template.ts";

// 100x50 PNG
const TEST_PNG_100x50 = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000064000000320806000000" +
    "f11811550000001949444154789c63601805a360148c8251300a18030000280001f3f9" +
    "3f390000000049454e44ae426082",
  "hex",
);

test("getImageDimensions & calculateImageEmuSize: 尺寸探测与 EMU 计算", () => {
  const dims = getImageDimensions(TEST_PNG_100x50);
  assert.equal(dims.type, "png");
  assert.equal(dims.width, 100);
  assert.equal(dims.height, 50);

  // 默认 max 适合最大版心 (430pt)
  const emuDefault = calculateImageEmuSize(dims, { size: "max" });
  assert.equal(emuDefault.widthPt, 430);
  assert.equal(emuDefault.heightPt, 215); // 宽高比 2:1
  assert.equal(emuDefault.cx, Math.round(430 * EMU_PER_PT));
  assert.equal(emuDefault.cy, Math.round(215 * EMU_PER_PT));

  // 指定百分比 50%
  const emuPct = calculateImageEmuSize(dims, { size: "50%" });
  assert.equal(emuPct.widthPt, 215);
  assert.equal(emuPct.heightPt, 107.5);

  // 指定具体 pt
  const emuPt = calculateImageEmuSize(dims, { width: "200pt" });
  assert.equal(emuPt.widthPt, 200);
  assert.equal(emuPt.heightPt, 100);
});

test("parseDocument: 解析包含属性与额外配置的图片语法", () => {
  const md = `
# 实验报告

![程序流程图](images/flow.png){center max}

![实验结果截图](results/screen.jpg){align=left width=300pt}(captionStyle=CaptionRecipe)

![纯图片无说明](logo.png)
`;
  const parsed = parseDocument(md);
  const imgBlocks = parsed.blocks.filter((b) => b.type === "image");
  assert.equal(imgBlocks.length, 3);

  assert.equal(imgBlocks[0].caption, "程序流程图");
  assert.equal(imgBlocks[0].src, "images/flow.png");
  assert.equal(imgBlocks[0].attrs?.align, "center");
  assert.equal(imgBlocks[0].attrs?.size, "max");

  assert.equal(imgBlocks[1].caption, "实验结果截图");
  assert.equal(imgBlocks[1].src, "results/screen.jpg");
  assert.equal(imgBlocks[1].attrs?.align, "left");
  assert.equal(imgBlocks[1].attrs?.width, "300pt");
  assert.equal(imgBlocks[1].attrs?.captionStyle, "CaptionRecipe");

  assert.equal(imgBlocks[2].caption, "纯图片无说明");
  assert.equal(imgBlocks[2].src, "logo.png");
});

function createMockDoc() {
  const docxEditRequire = createRequire(require.resolve("docx-edit"));
  const { DOMParser } = docxEditRequire("@xmldom/xmldom");
  const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<w:document xmlns:w="${WORD_NS}">` +
    `<w:body>` +
    `<w:p>` +
    `<w:bookmarkStart w:id="0" w:name="hrseg0001"/>` +
    `<w:r><w:t>正文段落</w:t></w:r>` +
    `<w:bookmarkEnd w:id="0"/>` +
    `</w:p>` +
    `</w:body></w:document>`;
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return {
    partsData: [{ xmlDocument: doc, path: "word/document.xml" }],
    xmlDoc: doc,
    createOrUpdateImage: (_part: string, item: any) => {
      return { relId: "rIdImg1", filename: item.props.filename };
    },
  };
}

test("renderTemplate: 渲染图片到 Word 并支持 AI 图注样式与配置覆盖", () => {
  const tmpDir = path.join(tmpdir(), "hustreport-test-img-" + Date.now());
  mkdirSync(tmpDir, { recursive: true });
  const imgPath = path.join(tmpDir, "test.png");
  writeFileSync(imgPath, TEST_PNG_100x50);

  const mockDoc = createMockDoc();
  const info: TemplateInfo = {
    version: 2,
    kind: "hustreport/template",
    meta: { source: "test.docx", createdAt: "2026-01-01", generator: "test" },
    anchorPrefix: "hrseg",
    defaultProfile: "default",
    anchors: { hrseg0001: { kind: "slot" } },
    profiles: {
      default: {
        styles: { body: { anchor: "hrseg0001" } },
        rules: [
          { match: { type: "paragraph" }, style: { recipe: "body" } },
          {
            match: { type: "image" },
            options: {
              align: "center",
              size: "max",
              captionRef: "hrseg0001",
            },
          },
        ],
      },
    },
  };

  const md = `
---
profile: default
---

![测试架构图](${imgPath}){ref=hrseg0001}
`;

  const result = renderTemplate(mockDoc as any, info, md, { markdownDir: tmpDir });
  assert.equal(result.inserted, 2); // 图片段落 + caption 段落

  const body = mockDoc.xmlDoc.getElementsByTagName("w:body")[0];
  const drawings = body.getElementsByTagName("w:drawing");
  assert.equal(drawings.length, 1);

  // 清理
  try {
    unlinkSync(imgPath);
  } catch {}
});
