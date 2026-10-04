import type { ServerProviderUsageLimits } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";

import { ServerSettingsService } from "../serverSettings.ts";
import type { ProviderInstance } from "./ProviderDriver.ts";
import { ProviderInstanceRegistry } from "./Services/ProviderInstanceRegistry.ts";

export function isResetCreditExpiring(
  limits: ServerProviderUsageLimits | undefined,
  now: number,
  thresholdMinutes: number,
): boolean {
  const credits = limits?.resetCredits;
  if (
    !credits?.availableCount ||
    !credits.nextExpiresAt ||
    !credits.nextCreditId ||
    limits?.unavailable
  )
    return false;
  const expiry = DateTime.make(credits.nextExpiresAt);
  if (Option.isNone(expiry)) return false;
  const expiresAt = DateTime.toEpochMillis(expiry.value);
  return expiresAt > now && expiresAt - now <= thresholdMinutes * 60_000;
}

/** One sweep per credential directory; redemption rechecks eligibility under its account lock. */
export const autoApplyResetCredits = Effect.fn("autoApplyResetCredits")(function* (
  instances: readonly ProviderInstance[],
  thresholdMinutes: number,
) {
  const checkedAccounts = new Set<string>();
  for (const instance of instances) {
    if (!instance.enabled || instance.driverKind !== "codex" || !instance.consumeResetCredit)
      continue;
    const key = instance.resetCreditAccountKey ?? instance.instanceId;
    if (checkedAccounts.has(key)) continue;
    checkedAccounts.add(key);
    yield* Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      let snapshot = yield* instance.snapshot.getSnapshot;
      const checkedAt = snapshot.usageLimits?.checkedAt;
      // Discover new credits without running a full provider probe every minute.
      if (
        !checkedAt ||
        now - DateTime.toEpochMillis(DateTime.makeUnsafe(checkedAt)) >= 5 * 60_000
      ) {
        snapshot = yield* instance.snapshot.refresh;
        if (snapshot.usageLimits?.checkedAt === checkedAt) return;
      }
      if (!isResetCreditExpiring(snapshot.usageLimits, now, thresholdMinutes)) return;
      yield* instance.consumeResetCredit!({ expiresWithinMinutes: thresholdMinutes });
    }).pipe(Effect.catchCause((cause) => Effect.logWarning("Automatic Codex reset failed", cause)));
  }
});

export const AutoApplyResetCreditsLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const settings = yield* ServerSettingsService;
    const registry = yield* ProviderInstanceRegistry;
    yield* Effect.gen(function* () {
      const current = yield* settings.getSettings;
      if (!current.codexAutoApplyResetCredits) return;
      yield* autoApplyResetCredits(
        yield* registry.listInstances,
        current.codexResetCreditExpiryMinutes,
      );
    }).pipe(
      Effect.catchCause((cause) => Effect.logWarning("Automatic Codex reset check failed", cause)),
      Effect.repeat(Schedule.spaced("1 minute")),
      Effect.forkScoped,
    );
  }),
);
