import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Mock the client module before any imports that use it
const mockClient = {
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  sendForm: vi.fn(),
  postInBackground: vi.fn(),
  getBaseUrl: vi.fn(() => "https://arcane.test"),
  getDefaultEnvironmentId: vi.fn(() => "env-1"),
};

vi.mock("../../client/arcane-client.js", () => ({
  getArcaneClient: vi.fn(() => mockClient),
}));

vi.mock("../../utils/error-handler.js", () => ({
  formatError: vi.fn((err: unknown) => (err instanceof Error ? err.message : String(err))),
}));

vi.mock("../../utils/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { registerProjectTools } from "../project-tools.js";
import { registerContainerTools } from "../container-tools.js";
import { registerSystemTools } from "../system-tools.js";
import { registerBuildTools } from "../build-tools.js";
import { registerNotificationTools } from "../notification-tools.js";
import { registerImageUpdateTools } from "../image-update-tools.js";
import { registerSwarmTools } from "../swarm-tools.js";
import { registerEnvironmentTools } from "../environment-tools.js";

const here = dirname(fileURLToPath(import.meta.url));
const toolsDir = join(here, "..");

type ToolHandler = (params: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

function createMockServer() {
  const tools = new Map<string, ToolHandler>();
  return {
    registerTool: vi.fn((name: string, _config: unknown, handler: ToolHandler) => {
      tools.set(name, handler);
    }),
    tools,
  };
}

type Server = Parameters<typeof registerProjectTools>[0];

/**
 * Arcane 3.0 moved its whole API from /environments/{id} to /agents/{id} and folded
 * most action endpoints into `?action=` on the resource. Every call the tools make
 * as a string literal is checked against the bundled OpenAPI spec, so the next API
 * reshuffle fails here instead of on a live server.
 */
describe("API paths match the bundled Arcane OpenAPI spec", () => {
  const spec = JSON.parse(readFileSync(join(here, "../../../_docs/arcane_api_docs.json"), "utf8")) as {
    info: { version: string };
    paths: Record<string, Record<string, unknown>>;
  };
  const norm = (path: string) => path.split("?")[0].replace(/\{[^}]*\}/g, "{}");
  const known = new Set<string>();
  for (const [path, ops] of Object.entries(spec.paths)) {
    for (const method of Object.keys(ops)) known.add(`${method.toUpperCase()} ${norm(path)}`);
  }

  const methodOf: Record<string, string> = {
    get: "GET",
    post: "POST",
    put: "PUT",
    patch: "PATCH",
    delete: "DELETE",
    postInBackground: "POST",
  };
  const calls: Array<{ where: string; call: string }> = [];
  const callRe =
    /client\.(get|post|put|patch|delete|postInBackground)\s*(?:<[\s\S]*?>)?\s*\(\s*([`"'])([\s\S]*?)\2/g;
  for (const file of readdirSync(toolsDir).filter((f) => f.endsWith("-tools.ts"))) {
    const source = readFileSync(join(toolsDir, file), "utf8");
    for (const match of source.matchAll(callRe)) {
      const path = match[3].replace(/\$\{[^}]+\}/g, "{}");
      // Paths assembled from a prefix variable (e.g. `${base}/containers/counts`) can't be resolved here.
      if (path.startsWith("{}")) continue;
      const line = source.slice(0, match.index).split("\n").length;
      calls.push({ where: `${file}:${line}`, call: `${methodOf[match[1]]} ${norm(path)}` });
    }
  }

  it("is the Arcane 3.x spec", () => {
    expect(spec.info.version).toMatch(/^3\./);
  });

  it("finds the tools' API calls", () => {
    expect(calls.length).toBeGreaterThan(150);
  });

  it("only calls endpoints that exist, with the right method", () => {
    const unknown = calls.filter(({ call }) => !known.has(call)).map(({ where, call }) => `${where} ${call}`);
    expect(unknown).toEqual([]);
  });

  it("no longer uses the pre-3.0 environments prefix", () => {
    expect(calls.filter(({ call }) => call.includes("/environments/"))).toEqual([]);
  });
});

describe("Arcane v3 API compatibility", () => {
  let server: ReturnType<typeof createMockServer>;
  const call = (name: string, params: Record<string, unknown>) => server.tools.get(name)!(params);

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset only the client's methods: resetting every mock would also wipe the getArcaneClient factory.
    for (const method of [mockClient.get, mockClient.post, mockClient.put, mockClient.patch, mockClient.delete, mockClient.sendForm, mockClient.postInBackground]) {
      method.mockReset();
    }
    server = createMockServer();
    for (const register of [
      registerProjectTools,
      registerContainerTools,
      registerSystemTools,
      registerBuildTools,
      registerNotificationTools,
      registerImageUpdateTools,
      registerSwarmTools,
      registerEnvironmentTools,
    ]) {
      register(server as unknown as Server);
    }
  });

  it("container start/stop/restart are ?action= on the container", async () => {
    mockClient.post.mockResolvedValue({ data: {} });
    for (const action of ["start", "stop", "restart"]) {
      await call(`arcane_container_${action}`, { environmentId: "0", containerId: "c1" });
      expect(mockClient.post).toHaveBeenLastCalledWith("/agents/0/containers/c1", undefined, { action });
    }
  });

  it("project up, redeploy and pull go through /deploy", async () => {
    mockClient.post.mockResolvedValue(undefined);
    for (const action of ["up", "redeploy", "pull"]) {
      await call(`arcane_project_${action === "pull" ? "pull_images" : action}`, { environmentId: "0", projectId: "p1" });
      expect(mockClient.post).toHaveBeenLastCalledWith("/agents/0/projects/p1/deploy", {}, { action });
    }
  });

  it("project down and restart are ?action= on the project", async () => {
    mockClient.post.mockResolvedValue({ data: {} });
    for (const action of ["down", "restart"]) {
      await call(`arcane_project_${action}`, { environmentId: "0", projectId: "p1" });
      expect(mockClient.post).toHaveBeenLastCalledWith("/agents/0/projects/p1", undefined, { action });
    }
  });

  it("project update-services sends each service as a query value", async () => {
    await call("arcane_project_update_services", { environmentId: "0", projectId: "p1", services: ["web", "db"] });
    expect(mockClient.postInBackground).toHaveBeenCalledWith(
      "/agents/0/projects/p1?action=updateservices&services=web&services=db",
      {}
    );
  });

  it("project destroy deletes the project itself", async () => {
    mockClient.delete.mockResolvedValue(undefined);
    await call("arcane_project_destroy", { environmentId: "0", projectId: "p1", removeVolumes: true, removeFiles: false });
    expect(mockClient.delete).toHaveBeenCalledWith("/agents/0/projects/p1", undefined, {
      removeVolumes: true,
      removeFiles: false,
    });
  });

  it("project get merges the summary, runtime and updates sections", async () => {
    mockClient.get.mockImplementation(async (path: string) => {
      if (path.endsWith("/runtime")) {
        return { data: { runtimeServices: [{ name: "web", status: "running", containerName: "web-1" }] } };
      }
      if (path.endsWith("/updates")) {
        return { data: { updateInfo: { status: "has_update", hasUpdate: true, updatedImageRefs: ["nginx:1.27"] } } };
      }
      return { data: { id: "p1", name: "site", status: "running", path: "/projects/site" } };
    });

    const result = await call("arcane_project_get", { environmentId: "0", projectId: "p1" });
    const text = result.content[0].text;
    expect(result.isError).toBeUndefined();
    expect(text).toContain("Project: site");
    expect(text).toContain("- web: running [web-1]");
    expect(text).toContain("Image updates available: nginx:1.27");
  });

  it("project get still answers when only the summary loads", async () => {
    mockClient.get.mockImplementation(async (path: string) => {
      if (path.endsWith("/runtime") || path.endsWith("/updates")) throw new Error("boom");
      return { data: { id: "p1", name: "site", status: "running" } };
    });
    const result = await call("arcane_project_get", { environmentId: "0", projectId: "p1" });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Project: site");
  });

  it("bulk container actions use ?action= and count the containers Arcane reports", async () => {
    mockClient.post.mockResolvedValue({ data: { stopped: ["a", "b"], failed: ["c"], errors: ["c: in use"] } });
    const result = await call("arcane_system_containers_stop_all", { environmentId: "0" });
    expect(mockClient.post).toHaveBeenCalledWith("/agents/0/system/containers", undefined, { action: "stopall" });
    expect(result.content[0].text).toContain("Stopped 2 containers.");
    expect(result.content[0].text).toContain("Failed: c");
  });

  it("build workspace upload sends a create_file manifest for a new file", async () => {
    mockClient.get.mockResolvedValueOnce({ data: { files: [], fileTreeRevision: "rev-1", fileTreeTruncated: false } });
    mockClient.sendForm.mockResolvedValueOnce({ data: {} });

    const result = await call("arcane_build_workspace_upload", { environmentId: "0", path: "app/Dockerfile", content: "FROM alpine" });

    expect(result.content[0].text).toContain("uploaded");
    const [method, path, fields, files] = mockClient.sendForm.mock.calls[0];
    expect(method).toBe("PATCH");
    expect(path).toBe("/agents/0/builds/workspace");
    expect(JSON.parse(fields.manifest)).toEqual({
      fileTreeRevision: "rev-1",
      fileChanges: [{ operation: "create_file", relativePath: "app/Dockerfile", uploadIndex: 0 }],
    });
    expect(files).toEqual([{ name: "Dockerfile", content: "FROM alpine" }]);
  });

  it("build workspace upload overwrites an existing file with its baseline", async () => {
    mockClient.get
      .mockResolvedValueOnce({
        data: {
          files: [{ relativePath: "Dockerfile", name: "Dockerfile", isDirectory: false, size: 3 }],
          fileTreeRevision: "rev-2",
          fileTreeTruncated: false,
        },
      })
      .mockResolvedValueOnce({ data: { content: "old" } });
    mockClient.sendForm.mockResolvedValueOnce({ data: {} });

    await call("arcane_build_workspace_upload", { environmentId: "0", path: "/Dockerfile", content: "new" });

    expect(mockClient.get).toHaveBeenLastCalledWith("/agents/0/builds/workspace/file", { relativePath: "Dockerfile" });
    const [, , fields, files] = mockClient.sendForm.mock.calls[0];
    expect(JSON.parse(fields.manifest).fileChanges).toEqual([
      { operation: "update_file", relativePath: "Dockerfile", uploadIndex: 0, baselineIndex: 1 },
    ]);
    expect(files).toEqual([
      { name: "Dockerfile", content: "new" },
      { name: "Dockerfile", content: "old" },
    ]);
  });

  it("build workspace browse lists direct children of a directory", async () => {
    mockClient.get.mockResolvedValueOnce({
      data: {
        files: [
          { relativePath: "app", name: "app", isDirectory: true, size: 0 },
          { relativePath: "app/Dockerfile", name: "Dockerfile", isDirectory: false, size: 12 },
          { relativePath: "app/src/main.go", name: "main.go", isDirectory: false, size: 40 },
        ],
        fileTreeRevision: "r",
        fileTreeTruncated: false,
      },
    });
    const result = await call("arcane_build_workspace_browse", { environmentId: "0", path: "app" });
    const text = result.content[0].text;
    expect(mockClient.get).toHaveBeenCalledWith("/agents/0/builds/workspace");
    expect(text).toContain("[FILE] Dockerfile");
    expect(text).not.toContain("main.go");
  });

  it("notification settings are global and the test is ?action=test", async () => {
    mockClient.post.mockResolvedValue({ data: { message: "sent" } });
    await call("arcane_notification_test", { provider: "discord" });
    expect(mockClient.post).toHaveBeenCalledWith("/notifications/settings/discord", undefined, { action: "test" });

    mockClient.get.mockResolvedValue([]);
    await call("arcane_notification_get_settings", { environmentId: "0" });
    expect(mockClient.get).toHaveBeenCalledWith("/notifications/settings");
  });

  it("batch image update checks are ?action=batch", async () => {
    mockClient.post.mockResolvedValue({ data: {} });
    await call("arcane_image_update_check_multiple", { environmentId: "0", imageRefs: ["nginx:latest"] });
    expect(mockClient.post).toHaveBeenCalledWith(
      "/agents/0/images/updates/check",
      { imageRefs: ["nginx:latest"] },
      { action: "batch" }
    );
  });

  it("swarm scale patches the service", async () => {
    mockClient.patch.mockResolvedValue({ data: {} });
    await call("arcane_swarm_scale_service", { environmentId: "0", serviceId: "s1", replicas: 3 });
    expect(mockClient.patch).toHaveBeenCalledWith("/agents/0/swarm/services/s1", { replicas: 3 });
  });

  it("pair agent returns the enrollment token from the deployment endpoint", async () => {
    mockClient.post.mockResolvedValue({ data: { enrollmentToken: "tok-123" } });
    const result = await call("arcane_environment_pair_agent", { environmentId: "2" });
    expect(mockClient.post).toHaveBeenCalledWith("/agents/2/deployment");
    expect(result.content[0].text).toContain("tok-123");
  });
});
