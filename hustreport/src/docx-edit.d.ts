/**
 * `docx-edit` 目前是未附带类型声明的 CommonJS 包（0.3.2）。
 * 这里只声明 hustreport 实际用到的 API 子集，避免在严格模式下出现 TS7016。
 *
 * 完整 API 见：https://github.com/CZ600/docxEdit/blob/master/docs/API.md
 */
declare module "docx-edit" {
  /** 文档虚拟树节点。 */
  export interface VNode {
    id: number;
    key: string | null;
    type: string;
    props: Record<string, any>;
    children: VNode[];
    source: unknown;
    parent?: VNode | null;
  }

  export interface StyleProfile {
    defaults: { paragraphStyle: Record<string, any>; runStyle: Record<string, any> };
    styles: Record<
      string,
      {
        name: string;
        type: string;
        basedOn: string | null;
        paragraphStyle: Record<string, any>;
        runStyle: Record<string, any>;
      }
    >;
  }

  export interface EffectiveStyle {
    paragraphStyle: Record<string, any>;
    runStyle: Record<string, any>;
  }

  export interface VirtualWordDocument {
    toComponentTree(): VNode;
    patch(nextTree: VNode): { operations: unknown[] };
    toBuffer(): Promise<Buffer>;
    saveAs(outputPath: string): Promise<void>;
    getStyleProfile(): StyleProfile;
    resolveEffectiveStyle(styleId: string | null): EffectiveStyle;
    resolveHeadingLevel(styleId: string | null): number | null;
  }

  export function loadDocx(input: string | Buffer): Promise<VirtualWordDocument>;
  export function createVNode(definition: {
    type: string;
    key?: string | null;
    props?: Record<string, any>;
    children?: any[];
  }): VNode;
  export function cloneVNode(vnode: VNode): VNode;
}
