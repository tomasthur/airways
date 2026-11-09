import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../convex/_generated/api';

const PROFILE_KEY = 'airways.player.v1';
const PENDING_KEY = 'airways.player.pending';

/**
 * Document shape for the Convex `players` table.
 * One row per airline — flights / crashes / losses / cash feed the leaderboard.
 */
export interface PlayerRecord {
  playerId: string;
  airline: string;
  email: string;
  flights: number;
  crashes: number;
  losses: number;
  cash: number;
  createdAt: number;
  updatedAt: number;
}

export interface CareerStats {
  flights: number;
  crashes: number;
  losses: number;
  cash: number;
}

let client: ConvexHttpClient | null | undefined;

function convexClient(): ConvexHttpClient | null {
  if (client !== undefined) return client;
  const url = import.meta.env.VITE_CONVEX_URL as string | undefined;
  client = url ? new ConvexHttpClient(url) : null;
  return client;
}

export function hasPlayer(): boolean {
  return loadPlayer() !== null;
}

export function loadPlayer(): PlayerRecord | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PlayerRecord>;
    if (!parsed.playerId || !parsed.airline || !parsed.email) return null;
    return {
      playerId: parsed.playerId,
      airline: parsed.airline,
      email: parsed.email,
      flights: parsed.flights ?? 0,
      crashes: parsed.crashes ?? 0,
      losses: parsed.losses ?? 0,
      cash: parsed.cash ?? 0,
      createdAt: parsed.createdAt ?? Date.now(),
      updatedAt: parsed.updatedAt ?? Date.now(),
    };
  } catch {
    return null;
  }
}

export function savePlayer(record: PlayerRecord): void {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(record));
}

/** Build the JSON that Convex stores, seeded from current career stats. */
export function makePlayerRecord(airline: string, email: string, stats: CareerStats): PlayerRecord {
  const now = Date.now();
  return {
    playerId: crypto.randomUUID(),
    airline: airline.trim(),
    email: email.trim().toLowerCase(),
    flights: stats.flights,
    crashes: stats.crashes,
    losses: stats.losses,
    cash: stats.cash,
    createdAt: now,
    updatedAt: now,
  };
}

/** Keep the queued player row in sync with career stats after each hop / purchase. */
export function applyPlayerStats(stats: CareerStats): void {
  const player = loadPlayer();
  if (!player) return;
  if (
    player.flights === stats.flights &&
    player.crashes === stats.crashes &&
    player.losses === stats.losses &&
    player.cash === stats.cash
  ) {
    return;
  }
  const next: PlayerRecord = { ...player, ...stats, updatedAt: Date.now() };
  savePlayer(next);
  void pushPlayerToConvex(next);
}

/** Upsert the player row; keep a local queue if Convex is unreachable. */
export async function pushPlayerToConvex(record: PlayerRecord): Promise<void> {
  localStorage.setItem(PENDING_KEY, JSON.stringify(record));
  const convex = convexClient();
  if (!convex) return;
  try {
    await convex.mutation(api.players.upsert, record);
    localStorage.removeItem(PENDING_KEY);
  } catch {
    // Stay queued until the next save.
  }
}

/** Retry a queued upsert after a reload. */
export function flushPendingPlayer(): void {
  const player = loadPlayer();
  if (player) void pushPlayerToConvex(player);
}

export function registerPlayer(airline: string, email: string, stats: CareerStats): PlayerRecord {
  const record = makePlayerRecord(airline, email, stats);
  savePlayer(record);
  void pushPlayerToConvex(record);
  return record;
}
