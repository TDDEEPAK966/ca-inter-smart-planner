importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyBvYQvqTjREFyvB7j-z1xXp9hM9zSD_-0s',
  authDomain: 'inter-planner.firebaseapp.com',
  databaseURL: 'https://inter-planner-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'inter-planner',
  storageBucket: 'inter-planner.firebasestorage.app',
  messagingSenderId: '845980469054',
  appId: '1:845980469054:web:99799cfbd8d72bdd020e6f',
  measurementId: 'G-VZVXQCT6TD'
});

const messaging = firebase.messaging();
messaging.onBackgroundMessage(payload => {
  const data = payload.data || {};
  const notification = {
    body: data.body || 'A planner slot is starting now.',
    tag: data.eventId || undefined,
    data: {url: data.url || '../'}
  };
  self.registration.showNotification(data.title || 'CA Inter planner', notification);
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const rawUrl = event.notification.data && event.notification.data.url;
  let target = new URL('../', self.location.origin);
  try {
    const candidate = new URL(rawUrl || '../', self.location.origin);
    if (candidate.origin === self.location.origin) target = candidate;
  } catch (error) {
    console.warn('Invalid notification destination:', error);
  }
  event.waitUntil(self.clients.openWindow(target.href));
});
