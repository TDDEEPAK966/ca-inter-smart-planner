const { initializeApp, cert } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { getMessaging } = require('firebase-admin/messaging');

const PROJECT_ID = 'inter-planner';
const DATABASE_URL = 'https://inter-planner-default-rtdb.asia-southeast1.firebasedatabase.app';
const REMINDERS_PATH = 'ca_inter_planner_reminder_users';
const DELIVERY_WINDOW_MS = 8 * 60 * 1000;

function getLocalDateTime(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`
  };
}

function isPersonalSlotDue(slot, local) {
  if (!slot || slot.reminderEnabled === false
      || !/^([01]\d|2[0-3]):[0-5]\d$/.test(slot.startTime || '')
      || typeof slot.id !== 'string'
      || !/^[A-Za-z0-9_-]{1,120}$/.test(slot.id)
      || typeof slot.date !== 'string') return false;
  const [year, month, day] = local.date.split('-').map(Number);
  const localNow = Date.parse(`${local.date}T${local.time}:00Z`);
  for (let offset = 0; offset <= 1; offset++) {
    const occurrence = new Date(Date.UTC(year, month - 1, day - offset));
    const date = occurrence.toISOString().slice(0, 10);
    if (date < slot.date) continue;
    const start = new Date(`${slot.date}T00:00:00Z`);
    if (date !== slot.date) {
      if (!slot.repeat || slot.repeat === 'once') continue;
      if (slot.repeat === 'weekly' && occurrence.getUTCDay() !== start.getUTCDay()) continue;
      if (slot.repeat === 'monthly' && occurrence.getUTCDate() !== start.getUTCDate()) continue;
      if (slot.repeat !== 'weekly' && slot.repeat !== 'monthly') continue;
    }
    const scheduled = Date.parse(`${date}T${slot.startTime}:00Z`);
    if (localNow >= scheduled && localNow - scheduled <= DELIVERY_WINDOW_MS) return true;
  }
  return false;
}

function initializeFirebase() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_JSON GitHub Actions secret.');
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(raw);
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON must contain the full service-account JSON.');
  }
  if (serviceAccount.project_id !== PROJECT_ID) {
    throw new Error(`The service-account key must belong to Firebase project ${PROJECT_ID}.`);
  }
  return initializeApp({credential: cert(serviceAccount), databaseURL: DATABASE_URL});
}

async function sendEvent(userId, settings, eventId, event, database, messaging) {
  const tokens = Object.entries(settings.tokens || {})
    .filter(([, active]) => active === true)
    .map(([token]) => token);
  if (!tokens.length) return;

  const sentRef = database.ref(`${REMINDERS_PATH}/${userId}/sent/${eventId}`);
  const sent = await sentRef.once('value');
  if (sent.val() === true) return;

  let successCount = 0;
  const invalidTokens = [];
  for (let offset = 0; offset < tokens.length; offset += 500) {
    const batch = tokens.slice(offset, offset + 500);
    const result = await messaging.sendEachForMulticast({
      tokens: batch,
      data: {
        title: String(event.title || 'CA Inter planner').slice(0, 100),
        body: String(event.body || 'A planner slot is starting now.').slice(0, 3500),
        url: settings.siteUrl,
        eventId
      },
      webpush: {headers: {Urgency: 'high'}}
    });
    successCount += result.successCount;
    result.responses.forEach((response, index) => {
      if (!response.success && [
        'messaging/invalid-registration-token',
        'messaging/registration-token-not-registered'
      ].includes(response.error.code)) invalidTokens.push(batch[index]);
    });
  }

  if (invalidTokens.length) {
    const cleanup = {};
    invalidTokens.forEach(token => { cleanup[`tokens/${token}`] = null; });
    await database.ref(`${REMINDERS_PATH}/${userId}`).update(cleanup);
  }
  if (!successCount) throw new Error(`Firebase rejected all devices for reminder ${eventId}.`);
  await sentRef.set(true);
  console.log(`Sent ${eventId} for ${userId} to ${successCount} device(s).`);
}

async function sendDueEvents(userId, settings, now, database, messaging) {
  if (!settings || settings.enabled !== true) return;
  if (!/^https:\/\//.test(settings.siteUrl || '')) {
    console.warn(`Skipping ${userId}: missing HTTPS site URL.`);
    return;
  }
  const events = settings.events && typeof settings.events === 'object' ? settings.events : {};
  const failures = [];
  for (const [eventId, event] of Object.entries(events)) {
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(eventId) || !event || typeof event !== 'object') continue;
    const at = Date.parse(event.at);
    if (!Number.isFinite(at) || now.getTime() < at || now.getTime() - at > DELIVERY_WINDOW_MS) continue;
    try {
      await sendEvent(userId, settings, eventId, event, database, messaging);
    } catch (error) {
      failures.push(`${eventId}: ${error.message}`);
    }
  }
  const timeZone = typeof settings.timeZone === 'string' ? settings.timeZone : 'UTC';
  let local;
  try {
    local = getLocalDateTime(now, timeZone);
  } catch (error) {
    failures.push(`Invalid time zone "${timeZone}": ${error.message}`);
  }
  if (local) {
    const snapshot = await database
      .ref(`users/${userId}/ca_inter_planner_data/customSlots`)
      .once('value');
    const slots = snapshot.val();
    for (const slot of Object.values(slots || {})) {
      if (!isPersonalSlotDue(slot, local)) continue;
      const eventId = `personal_${slot.id}_${local.date}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120);
      try {
        await sendEvent(userId, settings, eventId, {
          title: 'Personal study time',
          body: `${String(slot.title || slot.type || 'Personal study').slice(0, 300)} starts now.`
        }, database, messaging);
      } catch (error) {
        failures.push(`${eventId}: ${error.message}`);
      }
    }
  }
  if (failures.length) throw new Error(failures.join('; '));
}

async function main() {
  const app = initializeFirebase();
  try {
    const database = getDatabase();
    const messaging = getMessaging();
    const snapshot = await database.ref(REMINDERS_PATH)
      .orderByChild('enabled')
      .equalTo(true)
      .once('value');
    const now = new Date();
    const outcomes = [];
    snapshot.forEach(user => {
      outcomes.push(
        sendDueEvents(user.key, user.val(), now, database, messaging)
          .catch(error => {
            console.error(`Failed to send reminders for ${user.key}:`, error.message);
            return error;
          })
      );
    });
    const results = await Promise.all(outcomes);
    if (results.some(result => result instanceof Error)) process.exitCode = 1;
    if (!snapshot.exists()) console.log('No enabled CA Inter planner reminders.');
  } finally {
    await app.delete();
  }
}

main().catch(error => {
  console.error('Reminder workflow failed:', error.message);
  process.exitCode = 1;
});
