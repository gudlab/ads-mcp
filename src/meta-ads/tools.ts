import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { z } from "zod";
import {
  accountPath,
  fromMinorUnits,
  getAccessToken,
  getAdAccountId,
  graphApiVersion,
  graphGetAll,
  graphRequest,
  toMinorUnits,
} from "./client.js";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const text = (value: unknown): ToolResult => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
});

const CREATED_PAUSED =
  "created (PAUSED - will not spend until you call the matching meta_ads_set_*_status tool with ACTIVE)";

const CampaignObjective = z.enum([
  "OUTCOME_AWARENESS",
  "OUTCOME_ENGAGEMENT",
  "OUTCOME_TRAFFIC",
  "OUTCOME_LEADS",
  "OUTCOME_APP_PROMOTION",
  "OUTCOME_SALES",
]);

const SpecialAdCategory = z.enum([
  "NONE",
  "EMPLOYMENT",
  "HOUSING",
  "CREDIT",
  "ISSUES_ELECTIONS_POLITICS",
  "FINANCIAL_PRODUCTS_SERVICES",
]);

const OptimizationGoal = z.enum([
  "OFFSITE_CONVERSIONS",
  "LANDING_PAGE_VIEWS",
  "LINK_CLICKS",
  "REACH",
  "IMPRESSIONS",
  "LEAD_GENERATION",
  "VALUE",
  "CONVERSATIONS",
  "THRUPLAY",
  "APP_INSTALLS",
  "PAGE_LIKES",
  "POST_ENGAGEMENT",
]);

const BillingEvent = z.enum(["IMPRESSIONS", "LINK_CLICKS", "THRUPLAY"]);

const PixelEvent = z.enum([
  "COMPLETE_REGISTRATION",
  "LEAD",
  "PURCHASE",
  "ADD_TO_CART",
  "CONTENT_VIEW",
  "INITIATED_CHECKOUT",
  "SEARCH",
  "CONTACT",
  "SUBSCRIBE",
  "START_TRIAL",
  "SCHEDULE",
  "SUBMIT_APPLICATION",
  "DONATE",
  "FIND_LOCATION",
  "ADD_PAYMENT_INFO",
  "ADD_TO_WISHLIST",
  "CUSTOMIZE_PRODUCT",
  "OTHER",
]);

const CtaType = z.enum([
  "LEARN_MORE",
  "SHOP_NOW",
  "SIGN_UP",
  "SUBSCRIBE",
  "DOWNLOAD",
  "BOOK_TRAVEL",
  "CONTACT_US",
  "GET_OFFER",
  "APPLY_NOW",
  "GET_QUOTE",
  "GET_STARTED",
  "BUY_NOW",
  "DONATE_NOW",
  "WATCH_MORE",
  "SEND_MESSAGE",
]);

const DatePreset = z.enum([
  "today",
  "yesterday",
  "last_7d",
  "last_14d",
  "last_28d",
  "last_30d",
  "this_month",
  "last_month",
  "this_quarter",
  "last_quarter",
  "this_year",
  "last_year",
  "maximum",
]);

const InsightsLevel = z.enum(["account", "campaign", "adset", "ad"]);

const Breakdown = z.enum(["age", "gender", "country", "placement", "day", "publisher_platform", "impression_device"]);

const TargetingId = z.object({
  id: z.string(),
  name: z.string().optional(),
});

const targetingInput = z.object({
  countries: z.array(z.string()).optional().describe("ISO country codes, e.g. GB"),
  regions: z.array(z.object({ key: z.string() })).optional(),
  cities: z
    .array(
      z.object({
        key: z.string(),
        radius: z.number().optional(),
        distance_unit: z.enum(["mile", "kilometer"]).optional(),
      }),
    )
    .optional(),
  age_min: z.number().int().min(18).max(65).optional(),
  age_max: z.number().int().min(18).max(65).optional(),
  genders: z.array(z.number().int()).optional().describe("1 = male, 2 = female. Omit for all."),
  interests: z.array(TargetingId).optional(),
  behaviors: z.array(TargetingId).optional(),
  excluded_interests: z.array(TargetingId).optional(),
  excluded_behaviors: z.array(TargetingId).optional(),
  locales: z.array(z.number()).optional(),
  publisher_platforms: z.array(z.string()).optional(),
  facebook_positions: z.array(z.string()).optional(),
  instagram_positions: z.array(z.string()).optional(),
  device_platforms: z.array(z.enum(["mobile", "desktop"])).optional(),
});

type TargetingInput = z.infer<typeof targetingInput>;

export function buildTargeting(
  input: TargetingInput | undefined,
  advantageAudience: boolean,
  raw?: Record<string, unknown>,
): Record<string, unknown> {
  if (raw && Object.keys(raw).length > 0) {
    const targeting = { ...raw };
    const existingAuto = isRecord(targeting.targeting_automation) ? targeting.targeting_automation : {};
    targeting.targeting_automation = { ...existingAuto, advantage_audience: advantageAudience ? 1 : 0 };
    return targeting;
  }

  const geo: Record<string, unknown> = {};
  if (input?.countries?.length) geo.countries = input.countries;
  if (input?.regions?.length) geo.regions = input.regions;
  if (input?.cities?.length) geo.cities = input.cities;

  const flexible: Record<string, unknown> = {};
  if (input?.interests?.length) flexible.interests = input.interests;
  if (input?.behaviors?.length) flexible.behaviors = input.behaviors;

  const exclusions: Record<string, unknown> = {};
  if (input?.excluded_interests?.length) exclusions.interests = input.excluded_interests;
  if (input?.excluded_behaviors?.length) exclusions.behaviors = input.excluded_behaviors;

  const targeting: Record<string, unknown> = {
    targeting_automation: { advantage_audience: advantageAudience ? 1 : 0 },
  };
  if (Object.keys(geo).length) targeting.geo_locations = geo;
  if (input?.age_min != null) targeting.age_min = input.age_min;
  if (input?.age_max != null) targeting.age_max = input.age_max;
  if (input?.genders?.length) targeting.genders = input.genders;
  if (Object.keys(flexible).length) targeting.flexible_spec = [flexible];
  if (Object.keys(exclusions).length) targeting.exclusions = exclusions;
  if (input?.locales?.length) targeting.locales = input.locales;
  if (input?.publisher_platforms?.length) targeting.publisher_platforms = input.publisher_platforms;
  if (input?.facebook_positions?.length) targeting.facebook_positions = input.facebook_positions;
  if (input?.instagram_positions?.length) targeting.instagram_positions = input.instagram_positions;
  if (input?.device_platforms?.length) targeting.device_platforms = input.device_platforms;
  return targeting;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compactBudget(row: Record<string, unknown>) {
  return {
    daily_budget: fromMinorUnits(row.daily_budget),
    lifetime_budget: fromMinorUnits(row.lifetime_budget),
  };
}

const CAMPAIGN_FIELDS = [
  "id",
  "name",
  "status",
  "effective_status",
  "objective",
  "special_ad_categories",
  "daily_budget",
  "lifetime_budget",
  "bid_strategy",
  "buying_type",
  "created_time",
  "updated_time",
  "issues_info",
].join(",");

const ADSET_FIELDS = [
  "id",
  "name",
  "status",
  "effective_status",
  "campaign_id",
  "daily_budget",
  "lifetime_budget",
  "optimization_goal",
  "billing_event",
  "bid_strategy",
  "targeting",
  "promoted_object",
  "destination_type",
  "start_time",
  "end_time",
  "issues_info",
].join(",");

const AD_FIELDS = [
  "id",
  "name",
  "status",
  "effective_status",
  "adset_id",
  "campaign_id",
  "creative{id,name,title,body,image_hash,thumbnail_url,url_tags,call_to_action_type,object_story_spec}",
  "issues_info",
  "ad_review_feedback",
].join(",");

function mapCampaign(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    effective_status: row.effective_status,
    objective: row.objective,
    special_ad_categories: row.special_ad_categories ?? [],
    ...compactBudget(row),
    bid_strategy: row.bid_strategy ?? null,
    buying_type: row.buying_type ?? null,
    issues_info: row.issues_info ?? null,
    created_time: row.created_time ?? null,
    updated_time: row.updated_time ?? null,
  };
}

