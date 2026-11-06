// This runs in the background, separate from the dashboard page — it's what
// lets a notification show up even if the browser tab isn't open.

self.addEventListener('push', event => {
  let data = { title: 'xyzzy', body: 'You have an update.', data: {} };
  try { data = event.data.json(); } catch (e) { /* fall back to default above */ }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: 'https://cdn-icons-png.flaticon.com/512/2830/2830284.png',
      badge: 'https://cdn-icons-png.flaticon.com/512/2830/2830284.png',
      data: data.data || {},
      tag: data.data && data.data.type ? data.data.type + '-' + (data.data.call_id || data.data.order_id || '') : undefined,
    })
  );
});

// Clicking the notification focuses an already-open dashboard tab if there is
// one, otherwise opens a new one.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes('dashboard.html') && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('dashboard.html');
    })
  );
});