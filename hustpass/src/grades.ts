export interface Course {
  name: string;
  credits: number;
  score: string;
  scoreValue: number | null;
  status: string | null;
  remark: string;
}

export interface GradeSummary {
  weightedScore: number | null;
  requiredCredits: number | null;
  electiveCredits: number | null;
  totalCredits: number | null;
}

export interface WeightedResult {
  weightedScore: number | null;
  credits: number;
  counted: number;
  excluded: Course[];
}

export interface Grades {
  xn: string;
  xq: number;
  courses: Course[];
  summary: GradeSummary;
  computed: WeightedResult;
  rawHtml: string;
}

export interface GradeTerm {
  XNMC: string;
  XN: string;
}

export interface WeightedOptions {
  includeStatuses?: string[];
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function toNumber(text: string): number | null {
  const trimmed = text.trim();
  return /^-?\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : null;
}

export function parseGrades(html: string, xn: string, xq: number): Grades {
  const courses: Course[] = [];

  for (const row of html.matchAll(/<tr class="tablelist1">([\s\S]*?)<\/tr>/g)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) =>
      stripTags(cell[1]),
    );
    const [name = "", credit = "", score = "", remark = ""] = cells;
    const scoreValue = toNumber(score);
    courses.push({
      name,
      credits: Number.parseFloat(credit) || 0,
      score,
      scoreValue,
      status: scoreValue === null ? score || null : null,
      remark,
    });
  }

  const summary: GradeSummary = {
    weightedScore: null,
    requiredCredits: null,
    electiveCredits: null,
    totalCredits: null,
  };
  const summaryKeys: Record<string, keyof GradeSummary> = {
    加权排名成绩: "weightedScore",
    必修课总学分: "requiredCredits",
    公选课总学分: "electiveCredits",
    总学分: "totalCredits",
  };

  for (const match of html.matchAll(
    /<th class="tigbg">([^<]+)<\/th>\s*<th colspan="3">\s*([^<]*)<\/th>/g,
  )) {
    const key = summaryKeys[stripTags(match[1])];
    if (key) summary[key] = toNumber(match[2]);
  }

  return {
    xn,
    xq,
    courses,
    summary,
    computed: computeWeighted(courses),
    rawHtml: html,
  };
}

export function parseGradeTerms(html: string): GradeTerm[] {
  const match = html.match(/JSON\.parse\('([\s\S]*?)'\)/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[1]) as GradeTerm[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function computeWeighted(courses: Course[], options: WeightedOptions = {}): WeightedResult {
  const includeStatuses = options.includeStatuses ?? [];

  let weightedSum = 0;
  let credits = 0;
  let counted = 0;
  const excluded: Course[] = [];

  for (const course of courses) {
    const included =
      course.scoreValue !== null &&
      course.credits > 0 &&
      (course.status === null || includeStatuses.includes(course.status));

    if (included) {
      weightedSum += course.scoreValue! * course.credits;
      credits += course.credits;
      counted++;
    } else {
      excluded.push(course);
    }
  }

  return {
    weightedScore: credits > 0 ? weightedSum / credits : null,
    credits,
    counted,
    excluded,
  };
}
