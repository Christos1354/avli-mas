// ===== Η Αυλή μας — κοινός πυρήνας (διακομιστής + δοκιμαστική λειτουργία) =====
var AvliCore = (function () {
  var DAY = 86400000, LIFE = 30 * DAY;
  var SCHEMA = [
    "CREATE TABLE IF NOT EXISTS members(id TEXT PRIMARY KEY, name TEXT, keyhash TEXT UNIQUE, invited_by TEXT, is_admin INTEGER DEFAULT 0, invites_left INTEGER DEFAULT 3, banned INTEGER DEFAULT 0, area TEXT DEFAULT '', about TEXT DEFAULT '', created INTEGER, country TEXT DEFAULT 'CY')",
    "CREATE TABLE IF NOT EXISTS invites(code TEXT PRIMARY KEY, created_by TEXT, used_by TEXT, created INTEGER, used INTEGER)",
    "CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY, secret TEXT, name TEXT, contact TEXT, message TEXT, status TEXT DEFAULT 'pending', code TEXT, created INTEGER)",
    "CREATE TABLE IF NOT EXISTS posts(id TEXT PRIMARY KEY, member_id TEXT, section TEXT, kind TEXT, category TEXT, title TEXT, body TEXT, price TEXT, area TEXT, youtube TEXT, hidden INTEGER DEFAULT 0, created INTEGER, expires INTEGER, country TEXT DEFAULT 'CY')",
    "CREATE TABLE IF NOT EXISTS photos(id TEXT PRIMARY KEY, post_id TEXT, pos INTEGER, data TEXT)",
    "CREATE TABLE IF NOT EXISTS reactions(post_id TEXT, member_id TEXT, type TEXT, PRIMARY KEY(post_id, member_id, type))",
    "CREATE TABLE IF NOT EXISTS comments(id TEXT PRIMARY KEY, post_id TEXT, member_id TEXT, body TEXT, created INTEGER)",
    "CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, from_id TEXT, to_id TEXT, post_id TEXT, body TEXT, created INTEGER, seen INTEGER DEFAULT 0)",
    "CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY, post_id TEXT, member_id TEXT, reason TEXT, created INTEGER, UNIQUE(post_id, member_id))",
    "CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT)",
    "CREATE TABLE IF NOT EXISTS tr(k TEXT PRIMARY KEY, v TEXT)",
    "CREATE INDEX IF NOT EXISTS i_posts ON posts(section, created)",
    "CREATE INDEX IF NOT EXISTS i_posts_c ON posts(country, section, created)",
    "CREATE INDEX IF NOT EXISTS i_photos ON photos(post_id)",
    "CREATE INDEX IF NOT EXISTS i_msg ON messages(to_id, from_id)"
  ];
  var ready = false;
  var KINDS_AVLI = ["Σκέψη", "Ποίημα", "Ιστορία", "Φωτογραφίες", "Βίντεο", "Συνταγή", "Άλλο"];
  var KINDS_MARKET = ["Πουλάω", "Ψάχνω", "Χαρίζω", "Χρειάζομαι"];
  var CATS = ["Σπίτια", "Διαμερίσματα", "Οικόπεδα", "Χωράφια", "Έπιπλα", "Ηλεκτρικές συσκευές", "Είδη σπιτιού", "Ρούχα", "Βιβλία", "Αυτοκίνητα", "Κήπος", "Υπηρεσίες", "Άλλα"];

  function E(status, msg) { var e = new Error(msg); e.status = status; return e; }
  function rnd(n, abc) {
    abc = abc || "abcdefghijkmnpqrstuvwxyz23456789";
    var a = new Uint8Array(n); crypto.getRandomValues(a);
    var s = ""; for (var i = 0; i < n; i++) s += abc[a[i] % abc.length]; return s;
  }
  function newKey() { var A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; return "AVLI-" + rnd(4, A) + "-" + rnd(4, A) + "-" + rnd(4, A); }
  function newCode() { var A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; return rnd(4, A) + "-" + rnd(4, A); }
  async function hash(s) {
    s = String(s || "").trim().toUpperCase();
    if (typeof crypto !== "undefined" && crypto.subtle) {
      var b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("avli:" + s));
      return Array.prototype.map.call(new Uint8Array(b), function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
    }
    var h1 = 0x811c9dc5, h2 = 0x1234567;
    for (var i = 0; i < s.length; i++) { h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619); h2 = Math.imul(h2 ^ s.charCodeAt(i), 2246822519); }
    return "x" + (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16);
  }
  function cc(v, dflt) { v = String(v || "").toUpperCase(); return /^[A-Z]{2}$/.test(v) ? v : (dflt || "CY"); }
  function str(v, max) { v = (v == null ? "" : String(v)).replace(/\u0000/g, "").trim(); return v.length > max ? v.slice(0, max) : v; }
  function ytId(u) {
    u = str(u, 300); if (!u) return "";
    var m = u.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/))([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  }
  function q(db, sql, args) { var p = db.prepare(sql); return (args && args.length ? p.bind.apply(p, args) : p); }
  async function all(db, sql, args) { var r = await q(db, sql, args).all(); return r.results || []; }
  async function first(db, sql, args) { return await q(db, sql, args).first(); }
  async function run(db, sql, args) { return await q(db, sql, args).run(); }

  async function init(db) {
    if (ready) return;
    var cols = ["ALTER TABLE members ADD COLUMN country TEXT DEFAULT 'CY'", "ALTER TABLE posts ADD COLUMN country TEXT DEFAULT 'CY'"];
    try { await db.batch(SCHEMA.slice(0, 11).map(function (s) { return db.prepare(s); })); } catch (e) { }
    for (var i = 0; i < cols.length; i++) { try { await db.prepare(cols[i]).run(); } catch (e) { } }
    await db.batch(SCHEMA.map(function (s) { return db.prepare(s); }));
    ready = true;
  }
  async function clean(db, now) {
    var last = await first(db, "SELECT v FROM meta WHERE k='clean'");
    if (last && now - Number(last.v) < 3600000) return;
    await run(db, "INSERT OR REPLACE INTO meta(k,v) VALUES('clean',?)", [String(now)]);
    var old = "SELECT id FROM posts WHERE expires < ?";
    await db.batch([
      q(db, "DELETE FROM photos WHERE post_id IN (" + old + ")", [now]),
      q(db, "DELETE FROM reactions WHERE post_id IN (" + old + ")", [now]),
      q(db, "DELETE FROM comments WHERE post_id IN (" + old + ")", [now]),
      q(db, "DELETE FROM reports WHERE post_id IN (" + old + ")", [now]),
      q(db, "DELETE FROM posts WHERE expires < ?", [now]),
      q(db, "DELETE FROM messages WHERE created < ?", [now - LIFE]),
      q(db, "DELETE FROM requests WHERE status != 'pending' AND created < ?", [now - LIFE]),
      q(db, "DELETE FROM meta WHERE k LIKE 'ipj:%' AND k NOT LIKE ?", ["%" + new Date(now).toISOString().slice(0, 10)])
    ]);
  }
  var ADMIN = "";
  function pk(s) { return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toUpperCase(); }
  async function who(db, key) {
    if (!key) return null;
    var m = null;
    if (ADMIN && pk(key) === pk(ADMIN)) m = await first(db, "SELECT * FROM members WHERE is_admin=1 ORDER BY created LIMIT 1");
    if (!m) m = await first(db, "SELECT * FROM members WHERE keyhash=?", [await hash(pk(key))]);
    if (!m) m = await first(db, "SELECT * FROM members WHERE keyhash=?", [await hash(key)]);
    if (m && m.banned) throw E(403, "Ο λογαριασμός σου έχει απενεργοποιηθεί.");
    return m;
  }
  function pubMe(m) { return { id: m.id, name: m.name, area: m.area, about: m.about, is_admin: !!m.is_admin, country: m.country || "CY", invites_left: m.is_admin ? 999 : m.invites_left, created: m.created }; }

  async function createMember(db, name, invitedBy, isAdmin, now, country) {
    var key = newKey(), id = rnd(10);
    await run(db, "INSERT INTO members(id,name,keyhash,invited_by,is_admin,invites_left,created,country) VALUES(?,?,?,?,?,?,?,?)",
      [id, name, await hash(pk(key)), invitedBy || null, isAdmin ? 1 : 0, 3, now, cc(country)]);
    return { id: id, key: key };
  }

  async function decorate(db, posts, me) {
    if (!posts.length) return posts;
    var ids = posts.map(function (p) { return p.id; });
    var ph = ids.map(function () { return "?"; }).join(",");
    var photos = await all(db, "SELECT id, post_id FROM photos WHERE post_id IN (" + ph + ") ORDER BY pos", ids);
    var reacts = await all(db, "SELECT post_id, type, COUNT(*) n, SUM(CASE WHEN member_id=? THEN 1 ELSE 0 END) mine FROM reactions WHERE post_id IN (" + ph + ") GROUP BY post_id, type", [me.id].concat(ids));
    var coms = await all(db, "SELECT post_id, COUNT(*) n FROM comments WHERE post_id IN (" + ph + ") GROUP BY post_id", ids);
    posts.forEach(function (p) {
      p.photos = photos.filter(function (x) { return x.post_id === p.id; }).map(function (x) { return x.id; });
      p.heart = 0; p.candle = 0; p.my_heart = false; p.my_candle = false; p.comments = 0;
      reacts.forEach(function (r) { if (r.post_id === p.id) { p[r.type] = r.n; p["my_" + r.type] = r.mine > 0; } });
      coms.forEach(function (c) { if (c.post_id === p.id) p.comments = c.n; });
      p.mine = p.member_id === me.id;
    });
    return posts;
  }

  var POST_COLS = "p.id,p.member_id,p.section,p.kind,p.category,p.title,p.body,p.price,p.area,p.youtube,p.hidden,p.created,p.expires,p.country,m.name author";

  // ---------------- ΚΥΡΙΑ ΣΥΝΑΡΤΗΣΗ ----------------
  async function handle(method, path, body, key, env, query) {
    ADMIN = env.ADMIN_CODE ? String(env.ADMIN_CODE) : "";
    var db = env.DB; if (!db) throw E(500, "Λείπει η βάση δεδομένων (DB) από τις ρυθμίσεις του Cloudflare.");
    body = body || {}; query = query || {};
    var now = env.now || Date.now();
    await init(db);
    await clean(db, now);

    if (path === "ping") {
      var c = await first(db, "SELECT COUNT(*) n FROM members");
      var op = await first(db, "SELECT v FROM meta WHERE k='open'");
      return { ok: true, founded: c.n > 0, open: !op || op.v === "1", kinds: KINDS_AVLI, market: KINDS_MARKET, cats: CATS };
    }
    if (path === "setup" && method === "POST") {
      var c2 = await first(db, "SELECT COUNT(*) n FROM members");
      if (c2.n > 0) throw E(400, "Η Αυλή έχει ήδη ιδρυθεί.");
      if (!env.ADMIN_CODE) throw E(400, "Δεν έχει οριστεί ADMIN_CODE στις ρυθμίσεις του Cloudflare.");
      if (str(body.admin_code, 100) !== String(env.ADMIN_CODE).trim()) throw E(403, "Λάθος κωδικός ιδρυτή.");
      var nm = str(body.name, 40); if (nm.length < 2) throw E(400, "Γράψε το όνομά σου.");
      var a = await createMember(db, nm, null, true, now, body.country);
      return { key: a.key };
    }
    if (path === "join" && method === "POST") {
      var code = str(body.code, 20).toUpperCase();
      var nm2 = str(body.name, 40);
      if (nm2.length < 2) throw E(400, "Γράψε το όνομά σου.");
      if (!body.accept) throw E(400, "Χρειάζεται να αποδεχτείς τους κανόνες της Αυλής.");
      var inv = code ? await first(db, "SELECT * FROM invites WHERE code=?", [code]) : null;
      if (inv && inv.used_by) inv = null;
      if (!inv) {
        var op2 = await first(db, "SELECT v FROM meta WHERE k='open'");
        if (op2 && op2.v === "0") throw E(403, "Η Αυλή δέχεται αυτή τη στιγμή νέα μέλη μόνο με πρόσκληση.");
        var day2 = new Date(now).toISOString().slice(0, 10), ipk = "ipj:" + (env.IP || "x") + ":" + day2;
        var ipc = await first(db, "SELECT v FROM meta WHERE k=?", [ipk]);
        if (ipc && Number(ipc.v) >= 10) throw E(429, "Έγιναν πολλές εγγραφές από αυτή τη σύνδεση σήμερα. Δοκίμασε αύριο.");
        await run(db, "INSERT OR REPLACE INTO meta(k,v) VALUES(?,?)", [ipk, String((ipc ? Number(ipc.v) : 0) + 1)]);
      }
      var b = await createMember(db, nm2, inv ? inv.created_by : null, false, now, body.country);
      if (inv) await run(db, "UPDATE invites SET used_by=?, used=? WHERE code=?", [b.id, now, code]);
      return { key: b.key };
    }
    if (path === "request" && method === "POST") {
      var pend = await first(db, "SELECT COUNT(*) n FROM requests WHERE status='pending'");
      if (pend.n >= 50) throw E(429, "Υπάρχουν πολλές αιτήσεις σε αναμονή. Δοκίμασε ξανά σε λίγες ημέρες.");
      var rn = str(body.name, 40), rc = str(body.contact, 80), rm = str(body.message, 500);
      if (rn.length < 2) throw E(400, "Γράψε το όνομά σου.");
      var rid = rnd(10), sec = rnd(16);
      await run(db, "INSERT INTO requests(id,secret,name,contact,message,created) VALUES(?,?,?,?,?,?)", [rid, sec, rn, rc, rm, now]);
      return { id: rid, secret: sec };
    }
    if (path === "request-status") {
      var r = await first(db, "SELECT status, code, secret FROM requests WHERE id=?", [str(query.id, 20)]);
      if (!r || r.secret !== str(query.secret, 30)) return { status: "missing" };
      return { status: r.status, code: r.status === "approved" ? r.code : null };
    }
    if (path === "login" && method === "POST") {
      var lm = await who(db, body.key);
      if (!lm) throw E(404, "Το κλειδί δεν βρέθηκε. Έλεγξε ότι το έγραψες σωστά.");
      return { me: pubMe(lm) };
    }
    if (path === "invite-info") {
      var ii = await first(db, "SELECT i.used_by, m.name FROM invites i JOIN members m ON m.id=i.created_by WHERE i.code=?", [str(query.code, 20).toUpperCase()]);
      if (!ii || ii.used_by) return { ok: false };
      return { ok: true, from: ii.name };
    }
    if (path === "translate" && method === "POST") {
      var target = str(body.target, 10).toLowerCase();
      var texts = Array.isArray(body.texts) ? body.texts.slice(0, 100).map(function (t) { return str(t, 5000); }) : [];
      var ugc = !!body.ugc;
      if (!/^[a-z]{2,3}(-[a-z]{2})?$/i.test(target) || !texts.length) throw E(400, "Λάθος αίτημα μετάφρασης.");
      if (ugc && !(await who(db, key))) throw E(401, "Χρειάζεται να μπεις στην Αυλή.");
      if (!ugc) texts = texts.map(function (t) { return t.slice(0, 600); });
      var out = texts.slice(), miss = [], keys = [];
      for (var ti = 0; ti < texts.length; ti++) {
        keys[ti] = target + (ugc ? ":a:" : ":el:") + (await hash(texts[ti])).slice(0, 40);
        var hit = await first(db, "SELECT v FROM tr WHERE k=?", [keys[ti]]);
        if (hit) out[ti] = hit.v; else miss.push(ti);
      }
      if (!miss.length) return { translations: out };
      if (!env.TRANSLATE_KEY) return { translations: out, off: true };
      var chars = miss.reduce(function (a, i) { return a + texts[i].length; }, 0);
      var day = new Date(now).toISOString().slice(0, 10), dm = await first(db, "SELECT v FROM meta WHERE k='trday'");
      var used = dm && dm.v.split("|")[0] === day ? Number(dm.v.split("|")[1]) : 0;
      if (used + chars > 300000) return { translations: out, limit: true };
      await run(db, "INSERT OR REPLACE INTO meta(k,v) VALUES('trday',?)", [day + "|" + (used + chars)]);
      var payload = { q: miss.map(function (i) { return texts[i]; }), target: target, format: "text" };
      if (!ugc) payload.source = "el";
      var gr = await fetch("https://translation.googleapis.com/language/translate/v2?key=" + encodeURIComponent(env.TRANSLATE_KEY), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!gr.ok) return { translations: out, off: true };
      var gj = await gr.json(), tl = (gj.data && gj.data.translations) || [];
      var ws = [];
      miss.forEach(function (i, j) { if (tl[j]) { out[i] = tl[j].translatedText; ws.push(q(db, "INSERT OR REPLACE INTO tr(k,v) VALUES(?,?)", [keys[i], out[i]])); } });
      if (ws.length) await db.batch(ws);
      return { translations: out };
    }
    if (path === "photo") {
      var pr = await first(db, "SELECT data FROM photos WHERE id=?", [str(query.id, 20)]);
      if (!pr) throw E(404, "Η φωτογραφία δεν υπάρχει πια.");
      return { photo: pr.data };
    }

    // ----- από εδώ και κάτω μόνο για μέλη -----
    var me = await who(db, key);
    if (!me) throw E(401, "Χρειάζεται να μπεις στην Αυλή.");

    if (path === "me") {
      var unread = await first(db, "SELECT COUNT(*) n FROM messages WHERE to_id=? AND seen=0", [me.id]);
      var expiring = await all(db, "SELECT id, title, body, section, expires FROM posts WHERE member_id=? AND expires < ? ORDER BY expires", [me.id, now + 3 * DAY]);
      var out = pubMe(me); out.unread = unread.n; out.expiring = expiring;
      if (me.is_admin) {
        var pr2 = await first(db, "SELECT COUNT(*) n FROM requests WHERE status='pending'");
        var rp = await first(db, "SELECT COUNT(DISTINCT post_id) n FROM reports");
        out.admin_todo = pr2.n + rp.n;
      }
      return out;
    }
    if (path === "areas") {
      return { areas: (await all(db, "SELECT DISTINCT area FROM posts WHERE country=? AND area != '' ORDER BY area", [cc(query.country)])).map(function (r) { return r.area; }) };
    }
    if (path === "setkey" && method === "POST") {
      var nk2 = str(body.key, 60);
      if (nk2.length < 8) throw E(400, "Το κλειδί θέλει τουλάχιστον 8 γράμματα ή αριθμούς.");
      var h2 = await hash(pk(nk2));
      var taken = await first(db, "SELECT id FROM members WHERE keyhash=?", [h2]);
      if (taken && taken.id !== me.id) throw E(400, "Διάλεξε κάτι πιο προσωπικό, αυτό δεν γίνεται.");
      await run(db, "UPDATE members SET keyhash=? WHERE id=?", [h2, me.id]);
      return { ok: true };
    }
    if (path === "profile" && method === "POST") {
      var pn = str(body.name, 40); if (pn.length < 2) throw E(400, "Το όνομα είναι πολύ μικρό.");
      await run(db, "UPDATE members SET name=?, area=?, about=?, country=? WHERE id=?", [pn, str(body.area, 60), str(body.about, 300), cc(body.country, me.country), me.id]);
      return { ok: true };
    }
    if (path === "invites") {
      var list = await all(db, "SELECT i.code, i.created, i.used, m.name used_name FROM invites i LEFT JOIN members m ON m.id=i.used_by WHERE i.created_by=? ORDER BY i.created DESC LIMIT 50", [me.id]);
      return { invites: list, left: me.is_admin ? 999 : me.invites_left };
    }
    if (path === "invite" && method === "POST") {
      var nc = newCode();
      await run(db, "INSERT INTO invites(code,created_by,created) VALUES(?,?,?)", [nc, me.id, now]);
      return { code: nc };
    }
    if (path === "feed") {
      var sec2 = query.section === "market" ? "market" : "avli";
      var where = "p.section=? AND m.banned=0 AND (p.hidden=0 OR p.member_id=?)", args = [sec2, me.id];
      if (query.country) { where += " AND p.country=?"; args.push(cc(query.country)); }
      if (query.area) { where += " AND p.area=?"; args.push(str(query.area, 60)); }
      if (query.kind) { where += " AND p.kind=?"; args.push(str(query.kind, 30)); }
      if (query.category) { where += " AND p.category=?"; args.push(str(query.category, 40)); }
      if (query.member) { where += " AND p.member_id=?"; args.push(str(query.member, 20)); }
      if (query.search) { where += " AND (p.title LIKE ? OR p.body LIKE ? OR p.area LIKE ?)"; var s = "%" + str(query.search, 60) + "%"; args.push(s, s, s); }
      if (query.before) { where += " AND p.created < ?"; args.push(Number(query.before) || now); }
      var posts = await all(db, "SELECT " + POST_COLS + " FROM posts p JOIN members m ON m.id=p.member_id WHERE " + where + " ORDER BY p.created DESC LIMIT 15", args);
      return { posts: await decorate(db, posts, me), now: now };
    }
    if (path === "countries") {
      return { countries: await all(db, "SELECT country, COUNT(*) n FROM posts WHERE hidden=0 GROUP BY country") };
    }
    if (path === "mine") {
      var mp = await all(db, "SELECT " + POST_COLS + " FROM posts p JOIN members m ON m.id=p.member_id WHERE p.member_id=? ORDER BY p.created DESC LIMIT 60", [me.id]);
      return { posts: await decorate(db, mp, me), now: now };
    }
    if (path === "post" && method === "POST") {
      var today = await first(db, "SELECT COUNT(*) n FROM posts WHERE member_id=? AND created > ?", [me.id, now - DAY]);
      if (today.n >= 20 && !me.is_admin) throw E(429, "Έκανες πολλές αναρτήσεις σήμερα. Συνέχισε αύριο.");
      var section = body.section === "market" ? "market" : "avli";
      var kind = str(body.kind, 30);
      var okKinds = section === "market" ? KINDS_MARKET : KINDS_AVLI;
      if (okKinds.indexOf(kind) < 0) kind = section === "market" ? "Πουλάω" : "Σκέψη";
      var cat = section === "market" ? (CATS.indexOf(body.category) >= 0 ? body.category : "Άλλα") : "";
      var title = str(body.title, 120), text = str(body.body, 6000);
      var yt = ytId(body.youtube);
      if (yt === null) throw E(400, "Ο σύνδεσμος βίντεο δεν είναι από το YouTube.");
      var photos = Array.isArray(body.photos) ? body.photos.slice(0, 4) : [];
      for (var i = 0; i < photos.length; i++) {
        if (typeof photos[i] !== "string" || photos[i].indexOf("data:image/") !== 0) throw E(400, "Μη έγκυρη φωτογραφία.");
        if (photos[i].length > 900000) throw E(400, "Μια φωτογραφία είναι πολύ μεγάλη.");
      }
      if (!title && !text && !photos.length && !yt) throw E(400, "Η ανάρτηση είναι άδεια.");
      if (section === "market" && !title) throw E(400, "Γράψε τίτλο για την αγγελία.");
      var pid = rnd(12);
      var stmts = [q(db, "INSERT INTO posts(id,member_id,section,kind,category,title,body,price,area,youtube,created,expires,country) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [pid, me.id, section, kind, cat, title, text, kind === "Χαρίζω" ? "Δωρεάν" : str(body.price, 40), str(body.area, 60), yt || "", now, now + LIFE, cc(body.country, me.country)])];
      photos.forEach(function (d, i) { stmts.push(q(db, "INSERT INTO photos(id,post_id,pos,data) VALUES(?,?,?,?)", [rnd(14), pid, i, d])); });
      await db.batch(stmts);
      return { id: pid };
    }
    var pidq = str(body.id || query.id, 20);
    async function getPost() { var p = await first(db, "SELECT * FROM posts WHERE id=?", [pidq]); if (!p) throw E(404, "Η ανάρτηση δεν υπάρχει πια."); return p; }

    if (path === "renew" && method === "POST") {
      var p1 = await getPost(); if (p1.member_id !== me.id) throw E(403, "Μόνο ο κάτοχος μπορεί να την ανανεώσει.");
      await run(db, "UPDATE posts SET expires=? WHERE id=?", [now + LIFE, pidq]); return { ok: true };
    }
    if (path === "delete" && method === "POST") {
      var p2 = await getPost(); if (p2.member_id !== me.id && !me.is_admin) throw E(403, "Δεν μπορείς να τη σβήσεις.");
      await db.batch(["photos", "reactions", "comments", "reports"].map(function (t) { return q(db, "DELETE FROM " + t + " WHERE post_id=?", [pidq]); })
        .concat([q(db, "DELETE FROM posts WHERE id=?", [pidq])]));
      return { ok: true };
    }
    if (path === "react" && method === "POST") {
      await getPost(); var t = body.type === "candle" ? "candle" : "heart";
      var ex = await first(db, "SELECT 1 x FROM reactions WHERE post_id=? AND member_id=? AND type=?", [pidq, me.id, t]);
      if (ex) await run(db, "DELETE FROM reactions WHERE post_id=? AND member_id=? AND type=?", [pidq, me.id, t]);
      else await run(db, "INSERT INTO reactions(post_id,member_id,type) VALUES(?,?,?)", [pidq, me.id, t]);
      return { on: !ex };
    }
    if (path === "comments") {
      return { comments: await all(db, "SELECT c.id, c.body, c.created, c.member_id, m.name author FROM comments c JOIN members m ON m.id=c.member_id WHERE c.post_id=? ORDER BY c.created", [pidq]) };
    }
    if (path === "comment" && method === "POST") {
      await getPost(); var cb = str(body.body, 1000); if (!cb) throw E(400, "Το σχόλιο είναι άδειο.");
      await run(db, "INSERT INTO comments(id,post_id,member_id,body,created) VALUES(?,?,?,?,?)", [rnd(12), pidq, me.id, cb, now]); return { ok: true };
    }
    if (path === "uncomment" && method === "POST") {
      var cm = await first(db, "SELECT * FROM comments WHERE id=?", [str(body.cid, 20)]);
      if (cm && (cm.member_id === me.id || me.is_admin)) await run(db, "DELETE FROM comments WHERE id=?", [cm.id]);
      return { ok: true };
    }
    if (path === "report" && method === "POST") {
      await getPost();
      await run(db, "INSERT OR IGNORE INTO reports(id,post_id,member_id,reason,created) VALUES(?,?,?,?,?)", [rnd(12), pidq, me.id, str(body.reason, 300), now]);
      var rc2 = await first(db, "SELECT COUNT(*) n FROM reports WHERE post_id=?", [pidq]);
      if (rc2.n >= 3) await run(db, "UPDATE posts SET hidden=1 WHERE id=?", [pidq]);
      return { ok: true };
    }
    if (path === "member") {
      var mm = await first(db, "SELECT id, name, area, about, created, country FROM members WHERE id=? AND banned=0", [str(query.id, 20)]);
      if (!mm) throw E(404, "Το μέλος δεν βρέθηκε."); return mm;
    }
    if (path === "conversations") {
      var cv = await all(db,
        "SELECT CASE WHEN from_id=? THEN to_id ELSE from_id END other, MAX(created) last, SUM(CASE WHEN to_id=? AND seen=0 THEN 1 ELSE 0 END) unread FROM messages WHERE from_id=? OR to_id=? GROUP BY other ORDER BY last DESC",
        [me.id, me.id, me.id, me.id]);
      for (var k = 0; k < cv.length; k++) {
        var om = await first(db, "SELECT name FROM members WHERE id=?", [cv[k].other]);
        var lm2 = await first(db, "SELECT body FROM messages WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?) ORDER BY created DESC LIMIT 1", [me.id, cv[k].other, cv[k].other, me.id]);
        cv[k].name = om ? om.name : "Πρώην μέλος"; cv[k].preview = lm2 ? lm2.body.slice(0, 80) : "";
      }
      return { conversations: cv };
    }
    if (path === "thread") {
      var other = str(query.with, 20);
      var msgs = await all(db, "SELECT x.id, x.from_id, x.body, x.created, x.post_id, p.title post_title FROM messages x LEFT JOIN posts p ON p.id=x.post_id WHERE (x.from_id=? AND x.to_id=?) OR (x.from_id=? AND x.to_id=?) ORDER BY x.created", [me.id, other, other, me.id]);
      await run(db, "UPDATE messages SET seen=1 WHERE to_id=? AND from_id=?", [me.id, other]);
      var on = await first(db, "SELECT name FROM members WHERE id=?", [other]);
      return { messages: msgs, name: on ? on.name : "Πρώην μέλος" };
    }
    if (path === "message" && method === "POST") {
      var to = await first(db, "SELECT id FROM members WHERE id=? AND banned=0", [str(body.to, 20)]);
      if (!to || to.id === me.id) throw E(400, "Δεν βρέθηκε ο παραλήπτης.");
      var mb = str(body.body, 2000); if (!mb) throw E(400, "Το μήνυμα είναι άδειο.");
      var sentToday = await first(db, "SELECT COUNT(*) n FROM messages WHERE from_id=? AND created > ?", [me.id, now - DAY]);
      if (sentToday.n >= 200) throw E(429, "Έστειλες πολλά μηνύματα σήμερα.");
      await run(db, "INSERT INTO messages(id,from_id,to_id,post_id,body,created) VALUES(?,?,?,?,?,?)", [rnd(12), me.id, to.id, str(body.post_id, 20) || null, mb, now]);
      return { ok: true };
    }

    // ----- διαχείριση -----
    if (path.indexOf("admin") === 0) {
      if (!me.is_admin) throw E(403, "Μόνο για τον διαχειριστή.");
      if (path === "admin") {
        return {
          requests: await all(db, "SELECT id, name, contact, message, created FROM requests WHERE status='pending' ORDER BY created"),
          reports: await all(db, "SELECT p.id, p.title, p.body, p.hidden, m.name author, COUNT(r.id) n, GROUP_CONCAT(r.reason, ' | ') reasons FROM reports r JOIN posts p ON p.id=r.post_id JOIN members m ON m.id=p.member_id GROUP BY p.id ORDER BY n DESC"),
          open: !(await first(db, "SELECT v FROM meta WHERE k='open' AND v='0'")),
          members: await all(db, "SELECT a.id, a.name, a.area, a.country, a.is_admin, a.banned, a.invites_left, a.created, b.name invited_by_name, (SELECT COUNT(*) FROM posts WHERE member_id=a.id) posts FROM members a LEFT JOIN members b ON b.id=a.invited_by ORDER BY a.created")
        };
      }
      var target = str(body.id, 20);
      if (path === "admin/approve") {
        var rq = await first(db, "SELECT * FROM requests WHERE id=? AND status='pending'", [target]); if (!rq) throw E(404, "Η αίτηση δεν βρέθηκε.");
        var ac = newCode();
        await run(db, "INSERT INTO invites(code,created_by,created) VALUES(?,?,?)", [ac, me.id, now]);
        await run(db, "UPDATE requests SET status='approved', code=? WHERE id=?", [ac, target]);
        return { code: ac };
      }
      if (path === "admin/open") { await run(db, "INSERT OR REPLACE INTO meta(k,v) VALUES('open',?)", [body.on ? "1" : "0"]); return { ok: true }; }
      if (path === "admin/reject") { await run(db, "UPDATE requests SET status='rejected' WHERE id=?", [target]); return { ok: true }; }
      if (path === "admin/keep") { await db.batch([q(db, "DELETE FROM reports WHERE post_id=?", [target]), q(db, "UPDATE posts SET hidden=0 WHERE id=?", [target])]); return { ok: true }; }
      if (target === me.id) throw E(400, "Δεν γίνεται για τον εαυτό σου.");
      if (path === "admin/ban") { await run(db, "UPDATE members SET banned=? WHERE id=? AND is_admin=0", [body.on ? 1 : 0, target]); return { ok: true }; }
      if (path === "admin/gift") { await run(db, "UPDATE members SET invites_left=invites_left+3 WHERE id=?", [target]); return { ok: true }; }
      if (path === "admin/newkey") {
        var nk = newKey(); await run(db, "UPDATE members SET keyhash=? WHERE id=? AND is_admin=0", [await hash(pk(nk)), target]); return { key: nk };
      }
    }
    throw E(404, "Άγνωστη ενέργεια.");
  }
  return { handle: handle, ytId: ytId };
})();

// ===== Cloudflare Pages Function: όλες οι διευθύνσεις /api/... =====
export async function onRequest(ctx) {
  const req = ctx.request, url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  const query = Object.fromEntries(url.searchParams);
  let body = {};
  try {
    if (req.method === "POST") {
      const len = Number(req.headers.get("content-length") || 0);
      if (len > 5000000) throw Object.assign(new Error("Το μέγεθος είναι πολύ μεγάλο."), { status: 413 });
      body = await req.json();
    }
    const out = await AvliCore.handle(req.method, path, body, req.headers.get("X-Key") || "", { DB: ctx.env.DB, ADMIN_CODE: ctx.env.ADMIN_CODE, TRANSLATE_KEY: ctx.env.GOOGLE_TRANSLATE_API_KEY, IP: req.headers.get("CF-Connecting-IP") || "" }, query);
    if (out && out.photo) {
      const m = out.photo.match(/^data:(image\/[a-z+]+);base64,(.*)$/);
      const bin = atob(m[2]); const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Response(bytes, { headers: { "Content-Type": m[1], "Cache-Control": "private, max-age=2592000" } });
    }
    return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message || "Σφάλμα" }), { status: e.status || 500, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }
}
