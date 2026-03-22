/**
 * ─────────────────────────────────────────────────────────────
 *  SENTINEL — Import Export Data → Supabase  (FIXED v2)
 *
 *  BUG FIXED: Previous version wrote to `sentinel_kv` table but
 *  api.mjs reads from individual tables (posts, comments, etc.)
 *  This version writes to the correct tables the API actually reads.
 *
 *  Run via GitHub Actions or locally:
 *    SUPABASE_URL=... SUPABASE_KEY=... node import-to-supabase.mjs
 * ─────────────────────────────────────────────────────────────
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync }  from "fs";

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_KEY;
const EXPORT_FILE   = "./sentinel-export.json";
const IMPORT_MODE   = "merge"; // "merge" = safe upsert | "replace" = full overwrite

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌  SUPABASE_URL or SUPABASE_KEY is missing.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const log = (e, m) => console.log(`${e}  ${m}`);

function mapPost(p) {
  return {
    id:              p.id,
    title:           p.title   || "",
    content:         p.content || "",
    category:        p.category || "other",
    urgency:         p.urgency  || "low",
    officials:       p.officials || "",
    location:        p.location  || "",
    tags:            Array.isArray(p.tags)  ? p.tags  : [],
    media:           Array.isArray(p.media) ? p.media : [],
    anonymous:       !!p.anonymous,
    author:          p.author || p.displayName || "Unknown",
    author_username: p.authorUsername || p.author || "unknown",
    display_name:    p.displayName || p.author || "Unknown",
    votes:           p.votes || 0,
    status:          p.status || "unverified",
    pinned:          !!p.pinned,
    locked:          !!p.locked,
    status_history:  Array.isArray(p.statusHistory) ? p.statusHistory : [],
    timestamp:       p.timestamp || new Date().toISOString(),
  };
}

function mapComment(c) {
  return {
    id:              c.id,
    post_id:         c.postId,
    author:          c.author || "Unknown",
    author_username: c.authorUsername || c.author || "unknown",
    anonymous:       !!c.anonymous,
    text:            c.text || "",
    timestamp:       c.timestamp || new Date().toISOString(),
  };
}

async function main() {
  console.log("\n╔═════════════════════════════════════════════╗");
  console.log("║   SENTINEL → SUPABASE IMPORT TOOL (FIXED)  ║");
  console.log("╚═════════════════════════════════════════════╝\n");

  let exportData;
  try {
    exportData = JSON.parse(readFileSync(EXPORT_FILE, "utf8"));
  } catch {
    console.error("❌  Could not read " + EXPORT_FILE);
    process.exit(1);
  }

  const { posts: exportPosts = [], comments: exportComments = [], exportedAt } = exportData;
  log("📦", `Export loaded — ${exportPosts.length} posts, ${exportComments.length} comments`);
  log("📅", `Exported at: ${exportedAt || "unknown"}`);
  log("⚙️ ", `Import mode: ${IMPORT_MODE.toUpperCase()}\n`);

  // ── POSTS ──────────────────────────────────────────────────
  const dbPosts = exportPosts.map(mapPost);

  if (IMPORT_MODE === "replace") {
    log("🔁", "Replacing all posts...");
    await supabase.from("posts").delete().neq("id", "__none__");
    const { error } = await supabase.from("posts").insert(dbPosts);
    if (error) { console.error("❌ Posts error:", error.message); process.exit(1); }
  } else {
    const { data: existing } = await supabase.from("posts").select("id");
    const seen = new Set((existing || []).map(p => p.id));
    const fresh = dbPosts.filter(p => !seen.has(p.id));
    log("🔀", `Merge: ${seen.size} existing + ${fresh.length} new posts`);
    if (fresh.length > 0) {
      const { error } = await supabase.from("posts").insert(fresh);
      if (error) { console.error("❌ Posts error:", error.message); process.exit(1); }
    }
  }
  log("✅", "Posts saved to `posts` table!");

  // ── COMMENTS ───────────────────────────────────────────────
  const dbComments = exportComments.map(mapComment);

  if (IMPORT_MODE === "replace") {
    log("🔁", "Replacing all comments...");
    await supabase.from("comments").delete().neq("id", "__none__");
    const { error } = await supabase.from("comments").insert(dbComments);
    if (error) { console.error("❌ Comments error:", error.message); process.exit(1); }
  } else {
    const { data: existing } = await supabase.from("comments").select("id");
    const seen = new Set((existing || []).map(c => c.id));
    const fresh = dbComments.filter(c => !seen.has(c.id));
    log("🔀", `Merge: ${seen.size} existing + ${fresh.length} new comments`);
    if (fresh.length > 0) {
      const { error } = await supabase.from("comments").insert(fresh);
      if (error) { console.error("❌ Comments error:", error.message); process.exit(1); }
    }
  }
  log("✅", "Comments saved to `comments` table!");

  // ── Activity Log ────────────────────────────────────────────
  await supabase.from("activity_log").insert({
    action: "IMPORT",
    detail: `Imported ${exportPosts.length} posts & ${exportComments.length} comments (${IMPORT_MODE} mode)`,
  });
  log("📝", "Activity log updated.");

  console.log("\n╔═════════════════════════════════════════════╗");
  console.log("║   ✅  IMPORT COMPLETE                       ║");
  console.log("╚═════════════════════════════════════════════╝\n");
}

main().catch(e => { console.error("💥 Fatal:", e.message); process.exit(1); });
