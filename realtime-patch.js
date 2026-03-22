/**
 * ═══════════════════════════════════════════════════════════════
 *  SENTINEL — Supabase Realtime Patch
 *
 *  HOW TO USE:
 *  1. Add this script to index.html BEFORE src/app.js:
 *       <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
 *       <script src="realtime-patch.js"></script>
 *       <script src="src/app.js"></script>
 *
 *  2. Replace YOUR_SUPABASE_URL and YOUR_SUPABASE_ANON_KEY below
 *     with your project's values from Supabase → Settings → API.
 *     Use the ANON key (not service key) — this is safe for the browser.
 *
 *  3. In Supabase dashboard → Database → Replication → enable
 *     Realtime for tables: posts, comments, announcements, reactions
 *
 *  What this does:
 *  - Subscribes to INSERT/UPDATE/DELETE on posts + comments + announcements
 *  - Updates the in-memory S.posts/S.comments/S.announcements state
 *  - Calls render() so the UI updates instantly — no page refresh needed
 *  - Shows a toast when a new CRITICAL post arrives
 *  - Replaces the 60s polling interval with live push updates
 * ═══════════════════════════════════════════════════════════════
 */

(function () {
  // ── CONFIG — set these to your Supabase project values ──────
  const SUPABASE_URL      = "https://YOUR_PROJECT.supabase.co";
  const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";

  // Bail gracefully if Supabase JS isn't loaded or URL not configured
  if (!window.supabase || SUPABASE_URL.includes("YOUR_PROJECT")) {
    console.warn("[sentinel-rt] Realtime not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in realtime-patch.js");
    return;
  }

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // ── mapPost mirrors api.mjs mapPost for realtime payloads ───
  function mapPost(p) {
    return {
      id:             p.id,
      title:          p.title          || "",
      content:        p.content        || "",
      category:       p.category       || "other",
      urgency:        p.urgency        || "low",
      officials:      p.officials      || "",
      location:       p.location       || "",
      tags:           p.tags           || [],
      media:          p.media          || [],
      anonymous:      !!p.anonymous,
      author:         p.author         || "Anonymous",
      displayName:    p.display_name   || "",
      authorUsername: p.author_username|| "",
      votes:          p.votes          || 0,
      status:         p.status         || "unverified",
      pinned:         !!p.pinned,
      locked:         !!p.locked,
      statusHistory:  p.status_history || [],
      timestamp:      p.timestamp,
      aiUrgency:      p.ai_urgency     || null,
      aiCredibility:  p.ai_credibility || null,
      aiSummary:      p.ai_summary     || "",
    };
  }

  function mapComment(c) {
    return {
      id:             c.id,
      postId:         c.post_id,
      text:           c.text           || "",
      anonymous:      !!c.anonymous,
      author:         c.author         || "Anonymous",
      displayName:    c.display_name   || "",
      authorUsername: c.author_username|| "",
      timestamp:      c.timestamp,
    };
  }

  // ── Wait for app to initialise (S is defined in app.js) ─────
  function whenReady(cb) {
    if (typeof S !== "undefined" && typeof render === "function") {
      cb();
    } else {
      setTimeout(() => whenReady(cb), 200);
    }
  }

  whenReady(() => {
    console.log("[sentinel-rt] Connecting to Supabase Realtime...");

    // ── Posts channel ─────────────────────────────────────────
    sb.channel("rt-posts")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "posts" }, ({ new: row }) => {
        const post = mapPost(row);
        // Prepend new post (pinned posts go to front)
        if (post.pinned) {
          S.posts.unshift(post);
        } else {
          const firstUnpinned = S.posts.findIndex(p => !p.pinned);
          S.posts.splice(firstUnpinned === -1 ? 0 : firstUnpinned, 0, post);
        }
        render();

        // Toast for critical new posts
        if (post.urgency === "critical" && typeof toast === "function") {
          toast(`🚨 CRITICAL: ${post.title.slice(0, 60)}`, "warn", "🚨");
        } else if (typeof addNotif === "function") {
          addNotif(`New post: ${post.title.slice(0, 50)}`, "📋", "info");
        }
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "posts" }, ({ new: row }) => {
        const updated = mapPost(row);
        const idx = S.posts.findIndex(p => p.id === updated.id);
        if (idx !== -1) {
          S.posts[idx] = updated;
          render();
        }
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "posts" }, ({ old: row }) => {
        S.posts = S.posts.filter(p => p.id !== row.id);
        render();
      })
      .subscribe((status) => {
        console.log("[sentinel-rt] posts channel:", status);
      });

    // ── Comments channel ──────────────────────────────────────
    sb.channel("rt-comments")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "comments" }, ({ new: row }) => {
        const cmt = mapComment(row);
        if (!S.comments.find(c => c.id === cmt.id)) {
          S.comments.push(cmt);
          render();
        }
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "comments" }, ({ old: row }) => {
        S.comments = S.comments.filter(c => c.id !== row.id);
        render();
      })
      .subscribe((status) => {
        console.log("[sentinel-rt] comments channel:", status);
      });

    // ── Announcements channel ─────────────────────────────────
    sb.channel("rt-announcements")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "announcements" }, ({ new: row }) => {
        S.announcements.unshift(row);
        if (typeof updateBreakingBanner === "function") updateBreakingBanner();
        render();
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "announcements" }, ({ old: row }) => {
        S.announcements = S.announcements.filter(a => a.id !== row.id);
        if (typeof updateBreakingBanner === "function") updateBreakingBanner();
      })
      .subscribe();

    // ── Cancel the 60s polling interval — realtime replaces it ─
    // Find the interval that calls loadData and clear it.
    // We patch clearInterval globally to catch the right one.
    const _origSetInterval = window.setInterval;
    let _loadDataIntervalId = null;
    window.setInterval = function (fn, delay, ...args) {
      const id = _origSetInterval.call(this, fn, delay, ...args);
      // The app.js polling interval is 60000ms
      if (delay === 60000) {
        _loadDataIntervalId = id;
        console.log("[sentinel-rt] Replacing 60s poll with realtime (interval id:", id, ")");
        clearInterval(id);
        // Still do a poll every 5 minutes as a safety net fallback
        _origSetInterval.call(this, () => {
          if (typeof loadData === "function") loadData();
        }, 5 * 60 * 1000);
      }
      return id;
    };

    console.log("[sentinel-rt] Realtime subscriptions active ✓");
  });
})();