function mapAdSet(row: Record<string, unknown>) {
  const targeting = isRecord(row.targeting) ? row.targeting : {};
  const automation = isRecord(targeting.targeting_automation) ? targeting.targeting_automation : {};
  return {
    id: row.id,
    name: row.name,
    campaign_id: row.campaign_id,
    status: row.status,
    effective_status: row.effective_status,
    ...compactBudget(row),
    optimization_goal: row.optimization_goal ?? null,
    billing_event: row.billing_event ?? null,
    bid_strategy: row.bid_strategy ?? null,
    destination_type: row.destination_type ?? null,
    promoted_object: row.promoted_object ?? null,
    advantage_audience: automation.advantage_audience ?? null,
    targeting,
    issues_info: row.issues_info ?? null,
    start_time: row.start_time ?? null,
    end_time: row.end_time ?? null,
  };
}

function mapAd(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    campaign_id: row.campaign_id,
    adset_id: row.adset_id,
    status: row.status,
    effective_status: row.effective_status,
    creative: row.creative ?? null,
    issues_info: row.issues_info ?? null,
    ad_review_feedback: row.ad_review_feedback ?? null,
  };
}

function flattenActions(list: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!Array.isArray(list)) return out;
  for (const item of list) {
    if (!isRecord(item) || item.action_type == null) continue;
    const key = String(item.action_type);
    const n = Number(item.value);
    if (!Number.isFinite(n)) continue;
    out[key] = n;
    const short = key.includes(".") ? key.slice(key.lastIndexOf(".") + 1) : key;
    if (short !== key && out[short] == null) out[short] = n;
    const pixel = short.replace(/^fb_pixel_/, "").replace(/^fb_mobile_/, "");
    if (pixel !== short && out[pixel] == null) out[pixel] = n;
  }
  return out;
}

export function compactInsightsRow(row: Record<string, unknown>) {
  const actions = flattenActions(row.actions);
  const costPerAction = flattenActions(row.cost_per_action_type);
  const compact: Record<string, unknown> = {
    object_id: row.campaign_id ?? row.adset_id ?? row.ad_id ?? row.account_id ?? null,
    campaign_id: row.campaign_id ?? null,
    adset_id: row.adset_id ?? null,
    ad_id: row.ad_id ?? null,
    name: row.campaign_name ?? row.adset_name ?? row.ad_name ?? row.account_name ?? null,
    date_start: row.date_start ?? null,
    date_stop: row.date_stop ?? null,
    spend: row.spend != null ? Number(row.spend) : 0,
    impressions: row.impressions != null ? Number(row.impressions) : 0,
    reach: row.reach != null ? Number(row.reach) : 0,
    clicks: row.clicks != null ? Number(row.clicks) : 0,
    ctr: row.ctr != null ? Number(row.ctr) : 0,
    cpc: row.cpc != null ? Number(row.cpc) : 0,
    cpm: row.cpm != null ? Number(row.cpm) : 0,
    actions,
    cost_per_action: costPerAction,
  };
  for (const key of ["age", "gender", "country", "publisher_platform", "platform_position", "impression_device"] as const) {
    if (row[key] != null) compact[key] = row[key];
  }
  return compact;
}

function firstImage(images: unknown): Record<string, unknown> | null {
  if (!isRecord(images)) return null;
  const first = Object.values(images)[0];
  return isRecord(first) ? first : null;
}

// ---------------------------------------------------------------------------
// get_account — auth check + token debug when app credentials are present
// ---------------------------------------------------------------------------
export const getAccountSchema = {
  account_id: z.string().optional().describe("Numeric ad account ID, with or without act_. Defaults to META_AD_ACCOUNT_ID"),
};

export async function getAccount(args: { account_id?: string }) {
  const account = await graphRequest<Record<string, unknown>>({
    path: getAdAccountId(args.account_id),
    query: {
      fields: [
        "id",
        "name",
        "account_status",
        "disable_reason",
        "currency",
        "timezone_name",
        "amount_spent",
        "balance",
        "business{id,name}",
        "funding_source_details",
        "created_time",
      ].join(","),
    },
  });

  let token: Record<string, unknown> | undefined;
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (appId && appSecret) {
    const debug = await graphRequest<{ data?: Record<string, unknown> }>({
      path: "debug_token",
      query: {
        input_token: getAccessToken(),
        access_token: `${appId}|${appSecret}`,
      },
    });
    const data = debug.data ?? {};
    token = {
      is_valid: data.is_valid ?? null,
      type: data.type ?? null,
      app_id: data.app_id ?? null,
      expires_at: data.expires_at === 0 ? "never" : data.expires_at ?? null,
      scopes: data.scopes ?? data.granular_scopes ?? null,
    };
  }

  return text({
    graph_api_version: graphApiVersion(),
    account: {
      id: account.id,
      name: account.name,
      account_status: account.account_status,
      disable_reason: account.disable_reason ?? null,
      currency: account.currency,
      timezone_name: account.timezone_name,
      amount_spent: fromMinorUnits(account.amount_spent),
      balance: fromMinorUnits(account.balance),
      business: account.business ?? null,
      created_time: account.created_time ?? null,
    },
    token: token ?? "Set META_APP_ID and META_APP_SECRET to include token debug (scopes / expiry).",
  });
}

