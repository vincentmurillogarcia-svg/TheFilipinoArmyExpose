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
    if (log.length > 500) log.length = 500;
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
    avatarEmoji: u.avatarEmoji  || "👤",
    avatarImage: u.avatarImage  || "",    // base64 or future Cloudinary URL
    avatarUrl:   u.avatarUrl    || null,  // Cloudinary-ready (future)
    bio:         u.bio || "",
    bannerColor: u.bannerColor || "#0d4a6b",
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

      // ── updateProfile ─────────────────────────────────
      // password === "__skip__"         → first-time welcome modal, skip check
      // password === "__profile_only__" → changing profile fields only (no pw change), skip check
      // Otherwise: verify current password
      if (action === "updateProfile") {
        const users = await read(store, "users", {});
        const user  = users[uname];
        if (!user) return err("User not found");

        const skipPw = password === "__skip__" || password === "__profile_only__";
        if (!skipPw && user.passwordHash !== hashPw(password)) {
          return err("Current password is incorrect");
        }

        const { displayName, bio, avatarEmoji, avatarUrl, avatarImage, bannerColor, newPassword } = body;
        if (displayName !== undefined && displayName !== "") user.displayName = displayName.trim().slice(0, 30);
        if (bio !== undefined)         user.bio         = bio.trim().slice(0, 200);
        if (avatarEmoji)               user.avatarEmoji = avatarEmoji;
        if (avatarUrl !== undefined)   user.avatarUrl   = avatarUrl || null;
        // avatarImage: small base64 thumbnail (compressed, max ~200KB)
        if (avatarImage !== undefined) {
          if (avatarImage.length > 350000) return err("Profile photo too large — use a smaller image");
          user.avatarImage = avatarImage;
        }
        if (bannerColor)               user.bannerColor = bannerColor;
        if (newPassword && !skipPw) {
          if (newPassword.length < 6) return err("New password must be at least 6 characters");
          user.passwordHash = hashPw(newPassword);
        }
        user.needsProfileUpdate = false;
        await write(store, "users", users);
        await addLog(store, "UPDATE_PROFILE", uname);
        return ok(safeUser(user));
      }

      // ── changePassword ───────────────────────────────
      // Separate from updateProfile; always requires current password.
      if (action === "changePassword") {
        const users = await read(store, "users", {});
        const user  = users[uname];
        if (!user)                                    return err("User not found");
        if (user.passwordHash !== hashPw(password))   return err("Current password is incorrect");
        const { newPassword } = body;
        if (!newPassword || newPassword.length < 6)   return err("New password must be at least 6 characters");
        user.passwordHash = hashPw(newPassword);
        await write(store, "users", users);
        await addLog(store, "PASSWORD_CHANGE", uname);
        return ok({ message: "Password changed" });
      }

      // ── changeUsername ────────────────────────────────
      // Requires current password. Moves record, updates posts & comments.
      if (action === "changeUsername") {
        const users    = await read(store, "users", {});
        const user     = users[uname];
        if (!user)                                   return err("User not found");
        if (user.passwordHash !== hashPw(password))  return err("Current password is incorrect");

        const newUsername = (body.newUsername || "").trim().toLowerCase();
        if (!newUsername || newUsername.length < 3)  return err("New username must be 3+ characters");
        if (!/^[a-z0-9_.-]+$/.test(newUsername))     return err("Username: letters, numbers, _ . - only");
        if (users[newUsername])                       return err("Username already taken");

        // Migrate user record
        user.username = newUsername;
        users[newUsername] = user;
        delete users[uname];
        await write(store, "users", users);

        // Migrate posts
        const posts = await read(store, "posts", []);
        posts.forEach(p => { if (p.authorUsername === uname) p.authorUsername = newUsername; });
        await write(store, "posts", posts);

        // Migrate comments
        const comments = await read(store, "comments", []);
        comments.forEach(c => { if (c.authorUsername === uname) c.authorUsername = newUsername; });
        await write(store, "comments", comments);

        await addLog(store, "CHANGE_USERNAME", `${uname} → ${newUsername}`);
        return ok({ ...safeUser(user), newUsername });
      }

      return err("Unknown auth action");
    }

    // ══════════════════════════════════════════════════════
    // POST /api/posts
    // ══════════════════════════════════════════════════════
    if (route === "posts") {
      if (!body.title || !body.content) return err("Title and content required");
      const posts = await read(store, "posts", []);
      const post = {
        id:            body.id || genId(),
        title:         body.title.trim().slice(0, 200),
        content:       body.content.trim(),
        category:      body.category || "other",
        urgency:       body.urgency  || "low",
        officials:     (body.officials || "").trim(),
        location:      (body.location  || "").trim(),
        tags:          (body.tags || []).slice(0, 10).map(t => t.toString().slice(0, 30)),
        media:         (body.media || []).slice(0, 5),
        anonymous:     !!body.anonymous,
        author:        body.author || "Anonymous",
        displayName:   body.displayName || body.author || "Anonymous",
        authorUsername:body.authorUsername || null,
        votes:         0,
        status:        "unverified",
        pinned:        false,
        locked:        false,
        statusHistory: [{ status: "unverified", timestamp: new Date().toISOString() }],
        timestamp:     new Date().toISOString(),
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
      if (!body.postId || !body.text) return err("postId and text required");
      const comments = await read(store, "comments", []);
      const cmt = {
        id:            body.id || genId(),
        postId:        body.postId,
        text:          body.text.trim().slice(0, 2000),
        anonymous:     !!body.anonymous,
        author:        body.author || "Anonymous",
        displayName:   body.displayName || body.author || "Anonymous",
        authorUsername:body.authorUsername || null,
        timestamp:     new Date().toISOString(),
      };
      comments.push(cmt);
      await write(store, "comments", comments);
      return ok({ id: cmt.id });
    }

    // ══════════════════════════════════════════════════════
    // POST /api/votes
    // ══════════════════════════════════════════════════════
    if (route === "votes") {
      const { postId, delta } = body;
      if (!postId) return err("postId required");
      const posts = await read(store, "posts", []);
      const post  = posts.find(p => p.id === postId);
      if (!post) return err("Post not found");
      post.votes = (post.votes || 0) + (delta > 0 ? 1 : -1);
      await write(store, "posts", posts);
      return ok({ votes: post.votes });
    }

    // ══════════════════════════════════════════════════════
    // POST /api/reactions
    // ══════════════════════════════════════════════════════
    if (route === "reactions") {
      const { postId, emoji, username } = body;
      if (!postId || !emoji || !username) return err("postId, emoji, username required");
      const reactions = await read(store, "reactions", {});
      if (!reactions[postId]) reactions[postId] = {};
      const VALID = ["👍","❤️","😮","😡","😢"];
      if (!VALID.includes(emoji)) return err("Invalid reaction");

      // Remove any existing reaction from this user
      VALID.forEach(e => {
        if (reactions[postId][e]) {
          const idx = reactions[postId][e].indexOf(username);
          if (idx > -1) reactions[postId][e].splice(idx, 1);
        }
      });

      // Toggle: if this was already the user's reaction, it's removed (toggle off)
      if (!reactions[postId][emoji]) reactions[postId][emoji] = [];
      // We already removed above — if the user reacted with same emoji, it's now removed (toggled off)
      // Check if user had this emoji before removal: toggled off means we're done
      // Re-add only if they didn't have it before
      const hadBefore = (reactions[postId][emoji] || []).includes(username);
      if (!hadBefore) {
        if (!reactions[postId][emoji]) reactions[postId][emoji] = [];
        reactions[postId][emoji].push(username);
      }

      await write(store, "reactions", reactions);
      return ok({ reactions: reactions[postId] });
    }

    // ══════════════════════════════════════════════════════
    // POST /api/flag
    // ══════════════════════════════════════════════════════
    if (route === "flag") {
      await addLog(store, "FLAG", body.id || "unknown");
      return ok();
    }

    // ══════════════════════════════════════════════════════
    // POST /api/tips
    // ══════════════════════════════════════════════════════
    if (route === "tips") {
      if (!body.title || !body.description) return err("Title and description required");
      const tips = await read(store, "tips", []);
      tips.unshift({
        id:          genId(),
        title:       body.title.trim().slice(0, 200),
        description: body.description.trim(),
        category:    body.category || "other",
        urgency:     body.urgency  || "low",
        contact:     (body.contact || "").trim(),
        status:      "pending",
        timestamp:   new Date().toISOString(),
      });
      await write(store, "tips", tips);
      await addLog(store, "TIP_RECEIVED", body.title);
      return ok();
    }

    // ══════════════════════════════════════════════════════
    // POST /api/admin  — developer actions
    // ══════════════════════════════════════════════════════
    if (route === "admin") {
      const { passkey, action, data = {} } = body;
      const settings = await read(store, "settings", {});
      const validKey = settings.passkey || DEFAULT_PASS;
      if (passkey !== validKey) return err("Invalid passkey", 401);

      switch (action) {

        // ── Post status ──────────────────────────────────
        case "status": {
          const posts = await read(store, "posts", []);
          const post  = posts.find(p => p.id === data.id);
          if (!post) return err("Post not found");
          if (!post.statusHistory) post.statusHistory = [];
          post.status = data.status;
          post.statusHistory.push({ status: data.status, timestamp: new Date().toISOString() });
          await write(store, "posts", posts);
          await addLog(store, "STATUS", `"${post.title}" → ${data.status}`);
          break;
        }

        // ── Urgency ──────────────────────────────────────
        case "urgency": {
          const posts = await read(store, "posts", []);
          const post  = posts.find(p => p.id === data.id);
          if (!post) return err("Post not found");
          post.urgency = data.urgency;
          await write(store, "posts", posts);
          await addLog(store, "URGENCY", `"${post.title}" → ${data.urgency}`);
          break;
        }

        // ── Pin ───────────────────────────────────────────
        case "pin": case "unpin": {
          const posts = await read(store, "posts", []);
          const post  = posts.find(p => p.id === data.id);
          if (!post) return err("Post not found");
          post.pinned = action === "pin";
          await write(store, "posts", posts);
          await addLog(store, action.toUpperCase(), post.title);
          break;
        }

        // ── Lock ──────────────────────────────────────────
        case "lock": case "unlock": {
          const posts = await read(store, "posts", []);
          const post  = posts.find(p => p.id === data.id);
          if (!post) return err("Post not found");
          post.locked = action === "lock";
          await write(store, "posts", posts);
          await addLog(store, action.toUpperCase(), post.title);
          break;
        }

        // ── Edit ──────────────────────────────────────────
        case "editPost": {
          const posts = await read(store, "posts", []);
          const post  = posts.find(p => p.id === data.id);
          if (!post) return err("Post not found");
          if (data.title)     post.title     = data.title.trim();
          if (data.content)   post.content   = data.content.trim();
          if (data.officials !== undefined) post.officials = data.officials.trim();
          if (data.location  !== undefined) post.location  = data.location.trim();
          post.editedByAdmin = true;
          post.editedAt      = new Date().toISOString();
          await write(store, "posts", posts);
          await addLog(store, "EDIT_POST", post.title);
          break;
        }

        // ── Bulk ──────────────────────────────────────────
        case "bulkStatus": {
          const posts = await read(store, "posts", []);
          const ids   = new Set(data.ids || []);
          posts.forEach(p => {
            if (ids.has(p.id)) {
              p.status = data.status;
              if (!p.statusHistory) p.statusHistory = [];
              p.statusHistory.push({ status: data.status, timestamp: new Date().toISOString() });
            }
          });
          await write(store, "posts", posts);
          await addLog(store, "BULK_STATUS", `${ids.size} posts → ${data.status}`);
          break;
        }
        case "bulkDelete": {
          const [posts, comments] = await Promise.all([read(store,"posts",[]), read(store,"comments",[])]);
          const ids = new Set(data.ids || []);
          await Promise.all([
            write(store, "posts",    posts.filter(p => !ids.has(p.id))),
            write(store, "comments", comments.filter(c => !ids.has(c.postId))),
          ]);
          await addLog(store, "BULK_DELETE", `${ids.size} posts deleted`);
          break;
        }
        case "unpinAll": {
          const posts = await read(store, "posts", []);
          posts.forEach(p => p.pinned = false);
          await write(store, "posts", posts);
          await addLog(store, "UNPIN_ALL", "All posts unpinned");
          break;
        }

        // ── Announce ──────────────────────────────────────
        case "announce": {
          const anns = await read(store, "announcements", []);
          anns.unshift({ title: data.title, content: data.content, timestamp: new Date().toISOString() });
          await write(store, "announcements", anns);
          await addLog(store, "ANNOUNCE", data.title);
          break;
        }
        case "clearAnn": {
          await write(store, "announcements", []);
          await addLog(store, "CLEAR_ANN", "All announcements cleared");
          break;
        }
        case "dismissAnn": {
          const anns = await read(store, "announcements", []);
          anns.splice(data.index, 1);
          await write(store, "announcements", anns);
          break;
        }

        // ── Claim / Transfer ─────────────────────────────
        case "claimFull": case "claimCo": {
          const posts = await read(store, "posts", []);
          const p     = posts.find(x => x.id === data.id);
          if (!p) return err("Post not found");
          const claimerName = (data.claimerName || "SENTINEL STAFF").trim();
          if (action === "claimFull") {
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
          await addLog(store, "CLAIM_POST", `"${p.title}" → ${claimerName} (${action})`);
          break;
        }

        // ── Delete comment ───────────────────────────────
        case "deleteComment": {
          const comments = await read(store, "comments", []);
          await write(store, "comments", comments.filter(c => c.id !== data.commentId));
          await addLog(store, "DELETE_COMMENT", `Comment: ${data.commentId}`);
          break;
        }

        // ── Delete post ──────────────────────────────────
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

        // ── Accounts: pending ────────────────────────────
        case "getPending": {
          const pending = await read(store, "pendingUsers", []);
          return ok({ pending });
        }
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
            avatarUrl:   null,
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
        case "getAllUsers": {
          const users = await read(store, "users", {});
          const list  = Object.values(users).map(safeUser);
          return ok({ users: list });
        }

        // ── Set role (also used to "claim" account as staff/developer) ──
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

        // ── Dev: force-change user display name ──────────
        case "setDisplayName": {
          const users = await read(store, "users", {});
          const user  = users[data.username];
          if (!user) return err("User not found");
          user.displayName = (data.displayName || "").trim().slice(0, 30);
          await write(store, "users", users);
          await addLog(store, "SET_DISPLAYNAME", `${data.username} → ${data.displayName}`);
          break;
        }

        // ── Tips ──────────────────────────────────────────
        case "getTips": {
          const tips = await read(store, "tips", []);
          return ok({ tips });
        }
        case "postTip": {
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

        // ── Passkey ──────────────────────────────────────
        case "passkey": {
          if (!data.newPasskey || data.newPasskey.length < 6) return err("Passkey must be 6+ chars");
          settings.passkey = data.newPasskey;
          await write(store, "settings", settings);
          await addLog(store, "PASSKEY_CHANGE", "Developer passkey updated");
          break;
        }

        // ── Categories ──────────────────────────────────
        case "categories": {
          if (!Array.isArray(data.categories)) return err("Invalid categories");
          await write(store, "categories", data.categories);
          break;
        }

        // ── Maintenance ─────────────────────────────────
        case "maintenance": {
          settings.maintenance    = !!data.enabled;
          settings.maintenanceMsg = data.message || "";
          await write(store, "settings", settings);
          await addLog(store, "MAINTENANCE", data.enabled ? "Maintenance mode ON" : "Maintenance mode OFF");
          break;
        }

        // ── Activity log ─────────────────────────────────
        case "getLog": {
          const log = await read(store, "activityLog", []);
          return ok({ log });
        }

        // ── Export ───────────────────────────────────────
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
