/* Wagon Train player — streams public-domain episodes from the Internet Archive. */
(function () {
  "use strict";

  var ARCHIVE_ID = "wagon-train-s-01-e-101-ep-101-the-willy-moran-story";
  var LS_PROGRESS = "jaw-wt-progress-v1";   // {key: {t: seconds, at: timestamp}}
  var LS_WATCHED = "jaw-wt-watched-v1";     // [key]

  var player = document.getElementById("player");
  var eplist = document.getElementById("eplist");
  var pills = document.getElementById("pills");
  var searchInput = document.getElementById("search");
  var npEp = document.getElementById("npEp");
  var npTitle = document.getElementById("npTitle");
  var npHint = document.getElementById("npHint");
  var continueBox = document.getElementById("continueBox");
  var cwRow = document.getElementById("cwRow");

  var episodes = [];
  var byKey = {};
  var activeSeason = 1;
  var currentKey = null;
  var saveTimer = 0;

  function key(ep) { return "s" + ep.s + "e" + ep.e; }
  function label(ep) { return "S" + ep.s + " · E" + ep.e; }
  function fileUrl(ep) {
    return "https://archive.org/download/" + ARCHIVE_ID + "/" + encodeURIComponent(ep.f);
  }
  function loadJSON(k, fb) { try { var v = JSON.parse(localStorage.getItem(k)); return v || fb; } catch (e) { return fb; } }
  function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  function getProgress() { return loadJSON(LS_PROGRESS, {}); }
  function getWatched() { return loadJSON(LS_WATCHED, []); }

  function markWatched(k) {
    var w = getWatched();
    if (w.indexOf(k) === -1) { w.push(k); saveJSON(LS_WATCHED, w); }
    var p = getProgress();
    if (p[k]) { delete p[k]; saveJSON(LS_PROGRESS, p); }
  }

  function renderPills() {
    var seasons = [];
    episodes.forEach(function (ep) { if (seasons.indexOf(ep.s) === -1) seasons.push(ep.s); });
    seasons.sort(function (a, b) { return a - b; });
    pills.innerHTML = "";
    seasons.forEach(function (s) {
      var b = document.createElement("button");
      b.className = "pill" + (s === activeSeason ? " active" : "");
      b.textContent = "Season " + s;
      b.onclick = function () { activeSeason = s; searchInput.value = ""; renderPills(); renderList(); };
      pills.appendChild(b);
    });
  }

  function filteredEpisodes() {
    var q = searchInput.value.trim().toLowerCase();
    if (!q) return episodes.filter(function (ep) { return ep.s === activeSeason; });
    return episodes.filter(function (ep) {
      return ep.t.toLowerCase().indexOf(q) !== -1 || label(ep).toLowerCase().indexOf(q) !== -1;
    });
  }

  function renderList() {
    var watched = getWatched();
    var list = filteredEpisodes();
    eplist.innerHTML = "";
    if (!list.length) {
      eplist.innerHTML = '<div class="empty">No episodes match that search.<br>Try another title.</div>';
      return;
    }
    list.forEach(function (ep) {
      var k = key(ep);
      var row = document.createElement("div");
      row.className = "ep-row" + (k === currentKey ? " playing" : "") + (watched.indexOf(k) !== -1 ? " watched" : "");
      row.innerHTML =
        '<div class="ep-num">' + ep.e + "</div>" +
        '<div class="ep-meta"><div class="ep-title"></div>' +
        '<div class="ep-sub">' + label(ep) + "</div></div>" +
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
      var card = document.createElement("div");
      card.className = "cw-card";
      var pct = 0;
      if (player.duration && it.k === currentKey) pct = Math.min(100, (player.currentTime / player.duration) * 100);
      card.innerHTML = '<div class="t"></div><div class="p"><i style="width:' + Math.round(pct) + '%"></i></div>' +
        '<div class="ep-sub" style="margin-top:6px">' + label(it.ep) + " · resumes " + fmtTime(it.t) + "</div>";
      card.querySelector(".t").textContent = it.ep.t;
      card.onclick = function () { play(it.ep, it.t); };
      cwRow.appendChild(card);
    });
  }

  function fmtTime(s) {
    s = Math.floor(s || 0);
    var m = Math.floor(s / 60), sec = s % 60;
    var h = Math.floor(m / 60); m = m % 60;
    return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(sec).padStart(2, "0");
  }

  function play(ep, resumeAt) {
    var k = key(ep);
    currentKey = k;
    player.src = fileUrl(ep);
    player.play().catch(function () {});
    npEp.textContent = "Season " + ep.s + " · Episode " + ep.e;
    npTitle.textContent = ep.t;
    npHint.textContent = "Now playing — the next episode starts automatically when this one ends.";
    if (resumeAt) {
      player.addEventListener("loadedmetadata", function once() {
        player.removeEventListener("loadedmetadata", once);
        try { player.currentTime = Math.min(resumeAt, (player.duration || resumeAt + 1) - 5); } catch (e) {}
      });
    }
    renderList();
    renderContinue();
    document.querySelector(".player-wrap").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function playNext() {
    if (!currentKey) return;
    var idx = episodes.findIndex(function (ep) { return key(ep) === currentKey; });
    if (idx !== -1 && idx + 1 < episodes.length) play(episodes[idx + 1]);
  }

  player.addEventListener("timeupdate", function () {
    if (!currentKey || !player.duration) return;
    var now = Date.now();
    if (now - saveTimer < 8000) return;
    saveTimer = now;
    if (player.currentTime / player.duration > 0.92) {
      markWatched(currentKey);
      renderList(); renderContinue();
    } else {
      var p = getProgress();
      p[currentKey] = { t: player.currentTime, at: now };
      saveJSON(LS_PROGRESS, p);
    }
  });
  player.addEventListener("ended", function () {
    if (currentKey) { markWatched(currentKey); renderList(); renderContinue(); }
    playNext();
  });
  player.addEventListener("pause", function () {
    if (!currentKey || !player.duration) return;
    var p = getProgress();
    p[currentKey] = { t: player.currentTime, at: Date.now() };
    saveJSON(LS_PROGRESS, p);
    renderContinue();
  });

  var searchTimer = 0;
  searchInput.addEventListener("input", function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderList, 180);
  });

  fetch("episodes.json")
    .then(function (r) { if (!r.ok) throw new Error("catalog failed"); return r.json(); })
    .then(function (data) {
      episodes = data.episodes || [];
      episodes.forEach(function (ep) { byKey[key(ep)] = ep; });
      document.getElementById("count").textContent = episodes.length;
      renderPills();
      renderList();
      renderContinue();
    })
    .catch(function () {
      eplist.innerHTML = '<div class="empty">Couldn\'t load the episode catalog.<br>Check your connection and reload.</div>';
    });
})();
