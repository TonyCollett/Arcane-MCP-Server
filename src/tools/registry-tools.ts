/**
 * Container Registry management tools for Arcane MCP Server
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toolHandler } from "../utils/tool-helpers.js";
import { moduleRegistrar, type ToolRegistry } from "./registry.js";
import { formatSize } from "../utils/format.js";
import type {
  ContainerRegistry,
  RegistryRepository,
  RegistryRepositoryTag,
} from "../types/arcane-types.js";

export function registerRegistryTools(server: McpServer, registry?: ToolRegistry): void {
  const register = moduleRegistrar(server, registry, "registry");
  // arcane_registry_list
  register(
    "arcane_registry_list",
    {
      title: "List registries",
      description: "List configured container registries",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
      search: z.string().optional().describe("Search query"),
      start: z.number().optional().default(0).describe("Pagination start"),
      limit: z.number().optional().default(20).describe("Items per page"),
    },
    },
    toolHandler(async ({ search, start, limit }, client) => {
      const response = await client.get<{
        data: ContainerRegistry[];
        pagination: { totalItems: number };
      }>("/registries", { search, start, limit });

      if (!response.data || response.data.length === 0) {
        return "No container registries configured.";
      }

      const lines = [`Found ${response.pagination.totalItems} registries:\n`];
      for (const reg of response.data) {
        lines.push(`${reg.description || reg.url}`);
        lines.push(`    ID: ${reg.id}`);
        lines.push(`    URL: ${reg.url}`);
        lines.push(`    Type: ${reg.registryType}`);
        lines.push(`    Enabled: ${reg.enabled ? "Yes" : "No"}`);
        lines.push("");
      }

      return lines.join("\n");
    })
  );

  // arcane_registry_get
  register(
    "arcane_registry_get",
    {
      title: "Get registry details",
      description: "Get details of a container registry",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
      registryId: z.string().describe("Registry ID"),
    },
    },
    toolHandler(async ({ registryId }, client) => {
      const response = await client.get<{ data: ContainerRegistry }>(
        `/registries/${registryId}`
      );

      const reg = response.data;
      const lines = [
        `Registry: ${reg.description || reg.url}`,
        `  ID: ${reg.id}`,
        `  URL: ${reg.url}`,
        `  Type: ${reg.registryType}`,
        `  Username: ${reg.username || "N/A"}`,
        `  Enabled: ${reg.enabled ? "Yes" : "No"}`,
        `  Insecure: ${reg.insecure ? "Yes" : "No"}`,
        `  Created: ${reg.createdAt || "N/A"}`,
      ];

      return lines.join("\n");
    })
  );

  // arcane_registry_create
  register(
    "arcane_registry_create",
    {
      title: "Create registry",
      description: "Add a new container registry configuration",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      inputSchema: {
      description: z.string().describe("Registry description (display label)"),
      url: z.string().describe("Registry URL (e.g., docker.io, ghcr.io)"),
      registryType: z.enum(["generic", "ecr"]).optional().default("generic").describe("Registry type: \"generic\" (any registry with username/token, e.g. Docker Hub, GHCR) or \"ecr\" (AWS keys)"),
      username: z.string().optional().describe("Username for authentication"),
      token: z.string().optional().describe("Access token / password for authentication"),
      insecure: z.boolean().optional().default(false).describe("Allow insecure (non-TLS) connections"),
      enabled: z.boolean().optional().default(true).describe("Whether the registry is enabled"),
      awsRegion: z.string().optional().describe("AWS region (required for ECR registries)"),
      awsAccessKeyId: z.string().optional().describe("AWS access key ID (for ECR registries)"),
      awsSecretAccessKey: z.string().optional().describe("AWS secret access key (for ECR registries)"),
      repositoryNames: z.array(z.string()).optional().describe("Full repository names (e.g. team/api) offered when pushing images from builds"),
    },
    },
    toolHandler(async ({ description, url, registryType, username, token, insecure, enabled, awsRegion, awsAccessKeyId, awsSecretAccessKey, repositoryNames }, client) => {
      const response = await client.post<{ data: { id: string } }>(
        "/registries",
        {
          description,
          url,
          registryType,
          username: username ?? "",
          token: token ?? "",
          insecure,
          enabled,
          awsRegion: awsRegion ?? "",
          awsAccessKeyId: awsAccessKeyId ?? "",
          awsSecretAccessKey: awsSecretAccessKey ?? "",
          repositoryNames: repositoryNames ?? [],
        }
      );

      return `Registry created: ${description} (ID: ${response.data.id})`;
    })
  );

  // arcane_registry_update
  register(
    "arcane_registry_update",
    {
      title: "Update registry",
      description: "Update a container registry configuration",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
      registryId: z.string().describe("Registry ID"),
      description: z.string().optional().describe("New description (display label)"),
      url: z.string().optional().describe("New URL"),
      username: z.string().optional().describe("New username"),
      token: z.string().optional().describe("New access token / password"),
      insecure: z.boolean().optional().describe("Allow insecure (non-TLS) connections"),
      enabled: z.boolean().optional().describe("Whether the registry is enabled"),
      repositoryNames: z.array(z.string()).optional().describe("Replace the repository names list (pass [] to clear)"),
    },
    },
    toolHandler(async ({ registryId, description, url, username, token, insecure, enabled, repositoryNames }, client) => {
      // Arcane validates every field as present; null means "leave unchanged".
      const body = {
        description: description || null,
        url: url || null,
        username: username || null,
        token: token || null,
        insecure: insecure ?? null,
        enabled: enabled ?? null,
        registryType: null,
        repositoryNames: repositoryNames ?? null,
        awsAccessKeyId: null,
        awsSecretAccessKey: null,
        awsRegion: null,
      };

      await client.patch(`/registries/${registryId}`, body);
      return `Registry ${registryId} updated.`;
    })
  );

  // arcane_registry_delete
  register(
    "arcane_registry_delete",
    {
      title: "Delete registry",
      description: "Delete a container registry configuration",
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      inputSchema: {
      registryId: z.string().describe("Registry ID"),
    },
    },
    toolHandler(async ({ registryId }, client) => {
      await client.delete(`/registries/${registryId}`);
      return `Registry ${registryId} deleted.`;
    })
  );

  // arcane_registry_test
  register(
    "arcane_registry_test",
    {
      title: "Test registry",
      description: "Test connectivity to a container registry",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      inputSchema: {
      registryId: z.string().describe("Registry ID"),
    },
    },
    toolHandler(async ({ registryId }, client) => {
      const response = await client.post<{ data: { message?: string } }>(
        `/registries/${registryId}`,
        undefined,
        { action: "test" }
      );
      return response.data?.message || "Connection successful!";
    })
  );

  // arcane_registry_sync
  register(
    "arcane_registry_sync",
    {
      title: "Sync registries",
      description: "Sync all container registries to refresh image information",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    toolHandler(async (_params, client) => {
      await client.post("/registries/sync", { registries: [] });
      return "Registry sync initiated.";
    })
  );

  // arcane_registry_list_repositories
  register(
    "arcane_registry_list_repositories",
    {
      title: "List registry repositories",
      description: "List the repositories stored in a container registry via its catalog API (Arcane v2.15+). Returns repository names usable with arcane_registry_list_tags.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: {
      registryId: z.string().describe("Registry ID"),
      search: z.string().optional().describe("Filter repositories by name"),
      order: z.enum(["asc", "desc"]).optional().default("asc").describe("Sort direction"),
      start: z.number().optional().default(0).describe("Pagination start"),
      limit: z.number().optional().default(20).describe("Items per page"),
    },
    },
    toolHandler(async ({ registryId, search, order, start, limit }, client) => {
      const response = await client.get<{
        data: RegistryRepository[];
        pagination: { totalItems: number };
      }>(`/registries/${registryId}/repositories`, { search, order, start, limit });

      if (!response.data || response.data.length === 0) {
        return search ? `No repositories matching "${search}".` : "No repositories found in this registry.";
      }

      const lines = [`Found ${response.pagination?.totalItems ?? response.data.length} repositories:\n`];
      for (const repo of response.data) {
        lines.push(`  ${repo.name}`);
      }
      return lines.join("\n");
    })
  );

  // arcane_registry_list_tags
  register(
    "arcane_registry_list_tags",
    {
      title: "List repository tags",
      description: "List the tags of a registry repository with digest, size, creation date and platforms (Arcane v2.15+)",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: {
      registryId: z.string().describe("Registry ID"),
      repository: z.string().min(1).describe("Repository name without the registry host (e.g. team/api)"),
      search: z.string().optional().describe("Filter tags by name"),
      order: z.enum(["asc", "desc"]).optional().default("asc").describe("Sort direction"),
      start: z.number().optional().default(0).describe("Pagination start"),
      limit: z.number().optional().default(20).describe("Items per page"),
    },
    },
    toolHandler(async ({ registryId, repository, search, order, start, limit }, client) => {
      const response = await client.get<{
        data: RegistryRepositoryTag[];
        pagination: { totalItems: number };
      }>(`/registries/${registryId}/tags`, { repository, search, order, start, limit });

      if (!response.data || response.data.length === 0) {
        return search ? `No tags matching "${search}" in ${repository}.` : `No tags found in ${repository}.`;
      }

      const lines = [`${repository}: ${response.pagination?.totalItems ?? response.data.length} tags\n`];
      for (const tag of response.data) {
        lines.push(`${tag.name}`);
        if (tag.error) {
          lines.push(`    Error: ${tag.error}`);
          lines.push("");
          continue;
        }
        if (tag.digest) lines.push(`    Digest: ${tag.digest}`);
        lines.push(`    Size: ${formatSize(tag.size, true)}`);
        if (tag.created) lines.push(`    Created: ${tag.created}`);
        if (tag.platforms?.length) {
          const platforms = tag.platforms.map((p) => `${p.os}/${p.architecture}${p.variant ? `/${p.variant}` : ""}`);
          lines.push(`    Platforms: ${platforms.join(", ")}`);
        }
        lines.push("");
      }
      return lines.join("\n");
    })
  );

  // arcane_registry_delete_tag
  register(
    "arcane_registry_delete_tag",
    {
      title: "Delete repository tag",
      description: "[HIGH RISK] Delete the manifest a tag points to in the remote registry (Arcane v2.15+). Every other tag sharing the same digest is removed too. The registry must allow manifest deletion.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      inputSchema: {
      registryId: z.string().describe("Registry ID"),
      repository: z.string().min(1).describe("Repository name without the registry host (e.g. team/api)"),
      tag: z.string().min(1).describe("Tag to delete"),
    },
    },
    toolHandler(async ({ registryId, repository, tag }, client) => {
      const response = await client.delete<{ data: { digest: string } }>(
        `/registries/${registryId}/tags`,
        { repository, tag }
      );
      return `Deleted ${repository}:${tag} (manifest ${response.data?.digest ?? "unknown"}). Any other tags with that digest were removed too.`;
    })
  );

}
