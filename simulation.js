(function () {
  const DEFAULT_DIM = 10;
  const DEFAULT_LEVELS = 50;
  const DEFAULT_STEPS = 100;
  let audioCtx = null;
  let soundEnabledCache = true;
  let autoRunHandle = null;
  let lastAlertTime = 0;

  function zeros(len) {
    return new Array(len).fill(0);
  }

  function randVec(len) {
    return Array.from({ length: len }, () => Math.random());
  }

  function sinVec(v) {
    return v.map(Math.sin);
  }

  function cosVec(v) {
    return v.map(Math.cos);
  }

  function addVec(a, b) {
    return a.map((x, i) => x + b[i]);
  }

  function subVec(a, b) {
    return a.map((x, i) => x - b[i]);
  }

  function scaleVec(v, s) {
    return v.map(x => x * s);
  }

  function blendVec(a, b, alpha) {
    const oneMinus = 1 - alpha;
    return a.map((x, i) => oneMinus * x + alpha * b[i]);
  }

  function norm(v) {
    let acc = 0;
    for (let i = 0; i < v.length; i++) {
      acc += v[i] * v[i];
    }
    return Math.sqrt(acc);
  }

  class LivingUniverse {
    constructor(dim, modelType, systemType, seed) {
      this.dim = dim || DEFAULT_DIM;
      this.modelType = modelType || "nonlinear";
      this.systemType = systemType || "isolated";
      if (!seed) {
        seed = randVec(this.dim);
      }
      this.history = [seed];
      this.levels = {};
    }

    evolve(prev, memory, level) {
      if (this.modelType === "oscillators") {
        return evolveOscillators(prev, this.systemType);
      }
      if (this.modelType === "ising") {
        return evolveIsing(prev, this.systemType);
      }
      // default: nonlinear retrocausal map
      const A = sinVec(prev);
      const B = cosVec(memory);
      const alpha = 1.0 / (1.0 + level);
      return blendVec(A, B, alpha);
    }

    step(t, maxLevel = DEFAULT_LEVELS) {
      if (t === 0) return;
      this.levels[t] = {};

      const prev = this.history[t - 1];
      const mem = t > 1 ? this.history[t - 2] : prev;

      const base_now = this.evolve(prev, mem, 0);
      this.history.push(base_now);
      this.levels[t][0] = base_now;

      for (let level = 1; level < maxLevel; level++) {
        const prev_layer = this.levels[t][level - 1];
        const mem_layer =
          t > 1 ? this.levels[t - 1][level - 1] : prev_layer;
        const state = this.evolve(prev_layer, mem_layer, level);
        this.levels[t][level] = state;
      }
    }

    run(steps = DEFAULT_STEPS, maxLevel = DEFAULT_LEVELS) {
      for (let t = 1; t < steps; t++) {
        this.step(t, maxLevel);
      }
    }

    get_state(t, level = 0) {
      if (level === 0) {
        return this.history[t];
      }
      return this.levels[t][level];
    }

    infinite_state(t) {
      const acc = zeros(this.dim);
      const levelMap = this.levels[t] || {};
      const keys = Object.keys(levelMap)
        .map(k => parseInt(k, 10))
        .sort((a, b) => a - b);
      for (const i of keys) {
        const s = levelMap[i];
        const w = 1 / (i + 1);
        for (let j = 0; j < this.dim; j++) {
          acc[j] += s[j] * w;
        }
      }
      return acc;
    }
  }

  function retro_influence(universe, t_future, t_past, strength = 0.01) {
    if (t_future >= universe.history.length || t_past >= universe.history.length) {
      return;
    }
    const future_state = universe.get_state(t_future);
    const past_state = universe.history[t_past];
    const delta = scaleVec(subVec(future_state, past_state), strength);
    universe.history[t_past] = addVec(universe.history[t_past], delta);
  }

  class Observer {
    constructor(universe, level = 0) {
      this.universe = universe;
      this.level = level;
    }
    perceive(t) {
      return this.universe.get_state(t, this.level);
    }
  }

  function fmt(x) {
    return x.toFixed(4);
  }

  function clampInt(value, min, max, fallback) {
    const n = parseInt(value, 10);
    if (Number.isNaN(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function getParameters() {
    const stepsEl = document.getElementById("param-steps");
    const levelsEl = document.getElementById("param-max-levels");
    const t0El = document.getElementById("param-t0");
    const t1El = document.getElementById("param-t1");
    const strengthEl = document.getElementById("param-strength");
    const levelEl = document.getElementById("param-level");
    const dimEl = document.getElementById("param-dim");
    const modelEl = document.getElementById("model-select");
    const systemEl = document.getElementById("system-select");
    const multiEl = document.getElementById("param-multiverse");
    const multiCountEl = document.getElementById("param-multi-count");
    const themeEl = document.getElementById("theme-select");
    const animEl = document.getElementById("toggle-anim");
    const soundEl = document.getElementById("toggle-sound");
    const autoEl = document.getElementById("auto-run");
    const alertEl = document.getElementById("alert-threshold");

    const steps = stepsEl ? clampInt(stepsEl.value, 10, 500, 120) : 120;
    const maxLevels = levelsEl ? clampInt(levelsEl.value, 5, 100, 60) : 60;
    let t0 = t0El ? clampInt(t0El.value, 0, steps - 1, 30) : 30;
    let t1 = t1El ? clampInt(t1El.value, 1, steps - 1, 90) : 90;
    if (t1 <= t0) t1 = Math.min(steps - 1, t0 + 1);
    if (t0El) t0El.value = String(t0);
    if (t1El) t1El.value = String(t1);

    const strength = strengthEl ? Number(strengthEl.value || 0.02) : 0.02;
    const obsLevel = levelEl ? clampInt(levelEl.value, 0, maxLevels - 1, 10) : 10;
    const dim = dimEl ? clampInt(dimEl.value, 2, 40, DEFAULT_DIM) : DEFAULT_DIM;
    const modelType = modelEl ? modelEl.value || "nonlinear" : "nonlinear";
    const systemType = systemEl ? systemEl.value || "isolated" : "isolated";

    const theme = themeEl ? themeEl.value || "cosmic" : "cosmic";
    const animationsEnabled = !animEl || !!animEl.checked;
    const soundEnabled = !soundEl || !!soundEl.checked;
    soundEnabledCache = soundEnabled;

    const multiverseEnabled = !!(multiEl && multiEl.checked);
    const multiverseCount = multiverseEnabled
      ? (multiCountEl ? clampInt(multiCountEl.value, 2, 40, 10) : 10)
      : 0;

    const autoRun = !!(autoEl && autoEl.checked);
    const alertThreshold =
      alertEl && alertEl.value !== "" ? Math.max(0, Number(alertEl.value)) : 0.3;

    return {
      steps,
      maxLevels,
      t0,
      t1,
      strength,
      obsLevel,
      dim,
      multiverseEnabled,
      multiverseCount,
      theme,
      animationsEnabled,
      soundEnabled,
      autoRun,
      alertThreshold,
      modelType,
      systemType,
    };
  }

  function drawStateGraph(norms, t0) {
    const canvas = document.getElementById("state-graph");
    if (!canvas || !canvas.getContext) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);
    if (!norms || !norms.length) return;

    const maxVal = Math.max(...norms) || 1;
    const minVal = Math.min(...norms);
    const pad = 10;
    const range = Math.max(1e-6, maxVal - minVal);

    // background gradient
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "rgba(56, 189, 248, 0.18)");
    grad.addColorStop(1, "rgba(15, 23, 42, 1)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // line
    ctx.beginPath();
    norms.forEach((v, i) => {
      const x = pad + (i / Math.max(1, norms.length - 1)) * (w - 2 * pad);
      const y = h - pad - ((v - minVal) / range) * (h - 2 * pad);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = "rgba(129, 140, 248, 0.95)";
    ctx.lineWidth = 1.4;
    ctx.shadowColor = "rgba(129, 140, 248, 0.7)";
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // marker at t0
    const idx = Math.min(Math.max(0, t0), norms.length - 1);
    const x0 = pad + (idx / Math.max(1, norms.length - 1)) * (w - 2 * pad);
    const y0 = h - pad - ((norms[idx] - minVal) / range) * (h - 2 * pad);
    ctx.fillStyle = "rgba(34, 197, 94, 0.9)";
    ctx.beginPath();
    ctx.arc(x0, y0, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawFingerprint(state) {
    const canvas = document.getElementById("fingerprint-canvas");
    if (!canvas || !canvas.getContext) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (!state || !state.length) return;

    const cx = w / 2;
    const cy = h / 2;
    const baseR = 12;
    const maxExtra = Math.min(w, h) / 2 - baseR - 8;
    const mags = state.map(Math.abs);
    const maxMag = Math.max(...mags) || 1;

    // background
    const grad = ctx.createRadialGradient(cx, cy, baseR, cx, cy, Math.min(cx, cy));
    grad.addColorStop(0, "rgba(15, 23, 42, 0.2)");
    grad.addColorStop(1, "rgba(15, 23, 42, 1)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // spokes
    const n = state.length;
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
      const normMag = mags[i] / maxMag;
      const r = baseR + normMag * maxExtra;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;

      const hue = 220 + (i / n) * 120;
      ctx.strokeStyle = `hsla(${hue}, 85%, 68%, 0.95)`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(x, y);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(15, 23, 42, 1)";
    ctx.beginPath();
    ctx.arc(cx, cy, baseR - 2, 0, Math.PI * 2);
    ctx.fill();
  }

  function renderHistory(history) {
    const strip = document.getElementById("history-strip");
    if (!strip) return;
    strip.innerHTML = "";
    history.forEach((h) => {
      const div = document.createElement("div");
      div.className = "history-card";
      div.innerHTML =
        '<div class="history-card-header">' +
        '<span>U #' + h.id + "</span>" +
        '<span class="history-chip">t₀=' + h.t0 + ", t₁=" + h.t1 + "</span>" +
        "</div>" +
        '<div><strong>‖U∞‖</strong> ' + fmt(h.inf_norm) + "</div>" +
        '<div><strong>Δ‖U‖</strong> ' + fmt(h.delta_norm) + "</div>";
      strip.appendChild(div);
    });
  }

  function updateMultiverseStats(enabled, count, params) {
    const meanInfEl = document.getElementById("multi-mean-inf");
    const meanDeltaEl = document.getElementById("multi-mean-delta");
    const varInfEl = document.getElementById("multi-var-inf");
    const noteEl = document.getElementById("multi-note");

    if (!enabled || !count) {
      if (meanInfEl) meanInfEl.textContent = "…";
      if (meanDeltaEl) meanDeltaEl.textContent = "…";
      if (varInfEl) varInfEl.textContent = "…";
      if (noteEl) {
        noteEl.textContent =
          "Enable multiverse mode to estimate ensemble statistics over many random universes.";
      }
      return;
    }

    const { steps, maxLevels, t0, t1, strength, dim, modelType, systemType } = params;
    let sumInf = 0;
    let sumDelta = 0;
    let sumInfSq = 0;

    for (let i = 0; i < count; i++) {
      const U = new LivingUniverse(dim, modelType, systemType);
      U.run(steps, maxLevels);

      const before = U.get_state(t0);
      const normBefore = norm(before);
      retro_influence(U, t1, t0, strength);
      const after = U.get_state(t0);
      const normAfter = norm(after);
      const delta = normAfter - normBefore;
      const inf = norm(U.infinite_state(t0));

      sumInf += inf;
      sumInfSq += inf * inf;
      sumDelta += delta;
    }

    const meanInf = sumInf / count;
    const meanDelta = sumDelta / count;
    const varInf = Math.max(0, sumInfSq / count - meanInf * meanInf);

    if (meanInfEl) meanInfEl.textContent = fmt(meanInf);
    if (meanDeltaEl) meanDeltaEl.textContent = fmt(meanDelta);
    if (varInfEl) varInfEl.textContent = fmt(varInf);
    if (noteEl) {
      noteEl.textContent =
        "Multiverse mode: " +
        count +
        " universes sampled with steps=" +
        steps +
        ", levels=" +
        maxLevels +
        ".";
    }
  }

  function playChime(deltaNorm) {
    try {
      if (!soundEnabledCache) return;
      if (!window.AudioContext && !window.webkitAudioContext) return;
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      const ctx = audioCtx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const baseFreq = 440;
      const intensity = Math.min(1.5, Math.max(0.1, Math.abs(deltaNorm)));
      osc.frequency.value = baseFreq * (1 + 0.3 * intensity);
      gain.gain.value = 0.04;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const now = ctx.currentTime;
      osc.start(now);
      osc.stop(now + 0.2);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    } catch (_) {
      // audio is optional; ignore failures
    }
  }

  // === Model-specific dynamics helpers ===
  function evolveOscillators(prev, systemType) {
    const dt = 0.05;
    const k = 1.0;
    const coupling = 0.1;
    const gamma = systemType === "open" ? 0.05 : systemType === "closed" ? 0.01 : 0.0;
    const noiseScale = systemType === "open" ? 0.02 : 0.0;

    const dim = prev.length;
    const next = prev.slice();
    const n = Math.floor(dim / 2);

    for (let i = 0; i < n; i++) {
      const xi = prev[2 * i];
      const vi = prev[2 * i + 1];
      const left = i > 0 ? prev[2 * (i - 1)] : xi;
      const right = i < n - 1 ? prev[2 * (i + 1)] : xi;
      const force = -k * xi - coupling * ((xi - left) + (xi - right));
      let vNext = vi + dt * force;
      vNext *= 1 - gamma;
      let xNext = xi + dt * vNext;
      if (noiseScale > 0) {
        vNext += (Math.random() * 2 - 1) * noiseScale;
      }
      next[2 * i] = xNext;
      next[2 * i + 1] = vNext;
    }

    // if odd dimension, carry extra component forward
    if (dim % 2 === 1) {
      next[dim - 1] = prev[dim - 1];
    }
    return next;
  }

  function evolveIsing(prev, systemType) {
    const dim = prev.length;
    const spins = prev.slice();
    let m = 0;
    for (let i = 0; i < dim; i++) m += spins[i];
    m /= dim || 1;
    const J = 1.0;
    const h = 0.0;
    const beta = 1.0;
    const noiseScale = systemType === "open" ? 0.15 : 0.0;
    const next = new Array(dim);
    for (let i = 0; i < dim; i++) {
      let localField = J * m + h;
      if (noiseScale > 0) {
        localField += (Math.random() * 2 - 1) * noiseScale;
      }
      next[i] = Math.tanh(beta * localField);
    }
    return next;
  }

  function oscillatorEnergy(state) {
    const dim = state.length;
    let E = 0;
    const n = Math.floor(dim / 2);
    for (let i = 0; i < n; i++) {
      const x = state[2 * i];
      const v = state[2 * i + 1];
      E += 0.5 * (x * x + v * v);
    }
    return E;
  }

  function isingEnergy(state) {
    const dim = state.length;
    if (!dim) return 0;
    let m = 0;
    for (let i = 0; i < dim; i++) m += state[i];
    m /= dim;
    const J = 1.0;
    return -0.5 * J * dim * m * m;
  }

  function runBrowserSimulation() {
    const params = getParameters();
    const {
      steps,
      maxLevels,
      t0,
      t1,
      strength,
      obsLevel,
      dim,
      multiverseEnabled,
      multiverseCount,
      theme,
      animationsEnabled,
      autoRun,
      alertThreshold,
      modelType,
      systemType,
    } = params;

    // apply customisation
    try {
      const root = document.documentElement;
      if (theme === "minimal") {
        root.style.setProperty("--bg", "#020617");
        root.style.setProperty("--accent", "#6366f1");
        root.style.setProperty("--accent-2", "#22c55e");
      } else if (theme === "deep") {
        root.style.setProperty("--bg", "#020617");
        root.style.setProperty("--accent", "#0ea5e9");
        root.style.setProperty("--accent-2", "#38bdf8");
      } else {
        root.style.removeProperty("--bg");
        root.style.removeProperty("--accent");
        root.style.removeProperty("--accent-2");
      }
      if (animationsEnabled) {
        document.body.classList.remove("no-anim");
      } else {
        document.body.classList.add("no-anim");
      }
      window.localStorage &&
        localStorage.setItem(
          "alive-universe-preferences",
          JSON.stringify({ theme, animationsEnabled, soundEnabled: soundEnabledCache })
        );
    } catch (_) {
      // ignore theming errors
    }

    const U = new LivingUniverse(dim, modelType, systemType);
    U.run(steps, maxLevels);

    const state_before = U.get_state(t0);
    const norm_before = norm(state_before);

    retro_influence(U, t1, t0, strength);

    const state_after = U.get_state(t0);
    const norm_after = norm(state_after);
    const delta_norm = norm_after - norm_before;

    // simple energy-like diagnostics depending on model
    let energy_before = 0;
    let energy_after = 0;
    if (modelType === "oscillators") {
      energy_before = oscillatorEnergy(state_before);
      energy_after = oscillatorEnergy(state_after);
    } else if (modelType === "ising") {
      energy_before = isingEnergy(state_before);
      energy_after = isingEnergy(state_after);
    } else {
      // fallback: use squared norm as pseudo-energy
      energy_before = norm_before * norm_before;
      energy_after = norm_after * norm_after;
    }
    const delta_energy = energy_after - energy_before;

    const inf_state = U.infinite_state(t0);
    const inf_norm = norm(inf_state);

    const obs = new Observer(U, obsLevel);
    const obs_state = obs.perceive(t0);
    const obs_norm = norm(obs_state);

    const t0Labels = [
      document.getElementById("sim-t0-label"),
      document.getElementById("sim-t0-label-obs"),
      document.getElementById("sim-t0-label-head"),
      document.getElementById("sim-t0-label-track"),
    ].filter(Boolean);
    const t1Labels = [
      document.getElementById("sim-t1-label-head"),
      document.getElementById("sim-t1-label-track"),
    ].filter(Boolean);

    t0Labels.forEach(el => (el.textContent = String(t0)));
    t1Labels.forEach(el => (el.textContent = String(t1)));

    const infNormEl = document.getElementById("sim-infinite-norm");
    const deltaNormEl = document.getElementById("sim-delta-norm");
    const obsNormEl = document.getElementById("sim-observer-norm");
    const levelDisplayEl = document.getElementById("level-display");
    const chipEl = document.getElementById("sim-status-chip");
    const noteEl = document.getElementById("sim-timeline-note");
    const footnoteEl = document.getElementById("sim-footnote");
    const summaryInfEl = document.getElementById("summary-inf");
    const summaryDeltaEl = document.getElementById("summary-delta");
    const summaryObsEl = document.getElementById("summary-obs");
    const summaryNoteEl = document.getElementById("summary-note");
    const meanDeltaEl = document.getElementById("multi-mean-delta");

    if (infNormEl) infNormEl.textContent = fmt(inf_norm);
    if (deltaNormEl) deltaNormEl.textContent = fmt(delta_norm);
    if (obsNormEl) obsNormEl.textContent = fmt(obs_norm);
    if (levelDisplayEl) levelDisplayEl.textContent = String(obsLevel);

    if (summaryInfEl) summaryInfEl.textContent = fmt(inf_norm);
    if (summaryDeltaEl) summaryDeltaEl.textContent = fmt(delta_norm);
    if (summaryObsEl) summaryObsEl.textContent = fmt(obs_norm);

    if (chipEl) {
      chipEl.innerHTML = '<span class="chip-dot"></span>Simulation complete in browser';
    }

    if (noteEl) {
      noteEl.innerHTML =
        'This live run evolved the universe to <code>t = ' + t1 +
        '</code>, sent a soft retrocausal signal back to <code>t = ' + t0 +
        '</code>, and updated the metrics above from the resulting states.';
    }

    if (footnoteEl) {
      footnoteEl.innerHTML =
        'All values shown (norms, deltas, observer reading) are computed in real time ' +
        'by the JavaScript engine on this page. ' +
        'Use “Run new universe” to re‑seed the multiverse and get a fresh sample.';
    }

    if (summaryNoteEl) {
      summaryNoteEl.textContent =
        'Universe generated with model=' + modelType +
        ', system=' + systemType +
        ', dim=' + dim +
        ', t₀=' + t0 + ', t₁=' + t1 +
        ' — click “Run new universe” for another branch.';
    }

    // store and render history
    const historyArr = (window.universeHistory = window.universeHistory || []);
    historyArr.push({
      id: historyArr.length + 1,
      t0,
      t1,
      inf_norm,
      delta_norm,
      obs_norm,
    });
    while (historyArr.length > 5) historyArr.shift();
    renderHistory(historyArr);

    // update visuals
    const normsTimeline = U.history.map((v) => norm(v));
    drawStateGraph(normsTimeline, t0);
    drawFingerprint(state_after);

    // multiverse ensemble stats
    updateMultiverseStats(multiverseEnabled, multiverseCount, params);

    // sound cue
    playChime(delta_norm);

    // alert if a strong time‑travel effect is detected
    if (alertThreshold > 0 && Math.abs(delta_norm) >= alertThreshold) {
      const now = Date.now();
      if (now - lastAlertTime > 1000) {
        lastAlertTime = now;
        // eslint-disable-next-line no-alert
        alert(
          "Plausible time‑travel event detected\n\n" +
            "Dim = " + dim +
            ", t₀ = " + t0 +
            ", t₁ = " + t1 +
            "\nΔ‖U(t₀)‖ = " + fmt(delta_norm) +
            " ≥ threshold " + fmt(alertThreshold)
        );
      }
    }

    // schedule next auto‑run if enabled
    if (autoRun && !autoRunHandle) {
      const loop = () => {
        const p = getParameters();
        if (!p.autoRun) {
          autoRunHandle = null;
          return;
        }
        window.runUniverseSimulation();
        autoRunHandle = window.setTimeout(loop, 80);
      };
      loop();
    }
  }

  // expose to the page so HTML controls can trigger new runs
  window.runUniverseSimulation = function () {
    const chipEl = document.getElementById("sim-status-chip");
    const runBtn = document.getElementById("run-sim-btn");

    if (runBtn) {
      runBtn.setAttribute("data-busy", "true");
      runBtn.disabled = true;
    }

    if (chipEl) {
      chipEl.classList.add("running");
      chipEl.innerHTML = '<span class="chip-dot"></span>Generating new universe…';
    }

    // Slight delay so the animation reads clearly, then run + settle
    requestAnimationFrame(() => {
      setTimeout(() => {
        runBrowserSimulation();

        if (chipEl) {
          chipEl.classList.remove("running");
        }
        if (runBtn) {
          runBtn.removeAttribute("data-busy");
          runBtn.disabled = false;
        }
      }, 220);
    });
  };

  function attachControlsAndRun() {
    const btn = document.getElementById("run-sim-btn");
    const levelEl = document.getElementById("param-level");
    const themeEl = document.getElementById("theme-select");
    const animEl = document.getElementById("toggle-anim");
    const soundEl = document.getElementById("toggle-sound");
    const autoEl = document.getElementById("auto-run");

    // hydrate preferences
    try {
      const raw = window.localStorage && localStorage.getItem("alive-universe-preferences");
      if (raw) {
        const prefs = JSON.parse(raw);
        if (themeEl && prefs.theme) themeEl.value = prefs.theme;
        if (animEl && "animationsEnabled" in prefs) animEl.checked = !!prefs.animationsEnabled;
        if (soundEl && "soundEnabled" in prefs) {
          soundEl.checked = !!prefs.soundEnabled;
          soundEnabledCache = !!prefs.soundEnabled;
        }
      }
    } catch (_) {
      // ignore storage errors
    }

    if (levelEl) {
      levelEl.addEventListener("input", () => {
        const { obsLevel } = getParameters();
        const label = document.getElementById("level-display");
        if (label) label.textContent = String(obsLevel);
      });
    }
    const snapshotBtn = document.getElementById("snapshot-btn");
    if (snapshotBtn) {
      snapshotBtn.addEventListener("click", () => {
        const last = (window.universeHistory || [])[window.universeHistory.length - 1];
        if (!last) return;
        const lines = [
          "Living Universe Snapshot",
          "------------------------",
          "t0 = " + last.t0,
          "t1 = " + last.t1,
          "||U_inf(t0)|| = " + fmt(last.inf_norm),
          "Delta ||U(t0)|| = " + fmt(last.delta_norm),
          "||Observer_k(t0)|| = " + fmt(last.obs_norm),
          "",
          "Recreate by using the same parameters in the web UI.",
        ];
        const blob = new Blob([lines.join("\n")], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "universe-snapshot.txt";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      });
    }
    if (btn) {
      btn.addEventListener("click", window.runUniverseSimulation);
    }

    if (autoEl) {
      autoEl.addEventListener("change", () => {
        const { autoRun } = getParameters();
        if (!autoRun && autoRunHandle) {
          clearTimeout(autoRunHandle);
          autoRunHandle = null;
        } else if (autoRun && !autoRunHandle) {
          window.runUniverseSimulation();
        }
      });
    }
    window.runUniverseSimulation();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attachControlsAndRun);
  } else {
    attachControlsAndRun();
  }
})();
