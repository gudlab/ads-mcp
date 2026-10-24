import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  DEFAULT_GRAPH_API_VERSION,
  MetaGraphError,
  configureMetaGraph,
  formatGraphError,
  graphApiVersion,
  resetMetaGraph,
  toMinorUnits,
} from "../src/meta-ads/client.js";
import {
  buildLinkCreativeBody,
  buildTargeting,
  compactInsightsRow,
  copyCampaign,
  createAd,
  createAdCreative,
  createAdSet,
  createCampaign,
  estimateAudience,
  getAccount,
  getAdStatus,
  getInsights,
  listCampaigns,
  searchTargeting,
  setCampaignStatus,
  updateAd,
  uploadImage,
} from "../src/meta-ads/tools.js";

type RecordedCall = {
  method: string;
  pathname: string;
  search: URLSearchParams;
  body: URLSearchParams | null;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function parseBody(init?: RequestInit): URLSearchParams | null {
  if (!init?.body) return null;
  if (typeof init.body === "string") return new URLSearchParams(init.body);
  if (init.body instanceof URLSearchParams) return init.body;
  return null;
}

function mockFetch(routes: Array<{
  method?: string;
  match: string | RegExp;
  response: unknown | ((url: URL, call: RecordedCall) => unknown);
  status?: number;
}>): { fetch: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const call: RecordedCall = {
      method,
      pathname: url.pathname,
      search: url.searchParams,
      body: parseBody(init),
    };
    calls.push(call);
    const route = routes.find((r) => {
      const m = (r.method ?? "GET") === method;
      const pathOk = typeof r.match === "string" ? url.pathname.includes(r.match) : r.match.test(url.pathname);
      return m && pathOk;
    });
    if (!route) {
      return jsonResponse({ error: { message: `Unexpected ${method} ${url.pathname}`, code: 100 } }, 400);
    }
    const payload = typeof route.response === "function" ? route.response(url, call) : route.response;
    return jsonResponse(payload, route.status ?? 200);
  };
  return { fetch: fetchImpl, calls };
}

function parseTool(result: { content: { text: string }[] }): unknown {
  return JSON.parse(result.content[0].text);
}

