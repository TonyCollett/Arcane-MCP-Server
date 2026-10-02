import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the client module before any imports that use it
const mockClient = {
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  sendForm: vi.fn(),
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

import { registerProjectTools } from "../project-tools.js";
import { registerRegistryTools } from "../registry-tools.js";
import { registerVolumeTools } from "../volume-tools.js";
import { registerTemplateTools } from "../template-tools.js";
import { registerAuthTools } from "../auth-tools.js";
import { registerContainerTools } from "../container-tools.js";
import { registerSettingsTools } from "../settings-tools.js";

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

type Server = Parameters<typeof registerProjectTools>[0];

describe("Arcane v2.14 API compatibility", () => {
  let server: ReturnType<typeof createMockServer>;
  const call = (name: string, params: Record<string, unknown>) => server.tools.get(name)!(params);

  beforeEach(() => {
    vi.clearAllMocks();
    server = createMockServer();
    for (const register of [registerProjectTools, registerRegistryTools, registerVolumeTools, registerTemplateTools, registerAuthTools, registerContainerTools, registerSettingsTools]) {
      register(server as unknown as Server);
    }
  });

  it("arcane_project_create sends multipart project + manifest parts", async () => {
    mockClient.sendForm.mockResolvedValueOnce({ data: { id: "p1", name: "web" } });

    const result = await call("arcane_project_create", {
      environmentId: "0",
      name: "web",
      composeContent: "services: {}",
    });

    expect(result.isError).toBeFalsy();
    const [method, path, fields] = mockClient.sendForm.mock.calls[0];
    expect(method).toBe("POST");
    expect(path).toBe("/environments/0/projects");
    expect(JSON.parse(fields.project)).toEqual({ name: "web", composeContent: "services: {}" });
    expect(JSON.parse(fields.manifest)).toEqual({ fileChanges: [] });
  });

  it("arcane_registry_create includes repositoryNames", async () => {
    mockClient.post.mockResolvedValueOnce({ data: { id: "r1" } });

    await call("arcane_registry_create", { description: "GHCR", url: "ghcr.io", registryType: "generic" });

    expect(mockClient.post.mock.calls[0][1].repositoryNames).toEqual([]);
  });

  it("arcane_registry_update sends every field, null when unchanged", async () => {
    mockClient.put.mockResolvedValueOnce(undefined);

    await call("arcane_registry_update", { registryId: "r1", token: "new-token" });

    const body = mockClient.put.mock.calls[0][1];
    expect(Object.keys(body).sort()).toEqual([
      "awsAccessKeyId", "awsRegion", "awsSecretAccessKey", "description", "enabled",
      "insecure", "registryType", "repositoryNames", "token", "url", "username",
    ]);
    expect(body.token).toBe("new-token");
    expect(body.url).toBeNull();
    expect(body.repositoryNames).toBeNull();
  });

  describe("volume workspace", () => {
    const workspace = {
      data: {
        fileTreeRevision: "rev-1",
        fileTreeTruncated: false,
        files: [
          { name: "conf", relativePath: "conf", isDirectory: true, isSymlink: false, size: 0 },
          { name: "app.yml", relativePath: "conf/app.yml", isDirectory: false, isSymlink: false, size: 2048 },
          { name: "deep.txt", relativePath: "conf/sub/deep.txt", isDirectory: false, isSymlink: false, size: 1 },
          { name: "root.txt", relativePath: "root.txt", isDirectory: false, isSymlink: false, size: 10 },
        ],
      },
    };

    it("arcane_volume_browse lists only direct children of the path", async () => {
      mockClient.get.mockResolvedValueOnce(workspace);

      const result = await call("arcane_volume_browse", { environmentId: "0", volumeName: "data", path: "/conf/" });

      expect(mockClient.get).toHaveBeenCalledWith("/environments/0/volumes/data/workspace");
      const text = result.content[0].text;
      expect(text).toContain("Contents of /conf:");
      expect(text).toContain("app.yml");
      expect(text).not.toContain("deep.txt");
      expect(text).not.toContain("root.txt");
    });

    it("arcane_volume_browse_content reads by relativePath", async () => {
      mockClient.get.mockResolvedValueOnce({ data: { content: "hello", relativePath: "conf/app.yml" } });

      const result = await call("arcane_volume_browse_content", { environmentId: "0", volumeName: "data", path: "/conf/app.yml" });

      expect(mockClient.get).toHaveBeenCalledWith("/environments/0/volumes/data/workspace/file", { relativePath: "conf/app.yml" });
      expect(result.content[0].text).toBe("hello");
    });

    it("arcane_volume_browse_mkdir sends a create_folder change with the current revision", async () => {
      mockClient.get.mockResolvedValueOnce(workspace);
      mockClient.sendForm.mockResolvedValueOnce({ data: {} });

      const result = await call("arcane_volume_browse_mkdir", { environmentId: "0", volumeName: "data", path: "/conf/new" });

      expect(result.isError).toBeFalsy();
      const [method, path, fields] = mockClient.sendForm.mock.calls[0];
      expect(method).toBe("PUT");
      expect(path).toBe("/environments/0/volumes/data/workspace");
      expect(JSON.parse(fields.manifest)).toEqual({
        fileTreeRevision: "rev-1",
        fileChanges: [{ operation: "create_folder", relativePath: "conf/new" }],
      });
    });
  });

  describe("global variables", () => {
    const variables = {
      data: [
        { id: "v1", key: "DOMAIN", value: "example.com", isSecret: false, allEnvironments: true, environmentIds: null },
        { id: "v2", key: "DOMAIN", value: "staging.example.com", isSecret: false, allEnvironments: false, environmentIds: ["2"] },
        { id: "v3", key: "OLD", value: "x", isSecret: false, allEnvironments: true, environmentIds: null },
      ],
    };

    it("arcane_template_get_variables filters by environment scope", async () => {
      mockClient.get.mockResolvedValueOnce(variables);

      const result = await call("arcane_template_get_variables", { environmentId: "3" });

      expect(mockClient.get).toHaveBeenCalledWith("/variables");
      expect(result.content[0].text).toContain("example.com");
      expect(result.content[0].text).not.toContain("staging.example.com");
    });

    it("arcane_template_update_variables upserts within scope and deletes removed keys", async () => {
      mockClient.get.mockResolvedValueOnce(variables);
      mockClient.put.mockResolvedValue({ data: { syncResults: [] } });
      mockClient.post.mockResolvedValue({ data: { syncResults: [{ environmentId: "1", status: "error", error: "offline" }] } });
      mockClient.delete.mockResolvedValue({ data: { syncResults: [] } });

      const result = await call("arcane_template_update_variables", {
        variables: { DOMAIN: "new.example.com", NEW_KEY: "1" },
        remove: ["OLD"],
      });

      expect(mockClient.put).toHaveBeenCalledWith("/variables/v1", { value: "new.example.com", isSecret: undefined });
      expect(mockClient.post).toHaveBeenCalledWith("/variables", {
        key: "NEW_KEY", value: "1", isSecret: false, allEnvironments: true, environmentIds: [],
      });
      expect(mockClient.delete).toHaveBeenCalledWith("/variables/v3");
      expect(result.content[0].text).toContain("Sync errors");
    });
  });

  it("arcane_auth_login reports passkey MFA challenges instead of crashing", async () => {
    mockClient.post.mockResolvedValueOnce({ data: { success: true, status: "mfa_required", mfa: {} } });

    const result = await call("arcane_auth_login", { username: "admin", password: "pw" });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("passkey MFA");
  });

  it("arcane_container_create maps inputs onto the ContainerCreate shape", async () => {
    mockClient.post.mockResolvedValueOnce({ data: { id: "c1", name: "/web" } });

    await call("arcane_container_create", {
      environmentId: "0",
      name: "web",
      image: "nginx",
      env: { A: "1" },
      ports: [{ containerPort: 80, hostPort: 8080, protocol: "tcp" }, { containerPort: 53, protocol: "udp" }],
      volumes: [{ hostPath: "/srv", containerPath: "/data", readOnly: true }],
      network: "proxy",
    });

    expect(mockClient.post.mock.calls[0][1]).toMatchObject({
      env: ["A=1"],
      volumes: ["/srv:/data:ro"],
      networks: ["proxy"],
      hostConfig: { portBindings: { "80/tcp": [{ hostPort: "8080" }], "53/udp": [{ hostPort: "" }] } },
    });
  });

  it("arcane_apikey_create sends permission grants", async () => {
    mockClient.post.mockResolvedValueOnce({ data: { id: "k1", name: "ci", key: "arc_x" } });

    await call("arcane_apikey_create", { name: "ci", permissions: ["containers:list"], environmentId: "0" });

    expect(mockClient.post.mock.calls[0][1].permissions).toEqual([{ permission: "containers:list", environmentId: "0" }]);
  });
});
