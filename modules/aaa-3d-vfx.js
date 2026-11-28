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

  function makeTex(THREE, drawFn, w, h) {
    const c = document.createElement('canvas');
    c.width = w || 256;
    c.height = h || 256;
    const ctx = c.getContext('2d');
    if (ctx) drawFn(ctx, c.width, c.height);
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    return tex;
  }

  function buildClockFaceTexture(THREE) {
    return makeTex(THREE, (ctx, w, h) => {
      const cx = w / 2, cy = h / 2, r = w * 0.44;
      // Background bezel
      ctx.fillStyle = '#c89b3c';
      ctx.fillRect(0, 0, w, h);

      // Outer gold rim
      const bezelGrad = ctx.createRadialGradient(cx, cy, r * 0.78, cx, cy, r * 1.08);
      bezelGrad.addColorStop(0, '#fde68a');
      bezelGrad.addColorStop(0.65, '#b45309');
      bezelGrad.addColorStop(1, '#78350f');
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.06, 0, Math.PI * 2);
      ctx.fillStyle = bezelGrad;
      ctx.fill();

      // Warm ivory dial face
      const faceGrad = ctx.createRadialGradient(cx, cy - r * 0.15, r * 0.1, cx, cy, r * 0.96);
      faceGrad.addColorStop(0, '#fffdf5');
      faceGrad.addColorStop(0.85, '#fef3c7');
      faceGrad.addColorStop(1, '#e7cf96');
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.93, 0, Math.PI * 2);
      ctx.fillStyle = faceGrad;
      ctx.fill();

      // Inner decorative ring
      ctx.strokeStyle = '#92400e';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.84, 0, Math.PI * 2);
      ctx.stroke();

      // 12 hour markers
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
        const isCardinal = i % 3 === 0;
        const rIn = r * (isCardinal ? 0.62 : 0.70);
        const rOut = r * 0.81;
        ctx.strokeStyle = isCardinal ? '#7c2d12' : '#44403c';
        ctx.lineWidth = isCardinal ? 6 : 3.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * rIn, cy + Math.sin(a) * rIn);
        ctx.lineTo(cx + Math.cos(a) * rOut, cy + Math.sin(a) * rOut);
        ctx.stroke();
      }

      // Iconic 10:10 clock hands (bold dark bronze for readability from overview)
      ctx.strokeStyle = '#18100a';
      ctx.lineCap = 'round';
      // Hour hand (10)
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx - r * 0.42, cy - r * 0.26);
      ctx.stroke();
      // Minute hand (2)
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + r * 0.58, cy - r * 0.31);
      ctx.stroke();

      // Brass center boss
      ctx.beginPath();
      ctx.arc(cx, cy, 8, 0, Math.PI * 2);
      ctx.fillStyle = '#b45309';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#fef08a';
      ctx.fill();
    }, 256, 256);
  }

  function buildBenThanhFacadeTexture(THREE) {
    return makeTex(THREE, (ctx, w, h) => {
      // Saigon heritage cream/ochre plaster wall
      ctx.fillStyle = '#f3dca8';
      ctx.fillRect(0, 0, w, h);

      // Subtle masonry horizontal grooves
      ctx.strokeStyle = 'rgba(146, 64, 14, 0.16)';
      ctx.lineWidth = 2;
      for (let y = 18; y < h; y += 22) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // Base dado band
      ctx.fillStyle = '#d6b272';
      ctx.fillRect(0, h - 28, w, 28);

      // Central grand dark arched gateway
      const archW = 112, archH = 118;
      const ax = (w - archW) / 2;
      const ay = h - archH;
      ctx.fillStyle = '#451a03';
      ctx.beginPath();
      ctx.moveTo(ax, h);
      ctx.lineTo(ax, ay + archW / 2);
      ctx.arc(w / 2, ay + archW / 2, archW / 2, Math.PI, 0);
      ctx.lineTo(ax + archW, h);
      ctx.closePath();
      ctx.fill();

      // Warm golden glow inside arch
      const innerGlow = ctx.createRadialGradient(w / 2, h - 25, 8, w / 2, h - 42, 62);
      innerGlow.addColorStop(0, 'rgba(253, 224, 71, 0.72)');
      innerGlow.addColorStop(0.6, 'rgba(245, 158, 11, 0.32)');
      innerGlow.addColorStop(1, 'rgba(69, 26, 3, 0)');
      ctx.fillStyle = innerGlow;
      ctx.fillRect(ax, ay, archW, archH);

      // Arch trim
      ctx.strokeStyle = '#b45309';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(w / 2, ay + archW / 2, archW / 2 + 2, Math.PI, 0);
      ctx.stroke();

      // Side arched colonial louvered windows
      [96, w - 96].forEach(wx => {
        ctx.fillStyle = '#14532d';
        ctx.beginPath();
        ctx.arc(wx, h - 76, 26, Math.PI, 0);
        ctx.lineTo(wx + 26, h - 28);
        ctx.lineTo(wx - 26, h - 28);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#fef3c7';
        ctx.lineWidth = 4;
        ctx.stroke();
      });

      // Iconic "CHỢ BẾN THÀNH" crimson & gold signboard above arch
      drawRoundRect(ctx, w / 2 - 140, 12, 280, 44, 8);
      ctx.fillStyle = '#991b1b';
      ctx.fill();
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.fillStyle = '#fef08a';
      ctx.font = '900 24px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      fitCanvasText(ctx, 'CHỢ BẾN THÀNH', w / 2, 35, 256);
    }, 512, 192);
  }

  function buildRoofTileTexture(THREE) {
    return makeTex(THREE, (ctx, w, h) => {
      ctx.fillStyle = '#b83721';
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
          ctx.fillStyle = (r + c) % 2 === 0 ? '#c9442b' : '#a8301b';
          ctx.beginPath();
          ctx.arc(x + rw * 0.5, y + rh * 0.6, rw * 0.48, 0, Math.PI);
          ctx.fill();
          ctx.strokeStyle = 'rgba(69, 14, 6, 0.38)';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
    }, 256, 256);
  }

  function buildBenThanhClockTower(THREE, boardHeight, boardCenterZ) {
    const group = new THREE.Group();
    group.name = 'VdbBenThanhClockTower';
    group.userData.isDecorative = true;

    const creamMat = new THREE.MeshStandardMaterial({ color: 0xe2bc72, roughness: 0.68, metalness: 0.05 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0xb88234, roughness: 0.46, metalness: 0.22 });
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.26, metalness: 0.80 });
    const roofTex = buildRoofTileTexture(THREE);
    roofTex.wrapS = THREE.RepeatWrapping;
    roofTex.wrapT = THREE.RepeatWrapping;
    roofTex.repeat.set(2, 2);
    const roofMat = new THREE.MeshStandardMaterial({ map: roofTex, color: 0xd9664c, roughness: 0.64, metalness: 0.06 });
    const facadeTex = buildBenThanhFacadeTexture(THREE);
    const facadeMat = new THREE.MeshStandardMaterial({ map: facadeTex, color: 0xebd7b2, roughness: 0.62 });
    const clockTex = buildClockFaceTexture(THREE);
    const clockMat = new THREE.MeshStandardMaterial({
      map: clockTex,
      roughness: 0.38,
      emissive: new THREE.Color(0xffd780),
      emissiveMap: clockTex,
      emissiveIntensity: 0.14,
    });

    // Stepped heritage stone plinth
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.16, 1.72), trimMat);
    plinth.position.y = 0.08;
    plinth.receiveShadow = true;
    plinth.castShadow = true;
    group.add(plinth);

    // Main market hall horizontal body (front & back feature Ben Thanh facade)
    const hallMats = [creamMat, creamMat, creamMat, creamMat, facadeMat, facadeMat];
    const hall = new THREE.Mesh(new THREE.BoxGeometry(3.25, 0.96, 1.32), hallMats);
    hall.position.y = 0.16 + 0.48;
    hall.castShadow = true;
    hall.receiveShadow = true;
    group.add(hall);

    // Side wing terracotta pitched roofs flanking the central tower
    [-1.08, 1.08].forEach(xOff => {
      const wingRoof = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.22, 1.48), roofMat);
      wingRoof.position.set(xOff, 1.18, 0);
      wingRoof.castShadow = true;
      group.add(wingRoof);

      const ridge = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.08, 0.14), goldMat);
      ridge.position.set(xOff, 1.31, 0);
      group.add(ridge);
    });

    // Central clock tower lower & upper shaft
    const towerLower = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.92, 1.16), creamMat);
    towerLower.position.y = 1.56;
    towerLower.castShadow = true;
    group.add(towerLower);

    // Decorative cornice band between lower & belfry
    const cornice = new THREE.Mesh(new THREE.BoxGeometry(1.30, 0.12, 1.30), trimMat);
    cornice.position.y = 2.04;
    cornice.castShadow = true;
    group.add(cornice);

    // Belfry cube with 4 crisp CanvasTexture clock faces (+X, -X, +Z, -Z)
    const belfryMats = [clockMat, clockMat, trimMat, trimMat, clockMat, clockMat];
    const belfry = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.92, 1.06), belfryMats);
    belfry.position.y = 2.54;
    belfry.castShadow = true;
    group.add(belfry);

    // Corner gold pilasters on belfry
    const pilasterGeo = new THREE.BoxGeometry(0.11, 0.96, 0.11);
    [[-0.51, -0.51], [0.51, -0.51], [-0.51, 0.51], [0.51, 0.51]].forEach(([px, pz]) => {
      const p = new THREE.Mesh(pilasterGeo, trimMat);
      p.position.set(px, 2.54, pz);
      group.add(p);
    });

    // Upper eave rim
    const topEave = new THREE.Mesh(new THREE.BoxGeometry(1.28, 0.10, 1.28), roofMat);
    topEave.position.y = 3.04;
    group.add(topEave);

    // Iconic pyramidal terracotta clock tower roof (height keeps total tip ~3.85 above board)
    const pyrRoof = new THREE.Mesh(new THREE.ConeGeometry(0.92, 0.68, 4), roofMat);
    pyrRoof.rotation.y = Math.PI / 4;
    pyrRoof.position.y = 3.42;
    pyrRoof.castShadow = true;
    group.add(pyrRoof);

    // Golden finial orb & spire
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), goldMat);
    orb.position.y = 3.78;
    group.add(orb);
    const spire = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.28, 8), goldMat);
    spire.position.y = 3.96;
    group.add(spire);

    // 4 Warm glowing Hội An / Tết lantern ornaments hanging on portico & side eaves
    const lanternBodyGeo = new THREE.SphereGeometry(0.13, 10, 8);
    const lanternCapGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.05, 8);
    const redLanternMat = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      emissive: new THREE.Color(0xff5a1f),
      emissiveIntensity: 0.95,
      roughness: 0.3,
    });
    const amberLanternMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: new THREE.Color(0xfbbf24),
      emissiveIntensity: 0.9,
      roughness: 0.3,
    });

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
      const topC = new THREE.Mesh(lanternCapGeo, goldMat);
      topC.position.y = 0.16;
      const botC = new THREE.Mesh(lanternCapGeo, goldMat);
      botC.position.y = -0.16;
      lGroup.add(body, topC, botC);
      group.add(lGroup);
    });

    // Warm golden PointLight bathing The Island (no expensive shadow map, balanced so stone stays crisp)
    const warmLight = new THREE.PointLight(0xffb44c, 0.85, 13, 1.85);
    warmLight.position.set(0, 2.35, 1.25);
    warmLight.castShadow = false;
    group.add(warmLight);
    sceneState.clockPointLight = warmLight;

    // Position cleanly at north center of The Island (never blocks standees, garbage bag, or action deck)
    group.position.set(0, boardHeight, boardCenterZ - 3.6);
    return group;
  }

  function buildAwningStripeTexture(THREE, colorHex, stripeHex) {
    return makeTex(THREE, (ctx, w, h) => {
      const stripes = 8;
      const sw = w / stripes;
      for (let i = 0; i < stripes; i++) {
        ctx.fillStyle = i % 2 === 0 ? colorHex : (stripeHex || '#fef3c7');
        ctx.fillRect(i * sw, 0, sw + 1, h);
      }
      // Subtle top-to-bottom fabric shading
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, 'rgba(255,255,255,0.16)');
      grad.addColorStop(0.78, 'rgba(0,0,0,0.06)');
      grad.addColorStop(1, 'rgba(0,0,0,0.28)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      // Gold scalloped edge band at bottom
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(0, h - 12, w, 12);
    }, 256, 128);
  }

  function buildStallSignTexture(THREE, title, colorHex) {
    return makeTex(THREE, (ctx, w, h) => {
      ctx.fillStyle = '#1c120c';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = colorHex;
      ctx.lineWidth = 8;
      ctx.strokeRect(4, 4, w - 8, h - 8);
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2;
      ctx.strokeRect(11, 11, w - 22, h - 22);
      ctx.fillStyle = '#fef3c7';
      ctx.font = '900 28px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      fitCanvasText(ctx, title, w / 2, h / 2 + 1, w - 34);
    }, 320, 72);
  }

  function buildMarketStalls(THREE, boardHeight, boardCenterZ) {
    const stallsGroup = new THREE.Group();
    stallsGroup.name = 'VdbMarketStalls';
    stallsGroup.userData.isDecorative = true;

    const woodMat = new THREE.MeshStandardMaterial({ color: 0x5c2e16, roughness: 0.72 });
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.28, metalness: 0.78 });
    const postGeo = new THREE.CylinderGeometry(0.068, 0.082, 1.62, 8);
    const collarGeo = new THREE.CylinderGeometry(0.11, 0.12, 0.10, 8);
    const lanternGeo = new THREE.SphereGeometry(0.115, 10, 8);

    // 5 full outer-edge market stalls with striped awnings + hanging glowing lanterns
    const fullStalls = [
      { key: 'chop',      title: 'HÀNG THỊT',   colorHex: '#dc2626', colorNum: 0xdc2626, x: -9.2, z: boardCenterZ - 9.72, w: 7.4, rotY: 0 },
      { key: 'dairy',     title: 'HẢI SẢN',     colorHex: '#eab308', colorNum: 0xeab308, x: -0.4, z: boardCenterZ - 9.72, w: 7.1, rotY: 0 },
      { key: 'mystery',   title: 'PHỐ GIA VỊ',  colorHex: '#9333ea', colorNum: 0x9333ea, x:  8.7, z: boardCenterZ - 9.72, w: 7.1, rotY: 0 },
      { key: 'carbs',     title: 'GẠO & PHỞ',   colorHex: '#d97706', colorNum: 0xd97706, x: -13.65, z: boardCenterZ - 0.1, w: 9.4, rotY: Math.PI / 2 },
      { key: 'vegetable', title: 'RAU CỦ',      colorHex: '#16a34a', colorNum: 0x16a34a, x:  13.65, z: boardCenterZ - 0.1, w: 9.4, rotY: -Math.PI / 2 },
    ];

    fullStalls.forEach(cfg => {
      const g = new THREE.Group();
      g.position.set(cfg.x, boardHeight, cfg.z);
      g.rotation.y = cfg.rotY;

      const halfW = cfg.w / 2;
      // 3 timber posts along outer edge
      [-halfW + 0.18, 0, halfW - 0.18].forEach(px => {
        const post = new THREE.Mesh(postGeo, woodMat);
        post.position.set(px, 0.81, -0.05);
        post.castShadow = true;
        g.add(post);

        const collar = new THREE.Mesh(collarGeo, goldMat);
        collar.position.set(px, 0.05, -0.05);
        g.add(collar);
      });

      // Top tie beam
      const beam = new THREE.Mesh(new THREE.BoxGeometry(cfg.w, 0.11, 0.12), woodMat);
      beam.position.set(0, 1.56, -0.05);
      beam.castShadow = true;
      g.add(beam);

      // Compact tilted striped awning canopy extending slightly inward (+Z in local frame), clear of cards
      const awningTex = buildAwningStripeTexture(THREE, cfg.colorHex, '#fffbeb');
      const awningMat = new THREE.MeshStandardMaterial({
        map: awningTex,
        roughness: 0.62,
        side: THREE.DoubleSide,
      });
      const canopy = new THREE.Mesh(new THREE.BoxGeometry(cfg.w + 0.18, 0.06, 0.86), awningMat);
      canopy.position.set(0, 1.58, 0.28);
      canopy.rotation.x = 0.34;
      canopy.castShadow = true;
      g.add(canopy);

      // Front sign crest above beam
      const signTex = buildStallSignTexture(THREE, cfg.title, cfg.colorHex);
      const signMat = new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.4 });
      const signMesh = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.42, 0.08), [
        woodMat, woodMat, woodMat, woodMat, signMat, signMat,
      ]);
      signMesh.position.set(0, 1.94, -0.04);
      signMesh.castShadow = true;
      g.add(signMesh);

      // 2 glowing color-tinted Vietnamese lanterns tucked under the awning corners
      const lMat = new THREE.MeshStandardMaterial({
        color: cfg.colorNum,
        emissive: new THREE.Color(cfg.colorNum),
        emissiveIntensity: 0.85,
        roughness: 0.3,
      });
      [-halfW + 0.72, halfW - 0.72].forEach(lx => {
        const orb = new THREE.Mesh(lanternGeo, lMat);
        orb.scale.set(1.0, 1.25, 1.0);
        orb.position.set(lx, 1.24, 0.36);
        g.add(orb);
      });

      stallsGroup.add(g);
    });

    // 6th market: `fruit` (South edge) — open low festive corner lantern pillars + slim lantern garland
    // Keeps camera sightline & card raycasting 100% unobstructed from south view!
    const fruitGroup = new THREE.Group();
    fruitGroup.position.set(-0.4, boardHeight, boardCenterZ + 9.72);
    const fruitColorHex = '#0284c7';
    const fruitColorNum = 0x0284c7;
    const fruitAwningTex = buildAwningStripeTexture(THREE, fruitColorHex, '#f0f9ff');
    const fruitAwningMat = new THREE.MeshStandardMaterial({ map: fruitAwningTex, roughness: 0.6, side: THREE.DoubleSide });
    const fruitLanternMat = new THREE.MeshStandardMaterial({
      color: fruitColorNum,
      emissive: new THREE.Color(0x38bdf8),
      emissiveIntensity: 0.9,
      roughness: 0.28,
    });
    const warmLanternMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: new THREE.Color(0xfbbf24),
      emissiveIntensity: 0.9,
      roughness: 0.28,
    });

    const fruitHalfW = 7.75;
    [-fruitHalfW, fruitHalfW].forEach((px, idx) => {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.095, 1.38, 8), woodMat);
      post.position.set(px, 0.69, 0);
      post.castShadow = true;
      fruitGroup.add(post);

      const collar = new THREE.Mesh(collarGeo, goldMat);
      collar.position.set(px, 0.05, 0);
      fruitGroup.add(collar);

      // Compact pagoda cap awning on each corner pillar
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.56, 0.34, 4), fruitAwningMat);
      cap.rotation.y = Math.PI / 4;
      cap.position.set(px, 1.50, 0);
      cap.castShadow = true;
      fruitGroup.add(cap);

      // Hanging corner lantern
      const lantern = new THREE.Mesh(lanternGeo, idx === 0 ? fruitLanternMat : warmLanternMat);
      lantern.scale.set(1.0, 1.25, 1.0);
      lantern.position.set(px + (idx === 0 ? 0.28 : -0.28), 1.15, 0);
      fruitGroup.add(lantern);
    });

    // Low decorative timber curb rail along south outer edge + subtle glowing lanterns
    const lowRail = new THREE.Mesh(new THREE.BoxGeometry(fruitHalfW * 2, 0.14, 0.14), woodMat);
    lowRail.position.set(0, 0.12, 0.08);
    fruitGroup.add(lowRail);

    const fruitSignTex = buildStallSignTexture(THREE, 'HOA QUẢ MIỀN TÂY', fruitColorHex);
    const fruitSignMat = new THREE.MeshStandardMaterial({ map: fruitSignTex, roughness: 0.42 });
    const fruitSign = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.36, 0.08), [
      woodMat, woodMat, woodMat, woodMat, fruitSignMat, fruitSignMat,
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
        sceneState.clockPointLight.intensity = 0.85 + Math.sin(t * 2.1) * 0.08;
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
      // Crisp ivory acrylic plate background
      ctx.fillStyle = '#fffdf7';
      drawRoundRect(ctx, 6, 6, w - 12, h - 12, 26);
      ctx.fill();

      // Portrait frame clipped neatly
      const pad = 16;
      const frameW = w - pad * 2;
      const frameH = h - 86;
      ctx.save();
      drawRoundRect(ctx, pad, pad, frameW, frameH, 18);
      ctx.clip();

      // Cover-crop portrait preserving aspect ratio
      const iw = img.naturalWidth || img.width || frameW;
      const ih = img.naturalHeight || img.height || frameH;
      const scale = Math.max(frameW / iw, frameH / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      const dx = pad + (frameW - dw) / 2;
      const dy = pad + (frameH - dh) * 0.28; // bias slightly upward to keep face centered
      ctx.drawImage(img, dx, dy, dw, dh);

      // Subtle warm bottom vignette into nameplate
      const vig = ctx.createLinearGradient(0, pad + frameH - 44, 0, pad + frameH);
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, 'rgba(15,10,8,0.45)');
      ctx.fillStyle = vig;
      ctx.fillRect(pad, pad + frameH - 44, frameW, 44);
      ctx.restore();

      // Crisp team-color nameplate ribbon at bottom
      const ribY = h - 68;
      drawRoundRect(ctx, 14, ribY, w - 28, 52, 12);
      ctx.fillStyle = colorHex || '#d97706';
      ctx.fill();
      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = '900 24px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      fitCanvasText(ctx, String(name || '').toUpperCase(), w / 2, ribY + 27, w - 48);

      // Outer glossy team-color frame border
      drawRoundRect(ctx, 8, 8, w - 16, h - 16, 24);
      ctx.strokeStyle = colorHex || '#d97706';
      ctx.lineWidth = 10;
      ctx.stroke();

      // Inner gold hairline
      drawRoundRect(ctx, 15, 15, w - 30, h - 30, 18);
      ctx.strokeStyle = 'rgba(253, 224, 71, 0.75)';
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

    // 1. Add crisp metallic gold/team-colored ring base (once per standee)
    if (!standee.userData._aaaRingBase) {
      standee.userData._aaaRingBase = true;
      const goldMat = new THREE.MeshStandardMaterial({
        color: 0xfbbf24,
        metalness: 0.86,
        roughness: 0.22,
      });
      const teamColorNum = new THREE.Color(finalColor);
      const teamTrimMat = new THREE.MeshStandardMaterial({
        color: teamColorNum,
        metalness: 0.45,
        roughness: 0.28,
      });

      const topRing = new THREE.Mesh(new THREE.TorusGeometry(0.88, 0.055, 8, 28), goldMat);
      topRing.rotation.x = Math.PI / 2;
      topRing.position.y = 0.30;
      standee.add(topRing);

      const botRing = new THREE.Mesh(new THREE.TorusGeometry(0.97, 0.045, 8, 28), goldMat);
      botRing.rotation.x = Math.PI / 2;
      botRing.position.y = 0.045;
      standee.add(botRing);

      // Sleek slotted acrylic clamp bar at base of plate
      const clampBar = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.14, 0.22), teamTrimMat);
      clampBar.position.y = 0.34;
      standee.add(clampBar);

      if (sceneState.ctx && sceneState.ctx.requestRender) {
        sceneState.ctx.requestRender(2);
      }
    }

    // 2. Asynchronously upgrade the acrylic standee plate with chef portrait WebP
    if (!chefId || standee.userData._aaaPortraitChef === chefId) return;
    standee.userData._aaaPortraitChef = chefId;

    loadChefPortrait(chefId).then(img => {
      if (!img || standee.userData._aaaPortraitChef !== chefId) return;
      // Locate the vertical BoxGeometry acrylic plate (children[1] in createAcrylicChefStandee)
      const plate = standee.children.find(ch =>
        ch && ch.isMesh && ch.geometry && ch.geometry.type === 'BoxGeometry'
        && ch.position && ch.position.y > 0.8
      );
      if (!plate) return;

      const tex = buildPortraitStandeeTexture(THREE, img, finalName, finalColor);
      const edgeMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(finalColor),
        metalness: 0.35,
        roughness: 0.25,
      });
      const faceMat = new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.30,
        metalness: 0.06,
      });

      // Dispose previous texture cleanly if single material
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
          font: 900 11px/1.15 system-ui, -apple-system, sans-serif;
          letter-spacing: 0.02em;
          white-space: nowrap;
          pointer-events: none;
          box-shadow: 0 6px 18px rgba(0, 0, 0, 0.65);
          will-change: transform;
        }
        .vdb-3d-badge.is-need {
          background: linear-gradient(135deg, rgba(180, 83, 9, 0.94), rgba(146, 64, 14, 0.94));
          color: #fef08a;
          border: 1.5px solid #fbbf24;
          animation: vdbBadgePulse 1.8s ease-in-out infinite;
        }
        .vdb-3d-badge.is-selected {
          background: linear-gradient(135deg, #f59e0b, #eab308);
          color: #1c1917;
          border: 1.5px solid #fef9c3;
          box-shadow: 0 0 18px rgba(251, 191, 36, 0.72), 0 6px 16px rgba(0, 0, 0, 0.6);
        }
        .vdb-3d-badge.is-active {
          background: linear-gradient(135deg, rgba(5, 150, 105, 0.96), rgba(13, 148, 136, 0.96));
          color: #fefce8;
          border: 1.5px solid #6ee7b7;
          box-shadow: 0 0 16px rgba(16, 185, 129, 0.65), 0 6px 16px rgba(0, 0, 0, 0.6);
        }
        .vdb-3d-badge.is-closed {
          background: rgba(153, 27, 27, 0.96);
          color: #fee2e2;
          border: 1.5px solid #f87171;
          padding: 5px 14px;
          font-size: 12px;
        }
        /* Desktop Board-First Clickable 3D Market Pills (Phase 1) */
        .vdb-3d-market-pill {
          position: absolute;
          left: 0;
          top: 0;
          display: none;
          align-items: center;
          gap: 5px;
          padding: 5px 10px;
          border-radius: 999px;
          border: 1.5px solid var(--pill-accent, rgba(251, 191, 36, 0.65));
          background: rgba(16, 13, 11, 0.92);
          color: #f5f5f4;
          font: 800 11.5px/1.15 system-ui, -apple-system, sans-serif;
          white-space: nowrap;
          pointer-events: auto;
          cursor: pointer;
          box-shadow: 0 6px 18px rgba(0, 0, 0, 0.68), inset 0 1px 0 rgba(255,255,255,0.08);
          transition: filter 0.14s ease, box-shadow 0.14s ease, border-color 0.14s ease;
          will-change: transform;
        }
        .vdb-3d-market-pill:hover {
          filter: brightness(1.14);
          border-color: #fde047;
          box-shadow: 0 0 16px rgba(251, 191, 36, 0.52), 0 8px 20px rgba(0, 0, 0, 0.72);
        }
        .vdb-3d-market-pill.is-selected {
          background: linear-gradient(135deg, #f59e0b, #eab308);
          color: #18100a;
          border-color: #fef9c3;
          box-shadow: 0 0 22px rgba(251, 191, 36, 0.8), 0 8px 20px rgba(0, 0, 0, 0.65);
        }
        .vdb-3d-market-pill .vdb-mp-cost {
          font-weight: 800;
          opacity: 0.85;
          font-size: 10.5px;
        }
        .vdb-3d-market-pill .vdb-mp-need {
          padding: 1px 6px;
          border-radius: 999px;
          background: rgba(245, 158, 11, 0.28);
          border: 1px solid rgba(253, 224, 71, 0.75);
          color: #fef08a;
          font-weight: 900;
          font-size: 10.5px;
        }
        .vdb-3d-market-pill.is-selected .vdb-mp-need {
          background: rgba(24, 16, 10, 0.85);
          color: #fde047;
          border-color: rgba(24, 16, 10, 0.6);
        }
        /* Desktop Board-First Phase 2 Card & Shelf Clickable Pills */
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
          border: 1.5px solid rgba(251, 191, 36, 0.62);
          background: rgba(15, 12, 10, 0.94);
          color: #fafaf9;
          font: 700 11px/1.2 system-ui, -apple-system, sans-serif;
          text-align: center;
          pointer-events: auto;
          cursor: pointer;
          box-shadow: 0 10px 24px rgba(0, 0, 0, 0.72);
          transition: filter 0.14s ease, border-color 0.14s ease, box-shadow 0.14s ease;
          will-change: transform;
        }
        .vdb-3d-card-pill:hover:not(:disabled) {
          filter: brightness(1.12);
          border-color: #fde047;
          box-shadow: 0 0 18px rgba(251, 191, 36, 0.5), 0 10px 24px rgba(0, 0, 0, 0.75);
        }
        .vdb-3d-card-pill:disabled {
          opacity: 0.62;
          cursor: default;
        }
        .vdb-3d-card-pill.is-needed {
          border-color: #fde047;
          box-shadow: 0 0 18px rgba(250, 204, 21, 0.42), 0 10px 24px rgba(0, 0, 0, 0.72);
        }
        .vdb-3d-card-pill.is-claimed {
          border-style: dashed;
          border-color: #fb923c;
        }
        .vdb-3d-card-pill.is-owned {
          border-color: #34d399;
          background: rgba(6, 54, 40, 0.94);
          opacity: 0.92;
        }
        .vdb-3d-card-pill.is-shelf {
          border-color: #818cf8;
          background: rgba(23, 20, 56, 0.94);
        }
        .vdb-3d-card-pill .vdb-cp-name {
          font-weight: 800;
          font-size: 11px;
          color: #fef3c7;
          max-width: 146px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .vdb-3d-card-pill .vdb-cp-meta {
          font-size: 10px;
          font-weight: 700;
          color: #fde047;
          max-width: 146px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .vdb-3d-card-pill .vdb-cp-owner {
          font-size: 10px;
          color: #d6d3d1;
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
          background: linear-gradient(135deg, #f59e0b, #d97706);
          color: #18100a;
        }
        .vdb-3d-card-pill.is-claimed .vdb-cp-cta {
          background: rgba(234, 88, 12, 0.25);
          border: 1px dashed #fb923c;
          color: #fed7aa;
        }
        .vdb-3d-card-pill.is-owned .vdb-cp-cta {
          background: rgba(16, 185, 129, 0.25);
          color: #6ee7b7;
        }
        .vdb-3d-card-pill.is-empty .vdb-cp-cta,
        .vdb-3d-card-pill.is-sold .vdb-cp-cta {
          background: rgba(68, 64, 60, 0.6);
          color: #a8a29e;
        }
        .vdb-3d-card-pill.is-shelf .vdb-cp-cta {
          background: linear-gradient(135deg, #6366f1, #4f46e5);
          color: #eef2ff;
        }
        /* Desktop Board-First Phase 2 Island Service Pills */
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
          border: 1.5px solid var(--isl-border, rgba(251, 191, 36, 0.75));
          background: var(--isl-bg, rgba(16, 13, 11, 0.94));
          color: #fefce8;
          font: 800 11.5px/1.15 system-ui, -apple-system, sans-serif;
          white-space: nowrap;
          cursor: pointer;
          box-shadow: 0 8px 22px rgba(0, 0, 0, 0.72);
          transition: filter 0.14s ease, border-color 0.14s ease;
        }
        .vdb-3d-island-btn:hover:not(:disabled) {
          filter: brightness(1.16);
          border-color: #fde047;
        }
        .vdb-3d-island-btn:disabled {
          opacity: 0.48;
          cursor: not-allowed;
        }
        .vdb-3d-island-btn.is-secondary {
          padding: 6px 9px;
          background: rgba(153, 27, 27, 0.92);
          border-color: #fca5a5;
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
          background: rgba(15, 12, 10, 0.95);
          border: 1.5px solid rgba(251, 191, 36, 0.78);
          box-shadow: 0 14px 32px rgba(0, 0, 0, 0.75), 0 0 16px rgba(245, 158, 11, 0.22);
          color: #f5f5f4;
          font: 600 12px/1.35 system-ui, -apple-system, sans-serif;
        }
        #vdb-3d-tooltip .vdb-tt-title {
          font-weight: 900;
          font-size: 13px;
          color: #fde68a;
          margin-bottom: 2px;
        }
        #vdb-3d-tooltip .vdb-tt-sub {
          font-size: 11px;
          color: #d6d3d1;
        }
        #vdb-3d-tooltip .vdb-tt-hint {
          margin-top: 4px;
          padding: 2px 7px;
          border-radius: 6px;
          background: rgba(245, 158, 11, 0.22);
          border: 1px solid rgba(251, 191, 36, 0.55);
          color: #fef08a;
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
        @media (max-width: 640px) {
          .vdb-3d-badge { font-size: 10px; padding: 2px 7px; }
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
      color: 0x3b180b,
      roughness: 0.34,
      metalness: 0.14,
    });
    const brassDomeMat = new THREE.MeshStandardMaterial({
      color: 0xf6c94c,
      metalness: 0.88,
      roughness: 0.18,
      emissive: new THREE.Color(0x452804),
      emissiveIntensity: 0.12,
    });
    const brightGoldMat = new THREE.MeshStandardMaterial({
      color: 0xfef08a,
      metalness: 0.92,
      roughness: 0.14,
      emissive: new THREE.Color(0x523206),
      emissiveIntensity: 0.10,
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
      const vw = HAS_DOM ? window.innerWidth : 1280;
      // Zero Double-Bell Rule: hide 3D bell on Desktop (>=768px) unless in Peek 3D mode; show on Mobile (<768px) or Peek
      const shouldShow = sceneState.peekMode || vw < 768;
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

    const woodPadMat = new THREE.MeshStandardMaterial({ color: 0x24140b, roughness: 0.72 });
    const creamCardMat = new THREE.MeshStandardMaterial({ color: 0xfff8e6, roughness: 0.45 });
    const purpleCardMat = new THREE.MeshStandardMaterial({ color: 0x5b21b6, roughness: 0.38, metalness: 0.18 });
    const goldEdgeMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.25, metalness: 0.78 });

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
    for (let pass = 0; pass < 6; pass++) {
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i];
          const b = items[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const ox = (a.w + b.w) * 0.5 + gap - Math.abs(dx);
          const oy = (a.h + b.h) * 0.5 + gap - Math.abs(dy);
          if (ox > 0 && oy > 0) {
            if (oy <= ox) {
              const s = dy >= 0 ? 1 : -1;
              a.y -= s * oy * 0.5;
              b.y += s * oy * 0.5;
            } else {
              const s = dx >= 0 ? 1 : -1;
              a.x -= s * ox * 0.5;
              b.x += s * ox * 0.5;
            }
          }
        }
      }
      items.forEach(it => {
        it.x = clamp(it.x, minX + it.w * 0.5, Math.max(minX + it.w * 0.5, maxX - it.w * 0.5));
        it.y = clamp(it.y, minY + it.h * 0.5, Math.max(minY + it.h * 0.5, maxY - it.h * 0.5));
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
    const minY = stage.topPx + 8;
    const maxY = stage.bottomPx - 10;
    let minX = stage.leftPx + 10;
    let maxX = stage.rightPx - 10;
    if (maxX < minX + 180) {
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
      hdr.textContent = `📍 ${meta.emoji} ${meta.name}`;
      hdr.style.display = 'inline-flex';
      const hdrRect0 = hdr.getBoundingClientRect();
      const hdrH = Math.ceil(hdrRect0.height) || 24;
      const hdrW = Math.ceil(hdrRect0.width) || 160;
      proj.set(zone.meta.cx, bh + 2.25, zone.meta.cz - (isVertical ? 5.2 : 1.5)).project(camera);
      const minHx = minX + hdrW * 0.5;
      const maxHx = Math.max(minHx, maxX - hdrW * 0.5);
      const hx = clamp((proj.x * 0.5 + 0.5) * stage.vw, minHx, maxHx);
      const minHy = stage.topPx + hdrH + 6;
      const maxHy = Math.max(minHy, maxY - 172);
      const hy = clamp((-proj.y * 0.5 + 0.5) * stage.vh, minHy, maxHy);
      hdr.style.transform = `translate3d(${Math.round(hx)}px, ${Math.round(hy)}px, 0) translate(-50%, -100%)`;
      const hdrBottom = Math.ceil(hdr.getBoundingClientRect().bottom || hy);
      cardsMinY = Math.max(minY, hdrBottom + 10);
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
      const gap = 10;
      const availH = Math.max(0, maxY - cardsMinY);
      const availW = Math.max(0, maxX - minX);

      if (isVertical) {
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

    const specs = [
      {
        id: 'garbage',
        pos: new THREE.Vector3(-4.6, bh + 2.35, bcz - 0.8),
        bg: 'rgba(127, 29, 29, 0.94)',
        border: '#f87171',
        label: `🧹 Đổ Rác ($${garbageCost} · ${garbage} túi)`,
        disabled: garbage <= 0 || money < garbageCost,
        showSub: garbage > 1,
        subDisabled: money < garbageCost * garbage,
      },
      {
        id: 'dumpster',
        pos: new THREE.Vector3(-4.6, bh + 0.35, bcz + 2.75),
        bg: 'rgba(6, 78, 59, 0.94)',
        border: '#34d399',
        label: `♻️ Khay Bỏ ($0 · ${dumpsterCount} thẻ)`,
        disabled: dumpsterCount <= 0,
      },
      {
        id: 'upgrade',
        pos: new THREE.Vector3(0, bh + 0.85, bcz - 0.35),
        bg: 'rgba(120, 53, 15, 0.94)',
        border: '#fbbf24',
        label: `🛠️ Nâng Cấp (${upgradesCount}/4)`,
        disabled: upgradesCount >= 4,
      },
      {
        id: 'chocolate',
        pos: new THREE.Vector3(0, bh + 0.4, bcz + 2.85),
        bg: 'rgba(88, 28, 13, 0.94)',
        border: '#f59e0b',
        label: `🍫 Bán Sô-cô-la (+$${chocVal}${chocCount > 0 ? ' · ×' + chocCount : ''})`,
        disabled: chocCount <= 0,
      },
      {
        id: 'action',
        pos: new THREE.Vector3(4.6, bh + 1.45, bcz + 0.2),
        bg: 'rgba(88, 28, 135, 0.94)',
        border: '#c084fc',
        label: `⚡ Thẻ Hành Động ($${actionCost})`,
        disabled: money < actionCost,
      },
    ];

    const proj = new THREE.Vector3();
    const minY = stage.topPx + 24;
    const maxY = stage.bottomPx - 14;
    let minX = stage.leftPx + 10;
    let maxX = stage.rightPx - 10;
    if (maxX < minX + 180) {
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
        w: Math.ceil(r.width) || wrap.offsetWidth || 168,
        h: Math.ceil(r.height) || wrap.offsetHeight || 36,
      });
    });

    separate2DPills(placed, minX, maxX, minY, maxY, 10);
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
    if (modalOpen) {
      layer.style.display = 'none';
      hideTooltip();
      return;
    }
    layer.style.display = 'block';

    const { THREE, camera } = sceneState.ctx;
    const stage = measureOpenStage();
    const minY = stage.topPx + 22;
    const maxY = stage.bottomPx - 8;
    const phase = getPhaseSafe();
    const selectedDest = getSelectedDestSafe();
    const currentLoc = getCurrentLocationSafe();
    const rawNeeds = getRawNeedsSafe();
    const isDesktopDirect = !stage.isMobile && stage.openH >= 120;

    camera.updateMatrixWorld();
    const proj = new THREE.Vector3();

    // DESKTOP BOARD-FIRST DIRECT 3D CONTROLS (>= 1024px)
    if (isDesktopDirect) {
      // Phase 1: Clickable pills on ALL 6 Markets + The Island
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
          const accentHex = '#' + (meta.color || 0xfbbf24).toString(16).padStart(6, '0');
          const sig = `${key}|${isSel}|${meta.cost}|${need.count}|${meta.short}`;
          if (node.dataset.sig !== sig) {
            node.dataset.sig = sig;
            node.className = 'vdb-3d-market-pill' + (isSel ? ' is-selected' : '');
            node.style.setProperty('--pill-accent', accentHex);
            node._parts.labelSpan.textContent = `${isSel ? '✓ ' : ''}${meta.emoji} ${meta.short}`;
            node._parts.costSpan.textContent = key === 'island' ? '$0' : `$${meta.cost}`;
            if (need.count > 0) {
              node._parts.needSpan.textContent = `🎯 ×${need.count}`;
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
          const sx = (proj.x * 0.5 + 0.5) * stage.vw;
          const sy = (-proj.y * 0.5 + 0.5) * stage.vh;
          if (sx < 16 || sx > stage.vw - 16 || sy < minY - 12 || sy > maxY + 12) {
            node.style.display = 'none';
            return;
          }
          node.style.display = 'inline-flex';
          const nr = node.getBoundingClientRect();
          placedP1.push({
            node,
            x: sx,
            y: sy,
            w: Math.ceil(nr.width) || node.offsetWidth || 126,
            h: Math.ceil(nr.height) || node.offsetHeight || 28,
          });
        });

        let p1MinX = stage.leftPx + 10;
        let p1MaxX = stage.rightPx - 10;
        if (p1MaxX < p1MinX + 180) {
          p1MinX = 16;
          p1MaxX = stage.vw - 16;
        }
        separate2DPills(placedP1, p1MinX, p1MaxX, minY, maxY, 6);
        placedP1.forEach(it => {
          it.node.style.transform = `translate3d(${Math.round(it.x)}px, ${Math.round(it.y)}px, 0) translate(-50%, -50%)`;
        });
        return;
      }

      // Phase 2: Direct 3D Card/Shelf Pills (Regular Markets) OR 5 Island Service Pills
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

      // Phase 3 Desktop: clean uncluttered 3D board while cooking
      hideAllZoneBadges();
      hideDesktopDirectPills();
      return;
    }

    // MOBILE (< 1024px): Lightweight non-blocking indicator badges (v1.1.0 behavior)
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

    // Dynamic camera framing: analytic open-stage framing for Desktop Open-Wood Tabletop (>=768px, deckHeight < 210px)
    // and upper-stage biased framing when Desktop Mat Drawer is open or Mobile Bottom Sheet (<768px) is active!
    const upperShift = clamp(stage.ndcY, 0, 0.55);
    const openFrac = clamp(stage.openH / Math.max(1, stage.vh), 0.35, 0.92);
    const aspect = clamp(stage.vw / Math.max(1, stage.vh), 0.5, 2.5);
    const maxDist = (controls && typeof controls.maxDistance === 'number') ? (controls.maxDistance - 2.5) : 62;

    let endTarget;
    let endPos;

    if (stage.isSlimDesktop) {
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

    // Build 3D Vietnamese Tabletop Architecture once
    if (!sceneState.enhanced) {
      sceneState.enhanced = true;

      const root = new THREE.Group();
      root.name = 'VdbAAASceneRoot';
      root.userData.isDecorative = true;

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
    }

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
    version: '1.3.2',
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
