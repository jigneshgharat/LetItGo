// ============================================================
// INTO THE VOID — Energy Detection Engine
// Voice/Type toggle, in-ring text, energy detection → 0-1
// ============================================================

window.VoidEnergy = (() => {

  // --- State ---
  let energy = 0;
  let rawVoiceEnergy = 0;
  let rawTypeEnergy = 0;
  let isListening = false;
  let isActive = false;
  let mode = 'type'; // 'type' or 'voice'
  let recognition = null;
  let audioCtx = null;
  let analyser = null;
  let micStream = null;
  let transcript = '';
  let interimTranscript = '';
  let done = false;

  // --- DOM refs ---
  const modeToggle = document.getElementById('modeToggle');
  const btnType = document.getElementById('btnType');
  const btnVoice = document.getElementById('btnVoice');
  const hiddenInput = document.getElementById('hiddenInput');
  const ringText = document.getElementById('ringText');
  const doneBtn = document.getElementById('doneBtn');
  const privacyNote = document.getElementById('privacyNote');
  const infoIcon = document.getElementById('infoIcon');
  const infoModal = document.getElementById('infoModal');
  const infoModalClose = document.getElementById('infoModalClose');
  const voiceUnsupportedEl = document.getElementById('voiceUnsupported');
  const restartLearnMoreBtn = document.getElementById('restartLearnMoreBtn');

  // --- Info modal open/close ---
  infoIcon.addEventListener('click', (e) => {
    e.stopPropagation();
    infoModal.classList.add('visible');
  });
  restartLearnMoreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    infoModal.classList.add('visible');
  });
  infoModalClose.addEventListener('click', () => {
    infoModal.classList.remove('visible');
  });
  infoModal.addEventListener('click', (e) => {
    if (e.target === infoModal) infoModal.classList.remove('visible');
  });

  // --- Voice support detection ---
  const voiceSupported = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  let voiceTooltipTimer = null;

  // --- Typing energy detection ---
  let keyTimes = [];
  let typedText = '';

  function updateTypeMode() {
    btnType.classList.toggle('active', mode === 'type');
    btnVoice.classList.toggle('active', mode === 'voice');
    btnVoice.classList.remove('listening');
  }

  const PLACEHOLDER_TEXT = 'What do you need to let go of?';

  function updateRingText(text, showCursor) {
    if (showCursor) {
      ringText.innerHTML = '';
      const isPlaceholder = text === '';
      const displayText = isPlaceholder ? PLACEHOLDER_TEXT : text;
      // Wrap the cursor + text in a single element rather than appending
      // them as separate direct children of the flex container — on
      // mobile, .ring-text is display:flex, and browsers can otherwise
      // split contiguous inline content into separate anonymous flex
      // items, stacking the cursor away from the text instead of
      // keeping them on the same line.
      const wrapper = document.createElement('span');
      const textNode = document.createTextNode(displayText);
      const cursor = document.createElement('span');
      cursor.className = 'cursor';
      if (isPlaceholder) {
        wrapper.appendChild(cursor);
        wrapper.appendChild(textNode);
      } else {
        wrapper.appendChild(textNode);
        wrapper.appendChild(cursor);
      }
      ringText.appendChild(wrapper);
      ringText.classList.add('active');
      ringText.classList.toggle('ring-placeholder', isPlaceholder);
    } else {
      ringText.textContent = text;
      ringText.classList.toggle('active', text.length > 0);
      ringText.classList.remove('ring-placeholder');
    }
  }

  function switchToType() {
    if (mode === 'type') return;
    stopMic();
    mode = 'type';
    updateTypeMode();
    hiddenInput.focus();
    updateRingText(typedText, true);
  }

  function switchToVoice() {
    if (!voiceSupported) {
      voiceUnsupportedEl.classList.add('show');
      clearTimeout(voiceTooltipTimer);
      voiceTooltipTimer = setTimeout(() => {
        voiceUnsupportedEl.classList.remove('show');
      }, 3000);
      return;
    }
    if (mode === 'voice') return;
    mode = 'voice';
    updateTypeMode();
    hiddenInput.blur();
    updateRingText('', true);
    startMic();
  }

  btnType.addEventListener('click', switchToType);
  btnVoice.addEventListener('click', switchToVoice);

  // Focus hidden input when clicking anywhere in type mode
  // Also init audio on first user gesture
  document.addEventListener('click', (e) => {
    if (window.VoidAudio) window.VoidAudio.init();
    if (mode === 'type'
      && !e.target.closest('.mode-toggle')
      && !e.target.closest('.done-btn')
      && !e.target.closest('.restart-overlay')
      && !e.target.closest('.info-modal-overlay')) {
      hiddenInput.focus();
    }
  });

  hiddenInput.addEventListener('keydown', (e) => {
    if (window.VoidAudio) window.VoidAudio.init();
    const now = performance.now();
    keyTimes.push(now);
    if (keyTimes.length > 30) keyTimes.shift();
    isActive = true;
  });

  hiddenInput.addEventListener('input', () => {
    typedText = hiddenInput.value;

    updateRingText(typedText, true);

    if (typedText.length === 0) {
      rawTypeEnergy = 0;
      return;
    }

    const now = performance.now();
    const recentKeys = keyTimes.filter(t => now - t < 2000);
    const keysPerSec = recentKeys.length / 2;

    // ALL CAPS detection
    const letters = typedText.replace(/[^a-zA-Z]/g, '');
    const capsCount = (letters.match(/[A-Z]/g) || []).length;
    const capsRatio = letters.length > 0 ? capsCount / letters.length : 0;

    // Punctuation density
    const punctCount = (typedText.match(/[!?.,;:—\-…]/g) || []).length;
    const punctRatio = typedText.length > 0 ? punctCount / typedText.length : 0;

    // Average word length (longer words = more intensity)
    const words = typedText.trim().split(/\s+/).filter(w => w.length > 0);
    const avgWordLen = words.length > 0
      ? words.reduce((s, w) => s + w.length, 0) / words.length
      : 0;
    const wordLenNorm = Math.min(1, avgWordLen / 10);

    const speedNorm = Math.min(1, keysPerSec / 8);
    const capsNorm = Math.min(1, capsRatio * 1.5);
    const punctNorm = Math.min(1, punctRatio * 4);

    rawTypeEnergy = speedNorm * 0.45 + capsNorm * 0.3 + punctNorm * 0.15 + wordLenNorm * 0.1;

    // Show done button once user has typed something
    if (typedText.length > 0) {
      doneBtn.classList.add('visible');
    }
  });

  // Typing energy decays when not typing
  setInterval(() => {
    const now = performance.now();
    const recentKeys = keyTimes.filter(t => now - t < 2000);
    if (recentKeys.length === 0 && rawTypeEnergy > 0) {
      rawTypeEnergy *= 0.92;
      if (rawTypeEnergy < 0.01) rawTypeEnergy = 0;
    }
    if (recentKeys.length === 0 && typedText.length === 0 && !isListening) {
      isActive = false;
    }
  }, 100);


  // --- Voice energy detection ---
  const FFT_SIZE = 256;
  let freqData = null;

  let speechSupported = false;

  function startMic() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      recognition = new SR();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        console.log('[Speech] recognition started');
      };

      recognition.onresult = (e) => {
        console.log('[Speech] result received:', e.results.length, 'results');
        speechSupported = true;
        interimTranscript = '';
        transcript = '';
        for (let i = 0; i < e.results.length; i++) {
          if (e.results[i].isFinal) {
            transcript += e.results[i][0].transcript + ' ';
          } else {
            interimTranscript += e.results[i][0].transcript;
          }
        }
        const display = transcript + interimTranscript;
        updateRingText(display.slice(-200).trim(), false);

        if (display.trim().length > 0) {
          doneBtn.classList.add('visible');
        }
      };

      recognition.onerror = (e) => {
        console.log('[Speech] error:', e.error);
        if (e.error === 'no-speech') return;
        console.warn('Speech recognition error:', e.error);
      };

      recognition.onend = () => {
        console.log('[Speech] recognition ended, isListening:', isListening);
        if (isListening) {
          try { recognition.start(); } catch (_) {}
        }
      };

      try {
        recognition.start();
      } catch (err) {
        console.warn('Speech recognition not available:', err);
      }
    }

    isListening = true;
    isActive = true;
    btnVoice.classList.add('listening');

    // Keep cursor placeholder visible while waiting for speech

    // Start audio analysis async (for energy detection)
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then((stream) => {
        micStream = stream;
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = FFT_SIZE;
        analyser.smoothingTimeConstant = 0.8;
        freqData = new Uint8Array(analyser.frequencyBinCount);

        const source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);
        analyseVoice();
      })
      .catch((err) => {
        console.warn('Mic access denied:', err);
        switchToType();
      });
  }

  function stopMic() {
    isListening = false;
    speechSupported = false;
    btnVoice.classList.remove('listening');

    if (recognition) {
      recognition.onend = null;
      try { recognition.stop(); } catch (_) {}
      recognition = null;
    }
    if (micStream) {
      micStream.getTracks().forEach(t => t.stop());
      micStream = null;
    }
    if (audioCtx) {
      audioCtx.close();
      audioCtx = null;
    }
    rawVoiceEnergy = 0;
  }

  function analyseVoice() {
    if (!isListening || !analyser) return;

    analyser.getByteFrequencyData(freqData);

    let sum = 0;
    for (let i = 0; i < freqData.length; i++) {
      sum += freqData[i];
    }
    const avgVolume = sum / freqData.length / 255;

    let highSum = 0;
    const highStart = Math.floor(freqData.length * 0.3);
    for (let i = highStart; i < freqData.length; i++) {
      highSum += freqData[i];
    }
    const highEnergy = highSum / (freqData.length - highStart) / 255;

    rawVoiceEnergy = avgVolume * 0.7 + highEnergy * 0.3;
    rawVoiceEnergy = Math.min(1, rawVoiceEnergy * 2.5);

    requestAnimationFrame(analyseVoice);
  }


  // --- Done button ---
  doneBtn.addEventListener('click', () => {
    if (done) return;
    done = true;
    stopMic();
    hiddenInput.blur();
    doneBtn.style.transition = 'opacity 1s';
    doneBtn.style.opacity = '0';
    doneBtn.style.pointerEvents = 'none';
    modeToggle.style.transition = 'opacity 1s';
    modeToggle.style.opacity = '0';
    modeToggle.style.pointerEvents = 'none';
    privacyNote.classList.remove('visible');
    infoIcon.classList.remove('visible');
    ringText.classList.add('collapse-text');
    if (window.VoidFeedback) {
      const releaseText = mode === 'voice' ? (transcript + interimTranscript) : typedText;
      window.VoidFeedback.recordRelease({
        inputMode: mode,
        releaseLength: releaseText.trim().length,
      });
    }
    if (window.VoidCollapse) {
      window.VoidCollapse();
    }
  });


  // --- Show UI after ring forms ---
  let uiShown = false;
  function showUI() {
    if (uiShown) return;
    uiShown = true;
    modeToggle.classList.add('visible');
    privacyNote.classList.add('visible');
    infoIcon.classList.add('visible');
    mode = 'type';
    updateTypeMode();
    updateRingText('', true);
    hiddenInput.focus();
    if (window.VoidFeedback) window.VoidFeedback.startSession();
  }

  function reset() {
    done = false;
    uiShown = false;
    energy = 0;
    rawVoiceEnergy = 0;
    rawTypeEnergy = 0;
    isActive = false;
    isListening = false;
    typedText = '';
    transcript = '';
    interimTranscript = '';
    keyTimes = [];
    hiddenInput.value = '';
    updateRingText('', false);
    ringText.classList.remove('active', 'collapse-text');
    ringText.style.opacity = '';
    ringText.style.transition = '';
    doneBtn.classList.remove('visible');
    doneBtn.style.opacity = '';
    doneBtn.style.pointerEvents = '';
    doneBtn.style.bottom = '';
    modeToggle.classList.remove('visible');
    modeToggle.style.opacity = '';
    modeToggle.style.pointerEvents = '';
    privacyNote.classList.remove('visible');
    infoIcon.classList.remove('visible');
    infoModal.classList.remove('visible');
    voiceUnsupportedEl.classList.remove('show');
  }


  // --- Keyboard avoidance (mobile) ---
  // On-screen keyboards overlay the bottom of the layout viewport without
  // resizing it (window.innerHeight is unchanged — only visualViewport
  // shrinks), so fixed-position controls near the bottom get covered.
  // The VisualViewport API reports the actually-visible area, letting us
  // reposition the "Let It Go" button to sit just above the keyboard.
  //
  // The ring itself is rendered on a canvas sized from window.innerHeight,
  // so it never moves when the keyboard opens — and ring-text's normal
  // position (anchored to that same unchanging window height) is already
  // close to the ring in the visible area, so it's left alone here too.
  // The mode toggle (type/speak) is also left alone — it's fine for it to
  // sit behind the keyboard since it isn't needed while actively typing.
  const DONE_BTN_KEYBOARD_GAP = 16;
  if (window.visualViewport) {
    const vv = window.visualViewport;
    const adjustForKeyboard = () => {
      // Only reposition while the hidden input actually has focus — this is
      // the only scenario where a real on-screen keyboard should be open.
      // Reacting to any viewport resize (e.g. mobile browser chrome
      // hiding/showing) would misfire while in voice mode or idle.
      const keyboardVisible = mode === 'type' && document.activeElement === hiddenInput;
      const keyboardHeight = keyboardVisible
        ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
        : 0;
      const keyboardOpen = keyboardHeight > 60;
      doneBtn.style.bottom = keyboardOpen
        ? `${keyboardHeight + DONE_BTN_KEYBOARD_GAP}px`
        : '';
    };
    vv.addEventListener('resize', adjustForKeyboard);
    vv.addEventListener('scroll', adjustForKeyboard);
  }

  // --- Smooth energy output ---
  function updateEnergy() {
    const target = mode === 'voice' ? rawVoiceEnergy : rawTypeEnergy;
    const riseSpeed = 0.12;
    const fallSpeed = 0.03;
    if (target > energy) {
      energy += (target - energy) * riseSpeed;
    } else {
      energy += (target - energy) * fallSpeed;
    }
    energy = Math.max(0, Math.min(1, energy));
  }

  function tick() {
    updateEnergy();
    requestAnimationFrame(tick);
  }
  tick();


  // --- Public API ---
  return {
    getEnergy: () => energy,
    getRawVoice: () => rawVoiceEnergy,
    getRawType: () => rawTypeEnergy,
    isActive: () => isActive,
    isListening: () => isListening,
    isDone: () => done,
    getMode: () => mode,
    showUI,
    reset,
  };

})();
