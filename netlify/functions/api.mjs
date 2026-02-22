import { createClient } from "@supabase/supabase-js";
import { createHash }  from "crypto";
import bcrypt          from "bcryptjs";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ── CORS ─────────────────────────────────────────────────────
const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// ── DEFAULT PASSKEY ───────────────────────────────────────────
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

// ── PASSWORD HELPERS ──────────────────────────────────────────
// Legacy SHA256 hash (for migrating existing users on first login)
function legacyHashPw(pw) {
  return createHash("sha256").update("sentinel_s4lt_" + pw).digest("hex");
}
// Check if a hash looks like our old SHA256 format
function isLegacyHash(hash) {
  return hash && hash.length === 64 && /^[a-f0-9]+$/.test(hash);
}
async function hashPw(pw) {
  return bcrypt.hash(pw, 12);
}
async function checkPw(pw, hash) {
  if (isLegacyHash(hash)) {
    // Legacy SHA256 comparison
    return legacyHashPw(pw) === hash;
  }
  return bcrypt.compare(pw, hash);
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

const ok  = (d = {})          => new Response(JSON.stringify({ ok: true,  ...d }), { status: 200, headers: CORS });
const err = (msg, status=400) => new Response(JSON.stringify({ ok: false, error: msg }), { status, headers: CORS });

// ── SETTINGS HELPERS ──────────────────────────────────────────
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

// ── ACTIVITY LOG ──────────────────────────────────────────────
async function addLog(action, detail) {
  try {
    await supabase.from("activity_log").insert({ action, detail });
  } catch {}
}

// ── SAFE USER SHAPE ───────────────────────────────────────────
function safeUser(u) {
  if (!u) return null;
  return {
    username:    u.username,
    displayName: u.display_name || u.username,
    role:        u.role || "citizen",
    avatarEmoji: u.avatar_emoji || "👤",
    avatarImage: u.avatar_image || "",
    avatarUrl:   u.avatar_url   || null,
    bio:         u.bio || "",
    bannerColor: u.banner_color || "#0d4a6b",
    createdAt:   u.created_at,
    approved:    u.approved !== false,
  };
}

// ── MAP DB ROW → FRONTEND POST SHAPE ─────────────────────────
function mapPost(p) {
  return {
    id:             p.id,
    title:          p.title,
    content:        p.content,
    category:       p.category,
    urgency:        p.urgency,
    officials:      p.officials,
    location:       p.location,
    tags:           p.tags || [],
    media:          p.media || [],
    anonymous:      p.anonymous,
    author:         p.author,
    displayName:    p.display_name,
    authorUsername: p.author_username,
    votes:          p.votes || 0,
    status:         p.status,
    pinned:         p.pinned,
    locked:         p.locked,
    statusHistory:  p.status_history || [],
    fromTip:        p.from_tip,
    claimedFull:    p.claimed_full,
    coClaimed:      p.co_claimed,
    coClaimedBy:    p.co_claimed_by,
    editedByAdmin:  p.edited_by_admin,
    editedAt:       p.edited_at,
    timestamp:      p.timestamp,
  };
}

// ── MAP DB ROW → FRONTEND COMMENT SHAPE ──────────────────────
function mapComment(c) {
  return {
    id:             c.id,
    postId:         c.post_id,
    text:           c.text,
    anonymous:      c.anonymous,
    author:         c.author,
    displayName:    c.display_name,
    authorUsername: c.author_username,
    timestamp:      c.timestamp,
  };
}

export default async (req) => {
  if (req.method === "OPTIONS") return new Response("", { status: 200, headers: CORS });

  const url   = new URL(req.url);
  const route = url.pathname.replace(/^\/api\/?/, "").split("?")[0];

  try {

    // ══════════════════════════════════════════════════════
    // GET /api/data  — main feed data
    // ══════════════════════════════════════════════════════
    if (req.method === "GET" && route === "data") {
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

      // Fetch everything in parallel
      const [postsRes, commentsRes, annsRes, catsRes, reactionsRes] = await Promise.all([
        supabase.from("posts").select("*").order("pinned", { ascending: false }).order("timestamp", { ascending: false }),
        supabase.from("comments").select("*").order("timestamp", { ascending: true }),
        supabase.from("announcements").select("*").order("timestamp", { ascending: false }),
        supabase.from("categories").select("*").order("sort_order"),
        supabase.from("reactions").select("post_id, emoji, username"),
      ]);

      // Convert reactions rows → { postId: { emoji: [usernames] } }
      const reactions = {};
      (reactionsRes.data || []).forEach(r => {
        if (!reactions[r.post_id]) reactions[r.post_id] = {};
        if (!reactions[r.post_id][r.emoji]) reactions[r.post_id][r.emoji] = [];
        reactions[r.post_id][r.emoji].push(r.username);
      });

      return ok({
        posts:           (postsRes.data    || []).map(mapPost),
        comments:        (commentsRes.data || []).map(mapComment),
        announcements:   (annsRes.data     || []),
        categories:      (catsRes.data     || DEFAULT_CATS),
        reactions,
        hasCustomPasskey: !!(settings.passkey),
        customReactions:  settings.customReactions || DEFAULT_REACTIONS,
      });
    }

    // ══════════════════════════════════════════════════════
    // GET /api/profile/:username
    // ══════════════════════════════════════════════════════
    if (req.method === "GET" && route.startsWith("profile/")) {
      const uname = route.replace("profile/", "").toLowerCase();
      const { data: user } = await supabase
        .from("users").select("*").eq("username", uname).single();
      if (!user) return err("User not found", 404);

      const { data: posts } = await supabase
        .from("posts")
        .select("id, title, category, status, timestamp, votes")
        .eq("author_username", uname)
        .eq("anonymous", false)
        .order("timestamp", { ascending: false });

      return ok({ user: safeUser(user), posts: posts || [], postCount: (posts || []).length });
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

      // ── Register ──────────────────────────────────────
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
          display_name:  username.trim(),
          password_hash: await hashPw(password),
          reason:        reason.trim(),
          real_name:     (realName || "").trim(),
          avatar_emoji:  avatarEmoji || "👤",
        });
        if (insertErr) return err("Registration failed");
        await addLog("REGISTER_PENDING", `New pending registration: ${uname}`);
        return ok({ pending: true });
      }

      // ── Login ─────────────────────────────────────────
      if (action === "login") {
        const { data: user } = await supabase
          .from("users").select("*").eq("username", uname).single();
        if (!user || !(await checkPw(password, user.password_hash))) {
          return err("Invalid username or password");
        }
        if (user.approved === false) return err("Your account is pending approval by staff.");

        // Upgrade legacy SHA256 hash to bcrypt on first login
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

      // ── Update Profile ────────────────────────────────
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
        if (displayName)              updates.display_name  = displayName.trim().slice(0, 30);
        if (bio !== undefined)        updates.bio           = bio.trim().slice(0, 200);
        if (avatarEmoji)              updates.avatar_emoji  = avatarEmoji;
        if (avatarUrl !== undefined)  updates.avatar_url    = avatarUrl || null;
        if (avatarImage !== undefined) {
          if (avatarImage.length > 350000) return err("Profile photo too large");
          updates.avatar_image = avatarImage;
        }
        if (bannerColor)              updates.banner_color  = bannerColor;
        if (newPassword && !skipPw) {
          if (newPassword.length < 6) return err("New password must be at least 6 characters");
          updates.password_hash = await hashPw(newPassword);
        }

        const { data: updated } = await supabase
          .from("users").update(updates).eq("username", uname).select().single();
        await addLog("UPDATE_PROFILE", uname);
        return ok(safeUser(updated));
      }

      // ── Change Password ───────────────────────────────
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

      // ── Change Username ───────────────────────────────
      if (action === "changeUsername") {
        const { data: user } = await supabase
          .from("users").select("*").eq("username", uname).single();
        if (!user) return err("User not found");
        if (!(await checkPw(password, user.password_hash))) return err("Current password is incorrect");

        const newUsername = (body.newUsername || "").trim().toLowerCase();
        if (!newUsername || newUsername.length < 3) return err("New username must be 3+ characters");
        if (!/^[a-z0-9_.-]+$/.test(newUsername))   return err("Username: letters, numbers, _ . - only");

        const { data: taken } = await supabase
          .from("users").select("username").eq("username", newUsername).single();
        if (taken) return err("Username already taken");

        // Insert new record, update posts/comments, delete old record
        await supabase.from("users").insert({ ...user, username: newUsername });
        await supabase.from("posts").update({ author_username: newUsername }).eq("author_username", uname);
        await supabase.from("comments").update({ author_username: newUsername }).eq("author_username", uname);
        await supabase.from("users").delete().eq("username", uname);

        await addLog("CHANGE_USERNAME", `${uname} → ${newUsername}`);
        return ok({ ...safeUser({ ...user, username: newUsername }), newUsername });
      }

      return err("Unknown auth action");
    }

    // ══════════════════════════════════════════════════════
    // POST /api/posts
    // ══════════════════════════════════════════════════════
    if (route === "posts") {
      if (!body.title || !body.content) return err("Title and content required");
      const post = {
        id:              body.id || genId(),
        title:           body.title.trim().slice(0, 200),
        content:         body.content.trim(),
        category:        body.category || "other",
        urgency:         body.urgency  || "low",
        officials:       (body.officials || "").trim(),
        location:        (body.location  || "").trim(),
        tags:            (body.tags || []).slice(0, 10).map(t => t.toString().slice(0, 30)),
        media:           (body.media || []).slice(0, 5),
        anonymous:       !!body.anonymous,
        author:          body.author || "Anonymous",
        display_name:    body.displayName || body.author || "Anonymous",
        author_username: body.authorUsername || null,
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

    // ══════════════════════════════════════════════════════
    // POST /api/comments
    // ══════════════════════════════════════════════════════
    if (route === "comments") {
      if (!body.postId || !body.text) return err("postId and text required");
      const cmt = {
        id:              body.id || genId(),
        post_id:         body.postId,
        text:            body.text.trim().slice(0, 2000),
        anonymous:       !!body.anonymous,
        author:          body.author || "Anonymous",
        display_name:    body.displayName || body.author || "Anonymous",
        author_username: body.authorUsername || null,
        timestamp:       new Date().toISOString(),
      };
      const { error: insertErr } = await supabase.from("comments").insert(cmt);
      if (insertErr) return err("Failed to post comment");
      return ok({ id: cmt.id });
    }

    // ══════════════════════════════════════════════════════
    // POST /api/votes  — atomic, no race conditions
    // ══════════════════════════════════════════════════════
    if (route === "votes") {
      const { postId, delta } = body;
      if (!postId) return err("postId required");
      const safeDelta = delta > 0 ? 1 : -1;
      const { data, error: rpcErr } = await supabase.rpc("sentinel_vote", {
        p_post_id: postId,
        p_delta:   safeDelta,
      });
      if (rpcErr) return err("Vote failed");
      return ok({ votes: data });
    }

    // ══════════════════════════════════════════════════════
    // POST /api/reactions
    // ══════════════════════════════════════════════════════
    if (route === "reactions") {
      const { postId, emoji, username } = body;
      if (!postId || !emoji || !username) return err("postId, emoji, username required");

      // Validate emoji against custom reactions
      const customReactions = await getSetting("customReactions", ["👍","❤️","😮","😡","😢"]);
      const VALID = Array.isArray(customReactions) ? customReactions : ["👍","❤️","😮","😡","😢"];
      if (!VALID.includes(emoji)) return err("Invalid reaction");

      // Check if user already reacted to this post
      const { data: existing } = await supabase
        .from("reactions")
        .select("emoji")
        .eq("post_id", postId)
        .eq("username", username)
        .single();

      if (existing) {
        if (existing.emoji === emoji) {
          // Same emoji → toggle off (remove)
          await supabase.from("reactions")
            .delete().eq("post_id", postId).eq("username", username);
        } else {
          // Different emoji → switch
          await supabase.from("reactions")
            .update({ emoji }).eq("post_id", postId).eq("username", username);
        }
      } else {
        // New reaction
        await supabase.from("reactions").insert({ post_id: postId, username, emoji });
      }

      // Return updated reactions for this post
      const { data: rows } = await supabase
        .from("reactions").select("emoji, username").eq("post_id", postId);
      const result = {};
      (rows || []).forEach(r => {
        if (!result[r.emoji]) result[r.emoji] = [];
        result[r.emoji].push(r.username);
      });
      return ok({ reactions: result });
    }

    // ══════════════════════════════════════════════════════
    // POST /api/flag
    // ══════════════════════════════════════════════════════
    if (route === "flag") {
      await addLog("FLAG", body.id || "unknown");
      return ok();
    }

    // ══════════════════════════════════════════════════════
    // POST /api/tips
    // ══════════════════════════════════════════════════════
    if (route === "tips") {
      if (!body.title || !body.description) return err("Title and description required");
      const { error: insertErr } = await supabase.from("tips").insert({
        id:          genId(),
        title:       body.title.trim().slice(0, 200),
        description: body.description.trim(),
        category:    body.category || "other",
        urgency:     body.urgency  || "low",
        contact:     (body.contact || "").trim(),
        status:      "pending",
      });
      if (insertErr) return err("Failed to submit tip");
      await addLog("TIP_RECEIVED", body.title);
      return ok();
    }

    // ══════════════════════════════════════════════════════
    // POST /api/admin  — developer / staff actions
    // ══════════════════════════════════════════════════════
    if (route === "admin") {
      const { passkey, action, data = {} } = body;
      const validKey = (await getSetting("passkey")) || DEFAULT_PASS;
      if (passkey !== validKey) return err("Invalid passkey", 401);

      switch (action) {

        case "status": {
          const { data: post } = await supabase
            .from("posts").select("status_history, title").eq("id", data.id).single();
          if (!post) return err("Post not found");
          const history = [...(post.status_history || []), { status: data.status, timestamp: new Date().toISOString() }];
          await supabase.from("posts")
            .update({ status: data.status, status_history: history }).eq("id", data.id);
          await addLog("STATUS", `"${post.title}" → ${data.status}`);
          break;
        }

        case "urgency": {
          const { data: post } = await supabase
            .from("posts").select("title").eq("id", data.id).single();
          if (!post) return err("Post not found");
          await supabase.from("posts").update({ urgency: data.urgency }).eq("id", data.id);
          await addLog("URGENCY", `"${post.title}" → ${data.urgency}`);
          break;
        }

        case "pin": case "unpin": {
          const { data: post } = await supabase
            .from("posts").select("title").eq("id", data.id).single();
          if (!post) return err("Post not found");
          await supabase.from("posts").update({ pinned: action === "pin" }).eq("id", data.id);
          await addLog(action.toUpperCase(), post.title);
          break;
        }

        case "lock": case "unlock": {
          const { data: post } = await supabase
            .from("posts").select("title").eq("id", data.id).single();
          if (!post) return err("Post not found");
          await supabase.from("posts").update({ locked: action === "lock" }).eq("id", data.id);
          await addLog(action.toUpperCase(), post.title);
          break;
        }

        case "editPost": {
          const updates = { edited_by_admin: true, edited_at: new Date().toISOString() };
          if (data.title)              updates.title     = data.title.trim();
          if (data.content)            updates.content   = data.content.trim();
          if (data.officials !== undefined) updates.officials = data.officials.trim();
          if (data.location  !== undefined) updates.location  = data.location.trim();
          const { data: post } = await supabase
            .from("posts").update(updates).eq("id", data.id).select("title").single();
          await addLog("EDIT_POST", post?.title || data.id);
          break;
        }

        case "bulkStatus": {
          if (!data.ids?.length) return err("No IDs provided");
          // Update each post's status_history individually
          for (const id of data.ids) {
            const { data: post } = await supabase
              .from("posts").select("status_history").eq("id", id).single();
            if (!post) continue;
            const history = [...(post.status_history || []), { status: data.status, timestamp: new Date().toISOString() }];
            await supabase.from("posts")
              .update({ status: data.status, status_history: history }).eq("id", id);
          }
          await addLog("BULK_STATUS", `${data.ids.length} posts → ${data.status}`);
          break;
        }

        case "bulkDelete": {
          if (!data.ids?.length) return err("No IDs provided");
          // Comments cascade-delete via foreign key
          await supabase.from("posts").delete().in("id", data.ids);
          await addLog("BULK_DELETE", `${data.ids.length} posts deleted`);
          break;
        }

        case "unpinAll": {
          await supabase.from("posts").update({ pinned: false }).eq("pinned", true);
          await addLog("UNPIN_ALL", "All posts unpinned");
          break;
        }

        case "delete": {
          const { data: post } = await supabase
            .from("posts").select("title").eq("id", data.id).single();
          // Comments cascade-delete via foreign key
          await supabase.from("posts").delete().eq("id", data.id);
          await addLog("DELETE_POST", post?.title || data.id);
          break;
        }

        case "deleteComment": {
          await supabase.from("comments").delete().eq("id", data.commentId);
          await addLog("DELETE_COMMENT", `Comment: ${data.commentId}`);
          break;
        }

        case "announce": {
          await supabase.from("announcements").insert({
            title:   data.title,
            content: data.content,
          });
          await addLog("ANNOUNCE", data.title);
          break;
        }

        case "clearAnn": {
          await supabase.from("announcements").delete().neq("id", 0);
          await addLog("CLEAR_ANN", "All announcements cleared");
          break;
        }

        case "dismissAnn": {
          // data.index is unreliable now; use ID if available, else ignore
          if (data.id) await supabase.from("announcements").delete().eq("id", data.id);
          break;
        }

        case "claimFull": case "claimCo": {
          const { data: p } = await supabase
            .from("posts").select("title").eq("id", data.id).single();
          if (!p) return err("Post not found");
          const claimerName = (data.claimerName || "SENTINEL STAFF").trim();
          const updates = action === "claimFull"
            ? { author: claimerName, display_name: claimerName, anonymous: false, claimed_full: true }
            : { co_claimed: true, co_claimed_by: claimerName };
          await supabase.from("posts").update(updates).eq("id", data.id);
          await addLog("CLAIM_POST", `"${p.title}" → ${claimerName} (${action})`);
          break;
        }

        case "getPending": {
          const { data: pending } = await supabase.from("pending_users").select("*");
          return ok({ pending: pending || [] });
        }

        case "approveUser": {
          const { data: pu } = await supabase
            .from("pending_users").select("*").eq("username", data.username).single();
          if (!pu) return err("Pending user not found");
          await supabase.from("users").insert({
            username:             pu.username,
            display_name:         pu.display_name,
            password_hash:        pu.password_hash,
            avatar_emoji:         pu.avatar_emoji || "👤",
            role:                 data.role || "citizen",
            approved:             true,
            needs_profile_update: true,
          });
          await supabase.from("pending_users").delete().eq("username", data.username);
          await addLog("APPROVE_USER", `${pu.username} as ${data.role || "citizen"}`);
          break;
        }

        case "rejectUser": {
          await supabase.from("pending_users").delete().eq("username", data.username);
          await addLog("REJECT_USER", data.username);
          break;
        }

        case "getAllUsers": {
          const { data: users } = await supabase.from("users").select("*");
          return ok({ users: (users || []).map(safeUser) });
        }

        case "setRole": {
          if (!ROLES.includes(data.role)) return err("Invalid role");
          await supabase.from("users").update({ role: data.role }).eq("username", data.username);
          await addLog("SET_ROLE", `${data.username} → ${data.role}`);
          break;
        }

        case "setDisplayName": {
          const name = (data.displayName || "").trim().slice(0, 30);
          await supabase.from("users").update({ display_name: name }).eq("username", data.username);
          await addLog("SET_DISPLAYNAME", `${data.username} → ${name}`);
          break;
        }

        case "getTips": {
          const { data: tips } = await supabase
            .from("tips").select("*").order("timestamp", { ascending: false });
          return ok({ tips: tips || [] });
        }

        case "postTip": {
          const { data: tip } = await supabase
            .from("tips").select("*").eq("id", data.tipId).single();
          if (!tip) return err("Tip not found");
          const post = {
            id:          genId(),
            title:       tip.title,
            content:     tip.description,
            category:    tip.category || "other",
            urgency:     tip.urgency  || "low",
            author:      data.claimerName || "SENTINEL STAFF",
            display_name: data.claimerName || "SENTINEL STAFF",
            anonymous:   false,
            from_tip:    true,
            votes:       0, status: "unverified", pinned: false, locked: false,
            status_history: [{ status: "unverified", timestamp: new Date().toISOString() }],
          };
          await supabase.from("posts").insert(post);
          await supabase.from("tips").update({ status: "posted" }).eq("id", data.tipId);
          await addLog("TIP_POSTED", tip.title);
          return ok({ postId: post.id });
        }

        case "dismissTip": {
          const { data: tip } = await supabase
            .from("tips").select("title").eq("id", data.tipId).single();
          await supabase.from("tips").update({ status: "dismissed" }).eq("id", data.tipId);
          await addLog("TIP_DISMISSED", tip?.title || data.tipId);
          break;
        }

        case "passkey": {
          if (!data.newPasskey || data.newPasskey.length < 6) return err("Passkey must be 6+ chars");
          await setSetting("passkey", data.newPasskey);
          await addLog("PASSKEY_CHANGE", "Developer passkey updated");
          break;
        }

        case "setReactions": {
          if (!Array.isArray(data.reactions) || data.reactions.length < 1 || data.reactions.length > 8) {
            return err("reactions must be an array of 1-8 emoji");
          }
          const filtered = data.reactions.map(r => String(r).slice(0, 8)).filter(Boolean);
          await setSetting("customReactions", filtered);
          await addLog("SET_REACTIONS", filtered.join(" "));
          break;
        }

        case "categories": {
          if (!Array.isArray(data.categories)) return err("Invalid categories");
          await supabase.from("categories").delete().neq("id", "__none__");
          await supabase.from("categories").insert(
            data.categories.map((c, i) => ({ id: c.id, label: c.label, icon: c.icon, sort_order: i }))
          );
          break;
        }

        case "maintenance": {
          await setSetting("maintenance",    !!data.enabled);
          await setSetting("maintenanceMsg", data.message || "");
          await addLog("MAINTENANCE", data.enabled ? "Maintenance mode ON" : "Maintenance mode OFF");
          break;
        }

        case "getLog": {
          const { data: log } = await supabase
            .from("activity_log").select("*")
            .order("timestamp", { ascending: false }).limit(500);
          return ok({ log: log || [] });
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
