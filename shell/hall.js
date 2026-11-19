/*
 * حائط التمييز (Hall of Fame)
 *
 * Shows, for every student, the total points EARNED since the beginning - even after he spent them.
 *
 * Definition of "earned": every time the admin ADDS points to a student's balance (new name with a balance,
 * "تعيين رصيد" for one student or for everybody). These increases are recorded in a permanent ledger.
 * NOT counted: spending at checkout (balance -> 0), points RETURNED by the "حذف وإرجاع الجميع" button, and
 * restoring a backup. So a refund never inflates the wall.
 *
 * Storage: one row per student in the existing `store_settings` table, key `hall:<student id>`,
 * value { name, stage, earned, updated }. Rows survive deleting orders, resetting the store or deleting the student.
 * Everything is injected on top of the mirrored site (the site code is untouched) and survives "Sync from Lovable".
 */
(function () {
  "use strict";

  function meta(name) { var m = document.querySelector('meta[name="' + name + '"]'); return m ? m.content : ""; }
  var URL_ = meta("supabase-url").replace(/\/$/, "");
  var KEY = meta("supabase-key");
  if (!URL_ || !KEY) return;

  var origFetch = window.fetch.bind(window);
  var REST = URL_ + "/rest/v1/";
  var q = encodeURIComponent;
  var OUTBOX = "alataa-hall-outbox";
  var STAGES = { junior: "ابتدائي - متوسط", senior: "ثانوي - جامعي" };

  /* ------------------------------------------------------------------ REST (uses the ORIGINAL fetch: never re-enters the hook) */
  function rest(method, path, body, prefer) {
    var h = { apikey: KEY, Authorization: "Bearer " + KEY };
    if (body !== undefined) h["Content-Type"] = "application/json";
    if (prefer) h.Prefer = prefer;
    return origFetch(REST + path, { method: method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) })
      .then(function (r) {
        if (!r.ok) throw new Error(method + " " + path.split("?")[0] + " -> HTTP " + r.status);
        return method === "GET" ? r.json() : null;
      });
  }
  function norm(s) {
    return String(s || "").replace(/[ً-ٟـ\s]+/g, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").toLowerCase();
  }
  function n0(x) { x = Number(x); return isFinite(x) ? x : 0; }

  /* ------------------------------------------------------------------ the ledger */
  /** Starting total for a student that has no ledger row yet: what he holds now + everything he already spent in recorded orders. */
  function seedEarned(name, balance, orders, backupOrders) {
    var key = norm(name), total = n0(balance), live = {};
    (orders || []).forEach(function (o) {
      live[o.id] = true;
      if (norm(o.buyer_name) === key) total += o.buyer_balance != null ? n0(o.buyer_balance) : n0(o.total_points);
    });
    (backupOrders || []).forEach(function (o) {            // orders deleted by an earlier "تصفير المتجر"
      if (!live[o.id] && norm(o.buyer_name) === key) total += o.buyer_balance != null ? n0(o.buyer_balance) : n0(o.total_points);
    });
    return total;
  }

  var seedMemo = null;
  function loadSeedSources() {
    if (seedMemo && Date.now() - seedMemo.t < 20000) return seedMemo.p;
    var p = loadSeedSourcesRaw();
    seedMemo = { t: Date.now(), p: p };
    p.catch(function () { seedMemo = null; });
    return p;
  }
  function loadSeedSourcesRaw() {
    return Promise.all([
      rest("GET", "orders?select=id,buyer_name,total_points,buyer_balance"),
      rest("GET", "store_settings?select=value&key=eq.reset_backup"),
    ]).then(function (r) {
      var bk = r[1] && r[1][0] && r[1][0].value && r[1][0].value.orders;
      return { orders: r[0] || [], backup: Array.isArray(bk) ? bk : [] };
    });
  }

  function readRow(id) {
    return rest("GET", "store_settings?select=value&key=eq." + q("hall:" + id)).then(function (r) { return r && r[0] ? r[0].value : null; });
  }
  function writeRow(id, value) {
    return rest("POST", "store_settings?on_conflict=key", { key: "hall:" + id, value: value }, "resolution=merge-duplicates,return=minimal");
  }

  /** Adds `delta` earned points to a student (creating his row from the seed if he has none yet). */
  async function applyDelta(e) {
    var row = await readRow(e.id), earned;
    if (row) earned = n0(row.earned) + e.delta;
    else {
      var src = await loadSeedSources();
      earned = seedEarned(e.name, e.seedBalance, src.orders, src.backup) + e.delta;
    }
    await writeRow(e.id, { name: e.name, stage: e.stage || (row && row.stage) || null, earned: earned, updated: new Date().toISOString() });
  }

  /** Makes sure the student has a ledger row, seeding it from the balance he holds RIGHT NOW (call before changing it). */
  async function ensureRow(b) {
    if (await readRow(b.id)) return;
    var src = await loadSeedSources();
    await rest("POST", "store_settings?on_conflict=key",
      { key: "hall:" + b.id, value: { name: b.name, stage: b.stage || null, earned: seedEarned(b.name, b.balance, src.orders, src.backup), updated: new Date().toISOString() } },
      "resolution=ignore-duplicates,return=minimal");
  }

  function outboxGet() { try { return JSON.parse(localStorage.getItem(OUTBOX) || "[]"); } catch (e) { return []; } }
  function outboxSet(a) { try { localStorage.setItem(OUTBOX, JSON.stringify(a)); } catch (e) {} }
  var flushing = false;
  async function flush() {
    if (flushing) return;
    flushing = true;
    try {
      var box = outboxGet();
      while (box.length) {
        await applyDelta(box[0]);           // throws -> stays queued, retried later (never lost)
        box = outboxGet(); box.shift(); outboxSet(box);
      }
    } catch (err) { /* offline / server error: retry on the next trigger */ }
    flushing = false;
  }
  function record(entry) { var b = outboxGet(); b.push(entry); outboxSet(b); flush(); }
  window.addEventListener("online", flush);
  setInterval(flush, 60000);
  setTimeout(flush, 3000);

  /* ------------------------------------------------------------------ fetch hook: detect points GRANTED by the admin */
  window.__hallPause = 0; // > 0 while points are being returned (refund) -> not "earned"

  function headersOf(init) { return init && init.headers ? init.headers : {}; }
  function bodyOf(init) { try { return JSON.parse(init && init.body); } catch (e) { return null; } }

  async function preState(url) {
    var u = new URL(url);
    u.searchParams.set("select", "id,name,balance,stage");
    ["order", "limit", "columns", "on_conflict"].forEach(function (k) { u.searchParams.delete(k); });
    var r = await origFetch(u.toString(), { headers: { apikey: KEY, Authorization: "Bearer " + KEY } });
    return r.ok ? r.json() : [];
  }

  window.fetch = function (input, init) {
    try {
      var url = typeof input === "string" ? input : input && input.url;
      var method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
      if (url && url.indexOf(REST + "buyers") === 0 && (method === "PATCH" || method === "POST") && !window.__hallPause) {
        var body = bodyOf(init);
        if (body) return interceptBuyers(input, init, url, method, body);
      }
    } catch (e) { /* never break the site */ }
    return origFetch(input, init);
  };

  async function interceptBuyers(input, init, url, method, body) {
    var pre = [], plan = [];
    try {
      if (method === "PATCH") {
        if (typeof body.balance === "number") {
          pre = await preState(url);
          var changed = pre.filter(function (b0) { return body.balance !== n0(b0.balance); });
          await Promise.all(changed.map(ensureRow));                              // keep the points they hold now on the ledger
          changed.forEach(function (b0) {
            if (body.balance > n0(b0.balance)) plan.push({ id: b0.id, name: b0.name, stage: b0.stage, delta: body.balance - n0(b0.balance), seedBalance: n0(b0.balance) });
          });
        }
      } else {                                                                 // POST = insert
        var rows = Array.isArray(body) ? body : [body];
        var isRestore = rows.some(function (r) { return r && r.id; });         // backup restore keeps ids -> NOT earned
        if (!isRestore) {
          var withBal = rows.filter(function (r) { return r && n0(r.balance) > 0; });
          if (withBal.length) {
            var names = withBal.map(function (r) { return '"' + String(r.name).replace(/"/g, '\\"') + '"'; }).join(",");
            pre = await rest("GET", "buyers?select=id,name,balance,stage&name=in.(" + q(names) + ")");
            withBal.forEach(function (r) {
              var old = pre.filter(function (b) { return b.name === r.name; })[0];
              var oldBal = old ? n0(old.balance) : 0;
              if (n0(r.balance) > oldBal) plan.push({ byName: r.name, stage: r.stage || null, delta: n0(r.balance) - oldBal, seedBalance: oldBal, id: old && old.id });
            });
          }
        }
      }
    } catch (e) { plan = []; }

    var res = await origFetch(input, init);
    if (res.ok && plan.length) {
      (async function () {
        try {
          for (var i = 0; i < plan.length; i++) {
            var p = plan[i];
            if (!p.id) {                                                       // brand-new student: find the id the DB gave him
              var f = await rest("GET", "buyers?select=id,name,stage&name=eq." + q(p.byName));
              if (!f[0]) continue;
              p.id = f[0].id; p.name = f[0].name; p.stage = f[0].stage;
            }
            record({ id: p.id, name: p.name, stage: p.stage, delta: p.delta, seedBalance: p.seedBalance });
          }
        } catch (e) { /* ledger sync is retried from the outbox on later events */ }
      })();
    }
    return res;
  }

  /* ------------------------------------------------------------------ reconcile + read for the wall */
  async function loadWall() {
    var r = await Promise.all([
      rest("GET", "buyers?select=id,name,balance,stage"),
      rest("GET", "store_settings?select=key,value&key=like." + q("hall:*")),
    ]);
    var buyers = r[0] || [], rows = {};
    (r[1] || []).forEach(function (s) { rows[s.key.slice(5)] = s.value; });
    var missing = buyers.filter(function (b) { return !rows[b.id]; });
    if (missing.length) {
      var src = await loadSeedSources();
      var payload = missing.map(function (b) {
        var v = { name: b.name, stage: b.stage || null, earned: seedEarned(b.name, b.balance, src.orders, src.backup), updated: new Date().toISOString() };
        rows[b.id] = v;
        return { key: "hall:" + b.id, value: v };
      });
      // ignore-duplicates: if two phones seed at the same moment nothing is counted twice
      try { await rest("POST", "store_settings?on_conflict=key", payload, "resolution=ignore-duplicates,return=minimal"); } catch (e) {}
    }
    // keep names / stages in the ledger in step with the students list
    buyers.forEach(function (b) {
      var v = rows[b.id];
      if (v && (v.name !== b.name || (v.stage || null) !== (b.stage || null))) {
        v.name = b.name; v.stage = b.stage || null;
        writeRow(b.id, v).catch(function () {});
      }
    });
    return Object.keys(rows).map(function (id) { var v = rows[id]; return { id: id, name: v.name, stage: v.stage || null, earned: n0(v.earned) }; });
  }

  /** Competition ranking: equal points share the same place (1,2,2,4). */
  function rank(list) {
    var sorted = list.filter(function (x) { return x.earned > 0; }).sort(function (a, b) { return b.earned - a.earned || a.name.localeCompare(b.name, "ar"); });
    var place = 0, prev = null;
    sorted.forEach(function (x, i) { if (x.earned !== prev) { place = i + 1; prev = x.earned; } x.rank = place; });
    return sorted;
  }

  setTimeout(function () { if (!window.__hallPause && !window.__hallNoStartup) loadWall().catch(function () {}); }, 2500);

  window.__hall = {
    seedEarned: seedEarned, applyDelta: applyDelta, flush: flush, loadWall: loadWall, rank: rank,
    outbox: outboxGet, norm: norm,
  };

  /* ------------------------------------------------------------------ UI: styles */
  var CSS = [
    "@media (min-width:640px){[data-hall-btn]>button{width:calc(50% - .5rem)}}",
    "#hall-overlay{position:fixed;inset:0;z-index:60;overflow-y:auto;background-color:hsl(var(--background));background-image:var(--gradient-warm);color:hsl(var(--foreground));-webkit-overflow-scrolling:touch}",
    "#hall-overlay .hw{max-width:42rem;margin:0 auto;padding:max(16px,env(safe-area-inset-top)) 16px 48px}",
    "#hall-overlay .hbar{display:flex;align-items:center;justify-content:flex-start;gap:8px;margin-bottom:8px}",
    "html.hall-open #alataa-theme-toggle{z-index:65}",
    "#hall-overlay .hbtn{display:inline-flex;align-items:center;gap:6px;height:40px;padding:0 14px;border-radius:.5rem;border:1px solid hsl(var(--input));background:hsl(var(--background));color:hsl(var(--foreground));font:inherit;font-size:.875rem;cursor:pointer}",
    "#hall-overlay .hbtn svg{width:18px;height:18px;flex:0 0 auto}",
    "#hall-overlay .hhero{text-align:center;margin:8px 0 18px}",
    "#hall-overlay .hlogo{width:64px;height:64px;margin:0 auto 10px;border-radius:999px;background:var(--gradient-primary);display:flex;align-items:center;justify-content:center;box-shadow:var(--shadow-glow);color:#fff}",
    "#hall-overlay .hlogo svg{width:32px;height:32px}",
    "#hall-overlay h1{font-size:1.75rem;font-weight:900;line-height:1.2;margin:0}",
    "#hall-overlay .hsub{font-size:.875rem;color:hsl(var(--muted-foreground));margin-top:4px}",
    "#hall-overlay .htabs{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin:14px 0 18px}",
    "#hall-overlay .htab{height:38px;padding:0 14px;border-radius:999px;border:1px solid hsl(var(--border));background:hsl(var(--card));color:hsl(var(--muted-foreground));font:inherit;font-size:.85rem;cursor:pointer}",
    "#hall-overlay .htab[aria-pressed=true]{background:var(--gradient-primary);color:#fff;border-color:transparent;font-weight:800;box-shadow:var(--shadow-soft)}",
    "#hall-overlay .hpod{display:grid;grid-template-columns:1fr 1.15fr 1fr;gap:10px;align-items:end;margin-bottom:18px}",
    "#hall-overlay .hp{background:var(--gradient-card);border:1px solid hsl(var(--border));border-radius:1rem;padding:14px 8px;text-align:center;box-shadow:var(--shadow-card);min-width:0}",
    "#hall-overlay .hp.p1{padding-top:22px;padding-bottom:22px;border-color:hsl(45 95% 58%);box-shadow:0 10px 40px -10px hsl(45 95% 58% / .55)}",
    "#hall-overlay .hmedal{font-size:2rem;line-height:1}",
    "#hall-overlay .p1 .hmedal{font-size:2.6rem}",
    "#hall-overlay .hname{font-weight:900;margin-top:6px;word-break:break-word;font-size:.95rem}",
    "#hall-overlay .hpts{margin-top:4px;font-weight:900;color:hsl(var(--primary));font-size:1.05rem}",
    "#hall-overlay .hpts small{font-weight:400;color:hsl(var(--muted-foreground));font-size:.72rem;margin-inline-start:3px}",
    "#hall-overlay .hlist{display:grid;gap:10px}",
    "#hall-overlay .hrow{display:flex;align-items:center;gap:12px;background:var(--gradient-card);border:1px solid hsl(var(--border));border-radius:.75rem;padding:12px 14px;box-shadow:var(--shadow-card)}",
    "#hall-overlay .hrank{flex:0 0 auto;width:34px;height:34px;border-radius:999px;background:hsl(var(--muted));display:flex;align-items:center;justify-content:center;font-weight:900;font-size:.9rem}",
    "#hall-overlay .hrow .hname{flex:1;margin:0;min-width:0}",
    "#hall-overlay .hrow .hpts{margin:0}",
    "#hall-overlay .hempty{text-align:center;color:hsl(var(--muted-foreground));padding:40px 12px}",
    "#hall-overlay .hnote{margin-top:22px;text-align:center;font-size:.75rem;color:hsl(var(--muted-foreground));line-height:1.7}",
    "#hall-fix .hrowfix{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid hsl(var(--border))}",
    "#hall-fix input{width:90px;height:36px;border-radius:.5rem;border:1px solid hsl(var(--input));background:hsl(var(--background));color:hsl(var(--foreground));text-align:center;font:inherit}",
  ].join("\n");
  var st = document.createElement("style"); st.id = "alataa-hall-css"; st.textContent = CSS; document.head.append(st);

  var TROPHY = '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>';
  var SVG = function (inner) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + inner + "</svg>"; };
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function fmt(n) { return Number(n).toLocaleString("en"); }

  /* ------------------------------------------------------------------ UI: the wall */
  var overlay = null, current = [], filter = "all", pollTimer = null;

  function render() {
    if (!overlay) return;
    var list = rank(current.filter(function (x) { return filter === "all" || x.stage === filter; }));
    // the filtered view ranks only its own students
    var podium = list.filter(function (x) { return x.rank <= 3; }), rest = list.filter(function (x) { return x.rank > 3; });
    var medals = { 1: "🥇", 2: "🥈", 3: "🥉" };
    var h = "";
    if (!list.length) h = '<div class="hempty">لا توجد نقاط مسجّلة بعد في هذا القسم</div>';
    else {
      var byPlace = function (p) { return podium.filter(function (x) { return x.rank === p; }); };
      var cells = [];
      [2, 1, 3].forEach(function (p) {
        byPlace(p).forEach(function (x) {
          cells.push('<div class="hp p' + p + '"><div class="hmedal">' + medals[p] + '</div><div class="hname">' + esc(x.name) + '</div><div class="hpts">' + fmt(x.earned) + "<small>نقطة</small></div></div>");
        });
      });
      h += '<div class="hpod" style="grid-template-columns:repeat(' + Math.min(3, Math.max(1, cells.length)) + ',1fr)">' + cells.join("") + "</div>";
      if (rest.length) h += '<div class="hlist">' + rest.map(function (x) {
        return '<div class="hrow"><div class="hrank">' + x.rank + '</div><div class="hname">' + esc(x.name) + '</div><div class="hpts">' + fmt(x.earned) + "<small>نقطة</small></div></div>";
      }).join("") + "</div>";
    }
    overlay.querySelector(".hbody").innerHTML = h;
    overlay.querySelectorAll(".htab").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.f === filter)); });
  }

  async function refresh(showErr) {
    try { current = await loadWall(); render(); }
    catch (e) { if (showErr && overlay) overlay.querySelector(".hbody").innerHTML = '<div class="hempty">تعذر تحميل الحائط، تأكد من الاتصال بالإنترنت</div>'; }
  }

  function closeWall(fromPop) {
    if (!overlay) return;
    clearInterval(pollTimer);
    overlay.remove(); overlay = null;
    document.documentElement.style.overflow = "";
    document.documentElement.classList.remove("hall-open");
    if (!fromPop && history.state && history.state.hall) history.back();
  }

  function openWall() {
    if (overlay) return;
    filter = "all";
    overlay = document.createElement("div");
    overlay.id = "hall-overlay";
    overlay.setAttribute("dir", "rtl"); overlay.setAttribute("role", "dialog"); overlay.setAttribute("aria-label", "حائط التمييز");
    overlay.innerHTML =
      '<div class="hw"><div class="hbar"><button class="hbtn" data-a="back" type="button">' + SVG('<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>') + ' رجوع</button>' +
      '<button class="hbtn" data-a="refresh" type="button" aria-label="تحديث">' + SVG('<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>') + "</button></div>" +
      '<div class="hhero"><div class="hlogo">' + SVG(TROPHY) + '</div><h1>حائط التمييز</h1><div class="hsub">مجموع النقاط المكتسبة منذ البداية</div></div>' +
      '<div class="htabs"><button class="htab" data-f="all" type="button">الكل</button><button class="htab" data-f="junior" type="button">' + STAGES.junior + '</button><button class="htab" data-f="senior" type="button">' + STAGES.senior + "</button></div>" +
      '<div class="hbody"><div class="hempty">جاري التحميل...</div></div>' +
      '<p class="hnote">يُحسب هنا كل ما اكتسبه الطالب منذ بدايته حتى لو استخدم نقاطه في الشراء.<br>النقاط التي يعيدها المشرف للطالب لا تُحسب لأنها غير مكتسبة.</p></div>';
    overlay.addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      if (b.dataset.a === "back") closeWall();
      else if (b.dataset.a === "refresh") refresh(true);
      else if (b.dataset.f) { filter = b.dataset.f; render(); }
    });
    document.body.append(overlay);
    document.documentElement.style.overflow = "hidden";
    document.documentElement.classList.add("hall-open");
    try { history.pushState({ hall: 1 }, ""); } catch (e) {}
    refresh(true);
    pollTimer = setInterval(function () { refresh(false); }, 20000);
  }
  window.addEventListener("popstate", function () { if (overlay) closeWall(true); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && overlay) closeWall(); });
  window.__hall.open = openWall;

  /* ------------------------------------------------------------------ UI: the landing button (clone of a stage button = same size/look) */
  function injectLanding() {
    var stage = Array.prototype.find.call(document.querySelectorAll("button[aria-label]"), function (b) { return b.getAttribute("aria-label") === "ابتدائي - متوسط"; });
    if (!stage) return;
    var grid = stage.parentElement;
    if (!grid || !grid.parentElement) return;
    if (grid.parentElement.querySelector("[data-hall-btn]")) return;
    var wrap = document.createElement("div");
    wrap.className = "flex justify-center mb-4 animate-fade-in-up";
    wrap.setAttribute("data-hall-btn", "1");
    var btn = stage.cloneNode(true);                                  // same classes => same width / height / hover
    btn.setAttribute("aria-label", "حائط التمييز");
    btn.className = stage.className;
    btn.style.cssText = "";
    var h2 = btn.querySelector("h2"); if (h2) h2.textContent = "حائط التمييز";
    var svg = btn.querySelector("svg"); if (svg) svg.innerHTML = TROPHY;
    btn.addEventListener("click", function (e) { e.preventDefault(); openWall(); });
    wrap.append(btn);
    grid.parentElement.insertBefore(wrap, grid);
  }

  /* ------------------------------------------------------------------ UI: admin correction (names tab) */
  function injectAdmin() {
    var head = document.querySelector("#admin-section-buyers .admin-section-heading");
    if (!head || head.querySelector("[data-hall-fix]")) return;
    var b = document.createElement("button");
    b.type = "button"; b.setAttribute("data-hall-fix", "1");
    b.className = "hbtn"; b.style.cssText = "display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 12px;border-radius:.5rem;border:1px solid hsl(var(--input));background:hsl(var(--background));color:hsl(var(--foreground));font:inherit;font-size:.8rem;cursor:pointer";
    b.innerHTML = SVG(TROPHY).replace("<svg", '<svg style="width:16px;height:16px"') + " نقاط حائط التمييز";
    b.addEventListener("click", openFix);
    head.append(b);
  }

  async function openFix() {
    var ov = document.createElement("div");
    ov.id = "hall-fix"; ov.setAttribute("dir", "rtl");
    ov.style.cssText = "position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px;font-family:inherit";
    var card = document.createElement("div");
    card.style.cssText = "background:hsl(var(--card));color:hsl(var(--foreground));border-radius:20px;padding:20px;max-width:440px;width:100%;max-height:85vh;overflow:auto;box-shadow:0 10px 40px rgba(0,0,0,.3)";
    card.innerHTML = '<div style="font-weight:900;font-size:1.15rem;margin-bottom:4px">نقاط حائط التمييز</div><div style="font-size:.78rem;color:hsl(var(--muted-foreground));margin-bottom:10px">عدّل مجموع النقاط المكتسبة لأي طالب إن احتجت لتصحيح خطأ (0 يخفيه من الحائط).</div><div class="hfl">جاري التحميل...</div><button type="button" data-x style="margin-top:14px;width:100%;height:42px;border:0;border-radius:12px;background:var(--gradient-primary);color:#fff;font:inherit;font-weight:800;cursor:pointer">إغلاق</button>';
    ov.append(card); document.body.append(ov);
    card.querySelector("[data-x]").onclick = function () { ov.remove(); };
    ov.addEventListener("click", function (e) { if (e.target === ov) ov.remove(); });
    try {
      var rows = (await loadWall()).sort(function (a, b) { return b.earned - a.earned; });
      var box = card.querySelector(".hfl");
      box.innerHTML = rows.map(function (r) {
        return '<div class="hrowfix"><span style="flex:1;font-weight:700;min-width:0;word-break:break-word">' + esc(r.name) + '</span><input type="number" min="0" value="' + r.earned + '" data-id="' + r.id + '"><button type="button" data-s="' + r.id + '" style="height:36px;padding:0 12px;border-radius:.5rem;border:1px solid hsl(var(--input));background:hsl(var(--background));color:hsl(var(--foreground));font:inherit;cursor:pointer">حفظ</button></div>';
      }).join("") || "لا يوجد طلاب بعد";
      box.addEventListener("click", async function (e) {
        var s = e.target.closest("[data-s]"); if (!s) return;
        var id = s.dataset.s, inp = box.querySelector('input[data-id="' + id + '"]');
        var val = Math.max(0, Math.floor(n0(inp.value)));
        s.disabled = true; s.textContent = "...";
        try {
          var row = (await readRow(id)) || {};
          row.earned = val; row.updated = new Date().toISOString();
          await writeRow(id, row);
          s.textContent = "تم ✓";
        } catch (err) { s.textContent = "فشل"; }
        setTimeout(function () { s.disabled = false; s.textContent = "حفظ"; }, 1500);
      });
    } catch (err) { card.querySelector(".hfl").textContent = "تعذر التحميل"; }
  }

  /* ------------------------------------------------------------------ keep the buttons in place while the SPA re-renders */
  var sched = false;
  function schedule() { if (sched) return; sched = true; requestAnimationFrame(function () { sched = false; injectLanding(); injectAdmin(); }); }
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  schedule();
})();
