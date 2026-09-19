/**
 * Main MCP server for Cloudflare.
 *
 * Run with: npx tsx src/index.ts
 * Uses OAuth 2.0 with PKCE to authenticate with Cloudflare.
 */

import { config } from "dotenv";

config();

// We are in a Node.js environment
const BROWSER_ENV = false;

import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { Request, Response } from "express";

import {
  AccountID,
  APIToken,
  BearerToken,
  BotManagement,
  AI,
  AIKeys,
  AIConfig,
  Addressing,
  AlertEventNotificationWebhook,
  APIShieldSchema,
  APIGateway,
  APIGatewayRules,
  APIGatewayOperations,
  APIGatewayUser
  APITokenValue,
  AuthCode,
  ArgonTunnel,
  ArgonSmartRouting,
  AuditLogs,
  BlockchainGateway,
  BYOIP,
  CacheReserve,
  CallsApp,
  CallsTurn,
  CFD1,
  CFFile,
  CFHeader,
  CFImage,
  CFPage,
  CFPageRule,
  CFPageSetting,
  CFPageSettingValue,
  CFPool,
  CFRoute,
  CFRuleset,
  CFScript,
  CFScriptContent,
  CFScriptRoute,
  CFScriptSetting,
  CFScriptSettingValue,
  CFVariable,
  CFVariableContent,
  CFWorkerDomain,
  CertificateAuthority,
  CloudController,
  CloudflarePages,
  Configuration,
  ConnectionPooling,
  CustomPage,
  CustomPages,
  DDoSBGP,
  DDoSHTTP,
  DDoSL7,
  DNSAnalyzer,
  DNSFirewall,
  DNSRecord,
  DNSTransfer,
  EmailRouting,
  EmailRoutingAddress,
  EmailRoutingRule,
  EmailRoutingDNS,
  EventNotification,
  FileStorage,
  FirewallRule,
  GraphQLAnalytics,
  Hostname,
  HttpFilter,
  ImageResizing,
  IPAccessRule,
  IPRange,
  IPsecTunnel,
  IPS,
  IPv4Address,
  IPv6Address,
  KnownAttackers,
  LoadBalancer,
  LoadBalancerPool,
  LoadBalancerPreview,
  LoadBalancerStatus,
  LogJob,
  LogPush,
  LogRetentionPolicy,
  Membership,
  Metadata,
  Origin CA Certificates,
  Page,
  PageShield,
  PageRules,
  PagesProject,
  PaginationOptions,
  Ruleset,
  RulesetPhase,
  Rulesets,
  RulesetRules,
  Secondary DNS,
  Secondary DNS ACL,
  Secondary DNS TSIG,
  SecurityTXT,
  SpectrumApp,
  Speed,
  SSL,
  SSLRecommendation,
  Stream,
  StreamDownload,
  StreamWatermark,
  StreamKey,
  StreamLiveInput,
  StreamToken,
  StreamThumbnail,
  StreamCaptions,
  StreamRecording,
  Tenant,
  TieredCache,
  TLSAdvisor,
  Trace,
  UniversalSSL,
  URLNormalization,
  UserAgentBlockingRule,
  VideoPipeline,
  WaitingRoom,
  WaitingRoomEvent,
  Web3Hostname,
  WorkersRoute,
  WorkersScript,
  WorkersKV,
  WorkersKVNamespace,
  WAFOverride,
  WAFPackages,
  WAFRules,
  Web3,
  Zone,
  ZoneLockdown,
  ZoneSettings,
} from "cloudflare-api";
import { NotFoundError } from "@cloudflare/util-http";
import { Client } from "@cloudflare/cf-api-client";
import { Environment } from "@cloudflare/util-environments";
import { LocalState } from "@cloudflare/state-machine";
import { error, info } from "@cloudflare/util-logger";

// Types
import type { CloudflareEnv } from "@cloudflare/types";
import type { RemoteCollection } from "@cloudflare/cf-ui/collections/remote";

// Actions
import * as actions from "./actions";

// Utils
import { getStore, getSweep } from "@cloudflare/cf-ui/stores";
import {
  httpLoaded,
  httpFailed,
  notifyError,
} from "@cloudflare/cf-ui/utils/http";

// Selectors
import {
  getActiveZone,
  getActiveZoneID,
  getIsInitialized,
  getIsZoneCreationAllowed,
} from "@cloudflare/cf-ui/selectors";

// Constants
import {
  ACCOUNT_HOME,
  ACCOUNT_LIMITS,
  BILLING_PROFILE_PAGE,
  CHANGE_PASSWORD,
  DASHBOARD_ROOT,
  LOG_IN_PAGE,
  NOTIFICATIONS_PAGE,
  SWITCH_PAGE,
} from "@cloudflare/cf-ui/constants";

// Get the Cloudflare API token from the environment
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const apiUrl = process.env.CLOUDFLARE_API_URL || "https://api.cloudflare.com/client/v4";

// Create the API client
const client = new Client({
  token: apiToken,
  baseUrl: apiUrl,
});

// Export the client
export default client;
