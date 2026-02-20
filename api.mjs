import { getStore } from "@netlify/blobs";
import { createHash }  from "crypto";

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const DEFAULT_CATS = [
  { id: "government", label: "GOVERNMENT",       icon: "🏛"  },
  { id: "police",     label: "LAW ENFORCEMENT",  icon: "🚔"  },
  { id: "barangay",   label: "BARANGAY / LOCAL", icon: "🏘"  },
  { id: "election",   label: "ELECTION / VOTING",icon: "🗳"  },
  { id: "budget",     label: "BUDGET / FUNDS",   icon: "💰"  },
  { id: "other",      label: "OTHER",            icon: "📋"  },
];

const DEFAULT_PASS = "sentinel2024";

function hashPw(pw) {
  return createHash("sha256").update("sentinel_s4lt_" + pw).digest("hex");
}
async function read(store, key, fallback) {
  try { const r = await store.get(key); return r ? JSON.parse(r) : fallback; }
  catch { return fallback; }
}
async function write(store, key, val) {
  await store.set(key, JSON.stringify(val));
}
const ok  = (d = {})          => new Response(JSON.stringify({ ok: true,  ...d }), { status: 200, headers: CORS });
const err = (msg, status=400) => new Response(JSON.stringify({ ok: false, error: msg }), { status, headers: CORS });

async function addLog(store, action, detail) {
  try {
    const log = await read(store, "activityLog", []);
    log.unshift({ action, detail, timestamp: new Date().toISOString() });
    if (log.length > 150) log.length = 150;
    await write(store, "activityLog", log);
  } catch {}
}

