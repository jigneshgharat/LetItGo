// ============================================================
// LET IT GO — Anonymous feedback & usage tracking (Firebase)
// Tracks: input mode, release length, completion, feeling, note.
// Never stores what the user actually typed or said.
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
      completed: false,
      startedAt: firebase.firestore.FieldValue.serverTimestamp(),
      completedAt: null,
    }).then((ref) => {
      sessionDocRef = ref;
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