describe("Meta Graph client", () => {
  beforeEach(() => {
    process.env.META_ACCESS_TOKEN = "test-token";
    process.env.META_AD_ACCOUNT_ID = "111";
    delete process.env.META_GRAPH_API_VERSION;
    delete process.env.META_PAGE_ID;
    delete process.env.META_PIXEL_ID;
    delete process.env.META_APP_ID;
    delete process.env.META_APP_SECRET;
  });

  afterEach(() => {
    resetMetaGraph();
  });

  it("centralises a recent stable Graph API version", () => {
    assert.equal(DEFAULT_GRAPH_API_VERSION, "v26.0");
    assert.equal(graphApiVersion(), "v26.0");
    process.env.META_GRAPH_API_VERSION = "v25.0";
    assert.equal(graphApiVersion(), "v25.0");
  });

  it("maps checkpoint (459) and expired token (190) to actionable text", () => {
    const checkpoint = formatGraphError({
      error: {
        message: "You cannot access the app until you log in",
        type: "OAuthException",
        code: 190,
        error_subcode: 459,
        fbtrace_id: "abc",
      },
    });
    assert.match(checkpoint, /checkpointed/i);
    assert.match(checkpoint, /System User/);
    assert.match(checkpoint, /fbtrace_id: abc/);

    const expired = formatGraphError({
      error: { message: "Invalid OAuth access token", type: "OAuthException", code: 190 },
    });
    assert.match(expired, /expired|revoked|invalid/i);
    assert.match(expired, /ads_management/);
  });

  it("surfaces policy / user-facing Graph errors", () => {
    const text = formatGraphError({
      error: {
        message: "Invalid parameter",
        type: "OAuthException",
        code: 100,
        error_subcode: 1487390,
        error_user_title: "Ad wasn't approved",
        error_user_msg: "This creative was rejected for prohibited content.",
      },
    });
    assert.match(text, /Ad wasn't approved/);
    assert.match(text, /prohibited content/);
    assert.match(text, /1487390/);
    assert.match(text, /cannot be overridden/);
  });

  it("throws MetaGraphError on Graph error payloads", async () => {
    const { fetch } = mockFetch([
      {
        match: "/act_111",
        status: 400,
        response: { error: { message: "Invalid OAuth access token.", code: 190, type: "OAuthException" } },
      },
    ]);
    configureMetaGraph({ fetch });
    await assert.rejects(() => getAccount({}), (err: unknown) => {
      assert.ok(err instanceof MetaGraphError);
      assert.equal(err.code, 190);
      assert.match(err.message, /META_ACCESS_TOKEN/);
      return true;
    });
  });
});

describe("Meta tools", () => {
  beforeEach(() => {
    process.env.META_ACCESS_TOKEN = "test-token";
    process.env.META_AD_ACCOUNT_ID = "111";
    process.env.META_PAGE_ID = "page-1";
    process.env.META_PIXEL_ID = "pixel-1";
    delete process.env.META_GRAPH_API_VERSION;
  });

  afterEach(() => {
    resetMetaGraph();
  });

  it("lists campaigns with major-unit budgets", async () => {
    const { fetch, calls } = mockFetch([
      {
        match: "/act_111/campaigns",
        response: {
          data: [
            {
              id: "c1",
              name: "UK leads",
              status: "PAUSED",
              effective_status: "PAUSED",
              objective: "OUTCOME_LEADS",
              daily_budget: "2500",
            },
          ],
        },
      },
    ]);
    configureMetaGraph({ fetch });
    const rows = parseTool(await listCampaigns({})) as Array<Record<string, unknown>>;
    assert.equal(rows[0].daily_budget, 25);
    assert.equal(rows[0].objective, "OUTCOME_LEADS");
    assert.match(calls[0].pathname, /\/v26\.0\/act_111\/campaigns/);
    assert.equal(calls[0].search.get("access_token"), "test-token");
  });

  it("creates a campaign PAUSED with special_ad_categories and campaign budget", async () => {
    const { fetch, calls } = mockFetch([
      { method: "POST", match: "/act_111/campaigns", response: { id: "cmp_1" } },
    ]);
    configureMetaGraph({ fetch });
    const result = parseTool(
      await createCampaign({
        name: "Pay-by-bank leads",
        objective: "OUTCOME_LEADS",
        special_ad_categories: [],
        daily_budget: 20,
      }),
    ) as Record<string, unknown>;
    assert.equal(result.campaign_id, "cmp_1");
    assert.match(String(result.status), /PAUSED/);
    assert.equal(calls[0].body?.get("status"), "PAUSED");
    assert.equal(calls[0].body?.get("daily_budget"), "2000");
    assert.equal(calls[0].body?.get("objective"), "OUTCOME_LEADS");
    assert.ok(!String(calls[0].body?.get("status")).includes("ACTIVE"));
  });

  it("builds targeting with flexible_spec and Advantage+ audience off", () => {
    const targeting = buildTargeting(
      {
        countries: ["GB"],
        age_min: 25,
        age_max: 54,
        interests: [{ id: "6001", name: "Online shopping" }],
        behaviors: [{ id: "7001", name: "Engaged shoppers" }],
        excluded_interests: [{ id: "8001", name: "Gambling" }],
      },
      false,
    );
    assert.deepEqual(targeting.targeting_automation, { advantage_audience: 0 });
    assert.deepEqual(targeting.geo_locations, { countries: ["GB"] });
    assert.deepEqual(targeting.flexible_spec, [
      {
        interests: [{ id: "6001", name: "Online shopping" }],
        behaviors: [{ id: "7001", name: "Engaged shoppers" }],
      },
    ]);
    assert.deepEqual(targeting.exclusions, { interests: [{ id: "8001", name: "Gambling" }] });
  });

  it("creates an ad set PAUSED with pixel event and Advantage+ off", async () => {
    const { fetch, calls } = mockFetch([
      { method: "POST", match: "/act_111/adsets", response: { id: "set_1" } },
    ]);
    configureMetaGraph({ fetch });
    const result = parseTool(
      await createAdSet({
        campaign_id: "cmp_1",
        name: "GB 25-54 shopping",
        daily_budget: 15,
        optimization_goal: "OFFSITE_CONVERSIONS",
        custom_event_type: "COMPLETE_REGISTRATION",
        targeting: {
          countries: ["GB"],
          age_min: 25,
          age_max: 54,
          interests: [{ id: "6001", name: "Online shopping" }],
        },
      }),
    ) as Record<string, unknown>;
    assert.equal(result.ad_set_id, "set_1");
    assert.equal(result.advantage_audience, 0);
    assert.equal(calls[0].body?.get("status"), "PAUSED");
    assert.equal(calls[0].body?.get("daily_budget"), "1500");
    const targeting = JSON.parse(calls[0].body?.get("targeting") ?? "{}");
    assert.equal(targeting.targeting_automation.advantage_audience, 0);
    const promoted = JSON.parse(calls[0].body?.get("promoted_object") ?? "{}");
    assert.equal(promoted.pixel_id, "pixel-1");
    assert.equal(promoted.custom_event_type, "COMPLETE_REGISTRATION");
  });

  it("searches interests by keyword", async () => {
    const { fetch } = mockFetch([
      {
        match: "/search",
        response: {
          data: [{ id: "6001", name: "Online shopping", audience_size: 200000000, path: ["Interests", "Shopping"] }],
        },
      },
    ]);
    configureMetaGraph({ fetch });
    const result = parseTool(await searchTargeting({ q: "shopping", type: "interest" })) as {
      results: Array<{ id: string }>;
    };
    assert.equal(result.results[0].id, "6001");
  });

  it("filters behaviours client-side when searching", async () => {
    const { fetch } = mockFetch([
      {
        match: "/search",
        response: {
          data: [
            { id: "1", name: "Engaged shoppers" },
            { id: "2", name: "Frequent travellers" },
          ],
        },
      },
    ]);
    configureMetaGraph({ fetch });
    const result = parseTool(await searchTargeting({ q: "shop", type: "behavior" })) as {
      results: Array<{ name: string }>;
    };
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].name, "Engaged shoppers");
  });

  it("requests a delivery estimate", async () => {
    const { fetch, calls } = mockFetch([
      {
        match: "/act_111/delivery_estimate",
        response: { data: [{ estimate_mau_lower_bound: 100000, estimate_mau_upper_bound: 250000, estimate_ready: true }] },
      },
    ]);
    configureMetaGraph({ fetch });
    const result = parseTool(
      await estimateAudience({
        targeting: { countries: ["GB"], interests: [{ id: "6001" }] },
        optimization_goal: "OFFSITE_CONVERSIONS",
      }),
    ) as { estimate: { estimate_ready: boolean } };
    assert.equal(result.estimate.estimate_ready, true);
    assert.ok(calls[0].search.get("targeting_spec"));
  });

  it("uploads an image from a URL and returns the hash", async () => {
    const { fetch, calls } = mockFetch([
      {
        method: "POST",
        match: "/act_111/adimages",
        response: { images: { "hero.jpg": { hash: "abc123", url: "https://cdn.example/hero.jpg", width: 1200, height: 628 } } },
      },
    ]);
    configureMetaGraph({ fetch });
    const result = parseTool(await uploadImage({ url: "https://cdn.example/hero.jpg" })) as { hash: string };
    assert.equal(result.hash, "abc123");
    assert.equal(calls[0].body?.get("url"), "https://cdn.example/hero.jpg");
  });

  it("uploads an image from a local path as base64 bytes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ads-mcp-"));
    const filePath = join(dir, "pixel.png");
    await writeFile(
      filePath,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      ),
    );
    const { fetch, calls } = mockFetch([
      {
        method: "POST",
        match: "/act_111/adimages",
        response: { images: { "pixel.png": { hash: "pnghash", width: 1, height: 1 } } },
      },
    ]);
    configureMetaGraph({ fetch });
    const result = parseTool(await uploadImage({ path: filePath })) as { hash: string };
    assert.equal(result.hash, "pnghash");
    assert.ok((calls[0].body?.get("bytes") ?? "").length > 20);
    assert.equal(calls[0].body?.get("name"), "pixel.png");
  });

  it("creates a creative with UTMs and a paused ad", async () => {
    const { fetch, calls } = mockFetch([
      { method: "POST", match: "/act_111/adcreatives", response: { id: "cr_1" } },
      { method: "POST", match: "/act_111/ads", response: { id: "ad_1" } },
    ]);
    configureMetaGraph({ fetch });
    const creative = parseTool(
      await createAdCreative({
        name: "Homepage",
        link: "https://example.com/",
        message: "Open a pay-by-bank account",
        headline: "Pay from your bank",
        description: "No card needed",
        image_hash: "abc123",
        url_tags: "utm_source=meta&utm_medium=paid&utm_campaign=leads",
      }),
    ) as { creative_id: string };
    assert.equal(creative.creative_id, "cr_1");
    const spec = JSON.parse(calls[0].body?.get("object_story_spec") ?? "{}");
    assert.equal(spec.page_id, "page-1");
    assert.equal(spec.link_data.image_hash, "abc123");
    assert.equal(calls[0].body?.get("url_tags"), "utm_source=meta&utm_medium=paid&utm_campaign=leads");

    const ad = parseTool(await createAd({ name: "Ad 1", ad_set_id: "set_1", creative_id: "cr_1" })) as {
      ad_id: string;
      status: string;
    };
    assert.equal(ad.ad_id, "ad_1");
    assert.match(ad.status, /PAUSED/);
    assert.equal(calls[1].body?.get("status"), "PAUSED");
    assert.equal(JSON.parse(calls[1].body?.get("creative") ?? "{}").creative_id, "cr_1");
  });

  it("updates ad copy by creating a replacement creative", async () => {
    const { fetch, calls } = mockFetch([
      {
        match: /\/ad_9$/,
        response: {
          name: "Ad 1",
          creative: {
            id: "cr_old",
            url_tags: "utm_source=meta",
            object_story_spec: {
              page_id: "page-1",
              link_data: {
                link: "https://example.com/",
                message: "Old",
                name: "Old headline",
                image_hash: "abc123",
                call_to_action: { type: "LEARN_MORE" },
              },
            },
          },
        },
      },
      { method: "POST", match: "/act_111/adcreatives", response: { id: "cr_new" } },
      { method: "POST", match: /\/ad_9$/, response: { success: true } },
    ]);
    configureMetaGraph({ fetch });
    const result = parseTool(await updateAd({ ad_id: "ad_9", message: "New primary text" })) as {
      creative_id: string;
    };
    assert.equal(result.creative_id, "cr_new");
    const spec = JSON.parse(calls[1].body?.get("object_story_spec") ?? "{}");
    assert.equal(spec.link_data.message, "New primary text");
    assert.equal(spec.link_data.name, "Old headline");
    assert.equal(JSON.parse(calls[2].body?.get("creative") ?? "{}").creative_id, "cr_new");
    assert.equal(calls[2].body?.get("status"), null);
  });

  it("set_campaign_status is the explicit ACTIVE switch", async () => {
    const { fetch, calls } = mockFetch([{ method: "POST", match: /\/cmp_1$/, response: { success: true } }]);
    configureMetaGraph({ fetch });
    const result = parseTool(await setCampaignStatus({ campaign_id: "cmp_1", status: "ACTIVE" })) as {
      spend: string;
    };
    assert.match(result.spend, /^on/);
    assert.equal(calls[0].body?.get("status"), "ACTIVE");
  });

  it("copy_campaign always sends status_option PAUSED", async () => {
    const { fetch, calls } = mockFetch([
      { method: "POST", match: "/cmp_1/copies", response: { copied_campaign_id: "cmp_2" } },
    ]);
    configureMetaGraph({ fetch });
    const result = parseTool(await copyCampaign({ campaign_id: "cmp_1" })) as { copied_campaign_id: string };
    assert.equal(result.copied_campaign_id, "cmp_2");
    assert.equal(calls[0].body?.get("status_option"), "PAUSED");
  });

  it("compacts insights including actions and day breakdown", async () => {
    const { fetch, calls } = mockFetch([
      {
        match: "/cmp_1/insights",
        response: {
          data: [
            {
              campaign_id: "cmp_1",
              campaign_name: "UK leads",
              date_start: "2026-10-01",
              date_stop: "2026-10-01",
              spend: "12.50",
              impressions: "1000",
              reach: "800",
              clicks: "40",
              ctr: "4.0",
              cpc: "0.31",
              cpm: "12.50",
              actions: [
                { action_type: "link_click", value: "40" },
                { action_type: "landing_page_view", value: "22" },
                { action_type: "offsite_conversion.fb_pixel_complete_registration", value: "3" },
              ],
              cost_per_action_type: [
                { action_type: "offsite_conversion.fb_pixel_complete_registration", value: "4.17" },
              ],
            },
          ],
        },
      },
    ]);
    configureMetaGraph({ fetch });
    const result = parseTool(
      await getInsights({ level: "campaign", object_id: "cmp_1", breakdowns: ["day"], since: "2026-10-01", until: "2026-10-07" }),
    ) as { rows: Array<Record<string, unknown>> };
    const row = result.rows[0];
    assert.equal(row.spend, 12.5);
    const actions = row.actions as Record<string, number>;
    assert.equal(actions.complete_registration, 3);
    assert.equal(actions.landing_page_view, 22);
    assert.equal(calls[0].search.get("time_increment"), "1");
    assert.ok(calls[0].search.get("time_range")?.includes("2026-10-01"));
  });

  it("returns review feedback for an ad", async () => {
    const { fetch } = mockFetch([
      {
        match: /\/ad_1$/,
        response: {
          id: "ad_1",
          name: "Ad 1",
          status: "PAUSED",
          effective_status: "DISAPPROVED",
          issues_info: [{ error_code: 1815869, error_summary: "Creative rejected" }],
          ad_review_feedback: { global: { "PROHIBITED_PRODUCT": "..." } },
        },
      },
    ]);
    configureMetaGraph({ fetch });
    const result = parseTool(await getAdStatus({ ad_id: "ad_1" })) as { effective_status: string };
    assert.equal(result.effective_status, "DISAPPROVED");
  });

  it("compacts insight action aliases", () => {
    const row = compactInsightsRow({
      campaign_id: "1",
      campaign_name: "n",
      spend: "1",
      impressions: "10",
      reach: "8",
      clicks: "2",
      ctr: "20",
      cpc: "0.5",
      cpm: "100",
      actions: [{ action_type: "offsite_conversion.fb_pixel_lead", value: "5" }],
      cost_per_action_type: [{ action_type: "offsite_conversion.fb_pixel_lead", value: "2" }],
    });
    assert.equal((row.actions as Record<string, number>).lead, 5);
    assert.equal((row.cost_per_action as Record<string, number>).lead, 2);
  });

  it("puts UTM tags and CTA on the creative body helper", () => {
    const body = buildLinkCreativeBody({
      name: "c",
      page_id: "p",
      link: "https://example.com/x",
      message: "hi",
      headline: "H",
      image_hash: "h",
      cta_type: "SIGN_UP",
      url_tags: "utm_source=meta",
    });
    const spec = body.object_story_spec as { link_data: { call_to_action: { type: string } } };
    assert.equal(spec.link_data.call_to_action.type, "SIGN_UP");
    assert.equal(body.url_tags, "utm_source=meta");
    assert.equal(toMinorUnits(20), "2000");
  });
});
