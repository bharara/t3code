import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";
import { TextInput } from "react-native";

import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";
import { SettingsControlRow } from "./components/SettingsControlRow";
import type { SettingsTarget } from "./settings-environment-filter";

export function CodexResetCreditSettings({
  environment,
}: {
  readonly environment: SettingsTarget;
}) {
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(environment.environmentId));
  const update = useAtomCommand(serverEnvironment.updateSettings, {
    label: "update automatic Codex resets",
  });
  const [pending, setPending] = useState(false);
  if (!settings) return null;
  const save = async (patch: {
    codexAutoApplyResetCredits?: boolean;
    codexResetCreditExpiryMinutes?: number;
  }) => {
    setPending(true);
    try {
      await update({ environmentId: environment.environmentId, input: { patch } });
    } finally {
      setPending(false);
    }
  };
  return (
    <>
      <SettingsSwitchRow
        icon="arrow.clockwise"
        label="Auto-apply expiring banked resets"
        subtitle="Use the Codex reset closest to expiring. The environment's server must stay running."
        value={settings.codexAutoApplyResetCredits}
        disabled={pending}
        onValueChange={(enabled) => void save({ codexAutoApplyResetCredits: enabled })}
      />
      <SettingsControlRow
        icon="clock"
        label="Minutes before expiration"
        subtitle="1–1440 minutes"
        disabled={pending || !settings.codexAutoApplyResetCredits}
      >
        <ExpiryMinutesInput
          key={settings.codexResetCreditExpiryMinutes}
          minutes={settings.codexResetCreditExpiryMinutes}
          disabled={pending || !settings.codexAutoApplyResetCredits}
          onSave={(value) => void save({ codexResetCreditExpiryMinutes: value })}
        />
      </SettingsControlRow>
    </>
  );
}

function ExpiryMinutesInput({
  minutes,
  disabled,
  onSave,
}: {
  readonly minutes: number;
  readonly disabled: boolean;
  readonly onSave: (minutes: number) => void;
}) {
  const [draft, setDraft] = useState(String(minutes));
  return (
    <TextInput
      value={draft}
      onChangeText={setDraft}
      keyboardType="number-pad"
      accessibilityLabel="Minutes before reset expiration"
      editable={!disabled}
      className="w-20 rounded-lg bg-subtle p-2 text-right text-foreground"
      onEndEditing={() => {
        const value = Number(draft);
        if (Number.isInteger(value) && value >= 1 && value <= 1440) onSave(value);
        else setDraft(String(minutes));
      }}
    />
  );
}
