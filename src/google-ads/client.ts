import { GoogleAdsApi, type Customer } from "google-ads-api";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env and fill in Google Ads credentials, ` +
        `then run "pnpm google:auth" if GOOGLE_ADS_REFRESH_TOKEN is still empty.`,
    );
  }
  return value;
}

let cachedApi: GoogleAdsApi | null = null;

function api(): GoogleAdsApi {
  if (!cachedApi) {
    cachedApi = new GoogleAdsApi({
      client_id: required("GOOGLE_ADS_CLIENT_ID"),
      client_secret: required("GOOGLE_ADS_CLIENT_SECRET"),
      developer_token: required("GOOGLE_ADS_DEVELOPER_TOKEN"),
    });
  }
  return cachedApi;
}

/**
 * Returns a Customer client scoped to one account. `customerId` defaults to
 * GOOGLE_ADS_CUSTOMER_ID so every tool works with no args
 * unless the caller is explicitly targeting a different linked account.
 */
export function getCustomer(customerId?: string): Customer {
  const id = (customerId ?? required("GOOGLE_ADS_CUSTOMER_ID")).replace(/-/g, "");
  const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/-/g, "");
  return api().Customer({
    customer_id: id,
    login_customer_id: loginCustomerId || undefined,
    refresh_token: required("GOOGLE_ADS_REFRESH_TOKEN"),
  });
}

export const micros = (amount: number): number => Math.round(amount * 1_000_000);
export const fromMicros = (amount: number): number => amount / 1_000_000;
