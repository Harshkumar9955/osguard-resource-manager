import test from 'node:test';
import assert from 'node:assert/strict';

const { mergeSettingsState } = await import('../../client/src/settingsState.js');

test('mergeSettingsState keeps local unsaved edits when settings are dirty', () => {
  const current = { cpuWarning: 60, cpuCritical: 80, memoryWarning: 70, memoryCritical: 90 };
  const next = { cpuWarning: 50, cpuCritical: 75, memoryWarning: 65, memoryCritical: 85 };

  assert.deepEqual(mergeSettingsState(current, next, true), current);
});

test('mergeSettingsState accepts server values when settings are not dirty', () => {
  const current = { cpuWarning: 60, cpuCritical: 80, memoryWarning: 70, memoryCritical: 90 };
  const next = { cpuWarning: 50, cpuCritical: 75, memoryWarning: 65, memoryCritical: 85 };

  assert.deepEqual(mergeSettingsState(current, next, false), next);
});
