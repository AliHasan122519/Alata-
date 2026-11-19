/*
 * Admin add-on: "حذف وإرجاع الجميع" button in the admin panel > الطلبات tab.
 *
 * With ONE tap it undoes every order:
 *   1) returns the ordered quantities to the store stock      (same rule as the per-order "حذف وإرجاع")
 *   2) returns the points to each student                     (balance += the balance he had when ordering)
 *   3) re-opens ordering for those students                   (removes their cooldown created by the order)
 *   4) deletes the orders
 *
 * It is injected on top of the mirrored site (the site code itself is untouched), so it survives every
 * "Sync from Lovable". It talks to the same Supabase project the site uses (URL + public key come from the
 * <meta name="supabase-url"> / <meta name="supabase-key"> tags written by scripts/build-web.mjs).
 */
(function () {
  "use strict";

  var MARK = "data-refund-all";

  function meta(name) {
    var m = document.querySelector('meta[name="' + name + '"]');
    return m ? m.content : "";
  }
  var URL_ = meta("supabase-url").replace(/\/$/, "");
  var KEY = meta("supabase-key");
  if (!URL_ || !KEY) return;

  /* ------------------------------------------------------------------ REST helpers */
  function rest(method, path, body) {
    var headers = { apikey: KEY, Authorization: "Bearer " + KEY };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    return fetch(URL_ + "/rest/v1/" + path, { method: method, headers: headers, body: body === undefined ? undefined : JSON.stringify(body) })
      .then(function (r) {
        if (!r.ok) throw new Error(method + " " + path.split("?")[0] + " -> HTTP " + r.status);
        return method === "GET" ? r.json() : null;
      });
  }
  var q = encodeURIComponent;
  function has(obj, k) { return Object.prototype.hasOwnProperty.call(obj, k); }

  /* ------------------------------------------------------------------ core logic (exported for tests) */
  function refundOf(order) {
    // The student flow zeroes the whole balance on every order, so the points to give back are the balance
    // he had when ordering. Old orders without that field fall back to the order total.
    return order.buyer_balance != null ? Number(order.buyer_balance) || 0 : Number(order.total_points) || 0;
  }

  function plan(orders, products, buyers) {
    var pById = {}; products.forEach(function (p) { pById[p.id] = p; });
    var bByName = {}; buyers.forEach(function (b) { bByName[b.name] = b; });
    var units = 0, missingUnits = 0, points = 0, skippedBuyers = {}, refundedBuyers = {}, touchedProducts = {};
    orders.forEach(function (o) {
      (o.items || []).forEach(function (it) {
        var n = Number(it.quantity) || 0;
        if (pById[it.product_id]) { units += n; touchedProducts[it.product_id] = true; } else missingUnits += n;
      });
      if (bByName[o.buyer_name]) { points += refundOf(o); refundedBuyers[o.buyer_name] = true; } else skippedBuyers[o.buyer_name] = true;
    });
    return {
      orders: orders.length,
      units: units, products: Object.keys(touchedProducts).length, missingUnits: missingUnits,
      points: points, buyers: Object.keys(refundedBuyers).length, skippedBuyers: Object.keys(skippedBuyers).length,
    };
  }

  /**
   * Runs the refund. `opts.scope(order)` (tests only) limits which orders are touched; `opts.onProgress(done,total)`.
   * Orders are processed one by one (effects first, then the order is deleted), so if something fails midway
   * the remaining orders are untouched and can simply be retried.
   */
  async function execute(orders, products, buyers, opts) {
    opts = opts || {};
    // points handed back are not "earned": tell the Hall of Fame ledger (shell/hall.js) to ignore these balance changes
    window.__hallPause = (window.__hallPause || 0) + 1;
    try { return await executeInner(orders, products, buyers, opts); }
    finally { window.__hallPause = Math.max(0, (window.__hallPause || 1) - 1); }
  }

  async function executeInner(orders, products, buyers, opts) {
    var stock = {}; products.forEach(function (p) { stock[p.id] = Number(p.stock) || 0; });
    var bal = {}; buyers.forEach(function (b) { bal[b.name] = Number(b.balance) || 0; });
    var res = { orders: 0, units: 0, points: 0, buyers: {}, missingUnits: 0, skippedBuyers: {} };

    for (var i = 0; i < orders.length; i++) {
      var o = orders[i];
      var committed = false;
      var undo = []; // best-effort rollback of THIS order if a later step fails, so a retry never double-counts
      try {
        // 1) quantities back to the store (sum per product inside this order)
        var perProduct = {};
        var missing = 0;
        (o.items || []).forEach(function (it) {
          var n = Number(it.quantity) || 0;
          if (!has(stock, it.product_id)) { missing += n; return; }
          perProduct[it.product_id] = (perProduct[it.product_id] || 0) + n;
        });
        for (var pid in perProduct) {
          var prev = stock[pid];
          await rest("PATCH", "products?id=eq." + q(pid), { stock: prev + perProduct[pid] });
          stock[pid] = prev + perProduct[pid];
          undo.push(["products?id=eq." + q(pid), { stock: prev }, function (id, v) { return function () { stock[id] = v; }; }(pid, prev)]);
        }

        // 2) points back to the student
        var give = 0, had = has(bal, o.buyer_name);
        if (had) {
          give = refundOf(o);
          var prevBal = bal[o.buyer_name];
          await rest("PATCH", "buyers?name=eq." + q(o.buyer_name), { balance: prevBal + give });
          bal[o.buyer_name] = prevBal + give;
          undo.push(["buyers?name=eq." + q(o.buyer_name), { balance: prevBal }, function (n, v) { return function () { bal[n] = v; }; }(o.buyer_name, prevBal)]);
        }

        // 3) delete the order (last: until now nothing about this order is final)
        await rest("DELETE", "orders?id=eq." + q(o.id));

        for (var pk in perProduct) res.units += perProduct[pk];
        res.missingUnits += missing;
        if (had) { res.points += give; res.buyers[o.buyer_name] = true; } else res.skippedBuyers[o.buyer_name] = true;
        res.orders++;
        if (opts.onProgress) opts.onProgress(res.orders, orders.length);
        committed = true;
      } catch (err) {
        for (var u = undo.length - 1; u >= 0; u--) {
          try { await rest("PATCH", undo[u][0], undo[u][1]); undo[u][2](); } catch (e2) { /* best effort */ }
        }
        err.partial = res;
        throw err;
      }
      // 4) re-open ordering for this student (best effort: the order is already gone, so never fail the run for it)
      if (committed && has(res.buyers, o.buyer_name)) {
        try { await rest("DELETE", "buyer_cooldowns?buyer_name=eq." + q(o.buyer_name)); } catch (e3) { /* ignore */ }
      }
    }

    return res;
  }

  async function loadAll() {
    var r = await Promise.all([
      rest("GET", "orders?select=*&order=created_at.asc"),
      rest("GET", "products?select=id,stock"),
      rest("GET", "buyers?select=id,name,balance"),
    ]);
    return { orders: r[0], products: r[1], buyers: r[2] };
  }

  window.__refundAll = { plan: plan, execute: execute, loadAll: loadAll, refundOf: refundOf };

  /* ------------------------------------------------------------------ UI */
  function overlay(text) {
    var o = document.createElement("div");
    o.setAttribute("dir", "rtl");
    o.style.cssText = "position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;font-family:inherit;padding:16px;";
    var c = document.createElement("div");
    c.style.cssText = "background:#fff;border-radius:20px;padding:24px 20px;max-width:360px;width:100%;text-align:center;color:hsl(230 35% 15%);box-shadow:0 10px 40px rgba(0,0,0,.3);";
    var t = document.createElement("div");
    t.style.cssText = "font-size:17px;font-weight:800;white-space:pre-line;line-height:1.7;";
    t.textContent = text;
    c.append(t);
    o.append(c);
    document.body.append(o);
    return { set: function (s) { t.textContent = s; }, el: c, close: function () { o.remove(); } };
  }

  function fmt(n) { return Number(n).toLocaleString("ar-EG"); }

  async function onClick(btn) {
    if (btn.disabled) return;
    btn.disabled = true;
    btn.style.opacity = ".6";
    var ov = null;
    try {
      var d = await loadAll();
      if (d.orders.length === 0) { alert("لا توجد طلبات لحذفها"); return; }
      var p = plan(d.orders, d.products, d.buyers);
      var msg = "حذف وإرجاع الجميع\n\nسيتم تنفيذ التالي:\n" +
        "• حذف جميع الطلبات (" + fmt(p.orders) + " طلب)\n" +
        "• إرجاع الكميات إلى المتجر (" + fmt(p.units) + " قطعة في " + fmt(p.products) + " منتج)\n" +
        "• إرجاع النقاط لأصحابها (" + fmt(p.points) + " نقطة لـ " + fmt(p.buyers) + " طالب) — يُضاف لرصيد كل طالب رصيده قبل الطلب\n" +
        "• فتح باب الطلب من جديد لهؤلاء الطلاب\n";
      if (p.missingUnits > 0) msg += "\nتنبيه: " + fmt(p.missingUnits) + " قطعة لمنتجات محذوفة من المتجر لن تُرجع.";
      if (p.skippedBuyers > 0) msg += "\nتنبيه: " + fmt(p.skippedBuyers) + " طالب محذوف من الأسماء لن تُرجع نقاطه.";
      msg += "\n\nلا يمكن التراجع عن هذا الإجراء. هل أنت متأكد؟";
      if (!confirm(msg)) return;

      ov = overlay("جاري الحذف والإرجاع... 0 / " + fmt(d.orders.length));
      var r = await execute(d.orders, d.products, d.buyers, {
        onProgress: function (done, total) { ov.set("جاري الحذف والإرجاع... " + fmt(done) + " / " + fmt(total)); },
      });
      var done = "تم بنجاح ✅\n\n• حُذف " + fmt(r.orders) + " طلب\n• رجعت " + fmt(r.units) + " قطعة إلى المتجر\n• رجعت " + fmt(r.points) + " نقطة إلى " + fmt(Object.keys(r.buyers).length) + " طالب";
      ov.set(done);
      var ok = document.createElement("button");
      ok.textContent = "تم";
      ok.style.cssText = "margin-top:16px;width:100%;height:44px;border:0;border-radius:12px;background:linear-gradient(135deg,hsl(16 85% 55%),hsl(28 92% 62%));color:#fff;font:inherit;font-size:16px;font-weight:800;";
      ok.onclick = function () {
        ov.close(); ov = null;
        // The orders list normally refreshes by itself (realtime). If it still shows the deleted orders, offer a reload
        // (the admin must sign in again after a reload, so we never do it silently).
        setTimeout(function () {
          if (document.querySelector("#admin-section-orders .admin-item") &&
              confirm("تم تنفيذ العملية، لكن القائمة لم تتحدث تلقائياً.\nهل تريد تحديث الصفحة الآن؟ (ستحتاج لتسجيل دخول المشرف من جديد)")) location.reload();
        }, 1500);
      };
      ov.el.append(ok);
    } catch (e) {
      console.error("refund-all failed", e);
      if (ov) ov.close();
      alert("توقفت العملية بسبب خطأ ولم تكتمل. الطلبات المتبقية لم تُمسّ، ويمكنك المحاولة مرة أخرى.\n\n" + (e && e.message ? e.message : ""));
    } finally {
      btn.disabled = false;
      btn.style.opacity = "";
    }
  }

  function inject() {
    var section = document.getElementById("admin-section-orders");
    if (!section) return;
    var pdfBtn = Array.prototype.find.call(section.querySelectorAll("button"), function (b) { return /حفظ PDF/.test(b.textContent); });
    if (!pdfBtn) return;                    // the toolbar only exists while there are orders
    var bar = pdfBtn.parentElement;
    if (bar.querySelector("[" + MARK + "]")) return;

    // Reuse the look of the site's own red "حذف وإرجاع" button so it matches the theme.
    var tpl = Array.prototype.find.call(section.querySelectorAll("button"), function (b) { return b.textContent.trim() === "حذف وإرجاع"; });
    var btn;
    if (tpl) {
      btn = tpl.cloneNode(true);                       // copies classes + trash icon, not React handlers
      btn.className = tpl.className.replace(/\bh-9\b/, "h-10").replace(/\bpx-3\b/, "px-4");
      var walker = document.createTreeWalker(btn, NodeFilter.SHOW_TEXT);
      var node;
      while ((node = walker.nextNode())) { if (/حذف وإرجاع/.test(node.nodeValue)) { node.nodeValue = " حذف وإرجاع الجميع"; break; } }
    } else {
      btn = document.createElement("button");
      btn.textContent = "حذف وإرجاع الجميع";
      btn.style.cssText = "height:40px;padding:0 16px;border:0;border-radius:10px;background:hsl(0 80% 58%);color:#fff;font-weight:700;";
    }
    btn.setAttribute(MARK, "1");
    btn.setAttribute("type", "button");
    btn.addEventListener("click", function () { onClick(btn); });
    bar.append(btn);
  }

  var scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () { scheduled = false; inject(); });
  }
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  schedule();
})();
