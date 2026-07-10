/**
 * Central env access. Server-only — never import from client components.
 * Each accessor throws a descriptive error at call time so a missing var
 * fails the one feature that needs it, with a message that says what to set.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Add it to .env.local (see .env.example).`
    );
  }
  return value;
}

export const config = {
  get anthropicApiKey() {
    return required("ANTHROPIC_API_KEY");
  },
  get anthropicModel() {
    return process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";
  },
  get finnhubApiKey() {
    return required("FINNHUB_API_KEY");
  },
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  get appPasswordHash() {
    return required("APP_PASSWORD_HASH");
  },
  get sessionSecret() {
    return required("SESSION_SECRET");
  },
};