// ---------------------------------------------------------------------------
// list / get campaigns
// ---------------------------------------------------------------------------
export const listCampaignsSchema = {
  account_id: z.string().optional().describe("Numeric ad account ID, no 'act_' prefix required. Defaults to META_AD_ACCOUNT_ID"),
  limit: z.number().int().min(1).max(200).optional(),
};

export async function listCampaigns(args: { account_id?: string; limit?: number }) {
  const campaigns = await graphGetAll<Record<string, unknown>>(
    accountPath(args.account_id, "campaigns"),
    { fields: CAMPAIGN_FIELDS },
    args.limit ?? 100,
  );
  return text(campaigns.map(mapCampaign));
}

export const getCampaignSchema = {
  campaign_id: z.string(),
};

export async function getCampaign(args: { campaign_id: string }) {
  const row = await graphRequest<Record<string, unknown>>({
    path: args.campaign_id,
    query: { fields: CAMPAIGN_FIELDS },
  });
  return text(mapCampaign(row));
}

export const getCampaignStructureSchema = {
  campaign_id: z.string(),
  account_id: z.string().optional(),
};

export async function getCampaignStructure(args: { campaign_id: string; account_id?: string }) {
  const [campaign, adSets, ads] = await Promise.all([
    graphRequest<Record<string, unknown>>({ path: args.campaign_id, query: { fields: CAMPAIGN_FIELDS } }),
    graphGetAll<Record<string, unknown>>(
      `${args.campaign_id}/adsets`,
      { fields: ADSET_FIELDS, limit: 100 },
      100,
    ),
    graphGetAll<Record<string, unknown>>(
      `${args.campaign_id}/ads`,
      { fields: AD_FIELDS, limit: 200 },
      200,
    ),
  ]);

  return text({
    campaign: mapCampaign(campaign),
    ad_sets: adSets.map((set) => ({
      ...mapAdSet(set),
      ads: ads.filter((ad) => ad.adset_id === set.id).map(mapAd),
    })),
  });
}

// ---------------------------------------------------------------------------
// list / get ad sets
// ---------------------------------------------------------------------------
export const listAdSetsSchema = {
  account_id: z.string().optional(),
  campaign_id: z.string().optional().describe("If set, list ad sets under this campaign only"),
  limit: z.number().int().min(1).max(200).optional(),
};

export async function listAdSets(args: { account_id?: string; campaign_id?: string; limit?: number }) {
  const path = args.campaign_id ? `${args.campaign_id}/adsets` : accountPath(args.account_id, "adsets");
  const rows = await graphGetAll<Record<string, unknown>>(path, { fields: ADSET_FIELDS }, args.limit ?? 100);
  return text(rows.map(mapAdSet));
}

export const getAdSetSchema = {
  ad_set_id: z.string(),
};

export async function getAdSet(args: { ad_set_id: string }) {
  const row = await graphRequest<Record<string, unknown>>({
    path: args.ad_set_id,
    query: { fields: ADSET_FIELDS },
  });
  return text(mapAdSet(row));
}

// ---------------------------------------------------------------------------
// list / get ads + review status
// ---------------------------------------------------------------------------
export const listAdsSchema = {
  account_id: z.string().optional(),
  campaign_id: z.string().optional(),
  ad_set_id: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional(),
};

export async function listAds(args: {
  account_id?: string;
  campaign_id?: string;
  ad_set_id?: string;
  limit?: number;
}) {
  const path = args.ad_set_id
    ? `${args.ad_set_id}/ads`
    : args.campaign_id
      ? `${args.campaign_id}/ads`
      : accountPath(args.account_id, "ads");
  const rows = await graphGetAll<Record<string, unknown>>(path, { fields: AD_FIELDS }, args.limit ?? 100);
  return text(rows.map(mapAd));
}

export const getAdSchema = {
  ad_id: z.string(),
};

export async function getAd(args: { ad_id: string }) {
  const row = await graphRequest<Record<string, unknown>>({
    path: args.ad_id,
    query: { fields: AD_FIELDS },
  });
  return text(mapAd(row));
}

export const getAdStatusSchema = {
  ad_id: z.string(),
};

export async function getAdStatus(args: { ad_id: string }) {
  const row = await graphRequest<Record<string, unknown>>({
    path: args.ad_id,
    query: { fields: "id,name,status,effective_status,issues_info,ad_review_feedback" },
  });
  return text({
    id: row.id,
    name: row.name,
    status: row.status,
    effective_status: row.effective_status,
    issues_info: row.issues_info ?? null,
    ad_review_feedback: row.ad_review_feedback ?? null,
  });
}

export const listAdsByStatusSchema = {
  account_id: z.string().optional(),
  effective_status: z
    .array(z.enum(["ACTIVE", "PAUSED", "DISAPPROVED", "PENDING_REVIEW", "WITH_ISSUES", "IN_PROCESS", "CAMPAIGN_PAUSED", "ADSET_PAUSED"]))
    .default(["DISAPPROVED"]),
};

export async function listAdsByStatus(args: { account_id?: string; effective_status?: string[] }) {
  const statuses = args.effective_status ?? ["DISAPPROVED"];
  const rows = await graphGetAll<Record<string, unknown>>(
    accountPath(args.account_id, "ads"),
    {
      fields: "id,name,effective_status,adset_id,campaign_id,issues_info,ad_review_feedback",
      effective_status: JSON.stringify(statuses),
    },
    200,
  );
  return text(
    rows.map((a) => ({
      id: a.id,
      name: a.name,
      effective_status: a.effective_status,
      adset_id: a.adset_id ?? null,
      campaign_id: a.campaign_id ?? null,
      issues_info: a.issues_info ?? null,
      ad_review_feedback: a.ad_review_feedback ?? null,
    })),
  );
}

