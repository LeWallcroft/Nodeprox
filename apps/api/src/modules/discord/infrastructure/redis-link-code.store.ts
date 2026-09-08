import { Redis } from "ioredis";
import type { LinkCodeStore } from "../application/discord-gateway.service.js";

export class RedisLinkCodeStore implements LinkCodeStore {
  private readonly redis: Redis;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
  }

  async create(userId: string, code: string, ttlSeconds: number) {
    if (this.redis.status === "wait") await this.redis.connect();
    await this.redis.set(
      `nodeprox:discord-link:${code}`,
      userId,
      "EX",
      ttlSeconds,
      "NX",
    );
  }

  async consume(code: string) {
    if (this.redis.status === "wait") await this.redis.connect();
    const key = `nodeprox:discord-link:${code}`;
    const result = await this.redis.eval(
      "local value = redis.call('GET', KEYS[1]); if value then redis.call('DEL', KEYS[1]); end; return value;",
      1,
      key,
    );
    return typeof result === "string" ? result : null;
  }
}
