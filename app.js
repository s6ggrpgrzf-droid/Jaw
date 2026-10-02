/* Wagon Train player — streams public-domain episodes from the Internet Archive. */
(function () {
  "use strict";

  var ARCHIVE_ID = "wagon-train-s-01-e-101-ep-101-the-willy-moran-story";
  var LS_PROGRESS = "jaw-wt-progress-v1";
  var LS_WATCHED = "jaw-wt-watched-v1";
  var LS_AUTOPLAY = "jaw-wt-autoplay-v1";
  var LS_SEASON = "jaw-wt-season-v1";
  var UP_NEXT_SECS = 8;

  var player = document.getElementById("player");
  var eplist = document.getElementById("eplist");
  var pills = document.getElementById("pills");
  var searchInput = document.getElementById("search");
  var npEp = document.getElementById("npEp");
  var npTitle = document.getElementById("npTitle");
  var continueBox = document.getElementById("continueBox");
  var cwRow = document.getElementById("cwRow");
  var upnext = document.getElementById("upnext");
  var unTitle = document.getElementById("unTitle");
  var unSub = document.getElementById("unSub");
  var unBar = document.getElementById("unBar");
  var swAutoplay = document.getElementById("swAutoplay");
  var selSpeed = document.getElementById("selSpeed");

  var episodes = [];
  var byKey = {};
  var activeSeason = 1;
  var currentKey = null;
  var saveTimer = 0;
  var unTimer = null;
  var autoplayOn = true;

  function key(ep) { return "s" + ep.s + "e" + ep.e; }
  function label(ep) { return "Season " + ep.s + " · Ep " + ep.e; }
  function fileUrl(ep) {
    return "https://archive.org/download/" + ARCHIVE_ID + "/" + encodeURIComponent(ep.f);
  }
  function loadJSON(k, fb) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? fb : v; } catch (e) { return fb; } }
  function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function getProgress() { return loadJSON(LS_PROGRESS, {}); }
  function getWatched() { return loadJSON(LS_WATCHED, []); }

  function markWatched(k) {
    var w = getWatched();
    if (w.indexOf(k) === -1) { w.push(k); saveJSON(LS_WATCHED, w); }
    var p = getProgress();
    if (p[k]) { delete p[k]; saveJSON(LS_PROGRESS, p); }
    renderStats();
  }

  function nextEp() {
    if (!currentKey) return null;
    var idx = -1;
    for (var i = 0; i < episodes.length; i++) if (key(episodes[i]) === currentKey) { idx = i; break; }
    return idx !== -1 && idx + 1 < episodes.length ? episodes[idx + 1] : null;
  }

  /* ---------- rendering ---------- */
  function renderStats() {
    var w = getWatched().length;
    document.getElementById("statEps").textContent = episodes.length;
    document.getElementById("statWatched").textContent = w;
    document.getElementById("watchFill").style.width =
      (episodes.length ? Math.round((w / episodes.length) * 100) : 0) + "%";
  }

  function renderPills() {
    var counts = {};
    episodes.forEach(function (ep) { counts[ep.s] = (counts[ep.s] || 0) + 1; });
    var seasons = Object.keys(counts).map(Number).sort(function (a, b) { return a - b; });
    pills.innerHTML = "";
    seasons.forEach(function (s) {
      var b = document.createElement("button");
      b.className = "pill" + (s === activeSeason ? " active" : "");
      b.innerHTML = "Season " + s + "<small>" + counts[s] + "</small>";
      b.onclick = function () {
        activeSeason = s; saveJSON(LS_SEASON, s);
        searchInput.value = ""; renderPills(); renderList();
      };
      pills.appendChild(b);
    });
  }

  function filteredEpisodes() {
    var q = searchInput.value.trim().toLowerCase();
    if (!q) return episodes.filter(function (ep) { return ep.s === activeSeason; });
    return episodes.filter(function (ep) {
      return ep.t.toLowerCase().indexOf(q) !== -1 ||
             ("season " + ep.s + " ep " + ep.e).indexOf(q) !== -1;
    });
  }

  function renderList() {
    var watched = getWatched();
    var prog = getProgress();
    var list = filteredEpisodes();
    eplist.innerHTML = "";
    if (!list.length) {
      eplist.innerHTML = '<div class="empty">No episodes match that search.<br>Try another title.</div>';
      return;
    }
    list.forEach(function (ep) {
      var k = key(ep);
      var isW = watched.indexOf(k) !== -1;
      var pct = 0, hasProg = false;
      if (prog[k] && prog[k].t > 30 && player.duration && k === currentKey) {
        pct = Math.min(100, (player.currentTime / player.duration) * 100); hasProg = true;
      } else if (prog[k] && prog[k].t > 30) { hasProg = true; pct = -1; }
      var row = document.createElement("div");
      row.className = "ep-row" + (k === currentKey ? " playing" : "") + (isW ? " watched" : "") + (hasProg ? " hasprog" : "");
      row.innerHTML =
        '<div class="ep-num">' + ep.e + "</div>" +
        '<div class="ep-meta"><div class="ep-title"></div>' +
        '<div class="ep-sub">' + label(ep) + (hasProg && pct >= 0 ? " · " + Math.round(pct) + "% watched" : hasProg ? " · in progress" : "") + "</div>" +
        '<div class="ep-prog"><i style="width:' + Math.max(0, pct) + '%"></i></div></div>' +
        '<div class="ep-check">✓</div>';
      row.querySelector(".ep-title").textContent = ep.t;
      row.onclick = function () { play(ep); };
      eplist.appendChild(row);
    });
  }

  function renderContinue() {
    var p = getProgress();
    var items = Object.keys(p)
      .filter(function (k) { return byKey[k] && p[k].t > 30; })
      .map(function (k) { return { k: k, ep: byKey[k], at: p[k].at || 0, t: p[k].t }; })
      .sort(function (a, b) { return b.at - a.at; })
      .slice(0, 8);
    if (!items.length) { continueBox.style.display = "none"; return; }
    continueBox.style.display = "block";
    cwRow.innerHTML = "";
    items.forEach(function (it) {
      var pct = (it.k === currentKey && player.duration)
        ? Math.min(100, (player.currentTime / player.duration) * 100) : 0;
      var card = document.createElement("div");
      card.className = "cw-card";
      card.innerHTML = '<div class="t"></div><div class="p"><i style="width:' + Math.round(pct) + '%"></i></div>' +
        '<div class="m">' + label(it.ep) + " · resumes " + fmtTime(it.t) + "</div>";
      card.querySelector(".t").textContent = it.ep.t;
      card.onclick = function () { play(it.ep, it.t); };
      cwRow.appendChild(card);
    });
  }

  function fmtTime(s) {
    s = Math.floor(s || 0);
    var m = Math.floor(s / 60), sec = s % 60, h = Math.floor(m / 60);
    m = m % 60;
    return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(sec).padStart(2, "0");
  }

  /* ---------- playback ---------- */
  function cancelUpNext() {
    if (unTimer) { clearInterval(unTimer); unTimer = null; }
    upnext.classList.remove("show");
  }

  function play(ep, resumeAt) {
    cancelUpNext();
    var k = key(ep);
    currentKey = k;
    player.src = fileUrl(ep);
    player.play().catch(function () {});
    npEp.textContent = "Season " + ep.s + " · Episode " + ep.e;
    npTitle.textContent = ep.t;
    if (resumeAt) {
      var once = function () {
        player.removeEventListener("loadedmetadata", once);
        try { player.currentTime = Math.min(resumeAt, Math.max(0, (player.duration || resumeAt + 1) - 5)); } catch (e) {}
      };
      player.addEventListener("loadedmetadata", once);
    }
    renderList();
    renderContinue();
    document.getElementById("playerWrap").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function showUpNext() {
    var nx = nextEp();
    if (!nx) return;
    unTitle.textContent = nx.t;
    unSub.textContent = label(nx);
    upnext.classList.add("show");
    var remain = UP_NEXT_SECS;
    unBar.style.transition = "none"; unBar.style.width = "100%";
    requestAnimationFrame(function () {
      unBar.style.transition = "width 1s linear";
      unTimer = setInterval(function () {
        remain -= 1;
        unBar.style.width = (remain / UP_NEXT_SECS * 100) + "%";
        if (remain <= 0) { cancelUpNext(); play(nx); }
      }, 1000);
    });
    document.getElementById("unPlay").onclick = function () { cancelUpNext(); play(nx); };
    document.getElementById("unCancel").onclick = cancelUpNext;
  }

  function shuffle() {
    var pool = episodes.filter(function (ep) { return key(ep) !== currentKey; });
    play(pool[Math.floor(Math.random() * pool.length)]);
  }

  /* ---------- events ---------- */
  player.addEventListener("timeupdate", function () {
    if (!currentKey || !player.duration) return;
    var now = Date.now();
    if (now - saveTimer < 8000) return;
    saveTimer = now;
    if (player.currentTime / player.duration > 0.92) {
      markWatched(currentKey); renderList(); renderContinue();
    } else {
      var p = getProgress();
      p[currentKey] = { t: player.currentTime, at: now };
      saveJSON(LS_PROGRESS, p);
    }
  });
  player.addEventListener("ended", function () {
    if (currentKey) { markWatched(currentKey); renderList(); renderContinue(); }
    if (autoplayOn) showUpNext();
  });
  player.addEventListener("pause", function () {
    if (!currentKey || !player.duration) return;
    var p = getProgress();
    p[currentKey] = { t: player.currentTime, at: Date.now() };
    saveJSON(LS_PROGRESS, p);
    renderContinue();
  });

  document.getElementById("btnShuffle").onclick = shuffle;

  document.getElementById("btnPip").onclick = function () {
    if (!document.pictureInPictureEnabled || !player.src) return;
    if (document.pictureInPictureElement) document.exitPictureInPicture().catch(function () {});
    else player.requestPictureInPicture().catch(function () {});
  };

  selSpeed.onchange = function () { player.playbackRate = parseFloat(selSpeed.value) || 1; };

  function setAutoplay(on) {
    autoplayOn = on;
    swAutoplay.classList.toggle("on", on);
    saveJSON(LS_AUTOPLAY, on);
    if (!on) cancelUpNext();
  }
  swAutoplay.onclick = function () { setAutoplay(!autoplayOn); };

  document.getElementById("resetProg").onclick = function () {
    if (confirm("Reset all watch progress for Wagon Train?")) {
      try { localStorage.removeItem(LS_PROGRESS); localStorage.removeItem(LS_WATCHED); } catch (e) {}
      renderList(); renderContinue(); renderStats();
    }
  };

  document.addEventListener("keydown", function (e) {
    if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (!player.src) return;
    var k = e.key.toLowerCase();
    if (k === " ") { e.preventDefault(); player.paused ? player.play() : player.pause(); }
    else if (k === "arrowright") { player.currentTime = Math.min(player.duration || 0, player.currentTime + 10); }
    else if (k === "arrowleft") { player.currentTime = Math.max(0, player.currentTime - 10); }
    else if (k === "f") {
      var w = document.getElementById("playerWrap");
      if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
      else if (w.requestFullscreen) w.requestFullscreen().catch(function () {});
    }
    else if (k === "m") { player.muted = !player.muted; }
    else if (k === "n") { var nx = nextEp(); if (nx) play(nx); }
  });

  var searchTimer = 0;
  searchInput.addEventListener("input", function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderList, 180);
  });

  /* ---------- init ---------- */
  autoplayOn = loadJSON(LS_AUTOPLAY, true);
  swAutoplay.classList.toggle("on", autoplayOn);
  activeSeason = loadJSON(LS_SEASON, 1) || 1;

  fetch("episodes.json")
    .then(function (r) { if (!r.ok) throw new Error("catalog failed"); return r.json(); })
    .then(function (data) {
      episodes = data.episodes || [];
      episodes.forEach(function (ep) { byKey[key(ep)] = ep; });
      var maxS = Math.max.apply(null, episodes.map(function (ep) { return ep.s; }));
      if (activeSeason > maxS) activeSeason = 1;
      renderStats();
      renderPills();
      renderList();
      renderContinue();
    })
    .catch(function () {
      eplist.innerHTML = '<div class="empty">Couldn\'t load the episode catalog.<br>Check your connection and reload.</div>';
    });
})();
