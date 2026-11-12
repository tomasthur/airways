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

/** Public GET row for the best-airlines board (cash minus crash penalties). */
export interface LeaderboardRow {
  rank: number;
  airline: string;
  flights: number;
  crashes: number;
  losses: number;
  cash: number;
  score: number;
}

let client: ConvexHttpClient | null | undefined;
let pushInFlight = false;
let pushAgain = false;

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
  void pushPlayerToConvex(next, 'stats');
}

/**
 * POST the player row to Convex.
 * `upsert` is registration (full document). `stats` is the post-flight / cash update.
 */
export async function pushPlayerToConvex(
  record: PlayerRecord,
  mode: 'upsert' | 'stats' = 'upsert',
): Promise<void> {
  localStorage.setItem(PENDING_KEY, JSON.stringify({ record, mode }));
  await drainPending();
}

async function drainPending(): Promise<void> {
  const convex = convexClient();
  if (!convex) return;
  if (pushInFlight) {
    pushAgain = true;
    return;
  }
  pushInFlight = true;
  try {
    do {
      pushAgain = false;
      const queued = readPending();
      if (!queued) return;
      const { record, mode } = queued;
      try {
        if (mode === 'stats') {
          const id = await convex.mutation(api.players.updateStats, {
            playerId: record.playerId,
            flights: record.flights,
            crashes: record.crashes,
            losses: record.losses,
            cash: record.cash,
          });
          if (!id) await convex.mutation(api.players.upsert, record);
        } else {
          await convex.mutation(api.players.upsert, record);
        }
        if (!pushAgain) localStorage.removeItem(PENDING_KEY);
      } catch {
        return;
      }
    } while (pushAgain);
  } finally {
    pushInFlight = false;
  }
}

function readPending(): { record: PlayerRecord; mode: 'upsert' | 'stats' } | null {
  const raw = localStorage.getItem(PENDING_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { record?: PlayerRecord; mode?: string } & Partial<PlayerRecord>;
    if (parsed.record?.playerId) {
      return { record: parsed.record, mode: parsed.mode === 'stats' ? 'stats' : 'upsert' };
    }
    if (parsed.playerId && parsed.airline && parsed.email) {
      return { record: parsed as PlayerRecord, mode: 'upsert' };
    }
  } catch {
    /* drop corrupt queue */
  }
  localStorage.removeItem(PENDING_KEY);
  return null;
}

/** Retry a queued POST after a reload. */
export function flushPendingPlayer(): void {
  const queued = readPending();
  if (queued) {
    void pushPlayerToConvex(queued.record, queued.mode);
    return;
  }
  const player = loadPlayer();
  if (player) void pushPlayerToConvex(player, 'stats');
}

export function registerPlayer(airline: string, email: string, stats: CareerStats): PlayerRecord {
  const record = makePlayerRecord(airline, email, stats);
  savePlayer(record);
  void pushPlayerToConvex(record, 'upsert');
  return record;
}

/** GET the score-ranked leaderboard. Empty if Convex is unreachable. */
export async function fetchLeaderboard(limit = 20): Promise<LeaderboardRow[]> {
  const convex = convexClient();
  if (!convex) return [];
  try {
    const rows = await convex.query(api.players.listLeaderboard, { limit });
    return rows.map((row, i) => ({
      ...row,
      rank: row.rank ?? i + 1,
      score: row.score ?? row.cash - row.crashes * 10_000 - row.losses * 1_000,
    }));
  } catch {
    return [];
  }
}
