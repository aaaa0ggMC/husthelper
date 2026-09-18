import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeDocument } from "../src/analyze.ts";
import type { VNode } from "docx-edit";

function vnode(type: string, props: Record<string, unknown> = {}, children: VNode[] = []): VNode {
  return { id: 0, key: null, type, props, children, source: null };
}

function textRun(text: string, style: Record<string, unknown> = {}): VNode {
  return vnode("run", { style }, [vnode("text", { text })]);
}

const TITLE_STYLE = {
  paragraphStyle: { outlineLevel: "0", styleId: "1" },
  runStyle: { fontSize: "32", fontFamily: { eastAsia: "黑体" } },
};

const SONG_STYLE = { runStyle: { fontSize: "21", fontFamily: { eastAsia: "宋体" } } };

function fakeDoc(tree: VNode) {
  return {
    toComponentTree: () => tree,
    resolveEffectiveStyle: (styleId: string | null) => {
      if (styleId === "1") return TITLE_STYLE;
      return { paragraphStyle: {}, runStyle: {} };
    },
    resolveHeadingLevel: (styleId: string | null) => (styleId === "1" ? 1 : null),
  };
}

test("按段落与 run 样式切分，相邻同样式 run 合并", () => {
  const tree = vnode("document", {}, [
    vnode("body", {}, [
      // 标题段
      vnode("paragraph", { style: { styleId: "1" }, text: "报告标题" }, [textRun("报告标题")]),
      // 正文段：宋体 run + 加粗 run + 宋体 run
      vnode("paragraph", { style: {}, text: "x" }, [
        textRun("你好啊，这里转义\"", SONG_STYLE.runStyle),
        textRun("很重要", { bold: true }),
        textRun("继续宋体", SONG_STYLE.runStyle),
      ]),
      // 两个连续同样式 run 应合并
      vnode("paragraph", { style: {} }, [textRun("前半", SONG_STYLE.runStyle), textRun("后半", SONG_STYLE.runStyle)]),
    ]),
  ]);

  const analysis = analyzeDocument(fakeDoc(tree));
  assert.equal(analysis.meta.styleCount, 3);
  assert.deepEqual(
    analysis.segments.map((segment) => segment.text),
    ["报告标题", '你好啊，这里转义"', "很重要", "继续宋体", "前半后半"],
  );
  assert.deepEqual(
    analysis.segments.map((segment) => segment.styleId),
    [0, 1, 2, 1, 1],
  );

  // 第一段是标题
  assert.equal(analysis.styles[0].paragraph.headingLevel, 1);
  assert.match(analysis.styles[0].summary, /标题1/);
  // 宋体样式摘要包含中文字体与字号
  assert.match(analysis.styles[1].summary, /宋体/);
  assert.match(analysis.styles[1].summary, /五号/);

  assert.deepEqual(analysis.segments[1].ref, {
    part: "body",
    partIndex: 0,
    paragraph: 1,
    paraId: null,
    segment: 0,
    anchor: null,
    runStart: 0,
    runEnd: 1,
    id: "body#0/p1/s0",
  });
  assert.equal(analysis.segments[4].ref.id, "body#0/p2/s0");
});

test("图片输出为 img_xxxx handle 并记录媒体元数据", () => {
  const image = vnode("image", { relId: "rId5", filename: "logo.png", contentType: "image/png", width: "100", height: "50" });
  const tree = vnode("document", {}, [
    vnode("body", {}, [
      vnode("paragraph", {}, [textRun("图片说明")]),
      vnode("paragraph", {}, [vnode("run", {}, [image])]),
    ]),
  ]);

  const analysis = analyzeDocument(fakeDoc(tree));
  assert.equal(analysis.media.length, 1);
  assert.equal(analysis.media[0].handle, "img_0001");
  assert.equal(analysis.media[0].filename, "logo.png");
  assert.equal(analysis.segments[1].text, "img_0001");
  assert.deepEqual(analysis.segments[1].ref.id, "body#0/p1/s0");
});

test("includeEmptyParagraphs 可保留空段落；默认跳过", () => {
  const tree = vnode("document", {}, [
    vnode("body", {}, [vnode("paragraph", { style: {} }, [textRun("有内容")]), vnode("paragraph", { style: {} }, [])]),
  ]);

  assert.equal(analyzeDocument(fakeDoc(tree)).segments.length, 1);
  assert.equal(analyzeDocument(fakeDoc(tree), { includeEmptyParagraphs: true }).segments.length, 2);
});

test("partTypes 过滤只保留指定 part", () => {
  const tree = vnode("document", {}, [
    vnode("body", {}, [vnode("paragraph", { style: {} }, [textRun("正文")])]),
    vnode("footer", {}, [vnode("paragraph", { style: {} }, [textRun("页脚")])]),
  ]);

  const analysis = analyzeDocument(fakeDoc(tree), { partTypes: ["footer"] });
  assert.equal(analysis.segments.length, 1);
  assert.equal(analysis.segments[0].ref.id, "footer#0/p0/s0");
});
