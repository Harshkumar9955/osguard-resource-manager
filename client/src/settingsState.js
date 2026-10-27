export function mergeSettingsState(currentSettings, incomingSettings, isDirty) {
  if (!incomingSettings) return currentSettings ?? null;
  if (isDirty) return currentSettings ?? incomingSettings;
  return incomingSettings;
}
