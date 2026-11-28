/**
 * Vua Đầu Bếp Việt Nam — AAA 3D Tabletop, Tactile VFX & Procedural Audio Module
 * Exposes `window.VdbAAA` with 3 self-contained offline subsystems:
 *   1. `VdbAAA.enhanceScene(ctx)` / `upgradeChefStandee(...)` / `setPeekMode(enabled)`
 *   2. `VdbAAA.vfx`   — Tactile 2D/DOM boardgame juice & Vietnamese festival confetti
 *   3. `VdbAAA.audio` — Multi-layered Web Audio synthesis, pentatonic lo-fi loop & haptics
 *
 * Strictly self-contained offline (zero remote URLs), respects `prefers-reduced-motion`,
 * mobile WebGL friendly (max 1.5x DPR, demand-driven rendering via `requestRender`).
 */
(function (global) {
  'use strict';

  if (global.VdbAAA && global.VdbAAA.__loaded) return;

  // ==========================================
  // 0. SHARED ENVIRONMENT & PREFERENCES HELPERS
  // ==========================================
  const HAS_DOM = typeof window !== 'undefined' && typeof document !== 'undefined';

  const reducedMotionQuery = (HAS_DOM && typeof window.matchMedia === 'function')
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;
  let reducedMotionOverride = null;

  function prefersReducedMotion() {
    if (typeof reducedMotionOverride === 'boolean') return reducedMotionOverride;
    return !!(reducedMotionQuery && reducedMotionQuery.matches);
  }

  function storageGet(key, fallback) {
    try {
      const v = global.localStorage && global.localStorage.getItem(key);
      return v === null || v === undefined ? fallback : v;
    } catch (_) {
      return fallback;
    }
  }

  function storageSet(key, value) {
    try {
      if (global.localStorage) global.localStorage.setItem(key, String(value));
    } catch (_) { /* ignore quota / private mode errors */ }
  }

  function clamp(val, min, max) {
    return val < min ? min : (val > max ? max : val);
  }

  function drawRoundRect(ctx, x, y, w, h, r) {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  function fitCanvasText(ctx, text, x, y, maxW) {
    const str = String(text || '');
    const w = ctx.measureText(str).width;
    if (w <= maxW || w <= 0) {
      ctx.fillText(str, x, y);
      return;
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(maxW / w, 1);
    ctx.fillText(str, 0, 0);
    ctx.restore();
  }

  const CHEF_FALLBACK_META = {
    lola:     { name: 'Cô Ba',    avatar: '👩‍🍳', colorHex: '#ec4899' },
    angus:    { name: 'Mệ Thảo',  avatar: '👵',  colorHex: '#dc2626' },
    chen:     { name: 'Chú Bảy',  avatar: '👨‍🍳', colorHex: '#0d9488' },
    lucrezia: { name: 'Dì Năm',   avatar: '👩‍🌾', colorHex: '#eab308' },
    hai:      { name: 'Chị Hai',  avatar: '👩‍🦰', colorHex: '#8b5cf6' },
    sau:      { name: 'Anh Sáu',  avatar: '🧔',  colorHex: '#2563eb' },
    tam:      { name: 'Bà Tám',   avatar: '👩‍🦳', colorHex: '#f97316' },
    muoi:     { name: 'Út Mười',  avatar: '🧑‍🌾', colorHex: '#65a30d' },
  };

  // ==========================================
  // 1. PROCEDURAL WEB AUDIO & HAPTICS SUBSYSTEM
  // ==========================================
  const audioState = {
    ctx: null,
    masterGain: null,
    sfxGain: null,
    musicGain: null,
    noiseBuffer: null,
    muted: storageGet('vdb_muted', '0') === '1',
    musicOn: storageGet('vdb_music', '0') === '1',
    musicTimer: null,
    musicStep: 0,
    musicPendingStart: false,
    lastTickSec: -1,
    lastTickAt: 0,
    gestureBound: false,
  };

  function ensureAudioContext() {
    if (!HAS_DOM) return null;
    if (!audioState.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try {
        const ctx = new AC();
        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -14;
        compressor.knee.value = 18;
        compressor.ratio.value = 4;
        compressor.attack.value = 0.005;
        compressor.release.value = 0.14;

        const master = ctx.createGain();
        master.gain.value = audioState.muted ? 0.0001 : 0.92;

        const sfx = ctx.createGain();
        sfx.gain.value = 1.0;

        const music = ctx.createGain();
        music.gain.value = audioState.musicOn && !audioState.muted ? 0.065 : 0.0001;

        sfx.connect(master);
        music.connect(master);
        master.connect(compressor);
        compressor.connect(ctx.destination);

        audioState.ctx = ctx;
        audioState.masterGain = master;
        audioState.sfxGain = sfx;
        audioState.musicGain = music;
      } catch (_) {
        return null;
      }
    }
    if (audioState.ctx && audioState.ctx.state === 'suspended') {
      try { audioState.ctx.resume().catch(() => {}); } catch (_) {}
    }
    return audioState.ctx;
  }

  function getNoiseBuffer(ctx) {
    if (audioState.noiseBuffer && audioState.noiseBuffer.sampleRate === ctx.sampleRate) {
      return audioState.noiseBuffer;
    }
    const len = Math.floor(ctx.sampleRate * 0.6);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      // Slightly warm filtered noise spectrum
      last = (last + 0.35 * white) / 1.35;
      data[i] = white * 0.65 + last * 0.35;
    }
    audioState.noiseBuffer = buf;
    return buf;
  }

  function scheduleTone(ctx, dest, opts) {
    const now = ctx.currentTime + (opts.delay || 0);
    const dur = Math.max(0.015, opts.dur || 0.15);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    let tail = osc;

    osc.type = opts.type || 'sine';
    const f0 = Math.max(20, opts.f0 || 440);
    const f1 = Math.max(20, opts.f1 !== undefined ? opts.f1 : f0);
    osc.frequency.setValueAtTime(f0, now);
    if (f1 !== f0) {
      if (opts.linearFreq) osc.frequency.linearRampToValueAtTime(f1, now + dur);
      else osc.frequency.exponentialRampToValueAtTime(f1, now + dur);
    }

    if (opts.filterFreq) {
      const filter = ctx.createBiquadFilter();
      filter.type = opts.filterType || 'lowpass';
      filter.frequency.setValueAtTime(opts.filterFreq, now);
      if (opts.filterQ) filter.Q.value = opts.filterQ;
      tail.connect(filter);
      tail = filter;
    }

    const vol = Math.max(0.001, opts.vol || 0.12);
    const attack = Math.min(dur * 0.4, opts.attack !== undefined ? opts.attack : 0.008);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(vol, now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    tail.connect(gain);
    gain.connect(dest);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  function scheduleNoise(ctx, dest, opts) {
    const now = ctx.currentTime + (opts.delay || 0);
    const dur = Math.max(0.015, opts.dur || 0.12);
    const src = ctx.createBufferSource();
    src.buffer = getNoiseBuffer(ctx);

    const filter = ctx.createBiquadFilter();
    filter.type = opts.filterType || 'bandpass';
    filter.frequency.setValueAtTime(opts.freq || 2400, now);
    if (opts.freqEnd) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(80, opts.freqEnd), now + dur);
    }
    filter.Q.value = opts.Q !== undefined ? opts.Q : 1.2;

    const gain = ctx.createGain();
    const vol = Math.max(0.001, opts.vol || 0.08);
    const attack = Math.min(dur * 0.35, opts.attack !== undefined ? opts.attack : 0.006);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(vol, now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    src.start(now, Math.random() * 0.25, dur + 0.02);
  }

  function vibrate(pattern) {
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(pattern);
      }
    } catch (_) { /* ignore blocked haptics */ }
  }

  function playSfx(type, opts) {
    if (audioState.muted) return;
    const ctx = ensureAudioContext();
    if (!ctx || !audioState.sfxGain) return;
    const out = audioState.sfxGain;
    const o = opts || {};

    switch (type) {
      case 'coin': {
        // Metallic dual-clink + bright harmonic shimmer
        scheduleNoise(ctx, out, { dur: 0.028, freq: 5200, Q: 2.0, vol: 0.05 });
        scheduleTone(ctx, out, { type: 'triangle', f0: 1568, f1: 1585, dur: 0.14, vol: 0.16, attack: 0.004 });
        scheduleTone(ctx, out, { type: 'sine', f0: 3136, f1: 3180, dur: 0.11, vol: 0.06, attack: 0.003 });
        scheduleTone(ctx, out, { type: 'triangle', f0: 2093, f1: 2110, dur: 0.24, vol: 0.18, delay: 0.065, attack: 0.004 });
        scheduleTone(ctx, out, { type: 'sine', f0: 4186, dur: 0.18, vol: 0.05, delay: 0.068, attack: 0.003 });
        break;
      }

      case 'bell': {
        // Classic brass kitchen service bell with realistic inharmonic partials
        scheduleNoise(ctx, out, { dur: 0.022, freq: 4400, Q: 3.0, vol: 0.06 });
        scheduleTone(ctx, out, { type: 'sine', f0: 1568, dur: 0.85, vol: 0.22, attack: 0.003 });
        scheduleTone(ctx, out, { type: 'sine', f0: 1568 * 2.756, dur: 0.42, vol: 0.08, attack: 0.003 });
        scheduleTone(ctx, out, { type: 'triangle', f0: 1568 * 1.995, dur: 0.55, vol: 0.06, attack: 0.004 });
        scheduleTone(ctx, out, { type: 'sine', f0: 784, dur: 0.52, vol: 0.07, attack: 0.005 });
        break;
      }

      case 'hop': {
        // Warm wooden boardgame pawn hop
        scheduleTone(ctx, out, { type: 'sine', f0: 290, f1: 580, dur: 0.095, vol: 0.17, attack: 0.004 });
        scheduleTone(ctx, out, { type: 'triangle', f0: 185, f1: 110, dur: 0.055, vol: 0.09, attack: 0.003 });
        scheduleNoise(ctx, out, { dur: 0.025, freq: 1100, Q: 1.5, vol: 0.04 });
        break;
      }

      case 'cook': {
        // Wok sizzle + celebratory Vietnamese pentatonic fanfare chord
        scheduleNoise(ctx, out, {
          filterType: 'bandpass', freq: 3400, freqEnd: 5800, Q: 0.85,
          dur: 0.34, vol: 0.12, attack: 0.035,
        });
        scheduleNoise(ctx, out, {
          filterType: 'highpass', freq: 5000, Q: 0.7,
          dur: 0.22, vol: 0.06, delay: 0.06, attack: 0.02,
        });
        const notes = [523.25, 587.33, 659.25, 783.99, 1046.5];
        notes.forEach((freq, i) => {
          scheduleTone(ctx, out, {
            type: 'triangle', f0: freq, dur: 0.38, vol: 0.14,
            delay: 0.08 + i * 0.055, attack: 0.008, filterFreq: 3800,
          });
          scheduleTone(ctx, out, {
            type: 'sine', f0: freq * 2, dur: 0.24, vol: 0.045,
            delay: 0.085 + i * 0.055, attack: 0.006,
          });
        });
        vibrate([20, 25, 35]);
        break;
      }

      case 'card': {
        // Crisp linen playing-card snap
        scheduleNoise(ctx, out, { filterType: 'highpass', freq: 2200, Q: 0.9, dur: 0.048, vol: 0.12, attack: 0.002 });
        scheduleNoise(ctx, out, { filterType: 'bandpass', freq: 950, Q: 1.4, dur: 0.055, vol: 0.08, attack: 0.002 });
        scheduleTone(ctx, out, { type: 'triangle', f0: 680, f1: 260, dur: 0.055, vol: 0.08, attack: 0.002 });
        break;
      }

      case 'error': {
        // Soft woody double bonk (clear, never harsh)
        scheduleTone(ctx, out, { type: 'triangle', f0: 210, f1: 145, dur: 0.13, vol: 0.16, filterFreq: 900 });
        scheduleTone(ctx, out, { type: 'sawtooth', f0: 165, f1: 112, dur: 0.17, vol: 0.08, delay: 0.09, filterFreq: 680 });
        vibrate(35);
        break;
      }

      case 'trumpet': {
        // Warm festival brass fanfare
        const fanfare = [
          { f: 392.0,  d: 0.14, t: 0.00, v: 0.11 },
          { f: 523.25, d: 0.14, t: 0.11, v: 0.12 },
          { f: 659.25, d: 0.16, t: 0.22, v: 0.13 },
          { f: 783.99, d: 0.52, t: 0.34, v: 0.15 },
        ];
        fanfare.forEach(n => {
          scheduleTone(ctx, out, { type: 'sawtooth', f0: n.f, dur: n.d, vol: n.v * 0.55, delay: n.t, attack: 0.014, filterFreq: 2100 });
          scheduleTone(ctx, out, { type: 'triangle', f0: n.f, dur: n.d, vol: n.v, delay: n.t, attack: 0.012 });
        });
        // Warm backing fifth on final chord
        scheduleTone(ctx, out, { type: 'triangle', f0: 523.25, dur: 0.48, vol: 0.08, delay: 0.34, attack: 0.015 });
        scheduleTone(ctx, out, { type: 'sine', f0: 1046.5, dur: 0.45, vol: 0.06, delay: 0.36, attack: 0.02 });
        vibrate([25, 30, 45]);
        break;
      }

      case 'trash': {
        // Bag crinkle + hollow bin drop
        scheduleNoise(ctx, out, { filterType: 'bandpass', freq: 1800, freqEnd: 700, Q: 1.1, dur: 0.16, vol: 0.11 });
        scheduleTone(ctx, out, { type: 'triangle', f0: 185, f1: 62, dur: 0.20, vol: 0.18, attack: 0.006 });
        scheduleNoise(ctx, out, { filterType: 'highpass', freq: 3200, dur: 0.09, vol: 0.05, delay: 0.05 });
        break;
      }

      case 'dial': {
        // Tactile mechanical wheel click
        scheduleNoise(ctx, out, { filterType: 'bandpass', freq: 3200, Q: 2.2, dur: 0.024, vol: 0.11, attack: 0.001 });
        scheduleTone(ctx, out, { type: 'triangle', f0: 980, f1: 310, dur: 0.038, vol: 0.11, attack: 0.001 });
        break;
      }

      case 'gavel': {
        // Authoritative hardwood auction gavel slam + secondary bounce
        scheduleNoise(ctx, out, { filterType: 'bandpass', freq: 1450, Q: 1.5, dur: 0.075, vol: 0.20, attack: 0.002 });
        scheduleTone(ctx, out, { type: 'triangle', f0: 165, f1: 54, dur: 0.14, vol: 0.26, attack: 0.002 });
        scheduleTone(ctx, out, { type: 'square', f0: 340, f1: 118, dur: 0.06, vol: 0.08, filterFreq: 1100, attack: 0.002 });
        // Second quick authoritative knock
        scheduleNoise(ctx, out, { filterType: 'bandpass', freq: 1650, Q: 1.8, dur: 0.055, vol: 0.14, delay: 0.125, attack: 0.002 });
        scheduleTone(ctx, out, { type: 'triangle', f0: 195, f1: 66, dur: 0.11, vol: 0.19, delay: 0.125, attack: 0.002 });
        vibrate([30, 35, 50]);
        break;
      }

      case 'tick': {
        // Crisp wooden clock tick (supports optional pitch scaling for urgency)
        const pitch = clamp(Number(o.pitch) || 1.0, 0.7, 1.8);
        const vol = clamp(Number(o.vol) || 0.13, 0.05, 0.25);
        scheduleNoise(ctx, out, { filterType: 'bandpass', freq: 2900 * pitch, Q: 3.2, dur: 0.022, vol: vol * 0.75, attack: 0.001 });
        scheduleTone(ctx, out, { type: 'triangle', f0: 880 * pitch, f1: 420 * pitch, dur: 0.042, vol, attack: 0.001 });
        if (o.double) {
          scheduleTone(ctx, out, { type: 'triangle', f0: 1180 * pitch, f1: 580 * pitch, dur: 0.038, vol: vol * 0.85, delay: 0.11, attack: 0.001 });
        }
        break;
      }

      case 'emote': {
        // Playful rising reaction bubble pop
        scheduleTone(ctx, out, { type: 'sine', f0: 440, f1: 920, dur: 0.11, vol: 0.14, attack: 0.005 });
        scheduleTone(ctx, out, { type: 'triangle', f0: 1320, f1: 1580, dur: 0.08, vol: 0.06, delay: 0.045, attack: 0.004 });
        break;
      }

      case 'event': {
        // Mystical Vietnamese bronze market gong for Daily Event
        scheduleNoise(ctx, out, { filterType: 'lowpass', freq: 650, Q: 1.0, dur: 0.11, vol: 0.12, attack: 0.004 });
        scheduleTone(ctx, out, { type: 'sine', f0: 196, f1: 192, dur: 1.35, vol: 0.20, attack: 0.012 });
        scheduleTone(ctx, out, { type: 'triangle', f0: 294, f1: 291, dur: 1.05, vol: 0.10, attack: 0.018, filterFreq: 1400 });
        scheduleTone(ctx, out, { type: 'sine', f0: 416, f1: 412, dur: 0.88, vol: 0.075, attack: 0.025 });
        scheduleTone(ctx, out, { type: 'sine', f0: 588, dur: 0.70, vol: 0.055, delay: 0.03, attack: 0.02 });
        break;
      }

      default: {
        scheduleTone(ctx, out, { type: 'sine', f0: 660, f1: 880, dur: 0.08, vol: 0.10 });
        break;
      }
    }
  }

  function tickCountdown(secondsLeft) {
    const sec = Math.ceil(Number(secondsLeft));
    if (!Number.isFinite(sec) || sec < 1 || sec > 10) return;
    const now = Date.now();
    if (sec === audioState.lastTickSec && now - audioState.lastTickAt < 900) return;
    audioState.lastTickSec = sec;
    audioState.lastTickAt = now;

    // Escalate urgency as timer counts 10 -> 1
    const urgency = (11 - sec) / 10; // 0.1 .. 1.0
    const pitch = 0.92 + urgency * 0.45;
    const vol = 0.10 + urgency * 0.10;
    playSfx('tick', { pitch, vol, double: sec <= 3 });
    if (sec <= 3) vibrate(16);
  }

  // Gentle procedural Vietnamese pentatonic lo-fi ambient loop
  // Scale: C-D-F-G-A (warm folk ngũ cung)
  const PENTA_MELODY = [
    523.25, 0, 587.33, 698.46, 783.99, 0, 698.46, 587.33,
    523.25, 0, 440.00, 392.00, 523.25, 0, 0, 587.33,
    698.46, 0, 783.99, 880.00, 783.99, 0, 698.46, 587.33,
    523.25, 587.33, 440.00, 0, 392.00, 0, 440.00, 0,
  ];
  const PENTA_BASS = [
    130.81, 0, 0, 0, 174.61, 0, 0, 0,
    196.00, 0, 0, 0, 130.81, 0, 0, 0,
    174.61, 0, 0, 0, 196.00, 0, 0, 0,
    146.83, 0, 0, 0, 196.00, 0, 130.81, 0,
  ];

  function stepAmbientMusic() {
    if (!audioState.musicOn || audioState.muted) return;
    if (HAS_DOM && document.visibilityState === 'hidden') return;
    const ctx = audioState.ctx;
    if (!ctx || ctx.state !== 'running' || !audioState.musicGain) return;

    const out = audioState.musicGain;
    const idx = audioState.musicStep % PENTA_MELODY.length;
    audioState.musicStep = (audioState.musicStep + 1) % PENTA_MELODY.length;

    const mel = PENTA_MELODY[idx];
    const bass = PENTA_BASS[idx];

    if (mel > 0) {
      // Soft đàn tranh / kalimba plucked pentatonic note
      const detuneFactor = 1 + (Math.random() - 0.5) * 0.003;
      scheduleTone(ctx, out, {
        type: 'triangle',
        f0: mel * detuneFactor,
        dur: 0.62,
        vol: 0.42,
        attack: 0.012,
        filterFreq: 1650,
      });
      scheduleTone(ctx, out, {
        type: 'sine',
        f0: mel * 2,
        dur: 0.22,
        vol: 0.11,
        attack: 0.008,
      });
    }

    if (bass > 0) {
      // Warm gentle low lo-fi bass pad
      scheduleTone(ctx, out, {
        type: 'sine',
        f0: bass,
        dur: 1.15,
        vol: 0.48,
        attack: 0.06,
      });
    }

    // Subtle wooden percussion pulse on offbeats
    if (idx % 4 === 2) {
      scheduleNoise(ctx, out, {
        filterType: 'bandpass', freq: 2400, Q: 2.0, dur: 0.032, vol: 0.14, attack: 0.002,
      });
    }
  }

  function startMusicLoop() {
    if (audioState.musicTimer) return;
    const ctx = ensureAudioContext();
    if (!ctx) return;
    if (audioState.musicGain && !audioState.muted) {
      try {
        audioState.musicGain.gain.setTargetAtTime(0.065, ctx.currentTime, 0.15);
      } catch (_) {}
    }
    audioState.musicTimer = setInterval(stepAmbientMusic, 360); // ~83 BPM 8th-notes
    stepAmbientMusic();
  }

  function stopMusicLoop() {
    if (audioState.musicTimer) {
      clearInterval(audioState.musicTimer);
      audioState.musicTimer = null;
    }
    if (audioState.ctx && audioState.musicGain) {
      try {
        audioState.musicGain.gain.setTargetAtTime(0.0001, audioState.ctx.currentTime, 0.12);
      } catch (_) {}
    }
  }

  function syncAudioGain() {
    if (!audioState.ctx || !audioState.masterGain || !audioState.musicGain) return;
    const t = audioState.ctx.currentTime;
    try {
      audioState.masterGain.gain.setTargetAtTime(audioState.muted ? 0.0001 : 0.92, t, 0.04);
      audioState.musicGain.gain.setTargetAtTime(audioState.musicOn && !audioState.muted ? 0.065 : 0.0001, t, 0.12);
    } catch (_) {}
  }

  function setMuted(flag) {
    audioState.muted = !!flag;
    storageSet('vdb_muted', audioState.muted ? '1' : '0');
    syncAudioGain();
    if (audioState.muted) stopMusicLoop();
    else if (audioState.musicOn) startMusicLoop();
    return audioState.muted;
  }

  function toggleMute() {
    return setMuted(!audioState.muted);
  }

  function isMuted() {
    return audioState.muted;
  }

  function setMusic(flag) {
    audioState.musicOn = !!flag;
    storageSet('vdb_music', audioState.musicOn ? '1' : '0');
    if (audioState.musicOn && !audioState.muted) {
      startMusicLoop();
    } else {
      stopMusicLoop();
    }
    syncAudioGain();
    return audioState.musicOn;
  }

  function toggleMusic() {
    return setMusic(!audioState.musicOn);
  }

  function isMusicOn() {
    return audioState.musicOn;
  }

  function unlockAudioOnFirstGesture() {
    if (!HAS_DOM || audioState.gestureBound) return;
    audioState.gestureBound = true;
    const onFirstGesture = () => {
      if (audioState.musicOn && !audioState.muted) {
        ensureAudioContext();
        startMusicLoop();
      } else if (audioState.ctx && audioState.ctx.state === 'suspended') {
        try { audioState.ctx.resume().catch(() => {}); } catch (_) {}
      }
      window.removeEventListener('pointerdown', onFirstGesture, true);
      window.removeEventListener('keydown', onFirstGesture, true);
    };
    window.addEventListener('pointerdown', onFirstGesture, true);
    window.addEventListener('keydown', onFirstGesture, true);
  }
  unlockAudioOnFirstGesture();

  const audioAPI = {
    play: playSfx,
    toggleMute,
    setMuted,
    isMuted,
    toggleMusic,
    setMusic,
    isMusicOn,
    tickCountdown,
    vibrate,
    unlock: ensureAudioContext,
  };

  // ==========================================
  // 2. TACTILE 2D / DOM BOARDGAME VFX SUBSYSTEM
  // ==========================================
  let vfxLayer = null;
  let vfxStyleInjected = false;
  let emoteLaneCounter = 0;

  function ensureVfxLayer() {
    if (!HAS_DOM || !document.body) return null;
    if (!vfxStyleInjected) {
      vfxStyleInjected = true;
      const st = document.createElement('style');
      st.id = 'vdb-aaa-vfx-styles';
      st.textContent = `
        #vdb-aaa-vfx-layer {
          position: fixed;
          inset: 0;
          z-index: 120;
          pointer-events: none;
          overflow: hidden;
        }
        .vdb-vfx-coin {
          position: absolute;
          transform: translate(-50%, -50%);
          font: 900 17px/1 system-ui, -apple-system, sans-serif;
          padding: 4px 10px;
          border-radius: 999px;
          white-space: nowrap;
          text-shadow: 0 2px 6px rgba(0,0,0,0.85);
          box-shadow: 0 6px 18px rgba(0,0,0,0.45);
          will-change: transform, opacity;
          animation: vdbCoinFloat 1050ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }
        .vdb-vfx-coin.pos {
          background: linear-gradient(135deg, rgba(16,185,129,0.95), rgba(5,150,105,0.92));
          color: #fef08a;
          border: 1.5px solid #fde047;
        }
        .vdb-vfx-coin.neg {
          background: linear-gradient(135deg, rgba(225,29,72,0.94), rgba(159,18,57,0.92));
          color: #fff1f2;
          border: 1.5px solid #fda4af;
        }
        @keyframes vdbCoinFloat {
          0%   { opacity: 0; transform: translate(-50%, -40%) scale(0.65); }
          18%  { opacity: 1; transform: translate(-50%, -65%) scale(1.12); }
          72%  { opacity: 1; transform: translate(-50%, -125%) scale(1.0); }
          100% { opacity: 0; transform: translate(-50%, -165%) scale(0.88); }
        }
        .vdb-vfx-steam {
          position: absolute;
          width: 28px;
          height: 28px;
          border-radius: 999px;
          background: radial-gradient(circle, rgba(255,248,220,0.75) 0%, rgba(251,191,36,0.28) 55%, rgba(255,255,255,0) 75%);
          transform: translate(-50%, -50%);
          will-change: transform, opacity;
          animation: vdbSteamRise 850ms ease-out forwards;
        }
        @keyframes vdbSteamRise {
          0%   { opacity: 0.85; transform: translate(-50%, -50%) scale(0.45); }
          100% { opacity: 0; transform: translate(calc(-50% + var(--dx, 0px)), calc(-50% - 58px)) scale(1.9); }
        }
        .vdb-vfx-star {
          position: absolute;
          left: 0;
          top: 0;
          font-size: 22px;
          line-height: 1;
          filter: drop-shadow(0 0 8px rgba(251, 191, 36, 0.95));
          will-change: transform, opacity;
        }
        .vdb-vfx-trash-puff {
          position: absolute;
          border-radius: 999px;
          background: radial-gradient(circle, rgba(163, 184, 128, 0.82) 0%, rgba(87, 83, 78, 0.55) 55%, rgba(41, 37, 36, 0) 76%);
          transform: translate(-50%, -50%);
          will-change: transform, opacity;
          animation: vdbTrashPuff 660ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        @keyframes vdbTrashPuff {
          0%   { opacity: 0.9; transform: translate(-50%, -50%) scale(0.35); }
          100% { opacity: 0; transform: translate(calc(-50% + var(--dx, 0px)), calc(-50% + var(--dy, -24px))) scale(1.65); }
        }
        .vdb-vfx-gavel-wrap {
          position: absolute;
          left: 50%;
          top: 44%;
          transform: translate(-50%, -50%);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
        }
        .vdb-vfx-gavel-ring {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 120px;
          height: 120px;
          border-radius: 999px;
          border: 4px solid #fbbf24;
          box-shadow: 0 0 28px rgba(245,158,11,0.85), inset 0 0 22px rgba(251,191,36,0.45);
          transform: translate(-50%, -50%) scale(0.3);
          animation: vdbGavelRing 620ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        @keyframes vdbGavelRing {
          0%   { opacity: 0.95; transform: translate(-50%, -50%) scale(0.28); }
          100% { opacity: 0; transform: translate(-50%, -50%) scale(2.15); }
        }
        .vdb-vfx-gavel-icon {
          font-size: 64px;
          line-height: 1;
          filter: drop-shadow(0 8px 20px rgba(0,0,0,0.8));
          transform-origin: 70% 80%;
          animation: vdbGavelSlam 680ms cubic-bezier(0.2, 0.95, 0.3, 1) forwards;
        }
        @keyframes vdbGavelSlam {
          0%   { opacity: 0; transform: rotate(-55deg) scale(0.75); }
          22%  { opacity: 1; transform: rotate(-42deg) scale(1.18); }
          44%  { opacity: 1; transform: rotate(16deg) scale(1.06); }
          64%  { opacity: 1; transform: rotate(-4deg) scale(1.0); }
          100% { opacity: 0; transform: rotate(0deg) scale(0.92) translateY(-10px); }
        }
        .vdb-vfx-gavel-label {
          font: 900 14px/1.2 system-ui, -apple-system, sans-serif;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #fef3c7;
          background: linear-gradient(135deg, rgba(180,83,9,0.95), rgba(153,27,27,0.95));
          border: 2px solid #fbbf24;
          border-radius: 999px;
          padding: 4px 14px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.65);
          animation: vdbBannerPop 720ms ease-out forwards;
        }
        .vdb-vfx-milestone {
          position: absolute;
          left: 50%;
          top: 22%;
          transform: translate(-50%, -50%);
          font: 900 16px/1.25 system-ui, -apple-system, sans-serif;
          color: #fef3c7;
          background: linear-gradient(135deg, rgba(146,64,14,0.96), rgba(185,28,28,0.94));
          border: 2px solid #fde047;
          border-radius: 16px;
          padding: 10px 20px;
          text-align: center;
          box-shadow: 0 12px 34px rgba(0,0,0,0.7), 0 0 24px rgba(251,191,36,0.45);
          animation: vdbMilestoneAnim 1950ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }
        @keyframes vdbMilestoneAnim {
          0%   { opacity: 0; transform: translate(-50%, -30%) scale(0.75); }
          14%  { opacity: 1; transform: translate(-50%, -50%) scale(1.06); }
          80%  { opacity: 1; transform: translate(-50%, -52%) scale(1.0); }
          100% { opacity: 0; transform: translate(-50%, -72%) scale(0.95); }
        }
        @keyframes vdbBannerPop {
          0%   { opacity: 0; transform: scale(0.7); }
          25%  { opacity: 1; transform: scale(1.06); }
          75%  { opacity: 1; transform: scale(1.0); }
          100% { opacity: 0; transform: scale(0.94); }
        }
        .vdb-vfx-emote {
          position: absolute;
          display: inline-flex;
          align-items: center;
          gap: 7px;
          padding: 6px 12px 6px 8px;
          border-radius: 999px;
          background: rgba(18, 14, 12, 0.92);
          border: 1.5px solid rgba(251, 191, 36, 0.78);
          box-shadow: 0 10px 26px rgba(0, 0, 0, 0.55), 0 0 14px rgba(245, 158, 11, 0.25);
          color: #fef3c7;
          font: 700 12px/1.1 system-ui, -apple-system, sans-serif;
          will-change: transform, opacity;
          animation: vdbEmoteFloat 2600ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }
        .vdb-vfx-emote-emoji {
          font-size: 24px;
          line-height: 1;
        }
        .vdb-vfx-emote-meta {
          display: flex;
          flex-direction: column;
          gap: 1px;
        }
        .vdb-vfx-emote-name {
          font-weight: 800;
          color: #fde68a;
          font-size: 11px;
          max-width: 140px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        @keyframes vdbEmoteFloat {
          0%   { opacity: 0; transform: translate3d(0, 18px, 0) scale(0.7); }
          14%  { opacity: 1; transform: translate3d(0, 0, 0) scale(1.06); }
          24%  { opacity: 1; transform: translate3d(0, -6px, 0) scale(1.0); }
          80%  { opacity: 1; transform: translate3d(0, -64px, 0) scale(1.0); }
          100% { opacity: 0; transform: translate3d(0, -96px, 0) scale(0.92); }
        }
        .vdb-vfx-shake {
          animation: vdbScreenShake 320ms cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
        }
        @keyframes vdbScreenShake {
          0%, 100% { transform: translate3d(0, 0, 0); }
          15%      { transform: translate3d(-5px, 3px, 0); }
          32%      { transform: translate3d(5px, -3px, 0); }
          50%      { transform: translate3d(-4px, -2px, 0); }
          68%      { transform: translate3d(3px, 2px, 0); }
          84%      { transform: translate3d(-2px, 1px, 0); }
        }
        .vdb-vfx-target-pop {
          animation: vdbTargetPop 340ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        @keyframes vdbTargetPop {
          0%   { transform: scale(1); }
          45%  { transform: scale(1.24); filter: brightness(1.35); }
          100% { transform: scale(1); }
        }
        .vdb-vfx-bell-ring {
          position: absolute;
          width: 72px;
          height: 72px;
          border-radius: 999px;
          border: 3px solid #fde047;
          box-shadow: 0 0 18px rgba(251, 191, 36, 0.85), inset 0 0 12px rgba(254, 240, 138, 0.45);
          transform: translate(-50%, -50%) scale(0.45);
          will-change: transform, opacity;
          animation: vdbBellRipple 580ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .vdb-vfx-bell-ring.is-outer {
          border-width: 2px;
          border-color: #f59e0b;
          animation-duration: 680ms;
          animation-delay: 85ms;
        }
        @keyframes vdbBellRipple {
          0%   { opacity: 0.95; transform: translate(-50%, -50%) scale(0.45); }
          100% { opacity: 0; transform: translate(-50%, -50%) scale(2.15); }
        }
        @media (prefers-reduced-motion: reduce) {
          .vdb-vfx-shake,
          .vdb-vfx-gavel-icon,
          .vdb-vfx-gavel-ring,
          .vdb-vfx-bell-ring,
          .vdb-vfx-steam,
          .vdb-vfx-trash-puff {
            animation-duration: 1ms !important;
          }
        }
      `;
      document.head.appendChild(st);
    }

    if (!vfxLayer || !vfxLayer.isConnected) {
      vfxLayer = document.getElementById('vdb-aaa-vfx-layer');
      if (!vfxLayer) {
        vfxLayer = document.createElement('div');
        vfxLayer.id = 'vdb-aaa-vfx-layer';
        vfxLayer.setAttribute('aria-hidden', 'true');
        document.body.appendChild(vfxLayer);
      }
    }
    return vfxLayer;
  }

  function resolvePoint(originEl, fallbackSelector, fx, fy) {
    const vw = HAS_DOM ? window.innerWidth : 1280;
    const vh = HAS_DOM ? window.innerHeight : 720;
    let el = null;
    if (originEl && typeof originEl === 'object' && typeof originEl.x === 'number' && typeof originEl.y === 'number') {
      return { x: clamp(originEl.x, 20, vw - 20), y: clamp(originEl.y, 20, vh - 20) };
    }
    if (typeof originEl === 'string' && HAS_DOM) {
      el = document.querySelector(originEl);
    } else if (originEl && typeof originEl.getBoundingClientRect === 'function') {
      el = originEl;
    } else if (fallbackSelector && HAS_DOM) {
      el = document.querySelector(fallbackSelector);
    }
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 || r.height > 0) {
        return {
          x: clamp(r.left + r.width / 2, 24, vw - 24),
          y: clamp(r.top + r.height / 2, 24, vh - 24),
        };
      }
    }
    return { x: vw * (fx || 0.5), y: vh * (fy || 0.52) };
  }

  function pulseTarget(el) {
    if (!el || prefersReducedMotion()) return;
    el.classList.remove('vdb-vfx-target-pop');
    void el.offsetWidth;
    el.classList.add('vdb-vfx-target-pop');
    setTimeout(() => el.classList.remove('vdb-vfx-target-pop'), 380);
  }

  function cookBurst(originEl, stars) {
    const layer = ensureVfxLayer();
    if (!layer) return;
    const count = clamp(Math.round(Number(stars) || 2), 1, 8);
    const start = resolvePoint(originEl, '#recipes-container', 0.5, 0.62);
    const likesEl = document.getElementById('player-likes');
    const target = resolvePoint(likesEl, '#player-likes', 0.22, 0.06);

    // Floating +N⭐ pill right at the cooked dish
    const badge = document.createElement('div');
    badge.className = 'vdb-vfx-coin pos';
    badge.style.left = start.x + 'px';
    badge.style.top = (start.y - 12) + 'px';
    badge.textContent = `+${count}⭐`;
    layer.appendChild(badge);
    setTimeout(() => badge.remove(), 1100);

    if (prefersReducedMotion()) {
      pulseTarget(likesEl);
      return;
    }

    // Warm aromatic steam burst
    for (let i = 0; i < 5; i++) {
      const steam = document.createElement('div');
      steam.className = 'vdb-vfx-steam';
      steam.style.left = (start.x + (Math.random() - 0.5) * 44) + 'px';
      steam.style.top = (start.y + (Math.random() - 0.5) * 20) + 'px';
      steam.style.setProperty('--dx', ((Math.random() - 0.5) * 36).toFixed(1) + 'px');
      steam.style.animationDelay = (i * 55) + 'ms';
      layer.appendChild(steam);
      setTimeout(() => steam.remove(), 1150);
    }

    // Arcing golden ⭐ tokens flying from cooked dish to #player-likes
    for (let i = 0; i < count; i++) {
      const delay = i * 65;
      setTimeout(() => {
        const token = document.createElement('div');
        token.className = 'vdb-vfx-star';
        token.textContent = '⭐';
        layer.appendChild(token);

        const sx = start.x + (Math.random() - 0.5) * 26;
        const sy = start.y + (Math.random() - 0.5) * 14;
        const ex = target.x + (Math.random() - 0.5) * 10;
        const ey = target.y + (Math.random() - 0.5) * 6;
        // Control point arcs outward gracefully
        const cx = (sx + ex) * 0.5 + (sx > ex ? 48 : -48) + (Math.random() - 0.5) * 40;
        const cy = Math.min(sy, ey) - 65 - Math.random() * 45;
        const dur = 640 + Math.random() * 140;
        const t0 = performance.now();

        function step(now) {
          const t = clamp((now - t0) / dur, 0, 1);
          const u = 1 - t;
          const x = u * u * sx + 2 * u * t * cx + t * t * ex;
          const y = u * u * sy + 2 * u * t * cy + t * t * ey;
          const scale = t < 0.25 ? (0.65 + t * 2.4) : (1.25 - (t - 0.25) * 0.65);
          const rot = t * 220 * (i % 2 === 0 ? 1 : -1);
          const opacity = t > 0.85 ? (1 - t) / 0.15 : 1;
          token.style.transform = `translate3d(${(x - 11).toFixed(1)}px, ${(y - 11).toFixed(1)}px, 0) scale(${scale.toFixed(2)}) rotate(${rot.toFixed(0)}deg)`;
          token.style.opacity = opacity.toFixed(2);
          if (t < 1) {
            requestAnimationFrame(step);
          } else {
            token.remove();
            if (i === 0 || i === count - 1) pulseTarget(likesEl);
          }
        }
        requestAnimationFrame(step);
      }, delay);
    }
  }

  function coinFly(originEl, amount) {
    const layer = ensureVfxLayer();
    if (!layer) return;
    const num = Number(amount);
    const isValidNum = Number.isFinite(num) && num !== 0;
    const isPos = isValidNum ? num > 0 : String(amount || '').trim().charAt(0) !== '-';
    const label = isValidNum
      ? `${isPos ? '+' : '-'}$${Math.abs(Math.round(num))}`
      : String(amount || '+$100');

    const pt = resolvePoint(originEl, '#player-money', 0.2, 0.12);
    const pop = document.createElement('div');
    pop.className = 'vdb-vfx-coin ' + (isPos ? 'pos' : 'neg');
    pop.style.left = (pt.x + (Math.random() - 0.5) * 18) + 'px';
    pop.style.top = pt.y + 'px';
    pop.textContent = (isPos ? '🪙 ' : '💸 ') + label;
    layer.appendChild(pop);
    setTimeout(() => pop.remove(), 1120);

    const moneyEl = document.getElementById('player-money');
    if (moneyEl) pulseTarget(moneyEl);
  }

  function gavelSmash(label) {
    const layer = ensureVfxLayer();
    if (!layer) return;

    const wrap = document.createElement('div');
    wrap.className = 'vdb-vfx-gavel-wrap';

    const ring = document.createElement('div');
    ring.className = 'vdb-vfx-gavel-ring';

    const icon = document.createElement('div');
    icon.className = 'vdb-vfx-gavel-icon';
    icon.textContent = '🔨';

    const pill = document.createElement('div');
    pill.className = 'vdb-vfx-gavel-label';
    pill.textContent = typeof label === 'string' && label.trim() ? label.trim() : '⚔️ ĐẤU GIÁ TRANH MUA!';

    wrap.append(ring, icon, pill);
    layer.appendChild(wrap);
    setTimeout(() => wrap.remove(), 780);

    if (!prefersReducedMotion()) {
      const targets = [
        document.getElementById('webgl-canvas'),
        document.querySelector('.hud-layer'),
      ].filter(Boolean);
      targets.forEach(el => {
        el.classList.remove('vdb-vfx-shake');
        void el.offsetWidth;
        el.classList.add('vdb-vfx-shake');
        setTimeout(() => el.classList.remove('vdb-vfx-shake'), 360);
      });
    }
    vibrate([25, 30, 50]);
  }

  function trashBurst(originEl) {
    const layer = ensureVfxLayer();
    if (!layer) return;
    const pt = resolvePoint(originEl, '#header-garbage', 0.35, 0.14);

    if (prefersReducedMotion()) {
      const badge = document.createElement('div');
      badge.className = 'vdb-vfx-coin neg';
      badge.style.left = pt.x + 'px';
      badge.style.top = pt.y + 'px';
      badge.textContent = '🗑️';
      layer.appendChild(badge);
      setTimeout(() => badge.remove(), 700);
      return;
    }

    const puffs = 7;
    for (let i = 0; i < puffs; i++) {
      const angle = (i / puffs) * Math.PI * 2 + Math.random() * 0.5;
      const dist = 22 + Math.random() * 28;
      const puff = document.createElement('div');
      puff.className = 'vdb-vfx-trash-puff';
      const sz = 16 + Math.random() * 14;
      puff.style.width = sz + 'px';
      puff.style.height = sz + 'px';
      puff.style.left = pt.x + 'px';
      puff.style.top = pt.y + 'px';
      puff.style.setProperty('--dx', (Math.cos(angle) * dist).toFixed(1) + 'px');
      puff.style.setProperty('--dy', (Math.sin(angle) * dist - 14).toFixed(1) + 'px');
      layer.appendChild(puff);
      setTimeout(() => puff.remove(), 720);
    }

    const icon = document.createElement('div');
    icon.className = 'vdb-vfx-coin neg';
    icon.style.left = pt.x + 'px';
    icon.style.top = pt.y + 'px';
    icon.textContent = '💨 🗑️';
    layer.appendChild(icon);
    setTimeout(() => icon.remove(), 900);
  }

  function launchConfettiCanvas(durationMs, count) {
    const layer = ensureVfxLayer();
    if (!layer) return;

    if (prefersReducedMotion()) {
      const glow = document.createElement('div');
      glow.style.cssText = 'position:absolute;inset:0;background:radial-gradient(circle at 50% 35%, rgba(251,191,36,0.25), rgba(220,38,38,0.08) 55%, transparent 78%);transition:opacity 0.6s ease;opacity:1;';
      layer.appendChild(glow);
      setTimeout(() => { glow.style.opacity = '0'; }, 600);
      setTimeout(() => glow.remove(), 1250);
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
    layer.appendChild(canvas);

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) { canvas.remove(); return; }
    ctx.scale(dpr, dpr);

    // Vietnamese festival palette: imperial gold, lucky crimson, warm amber, jade, ivory
    const palette = ['#fbbf24', '#ef4444', '#f59e0b', '#dc2626', '#fde047', '#10b981', '#fffbeb'];
    const pieces = [];
    for (let i = 0; i < count; i++) {
      const fromLeft = i % 3 === 0;
      const fromRight = i % 3 === 1;
      const x = fromLeft
        ? w * 0.08 + Math.random() * 48
        : (fromRight ? w * 0.92 - Math.random() * 48 : Math.random() * w);
      const y = (fromLeft || fromRight)
        ? h * (0.48 + Math.random() * 0.22)
        : -12 - Math.random() * 90;
      const vx = fromLeft
        ? (3.2 + Math.random() * 9.2)
        : (fromRight ? -(3.2 + Math.random() * 9.2) : (Math.random() - 0.5) * 4.2);
      const vy = (fromLeft || fromRight)
        ? -(8.5 + Math.random() * 8.5)
        : (1.8 + Math.random() * 4.0);
      pieces.push({
        x, y, vx, vy,
        w: 6 + Math.random() * 7,
        h: 4 + Math.random() * 5,
        rot: Math.random() * Math.PI * 2,
        vrot: (Math.random() - 0.5) * 0.24,
        color: palette[i % palette.length],
        isDiamond: i % 5 === 0,
        drag: 0.985 + Math.random() * 0.008,
      });
    }

    const tStart = performance.now();
    let prev = tStart;
    let rafId = 0;

    function frame(now) {
      const elapsed = now - tStart;
      if (elapsed >= durationMs || !canvas.isConnected) {
        if (rafId) cancelAnimationFrame(rafId);
        canvas.remove();
        return;
      }
      const dt = Math.min(2.2, (now - prev) / 16.67);
      prev = now;

      ctx.clearRect(0, 0, w, h);
      const fade = elapsed > durationMs - 650 ? clamp((durationMs - elapsed) / 650, 0, 1) : 1;

      for (let i = 0; i < pieces.length; i++) {
        const p = pieces[i];
        p.vx *= Math.pow(p.drag, dt);
        p.vy = p.vy * Math.pow(p.drag, dt) + 0.22 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vrot * dt;

        ctx.save();
        ctx.globalAlpha = fade;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        const flip = Math.cos(p.rot * 1.7);
        if (p.isDiamond) {
          ctx.beginPath();
          ctx.moveTo(0, -p.w * 0.6);
          ctx.lineTo(p.w * 0.45 * flip, 0);
          ctx.lineTo(0, p.w * 0.6);
          ctx.lineTo(-p.w * 0.45 * flip, 0);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.fillRect(-p.w / 2, (-p.h / 2) * Math.max(0.25, Math.abs(flip)), p.w, p.h * Math.max(0.25, Math.abs(flip)));
        }
        ctx.restore();
      }
      rafId = requestAnimationFrame(frame);
    }
    rafId = requestAnimationFrame(frame);
  }

  function milestoneBurst(milestoneStars) {
    const layer = ensureVfxLayer();
    if (!layer) return;
    const banner = document.createElement('div');
    banner.className = 'vdb-vfx-milestone';
    const starsNum = Number(milestoneStars);
    banner.textContent = Number.isFinite(starsNum) && starsNum > 0
      ? `✨ ĐẠT MỐC ${starsNum}⭐ DANH TIẾNG! ✨`
      : '✨ MỞ KHÓA MỐC DANH TIẾNG! ✨';
    layer.appendChild(banner);
    setTimeout(() => banner.remove(), 2050);
    launchConfettiCanvas(2100, 62);
  }

  function victoryConfetti() {
    // Auto-cleans cleanly after 2.8s
    launchConfettiCanvas(2800, 130);
  }

  function floatingEmote(chefName, avatar, emoji) {
    const layer = ensureVfxLayer();
    if (!layer) return;

    const bubble = document.createElement('div');
    bubble.className = 'vdb-vfx-emote';

    const vw = window.innerWidth || 1280;
    const vh = window.innerHeight || 720;
    const lane = (emoteLaneCounter++) % 4;
    // Spread across right-center area safely away from edges and bottom turn bar
    const rightPx = Math.min(vw - 180, Math.max(12, 16 + lane * 44));
    const topPx = clamp(Math.round(vh * 0.34 + (lane % 3) * 44), 76, Math.max(110, vh - 180));
    bubble.style.right = rightPx + 'px';
    bubble.style.top = topPx + 'px';

    const emojiNode = document.createElement('span');
    emojiNode.className = 'vdb-vfx-emote-emoji';
    emojiNode.textContent = String(emoji || '🔥');

    const meta = document.createElement('div');
    meta.className = 'vdb-vfx-emote-meta';

    const nameNode = document.createElement('span');
    nameNode.className = 'vdb-vfx-emote-name';
    const prefix = avatar ? String(avatar) + ' ' : '';
    nameNode.textContent = prefix + String(chefName || 'Đầu Bếp');

    meta.appendChild(nameNode);
    bubble.append(emojiNode, meta);
    layer.appendChild(bubble);
    setTimeout(() => bubble.remove(), 2700);
  }

  function eventFlash(emoji, title) {
    const layer = ensureVfxLayer();
    if (!layer) return;
    const banner = document.createElement('div');
    banner.className = 'vdb-vfx-milestone';
    banner.textContent = `${emoji ? String(emoji) + ' ' : ''}${String(title || 'SỰ KIỆN NGÀY MỚI')}`;
    layer.appendChild(banner);
    setTimeout(() => banner.remove(), 2000);
  }

  function bellRipple(originEl) {
    if (!originEl) return;
    const layer = ensureVfxLayer();
    if (!layer) return;
    const pt = resolvePoint(originEl, '#btn-tabletop-bell', 0.88, 0.88);
    if (prefersReducedMotion()) return;

    const r1 = document.createElement('div');
    r1.className = 'vdb-vfx-bell-ring';
    r1.style.left = pt.x + 'px';
    r1.style.top = pt.y + 'px';

    const r2 = document.createElement('div');
    r2.className = 'vdb-vfx-bell-ring is-outer';
    r2.style.left = pt.x + 'px';
    r2.style.top = pt.y + 'px';

    layer.append(r1, r2);
    setTimeout(() => { r1.remove(); r2.remove(); }, 820);
  }

  const vfxAPI = {
    cookBurst,
    coinFly,
    gavelSmash,
    trashBurst,
    milestoneBurst,
    victoryConfetti,
    floatingEmote,
    eventFlash,
    bellRipple,
  };

  // ==========================================
  // 3. 3D VIETNAMESE TABLETOP ARCHITECTURE & INTERACTIVITY
  // ==========================================
  const sceneState = {
    enhanced: false,
    ctx: null,
    interactiveCtx: null,
    rootGroup: null,
    envRT: null,
    lightingUpgraded: false,
    tableUpgraded: false,
    boardUpgraded: false,
    propsUpgraded: false,
    lanternGlowTex: null,
    clockPointLight: null,
    playerDial: null,
    serviceBellGroup: null,
    bellPlunger: null,
    bellDomeMat: null,
    bellAnimSeq: 0,
    rivalTablePropsGroup: null,
    rivalPropsSig: '',
    rivalPropsTextures: [],
    lastRivalsList: [],
    steamPoints: null,
    steamBasePos: null,
    steamPhase: null,
    steamTimer: null,
    peekMode: false,
    savedCameraPos: null,
    savedControlsTarget: null,
    savedControlsState: null,
    peekTweenId: 0,
    hoverFrame: null,
    hoveredObj: null,
    hoveredRestY: null,
    hoveredEmissiveSaved: null,
    hoveredMarketKey: null,
    hoverLastCheck: 0,
    activeTiltedMarket: null,
    marketZones: {},
    marketHitMeshes: [],
    badgesLayer: null,
    badgeNodes: {},
    cardPillNodes: [],
    shelfPillNode: null,
    activeHeaderNode: null,
    closedBannerNode: null,
    islandPillNodes: {},
    tooltipEl: null,
    tooltipTitleEl: null,
    tooltipSubEl: null,
    tooltipHintEl: null,
    stageStylesInjected: false,
    overlayRafPending: false,
    interactionBound: false,
    pointerDownX: 0,
    pointerDownY: 0,
    pointerDownOnCanvas: false,
    portraitCache: new Map(), // chefId -> Promise<HTMLImageElement|null>
  };

  function makeTex(THREE, drawFn, w, h, isLinearData) {
    const c = document.createElement('canvas');
    c.width = w || 256;
    c.height = h || 256;
    const ctx = c.getContext('2d');
    if (ctx) drawFn(ctx, c.width, c.height);
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    if (!isLinearData && THREE && THREE.sRGBEncoding !== undefined) {
      tex.encoding = THREE.sRGBEncoding;
    }
    return tex;
  }

  function tagMaterialSRGB(mat, THREE) {
    if (!mat || !THREE || THREE.sRGBEncoding === undefined) return;
    const mats = Array.isArray(mat) ? mat : [mat];
    for (let i = 0; i < mats.length; i++) {
      const m = mats[i];
      if (!m) continue;
      if (m.map && m.map.encoding !== THREE.sRGBEncoding) {
        m.map.encoding = THREE.sRGBEncoding;
        m.map.needsUpdate = true;
        m.needsUpdate = true;
      }
      if (m.emissiveMap && m.emissiveMap.encoding !== THREE.sRGBEncoding) {
        m.emissiveMap.encoding = THREE.sRGBEncoding;
        m.emissiveMap.needsUpdate = true;
        m.needsUpdate = true;
      }
    }
  }

  function ensureSceneColorTexturesSRGB(ctx, fullTraverse) {
    if (!ctx || !ctx.THREE || ctx.THREE.sRGBEncoding === undefined) return;
    const { THREE, scene, interactive3DCards, interactive3DShelves } = ctx;
    if (fullTraverse && scene && typeof scene.traverse === 'function') {
      scene.traverse(obj => {
        if (obj && obj.isMesh && obj.material) {
          tagMaterialSRGB(obj.material, THREE);
        }
      });
      return;
    }
    if (Array.isArray(interactive3DCards)) {
      for (let i = 0; i < interactive3DCards.length; i++) {
        const m = interactive3DCards[i];
        if (m && m.material) tagMaterialSRGB(m.material, THREE);
      }
    }
    if (Array.isArray(interactive3DShelves)) {
      for (let i = 0; i < interactive3DShelves.length; i++) {
        const m = interactive3DShelves[i];
        if (m && m.material) tagMaterialSRGB(m.material, THREE);
      }
    }
  }

  function resolveSceneRefs(ctx) {
    const out = {
      tableMesh: ctx.tableMesh || null,
      boardBaseMesh: ctx.boardBaseMesh || null,
      boardFaceMesh: ctx.boardFaceMesh || null,
      sandTimerGroup: ctx.sandTimerGroup || null,
      gourmetDeck: ctx.gourmetDeck || null,
      basicDeck: ctx.basicDeck || null,
      garbageBagGroup: ctx.garbageBagGroup || null,
      actionDeckMesh: ctx.actionDeckMesh || null,
      keyLight: ctx.keyLight || null,
      fillLight: ctx.fillLight || null,
      ambientLight: null,
    };
    const scene = ctx.scene;
    if (!scene || !Array.isArray(scene.children)) return out;
    const bcz = typeof ctx.boardCenterZ === 'number' ? ctx.boardCenterZ : -3.5;

    for (let i = 0; i < scene.children.length; i++) {
      const ch = scene.children[i];
      if (!ch) continue;
      if (ch.isAmbientLight && !out.ambientLight) {
        out.ambientLight = ch;
      } else if (ch.isDirectionalLight) {
        if (ch.castShadow && !out.keyLight) out.keyLight = ch;
        else if (!ch.castShadow && !out.fillLight) out.fillLight = ch;
      } else if (ch.isMesh && ch.geometry) {
        const gp = ch.geometry.parameters || {};
        if (!out.tableMesh && ch.geometry.type === 'BoxGeometry' && gp.width >= 80 && gp.depth >= 60) {
          out.tableMesh = ch;
        } else if (!out.boardBaseMesh && ch.geometry.type === 'BoxGeometry' && gp.width >= 27 && gp.width <= 29 && gp.depth >= 19 && gp.depth <= 21) {
          out.boardBaseMesh = ch;
        } else if (!out.boardFaceMesh && ch.geometry.type === 'PlaneGeometry' && gp.width >= 27 && gp.height >= 19) {
          out.boardFaceMesh = ch;
        } else if (ch.geometry.type === 'BoxGeometry' && gp.width >= 2.2 && gp.width <= 2.6 && gp.depth >= 3.2 && gp.depth <= 3.6 && ch.position.x < -14) {
          if (ch.position.z < bcz && !out.gourmetDeck) out.gourmetDeck = ch;
          else if (ch.position.z >= bcz && !out.basicDeck) out.basicDeck = ch;
        } else if (!out.actionDeckMesh && ch.geometry.type === 'BoxGeometry' && gp.width >= 1.5 && gp.width <= 1.75 && gp.depth >= 2.0 && gp.depth <= 2.35 && ch.position.x > 3 && ch.position.x < 6) {
          out.actionDeckMesh = ch;
        }
      } else if (ch.isGroup) {
        if (!out.sandTimerGroup && ch.position && ch.position.x > 15 && ch.children && ch.children.length >= 7) {
          out.sandTimerGroup = ch;
        } else if (!out.garbageBagGroup && ch.position && ch.position.x < -3.5 && ch.position.x > -6.0 && Math.abs(ch.position.z - (bcz + 0.3)) < 1.2) {
          out.garbageBagGroup = ch;
        }
      }
    }
    return out;
  }

  function getLanternGlowTexture(THREE) {
    if (sceneState.lanternGlowTex) return sceneState.lanternGlowTex;
    sceneState.lanternGlowTex = makeTex(THREE, (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255, 232, 168, 0.92)');
      g.addColorStop(0.32, 'rgba(245, 166, 56, 0.45)');
      g.addColorStop(0.7, 'rgba(217, 102, 28, 0.12)');
      g.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }, 96, 96);
    return sceneState.lanternGlowTex;
  }

  // ------------------------------------------
  // 3A-v2. INDOCHINE COLLECTOR'S EDITION: LIGHTING, PMREM, WALNUT MARQUETRY, COLLECTOR BOARD & HEIRLOOM PROPS
  // ------------------------------------------
  function setupIndochineLightingAndEnv(ctx, refs) {
    if (sceneState.lightingUpgraded) return;
    sceneState.lightingUpgraded = true;
    const { THREE, scene, renderer } = ctx;

    // 1. Filmic tone mapping & true sRGB color pipeline
    if (renderer) {
      if (THREE.ACESFilmicToneMapping !== undefined) {
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
      }
      renderer.toneMappingExposure = 1.08;
      if (THREE.sRGBEncoding !== undefined) {
        renderer.outputEncoding = THREE.sRGBEncoding;
      }
    }

    // 2. Deep espresso-lacquer atmospheric backdrop
    scene.background = new THREE.Color(0x0b0604);
    if (scene.fog) {
      if (scene.fog.color && typeof scene.fog.color.setHex === 'function') {
        scene.fog.color.setHex(0x0b0604);
      }
      if (typeof scene.fog.density === 'number') {
        scene.fog.density = 0.0036;
      }
    }

    // 3. Offline procedural Saigon Fine-Dining Bistro Environment Map via PMREMGenerator
    if (renderer && typeof THREE.PMREMGenerator === 'function') {
      try {
        const envTex = makeTex(THREE, (c, w, h) => {
          // Vertical studio gradient: deep espresso ceiling -> warm bistro horizon -> dark walnut floor
          const bg = c.createLinearGradient(0, 0, 0, h);
          bg.addColorStop(0.0, '#120905');
          bg.addColorStop(0.24, '#24130a');
          bg.addColorStop(0.46, '#3d2211');
          bg.addColorStop(0.56, '#1f1108');
          bg.addColorStop(1.0, '#0a0503');
          c.fillStyle = bg;
          c.fillRect(0, 0, w, h);

          // Warm overhead Saigon brass chandelier softboxes (creates gleaming metallic highlights!)
          const lamps = [
            { x: w * 0.28, y: h * 0.22, rx: w * 0.14, ry: h * 0.13, col: 'rgba(255, 236, 186, 0.92)' },
            { x: w * 0.62, y: h * 0.18, rx: w * 0.18, ry: h * 0.14, col: 'rgba(255, 224, 152, 0.85)' },
            { x: w * 0.84, y: h * 0.34, rx: w * 0.12, ry: h * 0.10, col: 'rgba(246, 184, 88, 0.55)' },
            { x: w * 0.12, y: h * 0.38, rx: w * 0.13, ry: h * 0.10, col: 'rgba(126, 212, 202, 0.32)' },
          ];
          lamps.forEach(lp => {
            c.save();
            c.translate(lp.x, lp.y);
            c.scale(1, lp.ry / lp.rx);
            const g = c.createRadialGradient(0, 0, 2, 0, 0, lp.rx);
            g.addColorStop(0, lp.col);
            g.addColorStop(0.45, lp.col.replace(/[\d.]+\)$/, '0.32)'));
            g.addColorStop(1, 'rgba(0,0,0,0)');
            c.fillStyle = g;
            c.beginPath();
            c.arc(0, 0, lp.rx, 0, Math.PI * 2);
            c.fill();
            c.restore();
          });

          // Subtle warm candlelight rim band along horizon
          const rim = c.createLinearGradient(0, h * 0.44, 0, h * 0.56);
          rim.addColorStop(0, 'rgba(255, 202, 120, 0)');
          rim.addColorStop(0.5, 'rgba(245, 186, 98, 0.28)');
          rim.addColorStop(1, 'rgba(255, 202, 120, 0)');
          c.fillStyle = rim;
          c.fillRect(0, h * 0.44, w, h * 0.12);
        }, 512, 256);

        if (THREE.EquirectangularReflectionMapping !== undefined) {
          envTex.mapping = THREE.EquirectangularReflectionMapping;
        }
        const pmrem = new THREE.PMREMGenerator(renderer);
        if (typeof pmrem.compileEquirectangularShader === 'function') {
          pmrem.compileEquirectangularShader();
        }
        const envRT = pmrem.fromEquirectangular(envTex);
        if (envRT && envRT.texture) {
          scene.environment = envRT.texture;
          sceneState.envRT = envRT;
        }
        envTex.dispose();
        pmrem.dispose();
      } catch (_) {}
    }

    // 4. Studio Light Rig Calibration (Warm Indochine Candlelight Key + Jade Rim + Hemisphere Bounce)
    if (refs.ambientLight) {
      refs.ambientLight.color.setHex(0xffe8c8);
      refs.ambientLight.intensity = 0.28;
    }
    if (typeof THREE.HemisphereLight === 'function') {
      const hemi = new THREE.HemisphereLight(0xffe8c2, 0x1a0d06, 0.54);
      hemi.name = 'VdbIndochineHemiLight';
      scene.add(hemi);
    }
    if (refs.keyLight) {
      refs.keyLight.color.setHex(0xfff1d6);
      refs.keyLight.intensity = 1.32;
      if (refs.keyLight.shadow) {
        refs.keyLight.shadow.bias = -0.00025;
      }
    }
    if (refs.fillLight) {
      refs.fillLight.color.setHex(0x7fd4ca);
      refs.fillLight.intensity = 0.34;
    }
  }

  function upgradeTabletop(ctx, refs) {
    const tableMesh = refs.tableMesh;
    if (!tableMesh || sceneState.tableUpgraded) return;
    sceneState.tableUpgraded = true;
    const { THREE } = ctx;
    const bcz = typeof ctx.boardCenterZ === 'number' ? ctx.boardCenterZ : -3.5;

    // Deterministic pseudo-random for rich, repeatable hand-rubbed walnut grain
    let seed = 4219;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    const walnutTex = makeTex(THREE, (c, w, h) => {
      const plankCount = 9;
      const pw = w / plankCount;
      const tones = ['#26130a', '#2e180d', '#1f1008', '#341b0f', '#29150b', '#221108', '#311a0e', '#251209', '#2b160c'];

      for (let p = 0; p < plankCount; p++) {
        const x0 = p * pw;
        // Plank base gradient
        const pg = c.createLinearGradient(x0, 0, x0 + pw, 0);
        pg.addColorStop(0, '#190c06');
        pg.addColorStop(0.08, tones[p % tones.length]);
        pg.addColorStop(0.55, tones[(p + 2) % tones.length]);
        pg.addColorStop(0.94, tones[p % tones.length]);
        pg.addColorStop(1, '#140904');
        c.fillStyle = pg;
        c.fillRect(x0, 0, pw + 1, h);

        // Organic flowing walnut grain fibers
        const freq = 0.004 + rand() * 0.003;
        const phase = rand() * Math.PI * 2;
        for (let g = 0; g < 34; g++) {
          const gx = x0 + 4 + rand() * (pw - 8);
          const isWarm = g % 3 === 0;
          c.strokeStyle = isWarm ? 'rgba(182, 118, 62, 0.065)' : 'rgba(9, 4, 2, 0.14)';
          c.lineWidth = 0.8 + rand() * 2.2;
          c.beginPath();
          for (let y = 0; y <= h; y += 32) {
            const wave = Math.sin(y * freq + phase + g * 0.35) * (3.5 + (g % 5));
            const px = clamp(gx + wave, x0 + 2, x0 + pw - 2);
            if (y === 0) c.moveTo(px, y);
            else c.lineTo(px, y);
          }
          c.stroke();
        }

        // Subtle cathedral woodfigure oval highlights
        for (let k = 0; k < 2; k++) {
          const kx = x0 + pw * (0.28 + rand() * 0.44);
          const ky = h * (0.2 + rand() * 0.6);
          c.save();
          c.translate(kx, ky);
          c.scale(0.32, 1.8);
          const kg = c.createRadialGradient(0, 0, 2, 0, 0, pw * 0.72);
          kg.addColorStop(0, 'rgba(154, 96, 48, 0.06)');
          kg.addColorStop(0.55, 'rgba(18, 8, 4, 0.08)');
          kg.addColorStop(1, 'rgba(0, 0, 0, 0)');
          c.fillStyle = kg;
          c.beginPath();
          c.arc(0, 0, pw * 0.72, 0, Math.PI * 2);
          c.fill();
          c.restore();
        }

        // Crisp bevel plank seam
        c.fillStyle = 'rgba(7, 3, 1, 0.78)';
        c.fillRect(x0, 0, 2.5, h);
        c.fillStyle = 'rgba(255, 206, 150, 0.045)';
        c.fillRect(x0 + 2.5, 0, 1.2, h);
      }

      // Subtle inlaid antique-brass marquetry frame generously surrounding the central board & side props
      // BoxGeometry(88, 1.8, 66) top face maps world x in [-44..44] -> [0..w], z in [-33..33] -> [0..h]
      const toU = wx => ((wx + 44) / 88) * w;
      const toV = wz => ((wz + 33) / 66) * h;
      const mx1 = toU(-20.4), mx2 = toU(20.4);
      const my1 = toV(bcz - 13.4), my2 = toV(bcz + 13.8);

      c.save();
      c.strokeStyle = 'rgba(218, 178, 98, 0.34)';
      c.lineWidth = 3.2;
      c.strokeRect(mx1, my1, mx2 - mx1, my2 - my1);
      c.strokeStyle = 'rgba(218, 178, 98, 0.16)';
      c.lineWidth = 1.4;
      c.strokeRect(mx1 + 10, my1 + 10, (mx2 - mx1) - 20, (my2 - my1) - 20);

      // Mitered brass corner diamond inlays
      const corners = [[mx1, my1], [mx2, my1], [mx1, my2], [mx2, my2]];
      corners.forEach(([cx, cy]) => {
        c.save();
        c.translate(cx, cy);
        c.rotate(Math.PI / 4);
        c.fillStyle = 'rgba(226, 186, 108, 0.42)';
        c.fillRect(-5.5, -5.5, 11, 11);
        c.strokeStyle = 'rgba(18, 9, 4, 0.7)';
        c.lineWidth = 1.5;
        c.strokeRect(-5.5, -5.5, 11, 11);
        c.restore();
      });
      c.restore();

      // Warm overhead Saigon candlelight pool centered under the board + moody outer table vignette
      const poolX = toU(0);
      const poolY = toV(bcz);
      const warmPool = c.createRadialGradient(poolX, poolY, 70, poolX, poolY, w * 0.56);
      warmPool.addColorStop(0, 'rgba(255, 212, 146, 0.15)');
      warmPool.addColorStop(0.48, 'rgba(196, 132, 68, 0.04)');
      warmPool.addColorStop(0.78, 'rgba(14, 7, 3, 0.30)');
      warmPool.addColorStop(1, 'rgba(6, 3, 1, 0.68)');
      c.fillStyle = warmPool;
      c.fillRect(0, 0, w, h);
    }, 1024, 1024);

    // Linear wood-grain bump map for tactile satin walnut reflections
    const bumpTex = makeTex(THREE, (c, w, h) => {
      c.fillStyle = '#808080';
      c.fillRect(0, 0, w, h);
      const plankCount = 9;
      const pw = w / plankCount;
      for (let p = 0; p < plankCount; p++) {
        const x0 = p * pw;
        c.fillStyle = '#242424';
        c.fillRect(x0, 0, 2, h);
        for (let g = 0; g < 26; g++) {
          const gx = x0 + 2 + ((g * 19 + p * 7) % Math.max(4, Math.floor(pw - 4)));
          c.fillStyle = g % 2 === 0 ? '#939393' : '#6c6c6c';
          c.fillRect(gx, 0, 1.2, h);
        }
      }
    }, 512, 512, true);

    if (tableMesh.material && tableMesh.material.map) {
      try { tableMesh.material.map.dispose(); } catch (_) {}
    }
    tableMesh.material = new THREE.MeshStandardMaterial({
      map: walnutTex,
      bumpMap: bumpTex,
      bumpScale: 0.04,
      roughness: 0.42,
      metalness: 0.06,
      envMapIntensity: 0.72,
    });
    tableMesh.receiveShadow = true;
  }

  function buildCollectorBoardTexture(THREE) {
    return makeTex(THREE, (ctx, w, h) => {
      // 1. Deep Imperial Jade-Obsidian Lacquer Board Surface
      const baseGrad = ctx.createRadialGradient(w * 0.5, h * 0.5, 160, w * 0.5, h * 0.5, w * 0.64);
      baseGrad.addColorStop(0, '#0f2425');
      baseGrad.addColorStop(0.58, '#081517');
      baseGrad.addColorStop(1, '#040a0c');
      ctx.fillStyle = baseGrad;
      ctx.fillRect(0, 0, w, h);

      // Subtle fine silk-linen weave micro-texture
      ctx.strokeStyle = 'rgba(224, 190, 120, 0.024)';
      ctx.lineWidth = 1;
      for (let x = 0; x < w; x += 28) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }
      for (let y = 0; y < h; y += 28) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }

      // Subtle tactile Collector's Edition fold seams
      ctx.strokeStyle = 'rgba(2, 5, 7, 0.68)';
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();

      // Double hairline antique champagne-gold perimeter frame
      ctx.strokeStyle = '#d4aa54';
      ctx.lineWidth = 7;
      ctx.strokeRect(14, 14, w - 28, h - 28);
      ctx.strokeStyle = 'rgba(232, 200, 128, 0.42)';
      ctx.lineWidth = 2;
      ctx.strokeRect(24, 24, w - 48, h - 48);

      // Vietnamese "Hoa Văn Kỷ Hà" geometric corner frets
      const drawCornerFret = (cx, cy, sx, sy) => {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(sx, sy);
        ctx.strokeStyle = '#e2be6c';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(0, 44); ctx.lineTo(0, 0); ctx.lineTo(44, 0);
        ctx.moveTo(0, 26); ctx.lineTo(26, 26); ctx.lineTo(26, 0);
        ctx.moveTo(12, 12); ctx.lineTo(12, 0);
        ctx.stroke();
        ctx.fillStyle = '#f3d996';
        ctx.fillRect(4, 4, 5, 5);
        ctx.restore();
      };
      drawCornerFret(18, 18, 1, 1);
      drawCornerFret(w - 18, 18, -1, 1);
      drawCornerFret(18, h - 18, 1, -1);
      drawCornerFret(w - 18, h - 18, -1, -1);

      // 2. CENTRAL HUB: THE ISLAND (CHỢ BẾN THÀNH) — Saigon Gạch Bông Mosaic Plaza
      const islandW = w * 0.48;
      const islandH = h * 0.49;
      const islandX = (w - islandW) / 2;
      const islandY = (h - islandH) / 2;

      ctx.save();
      ctx.beginPath();
      ctx.rect(islandX, islandY, islandW, islandH);
      ctx.clip();

      // Deep Imperial Jade-Slate foundation
      const islBg = ctx.createRadialGradient(w / 2, h / 2, 40, w / 2, h / 2, islandW * 0.65);
      islBg.addColorStop(0, '#133032');
      islBg.addColorStop(0.65, '#0b2022');
      islBg.addColorStop(1, '#071517');
      ctx.fillStyle = islBg;
      ctx.fillRect(islandX, islandY, islandW, islandH);

      // Authentic Saigon Gạch Bông (Indochine cement tile) diamond & 4-petal rosette mosaic
      const tileSize = 68;
      for (let ty = islandY - 12; ty < islandY + islandH + tileSize; ty += tileSize) {
        for (let tx = islandX - 12; tx < islandX + islandW + tileSize; tx += tileSize) {
          const rIdx = Math.floor((ty - islandY) / tileSize);
          const cIdx = Math.floor((tx - islandX) / tileSize);
          const alt = (rIdx + cIdx) % 2 === 0;
          ctx.fillStyle = alt ? 'rgba(20, 56, 58, 0.46)' : 'rgba(9, 28, 30, 0.46)';
          ctx.fillRect(tx, ty, tileSize - 1, tileSize - 1);

          // Tile grout hairline
          ctx.strokeStyle = 'rgba(218, 182, 108, 0.08)';
          ctx.lineWidth = 1;
          ctx.strokeRect(tx, ty, tileSize, tileSize);

          // Subtle Indochine 4-petal geometric diamond motif inside each cement tile
          const cx = tx + tileSize * 0.5;
          const cy = ty + tileSize * 0.5;
          const dr = tileSize * 0.30;
          ctx.strokeStyle = alt ? 'rgba(226, 192, 122, 0.14)' : 'rgba(94, 234, 212, 0.10)';
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(cx, cy - dr);
          ctx.lineTo(cx + dr, cy);
          ctx.lineTo(cx, cy + dr);
          ctx.lineTo(cx - dr, cy);
          ctx.closePath();
          ctx.stroke();

          ctx.fillStyle = alt ? 'rgba(226, 192, 122, 0.12)' : 'rgba(94, 234, 212, 0.08)';
          ctx.beginPath();
          ctx.arc(cx, cy, 4.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();

      // Double gold-and-jade plaza border
      ctx.strokeStyle = '#d4aa54';
      ctx.lineWidth = 5;
      ctx.strokeRect(islandX, islandY, islandW, islandH);
      ctx.strokeStyle = 'rgba(94, 234, 212, 0.45)';
      ctx.lineWidth = 2;
      ctx.strokeRect(islandX + 8, islandY + 8, islandW - 16, islandH - 16);

      // Editorial Saigon Fine-Dining Title Cartouche (same rect as original)
      const banX = islandX + 24, banY = islandY + 20, banW = islandW - 48, banH = 108;
      const banGrad = ctx.createLinearGradient(banX, banY, banX, banY + banH);
      banGrad.addColorStop(0, '#160d09');
      banGrad.addColorStop(1, '#0a0705');
      ctx.fillStyle = banGrad;
      ctx.fillRect(banX, banY, banW, banH);
      ctx.strokeStyle = '#d8ae56';
      ctx.lineWidth = 3.5;
      ctx.strokeRect(banX, banY, banW, banH);
      ctx.strokeStyle = 'rgba(243, 216, 148, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(banX + 6, banY + 6, banW - 12, banH - 12);

      // Champagne-gold serif title
      const titleGrad = ctx.createLinearGradient(0, banY + 18, 0, banY + 70);
      titleGrad.addColorStop(0, '#fff4cf');
      titleGrad.addColorStop(0.55, '#e2b75b');
      titleGrad.addColorStop(1, '#bd8930');
      ctx.fillStyle = titleGrad;
      ctx.font = '700 38px Georgia, "Times New Roman", serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      fitCanvasText(ctx, '✦  VUA ĐẦU BẾP VIỆT NAM  ✦', w / 2, islandY + 64, islandW - 84);
      ctx.fillStyle = '#a7e3d8';
      ctx.font = '700 18px system-ui, -apple-system, sans-serif';
      fitCanvasText(ctx, 'CHỢ BẾN THÀNH  •  ĐẢO TRUNG TÂM  (KHÔNG ĐẤU GIÁ • KHÔNG KỸ NĂNG)', w / 2, islandY + 102, islandW - 76);

      // Left Circular Medallion: Kitchen Hamper & Discard Tray (exact coords: islandX+145, islandY+260, r=96)
      const gx = islandX + 145, gy = islandY + 260;
      ctx.beginPath();
      ctx.arc(gx, gy, 96, 0, Math.PI * 2);
      ctx.fillStyle = '#18100d';
      ctx.fill();
      ctx.strokeStyle = '#b91c1c';
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(gx, gy, 86, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(218, 178, 98, 0.55)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#fca5a5';
      ctx.font = '800 18px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('ĐỔ RÁC $100', gx, gy - 12);
      ctx.fillStyle = '#d6c7b2';
      ctx.font = '700 15px system-ui, sans-serif';
      ctx.fillText('KHAY BỎ ($0)', gx, gy + 18);

      // Center Lacquer Plaque: Upgrades & Chocolate Exchange (exact coords: w/2-155, islandY+160, 310x190)
      const ux = w / 2 - 155, uy = islandY + 160;
      const uGrad = ctx.createLinearGradient(ux, uy, ux, uy + 190);
      uGrad.addColorStop(0, '#162038');
      uGrad.addColorStop(1, '#0d1426');
      ctx.fillStyle = uGrad;
      ctx.fillRect(ux, uy, 310, 190);
      ctx.strokeStyle = '#d8ae56';
      ctx.lineWidth = 3.5;
      ctx.strokeRect(ux, uy, 310, 190);
      ctx.strokeStyle = 'rgba(232, 200, 128, 0.35)';
      ctx.lineWidth = 1.4;
      ctx.strokeRect(ux + 7, uy + 7, 296, 176);

      ctx.fillStyle = '#f6dfa4';
      ctx.font = '700 21px Georgia, "Times New Roman", serif';
      ctx.textAlign = 'center';
      ctx.fillText('🛠️ NÂNG CẤP ($200–$400)', w / 2, islandY + 208);
      ctx.fillStyle = '#d6d3d1';
      ctx.font = '700 16px system-ui, sans-serif';
      ctx.fillText('🔥 Bếp Đôi • 📣 Quảng Cáo • 🧊 Kho', w / 2, islandY + 244);
      ctx.strokeStyle = 'rgba(216, 174, 86, 0.32)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(ux + 28, islandY + 266); ctx.lineTo(ux + 282, islandY + 266); ctx.stroke();
      ctx.fillStyle = '#f5ca6b';
      ctx.font = '800 19px system-ui, sans-serif';
      ctx.fillText('🍫 BÁN SÔ-CÔ-LA = +$500', w / 2, islandY + 306);

      // Right Card Bay: Action Card Deck (exact coords: islandX + islandW - 220, islandY + 165, 165x185)
      const ax = islandX + islandW - 220, ay = islandY + 165;
      const aGrad = ctx.createLinearGradient(ax, ay, ax, ay + 185);
      aGrad.addColorStop(0, '#09382d');
      aGrad.addColorStop(1, '#052019');
      ctx.fillStyle = aGrad;
      ctx.fillRect(ax, ay, 165, 185);
      ctx.strokeStyle = '#d4aa54';
      ctx.lineWidth = 3.5;
      ctx.strokeRect(ax, ay, 165, 185);
      ctx.strokeStyle = 'rgba(94, 234, 212, 0.45)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(ax + 7, ay + 7, 151, 171);
      ctx.fillStyle = '#bbf7d0';
      ctx.font = '800 19px system-ui, sans-serif';
      ctx.textAlign = 'center';
      fitCanvasText(ctx, 'THẺ HÀNH ĐỘNG', ax + 82, islandY + 244, 144);
      ctx.fillStyle = '#f8e3a8';
      ctx.font = '700 27px Georgia, "Times New Roman", serif';
      ctx.fillText('$200', ax + 82, islandY + 288);

      // Bottom Island Ribbon: Saigon Ivory-Parchment Gold-Trimmed Ledger (exact coords)
      const rx = islandX + 55, ry = islandY + islandH - 115, rw = islandW - 110, rh = 82;
      const ribGrad = ctx.createLinearGradient(rx, ry, rx, ry + rh);
      ribGrad.addColorStop(0, '#f9f0da');
      ribGrad.addColorStop(1, '#e8d5ac');
      ctx.fillStyle = ribGrad;
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeStyle = '#b78a34';
      ctx.lineWidth = 4;
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.strokeStyle = '#115e59';
      ctx.lineWidth = 1.6;
      ctx.strokeRect(rx + 6, ry + 6, rw - 12, rh - 12);
      ctx.fillStyle = '#1f130b';
      ctx.font = '800 22px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      fitCanvasText(ctx, '💵 THU NHẬP NGÀY: $300 NỀN  ✦  +QUẢNG CÁO  ✦  MỐC 3·7·12⭐ → 20⭐ THẮNG', w / 2, islandY + islandH - 65, islandW - 138);

      // 3. 6 CURATED JEWEL-TONE LACQUER MARKET STALLS (PIXEL-EXACT SLOT ALIGNMENT!)
      const drawMarketZone = (x, y, mw, mh, bgTop, bgBot, accent, goldTrim, title, price) => {
        const g = ctx.createLinearGradient(x, y, x, y + mh);
        g.addColorStop(0, bgTop);
        g.addColorStop(1, bgBot);
        ctx.fillStyle = g;
        ctx.fillRect(x, y, mw, mh);

        ctx.strokeStyle = accent;
        ctx.lineWidth = 4.5;
        ctx.strokeRect(x, y, mw, mh);
        ctx.strokeStyle = 'rgba(226, 190, 114, 0.42)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 5, y + 5, mw - 10, mh - 10);

        // Header strip with satin gradient + brushed gold underline
        const hg = ctx.createLinearGradient(x, y + 6, x, y + 44);
        hg.addColorStop(0, accent);
        hg.addColorStop(1, bgTop);
        ctx.fillStyle = hg;
        ctx.fillRect(x + 6, y + 6, mw - 12, 38);
        ctx.fillStyle = goldTrim;
        ctx.fillRect(x + 6, y + 43, mw - 12, 2);

        ctx.fillStyle = '#fcf6e8';
        ctx.font = '700 22px Georgia, "Times New Roman", serif';
        ctx.textAlign = 'left';
        fitCanvasText(ctx, title, x + 18, y + 32, mw - 112);
        ctx.textAlign = 'right';
        ctx.fillStyle = '#f8df94';
        ctx.font = '800 22px system-ui, sans-serif';
        ctx.fillText(price, x + mw - 16, y + 32);

        // 1 Shelf slot + 3 Counter slots (exact original coordinates)
        const slotW = (mw - 42) / 4;
        const slotH = mh - 60;
        for (let i = 0; i < 4; i++) {
          const sx = x + 10 + i * (slotW + 7);
          const sy = y + 50;
          ctx.fillStyle = i === 0 ? 'rgba(232, 198, 126, 0.11)' : 'rgba(0, 0, 0, 0.28)';
          ctx.fillRect(sx, sy, slotW, slotH);
          ctx.strokeStyle = i === 0 ? '#e4be6c' : 'rgba(232, 200, 132, 0.36)';
          ctx.lineWidth = i === 0 ? 2.5 : 1.6;
          ctx.strokeRect(sx, sy, slotW, slotH);
          ctx.fillStyle = i === 0 ? '#f6dfa4' : 'rgba(236, 224, 198, 0.72)';
          ctx.font = '800 12.5px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(i === 0 ? 'KỆ ÚP' : `QUẦY ${i}`, sx + slotW / 2, sy + slotH - 10);
        }
      };

      // Top 3 Markets
      drawMarketZone(35, 28, w * 0.305, 165, '#3b0b0e', '#1e0506', '#a82222', '#e0b861', '🥩 HÀNG THỊT TƯƠI', '$200');
      drawMarketZone(w * 0.348, 28, w * 0.305, 165, '#3b2608', '#1f1303', '#b38119', '#eed07f', '🦐 HẢI SẢN VŨNG TÀU', '$200');
      drawMarketZone(w * 0.665, 28, w * 0.315, 165, '#2b0d45', '#150624', '#7b35b2', '#dfb8ff', '🌿 PHỐ GIA VỊ HUYỀN BÍ', '$300');

      // Bottom Market (Fruit)
      drawMarketZone(w * 0.22, h - 195, w * 0.56, 165, '#092c44', '#041624', '#126b9c', '#9fdaf5', '🍉 CHỢ HOA QUẢ MIỀN TÂY', '$100');

      // Left Vertical Market: Carbs ($100) — exact coords (35, 212, 175, h - 425)
      const drawVerticalMarket = (vx, bgTop, bgBot, accent, goldTrim, title, labelColor) => {
        const vh = h - 425;
        const g = ctx.createLinearGradient(vx, 212, vx + 175, 212 + vh);
        g.addColorStop(0, bgTop);
        g.addColorStop(1, bgBot);
        ctx.fillStyle = g;
        ctx.fillRect(vx, 212, 175, vh);
        ctx.strokeStyle = accent;
        ctx.lineWidth = 4.5;
        ctx.strokeRect(vx, 212, 175, vh);
        ctx.strokeStyle = 'rgba(226, 190, 114, 0.42)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(vx + 5, 217, 165, vh - 10);

        const hg = ctx.createLinearGradient(vx, 218, vx, 262);
        hg.addColorStop(0, accent);
        hg.addColorStop(1, bgTop);
        ctx.fillStyle = hg;
        ctx.fillRect(vx + 6, 218, 163, 44);
        ctx.fillStyle = goldTrim;
        ctx.fillRect(vx + 6, 261, 163, 2);

        ctx.fillStyle = '#fcf6e8';
        ctx.font = '700 18.5px Georgia, "Times New Roman", serif';
        ctx.textAlign = 'center';
        fitCanvasText(ctx, title, vx + 87, 247, 150);

        const sx = vx === 35 ? 52 : (vx + 18);
        for (let i = 0; i < 4; i++) {
          const sy = 274 + i * 238;
          ctx.fillStyle = i === 0 ? 'rgba(232, 198, 126, 0.11)' : 'rgba(0, 0, 0, 0.28)';
          ctx.fillRect(sx, sy, 140, 215);
          ctx.strokeStyle = i === 0 ? '#e4be6c' : 'rgba(232, 200, 132, 0.36)';
          ctx.lineWidth = i === 0 ? 2.5 : 1.6;
          ctx.strokeRect(sx, sy, 140, 215);
          ctx.fillStyle = i === 0 ? '#f6dfa4' : labelColor;
          ctx.font = '800 13.5px system-ui, sans-serif';
          ctx.fillText(i === 0 ? 'KỆ ÚP' : `QUẦY ${i}`, vx + 87, sy + 200);
        }
      };

      drawVerticalMarket(35, '#3b1907', '#1d0b03', '#b45a16', '#f2c87d', '🌾 GẠO & PHỞ $100', '#f4dec0');
      drawVerticalMarket(w - 210, '#072c18', '#03160c', '#187a46', '#98e5b9', '🥗 RAU CỦ $100', '#d1f2df');
    }, 2048, 1463);
  }

  function buildBoardBrassFrame(THREE, boardHeight, boardCenterZ) {
    const group = new THREE.Group();
    group.name = 'VdbBoardBrassFrame';
    group.userData.isDecorative = true;

    const rosewoodMat = new THREE.MeshStandardMaterial({
      color: 0x220f08,
      roughness: 0.36,
      metalness: 0.14,
      envMapIntensity: 0.9,
    });
    const brassMat = new THREE.MeshStandardMaterial({
      color: 0xdcb35c,
      roughness: 0.20,
      metalness: 0.90,
      envMapIntensity: 1.32,
    });

    const bw = 28;
    const bd = 20;
    const railW = 0.38;
    const railH = boardHeight + 0.03;

    // 4 beveled dark-rosewood perimeter moldings hugging the 28x20 board snugly
    const northRail = new THREE.Mesh(new THREE.BoxGeometry(bw + railW * 2, railH, railW), rosewoodMat);
    northRail.position.set(0, railH * 0.5, boardCenterZ - bd * 0.5 - railW * 0.5);
    northRail.castShadow = true;
    northRail.receiveShadow = true;

    const southRail = northRail.clone();
    southRail.position.z = boardCenterZ + bd * 0.5 + railW * 0.5;

    const westRail = new THREE.Mesh(new THREE.BoxGeometry(railW, railH, bd), rosewoodMat);
    westRail.position.set(-bw * 0.5 - railW * 0.5, railH * 0.5, boardCenterZ);
    westRail.castShadow = true;
    westRail.receiveShadow = true;

    const eastRail = westRail.clone();
    eastRail.position.x = bw * 0.5 + railW * 0.5;

    group.add(northRail, southRail, westRail, eastRail);

    // Fine brushed-brass inner trim bead running flush along all 4 outer board edges
    const beadT = 0.065;
    const beadH = 0.045;
    const beadY = boardHeight + 0.015;
    const bN = new THREE.Mesh(new THREE.BoxGeometry(bw + beadT * 2, beadH, beadT), brassMat);
    bN.position.set(0, beadY, boardCenterZ - bd * 0.5 - beadT * 0.5);
    const bS = bN.clone();
    bS.position.z = boardCenterZ + bd * 0.5 + beadT * 0.5;
    const bW = new THREE.Mesh(new THREE.BoxGeometry(beadT, beadH, bd), brassMat);
    bW.position.set(-bw * 0.5 - beadT * 0.5, beadY, boardCenterZ);
    const bE = bW.clone();
    bE.position.x = bw * 0.5 + beadT * 0.5;
    group.add(bN, bS, bW, bE);

    // 4 Sculpted Brushed-Brass Collector Corner Brackets with decorative rivets
    const studGeo = new THREE.SphereGeometry(0.065, 10, 8);
    const corners = [
      [-1, -1], [1, -1], [-1, 1], [1, 1],
    ];
    corners.forEach(([sx, sz]) => {
      const cGrp = new THREE.Group();
      const cx = sx * (bw * 0.5 + railW * 0.55);
      const cz = boardCenterZ + sz * (bd * 0.5 + railW * 0.55);
      cGrp.position.set(cx, 0, cz);

      const armX = new THREE.Mesh(new THREE.BoxGeometry(1.55, railH + 0.045, railW + 0.09), brassMat);
      armX.position.set(-sx * 0.56, (railH + 0.045) * 0.5, 0);
      armX.castShadow = true;
      const armZ = new THREE.Mesh(new THREE.BoxGeometry(railW + 0.09, railH + 0.045, 1.55), brassMat);
      armZ.position.set(0, (railH + 0.045) * 0.5, -sz * 0.56);
      armZ.castShadow = true;

      const capStud = new THREE.Mesh(studGeo, brassMat);
      capStud.position.set(0, railH + 0.055, 0);
      const studX = new THREE.Mesh(studGeo, brassMat);
      studX.position.set(-sx * 1.12, railH + 0.055, 0);
      const studZ = new THREE.Mesh(studGeo, brassMat);
      studZ.position.set(0, railH + 0.055, -sz * 1.12);

      cGrp.add(armX, armZ, capStud, studX, studZ);
      group.add(cGrp);
    });

    return group;
  }

  function upgradeCollectorBoard(ctx, refs, root, boardHeight, boardCenterZ) {
    if (sceneState.boardUpgraded) return;
    sceneState.boardUpgraded = true;
    const { THREE } = ctx;

    // 1. Physical 3D Beveled Rosewood & Brushed-Brass Frame around the board
    const frame = buildBoardBrassFrame(THREE, boardHeight, boardCenterZ);
    root.add(frame);

    // 2. Lacquered Rosewood Board Base
    if (refs.boardBaseMesh) {
      refs.boardBaseMesh.material = new THREE.MeshStandardMaterial({
        color: 0x1b0e08,
        roughness: 0.40,
        metalness: 0.14,
        envMapIntensity: 0.85,
      });
    }

    // 3. Museum-grade Indochine Lacquer & Saigon Gạch Bông Board Face
    if (refs.boardFaceMesh) {
      if (refs.boardFaceMesh.material && refs.boardFaceMesh.material.map) {
        try { refs.boardFaceMesh.material.map.dispose(); } catch (_) {}
      }
      const collectorTex = buildCollectorBoardTexture(THREE);
      refs.boardFaceMesh.material = new THREE.MeshStandardMaterial({
        map: collectorTex,
        roughness: 0.48,
        metalness: 0.08,
        envMapIntensity: 0.65,
      });
      refs.boardFaceMesh.receiveShadow = true;
    }
  }

  function buildGiltCardEdgeTexture(THREE) {
    return makeTex(THREE, (c, w, h) => {
      const grad = c.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, '#c89e4b');
      grad.addColorStop(0.5, '#f2d99a');
      grad.addColorStop(1, '#b88937');
      c.fillStyle = grad;
      c.fillRect(0, 0, w, h);
      for (let y = 3; y < h; y += 5) {
        c.fillStyle = y % 10 === 3 ? 'rgba(66, 36, 12, 0.35)' : 'rgba(255, 248, 224, 0.32)';
        c.fillRect(0, y, w, 1.8);
      }
    }, 128, 64);
  }

  function buildHardcoverDeckLidTexture(THREE, spec) {
    return makeTex(THREE, (c, w, h) => {
      const bg = c.createLinearGradient(0, 0, w, h);
      bg.addColorStop(0, spec.bgTop);
      bg.addColorStop(1, spec.bgBot);
      c.fillStyle = bg;
      c.fillRect(0, 0, w, h);

      // Ornate double gold-foil embossed border
      c.strokeStyle = spec.gold;
      c.lineWidth = 8;
      c.strokeRect(10, 10, w - 20, h - 20);
      c.strokeStyle = 'rgba(255, 236, 184, 0.55)';
      c.lineWidth = 2;
      c.strokeRect(20, 20, w - 40, h - 40);

      // Corner gold diamonds
      [[20, 20], [w - 20, 20], [20, h - 20], [w - 20, h - 20]].forEach(([cx, cy]) => {
        c.save();
        c.translate(cx, cy);
        c.rotate(Math.PI / 4);
        c.fillStyle = spec.gold;
        c.fillRect(-5, -5, 10, 10);
        c.restore();
      });

      // Decorative subtle top & bottom dividers
      c.strokeStyle = 'rgba(232, 196, 118, 0.45)';
      c.lineWidth = 2;
      c.beginPath(); c.moveTo(42, 54); c.lineTo(w - 42, 54); c.stroke();
      c.beginPath(); c.moveTo(42, h - 48); c.lineTo(w - 42, h - 48); c.stroke();

      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = '#f9e6b2';
      c.font = 'italic 700 28px Georgia, "Times New Roman", serif';
      fitCanvasText(c, spec.eyebrow, w / 2, 86, w - 56);

      c.fillStyle = spec.goldBright;
      c.font = '700 40px Georgia, "Times New Roman", serif';
      fitCanvasText(c, spec.title, w / 2, 140, w - 44);

      if (spec.sub) {
        c.fillStyle = '#f8df94';
        c.font = '800 32px system-ui, sans-serif';
        fitCanvasText(c, spec.sub, w / 2, 198, w - 52);
      }

      c.font = '48px sans-serif';
      c.fillText(spec.icon, w / 2, spec.sub ? 256 : 226);
    }, 256, 340);
  }

  function upgradeHeirloomProps(ctx, refs) {
    if (sceneState.propsUpgraded) return;
    sceneState.propsUpgraded = true;
    const { THREE } = ctx;

    const antiqueBrassMat = new THREE.MeshStandardMaterial({
      color: 0xdcb35c,
      roughness: 0.20,
      metalness: 0.90,
      envMapIntensity: 1.35,
    });
    const darkRosewoodMat = new THREE.MeshStandardMaterial({
      color: 0x261108,
      roughness: 0.36,
      metalness: 0.14,
      envMapIntensity: 0.85,
    });

    // 1. Ornate Brass & Crystal Hourglass (preserve topSandMesh/botSandMesh refs intact!)
    if (refs.sandTimerGroup && !refs.sandTimerGroup.userData._aaaUpgraded) {
      refs.sandTimerGroup.userData._aaaUpgraded = true;
      const crystalMat = new THREE.MeshStandardMaterial({
        color: 0xf0f9ff,
        transparent: true,
        opacity: 0.30,
        roughness: 0.06,
        metalness: 0.18,
        envMapIntensity: 1.45,
        depthWrite: false,
      });
      const champagneSandMat = new THREE.MeshStandardMaterial({
        color: 0xebb94d,
        roughness: 0.50,
        metalness: 0.22,
        emissive: new THREE.Color(0x3a2404),
        emissiveIntensity: 0.14,
      });

      refs.sandTimerGroup.children.forEach(ch => {
        if (!ch || !ch.isMesh || !ch.geometry) return;
        const gp = ch.geometry.parameters || {};
        if (ch.geometry.type === 'CylinderGeometry') {
          if (gp.radiusTop >= 0.8) {
            ch.material = darkRosewoodMat;
          } else {
            ch.material = antiqueBrassMat;
          }
        } else if (ch.geometry.type === 'ConeGeometry') {
          if (gp.radius >= 0.68) {
            ch.material = crystalMat;
          } else {
            ch.material = champagneSandMat;
          }
        }
      });

      // Add sculpted brass cap bezels, waist collar & top crown finial
      const baseRing = new THREE.Mesh(new THREE.TorusGeometry(1.12, 0.065, 10, 28), antiqueBrassMat);
      baseRing.rotation.x = Math.PI / 2;
      baseRing.position.y = 0.24;
      const topRing = new THREE.Mesh(new THREE.TorusGeometry(1.12, 0.065, 10, 28), antiqueBrassMat);
      topRing.rotation.x = Math.PI / 2;
      topRing.position.y = 3.08;
      const waistCollar = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.055, 8, 20), antiqueBrassMat);
      waistCollar.rotation.x = Math.PI / 2;
      waistCollar.position.y = 1.66;
      const topFinial = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), antiqueBrassMat);
      topFinial.position.y = 3.42;
      refs.sandTimerGroup.add(baseRing, topRing, waistCollar, topFinial);
    }

    // 2. Gilt-Edged Hardcover Recipe Decks & Action Deck (6-material arrays)
    const giltEdgeTex = buildGiltCardEdgeTexture(THREE);
    const giltEdgeMat = new THREE.MeshStandardMaterial({
      map: giltEdgeTex,
      roughness: 0.34,
      metalness: 0.48,
      envMapIntensity: 1.05,
    });
    const deckBottomMat = new THREE.MeshStandardMaterial({ color: 0x160c07, roughness: 0.7 });

    const upgradeDeck = (mesh, spec) => {
      if (!mesh || mesh.userData._aaaUpgraded) return;
      mesh.userData._aaaUpgraded = true;
      if (mesh.material && !Array.isArray(mesh.material) && mesh.material.map) {
        try { mesh.material.map.dispose(); } catch (_) {}
      }
      const lidTex = buildHardcoverDeckLidTexture(THREE, spec);
      const lidMat = new THREE.MeshStandardMaterial({
        map: lidTex,
        roughness: 0.36,
        metalness: 0.16,
        envMapIntensity: 0.9,
      });
      // BoxGeometry faces: +X, -X, +Y (top), -Y (bottom), +Z, -Z
      mesh.material = [giltEdgeMat, giltEdgeMat, lidMat, deckBottomMat, giltEdgeMat, giltEdgeMat];
    };

    upgradeDeck(refs.gourmetDeck, {
      bgTop: '#241242', bgBot: '#120824', gold: '#d8ae56', goldBright: '#fae29e',
      eyebrow: 'Món', title: 'ĐẶC SẢN', sub: '', icon: '👑',
    });
    upgradeDeck(refs.basicDeck, {
      bgTop: '#3d1909', bgBot: '#1f0b04', gold: '#d89b44', goldBright: '#f7d88f',
      eyebrow: 'Món', title: 'CƠ BẢN', sub: '', icon: '🍳',
    });
    upgradeDeck(refs.actionDeckMesh, {
      bgTop: '#083a2c', bgBot: '#041c15', gold: '#d4aa54', goldBright: '#f8e2a0',
      eyebrow: 'THẺ', title: 'HÀNH ĐỘNG', sub: '$200', icon: '⚡',
    });

    // 3. Refined Kitchen Service Hamper around Garbage Bag (preserves bounce animation & raycast)
    if (refs.garbageBagGroup && !refs.garbageBagGroup.userData._aaaUpgraded) {
      refs.garbageBagGroup.userData._aaaUpgraded = true;
      const linenSackMat = new THREE.MeshStandardMaterial({
        color: 0x1e1d20,
        roughness: 0.80,
        metalness: 0.08,
      });
      refs.garbageBagGroup.children.forEach(ch => {
        if (!ch || !ch.isMesh || !ch.geometry) return;
        if (ch.geometry.type === 'TorusGeometry') {
          ch.material = antiqueBrassMat;
        } else {
          ch.material = linenSackMat;
        }
      });

      // Sculpted slatted dark-rosewood & brushed-brass kitchen hamper collar around lower half
      const hamperGrp = new THREE.Group();
      hamperGrp.name = 'VdbKitchenHamper';
      const baseDisc = new THREE.Mesh(new THREE.CylinderGeometry(1.02, 0.94, 0.14, 20), darkRosewoodMat);
      baseDisc.position.y = 0.07;
      baseDisc.castShadow = true;
      hamperGrp.add(baseDisc);

      const botHoop = new THREE.Mesh(new THREE.TorusGeometry(1.01, 0.042, 8, 24), antiqueBrassMat);
      botHoop.rotation.x = Math.PI / 2;
      botHoop.position.y = 0.22;
      const topHoop = new THREE.Mesh(new THREE.TorusGeometry(1.09, 0.046, 8, 24), antiqueBrassMat);
      topHoop.rotation.x = Math.PI / 2;
      topHoop.position.y = 1.02;
      hamperGrp.add(botHoop, topHoop);

      const slatGeo = new THREE.BoxGeometry(0.14, 0.96, 0.05);
      const slatCount = 12;
      for (let s = 0; s < slatCount; s++) {
        const a = (s / slatCount) * Math.PI * 2;
        const r = 1.04;
        const slat = new THREE.Mesh(slatGeo, darkRosewoodMat);
        slat.position.set(Math.cos(a) * r, 0.56, Math.sin(a) * r);
        slat.rotation.y = -a + Math.PI / 2;
        slat.castShadow = true;
        hamperGrp.add(slat);
      }
      refs.garbageBagGroup.add(hamperGrp);
    }
  }

  function buildClockFaceTexture(THREE) {
    return makeTex(THREE, (ctx, w, h) => {
      const cx = w / 2, cy = h / 2, r = w * 0.44;
      // Rich brushed antique bronze backing
      ctx.fillStyle = '#3a2210';
      ctx.fillRect(0, 0, w, h);

      // Outer brushed-brass bezel ring
      const bezelGrad = ctx.createRadialGradient(cx, cy, r * 0.78, cx, cy, r * 1.08);
      bezelGrad.addColorStop(0, '#fae4a2');
      bezelGrad.addColorStop(0.62, '#c8963c');
      bezelGrad.addColorStop(1, '#5e3810');
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.06, 0, Math.PI * 2);
      ctx.fillStyle = bezelGrad;
      ctx.fill();

      // Warm Saigon enamel porcelain dial face
      const faceGrad = ctx.createRadialGradient(cx, cy - r * 0.14, r * 0.08, cx, cy, r * 0.96);
      faceGrad.addColorStop(0, '#fffdf6');
      faceGrad.addColorStop(0.82, '#f9ebca');
      faceGrad.addColorStop(1, '#dec082');
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.92, 0, Math.PI * 2);
      ctx.fillStyle = faceGrad;
      ctx.fill();

      // Inner heritage chapter rings
      ctx.strokeStyle = '#7c4512';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.84, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(124, 69, 18, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.62, 0, Math.PI * 2);
      ctx.stroke();

      // 12 bold antique-bronze hour indices
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
        const isCardinal = i % 3 === 0;
        const rIn = r * (isCardinal ? 0.62 : 0.70);
        const rOut = r * 0.82;
        ctx.strokeStyle = isCardinal ? '#5c1f0e' : '#3a2a1e';
        ctx.lineWidth = isCardinal ? 6.5 : 3.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * rIn, cy + Math.sin(a) * rIn);
        ctx.lineTo(cx + Math.cos(a) * rOut, cy + Math.sin(a) * rOut);
        ctx.stroke();
      }

      // Iconic 10:10 wrought-iron heritage hands
      ctx.strokeStyle = '#18100a';
      ctx.lineCap = 'round';
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx - r * 0.42, cy - r * 0.26);
      ctx.stroke();
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + r * 0.58, cy - r * 0.31);
      ctx.stroke();

      // Brushed brass center boss
      ctx.beginPath();
      ctx.arc(cx, cy, 9, 0, Math.PI * 2);
      ctx.fillStyle = '#a86b18';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#fef0b8';
      ctx.fill();
    }, 256, 256);
  }

  function buildBenThanhFacadeTexture(THREE) {
    return makeTex(THREE, (ctx, w, h) => {
      // Saigon heritage cream limestone plaster wall
      const wallGrad = ctx.createLinearGradient(0, 0, 0, h);
      wallGrad.addColorStop(0, '#f3e4c6');
      wallGrad.addColorStop(0.75, '#e8d0a3');
      wallGrad.addColorStop(1, '#d3b27b');
      ctx.fillStyle = wallGrad;
      ctx.fillRect(0, 0, w, h);

      // Subtle colonial ashlar masonry horizontal courses
      ctx.strokeStyle = 'rgba(122, 68, 22, 0.14)';
      ctx.lineWidth = 1.8;
      for (let y = 18; y < h; y += 22) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // Heritage base dado plinth band
      ctx.fillStyle = '#c49b5c';
      ctx.fillRect(0, h - 28, w, 28);
      ctx.fillStyle = 'rgba(92, 46, 14, 0.35)';
      ctx.fillRect(0, h - 28, w, 3);

      // Central grand arched gateway bathed in warm bistro amber light
      const archW = 116, archH = 120;
      const ax = (w - archW) / 2;
      const ay = h - archH;
      ctx.fillStyle = '#2d1205';
      ctx.beginPath();
      ctx.moveTo(ax, h);
      ctx.lineTo(ax, ay + archW / 2);
      ctx.arc(w / 2, ay + archW / 2, archW / 2, Math.PI, 0);
      ctx.lineTo(ax + archW, h);
      ctx.closePath();
      ctx.fill();

      // Warm golden lantern glow radiating from inside market hall
      const innerGlow = ctx.createRadialGradient(w / 2, h - 22, 8, w / 2, h - 46, 68);
      innerGlow.addColorStop(0, 'rgba(255, 228, 128, 0.92)');
      innerGlow.addColorStop(0.55, 'rgba(245, 162, 42, 0.45)');
      innerGlow.addColorStop(1, 'rgba(45, 18, 5, 0)');
      ctx.fillStyle = innerGlow;
      ctx.fillRect(ax, ay, archW, archH);

      // Sculpted limestone & antique-gold arch keystone trim
      ctx.strokeStyle = '#a87222';
      ctx.lineWidth = 6.5;
      ctx.beginPath();
      ctx.arc(w / 2, ay + archW / 2, archW / 2 + 2, Math.PI, 0);
      ctx.stroke();

      // Side arched colonial windows with warm glowing amber interiors & heritage jade shutters
      [92, w - 92].forEach(wx => {
        ctx.save();
        ctx.beginPath();
        ctx.arc(wx, h - 76, 26, Math.PI, 0);
        ctx.lineTo(wx + 26, h - 28);
        ctx.lineTo(wx - 26, h - 28);
        ctx.closePath();
        const wg = ctx.createRadialGradient(wx, h - 56, 4, wx, h - 56, 36);
        wg.addColorStop(0, '#ffe49e');
        wg.addColorStop(0.55, '#d98a2b');
        wg.addColorStop(1, '#14442b');
        ctx.fillStyle = wg;
        ctx.fill();
        ctx.strokeStyle = '#144c30';
        ctx.lineWidth = 4;
        ctx.stroke();
        // Fine window muntin mullions
        ctx.strokeStyle = 'rgba(24, 62, 40, 0.65)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(wx, h - 102); ctx.lineTo(wx, h - 28);
        ctx.moveTo(wx - 24, h - 62); ctx.lineTo(wx + 24, h - 62);
        ctx.stroke();
        ctx.restore();
      });

      // Iconic "CHỢ BẾN THÀNH" sơn son thếp vàng (crimson lacquer & gold-leaf serif) signboard
      drawRoundRect(ctx, w / 2 - 146, 10, 292, 46, 7);
      const signGrad = ctx.createLinearGradient(0, 10, 0, 56);
      signGrad.addColorStop(0, '#7c1215');
      signGrad.addColorStop(1, '#4d0a0c');
      ctx.fillStyle = signGrad;
      ctx.fill();
      ctx.strokeStyle = '#dfb559';
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.fillStyle = '#fae6a8';
      ctx.font = '700 24px Georgia, "Times New Roman", serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      fitCanvasText(ctx, 'CHỢ BẾN THÀNH', w / 2, 34, 264);
    }, 512, 192);
  }

  function buildRoofTileTexture(THREE) {
    return makeTex(THREE, (ctx, w, h) => {
      ctx.fillStyle = '#8f2b19';
      ctx.fillRect(0, 0, w, h);
      const rows = 8;
      const cols = 10;
      const rw = w / cols;
      const rh = h / rows;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const ox = (r % 2) * (rw * 0.5);
          const x = (c * rw + ox) % w;
          const y = r * rh;
          ctx.fillStyle = (r + c) % 2 === 0 ? '#a83620' : '#892716';
          ctx.beginPath();
          ctx.arc(x + rw * 0.5, y + rh * 0.62, rw * 0.48, 0, Math.PI);
          ctx.fill();
          ctx.strokeStyle = 'rgba(42, 10, 4, 0.48)';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
    }, 256, 256);
  }

  function buildKumquatBonsaiUrn(THREE, brassMat) {
    const grp = new THREE.Group();
    grp.userData.isDecorative = true;

    // Blue-and-white Saigon porcelain ceramic urn via LatheGeometry
    const urnTex = makeTex(THREE, (c, w, h) => {
      c.fillStyle = '#f6f1e4';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#184b82';
      c.fillRect(0, 10, w, 12);
      c.fillRect(0, h - 18, w, 10);
      for (let x = 8; x < w; x += 24) {
        c.beginPath();
        c.arc(x, h * 0.5, 7, 0, Math.PI * 2);
        c.strokeStyle = '#1e5896';
        c.lineWidth = 2.5;
        c.stroke();
      }
    }, 128, 64);
    const urnMat = new THREE.MeshStandardMaterial({ map: urnTex, roughness: 0.24, metalness: 0.08, envMapIntensity: 0.9 });
    let urnGeo;
    if (typeof THREE.LatheGeometry === 'function') {
      const pts = [
        new THREE.Vector2(0.14, 0.0),
        new THREE.Vector2(0.22, 0.08),
        new THREE.Vector2(0.27, 0.26),
        new THREE.Vector2(0.21, 0.40),
        new THREE.Vector2(0.25, 0.46),
      ];
      urnGeo = new THREE.LatheGeometry(pts, 16);
    } else {
      urnGeo = new THREE.CylinderGeometry(0.24, 0.16, 0.44, 14);
    }
    const urn = new THREE.Mesh(urnGeo, urnMat);
    if (typeof THREE.LatheGeometry !== 'function') urn.position.y = 0.22;
    urn.castShadow = true;
    grp.add(urn);

    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.022, 6, 16), brassMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.45;
    grp.add(rim);

    // Gnarled bonsai trunk + deep jade foliage crown + golden Tết kumquats
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3b2212, roughness: 0.85 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x16532e, roughness: 0.68 });
    const fruitMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: new THREE.Color(0xc26106),
      emissiveIntensity: 0.35,
      roughness: 0.32,
    });

    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.055, 0.34, 7), trunkMat);
    trunk.position.y = 0.56;
    grp.add(trunk);

    const foliageOffsets = [
      [0, 0.78, 0, 0.21],
      [-0.14, 0.70, 0.07, 0.15],
      [0.14, 0.72, -0.05, 0.15],
      [0.02, 0.90, 0.02, 0.14],
    ];
    foliageOffsets.forEach(([fx, fy, fz, fr]) => {
      const f = new THREE.Mesh(new THREE.SphereGeometry(fr, 10, 8), leafMat);
      f.position.set(fx, fy, fz);
      f.castShadow = true;
      grp.add(f);
    });

    const fruitGeo = new THREE.SphereGeometry(0.038, 7, 6);
    [[-0.16, 0.74, 0.14], [0.15, 0.78, 0.11], [0.02, 0.86, 0.17], [-0.05, 0.94, -0.06], [0.12, 0.66, -0.11]].forEach(([kx, ky, kz]) => {
      const k = new THREE.Mesh(fruitGeo, fruitMat);
      k.position.set(kx, ky, kz);
      grp.add(k);
    });

    return grp;
  }

  function buildBenThanhClockTower(THREE, boardHeight, boardCenterZ) {
    const group = new THREE.Group();
    group.name = 'VdbBenThanhClockTower';
    group.userData.isDecorative = true;

    const creamMat = new THREE.MeshStandardMaterial({ color: 0xefe0c2, roughness: 0.62, metalness: 0.04 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0xb78842, roughness: 0.42, metalness: 0.28 });
    const brassMat = new THREE.MeshStandardMaterial({
      color: 0xe2b85c,
      roughness: 0.19,
      metalness: 0.92,
      envMapIntensity: 1.35,
    });
    const roofTex = buildRoofTileTexture(THREE);
    roofTex.wrapS = THREE.RepeatWrapping;
    roofTex.wrapT = THREE.RepeatWrapping;
    roofTex.repeat.set(2, 2);
    const roofMat = new THREE.MeshStandardMaterial({ map: roofTex, color: 0xd96b52, roughness: 0.56, metalness: 0.08 });
    const facadeTex = buildBenThanhFacadeTexture(THREE);
    const facadeMat = new THREE.MeshStandardMaterial({ map: facadeTex, color: 0xf7ecd6, roughness: 0.58 });
    const clockTex = buildClockFaceTexture(THREE);
    const clockMat = new THREE.MeshStandardMaterial({
      map: clockTex,
      roughness: 0.34,
      emissive: new THREE.Color(0xffd780),
      emissiveMap: clockTex,
      emissiveIntensity: 0.18,
    });

    // Stepped Saigon granite & brass-trimmed plinth
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(3.68, 0.16, 1.78), trimMat);
    plinth.position.y = 0.08;
    plinth.receiveShadow = true;
    plinth.castShadow = true;
    group.add(plinth);

    const plinthBrass = new THREE.Mesh(new THREE.BoxGeometry(3.74, 0.035, 1.84), brassMat);
    plinthBrass.position.y = 0.165;
    group.add(plinthBrass);

    // Main market hall horizontal body (front & back feature illuminated Ben Thanh facade)
    const hallMats = [creamMat, creamMat, creamMat, creamMat, facadeMat, facadeMat];
    const hall = new THREE.Mesh(new THREE.BoxGeometry(3.25, 0.96, 1.32), hallMats);
    hall.position.y = 0.16 + 0.48;
    hall.castShadow = true;
    hall.receiveShadow = true;
    group.add(hall);

    // Side wing glazed terracotta pitched roofs flanking the central tower
    [-1.08, 1.08].forEach(xOff => {
      const wingRoof = new THREE.Mesh(new THREE.BoxGeometry(1.20, 0.22, 1.50), roofMat);
      wingRoof.position.set(xOff, 1.18, 0);
      wingRoof.castShadow = true;
      group.add(wingRoof);

      const ridge = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.08, 0.14), brassMat);
      ridge.position.set(xOff, 1.31, 0);
      group.add(ridge);
    });

    // Central clock tower lower & upper shaft
    const towerLower = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.92, 1.16), creamMat);
    towerLower.position.y = 1.56;
    towerLower.castShadow = true;
    group.add(towerLower);

    // Decorative brushed-brass & stone cornice band between lower & belfry
    const cornice = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.12, 1.32), trimMat);
    cornice.position.y = 2.04;
    cornice.castShadow = true;
    group.add(cornice);
    const corniceTrim = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.035, 1.36), brassMat);
    corniceTrim.position.y = 2.11;
    group.add(corniceTrim);

    // Belfry cube with 4 crisp CanvasTexture clock faces (+X, -X, +Z, -Z)
    const belfryMats = [clockMat, clockMat, trimMat, trimMat, clockMat, clockMat];
    const belfry = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.92, 1.06), belfryMats);
    belfry.position.y = 2.54;
    belfry.castShadow = true;
    group.add(belfry);

    // 4 Physical 3D Brushed-Brass Clock Bezels framing each clock face
    const bezelGeo = new THREE.TorusGeometry(0.40, 0.038, 10, 28);
    [
      { x: 0, z: 0.54, ry: 0 },
      { x: 0, z: -0.54, ry: 0 },
      { x: 0.54, z: 0, ry: Math.PI / 2 },
      { x: -0.54, z: 0, ry: Math.PI / 2 },
    ].forEach(b => {
      const ring = new THREE.Mesh(bezelGeo, brassMat);
      ring.position.set(b.x, 2.54, b.z);
      ring.rotation.y = b.ry;
      group.add(ring);
    });

    // Corner brushed-brass pilasters on belfry
    const pilasterGeo = new THREE.BoxGeometry(0.11, 0.96, 0.11);
    [[-0.52, -0.52], [0.52, -0.52], [-0.52, 0.52], [0.52, 0.52]].forEach(([px, pz]) => {
      const p = new THREE.Mesh(pilasterGeo, trimMat);
      p.position.set(px, 2.54, pz);
      group.add(p);
    });

    // Upper eave rim & terraced glazed terracotta pyramidal roof
    const topEave = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.10, 1.32), roofMat);
    topEave.position.y = 3.04;
    group.add(topEave);

    const pyrRoof = new THREE.Mesh(new THREE.ConeGeometry(0.94, 0.68, 4), roofMat);
    pyrRoof.rotation.y = Math.PI / 4;
    pyrRoof.position.y = 3.42;
    pyrRoof.castShadow = true;
    group.add(pyrRoof);

    // Brushed-brass finial lotus orb & spire
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.115, 12, 10), brassMat);
    orb.position.y = 3.78;
    group.add(orb);
    const spire = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.28, 8), brassMat);
    spire.position.y = 3.96;
    group.add(spire);

    // 4 Warm glowing Hội An silk lanterns with additive glow halo sprites
    const lanternBodyGeo = new THREE.SphereGeometry(0.13, 10, 8);
    const lanternCapGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.05, 8);
    const redLanternMat = new THREE.MeshStandardMaterial({
      color: 0xdc2626,
      emissive: new THREE.Color(0xff6b2b),
      emissiveIntensity: 1.05,
      roughness: 0.28,
    });
    const amberLanternMat = new THREE.MeshStandardMaterial({
      color: 0xe69f1e,
      emissive: new THREE.Color(0xffc74a),
      emissiveIntensity: 1.0,
      roughness: 0.28,
    });
    const glowSpriteMat = typeof THREE.SpriteMaterial === 'function'
      ? new THREE.SpriteMaterial({
        map: getLanternGlowTexture(THREE),
        color: 0xffc966,
        transparent: true,
        opacity: 0.56,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
      : null;

    const lanternCoords = [
      [-1.52, 0.96, 0.72, redLanternMat],
      [ 1.52, 0.96, 0.72, redLanternMat],
      [-0.78, 1.05, 0.72, amberLanternMat],
      [ 0.78, 1.05, 0.72, amberLanternMat],
    ];
    lanternCoords.forEach(([lx, ly, lz, lMat]) => {
      const lGroup = new THREE.Group();
      lGroup.position.set(lx, ly, lz);
      const body = new THREE.Mesh(lanternBodyGeo, lMat);
      body.scale.set(1.0, 1.25, 1.0);
      const topC = new THREE.Mesh(lanternCapGeo, brassMat);
      topC.position.y = 0.16;
      const botC = new THREE.Mesh(lanternCapGeo, brassMat);
      botC.position.y = -0.16;
      lGroup.add(body, topC, botC);
      if (glowSpriteMat && typeof THREE.Sprite === 'function') {
        const halo = new THREE.Sprite(glowSpriteMat);
        halo.scale.set(0.85, 0.85, 1);
        lGroup.add(halo);
      }
      group.add(lGroup);
    });

    // 2 Miniature Blue-and-White Porcelain Kumquat Bonsai Urns flanking the grand portico
    [-2.08, 2.08].forEach(ux => {
      const urn = buildKumquatBonsaiUrn(THREE, brassMat);
      urn.position.set(ux, 0, 0.45);
      group.add(urn);
    });

    // Warm golden PointLight bathing The Island (no shadow map)
    const warmLight = new THREE.PointLight(0xffb44c, 0.92, 14, 1.8);
    warmLight.position.set(0, 2.35, 1.30);
    warmLight.castShadow = false;
    group.add(warmLight);
    sceneState.clockPointLight = warmLight;

    // Position cleanly at north center of The Island
    group.position.set(0, boardHeight, boardCenterZ - 3.6);
    return group;
  }

  function buildAwningStripeTexture(THREE, colorHex, stripeHex) {
    return makeTex(THREE, (ctx, w, h) => {
      const stripes = 8;
      const sw = w / stripes;
      for (let i = 0; i < stripes; i++) {
        ctx.fillStyle = i % 2 === 0 ? colorHex : (stripeHex || '#faf1de');
        ctx.fillRect(i * sw, 0, sw + 1, h);
      }
      // Fine woven linen shading + gentle canopy fold shadow
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, 'rgba(255,244,218,0.16)');
      grad.addColorStop(0.76, 'rgba(0,0,0,0.08)');
      grad.addColorStop(1, 'rgba(0,0,0,0.34)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      // Antique gold-leaf scalloped valance band at bottom
      ctx.fillStyle = '#d8ae56';
      ctx.fillRect(0, h - 13, w, 13);
      ctx.fillStyle = '#4a2b0d';
      ctx.fillRect(0, h - 15, w, 2);
      for (let i = 0; i < stripes; i++) {
        ctx.fillStyle = '#fae4a8';
        ctx.beginPath();
        ctx.arc(i * sw + sw * 0.5, h - 6, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }, 256, 128);
  }

  function buildStallSignTexture(THREE, title, colorHex) {
    return makeTex(THREE, (ctx, w, h) => {
      // Sơn son thếp vàng (lacquered dark mahogany + jewel accent + gold leaf serif)
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#231009');
      bg.addColorStop(1, '#120805');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = colorHex;
      ctx.lineWidth = 7;
      ctx.strokeRect(4, 4, w - 8, h - 8);
      ctx.strokeStyle = '#dfb559';
      ctx.lineWidth = 2.4;
      ctx.strokeRect(11, 11, w - 22, h - 22);
      ctx.fillStyle = '#fae8b4';
      ctx.font = '700 26px Georgia, "Times New Roman", serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      fitCanvasText(ctx, title, w / 2, h / 2 + 1, w - 34);
    }, 320, 72);
  }

  function buildMarketStalls(THREE, boardHeight, boardCenterZ) {
    const stallsGroup = new THREE.Group();
    stallsGroup.name = 'VdbMarketStalls';
    stallsGroup.userData.isDecorative = true;

    const woodMat = new THREE.MeshStandardMaterial({ color: 0x2e150a, roughness: 0.44, metalness: 0.12 });
    const brassMat = new THREE.MeshStandardMaterial({
      color: 0xdcb35c,
      roughness: 0.22,
      metalness: 0.90,
      envMapIntensity: 1.3,
    });
    const postGeo = new THREE.CylinderGeometry(0.068, 0.084, 1.62, 8);
    const collarGeo = new THREE.CylinderGeometry(0.11, 0.12, 0.10, 8);
    const finialGeo = new THREE.SphereGeometry(0.095, 10, 8);
    const lanternGeo = new THREE.SphereGeometry(0.115, 10, 8);
    const stallGlowMat = typeof THREE.SpriteMaterial === 'function'
      ? new THREE.SpriteMaterial({
        map: getLanternGlowTexture(THREE),
        color: 0xffc864,
        transparent: true,
        opacity: 0.44,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
      : null;

    // 5 full outer-edge Indochine jewel-tone stalls with striped awnings, brass finials & silk lanterns
    const fullStalls = [
      { key: 'chop',      title: 'HÀNG THỊT',   colorHex: '#991b1b', colorNum: 0xb91c1c, x: -9.2, z: boardCenterZ - 9.72, w: 7.4, rotY: 0 },
      { key: 'dairy',     title: 'HẢI SẢN',     colorHex: '#b47b16', colorNum: 0xd4941a, x: -0.4, z: boardCenterZ - 9.72, w: 7.1, rotY: 0 },
      { key: 'mystery',   title: 'PHỐ GIA VỊ',  colorHex: '#6b21a8', colorNum: 0x7e22ce, x:  8.7, z: boardCenterZ - 9.72, w: 7.1, rotY: 0 },
      { key: 'carbs',     title: 'GẠO & PHỞ',   colorHex: '#a84a12', colorNum: 0xc25918, x: -13.65, z: boardCenterZ - 0.1, w: 9.4, rotY: Math.PI / 2 },
      { key: 'vegetable', title: 'RAU CỦ',      colorHex: '#15693d', colorNum: 0x168049, x:  13.65, z: boardCenterZ - 0.1, w: 9.4, rotY: -Math.PI / 2 },
    ];

    fullStalls.forEach(cfg => {
      const g = new THREE.Group();
      g.position.set(cfg.x, boardHeight, cfg.z);
      g.rotation.y = cfg.rotY;

      const halfW = cfg.w / 2;
      // 3 turned dark-rosewood posts with brushed-brass base collars & top finial orbs
      [-halfW + 0.18, 0, halfW - 0.18].forEach(px => {
        const post = new THREE.Mesh(postGeo, woodMat);
        post.position.set(px, 0.81, -0.05);
        post.castShadow = true;
        g.add(post);

        const collar = new THREE.Mesh(collarGeo, brassMat);
        collar.position.set(px, 0.05, -0.05);
        g.add(collar);

        const finial = new THREE.Mesh(finialGeo, brassMat);
        finial.position.set(px, 1.69, -0.05);
        g.add(finial);
      });

      // Top tie beam with antique-brass inlay strip
      const beam = new THREE.Mesh(new THREE.BoxGeometry(cfg.w, 0.11, 0.12), woodMat);
      beam.position.set(0, 1.56, -0.05);
      beam.castShadow = true;
      g.add(beam);

      // Compact tilted jewel-tone striped awning canopy extending slightly inward, clear of cards
      const awningTex = buildAwningStripeTexture(THREE, cfg.colorHex, '#faf1de');
      const awningMat = new THREE.MeshStandardMaterial({
        map: awningTex,
        roughness: 0.58,
        side: THREE.DoubleSide,
      });
      const canopy = new THREE.Mesh(new THREE.BoxGeometry(cfg.w + 0.18, 0.06, 0.86), awningMat);
      canopy.position.set(0, 1.58, 0.28);
      canopy.rotation.x = 0.34;
      canopy.castShadow = true;
      g.add(canopy);

      // Front sơn son thếp vàng sign crest above beam
      const signTex = buildStallSignTexture(THREE, cfg.title, cfg.colorHex);
      const signMat = new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.38, metalness: 0.12 });
      const signMesh = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.42, 0.08), [
        woodMat, woodMat, brassMat, woodMat, signMat, signMat,
      ]);
      signMesh.position.set(0, 1.94, -0.04);
      signMesh.castShadow = true;
      g.add(signMesh);

      // 2 glowing silk Vietnamese lanterns tucked under the awning corners
      const lMat = new THREE.MeshStandardMaterial({
        color: cfg.colorNum,
        emissive: new THREE.Color(cfg.colorNum),
        emissiveIntensity: 0.92,
        roughness: 0.28,
      });
      [-halfW + 0.72, halfW - 0.72].forEach(lx => {
        const orb = new THREE.Mesh(lanternGeo, lMat);
        orb.scale.set(1.0, 1.25, 1.0);
        orb.position.set(lx, 1.24, 0.36);
        g.add(orb);
        if (stallGlowMat && typeof THREE.Sprite === 'function') {
          const halo = new THREE.Sprite(stallGlowMat);
          halo.scale.set(0.68, 0.68, 1);
          halo.position.set(lx, 1.24, 0.36);
          g.add(halo);
        }
      });

      stallsGroup.add(g);
    });

    // 6th market: `fruit` (South edge) — low open porcelain-cobalt corner lantern pillars + curb rail
    // Keeps camera sightline & card raycasting 100% unobstructed from south view
    const fruitGroup = new THREE.Group();
    fruitGroup.position.set(-0.4, boardHeight, boardCenterZ + 9.72);
    const fruitColorHex = '#0c5a8a';
    const fruitColorNum = 0x0e6da6;
    const fruitAwningTex = buildAwningStripeTexture(THREE, fruitColorHex, '#f6efe0');
    const fruitAwningMat = new THREE.MeshStandardMaterial({ map: fruitAwningTex, roughness: 0.56, side: THREE.DoubleSide });
    const fruitLanternMat = new THREE.MeshStandardMaterial({
      color: fruitColorNum,
      emissive: new THREE.Color(0x38bdf8),
      emissiveIntensity: 0.92,
      roughness: 0.28,
    });
    const warmLanternMat = new THREE.MeshStandardMaterial({
      color: 0xe69f1e,
      emissive: new THREE.Color(0xffc857),
      emissiveIntensity: 0.94,
      roughness: 0.28,
    });

    const fruitHalfW = 7.75;
    [-fruitHalfW, fruitHalfW].forEach((px, idx) => {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.095, 1.38, 8), woodMat);
      post.position.set(px, 0.69, 0);
      post.castShadow = true;
      fruitGroup.add(post);

      const collar = new THREE.Mesh(collarGeo, brassMat);
      collar.position.set(px, 0.05, 0);
      fruitGroup.add(collar);

      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.56, 0.34, 4), fruitAwningMat);
      cap.rotation.y = Math.PI / 4;
      cap.position.set(px, 1.50, 0);
      cap.castShadow = true;
      fruitGroup.add(cap);

      const capFinial = new THREE.Mesh(finialGeo, brassMat);
      capFinial.position.set(px, 1.70, 0);
      fruitGroup.add(capFinial);

      const lantern = new THREE.Mesh(lanternGeo, idx === 0 ? fruitLanternMat : warmLanternMat);
      lantern.scale.set(1.0, 1.25, 1.0);
      lantern.position.set(px + (idx === 0 ? 0.28 : -0.28), 1.15, 0);
      fruitGroup.add(lantern);
    });

    const lowRail = new THREE.Mesh(new THREE.BoxGeometry(fruitHalfW * 2, 0.14, 0.14), woodMat);
    lowRail.position.set(0, 0.12, 0.08);
    fruitGroup.add(lowRail);

    const fruitSignTex = buildStallSignTexture(THREE, 'HOA QUẢ MIỀN TÂY', fruitColorHex);
    const fruitSignMat = new THREE.MeshStandardMaterial({ map: fruitSignTex, roughness: 0.38, metalness: 0.12 });
    const fruitSign = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.36, 0.08), [
      woodMat, woodMat, brassMat, woodMat, fruitSignMat, fruitSignMat,
    ]);
    fruitSign.position.set(0, 0.32, 0.14);
    fruitSign.rotation.x = -0.35;
    fruitGroup.add(fruitSign);

    stallsGroup.add(fruitGroup);
    return stallsGroup;
  }

  function buildSteamParticles(THREE, boardHeight, boardCenterZ) {
    const count = 34;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const basePos = new Float32Array(count * 3);
    const phases = new Float32Array(count);

    const cGold = new THREE.Color(0xfde68a);
    const cWarm = new THREE.Color(0xfffbeb);
    const cAmber = new THREE.Color(0xfbbf24);

    for (let i = 0; i < count; i++) {
      const bx = (Math.random() - 0.5) * 9.8;
      const by = boardHeight + 0.45 + Math.random() * 3.8;
      const bz = boardCenterZ - 3.6 + (Math.random() - 0.5) * 6.0;
      positions[i * 3] = bx;
      positions[i * 3 + 1] = by;
      positions[i * 3 + 2] = bz;
      basePos[i * 3] = bx;
      basePos[i * 3 + 1] = by;
      basePos[i * 3 + 2] = bz;
      phases[i] = Math.random() * Math.PI * 2;

      const pick = i % 3 === 0 ? cGold : (i % 3 === 1 ? cWarm : cAmber);
      colors[i * 3] = pick.r;
      colors[i * 3 + 1] = pick.g;
      colors[i * 3 + 2] = pick.b;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const spriteTex = makeTex(THREE, (ctx, w, h) => {
      const grad = ctx.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
      grad.addColorStop(0, 'rgba(255,255,255,0.95)');
      grad.addColorStop(0.45, 'rgba(254,240,138,0.52)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }, 64, 64);

    const mat = new THREE.PointsMaterial({
      size: 0.46,
      map: spriteTex,
      vertexColors: true,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const points = new THREE.Points(geo, mat);
    points.name = 'VdbIslandSteamSparkles';
    points.userData.isDecorative = true;
    points.visible = !prefersReducedMotion();

    sceneState.steamPoints = points;
    sceneState.steamBasePos = basePos;
    sceneState.steamPhase = phases;
    return points;
  }

  function startAmbient3DLoop() {
    if (sceneState.steamTimer) return;
    const isCoarse = HAS_DOM && window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const intervalMs = isCoarse ? 85 : 55; // lightweight ~12-18fps ambient particle updates

    sceneState.steamTimer = setInterval(() => {
      const ctx = sceneState.ctx;
      if (!ctx || !sceneState.steamPoints) return;
      if (HAS_DOM && document.visibilityState === 'hidden') return;

      const reduced = prefersReducedMotion();
      if (reduced) {
        if (sceneState.steamPoints.visible) {
          sceneState.steamPoints.visible = false;
          if (ctx.requestRender) ctx.requestRender(1);
        }
        return;
      }
      if (!sceneState.steamPoints.visible) {
        sceneState.steamPoints.visible = true;
      }

      const posAttr = sceneState.steamPoints.geometry.attributes.position;
      const basePos = sceneState.steamBasePos;
      const phases = sceneState.steamPhase;
      const bh = typeof ctx.boardHeight === 'number' ? ctx.boardHeight : 0.35;
      const t = performance.now() * 0.001;
      const minY = bh + 0.45;
      const maxY = bh + 4.45;

      for (let i = 0; i < phases.length; i++) {
        const y = posAttr.getY(i) + 0.024 + (i % 3) * 0.006;
        const wrappedY = y > maxY ? minY : y;
        const ph = phases[i];
        const driftX = Math.sin(t * 0.85 + ph) * 0.24;
        const driftZ = Math.cos(t * 0.7 + ph * 1.3) * 0.20;
        posAttr.setXYZ(i, basePos[i * 3] + driftX, wrappedY, basePos[i * 3 + 2] + driftZ);
      }
      posAttr.needsUpdate = true;

      // Subtle warm lantern breathing on Chợ Bến Thành PointLight
      if (sceneState.clockPointLight) {
        sceneState.clockPointLight.intensity = 0.92 + Math.sin(t * 2.1) * 0.09;
      }

      if (ctx.requestRender) ctx.requestRender(1);
    }, intervalMs);
  }

  function loadChefPortrait(chefId) {
    const cleanId = String(chefId || '').replace(/[^a-z0-9_-]/gi, '');
    if (!cleanId || !HAS_DOM) return Promise.resolve(null);
    if (sceneState.portraitCache.has(cleanId)) {
      return sceneState.portraitCache.get(cleanId);
    }
    const p = new Promise(resolve => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img.naturalWidth > 0 ? img : null);
      img.onerror = () => resolve(null);
      img.src = `./images/chefs/${cleanId}.webp`;
    });
    sceneState.portraitCache.set(cleanId, p);
    return p;
  }

  function buildPortraitStandeeTexture(THREE, img, name, colorHex) {
    return makeTex(THREE, (ctx, w, h) => {
      // Fine Saigon porcelain-ivory heirloom plate
      ctx.fillStyle = '#faf4e6';
      drawRoundRect(ctx, 6, 6, w - 12, h - 12, 24);
      ctx.fill();

      // Portrait frame clipped neatly
      const pad = 16;
      const frameW = w - pad * 2;
      const frameH = h - 86;
      ctx.save();
      drawRoundRect(ctx, pad, pad, frameW, frameH, 16);
      ctx.clip();

      // Cover-crop portrait preserving aspect ratio
      const iw = img.naturalWidth || img.width || frameW;
      const ih = img.naturalHeight || img.height || frameH;
      const scale = Math.max(frameW / iw, frameH / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      const dx = pad + (frameW - dw) / 2;
      const dy = pad + (frameH - dh) * 0.28;
      ctx.drawImage(img, dx, dy, dw, dh);

      // Subtle warm bottom vignette into nameplate
      const vig = ctx.createLinearGradient(0, pad + frameH - 44, 0, pad + frameH);
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, 'rgba(15,10,8,0.52)');
      ctx.fillStyle = vig;
      ctx.fillRect(pad, pad + frameH - 44, frameW, 44);
      ctx.restore();

      // Lacquered team-color & antique-gold nameplate plaque
      const ribY = h - 68;
      drawRoundRect(ctx, 14, ribY, w - 28, 52, 11);
      ctx.fillStyle = colorHex || '#9a5814';
      ctx.fill();
      ctx.strokeStyle = '#e5be6a';
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.fillStyle = '#fff9eb';
      ctx.font = '700 23px Georgia, "Times New Roman", serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      fitCanvasText(ctx, String(name || '').toUpperCase(), w / 2, ribY + 27, w - 48);

      // Outer team lacquer border + double antique-gold hairline
      drawRoundRect(ctx, 8, 8, w - 16, h - 16, 22);
      ctx.strokeStyle = colorHex || '#b46918';
      ctx.lineWidth = 9;
      ctx.stroke();

      drawRoundRect(ctx, 15, 15, w - 30, h - 30, 16);
      ctx.strokeStyle = 'rgba(232, 194, 112, 0.85)';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }, 256, 310);
  }

  function upgradeChefStandee(standee, chefId, name, emoji, colorHex) {
    if (!standee) return;
    const THREE = (sceneState.ctx && sceneState.ctx.THREE) || global.THREE;
    if (!THREE) return;

    const meta = CHEF_FALLBACK_META[chefId] || {};
    const finalName = name || meta.name || chefId || 'Đầu Bếp';
    const finalColor = colorHex || meta.colorHex || '#f59e0b';

    // 1. Weighted Brushed-Brass & Lacquered-Ebony Heirloom Pedestal (once per standee)
    if (!standee.userData._aaaRingBase) {
      standee.userData._aaaRingBase = true;
      const brassMat = new THREE.MeshStandardMaterial({
        color: 0xe2b85c,
        metalness: 0.90,
        roughness: 0.20,
        envMapIntensity: 1.32,
      });
      const teamColorNum = new THREE.Color(finalColor);
      const teamTrimMat = new THREE.MeshStandardMaterial({
        color: teamColorNum,
        metalness: 0.42,
        roughness: 0.28,
        envMapIntensity: 0.95,
      });

      // Upgrade base cylinder material to rich glossy lacquered team enamel
      const baseCyl = standee.children[0];
      if (baseCyl && baseCyl.isMesh && baseCyl.geometry && baseCyl.geometry.type === 'CylinderGeometry') {
        baseCyl.material = new THREE.MeshStandardMaterial({
          color: teamColorNum.clone().multiplyScalar(0.55),
          metalness: 0.36,
          roughness: 0.24,
          envMapIntensity: 1.0,
        });
      }

      const topRing = new THREE.Mesh(new THREE.TorusGeometry(0.88, 0.058, 10, 28), brassMat);
      topRing.rotation.x = Math.PI / 2;
      topRing.position.y = 0.30;
      standee.add(topRing);

      const botRing = new THREE.Mesh(new THREE.TorusGeometry(0.98, 0.052, 10, 28), brassMat);
      botRing.rotation.x = Math.PI / 2;
      botRing.position.y = 0.048;
      standee.add(botRing);

      // Weighted brass clamp saddle at base of heirloom plate
      const clampBar = new THREE.Mesh(new THREE.BoxGeometry(1.38, 0.14, 0.24), teamTrimMat);
      clampBar.position.y = 0.34;
      standee.add(clampBar);
      const clampTrim = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.04, 0.27), brassMat);
      clampTrim.position.y = 0.41;
      standee.add(clampTrim);

      if (sceneState.ctx && sceneState.ctx.requestRender) {
        sceneState.ctx.requestRender(2);
      }
    }

    // 2. Asynchronously upgrade the acrylic standee plate with chef portrait WebP
    if (!chefId || standee.userData._aaaPortraitChef === chefId) return;
    standee.userData._aaaPortraitChef = chefId;

    loadChefPortrait(chefId).then(img => {
      if (!img || standee.userData._aaaPortraitChef !== chefId) return;
      const plate = standee.children.find(ch =>
        ch && ch.isMesh && ch.geometry && ch.geometry.type === 'BoxGeometry'
        && ch.position && ch.position.y > 0.8
      );
      if (!plate) return;

      const tex = buildPortraitStandeeTexture(THREE, img, finalName, finalColor);
      const edgeMat = new THREE.MeshStandardMaterial({
        color: 0xdcb35c,
        metalness: 0.82,
        roughness: 0.24,
        envMapIntensity: 1.15,
      });
      const faceMat = new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.28,
        metalness: 0.06,
      });

      if (plate.material && !Array.isArray(plate.material) && plate.material.map) {
        try { plate.material.map.dispose(); } catch (_) {}
      }
      plate.material = [edgeMat, edgeMat, edgeMat, edgeMat, faceMat, faceMat];
      plate.material.needsUpdate = true;
      standee.userData._aaaPortraitLoaded = true;

      if (sceneState.ctx && sceneState.ctx.requestRender) {
        sceneState.ctx.requestRender(3);
      }
    });
  }

  // ------------------------------------------
  // 3B. HYBRID AAA TABLETOP STAGE (ZONES, BADGES, TOOLTIP, TILT & STAGE CAMERA)
  // ------------------------------------------
  function getMarketZoneSpecs(boardHeight, boardCenterZ) {
    return {
      fruit: {
        key: 'fruit', emoji: '🍉', name: 'Chợ Hoa Quả Miền Tây', short: 'Hoa Quả', cost: 100, color: 0x0284c7,
        cx: -0.4, cz: boardCenterZ + 8.1, w: 13.0, d: 2.55, h: 2.0,
        bx: -0.4, by: boardHeight + 1.55, bz: boardCenterZ + 8.1,
      },
      vegetable: {
        key: 'vegetable', emoji: '🥗', name: 'Chợ Rau Củ Đà Lạt', short: 'Rau Củ', cost: 100, color: 0x16a34a,
        cx: 12.1, cz: boardCenterZ - 0.1, w: 2.45, d: 10.6, h: 2.2,
        bx: 12.1, by: boardHeight + 2.15, bz: boardCenterZ - 0.1,
      },
      carbs: {
        key: 'carbs', emoji: '🌾', name: 'Chợ Gạo & Bánh Phở', short: 'Gạo & Phở', cost: 100, color: 0xd97706,
        cx: -12.1, cz: boardCenterZ - 0.1, w: 2.45, d: 10.6, h: 2.2,
        bx: -12.1, by: boardHeight + 2.15, bz: boardCenterZ - 0.1,
      },
      chop: {
        key: 'chop', emoji: '🥩', name: 'Lò Mổ & Hàng Thịt Tươi', short: 'Hàng Thịt', cost: 200, color: 0xdc2626,
        cx: -9.2, cz: boardCenterZ - 8.1, w: 7.9, d: 2.55, h: 2.3,
        bx: -9.2, by: boardHeight + 1.55, bz: boardCenterZ - 7.6,
      },
      dairy: {
        key: 'dairy', emoji: '🦐', name: 'Vựa Hải Sản Vũng Tàu', short: 'Hải Sản', cost: 200, color: 0xeab308,
        cx: -0.4, cz: boardCenterZ - 8.1, w: 7.7, d: 2.55, h: 2.3,
        bx: -0.4, by: boardHeight + 1.55, bz: boardCenterZ - 7.6,
      },
      mystery: {
        key: 'mystery', emoji: '🌿', name: 'Phố Gia Vị Huyền Bí', short: 'Gia Vị', cost: 300, color: 0x9333ea,
        cx: 8.7, cz: boardCenterZ - 8.1, w: 7.7, d: 2.55, h: 2.3,
        bx: 8.7, by: boardHeight + 1.55, bz: boardCenterZ - 7.6,
      },
      island: {
        key: 'island', emoji: '🏮', name: 'Chợ Bến Thành (Đảo Trung Tâm)', short: 'Chợ Bến Thành', cost: 0, color: 0x0d9488,
        cx: 0, cz: boardCenterZ, w: 12.6, d: 9.0, h: 1.4,
        bx: 0, by: boardHeight + 4.35, bz: boardCenterZ - 3.6,
        towerHit: { x: 0, y: boardHeight + 2.1, z: boardCenterZ - 3.6, w: 3.9, h: 4.2, d: 2.2 },
      },
    };
  }

  function ensureStageOverlayDOM() {
    if (!HAS_DOM || !document.body) return;
    if (!sceneState.stageStylesInjected) {
      sceneState.stageStylesInjected = true;
      const st = document.createElement('style');
      st.id = 'vdb-aaa-stage-styles';
      st.textContent = `
        #vdb-3d-badges-layer {
          position: fixed;
          inset: 0;
          z-index: 8;
          pointer-events: none;
          overflow: hidden;
        }
        .vdb-3d-badge {
          position: absolute;
          left: 0;
          top: 0;
          transform: translate(-50%, -100%);
          display: none;
          align-items: center;
          gap: 4px;
          padding: 3px 9px;
          border-radius: 999px;
          font: 800 11px/1.15 system-ui, -apple-system, sans-serif;
          letter-spacing: 0.02em;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          pointer-events: none;
          box-shadow: 0 8px 20px rgba(0, 0, 0, 0.72), inset 0 1px 0 rgba(255, 236, 186, 0.16);
          will-change: transform;
        }
        .vdb-3d-badge.is-need {
          background: linear-gradient(135deg, rgba(138, 66, 12, 0.95), rgba(92, 40, 8, 0.95));
          color: #fae6a8;
          border: 1.5px solid #e0b861;
          animation: vdbBadgePulse 1.8s ease-in-out infinite;
        }
        .vdb-3d-badge.is-selected {
          background: linear-gradient(135deg, #e7be67, #c28e33);
          color: #160d06;
          border: 1.5px solid #fdf0c4;
          box-shadow: 0 0 18px rgba(226, 184, 92, 0.65), 0 6px 16px rgba(0, 0, 0, 0.65);
        }
        .vdb-3d-badge.is-active {
          background: linear-gradient(135deg, rgba(8, 52, 44, 0.96), rgba(6, 36, 32, 0.96));
          color: #f8e6b4;
          border: 1.5px solid #d8ae56;
          font-family: Georgia, "Times New Roman", serif;
          box-shadow: 0 0 16px rgba(216, 174, 86, 0.35), 0 6px 18px rgba(0, 0, 0, 0.72);
        }
        .vdb-3d-badge.is-closed {
          background: rgba(120, 18, 20, 0.96);
          color: #fee2e2;
          border: 1.5px solid #e08282;
          padding: 5px 14px;
          font-size: 12px;
        }
        /* Indochine Collector's Edition Clickable 3D Market Plaques (Phase 1 — Desktop & Mobile) */
        .vdb-3d-market-pill {
          position: absolute;
          left: 0;
          top: 0;
          display: none;
          align-items: center;
          gap: 5px;
          padding: 5px 10px;
          border-radius: 999px;
          border: 1.5px solid var(--pill-accent, rgba(218, 178, 102, 0.65));
          background: linear-gradient(180deg, rgba(22, 14, 10, 0.94), rgba(12, 8, 6, 0.95));
          color: #f8f0df;
          font: 700 11.5px/1.15 system-ui, -apple-system, sans-serif;
          white-space: nowrap;
          pointer-events: auto;
          cursor: pointer;
          box-shadow: 0 8px 20px rgba(0, 0, 0, 0.74), inset 0 1px 0 rgba(255, 232, 180, 0.14);
          transition: filter 0.14s ease, box-shadow 0.14s ease, border-color 0.14s ease;
          will-change: transform;
        }
        .vdb-3d-market-pill .vdb-mp-label {
          font-family: Georgia, "Times New Roman", serif;
          font-weight: 700;
          letter-spacing: 0.01em;
        }
        .vdb-3d-market-pill:hover {
          filter: brightness(1.14);
          border-color: #f3d589;
          box-shadow: 0 0 18px rgba(226, 184, 92, 0.48), 0 8px 22px rgba(0, 0, 0, 0.78);
        }
        .vdb-3d-market-pill.is-selected {
          background: linear-gradient(135deg, #ecc46e, #c48e32);
          color: #160c05;
          border-color: #fff3cb;
          box-shadow: 0 0 22px rgba(232, 188, 96, 0.75), 0 8px 20px rgba(0, 0, 0, 0.7);
        }
        .vdb-3d-market-pill .vdb-mp-cost {
          font-weight: 800;
          opacity: 0.88;
          font-size: 10.5px;
          font-variant-numeric: tabular-nums;
        }
        .vdb-3d-market-pill .vdb-mp-need {
          padding: 1px 6px;
          border-radius: 999px;
          background: rgba(216, 168, 72, 0.24);
          border: 1px solid rgba(238, 200, 114, 0.72);
          color: #fae6a8;
          font-weight: 900;
          font-size: 10.5px;
        }
        .vdb-3d-market-pill.is-selected .vdb-mp-need {
          background: rgba(22, 12, 6, 0.86);
          color: #f8df94;
          border-color: rgba(22, 12, 6, 0.6);
        }
        /* Indochine Collector's Edition Phase 2 Card & Shelf Plaques (Desktop & Mobile) */
        .vdb-3d-card-pill {
          position: absolute;
          left: 0;
          top: 0;
          display: none;
          flex-direction: column;
          align-items: center;
          gap: 3px;
          min-width: 118px;
          max-width: 162px;
          padding: 6px 8px;
          border-radius: 12px;
          border: 1.5px solid rgba(218, 178, 102, 0.62);
          background: linear-gradient(180deg, rgba(22, 14, 10, 0.95), rgba(11, 7, 5, 0.96));
          color: #faf4e6;
          font: 700 11px/1.2 system-ui, -apple-system, sans-serif;
          text-align: center;
          pointer-events: auto;
          cursor: pointer;
          box-shadow: 0 10px 26px rgba(0, 0, 0, 0.76), inset 0 1px 0 rgba(255, 232, 180, 0.14);
          transition: filter 0.14s ease, border-color 0.14s ease, box-shadow 0.14s ease;
          will-change: transform;
        }
        .vdb-3d-card-pill:hover:not(:disabled) {
          filter: brightness(1.12);
          border-color: #f3d589;
          box-shadow: 0 0 18px rgba(226, 184, 92, 0.48), 0 10px 24px rgba(0, 0, 0, 0.78);
        }
        .vdb-3d-card-pill:disabled {
          opacity: 0.62;
          cursor: default;
        }
        .vdb-3d-card-pill.is-needed {
          border-color: #f3d589;
          box-shadow: 0 0 18px rgba(232, 192, 98, 0.44), 0 10px 24px rgba(0, 0, 0, 0.75);
        }
        .vdb-3d-card-pill.is-claimed {
          border-style: dashed;
          border-color: #e8924f;
        }
        .vdb-3d-card-pill.is-owned {
          border-color: #5eead4;
          background: linear-gradient(180deg, rgba(8, 48, 38, 0.95), rgba(5, 30, 24, 0.96));
          opacity: 0.94;
        }
        .vdb-3d-card-pill.is-shelf {
          border-color: #a5b4fc;
          background: linear-gradient(180deg, rgba(26, 20, 56, 0.95), rgba(14, 11, 34, 0.96));
        }
        .vdb-3d-card-pill .vdb-cp-name {
          font-family: Georgia, "Times New Roman", serif;
          font-weight: 700;
          font-size: 11px;
          color: #f9ebd0;
          max-width: 146px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .vdb-3d-card-pill .vdb-cp-meta {
          font-size: 10px;
          font-weight: 700;
          color: #f3d589;
          max-width: 146px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .vdb-3d-card-pill .vdb-cp-owner {
          font-size: 10px;
          color: #d6c7b4;
          max-width: 146px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .vdb-3d-card-pill .vdb-cp-cta {
          width: 100%;
          padding: 3px 7px;
          border-radius: 7px;
          font-weight: 900;
          font-size: 11px;
          line-height: 1.2;
          background: linear-gradient(135deg, #e7be67, #c28e33);
          color: #160c05;
          font-variant-numeric: tabular-nums;
        }
        .vdb-3d-card-pill.is-claimed .vdb-cp-cta {
          background: rgba(217, 100, 32, 0.25);
          border: 1px dashed #f09b52;
          color: #fde0c2;
        }
        .vdb-3d-card-pill.is-owned .vdb-cp-cta {
          background: rgba(20, 184, 166, 0.24);
          color: #7bf1dc;
        }
        .vdb-3d-card-pill.is-empty .vdb-cp-cta,
        .vdb-3d-card-pill.is-sold .vdb-cp-cta {
          background: rgba(68, 58, 52, 0.6);
          color: #b4a89e;
        }
        .vdb-3d-card-pill.is-shelf .vdb-cp-cta {
          background: linear-gradient(135deg, #7c83f4, #4f46e5);
          color: #eef2ff;
        }
        /* Indochine Phase 2 Island Service Plaques */
        .vdb-3d-island-group {
          position: absolute;
          left: 0;
          top: 0;
          display: none;
          align-items: center;
          gap: 4px;
          pointer-events: auto;
          will-change: transform;
        }
        .vdb-3d-island-btn {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 6px 11px;
          border-radius: 999px;
          border: 1.5px solid var(--isl-border, rgba(218, 178, 102, 0.72));
          background: var(--isl-bg, rgba(16, 11, 8, 0.94));
          color: #faf2df;
          font: 800 11.5px/1.15 system-ui, -apple-system, sans-serif;
          white-space: nowrap;
          cursor: pointer;
          box-shadow: 0 8px 22px rgba(0, 0, 0, 0.76), inset 0 1px 0 rgba(255, 234, 184, 0.14);
          transition: filter 0.14s ease, border-color 0.14s ease;
        }
        .vdb-3d-island-btn:hover:not(:disabled) {
          filter: brightness(1.15);
          border-color: #f3d589;
        }
        .vdb-3d-island-btn:disabled {
          opacity: 0.48;
          cursor: not-allowed;
        }
        .vdb-3d-island-btn.is-secondary {
          padding: 6px 9px;
          background: rgba(128, 22, 22, 0.94);
          border-color: #f2a0a0;
          color: #fee2e2;
        }
        @keyframes vdbBadgePulse {
          0%, 100% { filter: brightness(1); }
          50%      { filter: brightness(1.22); }
        }
        #vdb-3d-tooltip {
          position: fixed;
          left: 0;
          top: 0;
          z-index: 45;
          pointer-events: none;
          display: none;
          max-width: 270px;
          padding: 8px 11px;
          border-radius: 12px;
          background: linear-gradient(180deg, rgba(20, 12, 9, 0.96), rgba(10, 7, 5, 0.97));
          border: 1.5px solid rgba(218, 178, 102, 0.78);
          box-shadow: 0 14px 34px rgba(0, 0, 0, 0.78), 0 0 16px rgba(216, 174, 86, 0.20), inset 0 1px 0 rgba(255, 232, 180, 0.14);
          color: #f5efe3;
          font: 600 12px/1.35 system-ui, -apple-system, sans-serif;
        }
        #vdb-3d-tooltip .vdb-tt-title {
          font-family: Georgia, "Times New Roman", serif;
          font-weight: 700;
          font-size: 13.5px;
          color: #f5da94;
          margin-bottom: 2px;
        }
        #vdb-3d-tooltip .vdb-tt-sub {
          font-size: 11px;
          color: #d6c7b4;
        }
        #vdb-3d-tooltip .vdb-tt-hint {
          margin-top: 4px;
          padding: 2px 7px;
          border-radius: 6px;
          background: rgba(216, 174, 86, 0.22);
          border: 1px solid rgba(226, 186, 104, 0.58);
          color: #fae6a8;
          font-weight: 800;
          font-size: 11px;
          display: none;
        }
        @media (min-width: 768px) and (max-width: 1023px) {
          .vdb-3d-market-pill {
            padding: 4px 8px;
            font-size: 10.5px;
            gap: 4px;
          }
          .vdb-3d-market-pill .vdb-mp-cost,
          .vdb-3d-market-pill .vdb-mp-need {
            font-size: 9.5px;
          }
          .vdb-3d-card-pill {
            min-width: 96px;
            max-width: 132px;
            padding: 5px 6px;
            font-size: 10px;
          }
          .vdb-3d-card-pill .vdb-cp-name {
            font-size: 10px;
            max-width: 118px;
          }
          .vdb-3d-card-pill .vdb-cp-meta,
          .vdb-3d-card-pill .vdb-cp-owner {
            font-size: 9.5px;
            max-width: 118px;
          }
          .vdb-3d-card-pill .vdb-cp-cta {
            font-size: 10px;
            padding: 2px 5px;
          }
          .vdb-3d-island-btn {
            padding: 5px 8px;
            font-size: 10.5px;
          }
        }
        @media (max-width: 767px) {
          .vdb-3d-badge { font-size: 10.5px; padding: 3px 9px; max-width: calc(100vw - 16px); }
          .vdb-3d-market-pill {
            padding: 4px 7px;
            min-height: 30px;
            font-size: 10.5px;
            gap: 3.5px;
          }
          .vdb-3d-market-pill .vdb-mp-cost,
          .vdb-3d-market-pill .vdb-mp-need {
            font-size: 9.5px;
          }
          .vdb-3d-card-pill {
            width: 152px;
            min-width: 132px;
            max-width: 164px;
            padding: 5px 7px;
            gap: 2.5px;
            font-size: 10.5px;
            border-radius: 10px;
          }
          .vdb-3d-card-pill .vdb-cp-name {
            font-size: 10.5px;
            max-width: 138px;
          }
          .vdb-3d-card-pill .vdb-cp-meta,
          .vdb-3d-card-pill .vdb-cp-owner {
            font-size: 9.5px;
            max-width: 138px;
          }
          .vdb-3d-card-pill .vdb-cp-cta {
            font-size: 10.5px;
            padding: 3px 6px;
          }
          .vdb-3d-island-btn {
            padding: 5px 8.5px;
            min-height: 30px;
            font-size: 10.5px;
            gap: 4px;
          }
          .vdb-3d-island-btn.is-secondary {
            padding: 5px 7px;
          }
        }
        @media (max-width: 359px) {
          .vdb-3d-market-pill {
            padding: 3.5px 6px;
            min-height: 28px;
            font-size: 9.5px;
            gap: 2.5px;
          }
          .vdb-3d-market-pill .vdb-mp-cost,
          .vdb-3d-market-pill .vdb-mp-need {
            font-size: 8.8px;
          }
          .vdb-3d-card-pill {
            width: 136px;
            min-width: 124px;
            max-width: 146px;
            padding: 4px 5.5px;
            font-size: 9.8px;
          }
          .vdb-3d-card-pill .vdb-cp-name,
          .vdb-3d-card-pill .vdb-cp-meta,
          .vdb-3d-card-pill .vdb-cp-owner {
            max-width: 124px;
            font-size: 9.5px;
          }
          .vdb-3d-card-pill .vdb-cp-cta {
            font-size: 9.8px;
            padding: 2.5px 5px;
          }
          .vdb-3d-island-btn {
            padding: 4px 6.5px;
            min-height: 28px;
            font-size: 9.6px;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .vdb-3d-badge.is-need { animation: none; }
        }
      `;
      document.head.appendChild(st);
    }

    if (!sceneState.badgesLayer || !sceneState.badgesLayer.isConnected) {
      let layer = document.getElementById('vdb-3d-badges-layer');
      if (!layer) {
        layer = document.createElement('div');
        layer.id = 'vdb-3d-badges-layer';
        layer.setAttribute('aria-hidden', 'true');
        document.body.appendChild(layer);
      }
      sceneState.badgesLayer = layer;
    }

    if (!sceneState.tooltipEl || !sceneState.tooltipEl.isConnected) {
      let tt = document.getElementById('vdb-3d-tooltip');
      if (!tt) {
        tt = document.createElement('div');
        tt.id = 'vdb-3d-tooltip';
        tt.setAttribute('aria-hidden', 'true');
        const titleEl = document.createElement('div');
        titleEl.className = 'vdb-tt-title';
        const subEl = document.createElement('div');
        subEl.className = 'vdb-tt-sub';
        const hintEl = document.createElement('div');
        hintEl.className = 'vdb-tt-hint';
        tt.append(titleEl, subEl, hintEl);
        document.body.appendChild(tt);
        sceneState.tooltipTitleEl = titleEl;
        sceneState.tooltipSubEl = subEl;
        sceneState.tooltipHintEl = hintEl;
      } else {
        sceneState.tooltipTitleEl = tt.querySelector('.vdb-tt-title');
        sceneState.tooltipSubEl = tt.querySelector('.vdb-tt-sub');
        sceneState.tooltipHintEl = tt.querySelector('.vdb-tt-hint');
      }
      sceneState.tooltipEl = tt;
    }
  }

  function showTooltip(clientX, clientY, title, sub, hint) {
    ensureStageOverlayDOM();
    const tt = sceneState.tooltipEl;
    if (!tt) return;
    if (sceneState.tooltipTitleEl) sceneState.tooltipTitleEl.textContent = String(title || '');
    if (sceneState.tooltipSubEl) sceneState.tooltipSubEl.textContent = String(sub || '');
    if (sceneState.tooltipHintEl) {
      if (hint) {
        sceneState.tooltipHintEl.textContent = String(hint);
        sceneState.tooltipHintEl.style.display = 'inline-block';
      } else {
        sceneState.tooltipHintEl.textContent = '';
        sceneState.tooltipHintEl.style.display = 'none';
      }
    }
    tt.style.display = 'block';

    const vw = HAS_DOM ? window.innerWidth : 1280;
    const vh = HAS_DOM ? window.innerHeight : 800;
    const rect = tt.getBoundingClientRect();
    const tw = rect.width || 220;
    const th = rect.height || 64;
    let x = clientX + 16;
    let y = clientY - th - 12;
    if (x + tw > vw - 12) x = clientX - tw - 16;
    if (x < 10) x = 10;
    if (y < 10) y = clientY + 18;
    if (y + th > vh - 10) y = Math.max(10, vh - th - 10);
    tt.style.left = Math.round(x) + 'px';
    tt.style.top = Math.round(y) + 'px';
  }

  function hideTooltip() {
    if (sceneState.tooltipEl) sceneState.tooltipEl.style.display = 'none';
  }

  function getPhaseSafe() {
    const ic = sceneState.interactiveCtx;
    if (ic && typeof ic.getPhase === 'function') {
      try {
        const p = Number(ic.getPhase());
        if (p === 1 || p === 2 || p === 3) return p;
      } catch (_) {}
    }
    return 1;
  }

  function getSelectedDestSafe() {
    const ic = sceneState.interactiveCtx;
    if (ic && typeof ic.getSelectedDest === 'function') {
      try { return ic.getSelectedDest() || null; } catch (_) {}
    }
    return null;
  }

  function getCurrentLocationSafe() {
    const ic = sceneState.interactiveCtx;
    if (ic && typeof ic.getCurrentLocation === 'function') {
      try { return ic.getCurrentLocation() || null; } catch (_) {}
    }
    return null;
  }

  function isModalOpenSafe() {
    const ic = sceneState.interactiveCtx;
    if (ic && typeof ic.isModalOpen === 'function') {
      try { if (ic.isModalOpen()) return true; } catch (_) {}
    }
    if (!HAS_DOM) return false;
    try {
      if (document.querySelector('dialog[open]')) return true;
      const lobby = document.getElementById('hpvn-lobby');
      if (lobby && lobby.style.display && lobby.style.display !== 'none') return true;
    } catch (_) {}
    return false;
  }

  function getRawNeedsSafe() {
    const ic = sceneState.interactiveCtx;
    if (ic && typeof ic.getMarketNeeds === 'function') {
      try { return ic.getMarketNeeds() || {}; } catch (_) {}
    }
    return {};
  }

  function normalizeMarketNeed(rawNeeds, key) {
    if (!rawNeeds || !key) return { count: 0, recipes: [], byCard: {} };
    const entry = rawNeeds[key];
    if (!entry) return { count: 0, recipes: [], byCard: {} };
    if (typeof entry === 'number') {
      return { count: Math.max(0, Math.round(entry)), recipes: [], byCard: {} };
    }
    if (Array.isArray(entry)) {
      return { count: entry.length, recipes: entry.map(String), byCard: {} };
    }
    if (typeof entry === 'object') {
      const recipes = Array.isArray(entry.recipes) ? entry.recipes.map(String) : [];
      const byCard = entry.byCard || entry.cardRecipes || entry.cards || entry.items || {};
      const count = typeof entry.count === 'number'
        ? Math.max(0, Math.round(entry.count))
        : (recipes.length || Object.keys(byCard).length);
      return { count, recipes, byCard };
    }
    return { count: 0, recipes: [], byCard: {} };
  }

  function getCardRecipeHintText(cardName, marketKey) {
    if (!cardName) return '';
    const rawNeeds = getRawNeedsSafe();
    const norm = normalizeMarketNeed(rawNeeds, marketKey);
    const hit = norm.byCard && norm.byCard[cardName];
    if (hit) {
      const list = Array.isArray(hit) ? hit : [hit];
      const names = list.filter(Boolean).map(String);
      if (names.length) return `🎯 Cần cho ${names.slice(0, 2).join(', ')}`;
    }
    // Check global card map if provided as rawNeeds._byCard
    const globalHit = rawNeeds && rawNeeds._byCard && rawNeeds._byCard[cardName];
    if (globalHit) {
      const list = Array.isArray(globalHit) ? globalHit : [globalHit];
      const names = list.filter(Boolean).map(String);
      if (names.length) return `🎯 Cần cho ${names.slice(0, 2).join(', ')}`;
    }
    return '';
  }

  function getMarketMeta(key) {
    const zone = sceneState.marketZones[key];
    const base = zone ? zone.meta : { key, emoji: '🏪', name: key, short: key, cost: 0, color: 0xfbbf24 };
    const icMarkets = (sceneState.interactiveCtx && sceneState.interactiveCtx.markets)
      || (sceneState.ctx && sceneState.ctx.markets);
    const live = icMarkets && icMarkets[key];
    if (!live) return base;
    return {
      key,
      emoji: live.emoji || base.emoji,
      name: live.name || base.name,
      short: live.shortName || base.short,
      cost: typeof live.cost === 'number' ? live.cost : base.cost,
      color: typeof live.color === 'number' ? live.color : base.color,
      shelfCount: typeof live.shelfCount === 'number' ? live.shelfCount : (Array.isArray(live.shelf) ? live.shelf.length : 0),
    };
  }

  function getActiveMarketDataSafe() {
    const ic = sceneState.interactiveCtx;
    if (ic && typeof ic.getActiveMarketData === 'function') {
      try { return ic.getActiveMarketData() || null; } catch (_) {}
    }
    return null;
  }

  function getIslandPropsSafe() {
    const ic = sceneState.interactiveCtx || {};
    const c = sceneState.ctx || {};
    return {
      garbageBagGroup: ic.garbageBagGroup || c.garbageBagGroup || null,
      actionDeckMesh: ic.actionDeckMesh || c.actionDeckMesh || null,
    };
  }

  function invokeIslandAction(actionType) {
    const ic = sceneState.interactiveCtx;
    if (ic && typeof ic.onIslandAction === 'function') {
      try { ic.onIslandAction(actionType); } catch (err) {
        if (typeof console !== 'undefined' && console.warn) console.warn('VdbAAA onIslandAction:', err);
      }
      syncBoardOverlays();
    }
  }

  function invokeSelectMarket(key) {
    const ic = sceneState.interactiveCtx;
    if (!key) return;
    pulseMarketZoneRing(key);
    if (ic && typeof ic.onSelectMarket === 'function') {
      try { ic.onSelectMarket(key); } catch (err) {
        if (typeof console !== 'undefined' && console.warn) console.warn('VdbAAA onSelectMarket:', err);
      }
    }
    syncBoardOverlays();
  }

  function invokeBuyCard(marketKey, slotIdx) {
    const ic = sceneState.interactiveCtx;
    if (ic && typeof ic.onBuyCard === 'function') {
      try { ic.onBuyCard(marketKey, slotIdx); } catch (err) {
        if (typeof console !== 'undefined' && console.warn) console.warn('VdbAAA onBuyCard:', err);
      }
      syncBoardOverlays();
    }
  }

  function invokeBuyShelf(marketKey) {
    const ic = sceneState.interactiveCtx;
    if (ic && typeof ic.onBuyShelf === 'function') {
      try { ic.onBuyShelf(marketKey); } catch (err) {
        if (typeof console !== 'undefined' && console.warn) console.warn('VdbAAA onBuyShelf:', err);
      }
      syncBoardOverlays();
    }
  }

  function buildServiceBell3D(THREE) {
    const group = new THREE.Group();
    group.name = 'VdbServiceBell';
    group.userData.isServiceBell = true;

    const mahoganyMat = new THREE.MeshStandardMaterial({
      color: 0x2b1108,
      roughness: 0.30,
      metalness: 0.16,
      envMapIntensity: 0.95,
    });
    const brassDomeMat = new THREE.MeshStandardMaterial({
      color: 0xe6bd60,
      metalness: 0.93,
      roughness: 0.16,
      envMapIntensity: 1.38,
      emissive: new THREE.Color(0x3a2004),
      emissiveIntensity: 0.10,
    });
    const brightGoldMat = new THREE.MeshStandardMaterial({
      color: 0xf7df9a,
      metalness: 0.94,
      roughness: 0.13,
      envMapIntensity: 1.42,
      emissive: new THREE.Color(0x452805),
      emissiveIntensity: 0.08,
    });

    // Turned dark mahogany circular base
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.42, 1.58, 0.24, 32), mahoganyMat);
    base.position.y = 0.12;
    base.castShadow = true;
    base.receiveShadow = true;
    group.add(base);

    // Metallic brass trim collar at base rim
    const baseRing = new THREE.Mesh(new THREE.TorusGeometry(1.42, 0.052, 10, 32), brightGoldMat);
    baseRing.rotation.x = Math.PI / 2;
    baseRing.position.y = 0.24;
    group.add(baseRing);

    // Classic restaurant service bell dome sculpted via LatheGeometry (r128 compatible)
    let domeGeo;
    if (typeof THREE.LatheGeometry === 'function') {
      const pts = [];
      const segs = 14;
      for (let i = 0; i <= segs; i++) {
        const t = i / segs; // 0 = base lip, 1 = top crown
        const angle = t * (Math.PI * 0.5);
        const r = Math.max(0.08, Math.cos(angle) * 1.32 + (i === 0 ? 0.06 : 0));
        const y = 0.24 + Math.sin(angle) * 0.96;
        pts.push(new THREE.Vector2(r, y));
      }
      domeGeo = new THREE.LatheGeometry(pts, 32);
    } else {
      domeGeo = new THREE.SphereGeometry(1.30, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.5);
    }
    const dome = new THREE.Mesh(domeGeo, brassDomeMat);
    if (typeof THREE.LatheGeometry !== 'function') {
      dome.scale.set(1, 0.74, 1);
      dome.position.y = 0.24;
    }
    dome.castShadow = true;
    group.add(dome);

    // Subtle golden neck highlight ring
    const crownRing = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.036, 8, 24), brightGoldMat);
    crownRing.rotation.x = Math.PI / 2;
    crownRing.position.y = 1.15;
    group.add(crownRing);

    // Central brass plunger button (animates down/up when rung!)
    const plungerGroup = new THREE.Group();
    plungerGroup.position.y = 1.24;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.18, 12), brassDomeMat);
    stem.position.y = 0.04;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 0.14, 20), brightGoldMat);
    cap.position.y = 0.16;
    cap.castShadow = true;
    plungerGroup.add(stem, cap);
    group.add(plungerGroup);

    group.traverse(ch => {
      if (ch && ch.userData) ch.userData.isServiceBell = true;
    });

    // Positioned directly on the cherry-wood apron where playerDial used to sit
    group.position.set(9.8, 0.08, 14.2);

    sceneState.serviceBellGroup = group;
    sceneState.bellPlunger = plungerGroup;
    sceneState.bellDomeMat = brassDomeMat;
    return group;
  }

  function hidePlayerDialCompletely(dial) {
    if (!dial) return;
    dial.visible = false;
    if (dial.scale && typeof dial.scale.set === 'function') {
      dial.scale.set(0.0001, 0.0001, 0.0001);
    }
    if (typeof dial.traverse === 'function') {
      dial.traverse(ch => { if (ch) ch.visible = false; });
    }
  }

  function syncServiceBellVisibility() {
    if (sceneState.playerDial) {
      hidePlayerDialCompletely(sceneState.playerDial);
    }
    let changed = false;
    if (sceneState.serviceBellGroup) {
      // Unified Zero Double-Bell Rule (Desktop & Mobile): UI Brass Service Bell is shown during normal play;
      // 3D VdbServiceBell renders ONLY in Peek 3D mode (when UI chrome is hidden)!
      const shouldShow = Boolean(sceneState.peekMode);
      if (sceneState.serviceBellGroup.visible !== shouldShow) {
        sceneState.serviceBellGroup.visible = shouldShow;
        changed = true;
      }
    }
    if (sceneState.rivalTablePropsGroup) {
      // Zero Double-Card Rule: 3D Rival Table Props show ONLY in Peek 3D mode (normal Desktop shows crisp UI stations on wood flanks)
      const showRivalProps = Boolean(sceneState.peekMode);
      if (sceneState.rivalTablePropsGroup.visible !== showRivalProps) {
        sceneState.rivalTablePropsGroup.visible = showRivalProps;
        changed = true;
      }
    }
    if (changed && sceneState.ctx && sceneState.ctx.requestRender) {
      sceneState.ctx.requestRender(2);
    }
  }

  function buildRivalStarPuckTexture(THREE, shortName, likes, colorHex) {
    return makeTex(THREE, (ctx, w, h) => {
      const cx = w / 2, cy = h / 2, r = w * 0.46;
      ctx.fillStyle = colorHex || '#d97706';
      ctx.fillRect(0, 0, w, h);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = '#18110c';
      ctx.fill();
      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = 10;
      ctx.stroke();
      ctx.fillStyle = '#fde047';
      ctx.font = '900 54px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      fitCanvasText(ctx, `⭐${Number(likes) || 0}`, cx, cy - 16, w * 0.78);
      ctx.fillStyle = '#fef3c7';
      ctx.font = '800 22px sans-serif';
      fitCanvasText(ctx, String(shortName || 'ĐỐI THỦ').toUpperCase(), cx, cy + 38, w * 0.74);
    }, 192, 192);
  }

  function clearRivalTablePropsMeshes() {
    const grp = sceneState.rivalTablePropsGroup;
    if (grp) {
      while (grp.children.length > 0) {
        grp.remove(grp.children[grp.children.length - 1]);
      }
    }
    if (sceneState.rivalPropsTextures.length) {
      sceneState.rivalPropsTextures.forEach(t => { try { t.dispose(); } catch (_) {} });
      sceneState.rivalPropsTextures = [];
    }
  }

  function syncRivalTableProps(rivalsList) {
    if (Array.isArray(rivalsList)) {
      sceneState.lastRivalsList = rivalsList.map(r => {
        if (!r || typeof r !== 'object') return null;
        const meta = CHEF_FALLBACK_META[r.id] || {};
        const pantryCount = typeof r.pantryCount === 'number'
          ? r.pantryCount
          : (Array.isArray(r.inventory) ? r.inventory.length : 0);
        const actionCount = typeof r.actionCardCount === 'number'
          ? r.actionCardCount
          : (Array.isArray(r.actionCards) ? r.actionCards.length : 0);
        return {
          id: String(r.id || ''),
          short: String(r.short || r.name || meta.name || r.id || 'Đối thủ'),
          likes: Math.max(0, Math.round(Number(r.likes) || 0)),
          colorHex: String(r.colorHex || meta.colorHex || '#f59e0b'),
          pantryCount: clamp(Math.round(pantryCount), 0, 8),
          actionCount: clamp(Math.round(actionCount), 0, 6),
        };
      }).filter(Boolean);
    }

    const ctx = sceneState.ctx;
    const grp = sceneState.rivalTablePropsGroup;
    if (!ctx || !ctx.THREE || !grp) return;

    const list = sceneState.lastRivalsList || [];
    const sig = list.map(r => `${r.id}:${r.short}:${r.likes}:${r.colorHex}:${r.pantryCount}:${r.actionCount}`).join('|');
    if (sig === sceneState.rivalPropsSig) {
      syncServiceBellVisibility();
      return;
    }
    sceneState.rivalPropsSig = sig;
    clearRivalTablePropsMeshes();

    if (!list.length) {
      syncServiceBellVisibility();
      return;
    }

    const { THREE } = ctx;
    const bcz = typeof ctx.boardCenterZ === 'number' ? ctx.boardCenterZ : -3.5;

    // Split rivals identically to Desktop Flank UI: 1 -> Right, 2 -> 1L/1R, 3 -> 2L/1R, 4..7 -> ceil(N/2)L / floor(N/2)R
    let leftList = [];
    let rightList = [];
    if (list.length === 1) {
      rightList = [list[0]];
    } else {
      const leftCount = Math.ceil(list.length / 2);
      leftList = list.slice(0, leftCount);
      rightList = list.slice(leftCount);
    }

    // Shared lightweight geometries & materials
    const matGeo = new THREE.BoxGeometry(4.6, 0.07, 2.5);
    const rimGeo = new THREE.BoxGeometry(4.74, 0.05, 2.64);
    const puckGeo = new THREE.CylinderGeometry(0.62, 0.68, 0.22, 20);
    const cardGeo = new THREE.BoxGeometry(0.64, 0.045, 0.88);

    const woodPadMat = new THREE.MeshStandardMaterial({ color: 0x1a0c06, roughness: 0.62, metalness: 0.05, envMapIntensity: 0.35 });
    const creamCardMat = new THREE.MeshStandardMaterial({ color: 0xf9f1df, roughness: 0.44 });
    const purpleCardMat = new THREE.MeshStandardMaterial({ color: 0x3b1566, roughness: 0.36, metalness: 0.18 });
    const goldEdgeMat = new THREE.MeshStandardMaterial({ color: 0xdcb35c, roughness: 0.22, metalness: 0.86, envMapIntensity: 1.25 });

    const buildFlank = (flankRivals, isLeft) => {
      const n = flankRivals.length;
      if (!n) return;
      const xPos = isLeft ? -21.8 : 21.8;
      const rotY = isLeft ? (Math.PI / 2) : (-Math.PI / 2);
      const spacing = n >= 4 ? 5.1 : (n === 3 ? 6.2 : 7.8);
      const startZ = bcz - ((n - 1) * spacing) * 0.5;

      flankRivals.forEach((rv, idx) => {
        const seat = new THREE.Group();
        seat.position.set(xPos, 0.02, startZ + idx * spacing);
        seat.rotation.y = rotY;
        seat.userData.isDecorative = true;

        const accentColor = new THREE.Color(rv.colorHex || '#f59e0b');
        const accentMat = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.4, metalness: 0.25 });

        const rim = new THREE.Mesh(rimGeo, accentMat);
        rim.position.y = 0.025;
        const pad = new THREE.Mesh(matGeo, woodPadMat);
        pad.position.y = 0.045;
        pad.receiveShadow = true;
        seat.add(rim, pad);

        // Chef Star Puck (left side of pad)
        const puckTex = buildRivalStarPuckTexture(THREE, rv.short, rv.likes, rv.colorHex);
        sceneState.rivalPropsTextures.push(puckTex);
        const puckTopMat = new THREE.MeshStandardMaterial({ map: puckTex, roughness: 0.35 });
        const puck = new THREE.Mesh(puckGeo, [accentMat, puckTopMat, accentMat]);
        puck.position.set(-1.55, 0.18, 0);
        puck.castShadow = true;
        seat.add(puck);

        // Mini Face-up Cream Pantry Cards spread
        const pCount = Math.min(5, rv.pantryCount);
        for (let c = 0; c < pCount; c++) {
          const card = new THREE.Mesh(cardGeo, creamCardMat);
          const cx = -0.45 + c * 0.44;
          const cz = -0.34 + (c % 2 === 0 ? -0.05 : 0.06);
          card.position.set(cx, 0.10 + c * 0.012, cz);
          card.rotation.y = (c - (pCount - 1) * 0.5) * 0.07;
          card.castShadow = true;
          seat.add(card);
        }

        // Mini Face-down Royal-Purple/Gold Action Cards fanned on lower-right corner
        const aCount = Math.min(3, rv.actionCount);
        for (let a = 0; a < aCount; a++) {
          const aCard = new THREE.Mesh(cardGeo, [
            goldEdgeMat, goldEdgeMat, purpleCardMat, purpleCardMat, goldEdgeMat, goldEdgeMat,
          ]);
          aCard.position.set(1.25 + a * 0.24, 0.11 + a * 0.035, 0.42 - a * 0.05);
          aCard.rotation.y = -0.14 + a * 0.14;
          aCard.castShadow = true;
          seat.add(aCard);
        }

        grp.add(seat);
      });
    };

    buildFlank(leftList, true);
    buildFlank(rightList, false);
    syncServiceBellVisibility();
    if (ctx.requestRender) ctx.requestRender(2);
  }

  function ringServiceBell(originEl) {
    // 1. Tactile brass bell audio + light haptic pulse
    audioAPI.play('bell');
    audioAPI.vibrate(22);

    // 2. Golden concentric DOM ripple centered on originEl (if provided)
    if (originEl) {
      bellRipple(originEl);
    }

    // 3. 3D plunger squash + dome golden shimmer if 3D bell is visible
    const bell = sceneState.serviceBellGroup;
    const plunger = sceneState.bellPlunger;
    const domeMat = sceneState.bellDomeMat;
    if (bell && bell.visible && plunger && !prefersReducedMotion()) {
      const seq = ++sceneState.bellAnimSeq;
      const baseY = 1.24;
      const t0 = performance.now();
      const dur = 280;

      function step(now) {
        if (seq !== sceneState.bellAnimSeq) return;
        const t = clamp((now - t0) / dur, 0, 1);
        const squash = Math.sin(t * Math.PI);
        plunger.position.y = baseY - squash * 0.13;
        if (domeMat) {
          domeMat.emissiveIntensity = 0.12 + squash * 0.52;
        }
        if (sceneState.ctx && sceneState.ctx.requestRender) sceneState.ctx.requestRender(1);
        if (t < 1) {
          requestAnimationFrame(step);
        } else {
          plunger.position.y = baseY;
          if (domeMat) domeMat.emissiveIntensity = 0.12;
          if (sceneState.ctx && sceneState.ctx.requestRender) sceneState.ctx.requestRender(2);
        }
      }
      requestAnimationFrame(step);
    }
  }

  function measureOpenStage() {
    const vw = HAS_DOM ? Math.max(1, window.innerWidth) : 1280;
    const vh = HAS_DOM ? Math.max(1, window.innerHeight) : 800;
    const isMobile = vw < 768;
    let topPx = 56;
    let bottomPx = vh;
    let leftPx = 0;
    let rightPx = vw;
    let deckHeight = 0;

    if (HAS_DOM) {
      // 1. Measure #hud-top-chrome (contains header, #daily-event-banner, and top #desktop-delivery-strip.open) & header
      const topChrome = document.getElementById('hud-top-chrome');
      if (topChrome) {
        const r = topChrome.getBoundingClientRect();
        if (r.height > 0 && r.bottom > topPx) topPx = r.bottom;
      }
      const hdr = document.querySelector('header');
      if (hdr) {
        const r = hdr.getBoundingClientRect();
        if (r.height > 0 && r.bottom > topPx) topPx = r.bottom;
      }
      // Automatically measure any visible top strip inside .hud-layer (daily event strip, status pill, etc.)
      const hudLayer = document.querySelector('.hud-layer');
      if (hudLayer) {
        const kids = hudLayer.children;
        for (let i = 0; i < kids.length; i++) {
          const el = kids[i];
          if (!el || el.id === 'hud-main-deck' || el.id === 'tabletop-player-zone'
            || el.id === 'tt-rivals-left' || el.id === 'tt-rivals-right'
            || el.id === 'hud-canvas-flanks' || el.tagName === 'FOOTER') continue;
          if (el.classList.contains('hidden')) continue;
          const r = el.getBoundingClientRect();
          if (r.height > 4 && r.top < vh * 0.35 && r.bottom < vh * 0.45 && r.bottom > topPx) {
            topPx = r.bottom;
          }
        }
      }

      const isPeekHidden = document.body && document.body.classList.contains('rr-peek-3d');
      if (!isPeekHidden) {
        // Measure both #hud-main-deck and #tabletop-player-zone so borderless Desktop cards & bell are respected cleanly
        const bottomEls = [
          document.getElementById('hud-main-deck'),
          document.getElementById('tabletop-player-zone'),
        ];
        bottomEls.forEach(el => {
          if (!el) return;
          const cs = window.getComputedStyle ? window.getComputedStyle(el) : null;
          if (el.style.display === 'none' || (cs && cs.display === 'none')) return;
          const r = el.getBoundingClientRect();
          if (r.height > 20 && r.top > topPx + 30 && r.top < vh) {
            if (r.top < bottomPx) bottomPx = r.top;
            if (r.height > deckHeight) deckHeight = r.height;
          }
        });

        // Measure Open-Wood Left & Right Rival Flanks (#tt-rivals-left / #tt-rivals-right)
        const leftFlank = document.getElementById('tt-rivals-left');
        if (leftFlank && !leftFlank.classList.contains('hidden') && leftFlank.children.length > 0) {
          const cs = window.getComputedStyle ? window.getComputedStyle(leftFlank) : null;
          if (leftFlank.style.display !== 'none' && (!cs || (cs.display !== 'none' && cs.visibility !== 'hidden'))) {
            const r = leftFlank.getBoundingClientRect();
            if (r.width > 20 && r.height > 20 && r.right < vw * 0.45) {
              leftPx = Math.max(0, Math.ceil(r.right));
            }
          }
        }
        const rightFlank = document.getElementById('tt-rivals-right');
        if (rightFlank && !rightFlank.classList.contains('hidden') && rightFlank.children.length > 0) {
          const cs = window.getComputedStyle ? window.getComputedStyle(rightFlank) : null;
          if (rightFlank.style.display !== 'none' && (!cs || (cs.display !== 'none' && cs.visibility !== 'hidden'))) {
            const r = rightFlank.getBoundingClientRect();
            if (r.width > 20 && r.height > 20 && r.left > vw * 0.55) {
              rightPx = Math.min(vw, Math.floor(r.left));
            }
          }
        }
        if (rightPx - leftPx < 240) {
          leftPx = 0;
          rightPx = vw;
        }
      }

      // 2. Defensively measure floating / top-chrome banners so 3D pills NEVER collide with them
      const obstacleIds = [
        'tt-rivals-top-strip',
        'desktop-delivery-strip',
        'contested-market-alert',
        'coachmark-banner',
        'resume-save-banner',
      ];
      obstacleIds.forEach(id => {
        const el = document.getElementById(id);
        if (!el || el.classList.contains('hidden')) return;
        const cs = window.getComputedStyle ? window.getComputedStyle(el) : null;
        if (el.style.display === 'none' || (cs && (cs.display === 'none' || cs.visibility === 'hidden'))) return;
        const r = el.getBoundingClientRect();
        if (r.height < 6 || r.width < 10) return;
        const midY = r.top + r.height * 0.5;
        if (midY < vh * 0.48) {
          topPx = Math.max(topPx, r.bottom + 4);
        } else if (midY > vh * 0.52) {
          bottomPx = Math.min(bottomPx, r.top - 4);
        }
      });

      // 3. Respect Online #hpvn-turn or #hpvn-solo bottom bar if visible
      ['hpvn-turn', 'hpvn-solo'].forEach(barId => {
        const bar = document.getElementById(barId);
        if (bar && bar.style.display && bar.style.display !== 'none') {
          const r = bar.getBoundingClientRect();
          if (r.height > 10 && r.top > topPx + 30 && r.top < bottomPx) {
            bottomPx = r.top;
          }
        }
      });
    }

    const openH = Math.max(70, bottomPx - topPx);
    const centerPx = topPx + openH * 0.5;
    const ndcY = 1 - (2 * centerPx) / vh;
    const openW = Math.max(240, rightPx - leftPx);
    const centerX = leftPx + openW * 0.5;
    // Open-Wood Tabletop Player Zone (~115–175px) stays in full open-tabletop mode; tall Mat Drawer (>210px) uses drawer framing
    const isSlimDesktop = !isMobile && deckHeight < 210;
    return { vw, vh, isMobile, isSlimDesktop, deckHeight, topPx, bottomPx, openH, centerPx, ndcY, leftPx, rightPx, openW, centerX };
  }

  function buildMarketInteractiveZones(THREE, rootGroup, boardHeight, boardCenterZ) {
    if (sceneState.marketHitMeshes.length > 0) return;

    const specs = getMarketZoneSpecs(boardHeight, boardCenterZ);
    const zonesContainer = new THREE.Group();
    zonesContainer.name = 'VdbMarketInteractiveZones';
    zonesContainer.userData.isDecorative = true;

    const hitMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      colorWrite: false,
    });

    Object.keys(specs).forEach(key => {
      const sp = specs[key];
      const hitMeshes = [];

      // Main invisible raycast hit volume covering the zone
      const mainHit = new THREE.Mesh(new THREE.BoxGeometry(sp.w, sp.h, sp.d), hitMat);
      mainHit.position.set(sp.cx, boardHeight + sp.h * 0.5, sp.cz);
      mainHit.userData.marketKey = key;
      mainHit.userData.isMarketHit = true;
      zonesContainer.add(mainHit);
      hitMeshes.push(mainHit);
      sceneState.marketHitMeshes.push(mainHit);

      // Extra vertical hit box over the Chợ Bến Thành Clock Tower so clicking the tower selects Island
      if (sp.towerHit) {
        const th = sp.towerHit;
        const towerHit = new THREE.Mesh(new THREE.BoxGeometry(th.w, th.h, th.d), hitMat);
        towerHit.position.set(th.x, th.y, th.z);
        towerHit.userData.marketKey = key;
        towerHit.userData.isMarketHit = true;
        zonesContainer.add(towerHit);
        hitMeshes.push(towerHit);
        sceneState.marketHitMeshes.push(towerHit);
      }

      // Glowing perimeter frame + subtle floor wash + 4 corner beacon posts
      const ringGroup = new THREE.Group();
      ringGroup.position.set(sp.cx, boardHeight + 0.045, sp.cz);
      ringGroup.userData.isDecorative = true;

      const frameMat = new THREE.MeshBasicMaterial({
        color: sp.color,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
      });
      const floorMat = new THREE.MeshBasicMaterial({
        color: sp.color,
        transparent: true,
        opacity: 0.0,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });

      const barT = 0.14;
      const barH = 0.045;
      const barN = new THREE.Mesh(new THREE.BoxGeometry(sp.w + barT, barH, barT), frameMat);
      barN.position.set(0, 0.01, -sp.d / 2);
      const barS = new THREE.Mesh(new THREE.BoxGeometry(sp.w + barT, barH, barT), frameMat);
      barS.position.set(0, 0.01, sp.d / 2);
      const barW = new THREE.Mesh(new THREE.BoxGeometry(barT, barH, sp.d), frameMat);
      barW.position.set(-sp.w / 2, 0.01, 0);
      const barE = new THREE.Mesh(new THREE.BoxGeometry(barT, barH, sp.d), frameMat);
      barE.position.set(sp.w / 2, 0.01, 0);

      const floorWash = new THREE.Mesh(new THREE.PlaneGeometry(sp.w - 0.14, sp.d - 0.14), floorMat);
      floorWash.rotation.x = -Math.PI / 2;
      floorWash.position.y = -0.02;

      const beaconGroup = new THREE.Group();
      const postGeo = new THREE.CylinderGeometry(0.06, 0.09, 0.42, 8);
      const beaconMat = new THREE.MeshBasicMaterial({
        color: 0xfde047,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
      });
      [
        [-sp.w / 2, -sp.d / 2],
        [ sp.w / 2, -sp.d / 2],
        [-sp.w / 2,  sp.d / 2],
        [ sp.w / 2,  sp.d / 2],
      ].forEach(([cx, cz]) => {
        const post = new THREE.Mesh(postGeo, beaconMat);
        post.position.set(cx, 0.22, cz);
        beaconGroup.add(post);
      });
      beaconGroup.visible = false;

      ringGroup.add(barN, barS, barW, barE, floorWash, beaconGroup);
      zonesContainer.add(ringGroup);

      sceneState.marketZones[key] = {
        key,
        meta: sp,
        hitMeshes,
        ringGroup,
        frameMat,
        floorMat,
        beaconGroup,
        beaconMat,
        badgeAnchor: new THREE.Vector3(sp.bx, sp.by, sp.bz),
        pulseSeq: 0,
      };
    });

    rootGroup.add(zonesContainer);
  }

  function pulseMarketZoneRing(key) {
    const zone = sceneState.marketZones[key];
    if (!zone || !zone.ringGroup || prefersReducedMotion()) return;
    const seq = ++zone.pulseSeq;
    const t0 = performance.now();
    const dur = 280;
    function step(now) {
      if (seq !== zone.pulseSeq) return;
      const t = clamp((now - t0) / dur, 0, 1);
      const bump = Math.sin(t * Math.PI) * 0.048;
      zone.ringGroup.scale.set(1 + bump, 1 + bump * 2.5, 1 + bump);
      if (sceneState.ctx && sceneState.ctx.requestRender) sceneState.ctx.requestRender(1);
      if (t < 1) requestAnimationFrame(step);
      else {
        zone.ringGroup.scale.set(1, 1, 1);
        if (sceneState.ctx && sceneState.ctx.requestRender) sceneState.ctx.requestRender(2);
      }
    }
    requestAnimationFrame(step);
  }

  function updateMarketGlowRings() {
    const phase = getPhaseSafe();
    const selectedDest = getSelectedDestSafe();
    const currentLoc = getCurrentLocationSafe();
    const hoveredKey = sceneState.hoveredMarketKey;
    const modalOpen = isModalOpenSafe();

    Object.keys(sceneState.marketZones).forEach(key => {
      const z = sceneState.marketZones[key];
      if (!z) return;
      const isSelectedP1 = phase === 1 && key === selectedDest;
      const isActiveP2 = phase === 2 && key === currentLoc;
      const isHoveredP1 = phase === 1 && !modalOpen && key === hoveredKey;

      if (isSelectedP1 || isActiveP2) {
        z.frameMat.color.setHex(0xfde047);
        z.frameMat.opacity = 0.96;
        z.floorMat.color.setHex(0xf59e0b);
        z.floorMat.opacity = 0.22;
        z.beaconGroup.visible = true;
        z.ringGroup.visible = true;
      } else if (isHoveredP1) {
        z.frameMat.color.setHex(0xfef08a);
        z.frameMat.opacity = 0.88;
        z.floorMat.color.setHex(z.meta.color);
        z.floorMat.opacity = 0.24;
        z.beaconGroup.visible = false;
        z.ringGroup.visible = true;
      } else if (phase === 1) {
        z.frameMat.color.setHex(z.meta.color);
        z.frameMat.opacity = 0.26;
        z.floorMat.color.setHex(z.meta.color);
        z.floorMat.opacity = 0.04;
        z.beaconGroup.visible = false;
        z.ringGroup.visible = true;
      } else {
        z.beaconGroup.visible = false;
        z.ringGroup.visible = false;
      }
    });
  }

  function setActiveMarketTilt(marketKey) {
    const ctx = sceneState.ctx;
    if (!ctx || !ctx.marketMeshes) return;
    const bh = typeof ctx.boardHeight === 'number' ? ctx.boardHeight : 0.35;
    const activeKey = (marketKey && marketKey !== 'island') ? marketKey : null;
    sceneState.activeTiltedMarket = activeKey;

    Object.keys(ctx.marketMeshes).forEach(key => {
      const m = ctx.marketMeshes[key];
      if (!m || !Array.isArray(m.cards)) return;
      const shouldTilt = key === activeKey;
      const restY = shouldTilt ? (bh + 0.45) : (bh + 0.04);
      // Tilt positively around +X so the +Y card top face angles toward the south (+Z) camera
      const tiltX = shouldTilt ? 0.40 : 0;

      m.cards.forEach(cMesh => {
        if (!cMesh) return;
        cMesh.userData._aaaBaseY = restY;
        cMesh.rotation.x = tiltX;
        const isHovered = sceneState.hoveredObj === cMesh && cMesh.userData._aaaHoverKind === 'card';
        if (isHovered) {
          sceneState.hoveredRestY = restY;
          cMesh.position.y = restY + (prefersReducedMotion() ? 0.04 : 0.16);
          if (sceneState.hoverFrame) {
            sceneState.hoverFrame.position.set(cMesh.position.x, cMesh.position.y, cMesh.position.z);
            sceneState.hoverFrame.rotation.x = tiltX;
          }
        } else {
          cMesh.position.y = restY;
        }
      });
    });

    if (ctx.requestRender) ctx.requestRender(2);
  }

  function stopPillPointer(el) {
    el.addEventListener('pointerdown', e => e.stopPropagation());
    el.addEventListener('pointerup', e => e.stopPropagation());
  }

  function hideDesktopDirectPills() {
    sceneState.cardPillNodes.forEach(n => { if (n) n.style.display = 'none'; });
    if (sceneState.shelfPillNode) sceneState.shelfPillNode.style.display = 'none';
    if (sceneState.activeHeaderNode) sceneState.activeHeaderNode.style.display = 'none';
    if (sceneState.closedBannerNode) sceneState.closedBannerNode.style.display = 'none';
    Object.keys(sceneState.islandPillNodes).forEach(k => {
      const n = sceneState.islandPillNodes[k];
      if (n) n.style.display = 'none';
    });
  }

  function hideAllZoneBadges() {
    Object.keys(sceneState.badgeNodes).forEach(k => {
      const n = sceneState.badgeNodes[k];
      if (n) n.style.display = 'none';
    });
  }

  function separateLinearPills(items, axis, minBound, maxBound, gap) {
    if (!items || items.length < 2) return;
    items.sort((a, b) => a[axis] - b[axis]);
    for (let pass = 0; pass < 4; pass++) {
      for (let i = 0; i < items.length - 1; i++) {
        const a = items[i];
        const b = items[i + 1];
        const halfA = (axis === 'x' ? a.w : a.h) * 0.5;
        const halfB = (axis === 'x' ? b.w : b.h) * 0.5;
        const minDist = halfA + halfB + gap;
        const dist = b[axis] - a[axis];
        if (dist < minDist) {
          const push = (minDist - dist) * 0.5;
          a[axis] -= push;
          b[axis] += push;
        }
      }
      // Keep inside viewport bounds
      items.forEach(it => {
        const half = (axis === 'x' ? it.w : it.h) * 0.5;
        it[axis] = clamp(it[axis], minBound + half, Math.max(minBound + half, maxBound - half));
      });
    }
  }

  function separate2DPills(items, minX, maxX, minY, maxY, gap) {
    if (!items || items.length < 2) return;
    const g = typeof gap === 'number' ? gap : 6;
    for (let pass = 0; pass < 14; pass++) {
      let moved = false;
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i];
          const b = items[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const ox = (a.w + b.w) * 0.5 + g - Math.abs(dx);
          const oy = (a.h + b.h) * 0.5 + g - Math.abs(dy);
          if (ox > 0 && oy > 0) {
            moved = true;
            if (oy <= ox) {
              const s = dy >= 0 ? 1 : -1;
              a.y -= s * oy * 0.52;
              b.y += s * oy * 0.52;
            } else {
              const s = dx >= 0 ? 1 : -1;
              a.x -= s * ox * 0.52;
              b.x += s * ox * 0.52;
            }
          }
        }
      }
      items.forEach(it => {
        it.x = clamp(it.x, minX + it.w * 0.5, Math.max(minX + it.w * 0.5, maxX - it.w * 0.5));
        it.y = clamp(it.y, minY + it.h * 0.5, Math.max(minY + it.h * 0.5, maxY - it.h * 0.5));
      });
      if (!moved) break;
    }

    // Verify zero overlap; if tightly constrained (e.g. 320px phone), deterministically pack into clean 2-col rows
    let hasOverlap = false;
    for (let i = 0; i < items.length && !hasOverlap; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        if (Math.abs(b.x - a.x) < (a.w + b.w) * 0.5 + 1 && Math.abs(b.y - a.y) < (a.h + b.h) * 0.5 + 1) {
          hasOverlap = true;
          break;
        }
      }
    }
    if (hasOverlap) {
      const sorted = items.slice().sort((a, b) => (a.y - b.y) || (a.x - b.x));
      const availW = Math.max(120, maxX - minX);
      const rows = [];
      let curRow = [];
      let curW = 0;
      sorted.forEach(it => {
        const needW = curRow.length ? (curW + g + it.w) : it.w;
        if (curRow.length > 0 && needW > availW) {
          rows.push(curRow);
          curRow = [it];
          curW = it.w;
        } else {
          curRow.push(it);
          curW = needW;
        }
      });
      if (curRow.length) rows.push(curRow);

      const rowHeights = rows.map(r => r.reduce((m, it) => Math.max(m, it.h), 0));
      const totalH = rowHeights.reduce((s, h) => s + h, 0) + g * Math.max(0, rows.length - 1);
      const availH = Math.max(0, maxY - minY);
      const rowGap = rows.length > 1
        ? (totalH <= availH ? g : Math.max(2, (availH - rowHeights.reduce((s, h) => s + h, 0)) / (rows.length - 1)))
        : 0;
      let cursorY = minY + Math.max(0, (availH - (rowHeights.reduce((s, h) => s + h, 0) + rowGap * Math.max(0, rows.length - 1))) * 0.5);

      rows.forEach((row, rIdx) => {
        row.sort((a, b) => a.x - b.x);
        const rh = rowHeights[rIdx];
        const rowW = row.reduce((s, it) => s + it.w, 0) + g * Math.max(0, row.length - 1);
        let cursorX = minX + Math.max(0, (availW - rowW) * 0.5);
        row.forEach(it => {
          it.x = clamp(cursorX + it.w * 0.5, minX + it.w * 0.5, Math.max(minX + it.w * 0.5, maxX - it.w * 0.5));
          it.y = cursorY + rh * 0.5;
          cursorX += it.w + g;
        });
        cursorY += rh + rowGap;
      });
    }
  }

  function ensureCardPillNode(index, layer) {
    let btn = sceneState.cardPillNodes[index];
    if (!btn || !btn.isConnected) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vdb-3d-card-pill';
      stopPillPointer(btn);
      const nameEl = document.createElement('span');
      nameEl.className = 'vdb-cp-name';
      const metaEl = document.createElement('span');
      metaEl.className = 'vdb-cp-meta';
      const ownerEl = document.createElement('span');
      ownerEl.className = 'vdb-cp-owner';
      const ctaEl = document.createElement('span');
      ctaEl.className = 'vdb-cp-cta';
      btn.append(nameEl, ownerEl, metaEl, ctaEl);
      btn._parts = { nameEl, metaEl, ownerEl, ctaEl };
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (btn.disabled) return;
        const mk = btn.dataset.marketKey;
        const slot = Number(btn.dataset.cardSlot);
        if (mk && Number.isFinite(slot)) invokeBuyCard(mk, slot);
      });
      layer.appendChild(btn);
      sceneState.cardPillNodes[index] = btn;
    }
    return btn;
  }

  function ensureShelfPillNode(layer) {
    let btn = sceneState.shelfPillNode;
    if (!btn || !btn.isConnected) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vdb-3d-card-pill is-shelf';
      stopPillPointer(btn);
      const nameEl = document.createElement('span');
      nameEl.className = 'vdb-cp-name';
      const ctaEl = document.createElement('span');
      ctaEl.className = 'vdb-cp-cta';
      btn.append(nameEl, ctaEl);
      btn._parts = { nameEl, ctaEl };
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (btn.disabled) return;
        const mk = btn.dataset.shelfMarket;
        if (mk) invokeBuyShelf(mk);
      });
      layer.appendChild(btn);
      sceneState.shelfPillNode = btn;
    }
    return btn;
  }

  function ensureIslandPillGroup(id, layer, styleVars) {
    let wrap = sceneState.islandPillNodes[id];
    if (!wrap || !wrap.isConnected) {
      wrap = document.createElement('div');
      wrap.className = 'vdb-3d-island-group';
      wrap.dataset.islandGroup = id;
      stopPillPointer(wrap);

      const mainBtn = document.createElement('button');
      mainBtn.type = 'button';
      mainBtn.className = 'vdb-3d-island-btn';
      mainBtn.dataset.islandAction = id === 'garbage' ? 'dispose_1' : id;
      if (styleVars && styleVars.bg) mainBtn.style.setProperty('--isl-bg', styleVars.bg);
      if (styleVars && styleVars.border) mainBtn.style.setProperty('--isl-border', styleVars.border);
      mainBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!mainBtn.disabled) invokeIslandAction(mainBtn.dataset.islandAction);
      });
      wrap.appendChild(mainBtn);

      let subBtn = null;
      if (id === 'garbage') {
        subBtn = document.createElement('button');
        subBtn.type = 'button';
        subBtn.className = 'vdb-3d-island-btn is-secondary';
        subBtn.dataset.islandAction = 'dispose_all';
        subBtn.textContent = 'Sạch';
        subBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (!subBtn.disabled) invokeIslandAction('dispose_all');
        });
        wrap.appendChild(subBtn);
      }

      wrap._mainBtn = mainBtn;
      wrap._subBtn = subBtn;
      layer.appendChild(wrap);
      sceneState.islandPillNodes[id] = wrap;
    }
    return wrap;
  }

  function packStrictLinear(items, axis, minBound, maxBound, gap) {
    if (!items || !items.length) return;
    items.sort((a, b) => a[axis] - b[axis]);
    // Forward pass: push every item cleanly past previous item's trailing edge + gap
    let cursor = minBound;
    for (let i = 0; i < items.length; i++) {
      const half = (axis === 'x' ? items[i].w : items[i].h) * 0.5;
      const minCenter = cursor + half;
      items[i][axis] = Math.max(items[i][axis], minCenter);
      cursor = items[i][axis] + half + gap;
    }
    // Backward pass: if trailing item exceeded maxBound, shift backward preserving exact >= gap
    let endCursor = maxBound;
    for (let i = items.length - 1; i >= 0; i--) {
      const half = (axis === 'x' ? items[i].w : items[i].h) * 0.5;
      const maxCenter = endCursor - half;
      if (items[i][axis] > maxCenter) {
        items[i][axis] = maxCenter;
      }
      endCursor = items[i][axis] - half - gap;
    }
  }

  function layoutPillGrid2x2(orderedItems, leftBound, rightBound, topBound, bottomBound, colGap, rowGap, anchorLeft) {
    const n = orderedItems.length;
    if (!n) return;
    // Row 1: [0, 1] (Kệ Úp, Card 0), Row 2: [2, 3] (Card 1, Card 2)
    const p0 = orderedItems[0];
    const p1 = orderedItems[1] || null;
    const p2 = orderedItems[2] || null;
    const p3 = orderedItems[3] || null;

    const col0W = Math.max(p0.w, p2 ? p2.w : 0);
    const col1W = Math.max(p1 ? p1.w : 0, p3 ? p3.w : 0);
    const hasCol1 = Boolean(p1 || p3);
    const gridW = col0W + (hasCol1 ? (colGap + col1W) : 0);

    const row0H = Math.max(p0.h, p1 ? p1.h : 0);
    const row1H = Math.max(p2 ? p2.h : 0, p3 ? p3.h : 0);
    const hasRow1 = Boolean(p2 || p3);
    const gridH = row0H + (hasRow1 ? (rowGap + row1H) : 0);

    const maxLeft = Math.max(leftBound, rightBound - gridW);
    const gridLeft = clamp(anchorLeft, leftBound, maxLeft);

    const availH = Math.max(0, bottomBound - topBound);
    const gridTop = clamp(topBound + Math.max(0, (availH - gridH) * 0.5), topBound, Math.max(topBound, bottomBound - gridH));

    const c0X = gridLeft + col0W * 0.5;
    const c1X = gridLeft + col0W + colGap + col1W * 0.5;
    const r0Y = gridTop + row0H * 0.5;
    const r1Y = gridTop + row0H + rowGap + row1H * 0.5;

    p0.x = c0X; p0.y = r0Y;
    if (p1) { p1.x = c1X; p1.y = r0Y; }
    if (p2) { p2.x = c0X; p2.y = r1Y; }
    if (p3) { p3.x = c1X; p3.y = r1Y; }
  }

  function renderDesktopPhase2MarketPills(layer, stage, camera, THREE, shopKey, activeData) {
    const ctx = sceneState.ctx;
    const meshes = ctx && ctx.marketMeshes && ctx.marketMeshes[shopKey];
    if (!meshes) return;
    const bh = typeof ctx.boardHeight === 'number' ? ctx.boardHeight : 0.35;
    const bcz = typeof ctx.boardCenterZ === 'number' ? ctx.boardCenterZ : -3.5;
    const meta = getMarketMeta(shopKey);
    const isClosed = Boolean(activeData && activeData.isClosed);
    const cardsData = (activeData && Array.isArray(activeData.cards)) ? activeData.cards : null;
    const isVertical = shopKey === 'carbs' || shopKey === 'vegetable';
    const proj = new THREE.Vector3();
    const minY = stage.topPx + (stage.isMobile ? 6 : 8);
    const maxY = stage.bottomPx - (stage.isMobile ? 8 : 10);
    let minX = stage.isMobile ? 6 : (stage.leftPx + 10);
    let maxX = stage.isMobile ? (stage.vw - 6) : (stage.rightPx - 10);
    if (!stage.isMobile && maxX < minX + 180) {
      minX = 14;
      maxX = stage.vw - 14;
    }

    // 1. Position Active Market Title Banner FIRST & measure its actual bottom so card pills NEVER collide with it
    let cardsMinY = minY;
    const zone = sceneState.marketZones[shopKey];
    if (zone) {
      let hdr = sceneState.activeHeaderNode;
      if (!hdr || !hdr.isConnected) {
        hdr = document.createElement('div');
        hdr.className = 'vdb-3d-badge is-active';
        layer.appendChild(hdr);
        sceneState.activeHeaderNode = hdr;
      }
      hdr.textContent = stage.isMobile
        ? `📍 ${meta.emoji} ${meta.short} · $${meta.cost}`
        : `📍 ${meta.emoji} ${meta.name}`;
      hdr.style.display = 'inline-flex';
      const hdrRect0 = hdr.getBoundingClientRect();
      const hdrH = Math.ceil(hdrRect0.height) || 24;
      const hdrW = Math.ceil(hdrRect0.width) || 160;
      proj.set(zone.meta.cx, bh + 2.25, zone.meta.cz - (isVertical ? 5.2 : 1.5)).project(camera);
      const minHx = minX + hdrW * 0.5;
      const maxHx = Math.max(minHx, maxX - hdrW * 0.5);
      const hx = stage.isMobile
        ? clamp(stage.vw * 0.5, minHx, maxHx)
        : clamp((proj.x * 0.5 + 0.5) * stage.vw, minHx, maxHx);
      const minHy = stage.topPx + hdrH + 5;
      const maxHy = Math.max(minHy, maxY - (stage.isMobile ? 148 : 172));
      const hy = stage.isMobile
        ? minHy
        : clamp((-proj.y * 0.5 + 0.5) * stage.vh, minHy, maxHy);
      hdr.style.transform = `translate3d(${Math.round(hx)}px, ${Math.round(hy)}px, 0) translate(-50%, -100%)`;
      const hdrBottom = Math.ceil(hdr.getBoundingClientRect().bottom || hy);
      cardsMinY = Math.max(minY, hdrBottom + (stage.isMobile ? 8 : 10));
    }

    if (isClosed) {
      let cb = sceneState.closedBannerNode;
      if (!cb || !cb.isConnected) {
        cb = document.createElement('div');
        cb.className = 'vdb-3d-badge is-closed';
        layer.appendChild(cb);
        sceneState.closedBannerNode = cb;
      }
      cb.textContent = '🛑 CHỢ ĐANG BỊ PHONG TỎA HÔM NAY';
      cb.style.display = 'inline-flex';
      cb.style.transform = `translate3d(${Math.round(stage.centerX)}px, ${Math.round(stage.centerPx)}px, 0) translate(-50%, -50%)`;
    }

    const placed = [];

    // 2. Shelf Deck (Kệ Úp) pill — update content & display BEFORE measuring real getBoundingClientRect()
    const shelfBtn = ensureShelfPillNode(layer);
    const shelfCount = activeData && typeof activeData.shelfCount === 'number'
      ? activeData.shelfCount
      : meta.shelfCount;
    const shelfCost = activeData && typeof activeData.shelfCost === 'number'
      ? activeData.shelfCost
      : meta.cost;
    shelfBtn.dataset.shelfMarket = shopKey;
    shelfBtn.disabled = isClosed || shelfCount <= 0;
    const shelfSig = `${shopKey}|${shelfCost}|${shelfCount}|${isClosed}`;
    if (shelfBtn.dataset.sig !== shelfSig) {
      shelfBtn.dataset.sig = shelfSig;
      shelfBtn._parts.nameEl.textContent = '📦 Kệ Úp';
      shelfBtn._parts.ctaEl.textContent = shelfCount > 0 ? `$${shelfCost} · còn ${shelfCount}` : 'ĐÃ HẾT';
    }
    if (meshes.deck) {
      const anchorX = meshes.deck.position.x + (isVertical ? (shopKey === 'carbs' ? 1.85 : -1.85) : 0);
      const anchorZ = meshes.deck.position.z + (isVertical ? 0 : 1.38);
      proj.set(anchorX, bh + 0.25, anchorZ).project(camera);
      if (proj.z > -1 && proj.z < 1) {
        shelfBtn.style.display = 'inline-flex';
        const r = shelfBtn.getBoundingClientRect();
        placed.push({
          orderIdx: 0,
          node: shelfBtn,
          x: (proj.x * 0.5 + 0.5) * stage.vw,
          y: (-proj.y * 0.5 + 0.5) * stage.vh,
          w: Math.ceil(r.width) || shelfBtn.offsetWidth || 126,
          h: Math.ceil(r.height) || shelfBtn.offsetHeight || 52,
        });
      }
    }

    // 3. 3 Counter Card pills — update content & display BEFORE measuring real getBoundingClientRect()
    (meshes.cards || []).forEach((cMesh, idx) => {
      const btn = ensureCardPillNode(idx, layer);
      const fromData = cardsData ? cardsData.find(c => c && c.idx === idx) || cardsData[idx] : null;
      const cd = cMesh && cMesh.cardData;
      let state = fromData && fromData.state ? fromData.state : null;
      let name = (fromData && fromData.name) || (cd && cd.name) || '';
      let emoji = (fromData && fromData.emoji) || (cd && cd.emoji) || '📦';
      let cost = (fromData && typeof fromData.cost === 'number') ? fromData.cost : (cd && typeof cd.cost === 'number' ? cd.cost : meta.cost);
      let ownerName = (fromData && fromData.ownerName) || (cd && cd.claimedBy && cd.claimedBy.name) || '';
      let ownerAvatar = (fromData && fromData.ownerAvatar) || (cd && cd.claimedBy && cd.claimedBy.avatar) || '👤';
      let snatchCost = (fromData && typeof fromData.snatchCost === 'number') ? fromData.snatchCost : (cost + 50);
      let neededFor = (fromData && fromData.neededFor) || '';

      if (!neededFor && name) {
        const hintStr = getCardRecipeHintText(name, shopKey);
        if (hintStr) neededFor = hintStr.replace(/^🎯\s*Cần cho\s*/i, '');
      }
      if (!state) {
        if (!cd) state = 'empty';
        else if (cd.claimedBy) state = 'claimed';
        else state = 'available';
      }

      btn.dataset.marketKey = shopKey;
      btn.dataset.cardSlot = String(idx);
      btn.dataset.actionState = state;
      const clickable = !isClosed && (state === 'available' || state === 'claimed');
      btn.disabled = !clickable;

      const pillClass = 'vdb-3d-card-pill'
        + (state === 'claimed' ? ' is-claimed' : '')
        + (state === 'owned' ? ' is-owned' : '')
        + (state === 'empty' || state === 'sold' ? ' is-empty' : '')
        + (neededFor && clickable ? ' is-needed' : '');
      const sig = `${shopKey}|${idx}|${state}|${name}|${cost}|${snatchCost}|${ownerName}|${neededFor}|${isClosed}`;
      if (btn.dataset.sig !== sig) {
        btn.dataset.sig = sig;
        btn.className = pillClass;
        btn._parts.nameEl.textContent = name ? `${emoji} ${name}` : (state === 'sold' ? 'ĐÃ BÁN' : 'TRỐNG');

        if (state === 'claimed' && ownerName) {
          btn._parts.ownerEl.textContent = `${ownerAvatar} ${ownerName}`;
          btn._parts.ownerEl.style.display = 'block';
        } else {
          btn._parts.ownerEl.textContent = '';
          btn._parts.ownerEl.style.display = 'none';
        }

        if (neededFor && (state === 'available' || state === 'claimed')) {
          btn._parts.metaEl.textContent = `🎯 Cần cho ${neededFor}`;
          btn._parts.metaEl.style.display = 'block';
        } else {
          btn._parts.metaEl.textContent = '';
          btn._parts.metaEl.style.display = 'none';
        }

        if (state === 'available') btn._parts.ctaEl.textContent = `Mua $${cost}`;
        else if (state === 'claimed') btn._parts.ctaEl.textContent = `🔨 Tranh $${snatchCost}`;
        else if (state === 'owned') btn._parts.ctaEl.textContent = '✓ ĐÃ MUA';
        else if (state === 'sold') btn._parts.ctaEl.textContent = 'HẾT';
        else btn._parts.ctaEl.textContent = 'TRỐNG';
      }

      if (cMesh) {
        const anchorX = cMesh.position.x + (isVertical ? (shopKey === 'carbs' ? 1.85 : -1.85) : 0);
        const anchorZ = cMesh.position.z + (isVertical ? 0 : 1.38);
        proj.set(anchorX, bh + 0.15, anchorZ).project(camera);
        if (proj.z > -1 && proj.z < 1) {
          btn.style.display = 'inline-flex';
          const r = btn.getBoundingClientRect();
          placed.push({
            orderIdx: idx + 1,
            node: btn,
            x: (proj.x * 0.5 + 0.5) * stage.vw,
            y: (-proj.y * 0.5 + 0.5) * stage.vh,
            w: Math.ceil(r.width) || btn.offsetWidth || 136,
            h: Math.ceil(r.height) || btn.offsetHeight || 64,
          });
        }
      }
    });

    // 4. Guaranteed Zero-Overlap Layout strictly inside [minX .. maxX] x [cardsMinY .. maxY]
    if (placed.length) {
      const gap = stage.isMobile ? (stage.vw < 360 ? 6 : 8) : 10;
      const availH = Math.max(0, maxY - cardsMinY);
      const availW = Math.max(0, maxX - minX);

      if (stage.isMobile) {
        // Mobile (<768px): always render crisp centered 2x2 grid ([Kệ Úp, Card 0] / [Card 1, Card 2]) over zoomed-in stall!
        const ordered = placed.slice().sort((a, b) => a.orderIdx - b.orderIdx);
        const col0W = Math.max(ordered[0].w, ordered[2] ? ordered[2].w : 0);
        const col1W = Math.max(ordered[1] ? ordered[1].w : 0, ordered[3] ? ordered[3].w : 0);
        const gridW = col0W + (ordered.length > 1 ? gap + col1W : 0);
        const centerAnchorLeft = minX + Math.max(0, (availW - gridW) * 0.5);
        layoutPillGrid2x2(ordered, minX, maxX, cardsMinY, maxY, gap, gap, centerAnchorLeft);
      } else if (isVertical) {
        const totalColH = placed.reduce((s, it) => s + it.h, 0) + gap * Math.max(0, placed.length - 1);
        if (totalColH <= availH - 4) {
          // Fits comfortably in 1 crisp vertical column right beside the stall, strictly clear of Rival Flanks!
          const maxW = placed.reduce((m, it) => Math.max(m, it.w), 0);
          const avgX = placed.reduce((s, it) => s + it.x, 0) / placed.length;
          const colX = clamp(avgX, minX + maxW * 0.5, Math.max(minX + maxW * 0.5, maxX - maxW * 0.5));
          packStrictLinear(placed, 'y', cardsMinY, maxY, gap);
          placed.forEach(it => { it.x = colX; });
        } else {
          // Tight height (e.g. 1280x600, 820x640, or tall 🎯 Cần cho... pills): crisp 2x2 grid clear of flanks!
          const ordered = placed.slice().sort((a, b) => a.orderIdx - b.orderIdx);
          const inwardWorldX = shopKey === 'carbs' ? -10.3 : 10.3;
          proj.set(inwardWorldX, bh + 0.3, bcz - 0.1).project(camera);
          const inwardScreenX = (proj.x * 0.5 + 0.5) * stage.vw;
          const col0W = Math.max(ordered[0].w, ordered[2] ? ordered[2].w : 0);
          const col1W = Math.max(ordered[1] ? ordered[1].w : 0, ordered[3] ? ordered[3].w : 0);
          const gridW = col0W + (ordered.length > 1 ? gap + col1W : 0);
          const anchorLeft = shopKey === 'carbs'
            ? (inwardScreenX + 10)
            : (inwardScreenX - 10 - gridW);
          layoutPillGrid2x2(ordered, minX, maxX, cardsMinY, maxY, gap, gap, anchorLeft);
        }
      } else {
        const totalRowW = placed.reduce((s, it) => s + it.w, 0) + gap * Math.max(0, placed.length - 1);
        const maxH = placed.reduce((m, it) => Math.max(m, it.h), 0);
        if (totalRowW <= availW) {
          // Fits cleanly in 1 crisp horizontal row strictly inside [minX .. maxX]!
          packStrictLinear(placed, 'x', minX, maxX, gap);
          const avgY = placed.reduce((s, it) => s + it.y, 0) / placed.length;
          const rowY = clamp(avgY, cardsMinY + maxH * 0.5, Math.max(cardsMinY + maxH * 0.5, maxY - maxH * 0.5));
          placed.forEach(it => { it.y = rowY; });
        } else {
          // Narrow arena (e.g. 768–820px or active Rival Flanks): centered 2x2 grid inside [minX .. maxX]!
          const ordered = placed.slice().sort((a, b) => a.orderIdx - b.orderIdx);
          const col0W = Math.max(ordered[0].w, ordered[2] ? ordered[2].w : 0);
          const col1W = Math.max(ordered[1] ? ordered[1].w : 0, ordered[3] ? ordered[3].w : 0);
          const gridW = col0W + (ordered.length > 1 ? gap + col1W : 0);
          const avgX = ordered.reduce((s, it) => s + it.x, 0) / ordered.length;
          layoutPillGrid2x2(ordered, minX, maxX, cardsMinY, maxY, gap, gap, avgX - gridW * 0.5);
        }
      }

      placed.forEach(it => {
        it.node.style.transform = `translate3d(${Math.round(it.x)}px, ${Math.round(it.y)}px, 0) translate(-50%, -50%)`;
      });
    }
  }

  function renderDesktopPhase2IslandPills(layer, stage, camera, THREE, activeData) {
    const ctx = sceneState.ctx;
    const bh = typeof ctx.boardHeight === 'number' ? ctx.boardHeight : 0.35;
    const bcz = typeof ctx.boardCenterZ === 'number' ? ctx.boardCenterZ : -3.5;
    const isl = (activeData && activeData.island) || {};
    const garbage = Number(isl.garbage) || 0;
    const garbageCost = typeof isl.garbageCost === 'number' ? isl.garbageCost : 100;
    const money = typeof isl.money === 'number' ? isl.money : 9999;
    const upgradesCount = Number(isl.upgradesCount) || 0;
    const actionCost = typeof isl.actionCost === 'number' ? isl.actionCost : 200;
    const chocCount = Number(isl.chocolateCount) || 0;
    const chocVal = typeof isl.chocolateValue === 'number' ? isl.chocolateValue : 500;
    const dumpsterCount = Number(isl.dumpsterCount) || 0;
    const mob = stage.isMobile;

    const specs = [
      {
        id: 'garbage',
        pos: new THREE.Vector3(-4.6, bh + 2.35, bcz - 0.8),
        bg: 'rgba(116, 22, 22, 0.94)',
        border: '#f29494',
        label: mob ? `🧹 Rác ($${garbageCost}·${garbage})` : `🧹 Đổ Rác ($${garbageCost} · ${garbage} túi)`,
        disabled: garbage <= 0 || money < garbageCost,
        showSub: garbage > 1,
        subDisabled: money < garbageCost * garbage,
      },
      {
        id: 'dumpster',
        pos: new THREE.Vector3(-4.6, bh + 0.35, bcz + 2.75),
        bg: 'rgba(7, 62, 48, 0.94)',
        border: '#5eead4',
        label: mob ? `♻️ Khay (${dumpsterCount})` : `♻️ Khay Bỏ ($0 · ${dumpsterCount} thẻ)`,
        disabled: dumpsterCount <= 0,
      },
      {
        id: 'upgrade',
        pos: new THREE.Vector3(0, bh + 0.85, bcz - 0.35),
        bg: 'rgba(98, 48, 12, 0.94)',
        border: '#e5be6a',
        label: `🛠️ Nâng Cấp (${upgradesCount}/4)`,
        disabled: upgradesCount >= 4,
      },
      {
        id: 'chocolate',
        pos: new THREE.Vector3(0, bh + 0.4, bcz + 2.85),
        bg: 'rgba(76, 26, 12, 0.94)',
        border: '#e6a84c',
        label: mob ? `🍫 Sô-cô-la +$${chocVal}${chocCount > 0 ? ' ×' + chocCount : ''}` : `🍫 Bán Sô-cô-la (+$${chocVal}${chocCount > 0 ? ' · ×' + chocCount : ''})`,
        disabled: chocCount <= 0,
      },
      {
        id: 'action',
        pos: new THREE.Vector3(4.6, bh + 1.45, bcz + 0.2),
        bg: 'rgba(62, 20, 96, 0.94)',
        border: '#cfa4f8',
        label: mob ? `⚡ Thẻ ($${actionCost})` : `⚡ Thẻ Hành Động ($${actionCost})`,
        disabled: money < actionCost,
      },
    ];

    const proj = new THREE.Vector3();
    const minY = stage.topPx + (mob ? 14 : 24);
    const maxY = stage.bottomPx - (mob ? 8 : 14);
    let minX = mob ? 6 : (stage.leftPx + 10);
    let maxX = mob ? (stage.vw - 6) : (stage.rightPx - 10);
    if (!mob && maxX < minX + 180) {
      minX = 20;
      maxX = stage.vw - 20;
    }
    const placed = [];

    specs.forEach(sp => {
      const wrap = ensureIslandPillGroup(sp.id, layer, { bg: sp.bg, border: sp.border });
      wrap._mainBtn.textContent = sp.label;
      wrap._mainBtn.disabled = sp.disabled;
      if (wrap._subBtn) {
        wrap._subBtn.style.display = sp.showSub ? 'inline-flex' : 'none';
        wrap._subBtn.disabled = Boolean(sp.subDisabled);
      }

      proj.copy(sp.pos).project(camera);
      if (proj.z <= -1 || proj.z >= 1) {
        wrap.style.display = 'none';
        return;
      }
      wrap.style.display = 'inline-flex';
      const r = wrap.getBoundingClientRect();
      const sx = (proj.x * 0.5 + 0.5) * stage.vw;
      const sy = (-proj.y * 0.5 + 0.5) * stage.vh;
      placed.push({
        node: wrap,
        x: sx,
        y: sy,
        w: Math.ceil(r.width) || wrap.offsetWidth || (mob ? 118 : 168),
        h: Math.ceil(r.height) || wrap.offsetHeight || (mob ? 30 : 36),
      });
    });

    separate2DPills(placed, minX, maxX, minY, maxY, mob ? 6 : 10);
    placed.forEach(it => {
      it.node.style.transform = `translate3d(${Math.round(it.x)}px, ${Math.round(it.y)}px, 0) translate(-50%, -50%)`;
    });
  }

  function projectMarketBadges() {
    if (!HAS_DOM || !sceneState.ctx || !sceneState.ctx.camera) return;
    ensureStageOverlayDOM();
    const layer = sceneState.badgesLayer;
    if (!layer) return;

    const modalOpen = isModalOpenSafe();
    const stage = measureOpenStage();
    const isMatOpen = Boolean(document.body && document.body.classList.contains('rr-mat-open'));
    if (modalOpen || sceneState.peekMode || (stage.isMobile && isMatOpen)) {
      layer.style.display = 'none';
      hideTooltip();
      return;
    }
    layer.style.display = 'block';

    const { THREE, camera } = sceneState.ctx;
    const minY = stage.topPx + (stage.isMobile ? 14 : 22);
    const maxY = Math.max(minY + 28, stage.bottomPx - 8);
    const phase = getPhaseSafe();
    const selectedDest = getSelectedDestSafe();
    const currentLoc = getCurrentLocationSafe();
    const rawNeeds = getRawNeedsSafe();
    // Unified Direct Interactive 3D Board Plaques on ALL viewports (Desktop & Mobile, >=300px)
    // Mobile floor (64) stays strictly below measureOpenStage()'s 70 floor so Mobile Phase 1 never falls back to hidden <div>s
    const isDirectBoard = stage.vw >= 300 && stage.openH >= (stage.isMobile ? 64 : 120);

    camera.updateMatrixWorld();
    const proj = new THREE.Vector3();

    // UNIFIED BOARD-FIRST DIRECT 3D CONTROLS (Desktop + Mobile Open-Wood Tabletop)
    if (isDirectBoard) {
      // Phase 1: Clickable plaques on ALL 6 Markets + Chợ Bến Thành Island
      if (phase === 1) {
        hideDesktopDirectPills();
        const placedP1 = [];

        Object.keys(sceneState.marketZones).forEach(key => {
          const zone = sceneState.marketZones[key];
          let node = sceneState.badgeNodes[key];
          if (!node || !node.isConnected || node.tagName !== 'BUTTON') {
            if (node && node.parentNode) node.parentNode.removeChild(node);
            node = document.createElement('button');
            node.type = 'button';
            node.className = 'vdb-3d-market-pill';
            node.dataset.market = key;
            stopPillPointer(node);
            const labelSpan = document.createElement('span');
            labelSpan.className = 'vdb-mp-label';
            const costSpan = document.createElement('span');
            costSpan.className = 'vdb-mp-cost';
            const needSpan = document.createElement('span');
            needSpan.className = 'vdb-mp-need';
            node.append(labelSpan, costSpan, needSpan);
            node._parts = { labelSpan, costSpan, needSpan };
            node.addEventListener('click', (e) => {
              e.stopPropagation();
              invokeSelectMarket(key);
            });
            node.addEventListener('pointerenter', (e) => {
              if (e.pointerType === 'touch') return;
              sceneState.hoveredMarketKey = key;
              updateMarketGlowRings();
              if (sceneState.ctx && sceneState.ctx.requestRender) sceneState.ctx.requestRender(2);
              const meta = getMarketMeta(key);
              const need = normalizeMarketNeed(getRawNeedsSafe(), key);
              const isSel = key === getSelectedDestSafe();
              const priceLabel = key === 'island' ? 'Miễn phí · Đổ Rác / Nâng Cấp / Thẻ' : `$${meta.cost}/thẻ`;
              const hint = need.count > 0
                ? `🎯 ×${need.count} cần${need.recipes.length ? ' (' + need.recipes.slice(0, 2).join(', ') + ')' : ''}`
                : '';
              showTooltip(e.clientX, e.clientY, `${meta.emoji} ${meta.name}`, `${priceLabel} · ${isSel ? '✓ Đang chọn' : 'Bấm để chọn chợ này'}`, hint);
            });
            node.addEventListener('pointerleave', () => {
              if (sceneState.hoveredMarketKey === key) {
                sceneState.hoveredMarketKey = null;
                updateMarketGlowRings();
                if (sceneState.ctx && sceneState.ctx.requestRender) sceneState.ctx.requestRender(2);
              }
              hideTooltip();
            });
            layer.appendChild(node);
            sceneState.badgeNodes[key] = node;
          }

          const meta = getMarketMeta(key);
          const need = normalizeMarketNeed(rawNeeds, key);
          const isSel = key === selectedDest;
          const accentHex = '#' + (meta.color || 0xdcb35c).toString(16).padStart(6, '0');
          const shortTitle = stage.isMobile && key === 'island' ? 'Bến Thành' : meta.short;
          const sig = `${key}|${isSel}|${meta.cost}|${need.count}|${shortTitle}|${stage.isMobile ? 'm' : 'd'}`;
          if (node.dataset.sig !== sig) {
            node.dataset.sig = sig;
            node.className = 'vdb-3d-market-pill' + (isSel ? ' is-selected' : '');
            node.style.setProperty('--pill-accent', accentHex);
            node._parts.labelSpan.textContent = `${isSel ? '✓ ' : ''}${meta.emoji} ${shortTitle}`;
            node._parts.costSpan.textContent = key === 'island' ? (stage.isMobile ? '' : '$0') : `$${meta.cost}`;
            node._parts.costSpan.style.display = (stage.isMobile && key === 'island') ? 'none' : 'inline';
            if (need.count > 0) {
              node._parts.needSpan.textContent = stage.isMobile ? `×${need.count}` : `🎯 ×${need.count}`;
              node._parts.needSpan.style.display = 'inline-block';
            } else {
              node._parts.needSpan.textContent = '';
              node._parts.needSpan.style.display = 'none';
            }
          }

          proj.copy(zone.badgeAnchor).project(camera);
          if (proj.z >= 1 || proj.z <= -1) {
            node.style.display = 'none';
            return;
          }
          const rawSx = (proj.x * 0.5 + 0.5) * stage.vw;
          const rawSy = (-proj.y * 0.5 + 0.5) * stage.vh;
          if (!stage.isMobile && (rawSx < 16 || rawSx > stage.vw - 16 || rawSy < minY - 12 || rawSy > maxY + 12)) {
            node.style.display = 'none';
            return;
          }
          node.style.display = 'inline-flex';
          const nr = node.getBoundingClientRect();
          placedP1.push({
            node,
            x: clamp(rawSx, 6, stage.vw - 6),
            y: clamp(rawSy, minY, maxY),
            w: Math.ceil(nr.width) || node.offsetWidth || (stage.isMobile ? 96 : 126),
            h: Math.ceil(nr.height) || node.offsetHeight || (stage.isMobile ? 30 : 28),
          });
        });

        let p1MinX = stage.isMobile ? 6 : (stage.leftPx + 10);
        let p1MaxX = stage.isMobile ? (stage.vw - 6) : (stage.rightPx - 10);
        if (!stage.isMobile && p1MaxX < p1MinX + 180) {
          p1MinX = 16;
          p1MaxX = stage.vw - 16;
        }
        const p1Gap = stage.isMobile ? (stage.vw < 360 ? 4 : 5) : 6;
        separate2DPills(placedP1, p1MinX, p1MaxX, minY, maxY, p1Gap);
        placedP1.forEach(it => {
          it.node.style.transform = `translate3d(${Math.round(it.x)}px, ${Math.round(it.y)}px, 0) translate(-50%, -50%)`;
        });
        return;
      }

      // Phase 2: Direct 3D Card/Shelf Plaques (Regular Markets) OR 5 Island Service Plaques
      if (phase === 2) {
        hideAllZoneBadges();
        hideDesktopDirectPills();
        const activeData = getActiveMarketDataSafe();
        const shopKey = (activeData && activeData.shopKey) || currentLoc;
        if (!shopKey) return;
        if (shopKey === 'island') {
          renderDesktopPhase2IslandPills(layer, stage, camera, THREE, activeData);
        } else {
          renderDesktopPhase2MarketPills(layer, stage, camera, THREE, shopKey, activeData);
        }
        return;
      }

      // Phase 3: clean uncluttered 3D board while cooking
      hideAllZoneBadges();
      hideDesktopDirectPills();
      return;
    }

    // FALLBACK (only when open stage height < 136px, e.g. full Mat Drawer open): non-blocking indicator badges
    hideDesktopDirectPills();
    Object.keys(sceneState.marketZones).forEach(key => {
      const zone = sceneState.marketZones[key];
      let node = sceneState.badgeNodes[key];
      if (!node || !node.isConnected || node.tagName !== 'DIV') {
        if (node && node.parentNode) node.parentNode.removeChild(node);
        node = document.createElement('div');
        node.className = 'vdb-3d-badge';
        node.dataset.market = key;
        layer.appendChild(node);
        sceneState.badgeNodes[key] = node;
      }

      const need = normalizeMarketNeed(rawNeeds, key);
      let text = '';
      let cls = '';

      if (phase === 1) {
        if (key === selectedDest) {
          text = need.count > 0 ? `✓ ĐÃ CHỌN · 🎯 ×${need.count}` : '✓ ĐÃ CHỌN';
          cls = 'is-selected';
        } else if (need.count > 0) {
          text = `🎯 ×${need.count}`;
          cls = 'is-need';
        }
      } else if (phase === 2 && key === currentLoc) {
        text = need.count > 0 ? `📍 ĐANG Ở ĐÂY · 🎯 ×${need.count}` : '📍 ĐANG Ở ĐÂY';
        cls = 'is-active';
      }

      if (!text || stage.openH < 64) {
        node.style.display = 'none';
        return;
      }

      proj.copy(zone.badgeAnchor).project(camera);
      if (proj.z >= 1 || proj.z <= -1) {
        node.style.display = 'none';
        return;
      }

      const sx = (proj.x * 0.5 + 0.5) * stage.vw;
      const sy = (-proj.y * 0.5 + 0.5) * stage.vh;

      if (sx < 34 || sx > stage.vw - 34 || sy < minY || sy > maxY) {
        node.style.display = 'none';
        return;
      }

      node.textContent = text;
      node.className = 'vdb-3d-badge ' + cls;
      node.style.display = 'inline-flex';
      node.style.transform = `translate3d(${Math.round(sx)}px, ${Math.round(sy)}px, 0) translate(-50%, -100%)`;
    });
  }

  function scheduleBadgeProjection() {
    if (!HAS_DOM || sceneState.overlayRafPending) return;
    sceneState.overlayRafPending = true;
    requestAnimationFrame(() => {
      sceneState.overlayRafPending = false;
      projectMarketBadges();
    });
  }

  function syncBoardOverlays() {
    const ctx = sceneState.ctx;
    if (!ctx) return;
    const phase = getPhaseSafe();
    const currentLoc = getCurrentLocationSafe();

    ensureSceneColorTexturesSRGB(ctx, false);
    syncServiceBellVisibility();
    updateMarketGlowRings();
    setActiveMarketTilt(phase === 2 ? currentLoc : null);
    projectMarketBadges();
    if (ctx.requestRender) ctx.requestRender(2);
  }

  function setupCardHoverHighlight(ctx) {
    const { THREE, scene, camera, renderer, interactive3DCards, interactive3DShelves, requestRender } = ctx;
    if (!renderer || !renderer.domElement || !camera || sceneState.interactionBound) return;
    sceneState.interactionBound = true;

    // Reusable golden emissive border ring frame snapped around hovered card/shelf
    const frameGroup = new THREE.Group();
    frameGroup.name = 'VdbHoverHighlightFrame';
    frameGroup.visible = false;
    frameGroup.userData.isDecorative = true;

    const frameMat = new THREE.MeshBasicMaterial({
      color: 0xfde047,
      transparent: true,
      opacity: 0.92,
    });
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const barTop = new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.05, 0.07), frameMat);
    barTop.position.set(0, 0.04, -0.99);
    const barBot = new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.05, 0.07), frameMat);
    barBot.position.set(0, 0.04, 0.99);
    const barL = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 2.04), frameMat);
    barL.position.set(-0.78, 0.04, 0);
    const barR = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 2.04), frameMat);
    barR.position.set(0.78, 0.04, 0);
    const underGlow = new THREE.Mesh(new THREE.PlaneGeometry(1.78, 2.24), glowMat);
    underGlow.rotation.x = -Math.PI / 2;
    underGlow.position.y = -0.02;

    frameGroup.add(barTop, barBot, barL, barR, underGlow);
    scene.add(frameGroup);
    sceneState.hoverFrame = frameGroup;

    const ray = new THREE.Raycaster();
    const ptr = new THREE.Vector2();

    function setEmissive(mesh, hex, intensity) {
      if (!mesh || !mesh.material) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach(m => {
        if (m && m.emissive && typeof m.emissive.setHex === 'function') {
          m.emissive.setHex(hex);
          m.emissiveIntensity = intensity;
        }
      });
    }

    function clearCardHover() {
      const prev = sceneState.hoveredObj;
      if (!prev) return;
      if (prev.userData._aaaHoverKind === 'card') {
        const restY = prev.userData._aaaBaseY !== undefined ? prev.userData._aaaBaseY : sceneState.hoveredRestY;
        if (restY !== null && restY !== undefined) prev.position.y = restY;
      }
      setEmissive(prev, 0x000000, 0);
      prev.userData._aaaHoverKind = null;
      sceneState.hoveredObj = null;
      sceneState.hoveredRestY = null;
      frameGroup.visible = false;
      frameGroup.rotation.x = 0;
    }

    function clearAllHover() {
      const hadAnything = Boolean(sceneState.hoveredObj || sceneState.hoveredMarketKey);
      clearCardHover();
      if (sceneState.hoveredMarketKey) {
        sceneState.hoveredMarketKey = null;
        updateMarketGlowRings();
      }
      hideTooltip();
      renderer.domElement.style.cursor = '';
      if (hadAnything && requestRender) requestRender(2);
    }

    function onPointerMove(e) {
      // Desktop hover only — skip touch events for mobile performance
      if (e.pointerType === 'touch') return;
      const now = performance.now();
      if (now - sceneState.hoverLastCheck < 38) return;
      sceneState.hoverLastCheck = now;

      if (e.target !== renderer.domElement || isModalOpenSafe()) {
        clearAllHover();
        return;
      }

      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      ptr.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ptr.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      ray.setFromCamera(ptr, camera);

      const phase = getPhaseSafe();

      // Hovering visible 3D Brass Service Bell (Mobile or Peek 3D mode)
      if (sceneState.serviceBellGroup && sceneState.serviceBellGroup.visible) {
        if (ray.intersectObject(sceneState.serviceBellGroup, true).length > 0) {
          clearCardHover();
          if (sceneState.hoveredMarketKey) {
            sceneState.hoveredMarketKey = null;
            updateMarketGlowRings();
          }
          showTooltip(e.clientX, e.clientY, '🛎️ Chuông Bếp', 'Bấm để Đi Chợ / Kết Thúc Lượt', '');
          renderer.domElement.style.cursor = 'pointer';
          return;
        }
      }

      // PHASE 1: Hovering 3D Markets & Chợ Bến Thành Island
      if (phase === 1 && sceneState.marketHitMeshes.length > 0) {
        clearCardHover();
        const mHits = ray.intersectObjects(sceneState.marketHitMeshes, false);
        const mHit = mHits.length > 0 ? mHits[0].object : null;
        const mKey = mHit && mHit.userData ? mHit.userData.marketKey : null;

        if (!mKey) {
          if (sceneState.hoveredMarketKey) {
            sceneState.hoveredMarketKey = null;
            updateMarketGlowRings();
            if (requestRender) requestRender(2);
          }
          hideTooltip();
          renderer.domElement.style.cursor = '';
          return;
        }

        if (sceneState.hoveredMarketKey !== mKey) {
          sceneState.hoveredMarketKey = mKey;
          updateMarketGlowRings();
          if (requestRender) requestRender(2);
        }

        const meta = getMarketMeta(mKey);
        const need = normalizeMarketNeed(getRawNeedsSafe(), mKey);
        const isSel = mKey === getSelectedDestSafe();
        const priceLabel = mKey === 'island'
          ? 'Miễn phí · Đổ Rác / Nâng Cấp / Thẻ'
          : `$${meta.cost}/thẻ`;
        const sub = `${priceLabel} · ${isSel ? '✓ Đang chọn' : 'Bấm để chọn chợ này'}`;
        const hint = need.count > 0
          ? `🎯 ×${need.count} cần${need.recipes.length ? ' (' + need.recipes.slice(0, 2).join(', ') + ')' : ''}`
          : '';
        showTooltip(e.clientX, e.clientY, `${meta.emoji} ${meta.name}`, sub, hint);
        renderer.domElement.style.cursor = 'pointer';
        return;
      }

      // Clear Phase 1 market hover if not in Phase 1
      if (sceneState.hoveredMarketKey) {
        sceneState.hoveredMarketKey = null;
        updateMarketGlowRings();
      }

      // PHASE 2: Hovering 3D Island Props (Garbage Bag / Action Deck) OR Counter Cards & Shelf Decks
      if (phase === 2) {
        const currentLoc = getCurrentLocationSafe();
        if (currentLoc === 'island') {
          const { garbageBagGroup, actionDeckMesh } = getIslandPropsSafe();
          const activeData = getActiveMarketDataSafe();
          const isl = (activeData && activeData.island) || {};
          if (garbageBagGroup && ray.intersectObject(garbageBagGroup, true).length > 0) {
            clearCardHover();
            const gCost = typeof isl.garbageCost === 'number' ? isl.garbageCost : 100;
            const gCnt = Number(isl.garbage) || 0;
            showTooltip(e.clientX, e.clientY, '🧹 Túi Rác Bếp (Chợ Bến Thành)', `$${gCost}/túi · Hiện có ${gCnt} túi rác`, gCnt > 0 ? 'Bấm trực tiếp vào Túi Rác để dọn 1 túi!' : 'Bếp đang sạch rác!');
            renderer.domElement.style.cursor = gCnt > 0 ? 'pointer' : 'default';
            return;
          }
          if (actionDeckMesh && ray.intersectObject(actionDeckMesh, true).length > 0) {
            clearCardHover();
            const aCost = typeof isl.actionCost === 'number' ? isl.actionCost : 200;
            showTooltip(e.clientX, e.clientY, '⚡ Chồng Thẻ Hành Động Bí Mật', `$${aCost}/thẻ · Tối đa 1 thẻ dùng/ngày`, 'Bấm trực tiếp để mua 1 Thẻ Hành Động!');
            renderer.domElement.style.cursor = 'pointer';
            return;
          }
        }

        const cards = Array.isArray(interactive3DCards) ? interactive3DCards : [];
        const shelves = Array.isArray(interactive3DShelves) ? interactive3DShelves : [];
        let hitObj = null;
        let kind = null;

        if (cards.length) {
          const hits = ray.intersectObjects(cards, false);
          const vis = hits.find(h => h.object && h.object.visible);
          if (vis) { hitObj = vis.object; kind = 'card'; }
        }
        if (!hitObj && shelves.length) {
          const hits = ray.intersectObjects(shelves, false);
          const vis = hits.find(h => h.object && h.object.visible);
          if (vis) { hitObj = vis.object; kind = 'shelf'; }
        }

        if (!hitObj) {
          clearAllHover();
          return;
        }

        if (hitObj !== sceneState.hoveredObj) {
          clearCardHover();
          sceneState.hoveredObj = hitObj;
          hitObj.userData._aaaHoverKind = kind;

          if (kind === 'card') {
            const baseY = hitObj.userData._aaaBaseY !== undefined ? hitObj.userData._aaaBaseY : hitObj.position.y;
            sceneState.hoveredRestY = baseY;
            hitObj.position.y = baseY + (prefersReducedMotion() ? 0.04 : 0.16);
            frameGroup.scale.set(1.0, 1.0, 1.0);
            frameGroup.rotation.x = hitObj.rotation ? hitObj.rotation.x : 0;
            frameGroup.position.set(hitObj.position.x, hitObj.position.y, hitObj.position.z);
          } else {
            const sy = hitObj.scale ? hitObj.scale.y : 1;
            const topY = hitObj.position.y + (0.58 * sy) / 2;
            frameGroup.scale.set(1.06, 1.0, 1.08);
            frameGroup.rotation.x = 0;
            frameGroup.position.set(hitObj.position.x, topY, hitObj.position.z);
          }
          setEmissive(hitObj, 0x6b4706, 0.42);
          frameGroup.visible = true;
          if (requestRender) requestRender(2);
        }

        const atThisMarket = !currentLoc || hitObj.marketKey === currentLoc;
        if (kind === 'card' && hitObj.cardData) {
          const cd = hitObj.cardData;
          const ownerLabel = cd.claimedBy
            ? `⚔️ Đã mua: ${cd.claimedBy.name || 'Đối thủ'}${atThisMarket ? ' · Bấm để Giành/Đấu Giá' : ''}`
            : (atThisMarket ? '✨ Có sẵn · Bấm thẳng vào thẻ để mua!' : '📍 Đang ở quầy chợ khác');
          const hint = getCardRecipeHintText(cd.name, hitObj.marketKey);
          showTooltip(e.clientX, e.clientY, `${cd.emoji || '📦'} ${cd.name}`, `$${cd.cost} · ${ownerLabel}`, hint);
        } else if (kind === 'shelf') {
          const meta = getMarketMeta(hitObj.marketKey);
          const cntText = meta.shelfCount > 0 ? `${meta.shelfCount} thẻ còn lại` : 'Bốc úp ngẫu nhiên';
          const status = atThisMarket ? 'Bấm để bốc úp Kệ Úp!' : '📍 Đang ở quầy chợ khác';
          showTooltip(e.clientX, e.clientY, `📦 KỆ ÚP — ${meta.short}`, `$${meta.cost} · ${cntText} · ${status}`, '');
        }
        renderer.domElement.style.cursor = atThisMarket ? 'pointer' : 'default';
        return;
      }

      clearAllHover();
    }

    function onPointerDown(e) {
      sceneState.pointerDownX = e.clientX;
      sceneState.pointerDownY = e.clientY;
      sceneState.pointerDownOnCanvas = (e.target === renderer.domElement);
    }

    function onPointerUp(e) {
      if (!sceneState.pointerDownOnCanvas) return;
      sceneState.pointerDownOnCanvas = false;
      if (e.target && e.target.closest && e.target.closest('.hud-interactive')) return;
      if (e.target !== renderer.domElement) return;
      if (Math.hypot(e.clientX - sceneState.pointerDownX, e.clientY - sceneState.pointerDownY) >= 6) return;
      if (isModalOpenSafe()) return;

      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      ptr.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ptr.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      ray.setFromCamera(ptr, camera);

      const phase = getPhaseSafe();

      // Clicking visible 3D Brass Service Bell (any phase when visible in Peek 3D or Mobile)
      if (sceneState.serviceBellGroup && sceneState.serviceBellGroup.visible) {
        if (ray.intersectObject(sceneState.serviceBellGroup, true).length > 0) {
          ringServiceBell();
          if (sceneState.interactiveCtx && typeof sceneState.interactiveCtx.onRingBell === 'function') {
            try { sceneState.interactiveCtx.onRingBell(); } catch (err) {
              if (typeof console !== 'undefined' && console.warn) console.warn('VdbAAA onRingBell:', err);
            }
          }
          return;
        }
      }

      // Phase 2 at Island: direct 3D mesh clicks on garbageBagGroup ('dispose_1') & actionDeckMesh ('action')
      if (phase === 2 && getCurrentLocationSafe() === 'island') {
        const { garbageBagGroup, actionDeckMesh } = getIslandPropsSafe();
        if (garbageBagGroup && ray.intersectObject(garbageBagGroup, true).length > 0) {
          invokeIslandAction('dispose_1');
          return;
        }
        if (actionDeckMesh && ray.intersectObject(actionDeckMesh, true).length > 0) {
          invokeIslandAction('action');
          return;
        }
        return;
      }

      if (phase !== 1) return;
      if (!sceneState.interactiveCtx || typeof sceneState.interactiveCtx.onSelectMarket !== 'function') return;
      if (!sceneState.marketHitMeshes.length) return;

      const hits = ray.intersectObjects(sceneState.marketHitMeshes, false);
      if (!hits.length) return;
      const key = hits[0].object && hits[0].object.userData && hits[0].object.userData.marketKey;
      if (!key) return;
      invokeSelectMarket(key);
    }

    renderer.domElement.addEventListener('pointermove', onPointerMove, { passive: true });
    renderer.domElement.addEventListener('pointerleave', clearAllHover, { passive: true });
    renderer.domElement.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointerup', onPointerUp, { passive: true });
    window.addEventListener('resize', () => {
      syncServiceBellVisibility();
      scheduleBadgeProjection();
    }, { passive: true });
  }

  function tweenPeekCamera(endPos, endTarget, durationMs) {
    const ctx = sceneState.ctx;
    if (!ctx || !ctx.camera || !ctx.controls) return;
    const { camera, controls, requestRender } = ctx;
    const myId = ++sceneState.peekTweenId;

    if (prefersReducedMotion() || durationMs <= 0) {
      camera.position.copy(endPos);
      controls.target.copy(endTarget);
      controls.update();
      projectMarketBadges();
      if (requestRender) requestRender(4);
      return;
    }

    const startPos = camera.position.clone();
    const startTarget = controls.target.clone();
    const t0 = performance.now();

    function step(now) {
      if (myId !== sceneState.peekTweenId) return;
      const t = clamp((now - t0) / durationMs, 0, 1);
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      camera.position.lerpVectors(startPos, endPos, ease);
      controls.target.lerpVectors(startTarget, endTarget, ease);
      controls.update();
      projectMarketBadges();
      if (requestRender) requestRender(2);
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        camera.position.copy(endPos);
        controls.target.copy(endTarget);
        controls.update();
        projectMarketBadges();
        if (requestRender) requestRender(3);
      }
    }
    requestAnimationFrame(step);
  }

  function focusStage(mode, targetPosOrKey, opts) {
    const ctx = sceneState.ctx;
    if (!ctx || !ctx.THREE || !ctx.camera || !ctx.controls) return;
    const { THREE, controls } = ctx;
    const boardCenterZ = typeof ctx.boardCenterZ === 'number' ? ctx.boardCenterZ : -3.5;
    const stage = measureOpenStage();
    const o = opts || {};
    const dur = o.instant ? 0 : (typeof o.durationMs === 'number' ? o.durationMs : 680);

    // Resolve mode & target position cleanly
    let resolvedMode = String(mode || 'overview').toLowerCase();
    let mx = 0;
    let mz = boardCenterZ;

    if (resolvedMode === 'market') {
      if (typeof targetPosOrKey === 'string') {
        if (targetPosOrKey === 'island') {
          resolvedMode = 'island';
        } else {
          const z = sceneState.marketZones[targetPosOrKey];
          const icMarkets = (sceneState.interactiveCtx && sceneState.interactiveCtx.markets) || ctx.markets;
          if (z) {
            mx = z.meta.cx;
            mz = z.meta.cz;
          } else if (icMarkets && icMarkets[targetPosOrKey] && icMarkets[targetPosOrKey].pos) {
            mx = icMarkets[targetPosOrKey].pos.x;
            mz = icMarkets[targetPosOrKey].pos.z;
          }
        }
      } else if (targetPosOrKey && typeof targetPosOrKey === 'object') {
        const p = targetPosOrKey.pos || targetPosOrKey;
        if (typeof p.x === 'number') mx = p.x;
        if (typeof p.z === 'number') mz = p.z;
      }
    }

    // Dynamic camera framing:
    // - Desktop Open-Wood Tabletop (>=768px, deckHeight < 210px)
    // - Unified Mobile Open-Wood Tabletop (<768px): computes BOTH horizontal aspect & vertical [topPx..bottomPx] open stage!
    const upperShift = clamp(stage.ndcY, 0, 0.55);
    const openFrac = clamp(stage.openH / Math.max(1, stage.vh), 0.35, 0.92);
    const aspect = clamp(stage.vw / Math.max(1, stage.vh), 0.42, 2.5);
    // Allow portrait Mobile enough zoom-out headroom so the full 28-unit Indochine board fits edge-to-edge!
    if (stage.isMobile && controls && typeof controls.maxDistance === 'number' && controls.maxDistance < 96) {
      controls.maxDistance = 96;
    }
    const maxDist = (controls && typeof controls.maxDistance === 'number') ? (controls.maxDistance - 2.5) : 62;

    let endTarget;
    let endPos;

    if (stage.isMobile) {
      // Portrait / Compact Mobile Open-Wood Tabletop framing (tan(19 deg) ~ 0.3443)
      const hHalfTan = 0.3443 * aspect;
      if (resolvedMode === 'island') {
        const dist = clamp(Math.max(22.5 / openFrac, 7.6 / hHalfTan), 25.0, Math.min(54.0, maxDist));
        const zBias = clamp(0.40 * dist * stage.ndcY + 0.4, -1.0, 12.0);
        const tz = clamp(boardCenterZ - 0.3 + zBias, -15, 22);
        endTarget = new THREE.Vector3(0, 0.8, tz);
        endPos = new THREE.Vector3(2.0, dist * 0.78, tz + dist * 0.62);
      } else if (resolvedMode === 'market') {
        const isVert = Math.abs(mx) > 10;
        const needHalfW = isVert ? 5.2 : 6.4;
        const dist = clamp(Math.max((isVert ? 25.0 : 21.5) / openFrac, needHalfW / hHalfTan), 24.0, Math.min(52.0, maxDist));
        const zBias = clamp(0.40 * dist * stage.ndcY + 0.45, -0.5, 11.5);
        const tx = clamp(mx + (isVert ? (mx < 0 ? 1.0 : -1.0) : 0), -22, 22);
        const tz = clamp(mz + zBias, -15, 22);
        endTarget = new THREE.Vector3(tx, 0.35, tz);
        endPos = new THREE.Vector3(clamp(tx * 0.94, -24, 24), dist * 0.80, tz + dist * 0.59);
      } else if (resolvedMode === 'board') {
        const dist = clamp(Math.max(27.0 / openFrac, 14.6 / hHalfTan), 44.0, Math.min(90.0, maxDist));
        const zBias = clamp(0.41 * dist * stage.ndcY + 0.4, -1.0, 15.0);
        const tz = clamp(boardCenterZ + zBias, -15, 24);
        endTarget = new THREE.Vector3(0, 0, tz);
        endPos = new THREE.Vector3(0, dist * 0.87, tz + dist * 0.49);
      } else {
        // 'overview' on Mobile: frames all 6 stalls + Chợ Bến Thành + brass board frame cleanly inside narrow portrait screen
        const dist = clamp(Math.max(29.0 / openFrac, 15.1 / hHalfTan), 46.0, Math.min(92.0, maxDist));
        const zBias = clamp(0.41 * dist * stage.ndcY + 0.5, -1.0, 15.5);
        const tz = clamp(boardCenterZ + zBias, -15, 24);
        endTarget = new THREE.Vector3(0, 0, tz);
        endPos = new THREE.Vector3(0, dist * 0.87, tz + dist * 0.49);
      }
    } else if (stage.isSlimDesktop) {
      // Factor in Left/Right Rival Flanks (#tt-rivals-left / #tt-rivals-right) when active!
      const hasRivalFlanks = stage.leftPx > 40 || stage.rightPx < stage.vw - 40;
      const openWFrac = clamp(stage.openW / Math.max(1, stage.vw), 0.45, 1.0);
      const effAspect = aspect * openWFrac;
      const ndcX = (stage.centerX / Math.max(1, stage.vw)) * 2 - 1;

      // Pitch angle ~59 deg (sin ~0.857, cos ~0.515) gives crisp isometric tabletop depth
      if (resolvedMode === 'island') {
        const dScale = clamp(0.68 / openFrac, 0.95, 1.38);
        const dist = clamp(21.4 * dScale, 19.5, 30.0);
        const zBias = clamp(0.41 * dist * stage.ndcY + 0.3, -1.0, 9.0);
        const xBias = hasRivalFlanks ? clamp(-0.344 * dist * aspect * ndcX, -4.5, 4.5) : 0;
        const tz = clamp(boardCenterZ - 0.1 + zBias, -15, 22);
        endTarget = new THREE.Vector3(xBias, 0.75, tz);
        endPos = new THREE.Vector3(xBias + 2.6, dist * 0.76, tz + dist * 0.64);
      } else if (resolvedMode === 'market') {
        const isVert = Math.abs(mx) > 10;
        const dScale = clamp(Math.max(0.70 / openFrac, hasRivalFlanks ? (0.76 / openWFrac) : 0.95), 0.95, 1.45);
        const baseD = isVert ? 22.0 : 19.0;
        const dist = clamp(baseD * dScale, 17.5, 32.0);
        const zBias = clamp(0.41 * dist * stage.ndcY + 0.45, -0.5, 9.0);
        const xBias = hasRivalFlanks ? clamp(-0.344 * dist * aspect * ndcX, -4.0, 4.0) : 0;
        const tx = clamp(mx + (isVert ? (mx < 0 ? 1.3 : -1.3) : 0) + xBias, -22, 22);
        const tz = clamp(mz + zBias, -15, 22);
        endTarget = new THREE.Vector3(tx, 0.35, tz);
        endPos = new THREE.Vector3(clamp(tx * 0.94, -24, 24), dist * 0.80, tz + dist * 0.59);
      } else if (resolvedMode === 'board') {
        const hNeed = hasRivalFlanks ? (44.5 / effAspect) : (38.0 / aspect);
        const dist = clamp(Math.max(27.5 / openFrac, hNeed), 36.0, maxDist);
        const zBias = clamp(0.41 * dist * stage.ndcY + 0.4, -1.0, 12.0);
        const xBias = hasRivalFlanks ? clamp(-0.344 * dist * aspect * ndcX, -6.0, 6.0) : 0;
        const tz = clamp(boardCenterZ + zBias, -15, 22);
        endTarget = new THREE.Vector3(xBias, 0, tz);
        endPos = new THREE.Vector3(xBias, dist * 0.86, tz + dist * 0.51);
      } else {
        // Open-Wood Tabletop 'overview': fits all 6 stalls + Chợ Bến Thành (+ Recipe Decks & Hourglass)
        // cleanly inside [leftPx .. rightPx] x [topPx .. bottomPx] between Rival Flanks!
        const hNeed = hasRivalFlanks ? (54.5 / effAspect) : (42.5 / aspect);
        const dist = clamp(Math.max(31.8 / openFrac, hNeed), 42.0, maxDist);
        const zBias = clamp(0.41 * dist * stage.ndcY + 0.5, -0.5, 13.5);
        const xBias = hasRivalFlanks ? clamp(-0.344 * dist * aspect * ndcX, -6.5, 6.5) : 0;
        const tz = clamp(boardCenterZ + zBias, -15, 22);
        endTarget = new THREE.Vector3(xBias, 0, tz);
        endPos = new THREE.Vector3(xBias, dist * 0.86, tz + dist * 0.51);
      }
    } else if (resolvedMode === 'island') {
      const zBias = stage.isMobile ? (2.4 + upperShift * 5.2) : (1.0 + upperShift * 4.2);
      const tz = clamp(boardCenterZ - 1.0 + zBias, -15, 22);
      const camY = stage.isMobile ? 22.0 : 18.5;
      const camDZ = stage.isMobile ? 16.0 : 14.0;
      endTarget = new THREE.Vector3(0, 0.9, tz);
      endPos = new THREE.Vector3(stage.isMobile ? 2.2 : 3.2, camY, tz + camDZ);
    } else if (resolvedMode === 'market') {
      const zBias = stage.isMobile ? (2.4 + upperShift * 5.5) : (0.9 + upperShift * 4.4);
      const tx = clamp(mx, -22, 22);
      const tz = clamp(mz + zBias, -15, 22);
      const camY = stage.isMobile ? 24.0 : 20.5;
      const camDZ = stage.isMobile ? 15.5 : 13.8;
      endTarget = new THREE.Vector3(tx, 0.35, tz);
      endPos = new THREE.Vector3(clamp(tx * 0.92, -24, 24), camY, tz + camDZ);
    } else if (resolvedMode === 'board') {
      const zBias = stage.isMobile ? (2.6 + upperShift * 7.5) : (1.2 + upperShift * 7.5);
      const tz = clamp(boardCenterZ + zBias, -15, 22);
      const camY = stage.isMobile ? 43.0 : 37.0;
      const camDZ = stage.isMobile ? 24.0 : 20.5;
      endTarget = new THREE.Vector3(0, 0, tz);
      endPos = new THREE.Vector3(0, camY, tz + camDZ);
    } else {
      // 'overview': full 3D tabletop cleanly framed inside [topPx .. bottomPx] above Bottom Dock / Sheet
      const zBias = stage.isMobile ? (2.2 + upperShift * 8.2) : (1.5 + upperShift * 8.2);
      const tz = clamp(boardCenterZ + zBias, -15, 22);
      const camY = stage.isMobile ? 48.0 : 47.0;
      const camDZ = stage.isMobile ? 27.0 : 26.5;
      endTarget = new THREE.Vector3(0, 0, tz);
      endPos = new THREE.Vector3(0, camY, tz + camDZ);
    }

    // Clamp distance inside OrbitControls [minDistance, maxDistance]
    const offset = endPos.clone().sub(endTarget);
    const dist = offset.length();
    if (dist > maxDist && dist > 0) {
      offset.multiplyScalar(maxDist / dist);
      endPos.copy(endTarget).add(offset);
    }

    tweenPeekCamera(endPos, endTarget, dur);
  }

  function setInteractiveContext(opts) {
    if (!opts || typeof opts !== 'object') return;
    sceneState.interactiveCtx = Object.assign({}, sceneState.interactiveCtx || {}, opts);
    if (opts.playerDial) {
      sceneState.playerDial = opts.playerDial;
      hidePlayerDialCompletely(sceneState.playerDial);
    }
    if (sceneState.ctx && sceneState.rootGroup) {
      const bh = typeof sceneState.ctx.boardHeight === 'number' ? sceneState.ctx.boardHeight : 0.35;
      const bcz = typeof sceneState.ctx.boardCenterZ === 'number' ? sceneState.ctx.boardCenterZ : -3.5;
      buildMarketInteractiveZones(sceneState.ctx.THREE, sceneState.rootGroup, bh, bcz);
    }
    syncBoardOverlays();
  }

  function setPeekMode(enabled) {
    const next = !!enabled;
    sceneState.peekMode = next;
    if (HAS_DOM) {
      document.documentElement.dataset.peekMode = next ? 'true' : 'false';
    }
    syncServiceBellVisibility();

    const ctx = sceneState.ctx;
    if (!ctx || !ctx.controls || !ctx.camera || !ctx.THREE) return next;

    const { THREE, camera, controls, requestRender } = ctx;
    const boardCenterZ = typeof ctx.boardCenterZ === 'number' ? ctx.boardCenterZ : -3.5;

    if (next) {
      if (!sceneState.savedControlsState) {
        sceneState.savedCameraPos = camera.position.clone();
        sceneState.savedControlsTarget = controls.target.clone();
        sceneState.savedControlsState = {
          enableRotate: controls.enableRotate,
          minPolarAngle: controls.minPolarAngle,
          maxPolarAngle: controls.maxPolarAngle,
          mouseButtons: controls.mouseButtons ? Object.assign({}, controls.mouseButtons) : null,
          touches: controls.touches ? Object.assign({}, controls.touches) : null,
        };
      }
      controls.enableRotate = true;
      controls.minPolarAngle = 0.25;
      controls.maxPolarAngle = 1.22;
      controls.rotateSpeed = 0.78;
      if (THREE.MOUSE) {
        controls.mouseButtons = {
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.PAN,
        };
      }
      if (THREE.TOUCH) {
        controls.touches = {
          ONE: THREE.TOUCH.ROTATE,
          TWO: THREE.TOUCH.DOLLY_PAN,
        };
      }
      controls.update();
      // Smooth 3/4 isometric inspection angle showcasing entire board, Chợ Bến Thành, stalls & chef standees
      tweenPeekCamera(
        new THREE.Vector3(12.5, 23.5, boardCenterZ + 25.5),
        new THREE.Vector3(0, 0.7, boardCenterZ + 1.0),
        680
      );
    } else {
      const saved = sceneState.savedControlsState;
      controls.enableRotate = saved ? saved.enableRotate : false;
      controls.minPolarAngle = saved && typeof saved.minPolarAngle === 'number' ? saved.minPolarAngle : 0;
      controls.maxPolarAngle = saved && typeof saved.maxPolarAngle === 'number' ? saved.maxPolarAngle : Math.PI;
      if (saved && saved.mouseButtons) {
        controls.mouseButtons = Object.assign({}, saved.mouseButtons);
      } else if (THREE.MOUSE) {
        controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
      }
      if (saved && saved.touches) {
        controls.touches = Object.assign({}, saved.touches);
      } else if (THREE.TOUCH) {
        controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
      }
      const restorePos = sceneState.savedCameraPos || new THREE.Vector3(0, 42, 28);
      const restoreTarget = sceneState.savedControlsTarget || new THREE.Vector3(0, 0, 3.0);
      sceneState.savedControlsState = null;
      sceneState.savedCameraPos = null;
      sceneState.savedControlsTarget = null;
      controls.update();
      tweenPeekCamera(restorePos, restoreTarget, 620);
    }

    if (requestRender) requestRender(4);
    return next;
  }

  function togglePeekMode() {
    return setPeekMode(!sceneState.peekMode);
  }

  function isPeekMode() {
    return sceneState.peekMode;
  }

  function enhanceScene(ctx) {
    if (!ctx || !ctx.THREE || !ctx.scene) return null;
    sceneState.ctx = ctx;

    const { THREE, scene, controls, renderer, requestRender } = ctx;
    const boardHeight = typeof ctx.boardHeight === 'number' ? ctx.boardHeight : 0.35;
    const boardCenterZ = typeof ctx.boardCenterZ === 'number' ? ctx.boardCenterZ : -3.5;

    // Enforce mobile-safe 1.5x max DPR
    if (renderer && typeof renderer.setPixelRatio === 'function' && HAS_DOM) {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    }

    // Resolve extended 3D scene references (direct ctx refs with clean scene-graph fallback)
    const refs = resolveSceneRefs(ctx);

    // 1. Indochine Collector's Edition Lighting, PMREM Studio Env & sRGB Tone-Mapping Pipeline
    setupIndochineLightingAndEnv(ctx, refs);

    // 2. Dark Indochine Walnut & Rosewood Marquetry Tabletop
    upgradeTabletop(ctx, refs);

    // Build 3D Vietnamese Tabletop Architecture once
    if (!sceneState.enhanced) {
      sceneState.enhanced = true;

      const root = new THREE.Group();
      root.name = 'VdbAAASceneRoot';
      root.userData.isDecorative = true;

      // 3. Collector's Edition Board Face + Physical 3D Beveled Rosewood & Brushed-Brass Perimeter Frame
      upgradeCollectorBoard(ctx, refs, root, boardHeight, boardCenterZ);

      // 4. Heirloom 3D Props (Brass/Crystal Hourglass, Hardcover Gilt Decks, Kitchen Service Hamper)
      upgradeHeirloomProps(ctx, refs);

      const clockTower = buildBenThanhClockTower(THREE, boardHeight, boardCenterZ);
      const marketStalls = buildMarketStalls(THREE, boardHeight, boardCenterZ);
      const steamPoints = buildSteamParticles(THREE, boardHeight, boardCenterZ);
      const serviceBell = buildServiceBell3D(THREE);
      const rivalProps = new THREE.Group();
      rivalProps.name = 'VdbRivalTableProps';
      rivalProps.visible = false;
      rivalProps.userData.isDecorative = true;
      sceneState.rivalTablePropsGroup = rivalProps;

      root.add(clockTower, marketStalls, steamPoints, serviceBell, rivalProps);
      buildMarketInteractiveZones(THREE, root, boardHeight, boardCenterZ);
      scene.add(root);
      sceneState.rootGroup = root;

      if (sceneState.lastRivalsList && sceneState.lastRivalsList.length) {
        syncRivalTableProps(sceneState.lastRivalsList);
      }

      // Cancel camera tween if user begins dragging manually & keep 3D badges synced on camera move
      if (controls && typeof controls.addEventListener === 'function') {
        controls.addEventListener('start', () => { sceneState.peekTweenId++; });
        controls.addEventListener('change', scheduleBadgeProjection);
      }

      setupCardHoverHighlight(ctx);
      startAmbient3DLoop();
    } else {
      // If enhanceScene is re-invoked with newly provided refs, ensure upgrades apply cleanly
      upgradeCollectorBoard(ctx, refs, sceneState.rootGroup, boardHeight, boardCenterZ);
      upgradeHeirloomProps(ctx, refs);
    }

    // Ensure every color CanvasTexture in the scene uses true sRGB encoding
    ensureSceneColorTexturesSRGB(ctx, true);

    if (ctx.playerDial) {
      sceneState.playerDial = ctx.playerDial;
      hidePlayerDialCompletely(sceneState.playerDial);
    }
    syncServiceBellVisibility();

    if (ctx.markets && !sceneState.interactiveCtx) {
      sceneState.interactiveCtx = { markets: ctx.markets };
    } else if (ctx.markets && sceneState.interactiveCtx && !sceneState.interactiveCtx.markets) {
      sceneState.interactiveCtx.markets = ctx.markets;
    }

    // Upgrade any initial Chef Standees supplied in ctx.standees
    if (ctx.standees) {
      if (Array.isArray(ctx.standees)) {
        ctx.standees.forEach(entry => {
          if (entry && entry.standee) {
            upgradeChefStandee(entry.standee, entry.chefId || entry.id, entry.name, entry.emoji, entry.colorHex);
          }
        });
      } else if (typeof ctx.standees === 'object') {
        const ids = typeof ctx.getChefIds === 'function'
          ? ctx.getChefIds()
          : Object.keys(ctx.standees);
        (Array.isArray(ids) ? ids : Object.keys(ctx.standees)).forEach(id => {
          const st = ctx.standees[id];
          if (st) {
            const meta = CHEF_FALLBACK_META[id] || {};
            upgradeChefStandee(st, id, meta.name || id, meta.avatar || '👨‍🍳', meta.colorHex || '#f59e0b');
          }
        });
      }
    }

    syncBoardOverlays();
    if (requestRender) requestRender(4);

    return {
      rootGroup: sceneState.rootGroup,
      upgradeChefStandee,
      setInteractiveContext,
      syncBoardOverlays,
      syncRivalTableProps,
      setActiveMarketTilt,
      focusStage,
      ringServiceBell,
      setPeekMode,
      togglePeekMode,
      isPeekMode,
    };
  }

  // ==========================================
  // 4. PUBLIC API EXPORT
  // ==========================================
  global.VdbAAA = {
    __loaded: true,
    version: '2.0.0',
    enhanceScene,
    upgradeChefStandee,
    setInteractiveContext,
    syncBoardOverlays,
    syncRivalTableProps,
    setActiveMarketTilt,
    focusStage,
    ringServiceBell,
    setPeekMode,
    togglePeekMode,
    isPeekMode,
    setReducedMotion(flag) {
      reducedMotionOverride = typeof flag === 'boolean' ? flag : null;
      if (sceneState.steamPoints) {
        sceneState.steamPoints.visible = !prefersReducedMotion();
        if (sceneState.ctx && sceneState.ctx.requestRender) sceneState.ctx.requestRender(2);
      }
    },
    vfx: vfxAPI,
    audio: audioAPI,
  };
})(typeof window !== 'undefined' ? window : globalThis);
