#!/usr/bin/env node
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as googleAds from "./google-ads/tools.js";
import * as metaAds from "./meta-ads/tools.js";

const VERSION = "0.2.0";

const server = new McpServer({ name: "ads-mcp", version: VERSION });

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
    description: "Enable or pause a campaign. The only Google tool that can turn spend on.",
    inputSchema: googleAds.setCampaignStatusSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  googleAds.setCampaignStatus,
);

const readOnly = { readOnlyHint: true, idempotentHint: true, openWorldHint: true } as const;
const writeNew = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const;
const writeIdem = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

// --- Meta Ads: auth / read --------------------------------------------
server.registerTool(
  "meta_ads_get_account",
  {
    title: "Get Meta ad account and token status",
    description:
      "Read the default (or given) ad account and, when META_APP_ID/SECRET are set, debug the System User token (scopes, expiry). Use this first to confirm auth.",
    inputSchema: metaAds.getAccountSchema,
    annotations: readOnly,
  },
  metaAds.getAccount,
);
server.registerTool(
  "meta_ads_list_campaigns",
  {
    title: "List Meta Ads campaigns",
    description: "List Meta campaigns with status, effective_status, objective, budget and issues_info",
    inputSchema: metaAds.listCampaignsSchema,
    annotations: readOnly,
  },
  metaAds.listCampaigns,
);
server.registerTool(
  "meta_ads_get_campaign",
  {
    title: "Get a Meta campaign",
    description: "Get one campaign's status, budget, objective and issues_info",
    inputSchema: metaAds.getCampaignSchema,
    annotations: readOnly,
  },
  metaAds.getCampaign,
);
server.registerTool(
  "meta_ads_get_campaign_structure",
  {
    title: "Get Meta campaign structure",
    description: "Get a campaign plus its ad sets (targeting, budgets) and ads (creative + review feedback)",
    inputSchema: metaAds.getCampaignStructureSchema,
    annotations: readOnly,
  },
  metaAds.getCampaignStructure,
);
server.registerTool(
  "meta_ads_list_ad_sets",
  {
    title: "List Meta ad sets",
    description: "List ad sets for an account or campaign, including targeting and Advantage+ audience flag",
    inputSchema: metaAds.listAdSetsSchema,
    annotations: readOnly,
  },
  metaAds.listAdSets,
);
server.registerTool(
  "meta_ads_get_ad_set",
  {
    title: "Get a Meta ad set",
    description: "Get one ad set: targeting, promoted_object, budgets, optimization, review issues",
    inputSchema: metaAds.getAdSetSchema,
    annotations: readOnly,
  },
  metaAds.getAdSet,
);
server.registerTool(
  "meta_ads_list_ads",
  {
    title: "List Meta ads",
    description: "List ads for an account, campaign, or ad set, including creative and review feedback",
    inputSchema: metaAds.listAdsSchema,
    annotations: readOnly,
  },
  metaAds.listAds,
);
server.registerTool(
  "meta_ads_get_ad",
  {
    title: "Get a Meta ad",
    description: "Get one ad with creative details, status, issues_info and ad_review_feedback",
    inputSchema: metaAds.getAdSchema,
    annotations: readOnly,
  },
  metaAds.getAd,
);
server.registerTool(
  "meta_ads_get_ad_status",
  {
    title: "Get a Meta ad's review status",
    description: "Get an ad's review status and rejection reason if any (issues_info / ad_review_feedback)",
    inputSchema: metaAds.getAdStatusSchema,
    annotations: readOnly,
  },
  metaAds.getAdStatus,
);
server.registerTool(
  "meta_ads_list_ads_by_status",
  {
    title: "List Meta ads by review status",
    description: "List ads in an account filtered by effective_status (e.g. DISAPPROVED)",
    inputSchema: metaAds.listAdsByStatusSchema,
    annotations: readOnly,
  },
  metaAds.listAdsByStatus,
);
server.registerTool(
  "meta_ads_get_insights",
  {
    title: "Get Meta Ads insights",
    description:
      "Account, campaign, ad set or ad insights: spend, impressions, reach, clicks, CTR, CPC, CPM, actions and cost per action. Date presets or since/until. Optional breakdowns: age, gender, placement, day.",
    inputSchema: metaAds.getInsightsSchema,
    annotations: readOnly,
  },
  metaAds.getInsights,
);

// --- Meta Ads: targeting helpers --------------------------------------
server.registerTool(
  "meta_ads_search_targeting",
  {
    title: "Search Meta targeting",
    description: "Search interests, behaviours, or geo locations by keyword. Use the returned ids in meta_ads_create_ad_set.",
    inputSchema: metaAds.searchTargetingSchema,
    annotations: readOnly,
  },
  metaAds.searchTargeting,
);
server.registerTool(
  "meta_ads_estimate_audience",
  {
    title: "Estimate Meta audience size",
    description: "Delivery / reach estimate for a targeting spec (manual interests, Advantage+ off by default)",
    inputSchema: metaAds.estimateAudienceSchema,
    annotations: readOnly,
  },
  metaAds.estimateAudience,
);

