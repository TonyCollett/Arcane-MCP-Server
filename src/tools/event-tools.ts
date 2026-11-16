/**
 * Event tracking tools for Arcane MCP Server
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toolHandler } from "../utils/tool-helpers.js";
import { moduleRegistrar, type ToolRegistry } from "./registry.js";
import { MAX_DISPLAY_EVENTS } from "../constants.js";
import type { Event } from "../types/arcane-types.js";

/**
 * Arcane 3.0 skips the total count on event listings and reports -1, giving only
 * hasNextPage. Fall back to the page size rather than printing "Found -1 events".
 */
function eventCountHeading(shown: number, pagination?: { totalItems?: number; hasNextPage?: boolean }): string {
  const total = pagination?.totalItems;
  if (typeof total === "number" && total >= 0) return `Found ${total} events:\n`;
  const more = pagination?.hasNextPage ? " (more available: page with start/limit)" : "";
  return `Showing ${shown} events${more}:\n`;
}

export function registerEventTools(server: McpServer, registry?: ToolRegistry): void {
  const register = moduleRegistrar(server, registry, "event");

  // arcane_event_list
  register(
    "arcane_event_list",
    {
      title: "List events",
      description: "List events across all environments",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
      type: z.string().optional().describe("Filter by event type"),
      severity: z.string().optional().describe("Filter by severity (e.g., info, warning, error)"),
      start: z.number().optional().default(0).describe("Pagination start"),
      limit: z.number().optional().default(50).describe("Items per page"),
    },
    },
    toolHandler(async ({ type, severity, start, limit }, client) => {
      const response = await client.get<{
        data: Event[];
        pagination?: { totalItems?: number; hasNextPage?: boolean };
      }>("/events", { type, severity, start, limit });

      if (!response.data || response.data.length === 0) {
        return "No events found.";
      }

      const lines = [eventCountHeading(response.data.length, response.pagination)];
      for (const event of response.data.slice(0, MAX_DISPLAY_EVENTS)) {
        const time = new Date(event.createdAt).toLocaleString();
        lines.push(`[${time}] [${event.severity.toUpperCase()}] ${event.type}`);
        lines.push(`    ${event.title}${event.description ? ` — ${event.description}` : ""}`);
        if (event.resourceName) {
          lines.push(`    Resource: ${event.resourceType}/${event.resourceName}`);
        }
        if (event.username) {
          lines.push(`    User: ${event.username}`);
        }
        lines.push("");
      }

      if (response.data.length > MAX_DISPLAY_EVENTS) {
        lines.push(`... and ${response.data.length - MAX_DISPLAY_EVENTS} more events`);
      }

      return lines.join("\n");
    })
  );

  // arcane_event_list_by_environment
  register(
    "arcane_event_list_by_environment",
    {
      title: "List environment events",
      description: "List events for a specific environment",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
      environmentId: z.string().describe("Environment ID"),
      type: z.string().optional().describe("Filter by event type"),
      start: z.number().optional().default(0).describe("Pagination start"),
      limit: z.number().optional().default(50).describe("Items per page"),
    },
    },
    toolHandler(async ({ environmentId, type, start, limit }, client) => {
      const response = await client.get<{
        data: Event[];
        pagination?: { totalItems?: number; hasNextPage?: boolean };
      }>(`/events/agent/${environmentId}`, { type, start, limit });

      if (!response.data || response.data.length === 0) {
        return "No events found for this environment.";
      }

      const lines = [eventCountHeading(response.data.length, response.pagination)];
      for (const event of response.data.slice(0, MAX_DISPLAY_EVENTS)) {
        const time = new Date(event.createdAt).toLocaleString();
        lines.push(`[${time}] [${event.severity.toUpperCase()}] ${event.type}`);
        lines.push(`    ${event.title}${event.description ? ` — ${event.description}` : ""}`);
        if (event.resourceName) {
          lines.push(`    Resource: ${event.resourceType}/${event.resourceName}`);
        }
        lines.push("");
      }

      return lines.join("\n");
    })
  );

  // arcane_event_delete
  register(
    "arcane_event_delete",
    {
      title: "Delete event",
      description: "Delete an event from the history",
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      inputSchema: {
      eventId: z.string().describe("Event ID to delete"),
    },
    },
    toolHandler(async ({ eventId }, client) => {
      await client.delete(`/events/${eventId}`);
      return `Event ${eventId} deleted.`;
    })
  );

}
