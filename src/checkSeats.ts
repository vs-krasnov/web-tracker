import 'dotenv/config';
import fetch, {RequestInit} from 'node-fetch';
import {setTimeout as wait} from 'node:timers/promises';

/* ─── Secrets & config ─────────────────────────────────── */
const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN!;
const TG_CHAT_ID = process.env.TG_CHAT_ID!;
const COURSE_URL = process.env.COURSE_URL!;
const TEXT_TO_FIND = process.env.TEXT_TO_FIND!;
const DEBUG = (process.env.DEBUG_WATCHER ?? '').toLowerCase() === 'true';
const INTERVAL_MS = Number(process.env.INTERVAL_SEC ?? '60') * 1_000;
const MAX_RETRIES = 5;
const FETCH_TIMEOUT_MS = 30_000;        // 30 s per attempt

/* ─── Helpers ───────────────────────────────────────────── */
function stamp(msg: string) {
    console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function telegram(text: string) {
    const url = `https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`;
    const res = await fetch(url, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({chat_id: TG_CHAT_ID, text})
    });
    if (!res.ok) throw new Error(`Telegram ${res.status}: ${await res.text()}`);
}

async function fetchWithRetry(url: string, init: RequestInit = {}) {
    let attempt = 0;
    let backoff = 1_000;                  // first retry after 1 s
    while (true) {
        try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
            const res = await fetch(url, {...init, signal: ctrl.signal});
            clearTimeout(t);
            return res;                       // success → return immediately
        } catch (err: any) {
            attempt++;
            if (attempt >= MAX_RETRIES) throw err;
            stamp(`Fetch failed (${err.code ?? err.message}) – retry ${attempt}/${MAX_RETRIES} in ${backoff / 1000}s`);
            await wait(backoff);
            backoff *= 2;                     // exponential back-off
        }
    }
}

async function seatIsFree(): Promise<boolean> {
    const res = await fetchWithRetry(
        COURSE_URL,
        {headers: {'User-Agent': 'seat-watcher/3.0'}}
    );
    if (!res.ok) {
        stamp(`HTTP ${res.status} ${res.statusText} – treating as “not free”`);
        return false;                       // keep silent; will retry next minute
    }
    const html = await res.text();
    return !html.includes(TEXT_TO_FIND);
}

/* ─── Main routines ─────────────────────────────────────── */
async function singlePass() {
    try {
        const free = await seatIsFree();

        if (DEBUG) {
            await telegram(`Debug → free? ${free}\n${COURSE_URL}`);
        }
        if (free) {
            await telegram(`🎉 A seat just opened!\n${COURSE_URL}`);
            process.exitCode = 1;             // marks run “failed” → GH email
        }
    } catch (err: any) {
        // Network/timeout/DNS after all retries – log & keep looping
        stamp(`Network error: ${err.code ?? err.message}`);
    }
}

async function loopForever() {
    while (true) {
        await singlePass();
        stamp('Checked – sleeping…');
        await wait(INTERVAL_MS);
    }
}

/* ─── Entry point ───────────────────────────────────────── */
const looping = process.argv.includes('--loop');
(async () => looping ? await loopForever() : await singlePass())()
    .catch(err => {
        console.error(err);
        process.exitCode = 1;
    });
