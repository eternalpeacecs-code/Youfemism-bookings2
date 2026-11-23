import type { Config } from "@netlify/functions";

// 07:30 South Africa Standard Time = 05:30 UTC throughout the year.
// This function deliberately does nothing until production secrets are configured.
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
const required = (k: string) => Netlify.env.get(k)?.trim() || "";
const ymdSast = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const dateLabel = (s: string) => new Intl.DateTimeFormat("en-ZA", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(new Date(s + "T12:00:00Z"));
const timeLabel = (h: number, m: number) => new Intl.DateTimeFormat("en-ZA", { timeZone: "UTC", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(Date.UTC(2026,0,1,h,m)));
const normalizePhone = (input: string) => {
  let p = (input || "").replace(/[^\d+]/g, "");
  if (p.startsWith("+")) p = p.slice(1);
  if (p.startsWith("0")) p = "27" + p.slice(1);
  return /^27\d{9}$/.test(p) ? p : null;
};
export default async function () {
  const url = required("WHATSAPP_SUPABASE_URL").replace(/\/$/, "");
  const serviceKey = required("WHATSAPP_SUPABASE_SERVICE_ROLE_KEY");
  const accessToken = required("WHATSAPP_CLOUD_API_TOKEN");
  const phoneId = required("WHATSAPP_PHONE_NUMBER_ID");
  if (!url || !serviceKey || !accessToken || !phoneId || required("WHATSAPP_AUTOMATION_ENABLED") !== "true") {
    return json({ enabled: false, reason: "WhatsApp reminder configuration incomplete" });
  }
  const headers = { apikey: serviceKey, Authorization: "Bearer " + serviceKey, "Content-Type": "application/json" };
  const today = ymdSast();
  const query = new URLSearchParams({ select: "id,name,phone,date,hour,minute,status,whatsapp_opt_in", date: "eq." + today, status: "eq.confirmed", whatsapp_opt_in: "eq.true" });
  const bookingsResponse = await fetch(url + "/rest/v1/bookings?" + query, { headers });
  if (!bookingsResponse.ok) return json({ error: "Could not read bookings" }, 502);
  const bookings = await bookingsResponse.json() as Array<{id:string;name:string;phone:string;date:string;hour:number;minute:number;status:string;whatsapp_opt_in:boolean}>;
  let sent = 0, skipped = 0, failed = 0;
  for (const b of bookings) {
    const phone = normalizePhone(b.phone);
    if (!phone || !b.whatsapp_opt_in) { skipped++; continue; }
    // Reserve the exact booking/date/time combination before sending to prevent duplicate delivery.
    const reserve = await fetch(url + "/rest/v1/booking_whatsapp_notifications", {
      method: "POST", headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify({ booking_id: b.id, kind: "morning_reminder", booking_date: b.date, booking_hour: b.hour, booking_minute: b.minute, state: "reserved" })
    });
    if (reserve.status === 409) { skipped++; continue; }
    if (!reserve.ok) { failed++; continue; }
    const [entry] = await reserve.json() as Array<{id:string}>;
    const payload = { messaging_product: "whatsapp", to: phone, type: "template", template: {
      name: "youfemism_morning_reminder_v1", language: { code: "en_ZA" },
      components: [{ type: "body", parameters: [b.name, dateLabel(b.date), timeLabel(b.hour,b.minute)].map(text => ({ type: "text", text: String(text).slice(0,100) })) }]
    }};
    let state = "failed", provider_message_id: string | null = null, error_code: string | null = null;
    try {
      const response = await fetch("https://graph.facebook.com/v22.0/" + encodeURIComponent(phoneId) + "/messages", {
        method: "POST", headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" }, body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (response.ok && result.messages?.[0]?.id) { state = "sent"; provider_message_id = result.messages[0].id; sent++; }
      else { error_code = String(result.error?.code || response.status); failed++; }
    } catch { error_code = "network_error"; failed++; }
    await fetch(url + "/rest/v1/booking_whatsapp_notifications?id=eq." + encodeURIComponent(entry.id), {
      method: "PATCH", headers, body: JSON.stringify({ state, provider_message_id, error_code, sent_at: state === "sent" ? new Date().toISOString() : null })
    });
  }
  return json({ date: today, processed: bookings.length, sent, skipped, failed });
}
export const config: Config = { schedule: "30 5 * * *" };
