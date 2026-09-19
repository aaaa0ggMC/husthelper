import assert from "node:assert/strict";
import { test } from "node:test";
import { formatMediaCsv, formatSegmentsCsv, formatStylesCsv, parseSegmentsCsv, parseStylesCsv } from "../src/csv.ts";
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

test("formatStylesCsv & parseStylesCsv 能正确格式化与解析样式表 CSV", () => {
  const styles = [
    {
      id: 0,
      key: "key0",
      paragraph: {
        ooxmlStyleId: "Normal",
        effective: {
          styleId: "Normal",
          alignment: "left",
          spacing: { line: "360", lineRule: "auto" },
          indent: { firstLine: "480" },
        },
        direct: {
          spacing: { line: "360", lineRule: "auto" },
          indent: { firstLine: "480" },
        },
      },
      run: {
        ooxmlStyleId: null,
        effective: {
          fontFamily: { eastAsia: "SimSun", ascii: "Times New Roman" },
          fontSize: "24",
          bold: false,
          color: "000000",
        },
        direct: {},
      },
      segmentCount: 10,
      examples: ["这是正文第一句", "这是正文第二句"],
      firstSegmentIndex: 0,
      summary: "正文：宋体小四 1.5倍行距",
    },
    {
      id: 1,
      key: "key1",
      paragraph: {
        ooxmlStyleId: "Heading1",
        headingLevel: 1,
        effective: {
          styleId: "Heading1",
          alignment: "center",
        },
        direct: {},
      },
      run: {
        ooxmlStyleId: null,
        effective: {
          fontFamily: { eastAsia: "SimHei" },
          fontSize: "32",
          bold: true,
          color: "FF0000",
        },
        direct: {},
      },
      segmentCount: 2,
      examples: ["批注：一级标题要求三号黑体"],
      firstSegmentIndex: 1,
      summary: "批注说明：红色黑体三号",
    },
  ];

  const csv = formatStylesCsv(styles);
  assert.ok(csv.includes("XML Style ID , pStyle , Font (CN) , Font (ASCII) , Font Size , Bold , Color , Alignment , Line Spacing , Indent , Summary , Examples"));
  assert.ok(csv.includes("360 (1.5x)"));
  assert.ok(csv.includes("firstLine:480"));
  assert.ok(csv.includes("#FF0000"));

  const parsed = parseStylesCsv(csv);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].styleId, 0);
  assert.equal(parsed[0].pStyle, "Normal");
  assert.equal(parsed[0].fontCn, "SimSun");
  assert.equal(parsed[0].fontSize, "小四 (12pt)");
  assert.equal(parsed[0].bold, false);
  assert.equal(parsed[0].alignment, "left");
  assert.equal(parsed[0].lineSpacing, "360 (1.5x)");
  assert.equal(parsed[0].indent, "firstLine:480");

  assert.equal(parsed[1].styleId, 1);
  assert.equal(parsed[1].pStyle, "Heading1");
  assert.equal(parsed[1].fontCn, "SimHei");
  assert.equal(parsed[1].bold, true);
  assert.equal(parsed[1].color, "#FF0000");
});
