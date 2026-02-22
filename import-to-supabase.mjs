/**
 * ─────────────────────────────────────────────────────────
 *  SENTINEL — Import Export Data → Supabase
 *  Runs via GitHub Actions (one-time trigger)
 * ─────────────────────────────────────────────────────────
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync }  from "fs";

// Reads from GitHub Secrets (set in repo Settings → Secrets)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const EXPORT_FILE  = "./sentinel-export.json";
const IMPORT_MODE  = "merge"; // "merge" = safe add | "replace" = full overwrite

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function readKV(key, fallback) {
  const { data, error } = await supabase
    .from("sentinel_kv")
    .select("value")
    .eq("key", key)
    .single();
  if (error || !data) return fallback;
  return data.value;
}

async function writeKV(key, value) {
  const { error } = await supabase
    .from("sentinel_kv")
    .upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Failed to write "${key}": ${error.message}`);
}

function log(emoji, msg) { console.log(`${emoji}  ${msg}`); }

async function main() {
  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║   SENTINEL → SUPABASE IMPORT TOOL        ║");
  console.log("╚══════════════════════════════════════════╝\n");

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("❌  SUPABASE_URL or SUPABASE_KEY secret is missing.");
    process.exit(1);
  }

  let exportData;
  try {
    exportData = JSON.parse(readFileSync(EXPORT_FILE, "utf8"));
  } catch {
    console.error(`❌  Could not read ${EXPORT_FILE}`);
    process.exit(1);
  }

  const { posts: exportPosts = [], comments: exportComments = [], exportedAt } = exportData;
  log("📦", `Export loaded — ${exportPosts.length} posts, ${exportComments.length} comments`);
  log("📅", `Exported at: ${exportedAt || "unknown"}`);
  log("⚙️ ", `Import mode: ${IMPORT_MODE.toUpperCase()}\n`);

  // ── POSTS ───────────────────────────────────────────────
  let finalPosts;
  if (IMPORT_MODE === "replace") {
    finalPosts = exportPosts;
    log("🔁", `Replacing all posts with ${finalPosts.length} from export...`);
  } else {
    const existing = await readKV("posts", []);
    const existingIds = new Set(existing.map(p => p.id));
    const newPosts = exportPosts.filter(p => !existingIds.has(p.id));
    finalPosts = [...newPosts, ...existing];
    log("🔀", `Merge: ${existing.length} existing + ${newPosts.length} new = ${finalPosts.length} total posts`);
  }
  await writeKV("posts", finalPosts);
  log("✅", "Posts saved!");

  // ── COMMENTS ────────────────────────────────────────────
  let finalComments;
  if (IMPORT_MODE === "replace") {
    finalComments = exportComments;
    log("🔁", `Replacing all comments with ${finalComments.length} from export...`);
  } else {
    const existing = await readKV("comments", []);
    const existingIds = new Set(existing.map(c => c.id));
    const newComments = exportComments.filter(c => !existingIds.has(c.id));
    finalComments = [...newComments, ...existing];
    log("🔀", `Merge: ${existing.length} existing + ${newComments.length} new = ${finalComments.length} total comments`);
  }
  await writeKV("comments", finalComments);
  log("✅", "Comments saved!");

  // ── Activity Log ─────────────────────────────────────────
  try {
    const actLog = await readKV("activityLog", []);
    actLog.unshift({
      action:    "IMPORT",
      detail:    `Imported ${exportPosts.length} posts & ${exportComments.length} comments via GitHub Actions (${IMPORT_MODE} mode)`,
      timestamp: new Date().toISOString(),
    });
    if (actLog.length > 500) actLog.length = 500;
    await writeKV("activityLog", actLog);
    log("📋", "Activity log updated");
  } catch {
    log("⚠️ ", "Could not update activity log (non-critical)");
  }

  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║   ✅  IMPORT COMPLETE!                    ║");
  console.log("╚══════════════════════════════════════════╝\n");
}

main().catch(e => {
  console.error("\n❌  Error:", e.message);
  process.exit(1);
});
