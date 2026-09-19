import type { VirtualWordDocument } from "docx-edit";
import { childElementsOf, WORD_NS, type XmlElement } from "./ooxml.ts";
import type { TemplateInfo } from "./template.ts";

/**
 * 目录（TOC）支持：检测到的目录结构由 `template.ts` 负责写入 `template.json`，
 * 这里负责渲染期的目录内容生成与样式持久化。
 *
 * 支持两种底板：
 * - SDT 域式目录（Word 结构化文档标签）：重建域内容；
 * - 手工目录（“目录”标题下若干手敲条目）：按学习到的条目格式重建为静态、可点击的目录，
 *   页码用 `PAGEREF` 域，便于 Word/WPS 刷新而不依赖正文标题样式。
 */

/** 从标题段落里找 Word 自动生成的 `_Toc...` 书签名。 */
export function findHeadingBookmarkName(paragraphEl: XmlElement): string | null {
  const starts = paragraphEl.getElementsByTagName?.("w:bookmarkStart");
  if (!starts) return null;
  for (let i = 0; i < starts.length; i += 1) {
    const el = starts[i];
    const name = el.getAttribute("w:name") || el.getAttribute("name");
    if (name && (name.startsWith("_Toc") || name.startsWith("__RefHeading___Toc"))) {
      return name;
    }
  }
  return null;
}

/**
 * 启用 Word 的 updateFields 设置。
 * 在 word/settings.xml 中注入 `<w:updateFields w:val="true"/>`，
 * 使得用户在 Microsoft Word / WPS / LibreOffice 打开文档时自动刷新目录字段与页码。
 */
export async function enableDocxUpdateFields(doc: VirtualWordDocument): Promise<void> {
  const anyDoc = doc as unknown as {
    zip?: {
      file: (name: string, content?: string) => any;
    };
  };
  if (!anyDoc.zip || typeof anyDoc.zip.file !== "function") return;

  const settingsFile = anyDoc.zip.file("word/settings.xml");
  if (settingsFile && typeof settingsFile.async === "function") {
    let text: string = await settingsFile.async("text");
    if (!text.includes("w:updateFields")) {
      text = text.replace(/<w:settings([^>]*)>/, '<w:settings$1><w:updateFields w:val="true"/>');
      anyDoc.zip.file("word/settings.xml", text);
    }
  }

  // 同步为 word/styles.xml 注入/补充标准 TOC1 与 TOC2 样式的点导线制表位与字号字体，
  // 确保用户点击 WPS/Word 的“更新目录”全选重算后，目录样式依然保留，不会变回空白普通文本
  await ensureDocxTocStyles(doc);
}

async function ensureDocxTocStyles(doc: VirtualWordDocument): Promise<void> {
  const anyDoc = doc as unknown as {
    zip?: {
      file: (name: string, content?: string) => any;
    };
    stylesData?: any;
  };
  if (!anyDoc.zip || typeof anyDoc.zip.file !== "function") return;

  const stylesFile = anyDoc.zip.file("word/styles.xml");
  if (!stylesFile || typeof stylesFile.async !== "function") return;

  let text: string = await stylesFile.async("text");

  const toc1Xml =
    `<w:style w:type="paragraph" w:styleId="TOC1">` +
    `<w:name w:val="toc 1"/>` +
    `<w:basedOn w:val="Normal"/>` +
    `<w:next w:val="Normal"/>` +
    `<w:pPr>` +
    `<w:tabs><w:tab w:val="clear" w:pos="420"/><w:tab w:val="right" w:pos="8306" w:leader="dot"/></w:tabs>` +
    `<w:spacing w:lineRule="auto" w:line="360"/>` +
    `</w:pPr>` +
    `<w:rPr>` +
    `<w:rFonts w:ascii="SimSun" w:hAnsi="SimSun" w:eastAsia="SimSun" w:cs="SimSun"/>` +
    `<w:b/><w:bCs/><w:sz w:val="24"/><w:szCs w:val="24"/>` +
    `</w:rPr>` +
    `</w:style>`;

  const toc2Xml =
    `<w:style w:type="paragraph" w:styleId="TOC2">` +
    `<w:name w:val="toc 2"/>` +
    `<w:basedOn w:val="Normal"/>` +
    `<w:next w:val="Normal"/>` +
    `<w:pPr>` +
    `<w:tabs><w:tab w:val="clear" w:pos="420"/><w:tab w:val="right" w:pos="8306" w:leader="dot"/></w:tabs>` +
    `<w:spacing w:lineRule="auto" w:line="360"/>` +
    `<w:ind w:hanging="0" w:start="420" w:end="0"/>` +
    `</w:pPr>` +
    `<w:rPr>` +
    `<w:rFonts w:ascii="黑体;微软雅黑" w:eastAsia="黑体;微软雅黑" w:hAnsi="黑体;微软雅黑" w:cs="黑体;微软雅黑"/>` +
    `<w:bCs/><w:sz w:val="24"/><w:szCs w:val="24"/>` +
    `</w:rPr>` +
    `</w:style>`;

  if (/<w:style[^>]*w:styleId="TOC1"[^>]*>[\s\S]*?<\/w:style>/.test(text)) {
    text = text.replace(/<w:style[^>]*w:styleId="TOC1"[^>]*>[\s\S]*?<\/w:style>/, toc1Xml);
  } else {
    text = text.replace("</w:styles>", `${toc1Xml}</w:styles>`);
  }

  if (/<w:style[^>]*w:styleId="TOC2"[^>]*>[\s\S]*?<\/w:style>/.test(text)) {
    text = text.replace(/<w:style[^>]*w:styleId="TOC2"[^>]*>[\s\S]*?<\/w:style>/, toc2Xml);
  } else {
    text = text.replace("</w:styles>", `${toc2Xml}</w:styles>`);
  }

  anyDoc.zip.file("word/styles.xml", text);
  anyDoc.stylesData = null;
}

