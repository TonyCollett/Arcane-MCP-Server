/**
 * HTTP transport session handling.
 *
 * After the server restarts (every redeploy) or a session expires, hosted MCP
 * clients such as claude.ai keep sending tool calls with no session ID or with
 * their old one instead of re-initializing. Those used to reach a fresh, never
 * initialized stateful transport, which answers 400 "Server not initialized",
 * and the client gave up until the connector was reset.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server as HttpServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

vi.mock("../utils/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

process.env.ARCANE_BASE_URL ??= "https://arcane.test";

const { createMcpApp } = await import("../tcp-server.js");

type ToolsReply = { id: number; result: { tools: Array<{ name: string }> } };

const headers = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

describe("MCP HTTP sessions", () => {
  let http: HttpServer;
  let url: string;

  beforeAll(async () => {
    http = createMcpApp().listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => http.once("listening", () => resolve()));
    url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => http.close(() => resolve()));
  });

  const listTools = (extra: Record<string, string> = {}) =>
    fetch(url, {
      method: "POST",
      headers: { ...headers, ...extra },
      body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list" }),
    });

  it("answers a sessionless tool request instead of 400", async () => {
    const res = await listTools();

    expect(res.status).toBe(200);
    expect(res.headers.get("mcp-session-id")).toBeNull();
    const json = (await res.json()) as ToolsReply;
    expect(json.id).toBe(7);
    expect(json.result.tools.length).toBeGreaterThan(100);
  });

  it("answers a request carrying a session ID from before a restart", async () => {
    const res = await listTools({ "Mcp-Session-Id": "00000000-0000-0000-0000-000000000000" });

    expect(res.status).toBe(200);
    const json = (await res.json()) as ToolsReply;
    expect(json.result.tools.some((t) => t.name === "arcane_version_get")).toBe(true);
  });

  it("still opens a real session for an initialize request", async () => {
    const transport = new StreamableHTTPClientTransport(new URL(url));
    const client = new Client({ name: "test", version: "1.0" }, { capabilities: {} });
    await client.connect(transport);

    expect(transport.sessionId).toBeTruthy();
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(100);

    await client.close();
  });
});
