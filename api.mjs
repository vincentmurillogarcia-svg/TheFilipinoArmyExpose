import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import bcrypt from "bcryptjs";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const DEFAULT_PASS = "sentinel2024";

const DEFAULT_CATS = [
  { id: "government", label: "GOVERNMENT",       icon: "🏛"  },
  { id: "police",     label: "LAW ENFORCEMENT",  icon: "🚔"  },
  { id: "barangay",   label: "BARANGAY / LOCAL", icon: "🏘"  },
  { id: "election",   label: "ELECTION / VOTING",icon: "🗳"  },
  { id: "budget",     label: "BUDGET / FUNDS",   icon: "💰"  },
  { id: "other",      label: "OTHER",            icon: "📋"  },
];

const ROLES = ["citizen", "reporter", "staff", "developer"];

function sanitize(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/\//g, "&#x2F;");
}

function legacyHashPw(pw) {
  return createHash("sha256").update("sentinel_s4lt_" + pw).digest("hex");
}

function isLegacyHash(hash) {
  return hash && hash.length === 64 && /^[a-f0-9]+$/.test(hash);
}

async function hashPw(pw) {
  return bcrypt.hash(pw, 12);
}

async function checkPw(pw, hash) {
  if (isLegacyHash(hash)) return legacyHashPw(pw) === hash;
  return bcrypt.compare(pw, hash);
}

function genId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

const RATE_LIMIT = new Map();

function rateLimit(key, max = 30, windowMs = 60000) {
  const now = Date.now();
  const entry = RATE_LIMIT.get(key);
  if (!entry || now - entry.start > windowMs) {
    RATE_LIMIT.set(key, { count: 1, start: now });
    return true;
  }
  if (entry.count >= max) return false;
  entry.count++;
  return true;
}

function cleanOldRateLimits() {
  const now = Date.now();
  for (const [key, entry] of RATE_LIMIT) {
    if (now - entry.start > 120000) RATE_LIMIT.delete(key);
  }
}
setInterval(cleanOldRateLimits, 60000);

const ok  = (d = {})          => new Response(JSON.stringify({ ok: true,  ...d }), { status: 200, headers: CORS });
const err = (msg, status=400) => new Response(JSON.stringify({ ok: false, error: sanitize(msg) }), { status, headers: CORS });

async function getSetting(key, fallback = null) {
  const { data } = await supabase.from("settings").select("value").eq("key", key).single();
  if (!data) return fallback;
  return data.value?.val !== undefined ? data.value.val : data.value;
}