// --- Meta Ads: create / update (always PAUSED) ------------------------
server.registerTool(
  "meta_ads_create_campaign",
  {
    title: "Create a Meta campaign (paused)",
    description:
      "Create a campaign (objective, special_ad_categories, optional campaign budget). Always created PAUSED. Does not start spend.",
    inputSchema: metaAds.createCampaignSchema,
    annotations: writeNew,
  },
  metaAds.createCampaign,
);
server.registerTool(
  "meta_ads_update_campaign",
  {
    title: "Update a Meta campaign",
    description: "Update name, budget or special_ad_categories. Does not change status.",
    inputSchema: metaAds.updateCampaignSchema,
    annotations: writeIdem,
  },
  metaAds.updateCampaign,
);
server.registerTool(
  "meta_ads_create_ad_set",
  {
    title: "Create a Meta ad set (paused)",
    description:
      "Create a paused ad set with daily budget, optimization, pixel+event, and manual targeting (geo, age, flexible_spec interests/behaviours, exclusions). Advantage+ audience is OFF unless advantage_audience is true.",
    inputSchema: metaAds.createAdSetSchema,
    annotations: writeNew,
  },
  metaAds.createAdSet,
);
server.registerTool(
  "meta_ads_update_ad_set",
  {
    title: "Update a Meta ad set",
    description: "Update targeting, budget or optimization. Does not change status.",
    inputSchema: metaAds.updateAdSetSchema,
    annotations: writeIdem,
  },
  metaAds.updateAdSet,
);
server.registerTool(
  "meta_ads_upload_image",
  {
    title: "Upload a Meta ad image",
    description: "Upload an image from a public URL or local path to the ad account image library. Returns the image hash.",
    inputSchema: metaAds.uploadImageSchema,
    annotations: writeNew,
  },
  metaAds.uploadImage,
);
server.registerTool(
  "meta_ads_create_ad_creative",
  {
    title: "Create a Meta ad creative",
    description:
      "Create a link creative (Page, image hash, primary text, headline, description, CTA, url_tags for UTMs). Does not create or activate an ad.",
    inputSchema: metaAds.createAdCreativeSchema,
    annotations: writeNew,
  },
  metaAds.createAdCreative,
);
server.registerTool(
  "meta_ads_create_ad",
  {
    title: "Create a Meta ad (paused)",
    description: "Create a paused ad under an ad set with an existing creative. Does not start spend.",
    inputSchema: metaAds.createAdSchema,
    annotations: writeNew,
  },
  metaAds.createAd,
);
server.registerTool(
  "meta_ads_update_ad",
  {
    title: "Update a Meta ad or its copy",
    description:
      "Rename an ad, attach a creative_id, or change copy (creates a replacement creative). Does not change status.",
    inputSchema: metaAds.updateAdSchema,
    annotations: writeIdem,
  },
  metaAds.updateAd,
);

// --- Meta Ads: explicit spend switches --------------------------------
server.registerTool(
  "meta_ads_set_campaign_status",
  {
    title: "Activate or pause a Meta campaign",
    description:
      "Set a campaign to ACTIVE or PAUSED. ACTIVE is the spend switch for the campaign (ad sets and ads must also be ACTIVE). Create/copy tools never activate.",
    inputSchema: metaAds.setCampaignStatusSchema,
    annotations: writeIdem,
  },
  metaAds.setCampaignStatus,
);
server.registerTool(
  "meta_ads_set_ad_set_status",
  {
    title: "Activate or pause a Meta ad set",
    description:
      "Set an ad set to ACTIVE or PAUSED. ACTIVE can start spend if the parent campaign and child ads are ACTIVE. Create/copy tools never activate.",
    inputSchema: metaAds.setAdSetStatusSchema,
    annotations: writeIdem,
  },
  metaAds.setAdSetStatus,
);
server.registerTool(
  "meta_ads_set_ad_status",
  {
    title: "Activate or pause a Meta ad",
    description:
      "Set an ad to ACTIVE or PAUSED. ACTIVE can start spend if the campaign and ad set are ACTIVE and the ad passes review. Create/copy tools never activate.",
    inputSchema: metaAds.setAdStatusSchema,
    annotations: writeIdem,
  },
  metaAds.setAdStatus,
);

// --- Meta Ads: copies (always PAUSED) ---------------------------------
server.registerTool(
  "meta_ads_copy_campaign",
  {
    title: "Copy a Meta campaign (paused)",
    description: "Duplicate a campaign (optional deep copy of ad sets/ads). Copy is always PAUSED.",
    inputSchema: metaAds.copyCampaignSchema,
    annotations: writeNew,
  },
  metaAds.copyCampaign,
);
server.registerTool(
  "meta_ads_copy_ad_set",
  {
    title: "Copy a Meta ad set (paused)",
    description: "Duplicate an ad set (optional deep copy of ads). Copy is always PAUSED.",
    inputSchema: metaAds.copyAdSetSchema,
    annotations: writeNew,
  },
  metaAds.copyAdSet,
);
server.registerTool(
  "meta_ads_copy_ad",
  {
    title: "Copy a Meta ad (paused)",
    description: "Duplicate an ad, optionally into another ad set. Copy is always PAUSED.",
    inputSchema: metaAds.copyAdSchema,
    annotations: writeNew,
  },
  metaAds.copyAd,
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
