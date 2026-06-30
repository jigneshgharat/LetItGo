// ============================================================
// LET IT GO — Audio Engine
// File-based ambient tracks + procedural final note
// ============================================================

window.VoidAudio = (() => {

  let ctx = null;
  let started = false;
  let masterGain;

  // Stage 2: Ring ambient track
  let ringBuffer = null;
  let ringSource = null;
  let ringGain = null;
  let ringLoaded = false;

  // Stage 3: Collapse track
  let collapseBuffer = null;
  let collapseSource = null;
  let collapseGain = null;
  let collapseLoaded = false;
  let collapseAudioStarted = false;



  // ============================================================
  // LOAD audio files
  // ============================================================
  async function loadAudio(url) {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    return ctx.decodeAudioData(arrayBuffer);
  }

  async function loadAll() {
    try {
      const [ring, collapse] = await Promise.all([
        loadAudio('Audio/Stage2_Interstellar%20Rest.mp3'),
        loadAudio('Audio/Stage3_Where%20we%27re%20going%20-%20Hans%20Zimmer%20-%20Interstellar%20-%20(SlowedReverb).mp3'),
      ]);
      ringBuffer = ring;
      ringLoaded = true;
      collapseBuffer = collapse;
      collapseLoaded = true;
    } catch (e) {
      console.warn('Audio load error:', e);
    }
  }


  // ============================================================
  // INIT — called on first user gesture
  // ============================================================
  function init() {
    if (started) return;
    started = true;

    ctx = new (window.AudioContext || window.webkitAudioContext)();

    masterGain = ctx.createGain();
    masterGain.gain.value = 0;
    masterGain.connect(ctx.destination);

    // Set up gain nodes
    ringGain = ctx.createGain();
    ringGain.gain.value = 0;
    ringGain.connect(masterGain);

    collapseGain = ctx.createGain();
    collapseGain.gain.value = 0;
    collapseGain.connect(masterGain);

    // Fade in master
    masterGain.gain.setValueAtTime(0, ctx.currentTime);
    masterGain.gain.linearRampToValueAtTime(1.0, ctx.currentTime + 3);

    loadAll();
  }


  // ============================================================
  // Start/stop ring ambient
  // ============================================================
  function startRingAudio() {
    if (!ringLoaded || !ctx || ringSource) return;

    ringSource = ctx.createBufferSource();
    ringSource.buffer = ringBuffer;
    ringSource.loop = true;
    ringSource.connect(ringGain);
    ringSource.start();
  }

  function stopRingAudio(fadeTime) {
    if (!ringSource) return;
    const now = ctx.currentTime;
    ringGain.gain.setTargetAtTime(0, now, fadeTime || 2);
    const src = ringSource;
    ringSource = null;
    setTimeout(() => {
      try { src.stop(); } catch (_) {}
    }, (fadeTime || 2) * 4 * 1000);
  }


  // ============================================================
  // Start collapse audio
  // ============================================================
  function startCollapseAudio() {
    if (!collapseLoaded || !ctx || collapseAudioStarted) return;
    collapseAudioStarted = true;

    collapseSource = ctx.createBufferSource();
    collapseSource.buffer = collapseBuffer;
    collapseSource.loop = false;
    collapseSource.connect(collapseGain);
    collapseSource.start();

    // Fade in the collapse track
    const now = ctx.currentTime;
    collapseGain.gain.setValueAtTime(0, now);
    collapseGain.gain.linearRampToValueAtTime(0.8, now + 3);
  }


  // ============================================================
  // UPDATE — called every frame
  // ============================================================
  let ringStarted = false;

  function update(t, gather, energy, collapse) {
    if (!started || !ctx) return;
    const now = ctx.currentTime;

    // ---- Stage 2: Start ring audio immediately once loaded ----
    if (!ringStarted && ringLoaded && collapse <= 0) {
      ringStarted = true;
      startRingAudio();
      ringGain.gain.setValueAtTime(0, ctx.currentTime);
      ringGain.gain.linearRampToValueAtTime(0.6, ctx.currentTime + 1);
    }

    // ---- Stage 2: Ring active — volume breathes gently ----
    if (gather > 0.8 && collapse <= 0 && ringSource) {
      const breath = Math.sin(t * 0.4) * 0.5 + 0.5;
      const deepBreath = Math.sin(t * 0.12) * 0.5 + 0.5;
      const breathMix = breath * 0.5 + deepBreath * 0.5;

      // Gentle breathing on the volume + slight boost with energy
      const vol = 0.55 + breathMix * 0.1 + energy * 0.2;
      ringGain.gain.setTargetAtTime(vol, now, 0.5);
    }

    // ---- Stage 3: Collapse ----
    if (collapse > 0) {
      // Crossfade: fade out ring, fade in collapse track
      if (!collapseAudioStarted) {
        startCollapseAudio();
        // Fade ring audio out over the first part of collapse
        stopRingAudio(4);
      }

      // Collapse track volume follows collapse progress
      if (collapseSource) {
        if (collapse < 0.78) {
          // Main body: full volume
          collapseGain.gain.setTargetAtTime(0.85, now, 0.5);
        } else if (collapse < 0.88) {
          // Singularity: maintain
          collapseGain.gain.setTargetAtTime(0.8, now, 0.3);
        } else {
          // Ember phase: fade collapse track out
          const fadeP = (collapse - 0.88) / 0.12;
          collapseGain.gain.setTargetAtTime(0.8 * (1 - fadeP), now, 0.3);
          masterGain.gain.setTargetAtTime(1.0 * (1 - fadeP * 0.85), now, 1.0);
        }
      }
    }
  }


  // ============================================================
  // RESET — prepare for next cycle
  // ============================================================
  function reset() {
    if (!started || !ctx) return;
    const now = ctx.currentTime;

    collapseAudioStarted = false;
    ringStarted = false;

    // Stop collapse audio
    if (collapseSource) {
      try { collapseSource.stop(); } catch (_) {}
      collapseSource = null;
    }
    collapseGain.gain.setValueAtTime(0, now);

    // Restart ring audio fresh
    ringSource = null;
    ringGain.gain.setValueAtTime(0, now);
    masterGain.gain.setTargetAtTime(1.0, now, 2.0);

    // Ring audio will restart when gather > 0.5 hits again in update()
    // Since we're returning to ring state, force it now
    if (ringLoaded) {
      startRingAudio();
      ringGain.gain.setValueAtTime(0, now);
      ringGain.gain.linearRampToValueAtTime(0.6, now + 3);
      ringStarted = true;
    }
  }


  return {
    init,
    update,
    reset,
    isStarted: () => started,
  };

})();
