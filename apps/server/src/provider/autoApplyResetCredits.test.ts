import { describe, expect, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";
import { ServerSettingsService } from "../serverSettings.ts";
import { ProviderInstanceRegistry } from "./Services/ProviderInstanceRegistry.ts";
import * as Stream from "effect/Stream";

import type { ProviderInstance } from "./ProviderDriver.ts";
import { makeManualOnlyProviderMaintenanceCapabilities } from "./providerMaintenance.ts";
import {
  AutoApplyResetCreditsLive,
  autoApplyResetCredits,
  isResetCreditExpiring,
} from "./autoApplyResetCredits.ts";

const now = DateTime.toEpochMillis(DateTime.makeUnsafe("2026-10-04T12:00:00Z"));
const limits = (minutes: number, availableCount = 1) => ({
  checkedAt: DateTime.formatIso(DateTime.makeUnsafe(now)),
  windows: [],
  resetCredits: {
    availableCount,
    nextCreditId: "expiring",
    nextExpiresAt: DateTime.formatIso(DateTime.makeUnsafe(now + minutes * 60_000)),
  },
});

describe("expiring reset credits", () => {
  it("only selects available, unexpired credits within the configured window", () => {
    expect(isResetCreditExpiring(limits(30), now, 30)).toBe(true);
    expect(isResetCreditExpiring(limits(31), now, 30)).toBe(false);
    expect(isResetCreditExpiring(limits(0), now, 30)).toBe(false);
    expect(isResetCreditExpiring(limits(-1), now, 30)).toBe(false);
    expect(isResetCreditExpiring(limits(10, 0), now, 30)).toBe(false);
    expect(
      isResetCreditExpiring(
        { checkedAt: "", windows: [], resetCredits: { availableCount: 1 } },
        now,
        30,
      ),
    ).toBe(false);
    expect(
      isResetCreditExpiring({ ...limits(10), unavailable: { reason: "probeFailed" } }, now, 30),
    ).toBe(false);
  });

  it.effect("checks each Codex account once and skips disabled and unsupported providers", () =>
    Effect.gen(function* () {
      const time = yield* Clock.currentTimeMillis;
      const redeemed: string[] = [];
      const makeInstance = (
        id: string,
        key: string,
        driver = "codex",
        enabled = true,
      ): ProviderInstance => {
        const provider: ServerProvider = {
          instanceId: ProviderInstanceId.make(id),
          driver: ProviderDriverKind.make(driver),
          status: "ready",
          enabled,
          installed: true,
          version: "1.0.0",
          auth: { status: "authenticated" },
          checkedAt: DateTime.formatIso(DateTime.makeUnsafe(time)),
          models: [],
          slashCommands: [],
          skills: [],
          usageLimits: {
            ...limits(10),
            checkedAt: DateTime.formatIso(DateTime.makeUnsafe(time)),
            resetCredits: {
              availableCount: 2,
              nextCreditId: "expiring",
              nextExpiresAt: DateTime.formatIso(DateTime.makeUnsafe(time + 10 * 60_000)),
            },
          },
        };
        return {
          instanceId: provider.instanceId,
          driverKind: provider.driver,
          continuationIdentity: { driverKind: provider.driver, continuationKey: id },
          displayName: undefined,
          enabled,
          resetCreditAccountKey: key,
          snapshot: {
            getSnapshot: Effect.succeed(provider),
            refresh: Effect.die("Fresh snapshots should not be probed"),
            streamChanges: Stream.empty,
            applyUsageLimits: () => Effect.void,
            resolveMaintenance: () =>
              Effect.succeed(
                makeManualOnlyProviderMaintenanceCapabilities({
                  provider: provider.driver,
                  packageName: null,
                }),
              ),
          },
          consumeResetCredit: (options) =>
            Effect.sync(() => {
              expect(options?.expiresWithinMinutes).toBe(30);
              redeemed.push(id);
              return "reset" as const;
            }),
          orchestrationAdapter: {} as ProviderInstance["orchestrationAdapter"],
          textGeneration: {} as ProviderInstance["textGeneration"],
        };
      };
      yield* autoApplyResetCredits(
        [
          makeInstance("first", "account-a"),
          makeInstance("duplicate", "account-a"),
          makeInstance("second", "account-b"),
          makeInstance("disabled", "account-c", "codex", false),
          makeInstance("claude", "account-d", "claudeAgent"),
        ],
        30,
      );
      expect(redeemed).toEqual(["first", "second"]);
    }),
  );

  it.effect("does no provider work until enabled and stops when disabled", () =>
    Effect.gen(function* () {
      const settings = yield* Ref.make(DEFAULT_SERVER_SETTINGS);
      const settingsReads = yield* Queue.unbounded<boolean>();
      const instanceChecks = yield* Queue.unbounded<void>();
      let checks = 0;
      const dependencies = Layer.mergeAll(
        Layer.mock(ServerSettingsService)({
          getSettings: Ref.get(settings).pipe(
            Effect.tap((current) => Queue.offer(settingsReads, current.codexAutoApplyResetCredits)),
          ),
        }),
        Layer.mock(ProviderInstanceRegistry)({
          listInstances: Effect.sync(() => {
            checks += 1;
          }).pipe(Effect.andThen(Queue.offer(instanceChecks, undefined)), Effect.as([])),
        }),
      );
      yield* Layer.build(AutoApplyResetCreditsLive.pipe(Layer.provide(dependencies)));
      expect(yield* Queue.take(settingsReads)).toBe(false);
      expect(checks).toBe(0);

      yield* Ref.update(settings, (current) => ({ ...current, codexAutoApplyResetCredits: true }));
      yield* TestClock.adjust("1 minute");
      yield* Queue.take(instanceChecks);
      expect(yield* Queue.take(settingsReads)).toBe(true);
      expect(checks).toBe(1);

      yield* Ref.update(settings, (current) => ({ ...current, codexAutoApplyResetCredits: false }));
      yield* TestClock.adjust("1 minute");
      expect(yield* Queue.take(settingsReads)).toBe(false);
      expect(checks).toBe(1);
    }).pipe(Effect.scoped),
  );
});