export interface TocHeading {
  level: number;
  text: string;
  bookmarkName: string;
}

interface TocSamples {
  pPr: Map<number, XmlElement>;
  rPr: Map<number, XmlElement>;
  tabRPr: Map<number, XmlElement>;
}

function paragraphText(paragraphEl: XmlElement): string {
  let out = "";
  const visit = (element: XmlElement): void => {
    for (const child of childElementsOf(element)) {
      if (child.nodeName === "w:t") out += child.textContent ?? "";
      else if (child.nodeName === "w:tab") out += "\t";
      else visit(child);
    }
  };
  visit(paragraphEl);
  return out;
}

function findTocSdtContent(root: XmlElement): XmlElement | null {
  const sdts = Array.from(root.getElementsByTagName("w:sdt") ?? []) as XmlElement[];
  for (const sdt of sdts) {
    const gallery = sdt.getElementsByTagName("w:docPartGallery")?.[0]?.getAttribute("w:val");
    if (gallery === "Table of Contents") {
      return sdt.getElementsByTagName("w:sdtContent")?.[0] ?? null;
    }
  }
  return null;
}

/** 手工目录：定位“目录”标题段，并收集其后的连续目录条目段（可能为空）。 */
function findManualTocRegion(root: XmlElement): { title: XmlElement; entries: XmlElement[] } | null {
  const paragraphs = Array.from(root.getElementsByTagName("w:p") ?? []) as XmlElement[];
  for (let i = 0; i < paragraphs.length; i += 1) {
    const title = paragraphText(paragraphs[i]).trim();
    if (!/^(目\s*录|TABLE\s+OF\s+CONTENTS)$/i.test(title)) continue;
    const entries: XmlElement[] = [];
    for (let j = i + 1; j < paragraphs.length && entries.length < 500; j += 1) {
      const p = paragraphs[j];
      const text = paragraphText(p).trim();
      if (!text) continue;
      // 目录条目：带前导制表符（点导线）的段落；遇到不带制表符的正文段落则停止。
      if ((p.getElementsByTagName("w:tab")?.length ?? 0) > 0) {
        entries.push(p);
        continue;
      }
      break;
    }
    return { title: paragraphs[i], entries };
  }
  return null;
}

