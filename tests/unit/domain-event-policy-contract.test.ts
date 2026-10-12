import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  dispatchRequiredEventTypes,
  domainEventPolicyCatalog,
  terminalLegacyEventTypes,
} from "../../apps/api/src/modules/events/application/domain-event-policy.js";

const root = resolve(import.meta.dirname, "../..");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")
      ? [path]
      : [];
  });
}

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

describe("domain event disposition architecture", () => {
  it("classifies every production outbox producer and forbids new terminal legacy writes", () => {
    const producers = sourceFiles(resolve(root, "apps/api/src")).concat(
      sourceFiles(resolve(root, "apps/worker/src")),
    );
    const emitted: string[] = [];
    for (const path of producers) {
      const source = readFileSync(path, "utf8");
      emitted.push(
        ...Array.from(
          source.matchAll(
            /(?:this\.events|domainEvents)\??\.append\(\s*\{\s*type:\s*"([^"]+)"/g,
          ),
          (match) => match[1] ?? "",
        ),
      );
      emitted.push(
        ...Array.from(
          source.matchAll(
            /\.insert\(domainEventOutbox\)\.values\(\{\s*eventType:\s*"([^"]+)"/g,
          ),
          (match) => match[1] ?? "",
        ),
      );
    }
    expect(emitted.length).toBeGreaterThan(0);
    for (const type of emitted) {
      expect(domainEventPolicyCatalog.getDisposition(type), type).toBe(
        "dispatch-required",
      );
    }
  });

  it("keeps dispositions disjoint and all required types handled in API composition", () => {
    expect(new Set(dispatchRequiredEventTypes).size).toBe(
      dispatchRequiredEventTypes.length,
    );
    expect(new Set(terminalLegacyEventTypes).size).toBe(
      terminalLegacyEventTypes.length,
    );
    for (const type of terminalLegacyEventTypes)
      expect(dispatchRequiredEventTypes).not.toContain(type);
    const handlerFiles = [
      "apps/api/src/modules/notifications/application/notification-projector.ts",
      "apps/api/src/modules/discord/application/discord-grant-notification.handler.ts",
      "apps/api/src/modules/chapter-replacements/application/chapter-replacement-ready.handler.ts",
      "apps/api/src/modules/images/application/services/image-replacement-ready.handler.ts",
    ];
    const handlers = handlerFiles.map(read).join("\n");
    for (const type of dispatchRequiredEventTypes)
      expect(handlers).toContain(`"${type}"`);
    for (const type of terminalLegacyEventTypes)
      expect(handlers).not.toContain(`"${type}"`);
    const composition = read("apps/api/src/composition/create-api-runtime.ts");
    for (const handler of [
      "NotificationProjector",
      "DiscordGrantNotificationHandler",
      "ChapterReplacementReadyHandler",
      "ImageReplacementReadyHandler",
    ])
      expect(composition).toContain(`new ${handler}(`);
  });

  it("requires the policy before handler lookup and never infers terminal completion from no handlers", () => {
    const dispatcher = read(
      "apps/api/src/modules/events/application/domain-event-dispatcher.ts",
    );
    expect(
      dispatcher.indexOf("this.policy.getDisposition(event.eventType)"),
    ).toBeLessThan(
      dispatcher.indexOf("this.registry.getHandlers(event.eventType)"),
    );
    expect(dispatcher).toContain('disposition === "terminal-legacy"');
    expect(dispatcher).not.toMatch(
      /handlers\.length === 0[\s\S]{0,160}terminal-no-handler/,
    );
  });
});