// ---------------------------------------------------------------------------
// insights
// ---------------------------------------------------------------------------
const INSIGHTS_FIELDS = [
  "account_id",
  "account_name",
  "campaign_id",
  "campaign_name",
  "adset_id",
  "adset_name",
  "ad_id",
  "ad_name",
  "date_start",
  "date_stop",
  "spend",
  "impressions",
  "reach",
  "clicks",
  "ctr",
  "cpc",
  "cpm",
  "actions",
  "cost_per_action_type",
].join(",");

export const getInsightsSchema = {
  level: InsightsLevel.default("campaign").describe("account | campaign | adset | ad"),
  object_id: z
    .string()
    .optional()
    .describe("Campaign, ad set, or ad id. Defaults to the ad account when level is account."),
  account_id: z.string().optional(),
  date_preset: DatePreset.optional().describe("Ignored when since/until are set. Default last_7d."),
  since: z.string().optional().describe("YYYY-MM-DD inclusive start (custom range)"),
  until: z.string().optional().describe("YYYY-MM-DD inclusive end (custom range)"),
  breakdowns: z
    .array(Breakdown)
    .optional()
    .describe("age, gender, country, placement (publisher_platform), day (time_increment=1), impression_device"),
  limit: z.number().int().min(1).max(200).optional(),
};

export async function getInsights(args: {
  level?: "account" | "campaign" | "adset" | "ad";
  object_id?: string;
  account_id?: string;
  date_preset?: z.infer<typeof DatePreset>;
  since?: string;
  until?: string;
  breakdowns?: z.infer<typeof Breakdown>[];
  limit?: number;
}) {
  const level = args.level ?? "campaign";
  const pathId =
    args.object_id ??
    (level === "account" ? getAdAccountId(args.account_id) : undefined);
  if (!pathId) {
    throw new Error("object_id is required unless level is account (then META_AD_ACCOUNT_ID / account_id is used).");
  }

  const breakdowns = [...(args.breakdowns ?? [])];
  const byDay = breakdowns.includes("day");
  const graphBreakdowns = breakdowns
    .filter((b) => b !== "day")
    .map((b) => (b === "placement" ? "publisher_platform" : b));

  const query: Record<string, unknown> = {
    level,
    fields: INSIGHTS_FIELDS,
    limit: args.limit ?? 100,
  };
  if (args.since && args.until) {
    query.time_range = { since: args.since, until: args.until };
  } else {
    query.date_preset = args.date_preset ?? "last_7d";
  }
  if (graphBreakdowns.length) query.breakdowns = graphBreakdowns.join(",");
  if (byDay) query.time_increment = 1;

  const rows = await graphGetAll<Record<string, unknown>>(`${pathId}/insights`, query, args.limit ?? 100);
  return text({
    level,
    date: args.since && args.until ? { since: args.since, until: args.until } : { date_preset: args.date_preset ?? "last_7d" },
    breakdowns: breakdowns,
    rows: rows.map(compactInsightsRow),
  });
}

// ---------------------------------------------------------------------------
// create / update campaign — always PAUSED
// ---------------------------------------------------------------------------
export const createCampaignSchema = {
  name: z.string(),
  objective: CampaignObjective,
  special_ad_categories: z
    .array(SpecialAdCategory)
    .default([])
    .describe("Required by Meta. Empty or [NONE] if the ads are not in a special category."),
  daily_budget: z
    .number()
    .positive()
    .optional()
    .describe("Campaign-level daily budget in account currency (e.g. 20 = 20 GBP). Omit to budget at the ad set."),
  lifetime_budget: z.number().positive().optional().describe("Campaign-level lifetime budget in account currency."),
  bid_strategy: z
    .enum(["LOWEST_COST_WITHOUT_CAP", "LOWEST_COST_WITH_BID_CAP", "COST_CAP", "LOWEST_COST_WITH_MIN_ROAS"])
    .optional(),
  account_id: z.string().optional(),
};

export async function createCampaign(args: {
  name: string;
  objective: z.infer<typeof CampaignObjective>;
  special_ad_categories?: z.infer<typeof SpecialAdCategory>[];
  daily_budget?: number;
  lifetime_budget?: number;
  bid_strategy?: string;
  account_id?: string;
}) {
  const categories = args.special_ad_categories ?? [];
  const body: Record<string, unknown> = {
    name: args.name,
    objective: args.objective,
    status: "PAUSED",
    special_ad_categories: categories.length ? categories : [],
    buying_type: "AUCTION",
  };
  if (args.daily_budget != null) body.daily_budget = toMinorUnits(args.daily_budget);
  if (args.lifetime_budget != null) body.lifetime_budget = toMinorUnits(args.lifetime_budget);
  if (args.bid_strategy) body.bid_strategy = args.bid_strategy;

  const created = await graphRequest<{ id: string }>({
    method: "POST",
    path: accountPath(args.account_id, "campaigns"),
    body,
  });
  return text({
    status: CREATED_PAUSED,
    campaign_id: created.id,
    name: args.name,
    objective: args.objective,
    budget_mode: args.daily_budget != null || args.lifetime_budget != null ? "campaign" : "ad_set",
  });
}

export const updateCampaignSchema = {
  campaign_id: z.string(),
  name: z.string().optional(),
  daily_budget: z.number().positive().optional(),
  lifetime_budget: z.number().positive().optional(),
  special_ad_categories: z.array(SpecialAdCategory).optional(),
  bid_strategy: z
    .enum(["LOWEST_COST_WITHOUT_CAP", "LOWEST_COST_WITH_BID_CAP", "COST_CAP", "LOWEST_COST_WITH_MIN_ROAS"])
    .optional(),
};

export async function updateCampaign(args: {
  campaign_id: string;
  name?: string;
  daily_budget?: number;
  lifetime_budget?: number;
  special_ad_categories?: z.infer<typeof SpecialAdCategory>[];
  bid_strategy?: string;
}) {
  const body: Record<string, unknown> = {};
  if (args.name) body.name = args.name;
  if (args.daily_budget != null) body.daily_budget = toMinorUnits(args.daily_budget);
  if (args.lifetime_budget != null) body.lifetime_budget = toMinorUnits(args.lifetime_budget);
  if (args.special_ad_categories) body.special_ad_categories = args.special_ad_categories;
  if (args.bid_strategy) body.bid_strategy = args.bid_strategy;
  if (Object.keys(body).length === 0) {
    throw new Error("Nothing to update. Status changes go through meta_ads_set_campaign_status.");
  }
  await graphRequest({ method: "POST", path: args.campaign_id, body });
  return text({
    campaign_id: args.campaign_id,
    updated: Object.keys(body),
    note: "Status was not changed. Use meta_ads_set_campaign_status to ACTIVE/PAUSED.",
  });
}