/** 从已有目录条目中学习每个层级的 pPr / rPr / 制表符 rPr 模板。 */
function learnTocSamples(paragraphs: readonly XmlElement[]): TocSamples {
  const pPr = new Map<number, XmlElement>();
  const rPr = new Map<number, XmlElement>();
  const tabRPr = new Map<number, XmlElement>();

  const levelOf = (p: XmlElement): number => {
    const pStyle = p.getElementsByTagName("w:pStyle")?.[0]?.getAttribute("w:val") as string | undefined;
    const byStyle = pStyle ? /TOC\s*(\d+)/i.exec(pStyle) : null;
    if (byStyle) return parseInt(byStyle[1], 10);
    const numbering = /^(\d+(?:\.\d+)*)/.exec(paragraphText(p).trim());
    if (numbering) return numbering[1].split(".").length;
    return 1;
  };

  for (const p of paragraphs) {
    const level = levelOf(p);
    const pPrEl = p.getElementsByTagName("w:pPr")?.[0];
    if (pPrEl && !pPr.has(level)) pPr.set(level, pPrEl.cloneNode(true));

    const runs = Array.from(p.getElementsByTagName("w:r") ?? []) as XmlElement[];
    const textRun = runs.find((r) => {
      const t = r.getElementsByTagName("w:t")?.[0]?.textContent?.trim();
      return t && !r.getElementsByTagName("w:tab")?.[0] && !r.getElementsByTagName("w:fldChar")?.[0];
    });
    const rPrEl = textRun?.getElementsByTagName("w:rPr")?.[0];
    if (rPrEl && !rPr.has(level)) rPr.set(level, rPrEl.cloneNode(true));

    const tabRun = runs.find((r) => r.getElementsByTagName("w:tab")?.[0]);
    const tabRPrEl = tabRun?.getElementsByTagName("w:rPr")?.[0];
    if (tabRPrEl && !tabRPr.has(level)) tabRPr.set(level, tabRPrEl.cloneNode(true));
  }

  return { pPr, rPr, tabRPr };
}

/** 取某层级的样板；没有精确层级时退回任意一个已有样板。 */
function sampleFor(map: Map<number, XmlElement>, level: number): XmlElement | undefined {
  return map.get(level) ?? map.values().next().value;
}

/** 构造一个目录条目段（可点击 + PAGEREF 页码域）。 */
function buildTocEntryParagraph(
  ownerDoc: XmlElement,
  heading: TocHeading,
  samples: TocSamples,
  info: TemplateInfo,
): XmlElement {
  const p = ownerDoc.createElementNS(WORD_NS, "w:p");

  const samplePPr = sampleFor(samples.pPr, heading.level);
  if (samplePPr) {
    p.appendChild(samplePPr.cloneNode(true));
  } else {
    const pPr = ownerDoc.createElementNS(WORD_NS, "w:pPr");
    const pStyle = ownerDoc.createElementNS(WORD_NS, "w:pStyle");
    const configuredStyle = info.toc?.levels?.[String(heading.level)]?.pStyle ?? `TOC${heading.level}`;
    pStyle.setAttribute("w:val", configuredStyle);
    pPr.appendChild(pStyle);
    p.appendChild(pPr);
  }

  const hyperlink = ownerDoc.createElementNS(WORD_NS, "w:hyperlink");
  hyperlink.setAttribute("w:anchor", heading.bookmarkName);
  hyperlink.setAttribute("w:history", "1");

  const rTitle = ownerDoc.createElementNS(WORD_NS, "w:r");
  const titleRPr = sampleFor(samples.rPr, heading.level);
  if (titleRPr) rTitle.appendChild(titleRPr.cloneNode(true));
  const tTitle = ownerDoc.createElementNS(WORD_NS, "w:t");
  tTitle.textContent = heading.text;
  rTitle.appendChild(tTitle);
  hyperlink.appendChild(rTitle);

  const rTab = ownerDoc.createElementNS(WORD_NS, "w:r");
  const tabRPr = sampleFor(samples.tabRPr, heading.level) ?? titleRPr;
  if (tabRPr) rTab.appendChild(tabRPr.cloneNode(true));
  rTab.appendChild(ownerDoc.createElementNS(WORD_NS, "w:tab"));
  hyperlink.appendChild(rTab);

  // 页码用 PAGEREF 域：不依赖正文标题样式，Word/WPS 刷新即可得到正确页码。
  const fldSimple = ownerDoc.createElementNS(WORD_NS, "w:fldSimple");
  fldSimple.setAttribute("w:instr", `PAGEREF ${heading.bookmarkName} \\h`);
  const rPage = ownerDoc.createElementNS(WORD_NS, "w:r");
  if (titleRPr) rPage.appendChild(titleRPr.cloneNode(true));
  const tPage = ownerDoc.createElementNS(WORD_NS, "w:t");
  tPage.textContent = "1";
  rPage.appendChild(tPage);
  fldSimple.appendChild(rPage);
  hyperlink.appendChild(fldSimple);

  p.appendChild(hyperlink);
  return p;
}

