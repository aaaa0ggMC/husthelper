export interface ProfileField {
  label: string;
  value: string;
}

export interface ProfileSection {
  title: string;
  fields: ProfileField[];
}

export interface Profile {
  sections: ProfileSection[];
  fields: Record<string, string>;
  raw: string;
  rawHtml: string;

  name?: string;
  id?: string;
  department?: string;
  identity?: string;
  autoTransferAlert?: string;
  openDate?: string;
  expireDate?: string;
  bankCard?: string;
  cardAccount?: string;
  cardBalance?: string;
  status?: string;
  eWalletName?: string;
  eWalletType?: string;
  eWalletBalance?: string;

  get(label: string): string | undefined;
}

const FIELD_KEYS: Record<string, string> = {
  姓名: "name",
  编号: "id",
  部门: "department",
  身份: "identity",
  自动转账警戒额: "autoTransferAlert",
  开户日期: "openDate",
  有效期: "expireDate",
  绑定银行卡账号: "bankCard",
  校园卡帐号: "cardAccount",
  校园卡余额: "cardBalance",
  状态: "status",
  电子账户名: "eWalletName",
  电子账户类型: "eWalletType",
  电子账户余额: "eWalletBalance",
};

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, "&");
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

export function parseProfile(html: string): Profile {
  const sections: ProfileSection[] = [];
  const fields: Record<string, string> = {};
  let current: ProfileSection | null = null;

  const dlPattern = /<dl\b[^>]*>([\s\S]*?)<\/dl>/gi;
  let match: RegExpExecArray | null;

  while ((match = dlPattern.exec(html)) !== null) {
    const inner = match[1];
    const dt = inner.match(/<dt\b[^>]*>([\s\S]*?)<\/dt>/i);
    if (!dt) continue;

    const label = stripTags(dt[1]);
    if (!label) continue;

    const dd = inner.match(/<dd\b[^>]*>([\s\S]*?)<\/dd>/i);
    if (!dd) {
      current = { title: label, fields: [] };
      sections.push(current);
      continue;
    }

    if (!current) {
      current = { title: "", fields: [] };
      sections.push(current);
    }

    const value = stripTags(dd[1]);
    current.fields.push({ label, value });
    fields[label] = value;
  }

  const profile: Profile = {
    sections,
    fields,
    raw: html,
    rawHtml: html,
    get: (label: string) => fields[label],
  };

  for (const [label, key] of Object.entries(FIELD_KEYS)) {
    const value = fields[label];
    if (value !== undefined) (profile as unknown as Record<string, unknown>)[key] = value;
  }

  return profile;
}
