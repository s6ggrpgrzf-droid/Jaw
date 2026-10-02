/* JAW — Classic Western Theater. Multi-show SPA streaming public-domain
   westerns from the Internet Archive. */
(function () {
  "use strict";

  var LS_V2 = "jaw-theater-v1";          // {progress:{sid:{key:{t,at}}}, watched:{sid:[key]}, autoplay:bool}
  var LS_V1P = "jaw-wt-progress-v1", LS_V1W = "jaw-wt-watched-v1";
  var LS_SEASON = "jaw-season-v1";       // {sid: season}
  var UP_NEXT_SECS = 8;

  var $ = function (id) { return document.getElementById(id); };
  var player = $("player"), eplist = $("eplist"), pills = $("pills"),
      searchInput = $("search"), searchResults = $("searchResults"),
      npEp = $("npEp"), npTitle = $("npTitle"),
      upnext = $("upnext"), unTitle = $("unTitle"), unSub = $("unSub"), unBar = $("unBar"),
      swAutoplay = $("swAutoplay"), selSpeed = $("selSpeed"), selSleep = $("selSleep"),
      toastEl = $("toast");

  var catalog = [];            // show metas
  var showCache = {};          // sid -> {meta, episodes}
  var route = { view: "home", sid: null };
  var activeSeason = 1, currentShow = null, currentKey = null;
  var saveTimer = 0, unTimer = null, sleepTimerId = null, sleepAfterEpisode = false;
  var store = { progress: {}, watched: {}, autoplay: true };

  /* ---------- store ---------- */
  function loadStore() {
    try { var v = JSON.parse(localStorage.getItem(LS_V2)); if (v) store = v; } catch (e) {}
    if (!store.progress) store.progress = {};
    if (!store.watched) store.watched = {};
    if (typeof store.autoplay !== "boolean") store.autoplay = true;
    // one-time migration from the old single-show keys
    try {
      var p1 = JSON.parse(localStorage.getItem(LS_V1P) || "null");
      var w1 = JSON.parse(localStorage.getItem(LS_V1W) || "null");
      if (p1 || w1) {
        if (p1) {
          store.progress.wagon = store.progress.wagon || {};
          Object.keys(p1).forEach(function (k) {
            var m = /^s(\d+)e(\d+)$/.exec(k);
            if (m) store.progress.wagon[k] = { t: p1[k].t || p1[k], at: p1[k].at || 0 };
          });
        }
        if (w1 && w1.length) store.watched.wagon = w1.slice();
        saveStore();
        localStorage.removeItem(LS_V1P); localStorage.removeItem(LS_V1W);
      }
    } catch (e) {}
  }
  function saveStore() { try { localStorage.setItem(LS_V2, JSON.stringify(store)); } catch (e) {} }
  function prog(sid) { return store.progress[sid] || {}; }
  function watched(sid) { return store.watched[sid] || []; }
  function markWatched(sid, k) {
    var w = watched(sid);
    if (w.indexOf(k) === -1) { w.push(k); store.watched[sid] = w; }
    var p = prog(sid);
    if (p[k]) { delete p[k]; store.progress[sid] = p; }
    saveStore(); renderStats();
  }

  /* ---------- audio enhancements (Web Audio) ---------- */
  var LS_AUDIO = "jaw-audio-v1";
  var audio = { wide: false, dialog: false, night: false };
  var AC = null, aN = null, lastPlayPromise = null;
  try { var _a = JSON.parse(localStorage.getItem(LS_AUDIO) || "null"); if (_a) audio = _a; } catch (e) {}
  function saveAudio() { try { localStorage.setItem(LS_AUDIO, JSON.stringify(audio)); } catch (e) {} }

  // Chain: source -> highpass -> presence peak -> dry/wet widener -> compressor -> out.
  // Neutral parameter values make each stage transparent, so bypassing is click-free.
  function ensureAudio() {
    if (AC) { if (AC.state === "suspended") AC.resume(); return true; }
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return false;
      AC = new Ctx();
      var src = AC.createMediaElementSource(player);
      var hp = AC.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 10;
      var pres = AC.createBiquadFilter(); pres.type = "peaking";
      pres.frequency.value = 3000; pres.Q.value = 0.9; pres.gain.value = 0;
      var merge = AC.createChannelMerger(2);
      var gDry = AC.createGain();
      var dly = AC.createDelay(0.05); dly.delayTime.value = 0;
      var gWet = AC.createGain(); gWet.gain.value = 0;
      var comp = AC.createDynamicsCompressor();
      comp.threshold.value = 0; comp.knee.value = 0; comp.ratio.value = 1;
      comp.attack.value = 0.003; comp.release.value = 0.25;
      src.connect(hp); hp.connect(pres);
      pres.connect(gDry); gDry.connect(merge, 0, 0); gDry.connect(merge, 0, 1);
      pres.connect(dly); dly.connect(gWet); gWet.connect(merge, 0, 1);
      merge.connect(comp); comp.connect(AC.destination);
      aN = { hp: hp, pres: pres, dly: dly, gWet: gWet, comp: comp };
      if (AC.state === "suspended") AC.resume();
      applyAudio();
      return true;
    } catch (e) { AC = null; return false; }
  }
  function applyAudio() {
    if (!aN) return;
    // wide: Haas effect — 18ms delayed copy folded into the right channel
    aN.dly.delayTime.value = audio.wide ? 0.018 : 0;
    aN.gWet.gain.value = audio.wide ? 0.85 : 0;
    // dialogue+: rumble cut + presence lift
    aN.hp.frequency.value = audio.dialog ? 90 : 10;
    aN.pres.gain.value = audio.dialog ? 5 : 0;
    // night: gentle leveling compressor
    var c = aN.comp;
    if (audio.night) {
      c.threshold.value = -24; c.knee.value = 6; c.ratio.value = 10;
      c.attack.value = 0.004; c.release.value = 0.3;
    } else {
      c.threshold.value = 0; c.knee.value = 0; c.ratio.value = 1;
      c.attack.value = 0.003; c.release.value = 0.25;
    }
  }
  function paintAudioSwitches() {
    $("swWide").classList.toggle("on", audio.wide);
    $("swDialog").classList.toggle("on", audio.dialog);
    $("swNight").classList.toggle("on", audio.night);
  }

  /* ---------- helpers ---------- */
  function epKey(ep) { return ep.s != null ? "s" + ep.s + "e" + ep.e : "n" + ep.n; }
  function epNum(ep) { return ep.s != null ? ep.e : ep.n; }
  function epSeasonLabel(ep) { return ep.s != null ? "S" + ep.s + " · E" + ep.e : "Episode " + ep.n; }
  function fileUrl(meta, ep) {
    return "https://archive.org/download/" + meta.archive + "/" + encodeURIComponent(ep.f);
  }
  function fmtTime(s) {
    s = Math.floor(s || 0);
    var m = Math.floor(s / 60), sec = s % 60, h = Math.floor(m / 60); m %= 60;
    return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(sec).padStart(2, "0");
  }
  var toastTimer = 0;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 2600);
  }
  function showMeta(sid) { return catalog.filter(function (c) { return c.sid === sid; })[0]; }

  function loadShow(sid, cb) {
    if (showCache[sid]) { cb(showCache[sid]); return; }
    var meta = showMeta(sid);
    fetch(meta.file)
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (d) {
        showCache[sid] = { meta: meta, episodes: d.episodes || [] };
        cb(showCache[sid]);
      })
      .catch(function () { toast("Couldn't load " + meta.title + " — check your connection."); });
  }

  /* ---------- stats ---------- */
  function renderStats() {
    var total = 0, w = 0;
    catalog.forEach(function (c) { total += c.count; });
    Object.keys(store.watched).forEach(function (sid) { w += store.watched[sid].length; });
    $("statEps").textContent = total;
    $("statShows").textContent = catalog.length;
    $("statWatched").textContent = w;
    $("watchFill").style.width = (total ? Math.round(w / total * 100) : 0) + "%";
    $("tagline").textContent = catalog.length + " classic series. " + total + " episodes. Free forever.";
  }

  /* ---------- home ---------- */
  function epCard(meta, ep, pct) {
    var k = epKey(ep);
    var isW = watched(meta.sid).indexOf(k) !== -1;
    var card = document.createElement("div");
    card.className = "ep-card";
    card.style.setProperty("--ac", meta.accent);
    card.innerHTML =
      '<div class="art"><span class="big">' + epNum(ep) + '</span><span class="wm">' + meta.title + "</span>" +
      (isW ? '<span class="done">Watched</span>' : "") + "</div>" +
      '<div class="bd"><div class="t"></div><div class="m">' + epSeasonLabel(ep) + "</div>" +
      (pct > 0 ? '<div class="p"><i style="width:' + Math.round(pct) + '%"></i></div>' : "") + "</div>";
    card.querySelector(".t").textContent = ep.t;
    card.onclick = function () { openShowAndPlay(meta.sid, ep); };
    return card;
  }

  function renderHome() {
    // continue watching across shows
    var items = [];
    Object.keys(store.progress).forEach(function (sid) {
      var meta = showMeta(sid); if (!meta) return;
      Object.keys(store.progress[sid]).forEach(function (k) {
        var e = store.progress[sid][k];
        if (e.t > 30) items.push({ sid: sid, meta: meta, k: k, t: e.t, at: e.at || 0 });
      });
    });
    items.sort(function (a, b) { return b.at - a.at; });
    var hc = $("homeContinue");
    if (items.length) {
      hc.hidden = false;
      var rail = $("railContinue"); rail.innerHTML = "";
      items.slice(0, 10).forEach(function (it) {
        loadShow(it.sid, function (sh) {
          var ep = sh.episodes.filter(function (e) { return epKey(e) === it.k; })[0];
          if (!ep) return;
          var card = epCard(it.meta, ep, 0);
          card.onclick = function () { openShowAndPlay(it.sid, ep, it.t); };
          rail.appendChild(card);
        });
      });
    } else hc.hidden = true;

    // show grid
    var grid = $("showGrid"); grid.innerHTML = "";
    catalog.forEach(function (c) {
      var d = document.createElement("div");
      d.className = "show-card";
      d.style.setProperty("--ac", c.accent);
      d.innerHTML = '<div class="init">' + c.title.charAt(0) + "</div>" +
        '<div class="nm"></div><div class="yr">' + c.years + "</div>" +
        '<div class="ct">' + c.count + " episodes</div>" +
        '<div class="bl"></div>';
      d.querySelector(".nm").textContent = c.title;
      d.querySelector(".bl").textContent = c.blurb;
      d.onclick = function () { location.hash = "#/" + c.sid; };
      grid.appendChild(d);
    });

    // per-show rails
    var rails = $("rails"); rails.innerHTML = "";
    catalog.forEach(function (c) {
      var wrap = document.createElement("div");
      wrap.innerHTML = '<div class="sec-head"><h3></h3><span class="more">View all →</span></div><div class="rail"></div>';
      wrap.querySelector("h3").textContent = c.title;
      wrap.querySelector(".more").onclick = function () { location.hash = "#/" + c.sid; };
      var rail = wrap.querySelector(".rail");
      rails.appendChild(wrap);
      loadShow(c.sid, function (sh) {
        sh.episodes.slice(0, 12).forEach(function (ep) { rail.appendChild(epCard(c, ep, 0)); });
      });
    });
  }

  /* ---------- show view ---------- */
  function seasonsOf(eps) {
    var s = [];
    eps.forEach(function (ep) { var sn = ep.s != null ? ep.s : 1; if (s.indexOf(sn) === -1) s.push(sn); });
    return s.sort(function (a, b) { return a - b; });
  }

  function renderShow() {
    var sid = route.sid;
    loadShow(sid, function (sh) { renderShowView(sh); });
  }

  // Open a show and optionally start an episode — all synchronously so the
  // video.play() call stays inside the user's tap gesture (iOS requirement).
  // Show catalogs are preloaded at startup, so this never needs to wait.
  function openShowAndPlay(sid, ep, resumeAt) {
    var sh = showCache[sid];
    if (!sh) { location.hash = "#/" + sid; if (ep) playOnShow(sid, ep, resumeAt); return; }
    // Render + play synchronously inside the tap gesture (iOS blocks delayed play()).
    // The hashchange that follows re-renders the same view idempotently.
    route = { view: "show", sid: sid };
    $("view-home").hidden = true;
    $("view-show").hidden = false;
    renderShowView(sh);
    window.scrollTo(0, 0);
    if (location.hash !== "#/" + sid) location.hash = "#/" + sid;
    if (ep) play(ep, resumeAt);
  }

  function renderShowView(sh) {
      var meta = sh.meta, eps = sh.episodes, sid = meta.sid;
      currentShow = sh;
      document.documentElement.style.setProperty("--ac", meta.accent);
      $("shTitle").textContent = meta.title;
      $("shTitle").style.setProperty("--ac2", meta.accent);
      document.querySelector(".showhead h2").style.color = meta.accent;
      $("shYears").textContent = meta.years + " · " + meta.count + " episodes";
      $("shBlurb").textContent = meta.blurb;
      var saved = null;
      try { saved = JSON.parse(localStorage.getItem(LS_SEASON) || "{}"); } catch (e) {}
      activeSeason = (saved && saved[sid]) || seasonsOf(eps)[0];
      renderPills(); renderList(); renderShowContinue();
  }

  function renderPills() {
    var eps = currentShow.episodes;
    var seasons = seasonsOf(eps);
    pills.innerHTML = "";
    if (seasons.length < 2) return;
    seasons.forEach(function (s) {
      var n = eps.filter(function (ep) { return (ep.s != null ? ep.s : 1) === s; }).length;
      var b = document.createElement("button");
      b.className = "pill" + (s === activeSeason ? " active" : "");
      b.innerHTML = "Season " + s + "<small>" + n + "</small>";
      b.onclick = function () {
        activeSeason = s;
        var saved = {}; try { saved = JSON.parse(localStorage.getItem(LS_SEASON) || "{}"); } catch (e) {}
        saved[currentShow.meta.sid] = s;
        try { localStorage.setItem(LS_SEASON, JSON.stringify(saved)); } catch (e2) {}
        renderPills(); renderList();
      };
      pills.appendChild(b);
    });
  }

  function renderList() {
    var sid = currentShow.meta.sid;
    var w = watched(sid), p = prog(sid);
    var list = currentShow.episodes.filter(function (ep) { return (ep.s != null ? ep.s : 1) === activeSeason; });
    eplist.innerHTML = "";
    list.forEach(function (ep) {
      var k = epKey(ep);
      var isW = w.indexOf(k) !== -1;
      var hasProg = p[k] && p[k].t > 30;
      var pct = (hasProg && k === currentKey && player.duration) ? Math.min(100, player.currentTime / player.duration * 100) : 0;
      var row = document.createElement("div");
      row.className = "ep-row" + (k === currentKey ? " playing" : "") + (isW ? " watched" : "") + (hasProg ? " hasprog" : "");
      row.innerHTML =
        '<div class="ep-num">' + epNum(ep) + "</div>" +
        '<div class="ep-meta"><div class="ep-title"></div>' +
        '<div class="ep-sub">' + epSeasonLabel(ep) + (hasProg ? " · resumes " + fmtTime(p[k].t) : "") + "</div>" +
        '<div class="ep-prog"><i style="width:' + Math.round(pct) + '%"></i></div></div>' +
        '<div class="ep-check">✓</div>';
      row.querySelector(".ep-title").textContent = ep.t;
      row.onclick = function () { play(ep); };
      eplist.appendChild(row);
    });
  }

  function renderShowContinue() {
    var sid = currentShow.meta.sid;
    var p = prog(sid);
    var box = $("showContinue"), rail = $("railShowContinue");
    var items = Object.keys(p).filter(function (k) { return p[k].t > 30; })
      .map(function (k) {
        var ep = currentShow.episodes.filter(function (e) { return epKey(e) === k; })[0];
        return ep ? { k: k, ep: ep, t: p[k].t, at: p[k].at || 0 } : null;
      })
      .filter(Boolean).sort(function (a, b) { return b.at - a.at; }).slice(0, 4);
    if (!items.length) { box.hidden = true; return; }
    box.hidden = false; rail.innerHTML = "";
    items.forEach(function (it) {
      var card = epCard(currentShow.meta, it.ep, 0);
      card.style.flex = "none";
      card.onclick = function () { play(it.ep, it.t); };
      rail.appendChild(card);
    });
  }

  /* ---------- playback ---------- */
  function cancelUpNext() {
    if (unTimer) { clearInterval(unTimer); unTimer = null; }
    upnext.classList.remove("show");
  }
  function nextEp() {
    if (!currentShow || !currentKey) return null;
    var eps = currentShow.episodes, idx = -1;
    for (var i = 0; i < eps.length; i++) if (epKey(eps[i]) === currentKey) { idx = i; break; }
    return idx !== -1 && idx + 1 < eps.length ? eps[idx + 1] : null;
  }
  function play(ep, resumeAt) {
    cancelUpNext();
    $("vidError").hidden = true;
    if (AC && AC.state === "suspended") AC.resume();
    var sid = currentShow.meta.sid, k = epKey(ep);
    currentKey = k;
    player.src = fileUrl(currentShow.meta, ep);
    var pr = null;
    try { pr = player.play(); } catch (e) {}
    if (pr && pr.catch) pr.catch(function () {});
    lastPlayPromise = pr;
    npEp.textContent = currentShow.meta.title + " · " + epSeasonLabel(ep);
    npTitle.textContent = ep.t;
    if (resumeAt) {
      var once = function () {
        player.removeEventListener("loadedmetadata", once);
        try { player.currentTime = Math.min(resumeAt, Math.max(0, (player.duration || resumeAt + 1) - 5)); } catch (e) {}
      };
      player.addEventListener("loadedmetadata", once);
    }
    renderList(); renderShowContinue();
    $("playerWrap").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  function playOnShow(sid, ep, resumeAt) {
    // used from home: ensure show view is ready, then play
    var go = function () { play(ep, resumeAt); };
    if (currentShow && currentShow.meta.sid === sid && route.view === "show") go();
    else {
      var check = setInterval(function () {
        if (currentShow && currentShow.meta.sid === sid && route.view === "show") { clearInterval(check); go(); }
      }, 120);
      setTimeout(function () { clearInterval(check); }, 6000);
    }
  }
  function showUpNext() {
    var nx = nextEp(); if (!nx) return;
    unTitle.textContent = nx.t;
    unSub.textContent = currentShow.meta.title + " · " + epSeasonLabel(nx);
    upnext.classList.add("show");
    var remain = UP_NEXT_SECS;
    unBar.style.transition = "none"; unBar.style.width = "100%";
    requestAnimationFrame(function () {
      unBar.style.transition = "width 1s linear";
      unTimer = setInterval(function () {
        remain -= 1;
        unBar.style.width = (remain / UP_NEXT_SECS * 100) + "%";
        if (remain <= 0) { cancelUpNext(); autoPlayNext(nx); }
      }, 1000);
    });
    $("unPlay").onclick = function () { cancelUpNext(); play(nx); };
    $("unCancel").onclick = cancelUpNext;
  }
  // Auto-advance isn't in a tap gesture, so iOS may block it. If blocked,
  // park the Up Next card on screen so a single tap resumes playback.
  function autoPlayNext(nx) {
    play(nx);
    var pr = lastPlayPromise;
    if (pr && pr.catch) pr.catch(function () { showUpNextBlocked(nx); });
  }
  function showUpNextBlocked(nx) {
    unTitle.textContent = nx.t;
    unSub.textContent = currentShow.meta.title + " · " + epSeasonLabel(nx) + " — tap Play now to start";
    upnext.classList.add("show");
    unBar.style.transition = "none"; unBar.style.width = "100%";
    $("unPlay").onclick = function () { cancelUpNext(); play(nx); };
    $("unCancel").onclick = cancelUpNext;
  }
  function shuffle() {
    var eps = currentShow.episodes.filter(function (ep) { return epKey(ep) !== currentKey; });
    play(eps[Math.floor(Math.random() * eps.length)]);
    toast("Shuffling " + currentShow.meta.title);
  }

  /* ---------- sleep timer ---------- */
  function clearSleep() {
    if (sleepTimerId) { clearTimeout(sleepTimerId); sleepTimerId = null; }
    sleepAfterEpisode = false;
  }
  selSleep.onchange = function () {
    clearSleep();
    var v = selSleep.value;
    if (v === "0") { toast("Sleep timer off"); return; }
    if (v === "episode") { sleepAfterEpisode = true; toast("Will sleep at the end of this episode"); return; }
    var mins = parseInt(v, 10);
    sleepTimerId = setTimeout(function () {
      player.pause(); sleepTimerId = null; selSleep.value = "0";
      toast("Sleep timer — goodnight, partner 🌙");
    }, mins * 60 * 1000);
    toast("Sleep timer set: " + mins + " minutes");
  };

  /* ---------- events ---------- */
  player.addEventListener("timeupdate", function () {
    if (!currentShow || !currentKey || !player.duration) return;
    var now = Date.now();
    if (now - saveTimer < 8000) return;
    saveTimer = now;
    var sid = currentShow.meta.sid;
    if (player.currentTime / player.duration > 0.92) {
      markWatched(sid, currentKey); renderList(); renderShowContinue(); renderHomeContinueOnly();
    } else {
      var p = prog(sid); p[currentKey] = { t: player.currentTime, at: now };
      store.progress[sid] = p; saveStore();
    }
  });
  player.addEventListener("error", function () {
    if (player.src) $("vidError").hidden = false;
  });
  $("veRetry").onclick = function () {
    $("vidError").hidden = true;
    if (currentShow && currentKey) {
      for (var i = 0; i < currentShow.episodes.length; i++) {
        if (epKey(currentShow.episodes[i]) === currentKey) { play(currentShow.episodes[i]); break; }
      }
    }
  };
  player.addEventListener("ended", function () {
    if (currentShow && currentKey) {
      markWatched(currentShow.meta.sid, currentKey);
      renderList(); renderShowContinue();
    }
    if (sleepAfterEpisode) {
      sleepAfterEpisode = false; selSleep.value = "0";
      toast("Sleep timer — goodnight, partner 🌙");
      return;
    }
    if (store.autoplay) showUpNext();
  });
  player.addEventListener("pause", function () {
    if (!currentShow || !currentKey || !player.duration) return;
    var sid = currentShow.meta.sid, p = prog(sid);
    p[currentKey] = { t: player.currentTime, at: Date.now() };
    store.progress[sid] = p; saveStore();
    renderShowContinue();
  });

  $("btnShuffle").onclick = shuffle;
  $("btnPip").onclick = function () {
    if (!document.pictureInPictureEnabled || !player.src) return;
    if (document.pictureInPictureElement) document.exitPictureInPicture().catch(function () {});
    else player.requestPictureInPicture().catch(function () {});
  };
  $("btnTheater").onclick = function () {
    var on = document.body.classList.toggle("theater");
    $("btnTheater").classList.toggle("on", on);
  };

  /* audio panel */
  paintAudioSwitches();
  $("btnAudio").onclick = function (e) {
    e.stopPropagation();
    var pop = $("audioPop");
    pop.hidden = !pop.hidden;
    $("btnAudio").classList.toggle("on", !pop.hidden);
  };
  document.addEventListener("click", function (e) {
    var pop = $("audioPop");
    if (!pop.hidden && !e.target.closest(".audio-pop") && !e.target.closest("#btnAudio")) {
      pop.hidden = true; $("btnAudio").classList.remove("on");
    }
  });
  function audioToggle(key, id, label) {
    $(id).onclick = function (e) {
      e.stopPropagation();
      var turningOn = !audio[key];
      // Only route audio through the Web Audio graph once a mode is enabled;
      // otherwise the video element plays untouched.
      if (turningOn && !ensureAudio()) { toast("Audio enhancements aren't supported in this browser"); return; }
      audio[key] = turningOn;
      saveAudio(); applyAudio(); paintAudioSwitches();
      toast(label + (turningOn ? " on" : " off"));
    };
  }
  audioToggle("wide", "swWide", "Wide sound");
  audioToggle("dialog", "swDialog", "Dialogue+");
  audioToggle("night", "swNight", "Night mode");
  selSpeed.onchange = function () { player.playbackRate = parseFloat(selSpeed.value) || 1; };
  function setAutoplay(on) {
    store.autoplay = on; saveStore();
    swAutoplay.classList.toggle("on", on);
    if (!on) cancelUpNext();
  }
  swAutoplay.onclick = function () { setAutoplay(!store.autoplay); };
  $("backBtn").onclick = function () { location.hash = "#/"; };
  $("resetProg").onclick = function () {
    if (confirm("Reset all watch progress?")) {
      store = { progress: {}, watched: {}, autoplay: store.autoplay };
      saveStore(); renderStats(); route.view === "home" ? renderHome() : renderShow();
      toast("Progress reset");
    }
  };

  document.addEventListener("keydown", function (e) {
    if (/INPUT|SELECT|TEXTAREA/.test((document.activeElement || {}).tagName || "")) return;
    if (route.view !== "show" || !player.src) return;
    var k = e.key.toLowerCase();
    if (k === " ") { e.preventDefault(); player.paused ? player.play() : player.pause(); }
    else if (k === "arrowright") player.currentTime = Math.min(player.duration || 0, player.currentTime + 10);
    else if (k === "arrowleft") player.currentTime = Math.max(0, player.currentTime - 10);
    else if (k === "f") {
      var w = $("playerWrap");
      if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
      else if (w.requestFullscreen) w.requestFullscreen().catch(function () {});
    }
    else if (k === "m") player.muted = !player.muted;
    else if (k === "n") { var nx = nextEp(); if (nx) play(nx); }
  });

  /* ---------- global search ---------- */
  var searchTimer = 0;
  searchInput.addEventListener("input", function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 200);
  });
  searchInput.addEventListener("focus", runSearch);
  document.addEventListener("click", function (e) {
    if (!e.target.closest(".searchbar")) searchResults.classList.remove("show");
  });
  function runSearch() {
    var q = searchInput.value.trim().toLowerCase();
    if (q.length < 2) { searchResults.classList.remove("show"); return; }
    var pending = catalog.length, groups = [];
    catalog.forEach(function (c) {
      loadShow(c.sid, function (sh) {
        var hits = sh.episodes.filter(function (ep) {
          return ep.t.toLowerCase().indexOf(q) !== -1;
        }).slice(0, 5);
        if (hits.length) groups.push({ meta: c, hits: hits });
        if (--pending === 0) paintSearch(groups);
      });
    });
  }
  function paintSearch(groups) {
    searchResults.innerHTML = "";
    if (!groups.length) {
      searchResults.innerHTML = '<div class="sr-empty">No episodes match — try another word.</div>';
    }
    groups.forEach(function (g) {
      var h = document.createElement("div");
      h.className = "sr-show"; h.textContent = g.meta.title;
      searchResults.appendChild(h);
      g.hits.forEach(function (ep) {
        var it = document.createElement("div");
        it.className = "sr-item";
        it.innerHTML = '<div class="n">' + epNum(ep) + '</div><div><div class="t"></div><div class="s">' + epSeasonLabel(ep) + "</div></div>";
        it.querySelector(".t").textContent = ep.t;
        it.onclick = function () {
          searchResults.classList.remove("show");
          searchInput.value = "";
          openShowAndPlay(g.meta.sid, ep);
        };
        searchResults.appendChild(it);
      });
    });
    searchResults.classList.add("show");
  }

  function renderHomeContinueOnly() { if (route.view === "home") renderHome(); }

  /* ---------- routing ---------- */
  function parseRoute() {
    var h = location.hash.replace(/^#\/?/, "");
    if (h && showMeta(h)) route = { view: "show", sid: h };
    else route = { view: "home", sid: null };
  }
  function render() {
    parseRoute();
    $("view-home").hidden = route.view !== "home";
    $("view-show").hidden = route.view !== "show";
    cancelUpNext();
    if (route.view === "home") { renderHome(); window.scrollTo(0, 0); }
    else { renderShow(); window.scrollTo(0, 0); }
  }
  window.addEventListener("hashchange", render);

  /* ---------- init ---------- */
  loadStore();
  swAutoplay.classList.toggle("on", store.autoplay);
  fetch("catalog.json")
    .then(function (r) { if (!r.ok) throw 0; return r.json(); })
    .then(function (c) {
      catalog = c;
      renderStats();
      render();
      // Preload every show's episodes: home taps then play inside the tap gesture (iOS blocks delayed play()).
      catalog.forEach(function (s) { loadShow(s.sid, function () {}); });
    })
    .catch(function () { toast("Couldn't load the catalog — check your connection."); });
})();
