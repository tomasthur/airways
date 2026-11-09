import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  players: defineTable({
    playerId: v.string(),
    airline: v.string(),
    email: v.string(),
    flights: v.number(),
    crashes: v.number(),
    losses: v.number(),
    cash: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_playerId', ['playerId'])
    .index('by_email', ['email'])
    .index('by_flights', ['flights']),
});