// ---------------------------------------------------------------------------
// create / update ad set — Advantage+ audience off unless opted in
// ---------------------------------------------------------------------------
export const createAdSetSchema = {
  campaign_id: z.string(),
  name: z.string(),
  daily_budget: z
    .number()
    .positive()
    .optional()
    .describe("Ad set daily budget in account currency. Required unless the campaign has a campaign-level budget."),
  lifetime_budget: z.number().positive().optional(),
  optimization_goal: OptimizationGoal,
  billing_event: BillingEvent.default("IMPRESSIONS"),
  pixel_id: z.string().optional().describe("Defaults to META_PIXEL_ID. Required for OFFSITE_CONVERSIONS."),
  custom_event_type: PixelEvent.optional().describe("Pixel event to optimize for, e.g. COMPLETE_REGISTRATION"),
  page_id: z.string().optional().describe("Needed when the promoted object is a Page."),
  destination_type: z.string().optional().describe("e.g. WEBSITE. Default WEBSITE when a pixel is set."),
  targeting: targetingInput.optional(),
  targeting_raw: z.record(z.unknown()).optional().describe("Escape hatch: raw Graph targeting spec."),
  advantage_audience: z
    .boolean()
    .default(false)
    .describe("Default false. Sets targeting_automation.advantage_audience to 0 so manual interests are not expanded."),
  start_time: z.string().optional().describe("ISO-8601. Defaults to now."),
  end_time: z.string().optional(),
  bid_strategy: z
    .enum(["LOWEST_COST_WITHOUT_CAP", "LOWEST_COST_WITH_BID_CAP", "COST_CAP", "LOWEST_COST_WITH_MIN_ROAS"])
    .optional(),
  account_id: z.string().optional(),
};

export async function createAdSet(args: {
  campaign_id: string;
  name: string;
  daily_budget?: number;
  lifetime_budget?: number;
  optimization_goal: z.infer<typeof OptimizationGoal>;
  billing_event?: z.infer<typeof BillingEvent>;
  pixel_id?: string;
  custom_event_type?: z.infer<typeof PixelEvent>;
  page_id?: string;
  destination_type?: string;
  targeting?: TargetingInput;
  targeting_raw?: Record<string, unknown>;
  advantage_audience?: boolean;
  start_time?: string;
  end_time?: string;
  bid_strategy?: string;
  account_id?: string;
}) {
  const pixelId = args.pixel_id ?? process.env.META_PIXEL_ID;
  const pageId = args.page_id ?? process.env.META_PAGE_ID;
  const advantage = args.advantage_audience === true;
  const targeting = buildTargeting(args.targeting, advantage, args.targeting_raw);

  const promotedObject: Record<string, unknown> = {};
  if (pixelId) promotedObject.pixel_id = pixelId;
  if (args.custom_event_type) promotedObject.custom_event_type = args.custom_event_type;
  if (pageId && args.optimization_goal === "PAGE_LIKES") promotedObject.page_id = pageId;

  if (args.optimization_goal === "OFFSITE_CONVERSIONS" && !pixelId) {
    throw new Error("OFFSITE_CONVERSIONS requires pixel_id or META_PIXEL_ID.");
  }

  const body: Record<string, unknown> = {
    campaign_id: args.campaign_id,
    name: args.name,
    status: "PAUSED",
    optimization_goal: args.optimization_goal,
    billing_event: args.billing_event ?? "IMPRESSIONS",
    targeting,
  };
  if (args.daily_budget != null) body.daily_budget = toMinorUnits(args.daily_budget);
  if (args.lifetime_budget != null) body.lifetime_budget = toMinorUnits(args.lifetime_budget);
  if (args.start_time) body.start_time = args.start_time;
  if (args.end_time) body.end_time = args.end_time;
  if (args.bid_strategy) body.bid_strategy = args.bid_strategy;
  if (Object.keys(promotedObject).length) body.promoted_object = promotedObject;
  if (args.destination_type) body.destination_type = args.destination_type;
  else if (pixelId) body.destination_type = "WEBSITE";

  const created = await graphRequest<{ id: string }>({
    method: "POST",
    path: accountPath(args.account_id, "adsets"),
    body,
  });
  return text({
    status: CREATED_PAUSED,
    ad_set_id: created.id,
    campaign_id: args.campaign_id,
    name: args.name,
    advantage_audience: advantage ? 1 : 0,
    targeting,
  });
}

export const updateAdSetSchema = {
  ad_set_id: z.string(),
  name: z.string().optional(),
  daily_budget: z.number().positive().optional(),
  lifetime_budget: z.number().positive().optional(),
  optimization_goal: OptimizationGoal.optional(),
  billing_event: BillingEvent.optional(),
  pixel_id: z.string().optional(),
  custom_event_type: PixelEvent.optional(),
  targeting: targetingInput.optional(),
  targeting_raw: z.record(z.unknown()).optional(),
  advantage_audience: z.boolean().optional(),
  start_time: z.string().optional(),
  end_time: z.string().optional(),
};

