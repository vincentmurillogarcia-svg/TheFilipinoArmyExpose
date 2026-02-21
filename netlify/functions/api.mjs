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

const ROLES   = ["citizen", "reporter", "staff", "developer"];
const DEFAULT_PASS = "sentinel2024";

function hashPw(pw) {
  return createHash("sha256").update("sentinel_s4lt_" + pw).digest("hex");
}
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
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
    if (log.length > 200) log.length = 200;
    await write(store, "activityLog", log);
  } catch {}
}

// Safe user shape for client responses (no password hash)
function safeUser(u) {
  if (!u) return null;
  return {
    username:    u.username,
    displayName: u.displayName || u.username,
    role:        u.role || "citizen",
    avatarEmoji: u.avatarEmoji || "👤",
    bio:         u.bio || "",
    bannerColor: u.bannerColor || "#0d1b2b",
    createdAt:   u.createdAt,
    approved:    u.approved !== false,
  };
}

export default async (req) => {
  if (req.method === "OPTIONS") return new Response("", { status: 200, headers: CORS });

  const store = getStore({ name: "sentinel", consistency: "strong" });
  const url   = new URL(req.url);
  const route = url.pathname.replace(/^\/api\/?/, "").split("?")[0];

  try {

    // ══════════════════════════════════════════════════════
    // GET /api/data
    // ══════════════════════════════════════════════════════
    if (req.method === "GET" && route === "data") {
      const [posts, comments, announcements, categories, settings, reactions] = await Promise.all([
        read(store, "posts",         []),
        read(store, "comments",      []),
        read(store, "announcements", []),
        read(store, "categories",    null),
        read(store, "settings",      {}),
        read(store, "reactions",     {}),
      ]);
      if (settings.maintenance) {
        return ok({
          maintenance:    true,
          maintenanceMsg: settings.maintenanceMsg || "System under maintenance. Please check back soon.",
          posts: [], comments: [], announcements: [],
          categories: categories || DEFAULT_CATS,
          reactions: {},
        });
      }
      return ok({
        posts, comments, announcements, reactions,
        categories:      categories || DEFAULT_CATS,
        hasCustomPasskey: !!(settings?.passkey),
      });
    }

    // ══════════════════════════════════════════════════════
    // GET /api/profile/:username
    // ══════════════════════════════════════════════════════
    if (req.method === "GET" && route.startsWith("profile/")) {
      const uname = route.replace("profile/", "").toLowerCase();
      const users = await read(store, "users", {});
      const user  = users[uname];
      if (!user) return err("User not found", 404);
      const posts = await read(store, "posts", []);
      const userPosts = posts
        .filter(p => p.authorUsername === uname && !p.anonymous)
        .map(p => ({ id: p.id, title: p.title, category: p.category, status: p.status, timestamp: p.timestamp, votes: p.votes || 0 }));
      return ok({ user: safeUser(user), posts: userPosts, postCount: userPosts.length });
    }

    // ══════════════════════════════════════════════════════
    // POST body parsing
    // ══════════════════════════════════════════════════════
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    // ══════════════════════════════════════════════════════
    // POST /api/auth
    // ══════════════════════════════════════════════════════
    if (route === "auth") {
      const { action, username, password } = body;
      if (!username || !password) return err("Username and password required");
      const uname = username.trim().toLowerCase();

      if (action === "register") {
        if (uname.length < 3)         return err("Username must be at least 3 characters");
        if (password.length < 6)       return err("Password must be at least 6 characters");
        if (!/^[a-z0-9_.-]+$/.test(uname)) return err("Username: letters, numbers, _ . - only");

        const users   = await read(store, "users",        {});
        const pending = await read(store, "pendingUsers", []);
        if (users[uname])                          return err("Username already taken");
        if (pending.find(p => p.username === uname)) return err("Username already pending approval");

        const { reason, realName, avatarEmoji } = body;
        if (!reason || reason.trim().length < 10) return err("Please provide a reason (10+ characters)");

        pending.push({
          username:    uname,
          displayName: username.trim(),
          passwordHash: hashPw(password),
          reason:      reason.trim(),
          realName:    (realName || "").trim(),
          avatarEmoji: avatarEmoji || "👤",
          createdAt:   new Date().toISOString(),
        });
        await write(store, "pendingUsers", pending);
        await addLog(store, "REGISTER_PENDING", `New pending registration: ${uname}`);
        return ok({ pending: true });
      }

      if (action === "login") {
        const users  = await read(store, "users", {});
        const user   = users[uname];
        if (!user || user.passwordHash !== hashPw(password)) return err("Invalid username or password");
        if (user.approved === false) return err("Your account is pending approval by staff.");

        // Auto-migrate legacy users missing new fields
        let changed = false;
        if (!user.role)        { user.role = "citizen"; changed = true; }
        if (!user.approved)    { user.approved = true;  changed = true; }
        if (!user.avatarEmoji) { user.avatarEmoji = "👤"; changed = true; }
        const needsProfileUpdate = !user.bio && !user.bannerColor;
        if (needsProfileUpdate)  { user.needsProfileUpdate = true; }
        if (changed) await write(store, "users", users);

        await addLog(store, "LOGIN", uname);
        return ok({ ...safeUser(user), needsProfileUpdate });
      }

      if (action === "updateProfile") {
        const users = await read(store, "users", {});
        const user  = users[uname];
        if (!user) return err("User not found");

        // Allow skip for welcome modal (first-time setup), otherwise require current password
        if (password !== "__skip__" && user.passwordHash !== hashPw(password)) {
          return err("Current password is incorrect");
        }

        const { displayName, bio, avatarEmoji, bannerColor, newPassword } = body;
        if (displayName)  user.displayName  = displayName.trim().slice(0, 30);
        if (bio !== undefined) user.bio     = bio.trim().slice(0, 200);
        if (avatarEmoji)  user.avatarEmoji  = avatarEmoji;
        if (bannerColor)  user.bannerColor  = bannerColor;
        if (newPassword) {
          if (newPassword.length < 6) return err("New password must be at least 6 characters");
          user.passwordHash = hashPw(newPassword);
        }
        user.needsProfileUpdate = false;
        await write(store, "users", users);
        await addLog(store, "PROFILE_UPDATE", uname);
        return ok(safeUser(user));
      }

      return err("Unknown auth action");
    }

    // ══════════════════════════════════════════════════════
    // POST /api/posts
    // ══════════════════════════════════════════════════════
    if (route === "posts") {
      const settings = await read(store, "settings", {});
      if (settings.maintenance) return err("System is under maintenance");
      const posts = await read(store, "posts", []);
      const post  = {
        ...body,
        id: body.id || genId(),
        votes: 0, status: "unverified", pinned: false, locked: false,
        statusHistory: [{ status: "unverified", timestamp: new Date().toISOString() }],
        timestamp: new Date().toISOString(),
      };
      posts.unshift(post);
      await write(store, "posts", posts);
      await addLog(store, "NEW_POST", post.title);
      return ok({ id: post.id });
    }

    // ══════════════════════════════════════════════════════
    // POST /api/comments
    // ══════════════════════════════════════════════════════
    if (route === "comments") {
      const settings = await read(store, "settings", {});
      if (settings.maintenance) return err("System is under maintenance");
      const posts   = await read(store, "posts",    []);
      const post    = posts.find(p => p.id === body.postId);
      if (post?.locked) return err("This report is locked — comments are closed");
      const comments = await read(store, "comments", []);
      comments.push({ ...body, id: body.id || genId(), timestamp: new Date().toISOString() });
      await write(store, "comments", comments);
      return ok();
    }

    // ══════════════════════════════════════════════════════
    // POST /api/votes
    // ══════════════════════════════════════════════════════
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

    // ══════════════════════════════════════════════════════
    // POST /api/flag
    // ══════════════════════════════════════════════════════
    if (route === "flag") {
      const posts = await read(store, "posts", []);
      const post  = posts.find(p => p.id === body.id);
      if (post) { post.status = "reviewing"; await write(store, "posts", posts); }
      return ok();
    }

    // ══════════════════════════════════════════════════════
    // POST /api/reactions
    // ══════════════════════════════════════════════════════
    if (route === "reactions") {
      const { postId, emoji, username } = body;
      if (!postId || !emoji || !username) return err("Missing postId, emoji, or username");
      const VALID = ["👍","❤️","😮","😡","😢"];
      if (!VALID.includes(emoji)) return err("Invalid emoji");

      const reactions = await read(store, "reactions", {});
      if (!reactions[postId])        reactions[postId] = {};
      if (!reactions[postId][emoji]) reactions[postId][emoji] = [];

      const list  = reactions[postId][emoji];
      const idx   = list.indexOf(username);
      let   reacted;
      if (idx >= 0) { list.splice(idx, 1); reacted = false; }
      else          { list.push(username); reacted = true; }

      await write(store, "reactions", reactions);
      return ok({ reacted, count: list.length, reactions: reactions[postId] });
    }

    // ══════════════════════════════════════════════════════
    // POST /api/tips
    // ══════════════════════════════════════════════════════
    if (route === "tips") {
      const { title, description, category, urgency, contact } = body;
      if (!title || !description) return err("Title and description are required");
      const tips = await read(store, "tips", []);
      tips.unshift({
        id:          genId(),
        title:       title.trim(),
        description: description.trim(),
        category:    category || "other",
        urgency:     urgency  || "low",
        contact:     (contact || "").trim(),
        status:      "pending",
        createdAt:   new Date().toISOString(),
      });
      await write(store, "tips", tips);
      await addLog(store, "TIP_RECEIVED", title.trim());
      return ok();
    }

    // ══════════════════════════════════════════════════════
    // POST /api/admin
    // ══════════════════════════════════════════════════════
    if (route === "admin") {
      const { action, passkey, data } = body;
      const settings    = await read(store, "settings", {});
      const correctPass = settings.passkey || DEFAULT_PASS;
      if (passkey !== correctPass) return err("Invalid passkey", 401);

      switch (action) {

        // ── Announcements ──────────────────────────────
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

        // ── Pinning ─────────────────────────────────
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

        // ── Status ──────────────────────────────────
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

        // ── Bulk status ─────────────────────────────
        case "bulkStatus": {
          if (!Array.isArray(data.ids)) return err("ids must be an array");
          const posts = await read(store, "posts", []);
          let count = 0;
          posts.forEach(p => {
            if (data.ids.includes(p.id)) {
              p.status = data.status;
              if (!p.statusHistory) p.statusHistory = [];
              p.statusHistory.push({ status: data.status, timestamp: new Date().toISOString() });
              count++;
            }
          });
          await write(store, "posts", posts);
          await addLog(store, "BULK_STATUS", `${count} posts → ${data.status}`);
          return ok({ updated: count });
        }

        // ── Bulk delete ─────────────────────────────
        case "bulkDelete": {
          if (!Array.isArray(data.ids)) return err("ids must be an array");
          const [posts, comments] = await Promise.all([read(store,"posts",[]), read(store,"comments",[])]);
          const removed = posts.filter(p => data.ids.includes(p.id)).length;
          await Promise.all([
            write(store, "posts",    posts.filter(p => !data.ids.includes(p.id))),
            write(store, "comments", comments.filter(c => !data.ids.includes(c.postId))),
          ]);
          await addLog(store, "BULK_DELETE", `${removed} posts deleted`);
          return ok({ deleted: removed });
        }

        // ── Urgency ─────────────────────────────────
        case "urgency": {
          const posts = await read(store, "posts", []);
          const p = posts.find(x => x.id === data.id);
          if (p) { p.urgency = data.urgency; await write(store, "posts", posts); }
          await addLog(store, "URGENCY", `"${p?.title || data.id}" → ${data.urgency}`);
          break;
        }

        // ── Lock ─────────────────────────────────
        case "lock": {
          const posts = await read(store, "posts", []);
          const p = posts.find(x => x.id === data.id);
          if (p) { p.locked = data.locked; await write(store, "posts", posts); }
          await addLog(store, data.locked ? "LOCK" : "UNLOCK", p?.title || data.id);
          break;
        }

        // ── Edit post ────────────────────────────────
        case "editPost": {
          const posts = await read(store, "posts", []);
          const p = posts.find(x => x.id === data.id);
          if (!p) return err("Post not found");
          if (data.title     !== undefined && data.title.trim())     p.title     = data.title.trim();
          if (data.content   !== undefined && data.content.trim())   p.content   = data.content.trim();
          if (data.officials !== undefined && data.officials.trim()) p.officials = data.officials.trim();
          if (data.location  !== undefined && data.location.trim())  p.location  = data.location.trim();
          p.editedAt      = new Date().toISOString();
          p.editedByAdmin = true;
          await write(store, "posts", posts);
          await addLog(store, "EDIT_POST", p.title);
          break;
        }

        // ── Claim / Transfer post ────────────────────
        case "claimPost": {
          const posts = await read(store, "posts", []);
          const p = posts.find(x => x.id === data.id);
          if (!p) return err("Post not found");
          const claimerName = (data.claimerName || "SENTINEL STAFF").trim();
          if (data.mode === "full") {
            p._originalAuthor  = p.author || p.displayName || "Anonymous";
            p._originalAnon    = p.anonymous;
            p.author           = claimerName;
            p.displayName      = claimerName;
            p.anonymous        = false;
            p.claimedFull      = true;
            p.claimedAt        = new Date().toISOString();
          } else {
            p.coClaimed     = true;
            p.coClaimedBy   = claimerName;
            p.coClaimedAt   = new Date().toISOString();
          }
          await write(store, "posts", posts);
          await addLog(store, "CLAIM_POST", `"${p.title}" → ${claimerName} (${data.mode})`);
          break;
        }

        // ── Delete comment ───────────────────────────
        case "deleteComment": {
          const comments = await read(store, "comments", []);
          await write(store, "comments", comments.filter(c => c.id !== data.commentId));
          await addLog(store, "DELETE_COMMENT", `Comment: ${data.commentId}`);
          break;
        }

        // ── Delete post ──────────────────────────────
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

        // ── Accounts: get pending ────────────────────
        case "getPending": {
          const pending = await read(store, "pendingUsers", []);
          return ok({ pending });
        }

        // ── Accounts: approve ────────────────────────
        case "approveUser": {
          const pending = await read(store, "pendingUsers", []);
          const users   = await read(store, "users",        {});
          const idx     = pending.findIndex(p => p.username === data.username);
          if (idx < 0) return err("Pending user not found");
          const pu = pending[idx];
          users[pu.username] = {
            username:    pu.username,
            displayName: pu.displayName,
            passwordHash: pu.passwordHash,
            avatarEmoji: pu.avatarEmoji || "👤",
            bio:         "",
            bannerColor: "#0d1b2b",
            role:        data.role || "citizen",
            approved:    true,
            needsProfileUpdate: true,
            createdAt:   new Date().toISOString(),
          };
          pending.splice(idx, 1);
          await Promise.all([write(store, "users", users), write(store, "pendingUsers", pending)]);
          await addLog(store, "APPROVE_USER", `${pu.username} as ${data.role || "citizen"}`);
          break;
        }

        // ── Accounts: reject ─────────────────────────
        case "rejectUser": {
          const pending = await read(store, "pendingUsers", []);
          const idx     = pending.findIndex(p => p.username === data.username);
          if (idx >= 0) {
            const name = pending[idx].username;
            pending.splice(idx, 1);
            await write(store, "pendingUsers", pending);
            await addLog(store, "REJECT_USER", name);
          }
          break;
        }

        // ── Accounts: get all users ──────────────────
        case "getAllUsers": {
          const users = await read(store, "users", {});
          const list  = Object.values(users).map(safeUser);
          return ok({ users: list });
        }

        // ── Accounts: set role ───────────────────────
        case "setRole": {
          const users = await read(store, "users", {});
          const user  = users[data.username];
          if (!user) return err("User not found");
          if (!ROLES.includes(data.role)) return err("Invalid role");
          user.role = data.role;
          await write(store, "users", users);
          await addLog(store, "SET_ROLE", `${data.username} → ${data.role}`);
          break;
        }

        // ── Tips ──────────────────────────────────────
        case "getTips": {
          const tips = await read(store, "tips", []);
          return ok({ tips });
        }
        case "postTip": {
          // Turn a tip into a real post
          const tips  = await read(store, "tips",  []);
          const posts = await read(store, "posts", []);
          const tip   = tips.find(t => t.id === data.tipId);
          if (!tip) return err("Tip not found");
          const post = {
            id:          genId(),
            title:       tip.title,
            content:     tip.description,
            category:    tip.category || "other",
            urgency:     tip.urgency  || "low",
            author:      data.claimerName || "SENTINEL STAFF",
            displayName: data.claimerName || "SENTINEL STAFF",
            anonymous:   false,
            fromTip:     true,
            votes: 0, status: "unverified", pinned: false, locked: false,
            statusHistory: [{ status: "unverified", timestamp: new Date().toISOString() }],
            timestamp: new Date().toISOString(),
          };
          posts.unshift(post);
          tip.status = "posted";
          await Promise.all([write(store, "posts", posts), write(store, "tips", tips)]);
          await addLog(store, "TIP_POSTED", tip.title);
          return ok({ postId: post.id });
        }
        case "dismissTip": {
          const tips = await read(store, "tips", []);
          const tip  = tips.find(t => t.id === data.tipId);
          if (tip) { tip.status = "dismissed"; await write(store, "tips", tips); }
          await addLog(store, "TIP_DISMISSED", tip?.title || data.tipId);
          break;
        }

        // ── Passkey ──────────────────────────────────
        case "passkey": {
          if (!data.newPasskey || data.newPasskey.length < 6) return err("Passkey must be 6+ chars");
          settings.passkey = data.newPasskey;
          await write(store, "settings", settings);
          await addLog(store, "PASSKEY_CHANGE", "Developer passkey updated");
          break;
        }

        // ── Categories ──────────────────────────────
        case "categories": {
          if (!Array.isArray(data.categories)) return err("Invalid categories");
          await write(store, "categories", data.categories);
          break;
        }

        // ── Maintenance ─────────────────────────────
        case "maintenance": {
          settings.maintenance    = !!data.enabled;
          settings.maintenanceMsg = data.message || "";
          await write(store, "settings", settings);
          await addLog(store, "MAINTENANCE", data.enabled ? "Maintenance mode ON" : "Maintenance mode OFF");
          break;
        }

        // ── Activity log ─────────────────────────────
        case "getLog": {
          const log = await read(store, "activityLog", []);
          return ok({ log });
        }

        // ── Export ───────────────────────────────────
        case "exportData": {
          const [posts, comments, users] = await Promise.all([
            read(store, "posts", []), read(store, "comments", []), read(store, "users", {}),
          ]);
          const safeUsers = Object.fromEntries(
            Object.entries(users).map(([k, v]) => [k, safeUser(v)])
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
