export function getNewOpenAlertIds(previousAlerts = [], currentAlerts = []) {
  const previousOpenIds = new Set(
    (previousAlerts || []).filter(alert => alert?.status === 'open').map(alert => alert.id)
  );

  return (currentAlerts || [])
    .filter(alert => alert?.status === 'open' && !previousOpenIds.has(alert.id))
    .map(alert => alert.id);
}

export function notifyAboutNewAlerts(previousAlerts = [], currentAlerts = []) {
  const newAlertIds = getNewOpenAlertIds(previousAlerts, currentAlerts);
  if (!newAlertIds.length || typeof window === 'undefined' || !('Notification' in window)) {
    return;
  }

  const permission = window.Notification.permission;
  if (permission === 'default') {
    window.Notification.requestPermission().catch(() => {});
    return;
  }

  if (permission !== 'granted') {
    return;
  }

  newAlertIds.forEach(id => {
    const alert = (currentAlerts || []).find(item => item.id === id);
    if (!alert) return;

    new window.Notification('OSGuard alert', {
      body: `${alert.metric}: ${alert.message} (${alert.severity})`,
      tag: id,
      silent: false
    });
  });
}
