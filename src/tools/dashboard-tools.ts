/**
 * Dashboard tools for Arcane MCP Server
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toolHandler } from "../utils/tool-helpers.js";
import { moduleRegistrar, type ToolRegistry } from "./registry.js";
import { formatSizeGB } from "../utils/format.js";
import type { DashboardCounts } from "../types/arcane-types.js";

export function registerDashboardTools(server: McpServer, registry?: ToolRegistry): void {
  const register = moduleRegistrar(server, registry, "dashboard");

  // arcane_dashboard_get
  register(
    "arcane_dashboard_get",
    {
      title: "Get dashboard snapshot",
      description: "Get a consolidated dashboard snapshot for an environment (containers, projects, images, volumes, networks, Arcane version)",
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
      // Arcane 3.0 dropped the single /dashboard endpoint; its own dashboard reads the
      // per-resource counts endpoints, so this does the same. One failing count doesn't
      // sink the rest of the snapshot.
      const base = `/agents/${environmentId}`;
      const [containers, projects, images, volumes, networks, version] = await Promise.allSettled([
        client.get<{ data: DashboardCounts["containers"] }>(`${base}/containers/counts`),
        client.get<{ data: DashboardCounts["projects"] }>(`${base}/projects/counts`),
        client.get<{ data: DashboardCounts["images"] }>(`${base}/images/counts`),
        client.get<{ data: DashboardCounts["volumes"] }>(`${base}/volumes/counts`),
        client.get<{ data: DashboardCounts["networks"] }>(`${base}/networks/counts`),
        client.get<DashboardCounts["version"]>("/app/version"),
      ]);
      const results = [containers, projects, images, volumes, networks, version];
      if (results.every((result) => result.status === "rejected")) {
        throw (results[0] as PromiseRejectedResult).reason;
      }
      const value = <T>(result: PromiseSettledResult<{ data?: T }>): T | undefined =>
        result.status === "fulfilled" ? result.value?.data : undefined;

      const lines = [`Dashboard Snapshot:`, ``];
      const unavailable: string[] = [];

      const c = value(containers);
      if (c) {
        const extra = [
          c.unhealthyContainers ? `${c.unhealthyContainers} unhealthy` : "",
          c.updatesAvailable ? `${c.updatesAvailable} with updates` : "",
        ].filter(Boolean);
        lines.push(
          `Containers: ${c.totalContainers} total (${c.runningContainers} running, ${c.stoppedContainers} stopped${extra.length ? `, ${extra.join(", ")}` : ""})`
        );
      } else unavailable.push("containers");

      const p = value(projects);
      if (p) {
        const updates = p.updatesAvailable ? `, ${p.updatesAvailable} with updates` : "";
        lines.push(`Projects: ${p.totalProjects} total (${p.runningProjects} running, ${p.stoppedProjects} stopped${updates})`);
      } else unavailable.push("projects");

      const img = value(images);
      if (img) {
        lines.push(`Images: ${img.totalImages} total (${img.imagesInuse} in use, ${img.imagesUnused} unused, ${formatSizeGB(img.totalImageSize)})`);
      } else unavailable.push("images");

      const vol = value(volumes);
      if (vol) lines.push(`Volumes: ${vol.total} total (${vol.inuse} in use, ${vol.unused} unused)`);
      else unavailable.push("volumes");

      const net = value(networks);
      if (net) lines.push(`Networks: ${net.total} total (${net.inuse} in use, ${net.unused} unused)`);
      else unavailable.push("networks");

      const v = version.status === "fulfilled" ? version.value : undefined;
      if (v?.currentVersion) {
        const update = v.updateAvailable && v.newestVersion ? ` (update available: ${v.newestVersion})` : "";
        lines.push("", `Arcane: ${v.currentVersion}${update}`);
      }

      if (unavailable.length > 0) {
        lines.push("", `Unavailable: ${unavailable.join(", ")}`);
      }

      return lines.join("\n");
    })
  );

}
