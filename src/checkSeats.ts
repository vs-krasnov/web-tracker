import fetch from "node-fetch";

/* ─── Secrets (injected by the workflow) ───────────────────── */
const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN;
const TG_CHAT_ID   = process.env.TG_CHAT_ID;
const COURSE_URL   = process.env.COURSE_URL;
const TEXT_TO_FIND = process.env.TEXT_TO_FIND;
const DEBUG        = (process.env.DEBUG_WATCHER ?? "").toLowerCase() === "true";
const INTERVAL_MS  = Number(process.env.INTERVAL_SEC ?? "60") * 1000;

/* ─── Guard clauses ────────────────────────────────────────── */
function assert(v: unknown, name: string) {
  if (!v) throw new Error(`${name} secret missing`);
}
assert(TG_BOT_TOKEN, "TG_BOT_TOKEN");
assert(TG_CHAT_ID,   "TG_CHAT_ID");
assert(COURSE_URL,   "COURSE_URL");
assert(TEXT_TO_FIND, "TEXT_TO_FIND");

/* ─── Helpers ──────────────────────────────────────────────── */
function stamp(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function telegram(message: string) {
  const url = `https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method : "POST",
    headers: { "Content-Type": "application/json" },
    body   : JSON.stringify({ chat_id: TG_CHAT_ID, text: message })
  });
  if (!res.ok) throw new Error(`Telegram ${res.status}: ${await res.text()}`);
}

async function seatIsFree(): Promise<boolean> {
  const res = await fetch(
    COURSE_URL!,
    { headers: { "User-Agent": "seat-watcher/2.1" } }
  );
  if (!res.ok) throw new Error(`Fetch failed: HTTP ${res.status}`);
  const html = await res.text();
  return !html.includes(TEXT_TO_FIND!);   // true  ⇒ seat free
}

/* ─── Main routines ────────────────────────────────────────── */
async function singlePass() {
  const free = await seatIsFree();

  if (DEBUG) {
    await telegram(`Debug: checked ${COURSE_URL}\nSeat free? ${free}`);
  }

  if (free) {
    await telegram(`🎉 A seat just opened!\n${COURSE_URL}`);
    process.exitCode = 1;                 // marks run “failed” → GH e-mail too
  }
}

async function loopForever() {
  while (true) {
    await singlePass();
    stamp("Checked – sleeping…");
    await new Promise(r => setTimeout(r, INTERVAL_MS));
  }
}

/* ─── Entry point ──────────────────────────────────────────── */
const looping = process.argv.includes("--loop");

(async () => {
  looping ? await loopForever() : await singlePass();
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
