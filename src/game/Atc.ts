import type { StormCell, Weather } from '../sim/Weather';

export interface AtcMessage {
  station: string;
  text: string;
  /** Pilot replies offered; empty = information only. */
  replies: string[];
  /** Seconds the message stays up without a reply. */
  ttl: number;
  onReply?: (index: number) => void;
}

export interface AtcContext {
  phase: 'preflight' | 'takeoff' | 'airborne' | 'rollout';
  engineRunning: boolean;
  x: number;
  y: number;
  groundSpeed: number;
  /** Best sustained climb rate the aircraft can manage right now (m/s). */
  climbRate: number;
  toAim: number;
  time: number;
  originCity: string;
  destCity: string;
  originRunway: string;
  destRunway: string;
}

const CALLSIGN = 'OM-BTV';
const round50 = (v: number) => Math.round(v / 50) * 50;

/** Rule-based ATC: take-off and landing clearances, weather advisories with altitude recommendations. */
export class Atc {
  current: AtcMessage | null = null;
  /** Altitude the pilot accepted from ATC, if any. */
  assignedAltitude: number | null = null;
  /** Storm cells the pilot was warned about and how they replied. */
  readonly advisories = new Map<StormCell, 'accepted' | 'declined' | 'info'>();
  private readonly queue: AtcMessage[] = [];
  private readonly said = new Set<string>();
  private timer = 0;
  private deviationTimer = 0;
  private lastDeviationCall = -999;
  private weather: Weather | null = null;

  reset(weather: Weather): void {
    this.weather = weather;
    this.current = null;
    this.queue.length = 0;
    this.said.clear();
    this.advisories.clear();
    this.assignedAltitude = null;
    this.timer = 0;
    this.deviationTimer = 0;
    this.lastDeviationCall = -999;
  }

  private say(id: string, msg: AtcMessage): void {
    if (this.said.has(id)) return;
    this.said.add(id);
    this.queue.push(msg);
  }

  reply(index: number): void {
    const m = this.current;
    if (!m || index >= m.replies.length) return;
    m.onReply?.(index);
    this.current = null;
  }

  private windText(): string {
    const w = this.weather!;
    return `wind ${w.windDir.toString().padStart(3, '0')}° ${w.windKt} knots`;
  }

  update(dt: number, c: AtcContext): void {
    const w = this.weather;
    if (!w) return;

    if (this.current) {
      this.timer -= dt;
      if (this.timer <= 0) {
        // Unanswered requests count as "unable".
        if (this.current.replies.length > 1) this.current.onReply?.(this.current.replies.length - 1);
        this.current = null;
      }
    }
    if (!this.current && this.queue.length) {
      this.current = this.queue.shift()!;
      this.timer = this.current.ttl;
    }

    if (c.phase === 'takeoff' && c.engineRunning) {
      this.say('takeoff', {
        station: `${c.originCity} Tower`,
        text: `${CALLSIGN}, ${this.windText()}, runway ${c.originRunway}, cleared for take-off.`,
        replies: [],
        ttl: 7,
      });
    }

    if (c.phase !== 'airborne') return;

    if (c.y > 120) {
      const stormsAhead = w.storms.filter((s) => w.stormX(s, c.time) > c.x);
      this.say('radar', {
        station: 'Wien Radar',
        text: `${CALLSIGN}, radar contact. ${stormsAhead.length ? `${stormsAhead.length === 1 ? 'A thunderstorm is' : 'Thunderstorms are'} active along your route, expect a weather advisory.` : 'No significant weather, light turbulence.'} Climb to 350 m.`,
        replies: [],
        ttl: 8,
      });
      if (!this.said.has('radar-alt')) {
        this.said.add('radar-alt');
        this.assignedAltitude = 350;
      }
    }

    for (const cell of w.storms) {
      const cx = w.stormX(cell, c.time);
      const entry = cx - cell.radius;
      const exit = cx + cell.radius;
      const id = `storm-${cell.x0}`;
      if (!this.said.has(id) && entry - c.x < 7500 && entry - c.x > 600) this.adviseStorm(id, cell, entry, c);
      if (this.advisories.has(cell) && c.x > exit + 250) {
        this.say(`clear-${cell.x0}`, {
          station: 'Wien Radar',
          text: `${CALLSIGN}, you are clear of the weather. ${c.toAim > 6000 ? `Climb or descend at your discretion, plan your descent for ${c.destCity}.` : `Descend at your discretion for runway ${c.destRunway}.`}`,
          replies: [],
          ttl: 7,
        });
        if (this.said.has(`clear-${cell.x0}`)) this.assignedAltitude = null;
      }
    }

    // Altitude compliance once the pilot accepted an assignment.
    const a = this.assignedAltitude;
    if (a !== null && Math.abs(c.y - a) > 150) this.deviationTimer += dt;
    else this.deviationTimer = 0;
    if (a !== null && this.deviationTimer > 35 && c.time - this.lastDeviationCall > 45 && c.toAim > 6500) {
      this.lastDeviationCall = c.time;
      this.queue.push({ station: 'Wien Radar', text: `${CALLSIGN}, check altitude – assigned ${a} m.`, replies: [], ttl: 6 });
    }

    if (c.toAim < 6800) {
      this.say('landing', {
        station: `${c.destCity} Tower`,
        text: `${CALLSIGN}, ${c.destCity} Tower, ${this.windText()}, runway ${c.destRunway}, cleared to land.`,
        replies: [],
        ttl: 8,
      });
      if (this.said.has('landing')) this.assignedAltitude = null;
    }
  }