async function setSetting(key, value) {
  const stored = (typeof value === "object" && value !== null) ? value : { val: value };
  await supabase.from("settings").upsert(
    { key, value: stored, updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );
}

async function getAllSettings() {
  const { data } = await supabase.from("settings").select("key, value");
  const result = {};
  (data || []).forEach(row => {
    result[row.key] = row.value?.val !== undefined ? row.value.val : row.value;
  });
  return result;
}

async function addLog(action, detail) {
  try {
    await supabase.from("activity_log").insert({
      action: sanitize(action),
      detail: sanitize(detail)
    });
  } catch (e) {
    console.error("[sentinel-log]", e.message);
  }
}

function safePendingUser(u) {
  if (!u) return null;
  return {
    username:    sanitize(u.username || ""),
    displayName: sanitize(u.display_name || u.username || ""),
    avatarEmoji: sanitize(u.avatar_emoji || "👤"),
    reason:      sanitize(u.reason || ""),
    realName:    sanitize(u.real_name || ""),
    createdAt:   u.created_at,
  };
}

function safeUser(u) {
  if (!u) return null;
  return {
    username:    sanitize(u.username || ""),
    displayName: sanitize(u.display_name || u.username || ""),
    role:        sanitize(u.role || "citizen"),
    avatarEmoji: sanitize(u.avatar_emoji || "👤"),
    avatarImage: u.avatar_image || "",
    avatarUrl:   u.avatar_url   || null,
    bio:         sanitize(u.bio || ""),
    bannerColor: sanitize(u.banner_color || "#0d4a6b"),
    createdAt:   u.created_at,
    approved:    u.approved !== false,
  };
}

function mapPost(p) {
  return {
    id:             sanitize(p.id),
    title:          sanitize(p.title),
    content:        sanitize(p.content),
    category:       sanitize(p.category),
    urgency:        sanitize(p.urgency),
    officials:      sanitize(p.officials || ""),
    location:       sanitize(p.location || ""),
    tags:           (p.tags || []).map(t => sanitize(String(t))).slice(0, 10),
    media:          p.media || [],
    anonymous:      !!p.anonymous,
    author:         sanitize(p.author),
    displayName:    sanitize(p.display_name),
    authorUsername: sanitize(p.author_username),
    votes:          p.votes || 0,
    status:         sanitize(p.status),
    pinned:         !!p.pinned,
    locked:         !!p.locked,
    statusHistory:  (p.status_history || []).map(h => ({
      status: sanitize(h.status),
      timestamp: h.timestamp,
    })),
    fromTip:        !!p.from_tip,
    claimedFull:    !!p.claimed_full,
    coClaimed:      !!p.co_claimed,
    coClaimedBy:    sanitize(p.co_claimed_by || ""),
    editedByAdmin:  !!p.edited_by_admin,
    editedAt:       p.edited_at,
    timestamp:      p.timestamp,
  };
}

function mapComment(c) {
  return {
    id:             sanitize(c.id),
    postId:         sanitize(c.post_id),
    text:           sanitize(c.text),
    anonymous:      !!c.anonymous,
    author:         sanitize(c.author),
    displayName:    sanitize(c.display_name),
    authorUsername: sanitize(c.author_username),
    timestamp:      c.timestamp,
  };
}

export default async (req) => {
  if (req.method === "OPTIONS") return new Response("", { status: 200, headers: CORS });

  const url   = new URL(req.url);
  const route = url.pathname.replace(/^\/api\/?/, "").split("?")[0];
  const ip    = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "unknown";

  try {

    if (req.method === "GET" && route === "data") {
      if (!rateLimit("data_" + ip, 60, 60000)) return err("Too many requests", 429);

      const settings = await getAllSettings();
      const DEFAULT_REACTIONS = ["👍","❤️","😮","😡","😢"];

      if (settings.maintenance) {
        const { data: cats } = await supabase
          .from("categories").select("*").order("sort_order");
        return ok({
          maintenance:     true,
          maintenanceMsg:  settings.maintenanceMsg || "System under maintenance.",
          posts: [], comments: [], announcements: [],
          categories:      cats || DEFAULT_CATS,
          reactions:       {},
          customReactions: settings.customReactions || DEFAULT_REACTIONS,
        });
      }

      const [postsRes, commentsRes, annsRes, catsRes, reactionsRes] = await Promise.all([
        supabase.from("posts").select("*").order("pinned", { ascending: false }).order("timestamp", { ascending: false }),
        supabase.from("comments").select("*").order("timestamp", { ascending: true }),
        supabase.from("announcements").select("*").order("timestamp", { ascending: false }),
        supabase.from("categories").select("*").order("sort_order"),
        supabase.from("reactions").select("post_id, emoji, username"),
      ]);

      const reactions = {};
      (reactionsRes.data || []).forEach(r => {
        if (!reactions[r.post_id]) reactions[r.post_id] = {};
        if (!reactions[r.post_id][r.emoji]) reactions[r.post_id][r.emoji] = [];
        reactions[r.post_id][r.emoji].push(sanitize(r.username));
      });

      return ok({
        posts:           (postsRes.data    || []).map(mapPost),
        comments:        (commentsRes.data || []).map(mapComment),
        announcements:   (annsRes.data     || []).map(a => ({
          ...a,
          title:   sanitize(a.title),
          content: sanitize(a.content),
        })),
        categories:      (catsRes.data     || DEFAULT_CATS),
        reactions,
        hasCustomPasskey: !!(settings.passkey),
        customReactions:  settings.customReactions || DEFAULT_REACTIONS,
      });
    }

    if (req.method === "GET" && route.startsWith("profile/")) {
      if (!rateLimit("profile_" + ip, 30, 60000)) return err("Too many requests", 429);
      const uname = sanitize(route.replace("profile/", "")).toLowerCase();
      const { data: user } = await supabase
        .from("users").select("*").eq("username", uname).single();
      if (!user) return err("User not found", 404);

      const { data: posts } = await supabase
        .from("posts")
        .select("id, title, category, status, timestamp, votes")
        .eq("author_username", uname)
        .eq("anonymous", false)
        .order("timestamp", { ascending: false });

      return ok({ user: safeUser(user), posts: (posts || []).map(p => ({
        ...p,
        title: sanitize(p.title),
        category: sanitize(p.category),
      })), postCount: (posts || []).length });
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    if (route === "auth") {
      const { action, username, password } = body;
      const ipKey = "auth_" + ip;
      if (!rateLimit(ipKey, 10, 60000)) return err("Too many requests. Wait a minute.", 429);

      if (!username || !password) return err("Username and password required");
      const uname = sanitize(username.trim().toLowerCase());

      if (action === "register") {
        if (uname.length < 3)              return err("Username must be at least 3 characters");
        if (password.length < 6)           return err("Password must be at least 6 characters");
        if (!/^[a-z0-9_.-]+$/.test(uname)) return err("Username: letters, numbers, _ . - only");

        const { data: existingUser } = await supabase
          .from("users").select("username").eq("username", uname).single();
        if (existingUser) return err("Username already taken");

        const { data: existingPending } = await supabase
          .from("pending_users").select("username").eq("username", uname).single();
        if (existingPending) return err("Username already pending approval");

        const { reason, realName, avatarEmoji } = body;
        if (!reason || reason.trim().length < 10) return err("Please provide a reason (10+ characters)");

        const { error: insertErr } = await supabase.from("pending_users").insert({
          username:      uname,
          display_name:  sanitize(username.trim()),
          password_hash: await hashPw(password),
          reason:        sanitize(reason.trim()),
          real_name:     sanitize((realName || "").trim()),
          avatar_emoji:  sanitize(avatarEmoji || "👤"),
        });
        if (insertErr) return err("Registration failed");
        await addLog("REGISTER_PENDING", `New pending registration: ${uname}`);
        return ok({ pending: true });
      }

      if (action === "login") {
        const { data: user } = await supabase
          .from("users").select("*").eq("username", uname).single();
        if (!user || !(await checkPw(password, user.password_hash))) {
          return err("Invalid username or password");
        }
        if (user.approved === false) return err("Your account is pending approval by staff.");

        if (isLegacyHash(user.password_hash)) {
          const newHash = await hashPw(password);
          await supabase.from("users")
            .update({ password_hash: newHash })
            .eq("username", uname);
          user.password_hash = newHash;
        }

        await addLog("LOGIN", uname);
        return ok({ ...safeUser(user), needsProfileUpdate: user.needs_profile_update });
      }

      if (action === "updateProfile") {
        const { data: user } = await supabase
          .from("users").select("*").eq("username", uname).single();
        if (!user) return err("User not found");

        const skipPw = password === "__skip__" || password === "__profile_only__";
        if (!skipPw && !(await checkPw(password, user.password_hash))) {
          return err("Current password is incorrect");
        }

        const { displayName, bio, avatarEmoji, avatarUrl, avatarImage, bannerColor, newPassword } = body;
        const updates = { needs_profile_update: false };
        if (displayName)              updates.display_name  = sanitize(displayName.trim().slice(0, 30));
        if (bio !== undefined)        updates.bio           = sanitize(bio.trim().slice(0, 200));
        if (avatarEmoji)              updates.avatar_emoji  = sanitize(avatarEmoji.slice(0, 8));
        if (avatarUrl !== undefined)  updates.avatar_url    = avatarUrl ? sanitize(avatarUrl) : null;
        if (avatarImage !== undefined) {
          if (avatarImage.length > 350000) return err("Profile photo too large");
          updates.avatar_image = sanitize(avatarImage);
        }
        if (bannerColor)              updates.banner_color  = sanitize(bannerColor.slice(0, 20));
        if (newPassword && !skipPw) {
          if (newPassword.length < 6) return err("New password must be at least 6 characters");
          updates.password_hash = await hashPw(newPassword);
        }

        const { data: updated } = await supabase
          .from("users").update(updates).eq("username", uname).select().single();
        await addLog("UPDATE_PROFILE", uname);
        return ok(safeUser(updated));
      }

      if (action === "changePassword") {
        const { data: user } = await supabase
          .from("users").select("*").eq("username", uname).single();
        if (!user) return err("User not found");
        if (!(await checkPw(password, user.password_hash))) return err("Current password is incorrect");
        const { newPassword } = body;
        if (!newPassword || newPassword.length < 6) return err("New password must be at least 6 characters");
        await supabase.from("users")
          .update({ password_hash: await hashPw(newPassword) }).eq("username", uname);
        await addLog("PASSWORD_CHANGE", uname);
        return ok({ message: "Password changed" });
      }

      if (action === "changeUsername") {
        const { data: user } = await supabase
          .from("users").select("*").eq("username", uname).single();
        if (!user) return err("User not found");
        if (!(await checkPw(password, user.password_hash))) return err("Current password is incorrect");

        const newUsername = sanitize((body.newUsername || "").trim().toLowerCase());
        if (!newUsername || newUsername.length < 3) return err("New username must be 3+ characters");
        if (!/^[a-z0-9_.-]+$/.test(newUsername))   return err("Username: letters, numbers, _ . - only");
        if (newUsername === uname) return err("New username is the same as current");

        const { data: taken } = await supabase
          .from("users").select("username").eq("username", newUsername).single();
        if (taken) return err("Username already taken");

        await supabase.from("posts").update({ author_username: newUsername }).eq("author_username", uname);
        await supabase.from("comments").update({ author_username: newUsername }).eq("author_username", uname);
        const { error: updErr } = await supabase.from("users").update({ username: newUsername }).eq("username", uname);
        if (updErr) return err("Failed to change username");

        await addLog("CHANGE_USERNAME", `${uname} → ${newUsername}`);
        return ok({ ...safeUser({ ...user, username: newUsername }), newUsername });
      }

      return err("Unknown auth action");
    }

    if (route === "posts") {
      if (!rateLimit("posts_" + ip, 20, 60000)) return err("Too many posts. Wait a minute.", 429);

      // Handle user editing their own post
      if (body.action === "edit") {
        const postId = sanitize(body.id);
        const username = sanitize(body.username);
        if (!postId) return err("Post ID required");
        if (!body.title || !body.content) return err("Title and content required");
        const { data: existingPost } = await supabase
          .from("posts").select("author_username").eq("id", postId).single();
        if (!existingPost) return err("Post not found");
        if (existingPost.author_username !== username) return err("Not authorized", 403);
        const updates = {
          title:    sanitize(body.title.trim().slice(0, 200)),
          content:  sanitize(body.content.trim()),
          category: sanitize(body.category || "other"),
          urgency:  sanitize(body.urgency || "low"),
          location: sanitize((body.location || "").trim().slice(0, 100)),
          tags:     (body.tags || []).slice(0, 10).map(t => sanitize(String(t).slice(0, 30))),
        };
        const { error: upErr } = await supabase.from("posts").update(updates).eq("id", postId);
        if (upErr) return err("Failed to update post");
        return ok({ id: postId });
      }

      if (!body.title || !body.content) return err("Title and content required");
      const post = {
        id:              genId(),
        title:           sanitize(body.title.trim().slice(0, 200)),
        content:         sanitize(body.content.trim()),
        category:        sanitize(body.category || "other"),
        urgency:         sanitize(body.urgency  || "low"),
        officials:       sanitize((body.officials || "").trim().slice(0, 200)),
        location:        sanitize((body.location  || "").trim().slice(0, 100)),
        tags:            (body.tags || []).slice(0, 10).map(t => sanitize(String(t).slice(0, 30))),
        media:           (body.media || []).slice(0, 5),
        anonymous:       !!body.anonymous,
        author:          sanitize(body.author || "Anonymous"),
        display_name:    sanitize(body.displayName || body.author || "Anonymous"),
        author_username: body.authorUsername ? sanitize(body.authorUsername) : null,
        votes:           0,
        status:          "unverified",
        pinned:          false,
        locked:          false,
        status_history:  [{ status: "unverified", timestamp: new Date().toISOString() }],
        timestamp:       new Date().toISOString(),
      };
      const { error: insertErr } = await supabase.from("posts").insert(post);
      if (insertErr) return err("Failed to create post");
      await addLog("NEW_POST", post.title);
      return ok({ id: post.id });
    }

    if (route === "comments") {
      if (!rateLimit("cmts_" + ip, 10, 60000)) return err("Too many comments. Wait.", 429);
      if (!body.postId || !body.text) return err("postId and text required");
      const cmt = {
        id:              genId(),
        post_id:         sanitize(body.postId),
        text:            sanitize(body.text.trim().slice(0, 2000)),
        anonymous:       !!body.anonymous,
        author:          sanitize(body.author || "Anonymous"),
        display_name:    sanitize(body.displayName || body.author || "Anonymous"),
        author_username: body.authorUsername ? sanitize(body.authorUsername) : null,
        timestamp:       new Date().toISOString(),
      };
      const { error: insertErr } = await supabase.from("comments").insert(cmt);
      if (insertErr) return err("Failed to post comment");
      return ok({ id: cmt.id });
    }

    if (route === "votes") {
      const { postId, delta } = body;
      if (!postId) return err("postId required");
      const safeDelta = delta > 0 ? 1 : -1;
      const { data, error: rpcErr } = await supabase.rpc("sentinel_vote", {
        p_post_id: sanitize(postId),
        p_delta:   safeDelta,
      });
      if (rpcErr) return err("Vote failed");
      return ok({ votes: data });
    }

    if (route === "reactions") {
      if (!rateLimit("reactions_" + ip, 20, 60000)) return err("Too many reactions", 429);
      const { postId, emoji, username } = body;
      if (!postId || !emoji || !username) return err("postId, emoji, username required");

      const safePostId = sanitize(postId);
      const safeEmoji = sanitize(emoji.slice(0, 8));
      const safeUsername = sanitize(username);

      const customReactions = await getSetting("customReactions", ["👍","❤️","😮","😡","😢"]);
      const VALID = Array.isArray(customReactions) ? customReactions : ["👍","❤️","😮","😡","😢"];
      if (!VALID.includes(safeEmoji)) return err("Invalid reaction");

      const { data: existing } = await supabase
        .from("reactions")
        .select("emoji")
        .eq("post_id", safePostId)
        .eq("username", safeUsername)
        .single();

      if (existing) {
        if (existing.emoji === safeEmoji) {
          await supabase.from("reactions")
            .delete().eq("post_id", safePostId).eq("username", safeUsername);
        } else {
          await supabase.from("reactions")
            .update({ emoji: safeEmoji }).eq("post_id", safePostId).eq("username", safeUsername);
        }
      } else {
        await supabase.from("reactions").insert({ post_id: safePostId, username: safeUsername, emoji: safeEmoji });
      }

      const { data: rows } = await supabase
        .from("reactions").select("emoji, username").eq("post_id", safePostId);
      const result = {};
      (rows || []).forEach(r => {
        if (!result[r.emoji]) result[r.emoji] = [];
        result[r.emoji].push(sanitize(r.username));
      });
      return ok({ reactions: result });
    }

    if (route === "flag") {
      await addLog("FLAG", sanitize(body.id || "unknown"));
      return ok();
    }

    if (route === "tips") {
      if (!rateLimit("tips_" + ip, 3, 60000)) return err("Too many tips. Wait.", 429);
      if (!body.title || !body.description) return err("Title and description required");
      const { error: insertErr } = await supabase.from("tips").insert({
        id:          genId(),
        title:       sanitize(body.title.trim().slice(0, 200)),
        description: sanitize(body.description.trim()),
        category:    sanitize(body.category || "other"),
        urgency:     sanitize(body.urgency  || "low"),
        contact:     sanitize((body.contact || "").trim()),
        status:      "pending",
      });
      if (insertErr) return err("Failed to submit tip");
      await addLog("TIP_RECEIVED", sanitize(body.title));
      return ok();
    }

    if (route === "staff") {
      const { action, username, data: sdata = {} } = body;
      if (!username) return err("username required");
      const safeUname = sanitize(username.toLowerCase());

      if (!rateLimit("staff_" + safeUname, 30, 60000)) return err("Rate limited", 429);

      const { data: caller } = await supabase
        .from("users").select("role, approved").eq("username", safeUname).single();
      if (!caller || caller.approved === false) return err("Unauthorized", 403);
      const callerRole = caller.role || "citizen";
      if (callerRole !== "staff" && callerRole !== "developer") return err("Staff or developer role required", 403);

      switch (action) {

        case "status": {
          const { data: post } = await supabase
            .from("posts").select("status_history, title").eq("id", sanitize(sdata.id)).single();
          if (!post) return err("Post not found");
          const history = [...(post.status_history || []), { status: sanitize(sdata.status), timestamp: new Date().toISOString() }];
          await supabase.from("posts")
            .update({ status: sanitize(sdata.status), status_history: history }).eq("id", sanitize(sdata.id));
          await addLog("STAFF_STATUS", `"${sanitize(post.title)}" → ${sanitize(sdata.status)} by ${safeUname}`);
          break;
        }

        case "verify": {
          const { data: post } = await supabase
            .from("posts").select("status_history, title").eq("id", sanitize(sdata.id)).single();
          if (!post) return err("Post not found");
          const history = [...(post.status_history || []), { status: "verified", timestamp: new Date().toISOString() }];
          await supabase.from("posts").update({ status: "verified", status_history: history }).eq("id", sanitize(sdata.id));
          await addLog("STAFF_VERIFY", `"${sanitize(post.title)}" by ${safeUname}`);
          break;
        }

        case "review": {
          const { data: post } = await supabase
            .from("posts").select("status_history, title").eq("id", sanitize(sdata.id)).single();
          if (!post) return err("Post not found");
          const history = [...(post.status_history || []), { status: "reviewing", timestamp: new Date().toISOString() }];
          await supabase.from("posts").update({ status: "reviewing", status_history: history }).eq("id", sanitize(sdata.id));
          await addLog("STAFF_REVIEW", `"${sanitize(post.title)}" by ${safeUname}`);
          break;
        }

        case "unverify": {
          const { data: post } = await supabase
            .from("posts").select("status_history, title").eq("id", sanitize(sdata.id)).single();
          if (!post) return err("Post not found");
          const history = [...(post.status_history || []), { status: "unverified", timestamp: new Date().toISOString() }];
          await supabase.from("posts").update({ status: "unverified", status_history: history }).eq("id", sanitize(sdata.id));
          await addLog("STAFF_UNVERIFY", `"${sanitize(post.title)}" by ${safeUname}`);
          break;
        }

        case "deleteComment": {
          await supabase.from("comments").delete().eq("id", sanitize(sdata.commentId));
          await addLog("STAFF_DEL_CMT", `Comment: ${sanitize(sdata.commentId)} by ${safeUname}`);
          break;
        }

        case "getPending": {
          const { data: pending } = await supabase.from("pending_users").select("*");
          return ok({ pending: (pending || []).map(safePendingUser) });
        }

        case "approveUser": {
          const allowedRoles = callerRole === "developer"
            ? ["citizen", "reporter", "staff", "developer"]
            : ["citizen", "reporter"];
          const assignRole = sanitize(sdata.role || "citizen");
          if (!allowedRoles.includes(assignRole)) return err("You cannot assign the role: " + assignRole, 403);

          const { data: pu } = await supabase
            .from("pending_users").select("*").eq("username", sanitize(sdata.username)).single();
          if (!pu) return err("Pending user not found");
          await supabase.from("users").insert({
            username:             sanitize(pu.username),
            display_name:         sanitize(pu.display_name),
            password_hash:        pu.password_hash,
            avatar_emoji:        sanitize(pu.avatar_emoji || "👤"),
            role:                 assignRole,
            approved:             true,
            needs_profile_update: true,
          });
          await supabase.from("pending_users").delete().eq("username", sanitize(sdata.username));
          await addLog("STAFF_APPROVE", `${sanitize(pu.username)} as ${assignRole} by ${safeUname}`);
          break;
        }

        case "rejectUser": {
          await supabase.from("pending_users").delete().eq("username", sanitize(sdata.username));
          await addLog("STAFF_REJECT", `${sanitize(sdata.username)} by ${safeUname}`);
          break;
        }

        default: return err("Unknown staff action");
      }
      return ok();
    }

    if (route === "admin") {
      const { passkey, action, data = {} } = body;
      if (!rateLimit("admin_" + ip, 30, 60000)) return err("Rate limited", 429);
      const validKey = (await getSetting("passkey")) || DEFAULT_PASS;
      if (passkey !== validKey) return err("Invalid passkey", 401);

      const safeData = {
        id:         sanitize(data.id),
        ids:        (data.ids || []).map(id => sanitize(id)).filter(Boolean),
        status:     sanitize(data.status),
        urgency:    sanitize(data.urgency),
        title:      sanitize(data.title),
        content:    sanitize(data.content),
        username:   sanitize(data.username),
        newUsername:sanitize(data.newUsername),
        role:       sanitize(data.role),
        displayName:sanitize(data.displayName),
        claimerName:sanitize(data.claimerName),
        commentId:  sanitize(data.commentId),
        tipId:      sanitize(data.tipId),
        newPasskey: data.newPasskey ? sanitize(data.newPasskey) : undefined,
        reactions:  (data.reactions || []).map(r => sanitize(String(r).slice(0, 8))).filter(Boolean),
        categories: (data.categories || []).map(c => ({
          id:    sanitize(c.id || ""),
          label: sanitize(c.label || ""),
          icon:  sanitize(c.icon || "📌"),
        })),
        enabled:    !!data.enabled,
        message:    data.message ? sanitize(data.message) : "",
        location:   sanitize(data.location || ""),
        tags:       (data.tags || []).slice(0, 10).map(t => sanitize(String(t).slice(0, 30))),
        officials:  sanitize((data.officials || "").slice(0, 200)),
        category:   sanitize(data.category || ""),
      };

      switch (action) {

        case "status": {
          const { data: post } = await supabase
            .from("posts").select("status_history, title").eq("id", safeData.id).single();
          if (!post) return err("Post not found");
          const history = [...(post.status_history || []), { status: safeData.status, timestamp: new Date().toISOString() }];
          await supabase.from("posts")
            .update({ status: safeData.status, status_history: history }).eq("id", safeData.id);
          await addLog("STATUS", `"${sanitize(post.title)}" → ${safeData.status}`);
          break;
        }

        case "urgency": {
          const { data: post } = await supabase
            .from("posts").select("title").eq("id", safeData.id).single();
          if (!post) return err("Post not found");
          await supabase.from("posts").update({ urgency: safeData.urgency }).eq("id", safeData.id);
          await addLog("URGENCY", `"${sanitize(post.title)}" → ${safeData.urgency}`);
          break;
        }

        case "pin": case "unpin": {
          const { data: post } = await supabase
            .from("posts").select("title").eq("id", safeData.id).single();
          if (!post) return err("Post not found");
          await supabase.from("posts").update({ pinned: action === "pin" }).eq("id", safeData.id);
          await addLog(action.toUpperCase(), sanitize(post.title));
          break;
        }

        case "lock": case "unlock": {
          const { data: post } = await supabase
            .from("posts").select("title").eq("id", safeData.id).single();
          if (!post) return err("Post not found");
          await supabase.from("posts").update({ locked: action === "lock" }).eq("id", safeData.id);
          await addLog(action.toUpperCase(), sanitize(post.title));
          break;
        }

        case "editPost": {
          const updates = { edited_by_admin: true, edited_at: new Date().toISOString() };
          if (safeData.title)    updates.title     = safeData.title;
          if (safeData.content)  updates.content   = safeData.content;
          if (safeData.officials !== undefined) updates.officials = safeData.officials;
          if (safeData.location  !== undefined) updates.location  = safeData.location;
          if (safeData.category) updates.category  = safeData.category;
          if (safeData.urgency)  updates.urgency   = safeData.urgency;
          if (safeData.tags && safeData.tags.length) updates.tags = safeData.tags;
          const { data: post } = await supabase
            .from("posts").update(updates).eq("id", safeData.id).select("title").single();
          await addLog("EDIT_POST", post?.title || safeData.id);
          break;
        }

        case "bulkStatus": {
          if (!safeData.ids?.length) return err("No IDs provided");
          for (const id of safeData.ids) {
            const { data: post } = await supabase
              .from("posts").select("status_history").eq("id", id).single();
            if (!post) continue;
            const history = [...(post.status_history || []), { status: safeData.status, timestamp: new Date().toISOString() }];
            await supabase.from("posts")
              .update({ status: safeData.status, status_history: history }).eq("id", id);
          }
          await addLog("BULK_STATUS", `${safeData.ids.length} posts → ${safeData.status}`);
          break;
        }

        case "bulkDelete": {
          if (!safeData.ids?.length) return err("No IDs provided");
          await supabase.from("posts").delete().in("id", safeData.ids);
          await addLog("BULK_DELETE", `${safeData.ids.length} posts deleted`);
          break;
        }

        case "unpinAll": {
          await supabase.from("posts").update({ pinned: false }).eq("pinned", true);
          await addLog("UNPIN_ALL", "All posts unpinned");
          break;
        }

        case "delete": {
          const { data: post } = await supabase
            .from("posts").select("title").eq("id", safeData.id).single();
          await supabase.from("posts").delete().eq("id", safeData.id);
          await addLog("DELETE_POST", post?.title || safeData.id);
          break;
        }

        case "deleteComment": {
          await supabase.from("comments").delete().eq("id", safeData.commentId);
          await addLog("DELETE_COMMENT", `Comment: ${safeData.commentId}`);
          break;
        }

        case "announce": {
          await supabase.from("announcements").insert({
            title:   safeData.title,
            content: safeData.content,
          });
          await addLog("ANNOUNCE", safeData.title);
          break;
        }

        case "clearAnn": {
          await supabase.from("announcements").delete().neq("id", "00000000-0000-0000-0000-000000000000");
          await addLog("CLEAR_ANN", "All announcements cleared");
          break;
        }

        case "dismissAnn": {
          if (safeData.id) await supabase.from("announcements").delete().eq("id", safeData.id);
          break;
        }

        case "claimFull": case "claimCo": {
          const { data: p } = await supabase
            .from("posts").select("title").eq("id", safeData.id).single();
          if (!p) return err("Post not found");
          const updates = action === "claimFull"
            ? { author: safeData.claimerName || "SENTINEL STAFF", display_name: safeData.claimerName || "SENTINEL STAFF", anonymous: false, claimed_full: true }
            : { co_claimed: true, co_claimed_by: safeData.claimerName || "SENTINEL STAFF" };
          await supabase.from("posts").update(updates).eq("id", safeData.id);
          await addLog("CLAIM_POST", `"${sanitize(p.title)}" → ${safeData.claimerName} (${action})`);
          break;
        }

        case "getPending": {
          const { data: pending } = await supabase.from("pending_users").select("*");
          return ok({ pending: (pending || []).map(safePendingUser) });
        }

        case "approveUser": {
          const { data: pu } = await supabase
            .from("pending_users").select("*").eq("username", safeData.username).single();
          if (!pu) return err("Pending user not found");
          await supabase.from("users").insert({
            username:             sanitize(pu.username),
            display_name:         sanitize(pu.display_name),
            password_hash:        pu.password_hash,
            avatar_emoji:        sanitize(pu.avatar_emoji || "👤"),
            role:                 safeData.role || "citizen",
            approved:             true,
            needs_profile_update: true,
          });
          await supabase.from("pending_users").delete().eq("username", safeData.username);
          await addLog("APPROVE_USER", `${sanitize(pu.username)} as ${safeData.role || "citizen"}`);
          break;
        }

        case "rejectUser": {
          await supabase.from("pending_users").delete().eq("username", safeData.username);
          await addLog("REJECT_USER", safeData.username);
          break;
        }

        case "getAllUsers": {
          const { data: users } = await supabase.from("users").select("*");
          return ok({ users: (users || []).map(safeUser) });
        }

        case "setRole": {
          if (!ROLES.includes(safeData.role)) return err("Invalid role");
          await supabase.from("users").update({ role: safeData.role }).eq("username", safeData.username);
          await addLog("SET_ROLE", `${safeData.username} → ${safeData.role}`);
          break;
        }

        case "setDisplayName": {
          const name = (safeData.displayName || "").slice(0, 30);
          await supabase.from("users").update({ display_name: name }).eq("username", safeData.username);
          await addLog("SET_DISPLAYNAME", `${safeData.username} → ${name}`);
          break;
        }

        case "getTips": {
          const { data: tips } = await supabase
            .from("tips").select("*").order("timestamp", { ascending: false });
          return ok({ tips: (tips || []).map(t => ({
            ...t,
            title:       sanitize(t.title),
            description: sanitize(t.description || ""),
            contact:     sanitize(t.contact || ""),
          })) });
        }

        case "postTip": {
          const { data: tip } = await supabase
            .from("tips").select("*").eq("id", safeData.tipId).single();
          if (!tip) return err("Tip not found");
          const post = {
            id:          genId(),
            title:       sanitize(tip.title),
            content:     sanitize(tip.description),
            category:    sanitize(tip.category || "other"),
            urgency:     sanitize(tip.urgency  || "low"),
            author:      safeData.claimerName || "SENTINEL STAFF",
            display_name: safeData.claimerName || "SENTINEL STAFF",
            anonymous:   false,
            from_tip:    true,
            votes:       0, status: "unverified", pinned: false, locked: false,
            status_history: [{ status: "unverified", timestamp: new Date().toISOString() }],
          };
          await supabase.from("posts").insert(post);
          await supabase.from("tips").update({ status: "posted" }).eq("id", safeData.tipId);
          await addLog("TIP_POSTED", sanitize(tip.title));
          return ok({ postId: post.id });
        }

        case "dismissTip": {
          const { data: tip } = await supabase
            .from("tips").select("title").eq("id", safeData.tipId).single();
          await supabase.from("tips").update({ status: "dismissed" }).eq("id", safeData.tipId);
          await addLog("TIP_DISMISSED", tip?.title || safeData.tipId);
          break;
        }

        case "passkey": {
          if (!safeData.newPasskey || safeData.newPasskey.length < 6) return err("Passkey must be 6+ chars");
          await setSetting("passkey", safeData.newPasskey);
          await addLog("PASSKEY_CHANGE", "Developer passkey updated");
          break;
        }

        case "setReactions": {
          if (!Array.isArray(safeData.reactions) || safeData.reactions.length < 1 || safeData.reactions.length > 8) {
            return err("reactions must be an array of 1-8 emoji");
          }
          await setSetting("customReactions", safeData.reactions);
          await addLog("SET_REACTIONS", safeData.reactions.join(" "));
          break;
        }

        case "categories": {
          if (!Array.isArray(safeData.categories)) return err("Invalid categories");
          await supabase.from("categories").delete().neq("id", "__none__");
          await supabase.from("categories").insert(
            safeData.categories.map((c, i) => ({ id: c.id, label: c.label, icon: c.icon, sort_order: i }))
          );
          break;
        }

        case "maintenance": {
          await setSetting("maintenance",    !!safeData.enabled);
          await setSetting("maintenanceMsg", safeData.message || "");
          await addLog("MAINTENANCE", safeData.enabled ? "Maintenance mode ON" : "Maintenance mode OFF");
          break;
        }

        case "getLog": {
          const { data: log } = await supabase
            .from("activity_log").select("*")
            .order("timestamp", { ascending: false }).limit(500);
          return ok({ log: (log || []).map(l => ({
            ...l,
            action: sanitize(l.action),
            detail: sanitize(l.detail),
          })) });
        }

        case "exportData": {
          const [postsRes, commentsRes, usersRes] = await Promise.all([
            supabase.from("posts").select("*"),
            supabase.from("comments").select("*"),
            supabase.from("users").select("*"),
          ]);
          await addLog("EXPORT", "Data exported by admin");
          return ok({
            posts:      (postsRes.data    || []).map(mapPost),
            comments:   (commentsRes.data || []).map(mapComment),
            users:      (usersRes.data    || []).map(safeUser),
            exportedAt: new Date().toISOString(),
          });
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
