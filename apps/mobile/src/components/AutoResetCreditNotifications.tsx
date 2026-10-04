import { useEffect, useRef } from "react";
import { Alert } from "react-native";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";

import { useEnvironments } from "../state/environments";
import { serverEnvironment } from "../state/server";

export function AutoResetCreditNotifications() {
  const { environments } = useEnvironments();
  return environments.map(({ environmentId }) => (
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
        Alert.alert(
          "Expiring Codex reset applied",
          `A banked reset was automatically used for ${provider.displayName ?? "Codex"}.`,
        );
      }
    }
  }, [providers]);
  return null;
}
