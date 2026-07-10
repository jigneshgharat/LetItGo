// ============================================================
// LET IT GO — Anonymous feedback & usage tracking (Firebase)
// Tracks: input mode, release length, completion, feeling, note,
// and a coarse city/region/country derived from IP (via ipapi.co).
// Never stores what the user actually typed or said, and never
// stores the raw IP address itself.
// ============================================================

const firebaseConfig = {
  apiKey: "AIzaSyD4DFo8cUNWMuVfq0MyWFs_gbjV3U8sjxE",
  authDomain: "let-it-go-421a2.firebaseapp.com",
  projectId: "let-it-go-421a2",
  storageBucket: "let-it-go-421a2.firebasestorage.app",
  messagingSenderId: "179761327541",
  appId: "1:179761327541:web:88ded0558151535b793dfc"
};

window.VoidFeedback = (() => {
  const noop = { startSession(){}, recordRelease(){}, recordFeeling(){}, recordNote(){} };

  if (typeof firebase === 'undefined') {
    console.warn('[Feedback] Firebase SDK not loaded');
    return noop;
  }

  try {
    firebase.initializeApp(firebaseConfig);
  } catch (e) {
    console.warn('[Feedback] Firebase init failed:', e);
    return noop;
  }

  const db = firebase.firestore();
  const sessionsRef = db.collection('sessions');

  const DEVICE_KEY = 'void_device_id';
  const VISITED_KEY = 'void_has_visited';

  function getDeviceId() {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  }

  function getIsReturning() {
    const visited = localStorage.getItem(VISITED_KEY);
    if (!visited) {
      localStorage.setItem(VISITED_KEY, '1');
      return false;
    }
    return true;
  }

  // --- Coarse location (city/region/country only, derived from IP) ---
  // The IP itself is never stored — only what the lookup resolves it to.
  function fetchGeo() {
    return fetch('https://ipwho.is/')
      .then((res) => res.json())
      .then((data) => {
        if (!data.success) return null;
        return {
          city: data.city || null,
          region: data.region || null,
          country: data.country || null,
        };
      })
      .catch((err) => {
        console.warn('[Feedback] geo lookup failed:', err);
        return null;
      });
  }

  let sessionDocRef = null;
  let sessionStarted = false;

  function startSession() {
    if (sessionStarted) return;
    sessionStarted = true;
    sessionsRef.add({
      deviceId: getDeviceId(),
      isReturning: getIsReturning(),
      inputMode: null,
      releaseLength: 0,
      feeling: null,
      note: '',
      city: null,
      region: null,
      country: null,
      completed: false,
      startedAt: firebase.firestore.FieldValue.serverTimestamp(),
      completedAt: null,
    }).then((ref) => {
      sessionDocRef = ref;
      fetchGeo().then((geo) => {
        if (geo && sessionDocRef) {
          sessionDocRef.update(geo).catch((err) => console.warn('[Feedback] geo update failed:', err));
        }
      });
    }).catch((err) => {
      console.warn('[Feedback] startSession failed:', err);
    });
  }

  function recordRelease({ inputMode, releaseLength }) {
    if (!sessionDocRef) return;
    sessionDocRef.update({
      inputMode,
      releaseLength,
      completed: true,
      completedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }).catch((err) => console.warn('[Feedback] recordRelease failed:', err));
  }

  function recordFeeling(feeling) {
    if (!sessionDocRef) return;
    sessionDocRef.update({ feeling }).catch((err) => console.warn('[Feedback] recordFeeling failed:', err));
  }

  function recordNote(note) {
    if (!sessionDocRef) return;
    sessionDocRef.update({ note }).catch((err) => console.warn('[Feedback] recordNote failed:', err));
  }

  return { startSession, recordRelease, recordFeeling, recordNote };
})();
