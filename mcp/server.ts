// MCP 工具注册：只暴露 `client.aggregate` 聚合层的资源。
//
// 每个工具都经过 privacy 收口：解析披露等级、按等级裁剪形状、扣会话预算、写审计。
// 等级可以是模型传入的（只能往下降），但上限由 Privacy 在会话创建时写死。

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Privacy } from "./privacy.ts";
import { shapeResource } from "./shape.ts";
import { appendAudit } from "./audit.ts";
import {
  formatErrorResponse,
  formatToolResponse,
  getClient,
  type ToolResponse,
} from "./context.ts";

const levelField = z
  .enum(["count", "redacted", "raw"])
  .optional()
  .describe(
    "本次读取的披露等级，只能调低不能调高：count 只给数量合计、redacted（默认）逐条打码、raw 完整原文（需会话具备权限）",
  );

const CREDENTIAL_HINT =
  "凭据只来自服务进程的环境变量（HUST_USERNAME / HUST_PASSWORD），不接受工具参数。";

function compact(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value !== undefined && value !== null && value !== "") out[key] = value;
  }
  return out;
}

function summarizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out = compact(args);
  delete out.level;
  delete out.includeSensitive;
  return out;
}

export function createMcpServer(privacy: Privacy): McpServer {
  const server = new McpServer({ name: "husthelper-mcp", version: "0.1.0" });

  const run = async (
    tool: string,
    resource: string,
    loader: () => Promise<unknown>,
    args: Record<string, unknown> = {},
  ): Promise<ToolResponse> => {
    try {
      const level = privacy.resolveLevel(args.level);
      const includeSensitive = args.includeSensitive === true;
      if (includeSensitive) privacy.allowSensitive(level, true);

      const data = await loader();
      const shaped = shapeResource(resource, data, level, { includeSensitive });
      privacy.consume(level, shaped.count);
      appendAudit(privacy.dir, {
        session: privacy.sessionId,
        tool,
        resource,
        level,
        count: shaped.count,
        hiddenSensitive: shaped.hiddenSensitive || undefined,
        args: summarizeArgs(args),
      });

      const result: Record<string, unknown> = { level, resource, result: shaped.value };
      if (shaped.hiddenSensitive) result.hidden_sensitive = shaped.hiddenSensitive;
      return formatToolResponse(result);
    } catch (error) {
      return formatErrorResponse(error);
    }
  };

  server.tool(
    "hust_overview",
    `获取本人信息的综合概览：身份、余额、学期、今日课表与日程、邮箱、通知、在线设备（并发拉取，单项失败记入 errors，不影响其它）。${CREDENTIAL_HINT}`,
    { level: levelField },
    (args) => run("hust_overview", "overview", () => getClient().aggregate.overview(), args),
  );

  server.tool(
    "hust_me",
    `获取本人身份信息（姓名、学号、部门、身份、邮箱、手机等，跨来源合并）。${CREDENTIAL_HINT}`,
    { level: levelField },
    (args) => run("hust_me", "me", () => getClient().aggregate.me, args),
  );

  server.tool(
    "hust_balance",
    `获取校园卡 / 网费 / 电子账户余额。${CREDENTIAL_HINT}`,
    { level: levelField },
    (args) => run("hust_balance", "balance", () => getClient().aggregate.balance, args),
  );

  server.tool(
    "hust_term",
    `获取当前教学周与学期信息（第几周、学期号、学年等）。${CREDENTIAL_HINT}`,
    { level: levelField },
    (args) => run("hust_term", "term", () => getClient().aggregate.term, args),
  );

  server.tool(
    "hust_today",
    `获取今天的课表与日程（含当前周次）。${CREDENTIAL_HINT}`,
    { level: levelField },
    (args) => run("hust_today", "today", () => getClient().aggregate.today, args),
  );

  server.tool(
    "hust_schedule",
    `获取本学期完整课表（课程、教师、时间、地点、周次）。${CREDENTIAL_HINT}`,
    { level: levelField },
    (args) => run("hust_schedule", "schedule", () => getClient().aggregate.schedule, args),
  );

  server.tool(
    "hust_grades",
    `获取成绩：可选指定学年 xn / 学期 xq，不传则用最新学期；含加权成绩修正。${CREDENTIAL_HINT}`,
    {
      xn: z.string().optional().describe("学年代码，如 '2025'；不传取最新学期"),
      xq: z.number().int().optional().describe("学期，如 1 或 2；默认 0（全部）"),
      level: levelField,
    },
    (args) =>
      run(
        "hust_grades",
        "grades",
        () => getClient().aggregate.load("grades", compact({ xn: args.xn, xq: args.xq })),
        args,
      ),
  );

  server.tool(
    "hust_courses",
    `获取我的课程列表（在学 / 任教 / 线上课程）。${CREDENTIAL_HINT}`,
    { level: levelField },
    (args) => run("hust_courses", "courses", () => getClient().aggregate.courses, args),
  );

  server.tool(
    "hust_notifications",
    `获取通知列表（one.hust 门户 + 智慧课程合并去重）。${CREDENTIAL_HINT}`,
    {
      pageSize: z.number().int().min(1).max(50).optional().describe("拉取条数，默认 20"),
      type: z.number().int().optional().describe("智慧课程通知类型，默认 2（我接收到的）"),
      level: levelField,
    },
    (args) =>
      run(
        "hust_notifications",
        "notifications",
        () =>
          getClient().aggregate.load(
            "notifications",
            compact({ pageSize: args.pageSize, type: args.type }),
          ),
        args,
      ),
  );

  server.tool(
    "hust_documents",
    `获取校园公文 / 新闻列表。${CREDENTIAL_HINT}`,
    {
      pageSize: z.number().int().min(1).max(50).optional().describe("拉取条数，默认 20"),
      level: levelField,
    },
    (args) =>
      run(
        "hust_documents",
        "documents",
        () => getClient().aggregate.load("documents", compact({ pageSize: args.pageSize })),
        args,
      ),
  );

  server.tool(
    "hust_activities",
    `获取日程活动，默认本周；可指定起止时间（北京时间，格式 'yyyy-MM-dd HH:mm:ss'）。${CREDENTIAL_HINT}`,
    {
      beginDate: z.string().optional().describe("起始时间 'yyyy-MM-dd HH:mm:ss'，默认本周一 00:00"),
      endDate: z.string().optional().describe("结束时间 'yyyy-MM-dd HH:mm:ss'，默认本周日 23:59"),
      activityType: z.string().optional().describe("活动类型，默认 '2'"),
      level: levelField,
    },
    (args) =>
      run(
        "hust_activities",
        "activities",
        () =>
          getClient().aggregate.load(
            "activities",
            compact({
              beginDate: args.beginDate,
              endDate: args.endDate,
              activityType: args.activityType,
            }),
          ),
        args,
      ),
  );

  server.tool(
    "hust_devices",
    `获取当前在线的校园网设备（IP、上线时间）。${CREDENTIAL_HINT}`,
    { level: levelField },
    (args) => run("hust_devices", "devices", () => getClient().aggregate.devices, args),
  );

  server.tool(
    "hust_transactions",
    `获取一卡通流水（分页）。金额单位已在聚合层归一为元；命中医疗等关键词的敏感条默认隐藏。${CREDENTIAL_HINT}`,
    {
      page: z.number().int().min(1).optional().describe("页码，从 1 开始"),
      includeSensitive: z
        .boolean()
        .optional()
        .describe("是否包含敏感（医疗等）条目；默认 false，且只在 raw 等级下允许为 true"),
      level: levelField,
    },
    (args) =>
      run(
        "hust_transactions",
        "transactions",
        () => getClient().aggregate.load("transactions", compact({ page: args.page })),
        args,
      ),
  );

  server.tool(
    "hust_email",
    `获取校园邮箱信息（地址、别名、未读数量）。${CREDENTIAL_HINT}`,
    { level: levelField },
    (args) => run("hust_email", "email", () => getClient().aggregate.email, args),
  );

  server.tool(
    "hust_privacy",
    "说明当前会话的权限边界：默认等级、等级上限、是否有原文权限、预算余额与规则。",
    {},
    () => formatToolResponse(privacy.policy()),
  );

  server.tool(
    "hust_scripting_run",
    "Execute arbitrary Javascript against the husthelper aggregate API with privacy enforcement. Code is wrapped in async. Pre-injected variables: client (alias hust), console.",
    { 
      code: z.string().describe("Javascript code to execute"),
      level: levelField,
      includeSensitive: z.boolean().optional().describe("Include sensitive items (only allowed in raw level)")
    },
    async (args) => {
      const { runScript } = await import("./scripting.ts");
      const result = await runScript(privacy, args.code, { level: args.level, includeSensitive: args.includeSensitive });
      return formatToolResponse({ result });
    }
  );

  server.tool(
    "hust_scripting_man",
    "View documentation for the husthelper aggregate API methods available in scripting.",
    { 
      query: z.string().optional().describe("Search query"),
      method: z.string().optional().describe("Specific method to inspect")
    },
    async (args) => {
      const { scriptingMan } = await import("./scripting.ts");
      return formatToolResponse(scriptingMan(args));
    }
  );

  return server;
}
