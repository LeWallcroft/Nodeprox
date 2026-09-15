import { Redis } from "ioredis";
import type {
  DiscordLinkChallengeStore,
  DiscordLinkChallengeStoreClaimResult,
} from "../application/discord-gateway.service.js";

type UserPointer = { codeDigest: string; expiresAt: string };
type CodeRecord = {
  userId: string;
  state: "active" | "claimed";
  claimInteractionId?: string;
};

const keyPrefix = "nodeprox:discord-link";
const userKey = (userId: string) => `${keyPrefix}:user:${userId}`;
const codeKey = (codeDigest: string) => `${keyPrefix}:code:${codeDigest}`;

function parseJson<T>(value: unknown): T | null {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export class RedisLinkCodeStore implements DiscordLinkChallengeStore {
  private readonly redis: Redis;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
  }

  async createReplacingPrevious(input: {
    userId: string;
    codeDigest: string;
    expiresAt: Date;
    ttlSeconds: number;
  }) {
    await this.connect();
    await this.redis.eval(
      [
        "local previous = redis.call('GET', KEYS[1])",
        "if previous then",
        "  local ok, pointer = pcall(cjson.decode, previous)",
        "  if ok and pointer.codeDigest then redis.call('DEL', ARGV[1] .. pointer.codeDigest) end",
        "end",
        "redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[4])",
        "redis.call('SET', KEYS[1], ARGV[3], 'EX', ARGV[4])",
        "return 1",
      ].join("\n"),
      2,
      userKey(input.userId),
      codeKey(input.codeDigest),
      `${keyPrefix}:code:`,
      JSON.stringify({
        userId: input.userId,
        state: "active",
      } satisfies CodeRecord),
      JSON.stringify({
        codeDigest: input.codeDigest,
        expiresAt: input.expiresAt.toISOString(),
      } satisfies UserPointer),
      input.ttlSeconds,
    );
  }

  async getActiveForUser(userId: string) {
    await this.connect();
    const pointer = parseJson<UserPointer>(
      await this.redis.get(userKey(userId)),
    );
    if (!pointer?.codeDigest || !pointer.expiresAt) return null;
    return {
      codeDigest: pointer.codeDigest,
      expiresAt: new Date(pointer.expiresAt),
    };
  }

  async claim(input: { codeDigest: string; interactionId: string }) {
    await this.connect();
    const result = await this.redis.eval(
      [
        "local value = redis.call('GET', KEYS[1])",
        "if not value then return 'not_found' end",
        "local ok, record = pcall(cjson.decode, value)",
        "if not ok or not record.userId then return 'not_found' end",
        "if record.state == 'active' then",
        "  record.state = 'claimed'",
        "  record.claimInteractionId = ARGV[1]",
        "  redis.call('SET', KEYS[1], cjson.encode(record), 'KEEPTTL')",
        "  return 'claimed|' .. record.userId",
        "end",
        "if record.claimInteractionId == ARGV[1] then return 'same|' .. record.userId end",
        "return 'other'",
      ].join("\n"),
      1,
      codeKey(input.codeDigest),
      input.interactionId,
    );
    const value = typeof result === "string" ? result : "not_found";
    if (value === "not_found") return { status: "not_found" } as const;
    if (value === "other") return { status: "claimed_by_other" } as const;
    const [state, userId] = value.split("|", 2);
    if (!userId) return { status: "not_found" } as const;
    return {
      status: state === "same" ? "already_claimed_same_interaction" : "claimed",
      userId,
    } satisfies DiscordLinkChallengeStoreClaimResult;
  }

  async releaseClaim(input: { codeDigest: string; interactionId: string }) {
    await this.connect();
    await this.redis.eval(
      [
        "local value = redis.call('GET', KEYS[1])",
        "if not value then return 0 end",
        "local ok, record = pcall(cjson.decode, value)",
        "if not ok or record.state ~= 'claimed' or record.claimInteractionId ~= ARGV[1] then return 0 end",
        "record.state = 'active'",
        "record.claimInteractionId = nil",
        "redis.call('SET', KEYS[1], cjson.encode(record), 'KEEPTTL')",
        "return 1",
      ].join("\n"),
      1,
      codeKey(input.codeDigest),
      input.interactionId,
    );
  }

  async finalize(input: {
    userId: string;
    codeDigest: string;
    interactionId: string;
  }) {
    await this.connect();
    await this.redis.eval(
      [
        "local codeValue = redis.call('GET', KEYS[2])",
        "if codeValue then",
        "  local codeOk, record = pcall(cjson.decode, codeValue)",
        "  if codeOk and record.userId == ARGV[1] and record.state == 'claimed' and record.claimInteractionId == ARGV[3] then redis.call('DEL', KEYS[2]) end",
        "end",
        "local userValue = redis.call('GET', KEYS[1])",
        "if userValue then",
        "  local userOk, pointer = pcall(cjson.decode, userValue)",
        "  if userOk and pointer.codeDigest == ARGV[2] then redis.call('DEL', KEYS[1]) end",
        "end",
        "return 1",
      ].join("\n"),
      2,
      userKey(input.userId),
      codeKey(input.codeDigest),
      input.userId,
      input.codeDigest,
      input.interactionId,
    );
  }

  private async connect() {
    if (this.redis.status === "wait") await this.redis.connect();
  }
}
