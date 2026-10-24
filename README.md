# ads-mcp

An MCP server wrapping the Google Ads API and Meta Marketing API directly, with no third-party quota or middleman. Point an MCP-compatible client at it and manage Search campaigns, keywords, ads, and the full Meta campaign lifecycle (create, publish, monitor, report) against Google's and Meta's own APIs.

Every write tool that could spend money is safe by default: `google_ads_create_search_campaign` and every Meta create/copy tool always create objects `PAUSED`. The only tools that can turn spend on are `google_ads_set_campaign_status` and `meta_ads_set_campaign_status` / `meta_ads_set_ad_set_status` / `meta_ads_set_ad_status`, called explicitly.

## Setup

Credentials require logins and business identity only you have; nothing here can be automated. Do not commit `.env`.

### Google Ads

1. **Google Cloud project + OAuth client**: console.cloud.google.com, new (or existing) project, APIs & Services, Credentials, Create OAuth client ID (type: Desktop app). Copy the Client ID/Secret into `.env`.
2. Under that OAuth client, add `http://localhost:8787/oauth2callback` as an authorized redirect URI.
3. **Developer token**: ads.google.com/aw/apicenter, apply for a token. Basic access is free and usually approved within a few days; it allows ~15,000 operations/day. Put it in `.env` as `GOOGLE_ADS_DEVELOPER_TOKEN`.
4. Run `pnpm install` then `pnpm google:auth`. This opens a browser, you sign in and consent, and it prints a refresh token to paste into `.env` as `GOOGLE_ADS_REFRESH_TOKEN`.
5. Set `GOOGLE_ADS_CUSTOMER_ID` to the 10-digit account ID (no dashes) these tools should operate on by default. If that account is managed under an MCC account, also set `GOOGLE_ADS_LOGIN_CUSTOMER_ID` to the MCC's ID.

### Meta Ads (System User token)

A personal user token dies when Facebook shows a login checkpoint (Graph error `190` / subcode `459`). A Business Manager System User token is the supported way to keep Marketing API access independent of a person's browser session.

