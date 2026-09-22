import { enums, ResourceNames, toMicros } from "google-ads-api";
import { z } from "zod";
import { getCustomer } from "./client.js";

type ToolResult = { content: { type: "text"; text: string }[] };

const text = (value: unknown): ToolResult => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
});

const MatchType = z.enum(["EXACT", "PHRASE", "BROAD"]);

// ---------------------------------------------------------------------------
// list_campaigns
// ---------------------------------------------------------------------------
export const listCampaignsSchema = {
  customer_id: z.string().optional().describe("10-digit account ID, defaults to GOOGLE_ADS_CUSTOMER_ID"),
};

export async function listCampaigns(args: { customer_id?: string }) {
  const customer = getCustomer(args.customer_id);
  const rows = await customer.query(`
    SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
           campaign_budget.amount_micros, campaign.bidding_strategy_type
    FROM campaign
    WHERE campaign.status != 'REMOVED'
    ORDER BY campaign.id
  `);
  return text(
    rows.map((r) => ({
      id: r.campaign?.id,
      name: r.campaign?.name,
      status: r.campaign?.status,
      type: r.campaign?.advertising_channel_type,
      bidding_strategy: r.campaign?.bidding_strategy_type,
      daily_budget: r.campaign_budget?.amount_micros ? Number(r.campaign_budget.amount_micros) / 1_000_000 : null,
    })),
  );
}

// ---------------------------------------------------------------------------
// get_campaign_structure
// ---------------------------------------------------------------------------
export const getCampaignStructureSchema = {
  campaign_id: z.string().describe("Campaign ID"),
  customer_id: z.string().optional(),
};

export async function getCampaignStructure(args: { campaign_id: string; customer_id?: string }) {
  const customer = getCustomer(args.customer_id);

  const [campaignRows, adGroupRows, keywordRows, adRows, negativeRows] = await Promise.all([
    customer.query(`
      SELECT campaign.id, campaign.name, campaign.status, campaign.bidding_strategy_type,
             campaign.maximize_conversions.target_cpa_micros, campaign_budget.amount_micros
      FROM campaign WHERE campaign.id = ${args.campaign_id}
    `),
    customer.query(`
      SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.cpc_bid_micros
      FROM ad_group WHERE ad_group.campaign = 'customers/${customer.credentials.customer_id}/campaigns/${args.campaign_id}'
        AND ad_group.status != 'REMOVED'
    `),
    customer.query(`
      SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
             ad_group_criterion.status, ad_group_criterion.criterion_id, ad_group.id
      FROM ad_group_criterion
      WHERE campaign.id = ${args.campaign_id} AND ad_group_criterion.type = 'KEYWORD'
        AND ad_group_criterion.status != 'REMOVED'
    `),
    customer.query(`
      SELECT ad_group_ad.ad.id, ad_group_ad.ad.responsive_search_ad.headlines,
             ad_group_ad.ad.responsive_search_ad.descriptions, ad_group_ad.status, ad_group.id
      FROM ad_group_ad
      WHERE campaign.id = ${args.campaign_id} AND ad_group_ad.status != 'REMOVED'
    `),
    customer.query(`
      SELECT campaign_criterion.keyword.text, campaign_criterion.criterion_id
      FROM campaign_criterion
      WHERE campaign.id = ${args.campaign_id} AND campaign_criterion.type = 'KEYWORD'
        AND campaign_criterion.negative = true
    `),
  ]);

  return text({
    campaign: campaignRows[0]?.campaign,
    daily_budget: campaignRows[0]?.campaign_budget?.amount_micros
      ? Number(campaignRows[0].campaign_budget.amount_micros) / 1_000_000
      : null,
    ad_groups: adGroupRows.map((r) => ({
      id: r.ad_group?.id,
      name: r.ad_group?.name,
      status: r.ad_group?.status,
      keywords: keywordRows
        .filter((k) => k.ad_group?.id === r.ad_group?.id)
        .map((k) => ({
          text: k.ad_group_criterion?.keyword?.text,
          match_type: k.ad_group_criterion?.keyword?.match_type,
          status: k.ad_group_criterion?.status,
          id: k.ad_group_criterion?.criterion_id,
        })),
      ads: adRows
        .filter((a) => a.ad_group?.id === r.ad_group?.id)
        .map((a) => ({
          id: a.ad_group_ad?.ad?.id,
          headlines: a.ad_group_ad?.ad?.responsive_search_ad?.headlines?.map((h) => h.text ?? ""),
          descriptions: a.ad_group_ad?.ad?.responsive_search_ad?.descriptions?.map((d) => d.text ?? ""),
          status: a.ad_group_ad?.status,
        })),
    })),
    negative_keywords: negativeRows.map((n) => ({
      text: n.campaign_criterion?.keyword?.text,
      id: n.campaign_criterion?.criterion_id,
    })),
  });
}

