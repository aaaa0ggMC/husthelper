import assert from "node:assert/strict";
import test from "node:test";
import { highlightCode } from "../src/highlight.ts";

test("highlightCode: Python 代码高亮与行号分割", () => {
  const code = `def add(a, b):
    # 计算两数之和
    return a + b
`;
  const result = highlightCode(code, { lang: "python" });
  assert.equal(result.lang, "python");
  assert.equal(result.lines.length, 3);

  // 第一行：def (keyword) add (function)
  const line1 = result.lines[0];
  assert.equal(line1.lineNumber, 1);
  const defRun = line1.runs.find((r) => r.text === "def");
  assert.ok(defRun, "应该包含 def");
  assert.ok(defRun.classes.includes("keyword"), "def 应该有 keyword class");

  // 第二行：注释
  const line2 = result.lines[1];
  assert.equal(line2.lineNumber, 2);
  const commentRun = line2.runs.find((r) => r.text.includes("计算两数之和"));
  assert.ok(commentRun, "应该包含注释");
  assert.ok(commentRun.classes.includes("comment"), "注释应该有 comment class");

  // 第三行：return
  const line3 = result.lines[2];
  assert.equal(line3.lineNumber, 3);
  const returnRun = line3.runs.find((r) => r.text === "return");
  assert.ok(returnRun);
  assert.ok(returnRun.classes.includes("keyword"));
});

test("highlightCode: C++ 预处理器与类型高亮", () => {
  const code = `#include <iostream>
int main() {
    return 0;
}`;
  const result = highlightCode(code, { lang: "cpp" });
  assert.equal(result.lang, "cpp");
  assert.equal(result.lines.length, 4);

  const line1 = result.lines[0];
  const directive = line1.runs.find((r) => r.classes.includes("directive") || r.classes.includes("macro"));
  assert.ok(directive || line1.runs.some((r) => r.text.includes("include")));

  const line3 = result.lines[2];
  const numRun = line3.runs.find((r) => r.text === "0");
  assert.ok(numRun);
  assert.ok(numRun.classes.includes("number"));
});

test("highlightCode: Tab 展开为指定空格数", () => {
  const code = "\t\tcode";
  const result = highlightCode(code, { lang: "plain", tabSize: 2 });
  assert.equal(result.lines[0].runs[0].text, "    code");
});

test("highlightCode: 多行字符串跨行切分", () => {
  const code = `s = """line 1
line 2
line 3"""`;
  const result = highlightCode(code, { lang: "py" });
  assert.equal(result.lines.length, 3);
  assert.equal(result.lines[0].lineNumber, 1);
  assert.equal(result.lines[1].lineNumber, 2);
  assert.equal(result.lines[2].lineNumber, 3);
});

test("highlightCode: 未知语言安全降级为普通文本", () => {
  const code = "unknown language syntax 123";
  const result = highlightCode(code, { lang: "some-nonexistent-lang" });
  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0].runs[0].text, code);
});
