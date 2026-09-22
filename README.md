# ads-mcp

An MCP server wrapping the Google Ads API and Meta Marketing API directly, with no third-party quota or middleman. Point an MCP-compatible client at it and manage Search campaigns, keywords, ads and Meta ad review status straight against Google's and Meta's own APIs.

Every write tool that could spend money is safe by default: `google_ads_create_search_campaign` always creates campaigns `PAUSED`, and the only tools that can turn spend on are `google_ads_set_campaign_status` / `meta_ads_set_campaign_status`, called explicitly.

## Setup

Credentials require logins and business identity only you have; nothing here can be automated.

### Google Ads

1. **Google Cloud project + OAuth client**: console.cloud.google.com, new (or existing) project, APIs & Services, Credentials, Create OAuth client ID (type: Desktop app). Copy the Client ID/Secret into `.env`.
2. Under that OAuth client, add `http://localhost:8787/oauth2callback` as an authorized redirect URI.
3. **Developer token**: ads.google.com/aw/apicenter, apply for a token. Basic access is free and usually approved within a few days; it allows ~15,000 operations/day. Put it in `.env` as `GOOGLE_ADS_DEVELOPER_TOKEN`.
4. Run `pnpm install` then `pnpm google:auth`, this opens a browser, you sign in and consent, and it prints a refresh token to paste into `.env` as `GOOGLE_ADS_REFRESH_TOKEN`.
5. Set `GOOGLE_ADS_CUSTOMER_ID` to the 10-digit account ID (no dashes) these tools should operate on by default. If that account is managed under an MCC account, also set `GOOGLE_ADS_LOGIN_CUSTOMER_ID` to the MCC's ID.

### Meta Ads

1. **Meta App**: developers.facebook.com, My Apps, Create App (type: Business). Copy the App ID/Secret from Settings, Basic into `.env`.
2. Request the `ads_management` permission under App Review. This needs **Business Verification** (documents proving the business is real) and usually a short screen-recording demo of the exact use case. This step is slow, budget for weeks, not days.
3. Once approved, generate a long-lived System User access token (Business Settings, System Users) with `ads_management` scope on the ad account, and put it in `.env` as `META_ACCESS_TOKEN`.
4. Set `META_AD_ACCOUNT_ID` to the numeric account ID (no `act_` prefix needed, the client adds it).

## Running

```bash
pnpm install
pnpm dev        # runs the MCP server over stdio via tsx, for local testing
pnpm build && pnpm start   # compiled version
```

Point an MCP-compatible client (e.g. Claude Code's `.mcp.json`) at `node /path/to/ads-mcp/dist/index.js` once built, or at `pnpm dev` in this directory for local iteration.

## First real run: verify before trusting it

The Google Ads and Meta Marketing APIs both shift field/enum names across versions, so before relying on any tool here for real campaign work:

1. Run `google_ads_list_campaigns` / `meta_ads_list_campaigns` first, read-only, the cheapest way to confirm auth and the client libraries are wired correctly.
2. Test `google_ads_create_search_campaign` on a throwaway campaign name, then check it directly in the Google Ads UI rather than trusting the tool's own response as proof of correctness.
3. Only after that, use it for real campaign work.

## Tool reference

**Google Ads** (`src/google-ads/tools.ts`): `list_campaigns`, `get_campaign_structure`, `create_search_campaign` (always PAUSED), `add_keywords`, `set_keyword_status` (pause/enable, reversible), `remove_keywords` (permanent, requires `confirm_delete: true`), `update_bid_strategy`, `add_negative_keywords`, `set_campaign_status` (the only enable/spend switch).

**Meta Ads** (`src/meta-ads/tools.ts`): `list_campaigns`, `get_ad_status` (pulls `ad_review_feedback`/`issues_info`, the actual rejection reason for a disapproved ad), `list_ads_by_status` (e.g. pull every `DISAPPROVED` ad in one call), `set_campaign_status` (the only enable/spend switch).

## License

MIT, see [LICENSE](LICENSE).
