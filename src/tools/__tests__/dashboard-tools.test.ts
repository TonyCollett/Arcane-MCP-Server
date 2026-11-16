import { describe, it, expect, vi, beforeEach } from "vitest";

const mockClient = {
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  getBaseUrl: vi.fn(() => "https://arcane.test"),
  getDefaultEnvironmentId: vi.fn(() => "env-1"),
};

vi.mock("../../client/arcane-client.js", () => ({
  getArcaneClient: vi.fn(() => mockClient),
}));

vi.mock("../../utils/error-handler.js", () => ({
  formatError: vi.fn((err: unknown) =>
    err instanceof Error ? err.message : String(err)
  ),
}));

vi.mock("../../utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { registerDashboardTools } from "../dashboard-tools.js";

type ToolHandler = (params: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

function createMockServer() {
  const tools = new Map<string, ToolHandler>();
  return {
    registerTool: vi.fn(
      (name: string, _config: unknown, handler: ToolHandler) => {
        tools.set(name, handler);
      }
    ),
    tools,
  };
}

describe("dashboard-tools", () => {
  let server: ReturnType<typeof createMockServer>;

  beforeEach(() => {
    vi.clearAllMocks();
    server = createMockServer();
    registerDashboardTools(server as unknown as Parameters<typeof registerDashboardTools>[0]);
  });

  it("registers the dashboard tool", () => {
    expect(server.tools.has("arcane_dashboard_get")).toBe(true);
    expect(server.tools.size).toBe(1);
  });

  describe("arcane_dashboard_get", () => {
    const responses: Record<string, unknown> = {
      "/agents/env-1/containers/counts": {
        data: { totalContainers: 10, runningContainers: 7, stoppedContainers: 3, unhealthyContainers: 1, updatesAvailable: 2 },
      },
      "/agents/env-1/projects/counts": {
        data: { totalProjects: 4, runningProjects: 3, stoppedProjects: 1, updatesAvailable: 0 },
      },
      "/agents/env-1/images/counts": {
        data: { totalImages: 15, totalImageSize: 5e9, imagesInuse: 12, imagesUnused: 3 },
      },
      "/agents/env-1/volumes/counts": { data: { total: 6, inuse: 5, unused: 1 } },
      "/agents/env-1/networks/counts": { data: { total: 3, inuse: 2, unused: 1 } },
      "/app/version": { currentVersion: "v3.0.1", newestVersion: "v3.0.2", updateAvailable: true },
    };

    it("combines the per-resource counts endpoints", async () => {
      mockClient.get.mockImplementation(async (path: string) => responses[path]);

      const handler = server.tools.get("arcane_dashboard_get")!;
      const result = await handler({ environmentId: "env-1" });

      const text = result.content[0].text;
      expect(text).toContain("Containers: 10 total (7 running, 3 stopped, 1 unhealthy, 2 with updates)");
      expect(text).toContain("Projects: 4 total (3 running, 1 stopped)");
      expect(text).toContain("Images: 15 total (12 in use, 3 unused");
      expect(text).toContain("Volumes: 6 total (5 in use, 1 unused)");
      expect(text).toContain("Networks: 3 total (2 in use, 1 unused)");
      expect(text).toContain("Arcane: v3.0.1 (update available: v3.0.2)");
      expect(text).not.toContain("Unavailable");
      expect(result.isError).toBeUndefined();
      expect(mockClient.get).not.toHaveBeenCalledWith("/agents/env-1/dashboard");
    });

    it("lists counts that failed but still reports the rest", async () => {
      mockClient.get.mockImplementation(async (path: string) => {
        if (path.endsWith("/volumes/counts")) throw new Error("boom");
        return responses[path];
      });

      const handler = server.tools.get("arcane_dashboard_get")!;
      const result = await handler({ environmentId: "env-1" });

      const text = result.content[0].text;
      expect(text).toContain("Containers: 10 total");
      expect(text).toContain("Unavailable: volumes");
      expect(result.isError).toBeUndefined();
    });

    it("returns isError when every request fails", async () => {
      mockClient.get.mockRejectedValue(new Error("Server error"));

      const handler = server.tools.get("arcane_dashboard_get")!;
      const result = await handler({ environmentId: "env-1" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Server error");
    });
  });
});
