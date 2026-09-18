import assert from "node:assert/strict";
import { test } from "node:test";
import { formatMediaCsv, formatSegmentsCsv, parseSegmentsCsv } from "../src/csv.ts";
import type { MediaEntry, Segment } from "../src/types.ts";

function segment(index: number, text: string, styleId: number, ref: string): Segment {
  return {
    index,
    text,
    styleId,
    ref: { part: "body", partIndex: 0, paragraph: 0, paraId: null, segment: index, anchor: null, runStart: 0, runEnd: 0, id: ref },
  };
}

test("formatSegmentsCsv 输出表头、引号与转义", () => {
  const csv = formatSegmentsCsv([
    segment(0, '你好啊，这里转义"', 0, "body#0/p@AAAA/s0"),
    segment(1, "这里需要用宋体五号字体", 1, "body#0/p@AAAA/s1"),
  ]);

  const lines = csv.trimEnd().split("\n");
  assert.equal(lines[0], "Index , Segments , XML Style ID , Ref");
  assert.equal(lines[1], '0 , "你好啊，这里转义\\"" , 0 , body#0/p@AAAA/s0');
  assert.equal(lines[2], '1 , "这里需要用宋体五号字体" , 1 , body#0/p@AAAA/s1');
});

test("formatSegmentsCsv 转义换行、Tab 与反斜杠", () => {
  const csv = formatSegmentsCsv([segment(0, "a\nb\tc\\d", 0, "body#0/p@AAAA/s0")]);
  assert.ok(csv.includes('"a\\nb\\tc\\\\d"'));
});

test("parseSegmentsCsv 能解析自己生成的 CSV", () => {
  const source = [
    segment(0, '你好啊，这里转义"', 0, "body#0/p@AAAA/s0"),
    segment(1, "第一行\n第二行", 3, "body#0/p@BBBB/s0"),
  ];
  const parsed = parseSegmentsCsv(formatSegmentsCsv(source));
  assert.equal(parsed.length, 2);
  assert.deepEqual(parsed[0], { index: 0, text: '你好啊，这里转义"', styleId: 0, ref: "body#0/p@AAAA/s0" });
  assert.deepEqual(parsed[1], { index: 1, text: "第一行\n第二行", styleId: 3, ref: "body#0/p@BBBB/s0" });
});

test("formatMediaCsv 输出 handle 与元数据", () => {
  const media: MediaEntry = {
    handle: "img_0001",
    kind: "image",
    node: null,
    part: "body",
    partIndex: 0,
    paragraph: 2,
    run: 0,
    relId: "rId5",
    filename: "image1.png",
    contentType: "image/png",
    mediaPath: "word/media/image1.png",
    width: "914400",
    height: "457200",
    alt: "示意图",
    layout: { mode: "inline" },
  };
  const csv = formatMediaCsv([media]);
  assert.equal(
    csv.trimEnd(),
    "Handle , Ref , Filename , Content-Type , Width , Height , Alt\n" +
      "img_0001 , body#0/p2/r0 , image1.png , image/png , 914400 , 457200 , 示意图",
  );
});