export async function updateAdSet(args: {
  ad_set_id: string;
  name?: string;
  daily_budget?: number;
  lifetime_budget?: number;
  optimization_goal?: z.infer<typeof OptimizationGoal>;
  billing_event?: z.infer<typeof BillingEvent>;
  pixel_id?: string;
  custom_event_type?: z.infer<typeof PixelEvent>;
  targeting?: TargetingInput;
  targeting_raw?: Record<string, unknown>;
  advantage_audience?: boolean;
  start_time?: string;
  end_time?: string;
}) {
  const body: Record<string, unknown> = {};
  if (args.name) body.name = args.name;
  if (args.daily_budget != null) body.daily_budget = toMinorUnits(args.daily_budget);
  if (args.lifetime_budget != null) body.lifetime_budget = toMinorUnits(args.lifetime_budget);
  if (args.optimization_goal) body.optimization_goal = args.optimization_goal;
  if (args.billing_event) body.billing_event = args.billing_event;
  if (args.start_time) body.start_time = args.start_time;
  if (args.end_time) body.end_time = args.end_time;
  if (args.pixel_id || args.custom_event_type) {
    const promoted: Record<string, unknown> = {};
    if (args.pixel_id) promoted.pixel_id = args.pixel_id;
    if (args.custom_event_type) promoted.custom_event_type = args.custom_event_type;
    body.promoted_object = promoted;
  }
  if (args.targeting || args.targeting_raw) {
    body.targeting = buildTargeting(args.targeting, args.advantage_audience === true, args.targeting_raw);
  } else if (args.advantage_audience != null) {
    const current = await graphRequest<Record<string, unknown>>({
      path: args.ad_set_id,
      query: { fields: "targeting" },
    });
    const existing = isRecord(current.targeting) ? current.targeting : {};
    body.targeting = buildTargeting(undefined, args.advantage_audience, existing);
  }
  if (Object.keys(body).length === 0) {
    throw new Error("Nothing to update. Status changes go through meta_ads_set_ad_set_status.");
  }
  await graphRequest({ method: "POST", path: args.ad_set_id, body });
  return text({
    ad_set_id: args.ad_set_id,
    updated: Object.keys(body),
    note: "Status was not changed. Use meta_ads_set_ad_set_status to ACTIVE/PAUSED.",
  });
}

// ---------------------------------------------------------------------------
// targeting helpers
// ---------------------------------------------------------------------------
export const searchTargetingSchema = {
  q: z.string().describe("Keyword, e.g. 'online banking' or 'London'"),
  type: z.enum(["interest", "behavior", "geo"]).default("interest"),
  limit: z.number().int().min(1).max(100).optional(),
  country: z.string().optional().describe("For type=geo, ISO country to bias city search, e.g. GB"),
};

export async function searchTargeting(args: {
  q: string;
  type?: "interest" | "behavior" | "geo";
  limit?: number;
  country?: string;
}) {
  const kind = args.type ?? "interest";
  const limit = args.limit ?? 25;

  if (kind === "interest") {
    const result = await graphRequest<{ data?: Record<string, unknown>[] }>({
      path: "search",
      query: { type: "adinterest", q: args.q, limit },
    });
    return text({
      type: "interest",
      q: args.q,
      results: (result.data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        audience_size: row.audience_size ?? row.audience_size_lower_bound ?? null,
        path: row.path ?? null,
        topic: row.topic ?? null,
      })),
      note: "Some detailed interests have been retired by Meta. If results are empty, try a broader keyword or behaviours.",
    });
  }

  if (kind === "behavior") {
    const result = await graphRequest<{ data?: Record<string, unknown>[] }>({
      path: "search",
      query: { type: "adTargetingCategory", class: "behaviors" },
    });
    const needle = args.q.toLowerCase();
    const results = (result.data ?? [])
      .filter((row) => {
        const name = String(row.name ?? "").toLowerCase();
        const path = JSON.stringify(row.path ?? []).toLowerCase();
        return name.includes(needle) || path.includes(needle);
      })
      .slice(0, limit)
      .map((row) => ({
        id: row.id,
        name: row.name,
        audience_size: row.audience_size ?? row.audience_size_lower_bound ?? null,
        path: row.path ?? null,
      }));
    return text({ type: "behavior", q: args.q, results });
  }

  const query: Record<string, unknown> = {
    type: "adgeolocation",
    q: args.q,
    location_types: ["country", "region", "city"],
    limit,
  };
  if (args.country) query.country_code = args.country;
  const result = await graphRequest<{ data?: Record<string, unknown>[] }>({ path: "search", query });
  return text({
    type: "geo",
    q: args.q,
    results: (result.data ?? []).map((row) => ({
      key: row.key,
      name: row.name,
      type: row.type,
      country_code: row.country_code ?? null,
      region: row.region ?? null,
      supports_region: row.supports_region ?? null,
      supports_city: row.supports_city ?? null,
    })),
  });
}

export const estimateAudienceSchema = {
  account_id: z.string().optional(),
  targeting: targetingInput.optional(),
  targeting_raw: z.record(z.unknown()).optional(),
  advantage_audience: z.boolean().default(false),
  optimization_goal: OptimizationGoal.default("OFFSITE_CONVERSIONS"),
  pixel_id: z.string().optional(),
  custom_event_type: PixelEvent.optional(),
};

export async function estimateAudience(args: {
  account_id?: string;
  targeting?: TargetingInput;
  targeting_raw?: Record<string, unknown>;
  advantage_audience?: boolean;
  optimization_goal?: z.infer<typeof OptimizationGoal>;
  pixel_id?: string;
  custom_event_type?: z.infer<typeof PixelEvent>;
}) {
  const targeting = buildTargeting(args.targeting, args.advantage_audience === true, args.targeting_raw);
  const query: Record<string, unknown> = {
    targeting_spec: targeting,
    optimization_goal: args.optimization_goal ?? "OFFSITE_CONVERSIONS",
  };
  const pixelId = args.pixel_id ?? process.env.META_PIXEL_ID;
  if (pixelId || args.custom_event_type) {
    query.promoted_object = {
      ...(pixelId ? { pixel_id: pixelId } : {}),
      ...(args.custom_event_type ? { custom_event_type: args.custom_event_type } : {}),
    };
  }

  const result = await graphRequest<{ data?: Record<string, unknown>[] }>({
    path: accountPath(args.account_id, "delivery_estimate"),
    query,
  });
  const estimate = result.data?.[0] ?? result;
  return text({
    targeting,
    optimization_goal: args.optimization_goal ?? "OFFSITE_CONVERSIONS",
    estimate,
    note: "v26 removed daily_outcomes_curve / estimate_dau. Use estimate_mau_* / estimate_ready when present.",
  });
}

// ---------------------------------------------------------------------------
// creatives and ads
// ---------------------------------------------------------------------------
export const uploadImageSchema = {
  account_id: z.string().optional(),
  url: z.string().optional().describe("Public image URL"),
  path: z.string().optional().describe("Local file path (jpg/png/gif/webp)"),
  name: z.string().optional().describe("Filename with extension. Required when uploading raw bytes via path."),
};