1. **Meta App**: [developers.facebook.com](https://developers.facebook.com), My Apps, Create App (type: Business). Copy the App ID and App Secret from Settings > Basic into `.env` as `META_APP_ID` / `META_APP_SECRET`.
2. **Business Manager**: open [business.facebook.com](https://business.facebook.com) > Business Settings.
3. **Create a System User**: Users > System Users > Add. Admin is simplest for ad account + Page + pixel assignment. Name it something like `ads-mcp`.
4. **Assign assets** to that System User (Add Assets):
   - Ad account: allow manage campaigns (or full control).
   - Facebook Page used in creatives: allow create content / manage ads (or full control).
   - Pixel used for optimization: allow advertise.
5. **Generate a token**: on the System User, Generate New Token. Select the app from step 1. Request at least:
   - `ads_management`
   - `ads_read`
   - `business_management`
   - `pages_show_list`
   - `pages_read_engagement`
   - `pages_manage_ads` (needed to create unpublished Page posts / link creatives)
   Choose a never-expiring token if the UI offers it.
6. Put the token in `.env` as `META_ACCESS_TOKEN`. Never commit it.
7. Set `META_AD_ACCOUNT_ID` to the numeric account ID (`act_` prefix optional). Optionally set `META_PAGE_ID` and `META_PIXEL_ID` so create tools do not need them on every call.
8. Optional: `META_GRAPH_API_VERSION` pins the Graph version. Default is `v26.0`.

**App Review / Development mode.** If the app, ad account, Page and pixel all belong to the same Business, a System User token usually works while the app is in Development mode (Standard Access) without App Review. Advanced Access and App Review are required to manage *other* businesses' ad accounts, or when the app is Live and those permissions are restricted. `ads_management` and the `pages_*` permissions are the ones Meta most often holds behind review.

Housing, employment, credit, and (in some regions) financial products and services ads must set `special_ad_categories` accordingly (`HOUSING`, `EMPLOYMENT`, `CREDIT`, `FINANCIAL_PRODUCTS_SERVICES`). Those campaigns have extra targeting limits; Advantage+ may be required or forbidden depending on the category.

Call `meta_ads_get_account` first. If `META_APP_ID` and `META_APP_SECRET` are set, the response includes token debug (scopes, expiry).

#### Graph errors this server rewrites

| Code | Typical cause | What to do |
| --- | --- | --- |
| `190` / `102` | Token expired, revoked, or invalid | Generate a new System User token |
| `190` + subcode `459`, or code `459` | User checkpoint | Complete the Facebook login checkpoint, then switch to a System User token |
| `10`, `200`-`299` | Missing permission or asset assignment | Assign the ad account / Page / pixel; add the scopes above; App Review if Live or cross-business |
| `100` + `error_user_title` / `error_user_msg` | Invalid field or ads policy rejection | Fix the field or creative. Policy rejects cannot be overridden via the API |
| `4` / `17` / `32` / `613` | Rate limit | Wait and retry |
| `368` | Temporary policy block | Check Business Support Home and the account Quality tab |

## Running

```bash
pnpm install
pnpm test
pnpm dev        # MCP server over stdio via tsx
pnpm build && pnpm start   # compiled version
```

Once published to npm, it also runs via `npx @gudlab/ads-mcp`, no local clone needed. Point an MCP-compatible client at it, e.g. in Claude Code's `.mcp.json`:

```json
{
  "mcpServers": {
    "ads-mcp": {
      "command": "npx",
      "args": ["-y", "@gudlab/ads-mcp"],
      "env": {
        "GOOGLE_ADS_CLIENT_ID": "...",
        "GOOGLE_ADS_CLIENT_SECRET": "...",
        "GOOGLE_ADS_DEVELOPER_TOKEN": "...",
        "GOOGLE_ADS_REFRESH_TOKEN": "...",
        "GOOGLE_ADS_CUSTOMER_ID": "...",
        "META_APP_ID": "...",
        "META_APP_SECRET": "...",
        "META_ACCESS_TOKEN": "...",
        "META_AD_ACCOUNT_ID": "...",
        "META_PAGE_ID": "...",
        "META_PIXEL_ID": "..."
      }
    }
  }
}
```

Before that's published, point it at the local build instead: `command: "node"`, `args: ["/path/to/ads-mcp/dist/index.js"]`, or `command: "pnpm"`, `args: ["dev"]` with `cwd` set to this directory for local iteration.

## First real run: verify before trusting it

The Google Ads and Meta Marketing APIs both shift field/enum names across versions, so before relying on any tool here for real campaign work:

1. Run `google_ads_list_campaigns` / `meta_ads_get_account` / `meta_ads_list_campaigns` first, read-only, the cheapest way to confirm auth and the client libraries are wired correctly.
2. Test `google_ads_create_search_campaign` or `meta_ads_create_campaign` on a throwaway name, then check it in the ads UI rather than trusting the tool's own response as proof of correctness.
3. Only after that, use `*_set_*_status` with `ACTIVE` on a real campaign.

## End-to-end Meta example (always paused until the last step)

Budgets are in the ad account currency (e.g. `20` means 20 GBP, sent to Graph as `2000` minor units).

```text
1. meta_ads_get_account
     Confirm the token is valid and the account currency / timezone.

2. meta_ads_search_targeting
     { "q": "online shopping", "type": "interest" }
     Copy an interest id from the results. Some detailed interests have been retired by Meta; try a broader query or type=behavior if this is empty.

3. meta_ads_estimate_audience
     { "targeting": { "countries": ["GB"], "age_min": 25, "age_max": 54, "interests": [{ "id": "6003139266461" }] },
       "optimization_goal": "OFFSITE_CONVERSIONS" }

4. meta_ads_create_campaign
     { "name": "UK leads - paused",
       "objective": "OUTCOME_LEADS",
       "special_ad_categories": [] }
     Returns campaign_id. Status is PAUSED.

5. meta_ads_create_ad_set
     { "campaign_id": "<campaign_id>",
       "name": "GB 25-54 shopping",
       "daily_budget": 15,
       "optimization_goal": "OFFSITE_CONVERSIONS",
       "billing_event": "IMPRESSIONS",
       "custom_event_type": "COMPLETE_REGISTRATION",
       "advantage_audience": false,
       "targeting": {
         "countries": ["GB"],
         "age_min": 25,
         "age_max": 54,
         "interests": [{ "id": "6003139266461", "name": "Online shopping" }]
       } }
     Advantage+ audience is off (`targeting_automation.advantage_audience = 0`). Status is PAUSED.

6. meta_ads_upload_image
     { "url": "https://example.com/ads/hero.jpg" }
     or { "path": "/absolute/path/hero.jpg" }
     Returns hash.

7. meta_ads_create_ad_creative
     { "name": "Homepage v1",
       "link": "https://example.com/?utm_source=meta",
       "message": "Open an account from your banking app.",
       "headline": "Pay from your bank",
       "description": "No card needed.",
       "image_hash": "<hash>",
       "cta_type": "LEARN_MORE",
       "url_tags": "utm_source=meta&utm_medium=paid&utm_campaign=uk_leads" }

8. meta_ads_create_ad
     { "name": "Ad 1", "ad_set_id": "<ad_set_id>", "creative_id": "<creative_id>" }
     Status is PAUSED. Still no spend.

9. Activate spend, in this order (or campaign last):
     meta_ads_set_ad_status          { "ad_id": "<ad_id>", "status": "ACTIVE" }
     meta_ads_set_ad_set_status      { "ad_set_id": "<ad_set_id>", "status": "ACTIVE" }
     meta_ads_set_campaign_status    { "campaign_id": "<campaign_id>", "status": "ACTIVE" }

10. meta_ads_get_ad_status
      Review / rejection lives in ad_review_feedback and issues_info.

11. meta_ads_get_insights
      { "level": "campaign", "object_id": "<campaign_id>", "date_preset": "last_7d" }
      Optional: "breakdowns": ["age", "gender", "placement", "day"]
      or "since": "2026-10-01", "until": "2026-10-07"
```

## Tool reference

**Google Ads** (`src/google-ads/tools.ts`): `list_campaigns`, `get_campaign_structure`, `create_search_campaign` (always PAUSED), `add_keywords`, `set_keyword_status` (pause/enable, reversible), `remove_keywords` (permanent, requires `confirm_delete: true`), `update_bid_strategy`, `add_negative_keywords`, `set_campaign_status` (the only enable/spend switch).

**Meta Ads** (`src/meta-ads/tools.ts`), all names prefixed `meta_ads_`:

| Tool | Role |
| --- | --- |
| `get_account` | Ad account + optional token debug |
| `list_campaigns` / `get_campaign` / `get_campaign_structure` | Campaigns, nested ad sets and ads |
| `list_ad_sets` / `get_ad_set` | Ad sets with targeting, budgets, Advantage+ flag |
| `list_ads` / `get_ad` / `get_ad_status` / `list_ads_by_status` | Ads, creatives, `ad_review_feedback` / `issues_info` |
| `get_insights` | Account / campaign / ad set / ad metrics, presets or custom dates, optional breakdowns |
| `search_targeting` | Keyword search for interests, behaviours, geo |
| `estimate_audience` | Delivery / reach estimate |
| `create_campaign` / `update_campaign` | Objective, `special_ad_categories`, campaign or ad-set budget. Create is PAUSED |
| `create_ad_set` / `update_ad_set` | Daily budget, optimization, pixel+event, manual targeting, Advantage+ off by default. Create is PAUSED |
| `upload_image` | Local path or URL → image hash |
| `create_ad_creative` | Page, link, primary text, headline, description, CTA, `url_tags` |
| `create_ad` / `update_ad` | Attach a creative or replace copy. Create is PAUSED |
| `set_campaign_status` / `set_ad_set_status` / `set_ad_status` | Explicit `ACTIVE` / `PAUSED`. The only spend switches |
| `copy_campaign` / `copy_ad_set` / `copy_ad` | Duplicates, always PAUSED |

## Privacy and data handling

All credentials stay in your own `.env` (never committed, see `.gitignore`) or your MCP client's own env config, and are used only to call Google's and Meta's APIs directly from your machine. This server sends nothing to any third party: no telemetry, no analytics, no relay service. Every request goes straight from your process to `googleads.googleapis.com` or `graph.facebook.com`, using your own developer token and access token.

## License

MIT, see [LICENSE](LICENSE).
