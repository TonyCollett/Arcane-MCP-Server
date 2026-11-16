/**
 * Environment management tools for Arcane MCP Server
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toolHandler } from "../utils/tool-helpers.js";
import { moduleRegistrar, type ToolRegistry } from "./registry.js";
import { formatSizeGB } from "../utils/format.js";
import type { Environment } from "../types/arcane-types.js";

export function registerEnvironmentTools(server: McpServer, registry?: ToolRegistry): void {
  const register = moduleRegistrar(server, registry, "environment");
  // arcane_environment_list
  register(
    "arcane_environment_list",
    {
      title: "List environments",
      description: "List all Docker environments configured in Arcane",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
      search: z.string().optional().describe("Search query to filter environments"),
      sort: z.string().optional().describe("Column to sort by"),
      order: z.enum(["asc", "desc"]).optional().default("asc").describe("Sort direction"),
      start: z.number().optional().default(0).describe("Pagination start index"),
      limit: z.number().optional().default(20).describe("Items per page"),
    },
    },
    toolHandler(async ({ search, sort, order, start, limit }, client) => {
      const response = await client.get<{
        data: Environment[];
        pagination: { totalItems: number };
      }>("/agents", { search, sort, order, start, limit });

      if (!response.data || response.data.length === 0) {
        return "No environments found.";
      }

      const lines = [`Found ${response.pagination.totalItems} environments:\n`];
      for (const env of response.data) {
        const status = env.status || "unknown";
        lines.push(`[${status.toUpperCase()}] ${env.name} (ID: ${env.id})`);
        if (env.apiUrl) lines.push(`    URL: ${env.apiUrl}`);
      }

      return lines.join("\n");
    })
  );

  // arcane_environment_get
  register(
    "arcane_environment_get",
    {
      title: "Get environment details",
      description: "Get details of a specific Docker environment",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
      environmentId: z.string().describe("Environment ID"),
    },
    },
    toolHandler(async ({ environmentId }, client) => {
      const response = await client.get<{ data: Environment }>(`/agents/${environmentId}`);
      const env = response.data;

      const lines = [
        `Environment: ${env.name}`,
        `  ID: ${env.id}`,
        `  Status: ${env.status || "unknown"}`,
        `  API URL: ${env.apiUrl || "N/A"}`,
        `  Enabled: ${env.enabled ? "yes" : "no"}`,
        `  Connected: ${env.connected ? "yes" : "no"}`,
        `  Edge Agent: ${env.isEdge ? "yes" : "no"}`,
      ];
      if (env.connectedAt) lines.push(`  Connected At: ${env.connectedAt}`);
      if (env.lastSeen) lines.push(`  Last Seen: ${env.lastSeen}`);

      return lines.join("\n");
    })
  );

  // arcane_environment_create
  register(
    "arcane_environment_create",
    {
      title: "Create environment",
      description: "Create a new Docker environment in Arcane. Connect an agent to it with the enrollment token from arcane_environment_get_deployment_snippets",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      inputSchema: {
      name: z.string().describe("Name for the environment"),
      apiUrl: z.string().optional().describe("API URL for the Docker host"),
    },
    },
    toolHandler(async ({ name, apiUrl }, client) => {
      const response = await client.post<{ data: Environment & { apiKey?: string } }>("/agents", {
        name,
        apiUrl,
      });

      const env = response.data;
      let text = `Environment created successfully!\n  Name: ${env.name}\n  ID: ${env.id}`;
      if (env.apiKey) {
        text += `\n  API Key: ${env.apiKey}\n\n(Save this API key - it won't be shown again)`;
      }

      return text;
    })
  );

  // arcane_environment_update
  register(
    "arcane_environment_update",
    {
      title: "Update environment",
      description: "Update an existing Docker environment",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
      environmentId: z.string().describe("Environment ID to update"),
      name: z.string().optional().describe("New name for the environment"),
      apiUrl: z.string().optional().describe("New API URL"),
    },
    },
    toolHandler(async ({ environmentId, name, apiUrl }, client) => {
      const body: Record<string, unknown> = {};
      if (name) body.name = name;
      if (apiUrl) body.apiUrl = apiUrl;

      const response = await client.patch<{ data: Environment }>(`/agents/${environmentId}`, body);
      return `Environment updated: ${response.data.name}`;
    })
  );

  // arcane_environment_delete
  register(
    "arcane_environment_delete",
    {
      title: "Delete environment",
      description: "[HIGH RISK] Delete a Docker environment from Arcane. This removes the environment configuration but does not affect the actual Docker host.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      inputSchema: {
      environmentId: z.string().describe("Environment ID to delete"),
    },
    },
    toolHandler(async ({ environmentId }, client) => {
      await client.delete(`/agents/${environmentId}`);
      return `Environment ${environmentId} deleted successfully.`;
    })
  );

  // arcane_environment_test
  register(
    "arcane_environment_test",
    {
      title: "Test environment",
      description: "Test connectivity to a Docker environment",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      inputSchema: {
      environmentId: z.string().describe("Environment ID to test"),
    },
    },
    toolHandler(async ({ environmentId }, client) => {
      const response = await client.post<{ data: { status: string; message?: string } }>(
        `/agents/${environmentId}/test`
      );
      const { status, message } = response.data;
      return `Connection test: ${status}${message ? ` - ${message}` : ""}`;
    })
  );

  // arcane_environment_pair_agent
  register(
    "arcane_environment_pair_agent",
    {
      title: "Pair agent",
      description: "Get the enrollment token an agent uses to connect to an environment (Arcane 3.0 replaced pairing tokens with enrollment tokens)",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      inputSchema: {
      environmentId: z.string().describe("Environment ID"),
    },
    },
    toolHandler(async ({ environmentId }, client) => {
      const response = await client.post<{ data: { enrollmentToken?: string } }>(
        `/agents/${environmentId}/deployment`
      );

      if (!response.data?.enrollmentToken) {
        return "Arcane did not return an enrollment token for this environment.";
      }
      return `Agent enrollment token:\n  Token: ${response.data.enrollmentToken}\n\nUse arcane_environment_get_deployment_snippets for the full docker run / compose snippet.`;
    })
  );

  // arcane_environment_get_version
  register(
    "arcane_environment_get_version",
    {
      title: "Get agent version",
      description: "Get the Arcane agent version running on an environment",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
      environmentId: z.string().describe("Environment ID"),
    },
    },
    toolHandler(async ({ environmentId }, client) => {
      const response = await client.get<{ data: { currentVersion: string; buildTime?: string } }>(
        `/agents/${environmentId}/version`
      );

      return `Agent Version: ${response.data.currentVersion}${response.data.buildTime ? `\nBuild Time: ${response.data.buildTime}` : ""}`;
    })
  );

  // arcane_environment_get_docker_info
  register(
    "arcane_environment_get_docker_info",
    {
      title: "Get Docker info",
      description: "Get Docker system information for an environment",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
      environmentId: z.string().describe("Environment ID"),
    },
    },
    toolHandler(async ({ environmentId }, client) => {
      const info = await client.get<{
        ServerVersion: string;
        OperatingSystem: string;
        Architecture: string;
        Containers: number;
        ContainersRunning: number;
        ContainersStopped: number;
        Images: number;
        MemTotal: number;
        NCPU: number;
      }>(`/agents/${environmentId}/system/docker/info`);

      const lines = [
        "Docker System Info:",
        `  Version: ${info.ServerVersion}`,
        `  OS: ${info.OperatingSystem}`,
        `  Architecture: ${info.Architecture}`,
        `  CPUs: ${info.NCPU}`,
        `  Memory: ${formatSizeGB(info.MemTotal)}`,
        `  Containers: ${info.Containers} (${info.ContainersRunning} running, ${info.ContainersStopped} stopped)`,
        `  Images: ${info.Images}`,
      ];

      return lines.join("\n");
    })
  );

  // arcane_environment_get_deployment_snippets
  register(
    "arcane_environment_get_deployment_snippets",
    {
      title: "Get deployment snippets",
      description: "Get deployment snippets for installing Arcane agent on an environment",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
      environmentId: z.string().describe("Environment ID"),
    },
    },
    toolHandler(async ({ environmentId }, client) => {
      const response = await client.post<{ data: { dockerRun?: string; dockerCompose?: string; enrollmentToken?: string } }>(
        `/agents/${environmentId}/deployment`
      );

      const snippets = response.data;
      let text = "Deployment Snippets:\n\n";

      if (snippets.dockerRun) {
        text += "Docker Command:\n```\n" + snippets.dockerRun + "\n```\n\n";
      }
      if (snippets.dockerCompose) {
        text += "Docker Compose:\n```yaml\n" + snippets.dockerCompose + "\n```";
      }

      return text;
    })
  );

}
