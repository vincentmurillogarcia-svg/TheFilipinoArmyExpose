import { getStore } from "@netlify/blobs";

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const DEFAULT_CATS = [
  { id: "government", label: "GOVERNMENT",       icon: "🏛" },
  { id: "police",     label: "LAW ENFORCEMENT",  icon: "🚔" },
  { id: "barangay",   label: "BARANGAY / LOCAL", icon: "🏘" },
  { id: "election",   label: "ELECTION / VOTING",icon: "🗳" },
  { id: "budget",     label: "BUDGET / FUNDS",   icon: "💰" },
  { id: "other",      label: "OTHER",            icon: "📋" },
];

const DEFAULT_PASS = "sentinel2024";

// ─── helpers ────────────────────────────────────────────
async function read(store, key, fallback) {
  try { const r = await store.get(key); return r ? JSON.parse(r) : fallback; }
  catch { return fallback; }
}
async function write(store, key, val) {
  await store.set(key, JSON.stringify(val));
}
const ok  = (data = {})       => new Response(JSON.stringify({ ok: true, ...data }), { status: 200, headers: CORS });
const err = (msg, status=400) => new Response(JSON.stringify({ ok: false, error: msg }), { status, headers: CORS });

// ─── main handler ───────────────────────────────────────
export default async (req) => {
  if (req.method === "OPTIONS") return new Response("", { status: 200, headers: CORS });

  const store = getStore({ name: "sentinel", consistency: "strong" });
  const url   = new URL(req.url);
  const route = url.pathname.replace(/^\/api\/?/, "").split("?")[0];

  try {

    // ── GET /api/data ──────────────────────────────────
    if (req.method === "GET" && route === "data") {
      const [posts, comments, announcements, categories, settings] = await Promise.all([
        read(store, "posts",         []),
        read(store, "comments",      []),
        read(store, "announcements", []),
        read(store, "categories",    null),
        read(store, "settings",      {}),
      ]);
      return ok({
        posts,
        comments,
        announcements,
        categories: categories || DEFAULT_CATS,
        hasCustomPasskey: !!(settings?.passkey),
      });
    }

    // ── POST routes ────────────────────────────────────
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    // POST /api/posts — create a report
    if (route === "posts") {
      const posts = await read(store, "posts", []);
      const post  = {
        ...body,
        id: body.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 5)),
        votes: 0,
        status: "unverified",
        pinned: false,
        timestamp: new Date().toISOString(),
      };
      posts.unshift(post);
      await write(store, "posts", posts);
      return ok({ id: post.id });
    }

    // POST /api/comments
    if (route === "comments") {
      const comments = await read(store, "comments", []);
      comments.push({ ...body, timestamp: new Date().toISOString() });
      await write(store, "comments", comments);
      return ok();
    }

    // POST /api/votes  { postId, delta: +1/-1/-2/+2 }
    if (route === "votes") {
      const { postId, delta } = body;
      if (!postId || !delta) return err("Missing postId or delta");
      const posts = await read(store, "posts", []);
      const post  = posts.find(p => p.id === postId);
      if (!post) return err("Post not found", 404);
      post.votes = (post.votes || 0) + Number(delta);
      await write(store, "posts", posts);
      return ok({ votes: post.votes });
    }

    // POST /api/flag  { id }  — public flag a post for review
    if (route === "flag") {
      const posts = await read(store, "posts", []);
      const post  = posts.find(p => p.id === body.id);
      if (post) { post.status = "reviewing"; await write(store, "posts", posts); }
      return ok();
    }

    // POST /api/admin  — all protected dev actions
    if (route === "admin") {
      const { action, passkey, data } = body;
      const settings    = await read(store, "settings", {});
      const correctPass = settings.passkey || DEFAULT_PASS;
      if (passkey !== correctPass) return err("Invalid passkey", 401);

      switch (action) {

        case "announce": {
          const anns = await read(store, "announcements", []);
          anns.unshift({ title: data.title, content: data.content, timestamp: new Date().toISOString() });
          await write(store, "announcements", anns);
          break;
        }
        case "clearAnn": await write(store, "announcements", []); break;

        case "dismissAnn": {
          const anns = await read(store, "announcements", []);
          anns.splice(data.index, 1);
          await write(store, "announcements", anns);
          break;
        }
        case "pin": {
          const posts = await read(store, "posts", []);
          const p = posts.find(x => x.id === data.id);
          if (p) { p.pinned = data.pinned; await write(store, "posts", posts); }
          break;
        }
        case "unpinAll": {
          const posts = await read(store, "posts", []);
          posts.forEach(p => p.pinned = false);
          await write(store, "posts", posts);
          break;
        }
        case "status": {
          const posts = await read(store, "posts", []);
          const p = posts.find(x => x.id === data.id);
          if (p) { p.status = data.status; await write(store, "posts", posts); }
          break;
        }
        case "delete": {
          const posts    = await read(store, "posts",    []);
          const comments = await read(store, "comments", []);
          await Promise.all([
            write(store, "posts",    posts.filter(p => p.id !== data.id)),
            write(store, "comments", comments.filter(c => c.postId !== data.id)),
          ]);
          break;
        }
        case "passkey": {
          if (!data.newPasskey || data.newPasskey.length < 6) return err("Passkey must be 6+ chars");
          settings.passkey = data.newPasskey;
          await write(store, "settings", settings);
          break;
        }
        case "categories": {
          if (!Array.isArray(data.categories)) return err("Invalid categories");
          await write(store, "categories", data.categories);
          break;
        }
        default: return err("Unknown action");
      }

      return ok();
    }

    return err("Not found", 404);

  } catch (e) {
    console.error("[sentinel-api]", e);
    return err(e.message, 500);
  }
};

export const config = { path: "/api/*" };
