#!/usr/bin/env node
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as googleAds from "./google-ads/tools.js";
import * as metaAds from "./meta-ads/tools.js";

const server = new McpServer({ name: "ads-mcp", version: "0.1.0" });

// --- Google Ads -------------------------------------------------------
server.registerTool(
  "google_ads_list_campaigns",
  {
    title: "List Google Ads campaigns",
    description: "List campaigns with status and budget",
    inputSchema: googleAds.listCampaignsSchema,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  },
  googleAds.listCampaigns,
);
server.registerTool(
  "google_ads_get_campaign_structure",
  {
    title: "Get Google Ads campaign structure",
    description: "Get a campaign's ad groups, keywords, ads, and negatives",
    inputSchema: googleAds.getCampaignStructureSchema,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  },
  googleAds.getCampaignStructure,
);
server.registerTool(
  "google_ads_create_search_campaign",
  {
    title: "Create Google Ads Search campaign (paused)",
    description: "Create a new Search campaign with ad groups, keywords and RSAs. Always created PAUSED.",
    inputSchema: googleAds.createSearchCampaignSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  googleAds.createSearchCampaign,
);
server.registerTool(
  "google_ads_add_keywords",
  {
    title: "Add keywords to a Google Ads ad group",
    description: "Add keywords to an existing ad group",
    inputSchema: googleAds.addKeywordsSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  googleAds.addKeywords,
);
server.registerTool(
  "google_ads_set_keyword_status",
  {
    title: "Pause or enable Google Ads keywords",
    description: "Pause or enable keywords (reversible)",
    inputSchema: googleAds.setKeywordStatusSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  googleAds.setKeywordStatus,
);
server.registerTool(
  "google_ads_remove_keywords",
  {
    title: "Permanently remove Google Ads keywords",
    description: "Permanently remove keywords. Requires confirm_delete: true.",
    inputSchema: googleAds.removeKeywordsSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
  googleAds.removeKeywords,
);
server.registerTool(
  "google_ads_update_bid_strategy",
  {
    title: "Update Google Ads bid strategy",
    description: "Change a campaign's bidding strategy",
    inputSchema: googleAds.updateBidStrategySchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  googleAds.updateBidStrategy,
);
server.registerTool(
  "google_ads_add_negative_keywords",
  {
    title: "Add Google Ads negative keywords",
    description: "Add campaign-level negative keywords",
    inputSchema: googleAds.addNegativeKeywordsSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  googleAds.addNegativeKeywords,
);
server.registerTool(
  "google_ads_set_campaign_status",
  {
    title: "Enable or pause a Google Ads campaign",
    description: "Enable or pause a campaign. The only tool that can turn spend on.",
    inputSchema: googleAds.setCampaignStatusSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  googleAds.setCampaignStatus,
);

// --- Meta Ads -----------------------------------------------------------
server.registerTool(
  "meta_ads_list_campaigns",
  {
    title: "List Meta Ads campaigns",
    description: "List Meta campaigns with status and budget",
    inputSchema: metaAds.listCampaignsSchema,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  },
  metaAds.listCampaigns,
);
server.registerTool(
  "meta_ads_get_ad_status",
  {
    title: "Get a Meta ad's review status",
    description: "Get an ad's review status and rejection reason if any",
    inputSchema: metaAds.getAdStatusSchema,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  },
  metaAds.getAdStatus,
);
server.registerTool(
  "meta_ads_list_ads_by_status",
  {
    title: "List Meta ads by review status",
    description: "List ads in an account filtered by effective_status (e.g. DISAPPROVED)",
    inputSchema: metaAds.listAdsByStatusSchema,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  },
  metaAds.listAdsByStatus,
);
server.registerTool(
  "meta_ads_set_campaign_status",
  {
    title: "Enable or pause a Meta Ads campaign",
    description: "Enable or pause a Meta campaign. The only tool that can turn spend on.",
    inputSchema: metaAds.setCampaignStatusSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  metaAds.setCampaignStatus,
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("ads-mcp running on stdio");
}

main().catch((err) => {
  console.error("Fatal error starting ads-mcp:", err);
  process.exit(1);
});
