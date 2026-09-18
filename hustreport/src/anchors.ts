/**
 * 会话内的 segment 身份注册表。
 *
 * 不往文档里写任何东西：以“该 segment 的第一个 run 元素”（空段落则用段落元素）
 * 作为 key，分配一个会话内的稳定 id（`a1`、`a2`…）。
 *
 * - 只要底层 XML 元素不被替换，同一 segment 在多次重新分析后拿到同一个 id；
 * - 因此 AI 拿到的 ref 在整个 analyze → AI → 编辑 → 保存 流程里恒定；
 * - 文档保持原样（没有 paraId 依赖、没有 marker 需要清理）。
 *
 * 何时需要“注入再删除”的持久锚点：只有把中间文档存盘、换进程后再编辑时。
 * 那种场景可在本类之上再加 `stampAnchors()`，默认不启用。
 */

export interface AnchorRecord {
  id: string;
  /** 所在段落元素（xmldom Element，弱类型以免耦合）。 */
  paragraphEl: unknown;
  /** 该 segment 覆盖的 run 元素（按顺序）。 */
  runEls: unknown[];
}

export class AnchorRegistry {
  private ids = new WeakMap<object, string>();
  private records = new Map<string, AnchorRecord>();
  private counter = 0;

  /** 为某个 segment 分配/复用 id；`key` 用该 segment 的代表元素。 */
  assign(key: object, paragraphEl: unknown, runEls: unknown[]): string {
    const existing = this.ids.get(key);
    if (existing) {
      const record = this.records.get(existing);
      if (record) {
        record.paragraphEl = paragraphEl;
        record.runEls = runEls;
      }
      return existing;
    }

    this.counter += 1;
    const id = `a${this.counter}`;
    this.ids.set(key, id);
    this.records.set(id, { id, paragraphEl, runEls });
    return id;
  }

  get(id: string): AnchorRecord | undefined {
    return this.records.get(id);
  }

  has(id: string): boolean {
    return this.records.has(id);
  }

  get size(): number {
    return this.records.size;
  }
}