/**
 * 根据文档渲染过程中记录的标题列表动态生成/更新目录（TOC）。
 *
 * - SDT 域式目录：重建其 `w:sdtContent`；
 * - 手工目录：删除原有条目段，按学习到的格式重建为静态可点击目录。
 */
export function updateTableOfContents(
  doc: VirtualWordDocument,
  info: TemplateInfo,
  renderedHeadings: readonly TocHeading[],
  ownerDoc: XmlElement,
): void {
  const anyDoc = doc as unknown as { partsData?: Array<{ xmlDocument?: any }> };
  const root = anyDoc.partsData?.[0]?.xmlDocument?.documentElement ?? ownerDoc?.documentElement;
  if (!root) return;
  const owner: XmlElement = ownerDoc ?? root.ownerDocument ?? root;

  const maxLevel = info.toc?.maxLevel ?? 2;
  const headings = renderedHeadings.filter((h) => h.level >= 1 && h.level <= maxLevel);
  if (headings.length === 0) return;

  const sdtContent = findTocSdtContent(root);
  if (sdtContent) {
    rebuildSdtToc(sdtContent, info, headings, owner);
    return;
  }

  // 手工目录：仅当模板声明为手动目录时才重建，避免误伤普通正文。
  if (info.toc?.type !== "manual") return;
  const region = findManualTocRegion(root);
  if (!region) return;

  const parent = region.title.parentNode;
  if (!parent) return;
  // 有条目时学习其格式；条目已被清理时，退回由 info.toc.levels 指定的目录样式（如 pStyle 31）。
  const samples: TocSamples =
    region.entries.length > 0
      ? learnTocSamples(region.entries)
      : { pPr: new Map(), rPr: new Map(), tabRPr: new Map() };
  let insertBefore: XmlElement | null;
  if (region.entries.length > 0) {
    insertBefore = region.entries[region.entries.length - 1].nextSibling;
    for (const entry of region.entries) entry.parentNode?.removeChild(entry);
  } else {
    // 条目已被清理（例如 AI 把占位目录项当作占位符删除）：直接在“目录”标题后重建。
    insertBefore = region.title.nextSibling;
  }
  const built = headings.map((heading) => buildTocEntryParagraph(owner, heading, samples, info));
  // 包一层 TOC 域（我们生成的条目作为缓存结果），这样用户可在 Word/WPS 中「更新目录」重算。
  wrapWithTocField(built, info, owner);
  for (const paragraph of built) parent.insertBefore(paragraph, insertBefore);
}

/** 把一组目录条目段包进 TOC 域：首段插入 begin/instrText/separate，末段追加 end。 */
function wrapWithTocField(paragraphs: XmlElement[], info: TemplateInfo, ownerDoc: XmlElement): void {
  if (paragraphs.length === 0) return;
  const maxLevel = info.toc?.maxLevel ?? 2;
  const instr = info.toc?.instr || `TOC \\o "1-${maxLevel}" \\h \\u `;

  const first = paragraphs[0];
  const anchor = (first.getElementsByTagName("w:pPr")?.[0] as XmlElement | undefined) ?? null;
  const insertRef: XmlElement | null = anchor ? anchor.nextSibling : first.firstChild;
  const makeRun = (nodeName: string): XmlElement => ownerDoc.createElementNS(WORD_NS, nodeName);

  const rBegin = makeRun("w:r");
  const fldBegin = makeRun("w:fldChar");
  fldBegin.setAttribute("w:fldCharType", "begin");
  rBegin.appendChild(fldBegin);

  const rInstr = makeRun("w:r");
  const instrText = makeRun("w:instrText");
  instrText.setAttribute("xml:space", "preserve");
  instrText.textContent = instr;
  rInstr.appendChild(instrText);

  const rSep = makeRun("w:r");
  const fldSep = makeRun("w:fldChar");
  fldSep.setAttribute("w:fldCharType", "separate");
  rSep.appendChild(fldSep);

  first.insertBefore(rBegin, insertRef);
  first.insertBefore(rInstr, insertRef);
  first.insertBefore(rSep, insertRef);

  const last = paragraphs[paragraphs.length - 1];
  const rEnd = makeRun("w:r");
  const fldEnd = makeRun("w:fldChar");
  fldEnd.setAttribute("w:fldCharType", "end");
  rEnd.appendChild(fldEnd);
  last.appendChild(rEnd);
}