export default async (req) => {
  if (req.method === "OPTIONS") return new Response("", { status: 200, headers: CORS });

  const store = getStore({ name: "sentinel", consistency: "strong" });
  const url   = new URL(req.url);
  const route = url.pathname.replace(/^\/api\/?/, "").split("?")[0];

  try {

    // GET /api/data
    if (req.method === "GET" && route === "data") {
      const [posts, comments, announcements, categories, settings] = await Promise.all([
        read(store, "posts",         []),
        read(store, "comments",      []),
        read(store, "announcements", []),
        read(store, "categories",    null),
        read(store, "settings",      {}),
      ]);
      if (settings.maintenance) {
        return ok({
          maintenance: true,
          maintenanceMsg: settings.maintenanceMsg || "System under maintenance. Please check back soon.",
          posts: [], comments: [], announcements: [],
          categories: categories || DEFAULT_CATS,
        });
      }
      return ok({
        posts, comments, announcements,
        categories: categories || DEFAULT_CATS,
        hasCustomPasskey: !!(settings?.passkey),
      });
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    // POST /api/auth
    if (route === "auth") {
      const { action, username, password } = body;
      if (!username || !password) return err("Username and password required");
      const uname = username.trim().toLowerCase();
      if (uname.length < 3)    return err("Username must be at least 3 characters");
      if (password.length < 6)  return err("Password must be at least 6 characters");
      if (!/^[a-z0-9_.-]+$/.test(uname)) return err("Username: letters, numbers, _ . - only");

      const users  = await read(store, "users", {});
      const pwHash = hashPw(password);

      if (action === "register") {
        if (users[uname]) return err("Username already taken");
        users[uname] = { username: uname, displayName: username.trim(), passwordHash: pwHash, createdAt: new Date().toISOString() };
        await write(store, "users", users);
        await addLog(store, "USER_REGISTER", `New user: ${uname}`);
        return ok({ username: uname, displayName: users[uname].displayName });
      }
      if (action === "login") {
        const user = users[uname];
        if (!user || user.passwordHash !== pwHash) return err("Invalid username or password");
        return ok({ username: uname, displayName: user.displayName });
      }
      return err("Unknown auth action");
    }

    // POST /api/posts
    if (route === "posts") {
      const settings = await read(store, "settings", {});
      if (settings.maintenance) return err("System is under maintenance");
      const posts = await read(store, "posts", []);
      const post  = {
        ...body,
        id: body.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 5)),
        votes: 0, status: "unverified", pinned: false, locked: false,
        statusHistory: [{ status: "unverified", timestamp: new Date().toISOString() }],
        timestamp: new Date().toISOString(),
      };
      posts.unshift(post);
      await write(store, "posts", posts);
      await addLog(store, "NEW_POST", post.title);
      return ok({ id: post.id });
    }

    // POST /api/comments
    if (route === "comments") {
      const settings = await read(store, "settings", {});
      if (settings.maintenance) return err("System is under maintenance");
      const posts = await read(store, "posts", []);
      const post  = posts.find(p => p.id === body.postId);
      if (post?.locked) return err("This report is locked — comments are closed");
      const comments = await read(store, "comments", []);
      const comment  = { ...body, id: body.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 5)), timestamp: new Date().toISOString() };
      comments.push(comment);
      await write(store, "comments", comments);
      return ok();
    }

    // POST /api/votes
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

    // POST /api/flag
    if (route === "flag") {
      const posts = await read(store, "posts", []);
      const post  = posts.find(p => p.id === body.id);
      if (post) { post.status = "reviewing"; await write(store, "posts", posts); }
      return ok();
    }

    // POST /api/admin
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
          await addLog(store, "ANNOUNCE", data.title);
          break;
        }
        case "clearAnn":
          await write(store, "announcements", []);
          await addLog(store, "CLEAR_ANN", "All announcements cleared");
          break;
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
          await addLog(store, data.pinned ? "PIN" : "UNPIN", p?.title || data.id);
          break;
        }
        case "unpinAll": {
          const posts = await read(store, "posts", []);
          posts.forEach(p => p.pinned = false);
          await write(store, "posts", posts);
          await addLog(store, "UNPIN_ALL", "All reports unpinned");
          break;
        }
        case "status": {
          const posts = await read(store, "posts", []);
          const p = posts.find(x => x.id === data.id);
          if (p) {
            p.status = data.status;
            if (!p.statusHistory) p.statusHistory = [];
            p.statusHistory.push({ status: data.status, timestamp: new Date().toISOString() });
            await write(store, "posts", posts);
          }
          await addLog(store, "STATUS", `"${p?.title || data.id}" → ${data.status}`);
          break;
        }
        case "urgency": {
          const posts = await read(store, "posts", []);
          const p = posts.find(x => x.id === data.id);
          if (p) { p.urgency = data.urgency; await write(store, "posts", posts); }
          await addLog(store, "URGENCY", `"${p?.title || data.id}" → ${data.urgency}`);
          break;
        }
        case "lock": {
          const posts = await read(store, "posts", []);
          const p = posts.find(x => x.id === data.id);
          if (p) { p.locked = data.locked; await write(store, "posts", posts); }
          await addLog(store, data.locked ? "LOCK" : "UNLOCK", p?.title || data.id);
          break;
        }
        case "editPost": {
          const posts = await read(store, "posts", []);
          const p = posts.find(x => x.id === data.id);
          if (!p) return err("Post not found");
          if (data.title     !== undefined) p.title     = data.title;
          if (data.content   !== undefined) p.content   = data.content;
          if (data.officials !== undefined) p.officials = data.officials;
          if (data.location  !== undefined) p.location  = data.location;
          p.editedAt = new Date().toISOString();
          p.editedByAdmin = true;
          await write(store, "posts", posts);
          await addLog(store, "EDIT_POST", p.title);
          break;
        }
        case "deleteComment": {
          const comments = await read(store, "comments", []);
          await write(store, "comments", comments.filter(c => c.id !== data.commentId));
          await addLog(store, "DELETE_COMMENT", `Comment: ${data.commentId}`);
          break;
        }
        case "delete": {
          const [posts, comments] = await Promise.all([read(store,"posts",[]), read(store,"comments",[])]);
          const title = posts.find(p => p.id === data.id)?.title || data.id;
          await Promise.all([
            write(store, "posts",    posts.filter(p => p.id !== data.id)),
            write(store, "comments", comments.filter(c => c.postId !== data.id)),
          ]);
          await addLog(store, "DELETE_POST", title);
          break;
        }
        case "passkey": {
          if (!data.newPasskey || data.newPasskey.length < 6) return err("Passkey must be 6+ chars");
          settings.passkey = data.newPasskey;
          await write(store, "settings", settings);
          await addLog(store, "PASSKEY_CHANGE", "Developer passkey updated");
          break;
        }
        case "categories": {
          if (!Array.isArray(data.categories)) return err("Invalid categories");
          await write(store, "categories", data.categories);
          break;
        }
        case "maintenance": {
          settings.maintenance    = !!data.enabled;
          settings.maintenanceMsg = data.message || "";
          await write(store, "settings", settings);
          await addLog(store, "MAINTENANCE", data.enabled ? "Maintenance mode ON" : "Maintenance mode OFF");
          break;
        }
        case "getLog": {
          const log = await read(store, "activityLog", []);
          return ok({ log });
        }
        case "exportData": {
          const [posts, comments, users] = await Promise.all([
            read(store, "posts", []), read(store, "comments", []), read(store, "users", {}),
          ]);
          const safeUsers = Object.fromEntries(
            Object.entries(users).map(([k, v]) => [k, { username: v.username, displayName: v.displayName, createdAt: v.createdAt }])
          );
          await addLog(store, "EXPORT", "Data exported by admin");
          return ok({ posts, comments, users: safeUsers, exportedAt: new Date().toISOString() });
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
