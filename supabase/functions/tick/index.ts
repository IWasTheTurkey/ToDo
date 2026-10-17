// "tick" runs every minute (see 2-schedule.sql). It:
//   1. sends push notifications for reminders that are due, and
//   2. creates today's recurring tasks, so they appear even if the app hasn't been opened.
// It also handles the "Send test" button in the app's settings.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET")!;
webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") ?? "mailto:todo@example.com",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Obj = Record<string, any>;

async function pushToUser(userId: string, payload: Obj) {
  const { data: subs } = await db.from("push_subscriptions").select("*").eq("user_id", userId);
  let sent = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: 3600 },
      );
      sent++;
    } catch (e: any) {
      // The device unsubscribed or the browser data was cleared: forget it.
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        await db.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
      } else console.error("push failed", e?.statusCode, e?.body ?? e);
    }
  }
  return sent;
}

async function save(userId: string, o: Obj) {
  await db.from("items").upsert({ user_id: userId, id: o.id, kind: o.kind, data: o, updated_at: new Date().toISOString() });
}

// ---------- reminders ----------
async function sendReminders() {
  const now = Date.now();
  const { data } = await db.from("items").select("user_id,data")
    .eq("kind", "task").filter("data->>remind", "eq", "true");
  for (const row of data ?? []) {
    const t = row.data as Obj;
    if (t.done || t.fired || !t.due || t.due > now) continue;
    if (now - t.due > 6 * 3600e3) { await save(row.user_id, { ...t, fired: true }); continue; } // too old to be useful
    await save(row.user_id, { ...t, fired: true });
    await pushToUser(row.user_id, { id: t.id, title: t.title, body: "Reminder" + (t.school ? " · 🏫 School" : "") });
  }
}

// ---------- recurring tasks ----------
function localParts(ms: number, tz: string) {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const p: Obj = {};
  for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { key: `${p.year}-${p.month}-${p.day}`, weekday: wd, h: +p.hour, mi: +p.minute };
}
// Epoch ms for a wall-clock date and time in a time zone.
function zonedTime(key: string, hhmm: string, tz: string) {
  const [y, m, d] = key.split("-").map(Number), [h, mi] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const p = localParts(guess, tz), asUtc = Date.UTC(+p.key.slice(0, 4), +p.key.slice(5, 7) - 1, +p.key.slice(8, 10), p.h, p.mi);
  return guess - (asUtc - guess);
}

async function generateRecurring() {
  const { data: rows } = await db.from("items").select("user_id,data").in("kind", ["recur", "settings"]);
  const byUser = new Map<string, { tz: string; recurs: Obj[] }>();
  for (const r of rows ?? []) {
    const u = byUser.get(r.user_id) ?? { tz: "Europe/London", recurs: [] };
    if (r.data.kind === "settings" && r.data.tz) u.tz = r.data.tz; else if (r.data.kind === "recur") u.recurs.push(r.data);
    byUser.set(r.user_id, u);
  }
  const now = Date.now();
  for (const [userId, { tz, recurs }] of byUser) {
    const today = localParts(now, tz);
    for (const r of recurs) {
      if (r.paused || r.lastGen === today.key) continue;
      if (r.end && r.end < now - 24 * 3600e3) continue;
      if (!r.days?.includes(today.weekday)) { await save(userId, { ...r, lastGen: today.key }); continue; }
      if (r.created && localParts(r.created, tz).key > today.key) continue;
      const id = `r_${r.id}_${today.key}`;
      // Replace any unfinished copy from an earlier day.
      const { data: old } = await db.from("items").select("id,data").eq("user_id", userId).eq("kind", "task")
        .filter("data->>recurId", "eq", r.id);
      for (const o of old ?? []) if (o.id !== id && !o.data.done) await db.from("items").delete().eq("user_id", userId).eq("id", o.id);
      const exists = (old ?? []).some((o) => o.id === id);
      if (!exists) {
        const due = r.time ? zonedTime(today.key, r.time, tz) : null;
        await save(userId, {
          id, kind: "task", title: r.title, list: r.list || "inbox", important: !!r.important, urgent: !!r.urgent, school: !!r.school,
          due, hasTime: !!due, remind: !!due, today: false, appearDate: today.key, recurId: r.id, repeat: "none", done: null, created: now,
        });
      }
      await save(userId, { ...r, lastGen: today.key });
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const auth = req.headers.get("Authorization") ?? "";
  const body = await req.json().catch(() => ({}));

  // "Send test" button: the signed-in user's own token.
  if (body.test) {
    const { data: { user } } = await db.auth.getUser(auth.replace("Bearer ", ""));
    if (!user) return json({ error: "Please sign in again." }, 401);
    const sent = await pushToUser(user.id, { title: "Test notification", body: "Notifications are working on this device." });
    return json({ sent });
  }

  // Scheduled run: must carry the secret from 2-schedule.sql.
  if (auth !== `Bearer ${CRON_SECRET}`) return json({ error: "Not allowed" }, 401);
  await generateRecurring();
  await sendReminders();
  return json({ ok: true });
});
