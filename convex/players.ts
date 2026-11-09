import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

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

export const listLeaderboard = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(50, Math.max(1, args.limit ?? 20));
    const rows = await ctx.db.query('players').withIndex('by_flights').order('desc').take(limit);
    return rows.map((p) => ({
      airline: p.airline,
      flights: p.flights,
      crashes: p.crashes,
      losses: p.losses,
      cash: p.cash,
    }));
  },
});
