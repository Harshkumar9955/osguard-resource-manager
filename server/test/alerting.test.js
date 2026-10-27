import test from 'node:test';
import assert from 'node:assert/strict';

process.env.PORT = '0';

const { evaluateAlerts } = await import('../src/server.js');
const { db } = await import('../src/database.js');
const { getNewOpenAlertIds } = await import('../../client/src/alertNotifications.js');

test('evaluateAlerts creates an alert when a threshold is crossed', () => {
  db.prepare('DELETE FROM alerts').run();

  evaluateAlerts({
    timestamp: '2026-01-01T00:00:00.000Z',
    cpu: 95,
    memory: { percent: 90, swapPercent: 20 },
    disks: [{ mount: '/', fs: '/', used: 120, size: 150, percent: 80 }]
  });

  const rows = db.prepare("SELECT metric, status, severity FROM alerts WHERE metric LIKE 'CPU%' OR metric LIKE 'Memory%' OR metric LIKE 'Filesystem%' ORDER BY metric").all();
  assert.equal(rows.length >= 2, true);
  assert.equal(rows.some(r => r.metric === 'CPU utilization' && r.status === 'open'), true);
  assert.equal(rows.some(r => r.metric === 'Memory utilization' && r.status === 'open'), true);
});

test('getNewOpenAlertIds only returns alerts that changed from not-open to open', () => {
  const previous = [
    { id: 'a1', status: 'resolved' },
    { id: 'a2', status: 'acknowledged' }
  ];
  const current = [
    { id: 'a1', status: 'resolved' },
    { id: 'a2', status: 'open' },
    { id: 'a3', status: 'open' }
  ];

  assert.deepEqual(getNewOpenAlertIds(previous, current), ['a2', 'a3']);
});
