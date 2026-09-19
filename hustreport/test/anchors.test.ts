import assert from "node:assert/strict";
import { test } from "node:test";
import { AnchorRegistry } from "../src/anchors.ts";

test("AnchorRegistry：同一 key 复用 id，不同 key 递增分配", () => {
  const registry = new AnchorRegistry();
  const keyA = {};
  const keyB = {};

  const a1 = registry.assign(keyA, { p: "A" }, []);
  const a2 = registry.assign(keyA, { p: "A2" }, []);
  const b1 = registry.assign(keyB, { p: "B" }, []);

  assert.equal(a1, "a1");
  assert.equal(a2, "a1"); // 复用
  assert.equal(b1, "a2"); // 递增
  assert.equal(registry.size, 2);
});

test("AnchorRegistry：重新 assign 会刷新记录里的元素引用", () => {
  const registry = new AnchorRegistry();
  const key = {};
  const id = registry.assign(key, { old: true }, []);

  const newParagraph = { fresh: true };
  const newRuns = [{ r: 1 }];
  registry.assign(key, newParagraph, newRuns);

  const record = registry.get(id);
  assert.equal(record?.paragraphEl, newParagraph);
  assert.deepEqual(record?.runEls, newRuns);
  assert.equal(registry.has(id), true);
  assert.equal(registry.has("a999"), false);
});