/** 重建 SDT 域式目录：保留 TOC 域包裹（Word/WPS 可“更新目录”重算）。 */
function rebuildSdtToc(
  sdtContent: XmlElement,
  info: TemplateInfo,
  headings: readonly TocHeading[],
  ownerDoc: XmlElement,
): void {
  const samples = learnTocSamples(Array.from(sdtContent.getElementsByTagName("w:p") ?? []) as XmlElement[]);
  while (sdtContent.firstChild) sdtContent.removeChild(sdtContent.firstChild);

  const maxLevel = info.toc?.maxLevel ?? 2;
  const instr = info.toc?.instr || `TOC \\o "1-${maxLevel}" \\h \\u `;

  headings.forEach((heading, index) => {
    const isFirst = index === 0;
    const isLast = index === headings.length - 1;
    const p = ownerDoc.createElementNS(WORD_NS, "w:p");

    const samplePPr = samples.pPr.get(heading.level);
    if (samplePPr) {
      p.appendChild(samplePPr.cloneNode(true));
    } else {
      const pPr = ownerDoc.createElementNS(WORD_NS, "w:pPr");
      const pStyle = ownerDoc.createElementNS(WORD_NS, "w:pStyle");
      const configuredStyle = info.toc?.levels?.[String(heading.level)]?.pStyle ?? `TOC${heading.level}`;
      pStyle.setAttribute("w:val", configuredStyle);
      pPr.appendChild(pStyle);
      p.appendChild(pPr);
    }

    const learnedRPr = samples.rPr.get(heading.level);

    if (isFirst) {
      const rBegin = ownerDoc.createElementNS(WORD_NS, "w:r");
      const fldCharBegin = ownerDoc.createElementNS(WORD_NS, "w:fldChar");
      fldCharBegin.setAttribute("w:fldCharType", "begin");
      rBegin.appendChild(fldCharBegin);
      p.appendChild(rBegin);

      const rInstr = ownerDoc.createElementNS(WORD_NS, "w:r");
      if (learnedRPr) rInstr.appendChild(learnedRPr.cloneNode(true));
      const instrText = ownerDoc.createElementNS(WORD_NS, "w:instrText");
      instrText.setAttribute("xml:space", "preserve");
      instrText.textContent = instr;
      rInstr.appendChild(instrText);
      p.appendChild(rInstr);

      const rSep = ownerDoc.createElementNS(WORD_NS, "w:r");
      if (learnedRPr) rSep.appendChild(learnedRPr.cloneNode(true));
      const fldCharSep = ownerDoc.createElementNS(WORD_NS, "w:fldChar");
      fldCharSep.setAttribute("w:fldCharType", "separate");
      rSep.appendChild(fldCharSep);
      p.appendChild(rSep);
    }

    const hyperlink = ownerDoc.createElementNS(WORD_NS, "w:hyperlink");
    hyperlink.setAttribute("w:anchor", heading.bookmarkName);
    hyperlink.setAttribute("w:history", "1");

    const rTitle = ownerDoc.createElementNS(WORD_NS, "w:r");
    if (learnedRPr) rTitle.appendChild(learnedRPr.cloneNode(true));
    const tTitle = ownerDoc.createElementNS(WORD_NS, "w:t");
    tTitle.textContent = heading.text;
    rTitle.appendChild(tTitle);
    hyperlink.appendChild(rTitle);

    const rPage = ownerDoc.createElementNS(WORD_NS, "w:r");
    const learnedTabRPr = samples.tabRPr.get(heading.level) ?? learnedRPr;
    if (learnedTabRPr) rPage.appendChild(learnedTabRPr.cloneNode(true));
    rPage.appendChild(ownerDoc.createElementNS(WORD_NS, "w:tab"));
    const tPage = ownerDoc.createElementNS(WORD_NS, "w:t");
    tPage.textContent = "1";
    rPage.appendChild(tPage);
    hyperlink.appendChild(rPage);

    p.appendChild(hyperlink);

    if (isLast) {
      const rEnd = ownerDoc.createElementNS(WORD_NS, "w:r");
      const fldCharEnd = ownerDoc.createElementNS(WORD_NS, "w:fldChar");
      fldCharEnd.setAttribute("w:fldCharType", "end");
      rEnd.appendChild(fldCharEnd);
      p.appendChild(rEnd);
    }

    sdtContent.appendChild(p);
  });
}