// ---------------------------------------------------------------------------
// create_search_campaign — creates PAUSED. Never enables on its own.
// ---------------------------------------------------------------------------
const adGroupInput = z.object({
  name: z.string(),
  final_url: z.string().url(),
  keywords: z.array(z.object({ text: z.string(), match_type: MatchType })).min(1),
  headlines: z.array(z.string().max(30)).min(3).max(15),
  descriptions: z.array(z.string().max(90)).min(2).max(4),
});

export const createSearchCampaignSchema = {
  campaign_name: z.string(),
  daily_budget: z.number().positive().describe("In the account's native currency, e.g. 25 for $25/day"),
  locations: z.array(z.string()).describe("Google geo target constant resource names, e.g. 'geoTargetConstants/2826' for UK"),
  language: z.string().default("languageConstants/1000").describe("Google language constant resource name, default English"),
  ad_groups: z.array(adGroupInput).min(1),
  negative_keywords: z.array(z.string()).optional(),
  customer_id: z.string().optional(),
};

export async function createSearchCampaign(args: {
  campaign_name: string;
  daily_budget: number;
  locations: string[];
  language?: string;
  ad_groups: z.infer<typeof adGroupInput>[];
  negative_keywords?: string[];
  customer_id?: string;
}) {
  const customer = getCustomer(args.customer_id);
  const cid = customer.credentials.customer_id;

  // 1. Budget
  const budgetTemp = -1;
  const campaignTemp = -2;

  const budgetOp = {
    entity: "campaign_budget" as const,
    operation: "create" as const,
    resource: {
      resource_name: ResourceNames.campaignBudget(cid, budgetTemp),
      name: `${args.campaign_name} budget`,
      amount_micros: toMicros(args.daily_budget),
      delivery_method: enums.BudgetDeliveryMethod.STANDARD,
    },
  };

  const campaignOp = {
    entity: "campaign" as const,
    operation: "create" as const,
    resource: {
      resource_name: ResourceNames.campaign(cid, campaignTemp),
      name: args.campaign_name,
      status: enums.CampaignStatus.PAUSED,
      advertising_channel_type: enums.AdvertisingChannelType.SEARCH,
      campaign_budget: ResourceNames.campaignBudget(cid, budgetTemp),
      maximize_clicks: {},
      network_settings: {
        target_google_search: true,
        target_search_network: false,
        target_content_network: false,
        target_partner_search_network: false,
      },
    },
  };

  const geoOps = args.locations.map((geoResourceName) => ({
    entity: "campaign_criterion" as const,
    operation: "create" as const,
    resource: {
      campaign: ResourceNames.campaign(cid, campaignTemp),
      location: { geo_target_constant: geoResourceName },
    },
  }));

  const languageOp = {
    entity: "campaign_criterion" as const,
    operation: "create" as const,
    resource: {
      campaign: ResourceNames.campaign(cid, campaignTemp),
      language: { language_constant: args.language ?? "languageConstants/1000" },
    },
  };

  const negativeOps = (args.negative_keywords ?? []).map((kw) => ({
    entity: "campaign_criterion" as const,
    operation: "create" as const,
    resource: {
      campaign: ResourceNames.campaign(cid, campaignTemp),
      negative: true,
      keyword: { text: kw, match_type: enums.KeywordMatchType.BROAD },
    },
  }));

  let tempCounter = -3;
  const adGroupOps: unknown[] = [];
  const keywordOps: unknown[] = [];
  const adOps: unknown[] = [];

  for (const group of args.ad_groups) {
    const agTemp = tempCounter--;
    adGroupOps.push({
      entity: "ad_group",
      operation: "create",
      resource: {
        resource_name: ResourceNames.adGroup(cid, agTemp),
        name: group.name,
        campaign: ResourceNames.campaign(cid, campaignTemp),
        status: enums.AdGroupStatus.ENABLED,
        type: enums.AdGroupType.SEARCH_STANDARD,
      },
    });

    for (const kw of group.keywords) {
      keywordOps.push({
        entity: "ad_group_criterion",
        operation: "create",
        resource: {
          ad_group: ResourceNames.adGroup(cid, agTemp),
          status: enums.AdGroupCriterionStatus.ENABLED,
          keyword: { text: kw.text, match_type: enums.KeywordMatchType[kw.match_type] },
        },
      });
    }

    adOps.push({
      entity: "ad_group_ad",
      operation: "create",
      resource: {
        ad_group: ResourceNames.adGroup(cid, agTemp),
        status: enums.AdGroupAdStatus.ENABLED,
        ad: {
          final_urls: [group.final_url],
          responsive_search_ad: {
            headlines: group.headlines.map((h) => ({ text: h })),
            descriptions: group.descriptions.map((d) => ({ text: d })),
          },
        },
      },
    });
  }

  const result = await customer.mutateResources([
    budgetOp,
    campaignOp,
    ...geoOps,
    languageOp,
    ...negativeOps,
    ...adGroupOps,
    ...keywordOps,
    ...adOps,
  ] as never);

  return text({
    status: "created (PAUSED — will not spend until explicitly enabled)",
    campaign_resource_name: result.mutate_operation_responses?.find((r) => "campaign_result" in r)
      ? (result as unknown as Record<string, unknown>)
      : result,
  });
}

