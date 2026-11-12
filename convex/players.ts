import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

/** Leaderboard score: cash minus crash and fatality penalties. */
const CRASH_PENALTY = 10_000;
const LOSS_PENALTY = 1_000;

function careerScore(cash: number, crashes: number, losses: number): number {
  return cash - crashes * CRASH_PENALTY - losses * LOSS_PENALTY;
}

const playerFields = {
  playerId: v.string(),
  airline: v.string(),
  email: v.string(),
  flights: v.number(),
  crashes: v.number(),
  losses: v.number(),
  cash: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
};

/** Insert or update one airline so the leaderboard always has live career stats. */
export const upsert = mutation({
  args: playerFields,
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('players')
      .withIndex('by_playerId', (q) => q.eq('playerId', args.playerId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        airline: args.airline,
        email: args.email,
        flights: args.flights,
        crashes: args.crashes,
        losses: args.losses,
        cash: args.cash,
        updatedAt: args.updatedAt,
      });
      return existing._id;
    }
    return await ctx.db.insert('players', args);
  },
});

/**
 * POST after every hop / purchase: refresh flights, crashes, losses and cash.
 * Returns null if that playerId has not registered yet.
 */
export const updateStats = mutation({
  args: {
    playerId: v.string(),
    flights: v.number(),
    crashes: v.number(),
    losses: v.number(),
    cash: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('players')
      .withIndex('by_playerId', (q) => q.eq('playerId', args.playerId))
      .unique();
    if (!existing) return null;
    await ctx.db.patch(existing._id, {
      flights: args.flights,
      crashes: args.crashes,
      losses: args.losses,
      cash: args.cash,
      updatedAt: Date.now(),
    });
    return existing._id;
  },
});

/** GET the best airlines by career score. Email stays private. */
export const listLeaderboard = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(50, Math.max(1, args.limit ?? 20));
    const all = await ctx.db.query('players').collect();
    const scored = all
      .map((p) => ({
        airline: p.airline,
        flights: p.flights,
        crashes: p.crashes,
        losses: p.losses,
        cash: p.cash,
        score: careerScore(p.cash, p.crashes, p.losses),
      }))
      .sort((a, b) => b.score - a.score || b.cash - a.cash || b.flights - a.flights);
    return scored.slice(0, limit).map((p, i) => ({ rank: i + 1, ...p }));
  },
});
