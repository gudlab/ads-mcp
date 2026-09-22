import bizSdk from "facebook-nodejs-business-sdk";
import { z } from "zod";
import { getAdAccount } from "./client.js";

const { Campaign, Ad } = bizSdk;

type ToolResult = { content: { type: "text"; text: string }[] };

const text = (value: unknown): ToolResult => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
});

// ---------------------------------------------------------------------------
// list_campaigns
// ---------------------------------------------------------------------------
export const listCampaignsSchema = {
  account_id: z.string().optional().describe("Numeric ad account ID, no 'act_' prefix. Defaults to META_AD_ACCOUNT_ID"),
};

export async function listCampaigns(args: { account_id?: string }) {
  const account = getAdAccount(args.account_id);
  const campaigns = await account.getCampaigns(
    [Campaign.Fields.id, Campaign.Fields.name, Campaign.Fields.status, Campaign.Fields.effective_status, Campaign.Fields.daily_budget],
    { limit: 100 },
  );
  return text(
    campaigns.map((c: Record<string, unknown>) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      effective_status: c.effective_status,
      daily_budget: c.daily_budget ? Number(c.daily_budget) / 100 : null,
    })),
  );
}

// ---------------------------------------------------------------------------
// get_ad_status — pulls the actual rejection reason for one ad.
// ---------------------------------------------------------------------------
export const getAdStatusSchema = {
  ad_id: z.string(),
};

export async function getAdStatus(args: { ad_id: string }) {
  const ad = new Ad(args.ad_id);
  const fields = await ad.get([
    Ad.Fields.id,
    Ad.Fields.name,
    Ad.Fields.status,
    Ad.Fields.effective_status,
    Ad.Fields.issues_info,
    "ad_review_feedback",
  ]);
  return text(fields);
}

// ---------------------------------------------------------------------------
// list_ads_by_status — e.g. pull every DISAPPROVED ad in one call.
// ---------------------------------------------------------------------------
export const listAdsByStatusSchema = {
  account_id: z.string().optional(),
  effective_status: z
    .array(z.enum(["ACTIVE", "PAUSED", "DISAPPROVED", "PENDING_REVIEW", "WITH_ISSUES", "IN_PROCESS"]))
    .default(["DISAPPROVED"]),
};

export async function listAdsByStatus(args: { account_id?: string; effective_status?: string[] }) {
  const account = getAdAccount(args.account_id);
  const ads = await account.getAds(
    [Ad.Fields.id, Ad.Fields.name, Ad.Fields.effective_status, Ad.Fields.issues_info, "ad_review_feedback"],
    { effective_status: JSON.stringify(args.effective_status ?? ["DISAPPROVED"]), limit: 200 },
  );
  return text(
    ads.map((a: Record<string, unknown>) => ({
      id: a.id,
      name: a.name,
      effective_status: a.effective_status,
      issues_info: a.issues_info,
      ad_review_feedback: a.ad_review_feedback,
    })),
  );
}

// ---------------------------------------------------------------------------
// set_campaign_status — the only tool allowed to enable a campaign.
// ---------------------------------------------------------------------------
export const setCampaignStatusSchema = {
  campaign_id: z.string(),
  status: z.enum(["ACTIVE", "PAUSED"]),
};

export async function setCampaignStatus(args: { campaign_id: string; status: "ACTIVE" | "PAUSED" }) {
  const campaign = new Campaign(args.campaign_id);
  await campaign.update([], { status: args.status });
  return text({ campaign_id: args.campaign_id, status: args.status });
}
