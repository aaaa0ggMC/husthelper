import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Privacy, ensureKey } from "../privacy.ts";
import { compileScript, wrapAggregate } from "../scripting.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "hust-mcp-scripting-"));
}

test("表达式、语句块、无声明多语句都能编译", async () => {
  const logs: string[] = [];
  const scopeKeys = ["console"];
  const scopeValues = [{ log: (value: unknown) => logs.push(String(value)) }];

  const expression = compileScript("1 + 1", scopeKeys);
  assert.equal(await expression(...scopeValues), 2);

  const withDeclarations = compileScript("const a = 2; return a * 3", scopeKeys);
  assert.equal(await withDeclarations(...scopeValues), 6);

  const multipleStatements = compileScript("console.log('a'); 42", scopeKeys);
  assert.equal(await multipleStatements(...scopeValues), undefined);
  assert.deepEqual(logs, ["a"]);
});

test("getter 与方法的资源只裁剪一次，预算也只记一次", async () => {
  const dir = tempDir();
  ensureKey(dir);
  const privacy = new Privacy({ dir, env: {}, transport: "stdio" });

  const consumed: number[] = [];
  const originalConsume = privacy.consume.bind(privacy);
  (privacy as unknown as { consume: (level: string, rows: number) => void }).consume = (
    level: string,
    rows: number,
  ) => {
    consumed.push(rows);
    originalConsume(level as never, rows);
  };

  const records = [1, 2, 3].map((n) => ({
    id: n,
    amount: "12.34",
    merchant: "某商户",
    time: "2026-09-01 10:00:00",
  }));
  const raw = {
    get transactions() {
      return this.load("transactions");
    },
    get me() {
      return Promise.resolve({ name: "示例姓名", studentId: "U000000000", sources: ["one"] });
    },
    load(name: string) {
      return Promise.resolve({ records, total: records.length, pageSize: 20, sources: [name] });
    },
    overview() {
      return Promise.resolve({
        today: { lessons: [{ title: "高等数学" }, { title: "大学物理" }] },
      });
    },
  };

  const client = wrapAggregate(raw, privacy, "redacted", false) as unknown as typeof raw;

  const viaGetter = (await client.transactions) as { records: unknown[] };
  assert.equal(viaGetter.records.length, 3);
  assert.deepEqual(consumed, [3]);

  consumed.length = 0;
  const viaLoad = (await client.load("transactions")) as { records: unknown[] };
  assert.equal(viaLoad.records.length, 3);
  assert.deepEqual(consumed, [3]);

  consumed.length = 0;
  await client.overview();
  assert.deepEqual(consumed, [2]);

  assert.equal(privacy.used.redacted, 8);
});