export async function uploadImage(args: { account_id?: string; url?: string; path?: string; name?: string }) {
  if (!args.url && !args.path) {
    throw new Error("Provide url or path.");
  }

  let result: { images?: Record<string, Record<string, unknown>> };
  if (args.url) {
    result = await graphRequest({
      method: "POST",
      path: accountPath(args.account_id, "adimages"),
      body: { url: args.url },
    });
  } else {
    const filePath = args.path as string;
    const filename = args.name ?? basename(filePath);
    if (!extname(filename)) {
      throw new Error("Image filename must include an extension, e.g. hero.jpg");
    }
    const bytes = await readFile(filePath);
    result = await graphRequest({
      method: "POST",
      path: accountPath(args.account_id, "adimages"),
      body: {
        bytes: bytes.toString("base64"),
        name: filename,
      },
    });
  }

  const image = firstImage(result.images);
  return text({
    hash: image?.hash ?? null,
    url: image?.url ?? args.url ?? null,
    width: image?.width ?? null,
    height: image?.height ?? null,
    images: result.images ?? result,
  });
}

export const createAdCreativeSchema = {
  name: z.string(),
  page_id: z.string().optional().describe("Defaults to META_PAGE_ID"),
  link: z.string().describe("Landing page URL"),
  message: z.string().describe("Primary text"),
  headline: z.string().optional(),
  description: z.string().optional(),
  image_hash: z.string().describe("Hash from meta_ads_upload_image"),
  cta_type: CtaType.default("LEARN_MORE"),
  url_tags: z
    .string()
    .optional()
    .describe("Query string appended to the link, e.g. utm_source=meta&utm_medium=paid&utm_campaign=spring"),
  account_id: z.string().optional(),
};

export function buildLinkCreativeBody(args: {
  name: string;
  page_id: string;
  link: string;
  message: string;
  headline?: string;
  description?: string;
  image_hash: string;
  cta_type?: string;
  url_tags?: string;
}): Record<string, unknown> {
  const linkData: Record<string, unknown> = {
    link: args.link,
    message: args.message,
    image_hash: args.image_hash,
    call_to_action: {
      type: args.cta_type ?? "LEARN_MORE",
      value: { link: args.link },
    },
  };
  if (args.headline) linkData.name = args.headline;
  if (args.description) linkData.description = args.description;

  const body: Record<string, unknown> = {
    name: args.name,
    object_story_spec: {
      page_id: args.page_id,
      link_data: linkData,
    },
  };
  if (args.url_tags) body.url_tags = args.url_tags;
  return body;
}

export async function createAdCreative(args: {
  name: string;
  page_id?: string;
  link: string;
  message: string;
  headline?: string;
  description?: string;
  image_hash: string;
  cta_type?: z.infer<typeof CtaType>;
  url_tags?: string;
  account_id?: string;
}) {
  const pageId = args.page_id ?? process.env.META_PAGE_ID;
  if (!pageId) {
    throw new Error("page_id is required (or set META_PAGE_ID). The System User must be assigned this Page.");
  }
  const body = buildLinkCreativeBody({ ...args, page_id: pageId });
  const created = await graphRequest<{ id: string }>({
    method: "POST",
    path: accountPath(args.account_id, "adcreatives"),
    body,
  });
  return text({
    creative_id: created.id,
    name: args.name,
    page_id: pageId,
    url_tags: args.url_tags ?? null,
  });
}

export const createAdSchema = {
  name: z.string(),
  ad_set_id: z.string(),
  creative_id: z.string(),
  account_id: z.string().optional(),
};

export async function createAd(args: { name: string; ad_set_id: string; creative_id: string; account_id?: string }) {
  const created = await graphRequest<{ id: string }>({
    method: "POST",
    path: accountPath(args.account_id, "ads"),
    body: {
      name: args.name,
      adset_id: args.ad_set_id,
      creative: { creative_id: args.creative_id },
      status: "PAUSED",
    },
  });
  return text({
    status: CREATED_PAUSED,
    ad_id: created.id,
    ad_set_id: args.ad_set_id,
    creative_id: args.creative_id,
    name: args.name,
  });
}

export const updateAdSchema = {
  ad_id: z.string(),
  name: z.string().optional(),
  creative_id: z.string().optional().describe("Attach an existing creative. Ignored if copy fields are also set (a new creative is created)."),
  page_id: z.string().optional(),
  link: z.string().optional(),
  message: z.string().optional(),
  headline: z.string().optional(),
  description: z.string().optional(),
  image_hash: z.string().optional(),
  cta_type: CtaType.optional(),
  url_tags: z.string().optional(),
  account_id: z.string().optional(),
};

export async function updateAd(args: {
  ad_id: string;
  name?: string;
  creative_id?: string;
  page_id?: string;
  link?: string;
  message?: string;
  headline?: string;
  description?: string;
  image_hash?: string;
  cta_type?: z.infer<typeof CtaType>;
  url_tags?: string;
  account_id?: string;
}) {
  const copyTouched =
    args.page_id != null ||
    args.link != null ||
    args.message != null ||
    args.headline != null ||
    args.description != null ||
    args.image_hash != null ||
    args.cta_type != null ||
    args.url_tags != null;

  const body: Record<string, unknown> = {};
  if (args.name) body.name = args.name;

  if (copyTouched) {
    const current = await graphRequest<Record<string, unknown>>({
      path: args.ad_id,
      query: { fields: "name,creative{id,name,url_tags,object_story_spec,title,body,image_hash,call_to_action_type}" },
    });
    const creative = isRecord(current.creative) ? current.creative : {};
    const spec = isRecord(creative.object_story_spec) ? creative.object_story_spec : {};
    const linkData = isRecord(spec.link_data) ? spec.link_data : {};
    const pageId = args.page_id ?? (typeof spec.page_id === "string" ? spec.page_id : process.env.META_PAGE_ID);
    const link = args.link ?? (typeof linkData.link === "string" ? linkData.link : undefined);
    const imageHash =
      args.image_hash ??
      (typeof linkData.image_hash === "string"
        ? linkData.image_hash
        : typeof creative.image_hash === "string"
          ? creative.image_hash
          : undefined);
    const message =
      args.message ??
      (typeof linkData.message === "string" ? linkData.message : typeof creative.body === "string" ? creative.body : undefined);
    if (!pageId || !link || !imageHash || !message) {
      throw new Error(
        "Updating copy needs page_id, link, image_hash, and message. Pass the missing fields or create a new creative with meta_ads_create_ad_creative and attach it via creative_id.",
      );
    }
    const existingCta = isRecord(linkData.call_to_action) ? String(linkData.call_to_action.type ?? "LEARN_MORE") : "LEARN_MORE";
    const created = await graphRequest<{ id: string }>({
      method: "POST",
      path: accountPath(args.account_id, "adcreatives"),
      body: buildLinkCreativeBody({
        name: `${args.name ?? current.name ?? "ad"} copy update`,
        page_id: pageId,
        link,
        message,
        headline: args.headline ?? (typeof linkData.name === "string" ? linkData.name : undefined),
        description: args.description ?? (typeof linkData.description === "string" ? linkData.description : undefined),
        image_hash: imageHash,
        cta_type: args.cta_type ?? existingCta,
        url_tags: args.url_tags ?? (typeof creative.url_tags === "string" ? creative.url_tags : undefined),
      }),
    });
    body.creative = { creative_id: created.id };
  } else if (args.creative_id) {
    body.creative = { creative_id: args.creative_id };
  }

  if (Object.keys(body).length === 0) {
    throw new Error("Nothing to update. Status changes go through meta_ads_set_ad_status.");
  }
  await graphRequest({ method: "POST", path: args.ad_id, body });
  return text({
    ad_id: args.ad_id,
    updated: Object.keys(body),
    creative_id: isRecord(body.creative) ? body.creative.creative_id : args.creative_id ?? null,
    note: "Status was not changed. Use meta_ads_set_ad_status to ACTIVE/PAUSED.",
  });
}

