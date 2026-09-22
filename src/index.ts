#!/usr/bin/env node
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as googleAds from "./google-ads/tools.js";
import * as metaAds from "./meta-ads/tools.js";

const server = new McpServer({ name: "ads-mcp", version: "0.1.0" });

// --- Google Ads -------------------------------------------------------
server.tool("google_ads_list_campaigns", "List campaigns with status and budget", googleAds.listCampaignsSchema, googleAds.listCampaigns);
server.tool("google_ads_get_campaign_structure", "Get a campaign's ad groups, keywords, ads, and negatives", googleAds.getCampaignStructureSchema, googleAds.getCampaignStructure);
server.tool("google_ads_create_search_campaign", "Create a new Search campaign with ad groups, keywords and RSAs. Always created PAUSED.", googleAds.createSearchCampaignSchema, googleAds.createSearchCampaign);
server.tool("google_ads_add_keywords", "Add keywords to an existing ad group", googleAds.addKeywordsSchema, googleAds.addKeywords);
server.tool("google_ads_set_keyword_status", "Pause or enable keywords (reversible)", googleAds.setKeywordStatusSchema, googleAds.setKeywordStatus);
server.tool("google_ads_remove_keywords", "Permanently remove keywords. Requires confirm_delete: true.", googleAds.removeKeywordsSchema, googleAds.removeKeywords);
server.tool("google_ads_update_bid_strategy", "Change a campaign's bidding strategy", googleAds.updateBidStrategySchema, googleAds.updateBidStrategy);
server.tool("google_ads_add_negative_keywords", "Add campaign-level negative keywords", googleAds.addNegativeKeywordsSchema, googleAds.addNegativeKeywords);
server.tool("google_ads_set_campaign_status", "Enable or pause a campaign. The only tool that can turn spend on.", googleAds.setCampaignStatusSchema, googleAds.setCampaignStatus);

// --- Meta Ads -----------------------------------------------------------
server.tool("meta_ads_list_campaigns", "List Meta campaigns with status and budget", metaAds.listCampaignsSchema, metaAds.listCampaigns);
server.tool("meta_ads_get_ad_status", "Get an ad's review status and rejection reason if any", metaAds.getAdStatusSchema, metaAds.getAdStatus);
server.tool("meta_ads_list_ads_by_status", "List ads in an account filtered by effective_status (e.g. DISAPPROVED)", metaAds.listAdsByStatusSchema, metaAds.listAdsByStatus);
server.tool("meta_ads_set_campaign_status", "Enable or pause a Meta campaign. The only tool that can turn spend on.", metaAds.setCampaignStatusSchema, metaAds.setCampaignStatus);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("ads-mcp running on stdio");
}

main().catch((err) => {
  console.error("Fatal error starting ads-mcp:", err);
  process.exit(1);
});
