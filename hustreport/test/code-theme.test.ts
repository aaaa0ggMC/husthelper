import assert from "node:assert/strict";
import test from "node:test";
import {
  loadCodeTheme,
  loadCodeThemeSync,
  normalizeHexColor,
  parseBorderSizeToEighths,
  parseCodeThemeCss,
  parseFontSizeToHalfPoints,
} from "../src/code-theme.ts";

test("normalizeHexColor: 各种颜色格式转换", () => {
  assert.equal(normalizeHexColor("#fff"), "FFFFFF");
  assert.equal(normalizeHexColor("#123456"), "123456");
  assert.equal(normalizeHexColor("#12345678"), "123456");
  assert.equal(normalizeHexColor("white"), "FFFFFF");
  assert.equal(normalizeHexColor("black"), "000000");
  assert.equal(normalizeHexColor("rgb(82, 196, 26)"), "52C41A");
  assert.equal(normalizeHexColor("none"), undefined);
  assert.equal(normalizeHexColor("transparent"), undefined);
});

test("parseFontSizeToHalfPoints: 尺寸转 OOXML 半磅", () => {
  assert.equal(parseFontSizeToHalfPoints("9.5pt"), 19);
  assert.equal(parseFontSizeToHalfPoints("10pt"), 20);
  assert.equal(parseFontSizeToHalfPoints("12pt"), 24);
  assert.equal(parseFontSizeToHalfPoints("14px"), 21);
});

test("parseBorderSizeToEighths: 边框转 OOXML 八分之一磅", () => {
  assert.equal(parseBorderSizeToEighths("1pt"), 8);
  assert.equal(parseBorderSizeToEighths("2pt"), 16);
  assert.equal(parseBorderSizeToEighths("3px"), 18);
});

test("parseCodeThemeCss: 解析 CSS 模板规则", () => {
  const css = `
    .code-block {
      background-color: #1e1e1e;
      border: 1px solid #333333;
      font-family: "Fira Code", monospace;
      font-size: 10pt;
      color: #d4d4d4;
    }
    .gutter {
      background-color: #252526;
      color: #858585;
      border-right: 3px solid #007acc;
    }
    .keyword {
      color: #569cd6;
      font-weight: bold;
    }
    .comment {
      color: #6a9955;
      font-style: italic;
    }
  `;

  const theme = parseCodeThemeCss(css, "custom-dark");
  assert.equal(theme.name, "custom-dark");
  assert.equal(theme.container.backgroundColor, "1E1E1E");
  assert.equal(theme.container.borderColor, "333333");
  assert.equal(theme.container.fontFamily, "Fira Code");
  assert.equal(theme.container.fontSize, 20);
  assert.equal(theme.container.color, "D4D4D4");

  assert.equal(theme.gutter.backgroundColor, "252526");
  assert.equal(theme.gutter.color, "858585");
  assert.equal(theme.gutter.borderRightColor, "007ACC");
  assert.equal(theme.gutter.borderRightSize, 18);

  assert.equal(theme.tokens.keyword.color, "569CD6");
  assert.equal(theme.tokens.keyword.bold, true);
  assert.equal(theme.tokens.comment.color, "6A9955");
  assert.equal(theme.tokens.comment.italic, true);
  // 别名补全
  assert.equal(theme.tokens.comments.color, "6A9955");
});

test("loadCodeThemeSync: 加载预制模板", () => {
  const defaultTheme = loadCodeThemeSync("default");
  assert.equal(defaultTheme.name, "default");
  assert.ok(defaultTheme.container.backgroundColor);
  assert.ok(defaultTheme.gutter.borderRightColor);

  const classicTheme = loadCodeThemeSync("classic");
  assert.equal(classicTheme.name, "classic");

  const eclipseTheme = loadCodeThemeSync("eclipse");
  assert.equal(eclipseTheme.name, "eclipse");

  const darkTheme = loadCodeThemeSync("dark");
  assert.equal(darkTheme.name, "dark");
  assert.equal(darkTheme.container.backgroundColor, "1E1E1E");
});