// ---------------------------------------------------------------------------
// add_keywords
// ---------------------------------------------------------------------------
export const addKeywordsSchema = {
  ad_group_id: z.string(),
  keywords: z.array(z.object({ text: z.string(), match_type: MatchType })).min(1),
  customer_id: z.string().optional(),
};

export async function addKeywords(args: {
  ad_group_id: string;
  keywords: { text: string; match_type: "EXACT" | "PHRASE" | "BROAD" }[];
  customer_id?: string;
}) {
  const customer = getCustomer(args.customer_id);
  const results = await customer.adGroupCriteria.create(
    args.keywords.map((kw) => ({
      ad_group: `customers/${customer.credentials.customer_id}/adGroups/${args.ad_group_id}`,
      status: enums.AdGroupCriterionStatus.ENABLED,
      keyword: { text: kw.text, match_type: enums.KeywordMatchType[kw.match_type] },
    })),
  );
  return text({ added: results.results?.length ?? 0, resource_names: results.results?.map((r) => r.resource_name) });
}

// ---------------------------------------------------------------------------
// pause / remove keywords — pause is the safe default; removal is permanent.
// ---------------------------------------------------------------------------
export const setKeywordStatusSchema = {
  ad_group_id: z.string(),
  criterion_ids: z.array(z.string()).min(1),
  status: z.enum(["ENABLED", "PAUSED"]),
  customer_id: z.string().optional(),
};

export async function setKeywordStatus(args: {
  ad_group_id: string;
  criterion_ids: string[];
  status: "ENABLED" | "PAUSED";
  customer_id?: string;
}) {
  const customer = getCustomer(args.customer_id);
  const results = await customer.adGroupCriteria.update(
    args.criterion_ids.map((id) => ({
      resource_name: `customers/${customer.credentials.customer_id}/adGroupCriteria/${args.ad_group_id}~${id}`,
      status: enums.AdGroupCriterionStatus[args.status],
    })),
  );
  return text({ updated: results.results?.length ?? 0 });
}

