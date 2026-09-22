import bizSdk from "facebook-nodejs-business-sdk";

const { FacebookAdsApi, AdAccount } = bizSdk;

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env and fill in Meta Ads credentials — ` +
        `see README.md for the Meta App + App Review setup steps.`,
    );
  }
  return value;
}

let initialized = false;

function ensureInit(): void {
  if (!initialized) {
    FacebookAdsApi.init(required("META_ACCESS_TOKEN"));
    initialized = true;
  }
}

/**
 * Returns an AdAccount client. `accountId` defaults to META_AD_ACCOUNT_ID
 * and should never include the "act_" prefix — this adds it.
 */
export function getAdAccount(accountId?: string): InstanceType<typeof AdAccount> {
  ensureInit();
  const id = (accountId ?? required("META_AD_ACCOUNT_ID")).replace(/^act_/, "");
  return new AdAccount(`act_${id}`);
}
