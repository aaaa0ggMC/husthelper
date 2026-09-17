#!/usr/bin/env node
// husthelper MCP 入口。
//
//   node index.ts                  → stdio（本机进程，凭据走环境变量）
//   node index.ts --port 3000      → Streamable HTTP (/mcp) + 旧版 SSE (/sse)
//
// HTTP 模式没有匿名访问：每个会话都必须带 X-Hust-Key（或 Authorization: Bearer <key>）。

import http from "node:http";
import { URL } from "node:url";
import { randomUUID } from "node:crypto";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./server.ts";
import { dataDir } from "./context.ts";
import { ensureKey, Privacy, PrivacyError } from "./privacy.ts";

function parseArgs() {
  const args = process.argv.slice(2);
  let port: number | null = null;
  let host = process.env.HOST || "127.0.0.1";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port" || args[i] === "-p") {
      port = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--host") {
      host = args[i + 1];
      i++;
    } else if (args[i] === "--sse" || args[i] === "--http") {
      port = port || 3000;
    }
  }

  if (!port && (process.env.PORT || process.env.MCP_PORT)) {
    port = parseInt(process.env.PORT || process.env.MCP_PORT || "3000", 10);
  }

  return { port, host };
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function extractKey(headers: http.IncomingHttpHeaders): string | undefined {
  const direct =
    firstHeader(headers["x-hust-key"]) ??
    firstHeader(headers["x-hust-privacy-key"]) ??
    firstHeader(headers["x-privacy-key"]);
  if (direct && direct.trim()) return direct.trim();

  const auth = firstHeader(headers["authorization"]);
  if (auth && auth.startsWith("Bearer ")) {
    const token = auth.slice(7).trim();
    if (token) return token;
  }
  return undefined;
}

function extractLevel(headers: http.IncomingHttpHeaders): string | undefined {
  const level = firstHeader(headers["x-hust-level"]);
  return level && level.trim() ? level.trim() : undefined;
}

function buildSessionPrivacy(req: http.IncomingMessage, sessionId: string): Privacy {
  const privacy = new Privacy({
    dir: dataDir(),
    suppliedKey: extractKey(req.headers) ?? null,
    maxLevel: extractLevel(req.headers) ?? null,
    transport: "http",
    sessionId,
  });
  privacy.assertAccess();
  privacy.assertKeyConsistent();
  return privacy;
}

function reject(res: http.ServerResponse, status: number, error: PrivacyError | Error): void {
  const code = error instanceof PrivacyError ? error.code : "UNAUTHORIZED";
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32001, message: `${code}: ${error.message}` },
      id: null,
    }),
  );
}

async function startStdio() {
  const key = ensureKey(dataDir());
  if (key.created) {
    process.stderr.write(`[hust-mcp] 已生成隐私密钥: ${key.key}\n`);
  }
  const privacy = new Privacy({ dir: dataDir(), transport: "stdio" });
  privacy.assertKeyConsistent();

  const server = createMcpServer(privacy);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[hust-mcp] stdio 已就绪（默认等级 ${privacy.defaultLevel}）\n`);
}

interface StreamableSession {
  server: ReturnType<typeof createMcpServer>;
  transport: StreamableHTTPServerTransport;
  lastActive: number;
}

async function startHttp(port: number, host: string) {
  const key = ensureKey(dataDir());
  if (key.created) {
    process.stderr.write(`[hust-mcp] 已生成隐私密钥: ${key.key}\n`);
  }

  const streamableSessions = new Map<string, StreamableSession>();
  const sseTransports = new Map<string, SSEServerTransport>();

  setInterval(() => {
    const now = Date.now();
    for (const [id, session] of streamableSessions.entries()) {
      if (now - session.lastActive > 3600_000) {
        session.transport.close().catch(() => {});
        streamableSessions.delete(id);
      }
    }
  }, 60_000).unref();

  const httpServer = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, mcp-session-id, x-hust-key, x-hust-privacy-key, x-privacy-key, x-hust-level, accept",
    );
    res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (!req.headers["accept"] || !req.headers["accept"].includes("text/event-stream")) {
      req.headers["accept"] = "application/json, text/event-stream, */*";
    }

    const parsedUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (parsedUrl.pathname === "/" || parsedUrl.pathname === "/health") {
      const mem = process.memoryUsage();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify(
          {
            status: "ok",
            service: "husthelper-mcp",
            active_sessions: {
              streamable_http: streamableSessions.size,
              sse: sseTransports.size,
            },
            memory: {
              heap_used: `${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB`,
              rss: `${(mem.rss / 1024 / 1024).toFixed(2)} MB`,
            },
            auth: ["X-Hust-Key", "Authorization: Bearer <key>"],
            disclosure_ceiling: "X-Hust-Level: count | redacted | raw",
            transports: {
              streamable_http: `http://${host}:${port}/mcp`,
              sse: `http://${host}:${port}/sse`,
            },
          },
          null,
          2,
        ),
      );
      return;
    }

    if (parsedUrl.pathname === "/mcp") {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (sessionId && streamableSessions.has(sessionId)) {
        const session = streamableSessions.get(sessionId)!;
        session.lastActive = Date.now();
        await session.transport.handleRequest(req, res);
        return;
      }

      let privacy: Privacy;
      try {
        privacy = buildSessionPrivacy(req, randomUUID());
      } catch (error) {
        reject(res, error instanceof PrivacyError && error.code === "ACCESS_DENIED" ? 401 : 403, error as Error);
        return;
      }

      let sessionServer: ReturnType<typeof createMcpServer>;
      const sessionTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newId) => {
          streamableSessions.set(newId, {
            server: sessionServer,
            transport: sessionTransport,
            lastActive: Date.now(),
          });
        },
        onsessionclosed: (closedId) => {
          streamableSessions.delete(closedId);
        },
      });

      sessionServer = createMcpServer(privacy);
      await sessionServer.connect(sessionTransport);
      await sessionTransport.handleRequest(req, res);
      return;
    }

    if (parsedUrl.pathname === "/sse") {
      let privacy: Privacy;
      try {
        privacy = buildSessionPrivacy(req, randomUUID());
      } catch (error) {
        reject(res, error instanceof PrivacyError && error.code === "ACCESS_DENIED" ? 401 : 403, error as Error);
        return;
      }

      const server = createMcpServer(privacy);
      const transport = new SSEServerTransport("/message", res);
      sseTransports.set(transport.sessionId, transport);
      transport.onclose = () => {
        sseTransports.delete(transport.sessionId);
      };
      await server.connect(transport);
      process.stderr.write(`[SSE] client connected: ${transport.sessionId}\n`);
      return;
    }

    if (parsedUrl.pathname === "/message" && req.method === "POST") {
      const sessionId = parsedUrl.searchParams.get("sessionId");
      const transport = sessionId
        ? sseTransports.get(sessionId)
        : Array.from(sseTransports.values())[0];
      if (transport) {
        await transport.handlePostMessage(req, res);
        return;
      }
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Session not found or expired" }));
      return;
    }

    res.writeHead(404).end("Not found");
  });

  httpServer.listen(port, host, () => {
    process.stderr.write(
      `[hust-mcp] HTTP 已就绪\n` +
        `  Streamable HTTP: http://${host}:${port}/mcp\n` +
        `  SSE:             http://${host}:${port}/sse\n` +
        `  健康检查:        http://${host}:${port}/health\n`,
    );
  });
}

async function main() {
  const { port, host } = parseArgs();
  if (port) {
    await startHttp(port, host);
  } else {
    await startStdio();
  }
}

main().catch((error) => {
  process.stderr.write(
    `[hust-mcp] 启动失败: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