export const removeKeywordsSchema = {
  ad_group_id: z.string(),
  criterion_ids: z.array(z.string()).min(1),
  confirm_delete: z.literal(true).describe("Must be explicitly true — this is permanent."),
  customer_id: z.string().optional(),
};

export async function removeKeywords(args: {
  ad_group_id: string;
  criterion_ids: string[];
  confirm_delete: true;
  customer_id?: string;
}) {
  const customer = getCustomer(args.customer_id);
  const resourceNames = args.criterion_ids.map(
    (id) => `customers/${customer.credentials.customer_id}/adGroupCriteria/${args.ad_group_id}~${id}`,
  );
  await customer.adGroupCriteria.remove(resourceNames);
  return text({ removed: resourceNames.length, warning: "Permanent — cannot be undone." });
}

// ---------------------------------------------------------------------------
// update_bid_strategy
// ---------------------------------------------------------------------------
export const updateBidStrategySchema = {
  campaign_id: z.string(),
  strategy: z.enum(["MAXIMIZE_CLICKS", "MAXIMIZE_CONVERSIONS"]),
  cpc_bid_ceiling: z.number().positive().optional().describe("Only used with MAXIMIZE_CLICKS, account currency"),
  customer_id: z.string().optional(),
};

export async function updateBidStrategy(args: {
  campaign_id: string;
  strategy: "MAXIMIZE_CLICKS" | "MAXIMIZE_CONVERSIONS";
  cpc_bid_ceiling?: number;
  customer_id?: string;
}) {
  const customer = getCustomer(args.customer_id);
  const resource_name = `customers/${customer.credentials.customer_id}/campaigns/${args.campaign_id}`;

  const update =
    args.strategy === "MAXIMIZE_CLICKS"
      ? {
          resource_name,
          maximize_clicks: {
            cpc_bid_ceiling_micros: args.cpc_bid_ceiling ? toMicros(args.cpc_bid_ceiling) : undefined,
          },
        }
      : { resource_name, maximize_conversions: {} };

  await customer.campaigns.update([update]);
  return text({ campaign_id: args.campaign_id, strategy: args.strategy, cpc_bid_ceiling: args.cpc_bid_ceiling ?? null });
}

// ---------------------------------------------------------------------------
// add_negative_keywords (campaign level)
// ---------------------------------------------------------------------------
export const addNegativeKeywordsSchema = {
  campaign_id: z.string(),
  keywords: z.array(z.string()).min(1),
  customer_id: z.string().optional(),
};

export async function addNegativeKeywords(args: { campaign_id: string; keywords: string[]; customer_id?: string }) {
  const customer = getCustomer(args.customer_id);
  const results = await customer.campaignCriteria.create(
    args.keywords.map((kw) => ({
      campaign: `customers/${customer.credentials.customer_id}/campaigns/${args.campaign_id}`,
      negative: true,
      keyword: { text: kw, match_type: enums.KeywordMatchType.BROAD },
    })),
  );
  return text({ added: results.results?.length ?? 0 });
}

// ---------------------------------------------------------------------------
// set_campaign_status — the only tool allowed to enable a campaign.
// ---------------------------------------------------------------------------
export const setCampaignStatusSchema = {
  campaign_id: z.string(),
  status: z.enum(["ENABLED", "PAUSED"]),
  customer_id: z.string().optional(),
};

export async function setCampaignStatus(args: { campaign_id: string; status: "ENABLED" | "PAUSED"; customer_id?: string }) {
  const customer = getCustomer(args.customer_id);
  await customer.campaigns.update([
    {
      resource_name: `customers/${customer.credentials.customer_id}/campaigns/${args.campaign_id}`,
      status: enums.CampaignStatus[args.status],
    },
  ]);
  return text({ campaign_id: args.campaign_id, status: args.status });
}