  private adviseStorm(id: string, cell: StormCell, entry: number, c: AtcContext): void {
    const km = ((entry - c.x) / 1000).toFixed(1);
    const sev = cell.severity === 'severe' ? 'Severe' : cell.severity === 'moderate' ? 'Moderate' : 'Light';
    const desc = `${sev} thunderstorm ${km} km ahead, base ${cell.base} m, tops ${cell.top} m.`;

    if (c.y > cell.top + 100) {
      this.advisories.set(cell, 'info');
      this.say(id, { station: 'Wien Radar', text: `${CALLSIGN}, ${desc} You are above the tops – maintain altitude.`, replies: [], ttl: 8 });
      return;
    }

    // Can this aircraft get above the tops before reaching the cell?
    const over = round50(cell.top + 150);
    const timeAvailable = (entry - c.x) / Math.max(c.groundSpeed, 30);
    const timeNeeded = Math.max(0, over - c.y) / Math.max(c.climbRate, 0.5);
    const canOver = over <= 1600 && timeNeeded < timeAvailable * 0.85;
    const under = round50(cell.base - 140);
    const canUnder = cell.severity !== 'severe' && under >= 180;

    const respond = (alt: number) => (i: number) => {
      if (i === 0) {
        this.assignedAltitude = alt;
        this.advisories.set(cell, 'accepted');
      } else {
        this.advisories.set(cell, 'declined');
        this.queue.push({ station: 'Wien Radar', text: `${CALLSIGN}, roger, at your discretion. Expect ${cell.severity} turbulence in the cell.`, replies: [], ttl: 6 });
      }
    };

    if (canOver) {
      this.say(id, {
        station: 'Wien Radar',
        text: `${CALLSIGN}, ${desc} Recommend climb to ${over} m to stay above it.`,
        replies: ['Wilco', 'Unable'],
        ttl: 14,
        onReply: respond(over),
      });
    } else if (canUnder) {
      this.say(id, {
        station: 'Wien Radar',
        text: `${CALLSIGN}, ${desc} You cannot top it in time – recommend descend to ${under} m below the base, expect rain and turbulence.`,
        replies: ['Wilco', 'Unable'],
        ttl: 14,
        onReply: respond(under),
      });
    } else {
      this.say(id, {
        station: 'Wien Radar',
        text: `${CALLSIGN}, ${desc} No safe altitude available in time – reduce speed below 200 km/h and expect severe turbulence and downdrafts.`,
        replies: ['Roger'],
        ttl: 12,
        onReply: () => this.advisories.set(cell, 'declined'),
      });
    }
  }
}
