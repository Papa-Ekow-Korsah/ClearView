import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireOwner } from "@/lib/auth/guard";
import { config } from "@/lib/config";
import { blockedDomains } from "@/lib/source-credibility";

// TEMPORARY: web search returns nothing in production and lib/websearch.ts
// swallows the reason. Surface the raw error. Owner-only; delete once fixed.
export const maxDuration = 120;

export async function GET() {
  const denied = await requireOwner();
  if (denied) return denied;

  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const t0 = Date.now();

  try {
    const res = await client.messages.create(
      {
        model: config.anthropicModel,
        max_tokens: 1024,
        tools: [
          {
            type: "web_search_20260209",
            name: "web_search",
            max_uses: 2,
            blocked_domains: blockedDomains(),
          },
        ],
        messages: [
          {
            role: "user",
            content:
              "What is the current consensus analyst rating for Marvell Technology (MRVL)? Reply in one short line and include the source URL.",
          },
        ],
      },
      { timeout: 90_000 }
    );

    return NextResponse.json({
      ok: true,
      ms: Date.now() - t0,
      model: res.model,
      stop_reason: res.stop_reason,
      blockTypes: res.content.map((b) => b.type),
      text: res.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { text: string }).text)
        .join("\n")
        .slice(0, 500),
      usage: res.usage,
    });
  } catch (err) {
    const e = err as { name?: string; status?: number; message?: string };
    return NextResponse.json({
      ok: false,
      ms: Date.now() - t0,
      name: e?.name,
      status: e?.status,
      message: e?.message?.slice(0, 600),
    });
  }
}
