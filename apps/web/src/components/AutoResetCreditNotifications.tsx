import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { useEffect, useRef } from "react";

import { useEnvironmentIds } from "../state/environments";
import { serverEnvironment } from "../state/server";
import { toastManager } from "./ui/toast";

export function AutoResetCreditNotifications() {
  return useEnvironmentIds().map((environmentId) => (
    <EnvironmentResetNotifications key={environmentId} environmentId={environmentId} />
  ));
}

function EnvironmentResetNotifications({
  environmentId,
}: {
  readonly environmentId: EnvironmentId;
}) {
  const providers = useAtomValue(serverEnvironment.providersValueAtom(environmentId));
  const seen = useRef(new Map<string, string | undefined>());
  useEffect(() => {
    for (const provider of providers ?? []) {
      const appliedAt = provider.usageLimits?.autoAppliedResetAt;
      const previous = seen.current.get(provider.instanceId);
      const known = seen.current.has(provider.instanceId);
      seen.current.set(provider.instanceId, appliedAt);
      if (known && appliedAt && appliedAt !== previous) {
        toastManager.add({
          type: "success",
          title: "Expiring Codex reset applied",
          description: `A banked reset was automatically used for ${provider.displayName ?? "Codex"}.`,
        });
      }
    }
  }, [providers]);
  return null;
}
