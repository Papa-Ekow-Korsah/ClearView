import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

/**
 * Route-level tests for POST /api/analyze: auth gating, input validation,
 * and rate-limit handling. External services are mocked — the pipeline
 * itself is exercised against the live app during development.
 */

const mocks = vi.hoisted(() => ({
  requireOwner: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock("@/lib/auth/guard", () => ({
  requireOwner: mocks.requireOwner,
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  ANALYZE_LIMIT: { limit: 10, windowMs: 3_600_000 },
}));
vi.mock("@/lib/db/client", () => ({ db: vi.fn() }));
vi.mock("@/lib/finnhub", () => ({
  getQuote: vi.fn(),
  getProfile: vi.fn(),
  getMetrics: vi.fn(),
  getPeerSymbols: vi.fn(),
  getRecentNews: vi.fn(),
  isUnknownTicker: vi.fn(),
  FinnhubError: class extends Error {},
}));
vi.mock("@/lib/anthropic", () => ({
  generateAiNote: vi.fn(),
  AnalysisGenerationError: class extends Error {},
}));

import { POST } from "@/app/api/analyze/route";

function request(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/analyze", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireOwner.mockResolvedValue(null); // authed by default
  mocks.checkRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 9,
    resetAt: new Date(),
  });
});

describe("POST /api/analyze", () => {
  it("rejects unauthenticated callers with 401", async () => {
    mocks.requireOwner.mockResolvedValue(
      NextResponse.json({ error: "Sign in required." }, { status: 401 })
    );
    const res = await POST(request({ ticker: "AAPL" }));
    expect(res.status).toBe(401);
  });

  it("rejects malformed tickers with 400", async () => {
    for (const bad of ["", "TOOLONG7", "AA-PL", "123", "aapl!"]) {
      const res = await POST(request({ ticker: bad }));
      expect(res.status, `ticker: "${bad}"`).toBe(400);
    }
  });

  it("rejects non-JSON bodies with 400", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/analyze", {
        method: "POST",
        body: "not json",
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns 429 with a reset hint when rate limited", async () => {
    mocks.checkRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: new Date(Date.now() + 30 * 60 * 1000),
    });
    const res = await POST(request({ ticker: "AAPL" }));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toMatch(/limit/i);
    expect(body.error).toMatch(/min/i);
  });

  it("does not rate-limit-check before validating input", async () => {
    await POST(request({ ticker: "not-a-ticker" }));
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
  });
});