// ---------------------------------------------------------------------------
// status — the only tools that can turn spend on
// ---------------------------------------------------------------------------
const ObjectStatus = z.enum(["ACTIVE", "PAUSED"]);

export const setCampaignStatusSchema = {
  campaign_id: z.string(),
  status: ObjectStatus.describe("ACTIVE turns spend on for this campaign. PAUSED stops it."),
};

export async function setCampaignStatus(args: { campaign_id: string; status: "ACTIVE" | "PAUSED" }) {
  await graphRequest({ method: "POST", path: args.campaign_id, body: { status: args.status } });
  return text({
    campaign_id: args.campaign_id,
    status: args.status,
    spend: args.status === "ACTIVE" ? "on (subject to ad set / ad status and review)" : "off",
  });
}

export const setAdSetStatusSchema = {
  ad_set_id: z.string(),
  status: ObjectStatus.describe("ACTIVE turns spend on for this ad set. PAUSED stops it."),
};

export async function setAdSetStatus(args: { ad_set_id: string; status: "ACTIVE" | "PAUSED" }) {
  await graphRequest({ method: "POST", path: args.ad_set_id, body: { status: args.status } });
  return text({
    ad_set_id: args.ad_set_id,
    status: args.status,
    spend: args.status === "ACTIVE" ? "on (subject to campaign / ad status and review)" : "off",
  });
}

export const setAdStatusSchema = {
  ad_id: z.string(),
  status: ObjectStatus.describe("ACTIVE turns spend on for this ad. PAUSED stops it."),
};

export async function setAdStatus(args: { ad_id: string; status: "ACTIVE" | "PAUSED" }) {
  await graphRequest({ method: "POST", path: args.ad_id, body: { status: args.status } });
  return text({
    ad_id: args.ad_id,
    status: args.status,
    spend: args.status === "ACTIVE" ? "on (subject to campaign / ad set status and review)" : "off",
  });
}

// ---------------------------------------------------------------------------
// copies — always PAUSED so duplication cannot start spend
// ---------------------------------------------------------------------------
export const copyCampaignSchema = {
  campaign_id: z.string(),
  deep_copy: z.boolean().default(true).describe("Also copy ad sets and ads (sync limit: a few child ads)"),
  name_suffix: z.string().optional().describe("Appended to the copy name. Default is Meta's locale '- Copy'."),
};

export async function copyCampaign(args: { campaign_id: string; deep_copy?: boolean; name_suffix?: string }) {
  const body: Record<string, unknown> = {
    deep_copy: args.deep_copy !== false,
    status_option: "PAUSED",
  };
  if (args.name_suffix) {
    body.rename_options = { rename_strategy: "DEEP_RENAME", rename_suffix: args.name_suffix };
  }
  const result = await graphRequest<Record<string, unknown>>({
    method: "POST",
    path: `${args.campaign_id}/copies`,
    body,
  });
  return text({
    status: CREATED_PAUSED,
    source_campaign_id: args.campaign_id,
    copied_campaign_id: result.copied_campaign_id ?? result.id ?? null,
    ad_object_ids: result.ad_object_ids ?? null,
  });
}

export const copyAdSetSchema = {
  ad_set_id: z.string(),
  campaign_id: z.string().optional().describe("Move the copy under a different campaign"),
  deep_copy: z.boolean().default(true),
  name_suffix: z.string().optional(),
};

export async function copyAdSet(args: {
  ad_set_id: string;
  campaign_id?: string;
  deep_copy?: boolean;
  name_suffix?: string;
}) {
  const body: Record<string, unknown> = {
    deep_copy: args.deep_copy !== false,
    status_option: "PAUSED",
  };
  if (args.campaign_id) body.campaign_id = args.campaign_id;
  if (args.name_suffix) {
    body.rename_options = { rename_strategy: "DEEP_RENAME", rename_suffix: args.name_suffix };
  }
  const result = await graphRequest<Record<string, unknown>>({
    method: "POST",
    path: `${args.ad_set_id}/copies`,
    body,
  });
  return text({
    status: CREATED_PAUSED,
    source_ad_set_id: args.ad_set_id,
    copied_ad_set_id: result.copied_adset_id ?? result.id ?? null,
    ad_object_ids: result.ad_object_ids ?? null,
  });
}

export const copyAdSchema = {
  ad_id: z.string(),
  ad_set_id: z.string().optional().describe("Move the copy under a different ad set"),
  name_suffix: z.string().optional(),
};

export async function copyAd(args: { ad_id: string; ad_set_id?: string; name_suffix?: string }) {
  const body: Record<string, unknown> = { status_option: "PAUSED" };
  if (args.ad_set_id) body.adset_id = args.ad_set_id;
  if (args.name_suffix) {
    body.rename_options = { rename_strategy: "ONLY_TOP_LEVEL_RENAME", rename_suffix: args.name_suffix };
  }
  const result = await graphRequest<Record<string, unknown>>({
    method: "POST",
    path: `${args.ad_id}/copies`,
    body,
  });
  return text({
    status: CREATED_PAUSED,
    source_ad_id: args.ad_id,
    copied_ad_id: result.copied_ad_id ?? result.id ?? null,
  });
}

