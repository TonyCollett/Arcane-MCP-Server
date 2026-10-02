/**
 * Template management tools for Arcane MCP Server
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toolHandler } from "../utils/tool-helpers.js";
import { moduleRegistrar, type ToolRegistry } from "./registry.js";
import type { Template, GlobalVariable, GlobalVariableMutation } from "../types/arcane-types.js";

export function registerTemplateTools(server: McpServer, registry?: ToolRegistry): void {
  const register = moduleRegistrar(server, registry, "template");
  // arcane_template_list
  register(
    "arcane_template_list",
    {
      title: "List templates",
      description: "List available Docker Compose templates",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
      search: z.string().optional().describe("Search query"),
      type: z.string().optional().describe("Filter by template type"),
      start: z.number().optional().default(0).describe("Pagination start"),
      limit: z.number().optional().default(20).describe("Items per page"),
    },
    },
    toolHandler(async ({ search, type, start, limit }, client) => {
      const response = await client.get<{
        data: Template[];
        pagination: { totalItems: number };
      }>("/templates", { search, type, start, limit });

      if (!response.data || response.data.length === 0) {
        return "No templates found.";
      }

      const lines = [`Found ${response.pagination.totalItems} templates:\n`];
      for (const tmpl of response.data) {
        lines.push(`${tmpl.name}`);
        lines.push(`    ID: ${tmpl.id}`);
        if (tmpl.registry?.name) lines.push(`    Registry: ${tmpl.registry.name}`);
        if (tmpl.description) lines.push(`    Description: ${tmpl.description.substring(0, 80)}...`);
        lines.push("");
      }

      return lines.join("\n");
    })
  );

  // arcane_template_get
  register(
    "arcane_template_get",
    {
      title: "Get template details",
      description: "Get details of a Docker Compose template",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
      templateId: z.string().describe("Template ID"),
    },
    },
    toolHandler(async ({ templateId }, client) => {
      const response = await client.get<{ data: Template }>(`/templates/${templateId}`);

      const tmpl = response.data;
      const lines = [
        `Template: ${tmpl.name}`,
        `  ID: ${tmpl.id}`,
        `  Remote: ${tmpl.isRemote ? "Yes" : "No"}`,
        `  Custom: ${tmpl.isCustom ? "Yes" : "No"}`,
        `  Registry: ${tmpl.registry?.name || "N/A"}`,
        `  Description: ${tmpl.description || "N/A"}`,
      ];

      return lines.join("\n");
    })
  );

  // arcane_template_get_content
  register(
    "arcane_template_get_content",
    {
      title: "Get template content",
      description: "Get the Docker Compose YAML content of a template",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
      templateId: z.string().describe("Template ID"),
    },
    },
    toolHandler(async ({ templateId }, client) => {
      const response = await client.get<{ data: { content: string } }>(
        `/templates/${templateId}/content`
      );

      return response.data.content;
    })
  );

  // arcane_template_create
  register(
    "arcane_template_create",
    {
      title: "Create template",
      description: "Create a new Docker Compose template",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      inputSchema: {
      name: z.string().describe("Template name"),
      description: z.string().optional().describe("Template description"),
      content: z.string().describe("Docker Compose YAML content"),
      envContent: z.string().optional().describe("Environment file (.env) content"),
    },
    },
    toolHandler(async ({ name, description, content, envContent }, client) => {
      const response = await client.post<{ data: { id: string; name: string } }>(
        "/templates",
        { name, description: description ?? "", content, envContent: envContent ?? "" }
      );

      return `Template created: ${response.data.name} (ID: ${response.data.id})`;
    })
  );

  // arcane_template_update
  register(
    "arcane_template_update",
    {
      title: "Update template",
      description: "Update a Docker Compose template",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
      templateId: z.string().describe("Template ID"),
      name: z.string().optional().describe("New name"),
      description: z.string().optional().describe("New description"),
      content: z.string().optional().describe("New YAML content"),
      envContent: z.string().optional().describe("New environment file (.env) content"),
    },
    },
    toolHandler(async ({ templateId, name, description, content, envContent }, client) => {
      const body: Record<string, unknown> = {};
      if (name) body.name = name;
      if (description) body.description = description;
      if (content) body.content = content;
      if (envContent) body.envContent = envContent;

      await client.put(`/templates/${templateId}`, body);
      return `Template ${templateId} updated.`;
    })
  );

  // arcane_template_delete
  register(
    "arcane_template_delete",
    {
      title: "Delete template",
      description: "Delete a Docker Compose template",
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      inputSchema: {
      templateId: z.string().describe("Template ID"),
    },
    },
    toolHandler(async ({ templateId }, client) => {
      await client.delete(`/templates/${templateId}`);
      return `Template ${templateId} deleted.`;
    })
  );

  // arcane_template_get_variables
  register(
    "arcane_template_get_variables",
    {
      title: "Get global variables",
      description: "List global variables (used for compose/template interpolation) with their environment scope. Secret values are redacted by Arcane.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
      environmentId: z.string().optional().describe("Only show variables that apply to this environment"),
    },
    },
    toolHandler(async ({ environmentId }, client) => {
      const response = await client.get<{ data: GlobalVariable[] | null }>("/variables");

      const variables = (response.data ?? []).filter(
        (v) => !environmentId || v.allEnvironments || (v.environmentIds ?? []).includes(environmentId)
      );
      if (variables.length === 0) {
        return "No global variables configured.";
      }

      const lines = ["Global Variables:\n"];
      for (const v of variables) {
        const scope = v.allEnvironments ? "all environments" : `environments: ${(v.environmentIds ?? []).join(", ")}`;
        lines.push(`  ${v.key}: ${v.isSecret ? "(secret)" : v.value}  [${scope}] (ID: ${v.id})`);
      }

      return lines.join("\n");
    })
  );

  // arcane_template_update_variables
  register(
    "arcane_template_update_variables",
    {
      title: "Update global variables",
      description: "Create or update global variables by key, and optionally remove keys. Variables are matched by key within the given scope (all environments unless environmentIds is set); Arcane syncs changes to affected environments.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
      variables: z.record(z.string()).optional().default({}).describe("Variables to create or update (key-value pairs)"),
      remove: z.array(z.string()).optional().describe("Keys to delete within the same scope"),
      environmentIds: z.array(z.string()).optional().describe("Scope to these environment IDs (omit for all environments)"),
      isSecret: z.boolean().optional().describe("Store values as secrets (encrypted, redacted when listed)"),
    },
    },
    toolHandler(async ({ variables, remove, environmentIds, isSecret }, client) => {
      const scope = [...new Set(environmentIds ?? [])].sort();
      const inScope = (v: GlobalVariable) =>
        scope.length === 0
          ? v.allEnvironments
          : !v.allEnvironments && [...(v.environmentIds ?? [])].sort().join(",") === scope.join(",");

      const existing = ((await client.get<{ data: GlobalVariable[] | null }>("/variables")).data ?? []).filter(inScope);
      const byKey = new Map(existing.map((v) => [v.key, v]));
      const results: string[] = [];
      const syncErrors = new Set<string>();
      const collect = (res: { data?: GlobalVariableMutation }) => {
        for (const s of res?.data?.syncResults ?? []) {
          if (s.error) syncErrors.add(`${s.environmentName || s.environmentId}: ${s.error}`);
        }
      };

      for (const [key, value] of Object.entries(variables ?? {})) {
        const current = byKey.get(key);
        if (current) {
          collect(await client.put<{ data: GlobalVariableMutation }>(`/variables/${current.id}`, { value, isSecret }));
          results.push(`updated ${key}`);
        } else {
          collect(
            await client.post<{ data: GlobalVariableMutation }>("/variables", {
              key,
              value,
              isSecret: isSecret ?? false,
              allEnvironments: scope.length === 0,
              environmentIds: scope,
            })
          );
          results.push(`created ${key}`);
        }
      }

      for (const key of remove ?? []) {
        const current = byKey.get(key);
        if (!current) {
          results.push(`skipped ${key} (not found in scope)`);
          continue;
        }
        collect(await client.delete<{ data: GlobalVariableMutation }>(`/variables/${current.id}`));
        results.push(`deleted ${key}`);
      }

      if (results.length === 0) {
        return "Nothing to do: pass variables to set and/or keys to remove.";
      }
      const lines = [`Global variables: ${results.join(", ")}.`];
      if (syncErrors.size > 0) {
        lines.push("", "Sync errors:", ...[...syncErrors].map((e) => `  ${e}`));
      }
      return lines.join("\n");
    })
  );

}
