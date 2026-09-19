/**
 * Cloudflare MCP Client Module
 * Tools: cf-api, deploy_worker, list_workers, delete_worker, set_worker_secret, configure_route, tail_worker_logs
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Cloudflare, type common } from "cloudflare";

import { _account, _zone } from "./init";
import { ZodSchemas } from "./types";

/** Cloudflare API base URL */
const API_BASE = "https://api.cloudflare.com/client/v4";

/** Allowed HTTP methods for the generic tool */
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/**
 * Registers all Cloudflare tools on the given MCP server instance.
 * Every handler performs its own authentication using env vars or the system
 * keychain, so the returned object only needs to be passed to
 * `server.registerTool(...)`.
 */
export function _registerTools(server: McpServer) {
  _registerAccountTools(server);
  _registerApiTools(server);
  _registerDnsTools(server);
  _registerZoneTools(server);
  _registerWorkerTools(server);
  _registerKvTools(server);
  _registerR2Tools(server);
  _registerD1Tools(server);
  _registerBearerTokenTools(server);
  _registerProxyEndpoints(server);
}

export default _registerTools;
