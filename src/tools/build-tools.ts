/**
 * Image build management tools for Arcane MCP Server
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toolHandler } from "../utils/tool-helpers.js";
import { moduleRegistrar, type ToolRegistry } from "./registry.js";
import { formatSizeCompact, toWorkspacePath, validatePath } from "../utils/format.js";
import type { Build, BuildDetails, Workspace, WorkspaceFileContent } from "../types/arcane-types.js";

export function registerBuildTools(server: McpServer, registry?: ToolRegistry): void {
  const register = moduleRegistrar(server, registry, "build");

  // arcane_build_image
  register(
    "arcane_build_image",
    {
      title: "Build image",
      description: "Build a Docker image from a build workspace directory with support for build args and multi-platform builds. Use the build workspace tools to browse/upload the build context first.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      inputSchema: {
        environmentId: z.string().describe("Environment ID"),
        contextDir: z.string().describe("Build context directory (path within the build workspace)"),
        dockerfile: z.string().optional().describe("Path to the Dockerfile within the context (default: Dockerfile)"),
        dockerfileInline: z.string().optional().describe("Inline Dockerfile content (used instead of a Dockerfile in the context)"),
        tag: z.string().describe("Image tag (e.g., myapp:latest)"),
        buildArgs: z.record(z.string(), z.string()).optional().describe("Build arguments as key-value pairs"),
        platform: z.string().optional().describe("Target platform (e.g., linux/amd64, linux/arm64)"),
        noCache: z.boolean().optional().default(false).describe("Build without using the cache"),
      },
    },
    toolHandler(async ({ environmentId, contextDir, dockerfile, dockerfileInline, tag, buildArgs, platform, noCache }, client) => {
      const body: Record<string, unknown> = { contextDir, tags: [tag], noCache };
      if (dockerfile) body.dockerfile = dockerfile;
      if (dockerfileInline) body.dockerfileInline = dockerfileInline;
      if (buildArgs) body.buildArgs = buildArgs;
      if (platform) body.platforms = [platform];

      // The build endpoint streams progress and finishes when the build is done.
      await client.post(`/agents/${environmentId}/images/build`, body);

      return `Build for ${tag} finished. Use arcane_build_list to inspect the result.`;
    })
  );

  // arcane_build_list
  register(
    "arcane_build_list",
    {
      title: "List builds",
      description: "List image builds for an environment with optional filtering by status or search query",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
        environmentId: z.string().describe("Environment ID"),
        status: z.string().optional().describe("Filter by build status (e.g., running, completed, failed)"),
        search: z.string().optional().describe("Search query"),
        start: z.number().optional().default(0).describe("Pagination start index"),
        limit: z.number().optional().default(20).describe("Items per page"),
      },
    },
    toolHandler(async ({ environmentId, status, search, start, limit }, client) => {
      const response = await client.get<{
        data: Build[];
        pagination: { totalItems: number };
      }>(`/agents/${environmentId}/images/builds`, {
        status, search, start, limit,
      });

      if (!response.data || response.data.length === 0) {
        return "No builds found.";
      }

      const lines = [`Found ${response.pagination.totalItems} builds:\n`];
      for (const build of response.data) {
        lines.push(`[${build.status.toUpperCase()}] ${build.tags?.join(", ") || build.id}`);
        lines.push(`    Build ID: ${build.id}`);
        if (build.provider) lines.push(`    Provider: ${build.provider}`);
        if (build.createdAt) lines.push(`    Created: ${build.createdAt}`);
        if (build.completedAt) lines.push(`    Completed: ${build.completedAt}`);
        if (build.errorMessage) lines.push(`    Error: ${build.errorMessage}`);
        lines.push("");
      }

      return lines.join("\n");
    })
  );

  // arcane_build_get
  register(
    "arcane_build_get",
    {
      title: "Get build details",
      description: "Get detailed information about a specific image build including logs",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
        environmentId: z.string().describe("Environment ID"),
        buildId: z.string().describe("Build ID"),
      },
    },
    toolHandler(async ({ environmentId, buildId }, client) => {
      const response = await client.get<{ data: BuildDetails }>(
        `/agents/${environmentId}/images/builds/${buildId}`
      );

      const build = response.data;
      const lines = [
        `Build Details:`,
        `  Build ID: ${build.id}`,
        `  Status: ${build.status}`,
        `  Tags: ${build.tags?.join(", ") || "N/A"}`,
        `  Platforms: ${build.platforms?.join(", ") || "default"}`,
      ];
      if (build.createdAt) lines.push(`  Created: ${build.createdAt}`);
      if (build.completedAt) lines.push(`  Completed: ${build.completedAt}`);
      if (build.errorMessage) lines.push(`  Error: ${build.errorMessage}`);
      if (build.buildArgs && Object.keys(build.buildArgs).length > 0) {
        lines.push(`  Build Args:`);
        for (const [key, value] of Object.entries(build.buildArgs)) {
          lines.push(`    ${key}=${value}`);
        }
      }
      if (build.output) {
        lines.push("");
        lines.push(`Build Output${build.outputTruncated ? " (truncated)" : ""}:`);
        lines.push(build.output);
      }

      return lines.join("\n");
    })
  );

  // arcane_build_workspace_browse
  register(
    "arcane_build_workspace_browse",
    {
      title: "Browse build workspace",
      description: "List the files and directories directly under a path in the build workspace",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
        environmentId: z.string().describe("Environment ID"),
        path: z.string().optional().describe("Directory path to browse (default: root)"),
      },
    },
    toolHandler(async ({ environmentId, path }, client) => {
      const dir = toWorkspacePath(validatePath(path ?? "/"));
      const response = await client.get<{ data: Workspace }>(`/agents/${environmentId}/builds/workspace`);

      // The workspace is a flat, recursive listing — keep only direct children of `dir`
      const prefix = dir ? `${dir}/` : "";
      const entries = (response.data?.files ?? []).filter(
        (entry) => entry.relativePath.startsWith(prefix) && !entry.relativePath.slice(prefix.length).includes("/")
      );

      if (entries.length === 0) {
        return dir ? `Directory /${dir} is empty or does not exist.` : "No files found in workspace.";
      }

      const lines = [`Workspace files${dir ? ` in /${dir}` : ""}:\n`];
      for (const entry of entries) {
        const type = entry.isDirectory ? "[DIR]" : "[FILE]";
        const size = entry.isDirectory ? "" : ` (${formatSizeCompact(entry.size)})`;
        lines.push(`${type} ${entry.name}${size}`);
      }
      if (response.data.fileTreeTruncated) {
        lines.push("\n(Workspace listing was truncated by Arcane — some entries may be missing.)");
      }

      return lines.join("\n");
    })
  );

  // arcane_build_workspace_get_content
  register(
    "arcane_build_workspace_get_content",
    {
      title: "Get workspace file content",
      description: "Get the content of a file from the build workspace",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
        environmentId: z.string().describe("Environment ID"),
        path: z.string().describe("File path in the workspace"),
      },
    },
    toolHandler(async ({ environmentId, path }, client) => {
      const relativePath = toWorkspacePath(validatePath(path));
      const response = await client.get<{ data: WorkspaceFileContent }>(
        `/agents/${environmentId}/builds/workspace/file`,
        { relativePath }
      );

      const file = response.data;
      if (file.content === undefined && file.readOnlyReason) {
        return `Cannot display /${relativePath}: ${file.readOnlyReason} (${formatSizeCompact(file.size)}, ${file.mimeType})`;
      }
      return `File: /${relativePath}\n\n${file.content ?? ""}`;
    })
  );

  // arcane_build_workspace_upload
  register(
    "arcane_build_workspace_upload",
    {
      title: "Upload workspace file",
      description: "Create or overwrite a text file in the build workspace (the parent directory must already exist)",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      inputSchema: {
        environmentId: z.string().describe("Environment ID"),
        path: z.string().describe("Destination path in the workspace"),
        content: z.string().describe("File content to upload"),
      },
    },
    toolHandler(async ({ environmentId, path, content }, client) => {
      const relativePath = toWorkspacePath(validatePath(path));
      if (!relativePath) {
        throw new Error("Path must name a file below the workspace root");
      }
      const workspacePath = `/agents/${environmentId}/builds/workspace`;
      const fileName = relativePath.split("/").pop() as string;

      // Workspace edits are optimistic: send the revision we read so Arcane can reject stale changes.
      // An overwrite also carries the file's current content as its baseline.
      const current = await client.get<{ data: Workspace }>(workspacePath);
      const exists = (current.data?.files ?? []).some((entry) => entry.relativePath === relativePath && !entry.isDirectory);
      const files = [{ name: fileName, content }];
      const change: Record<string, unknown> = { operation: exists ? "update_file" : "create_file", relativePath, uploadIndex: 0 };
      if (exists) {
        const baseline = await client.get<{ data: WorkspaceFileContent }>(`${workspacePath}/file`, { relativePath });
        change.baselineIndex = files.length;
        files.push({ name: fileName, content: baseline.data?.content ?? "" });
      }

      await client.sendForm(
        "PATCH",
        workspacePath,
        { manifest: JSON.stringify({ fileTreeRevision: current.data?.fileTreeRevision, fileChanges: [change] }) },
        files
      );

      return `File ${exists ? "updated" : "uploaded"} in workspace: /${relativePath}`;
    })
  );

}
