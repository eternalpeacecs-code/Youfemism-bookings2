import type { Config } from "@netlify/functions"

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

const clean = (v: unknown, max: number) =>
  typeof v === "string" ? v.trim().slice(0, max) : ""

export default async (req: Request) => {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return new Response("Invalid JSON", { status: 400 })
  }

  const name = clean(body.name, 100)
  const phone = clean(body.phone, 40)
  const date = clean(body.date, 100)
  const time = clean(body.time, 50)
  const notes = clean(body.notes, 1000)
  const isoDate = clean(body.isoDate, 10)
  const hour = Number(body.hour)
  const minute = Number(body.minute)

  if (!name || !date || !time) {
    return new Response("Missing fields", { status: 400 })
  }

  const apiKey = Netlify.env.get("RESEND_API_KEY")
  const from = Netlify.env.get("FROM_EMAIL")
  const to = Netlify.env.get("TEAM_EMAIL")
  const calendarEmail = (Netlify.env.get("CALENDAR_EMAIL") || "").trim()
  if (!apiKey || !from || !to) {
    console.error("RESEND_API_KEY, FROM_EMAIL or TEAM_EMAIL is not set")
    return new Response("Email not configured", { status: 500 })
  }

  const row = (label: string, value: string) =>
    value ? `<strong>${label}:</strong> ${esc(value)}<br>` : ""

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;line-height:1.5">
      <h2>New booking</h2>
      <p style="background:#f6f1f7;padding:12px 16px;border-radius:8px">
        ${row("Name", name)}
        ${row("WhatsApp", phone)}
        ${row("Date", date)}
        ${row("Time", time)}
        ${row("Notes", notes)}
      </p>
      <p>Manage bookings on the team dashboard: /team</p>
    </div>`

  // Calendar invite (45 min, South African time = UTC+2) so it lands in the team calendar
  const icsEsc = (s: string) =>
    s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n")
  const fromEmail = (from.match(/<([^>]+)>/)?.[1] || from).trim()
  let attachments: { filename: string; content: string; content_type: string }[] | undefined
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)
  if (dm && Number.isInteger(hour) && Number.isInteger(minute)) {
    const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")
    const start = new Date(Date.UTC(+dm[1], +dm[2] - 1, +dm[3], hour - 2, minute))
    const end = new Date(start.getTime() + 45 * 60 * 1000)
    const ics = [
      "BEGIN:VCALENDAR",
      "PRODID:-//youFemism//Bookings//EN",
      "VERSION:2.0",
      "CALSCALE:GREGORIAN",
      "METHOD:REQUEST",
      "BEGIN:VEVENT",
      `UID:${crypto.randomUUID()}@booking.youfemism.co.za`,
      `DTSTAMP:${stamp(new Date())}`,
      `DTSTART:${stamp(start)}`,
      `DTEND:${stamp(end)}`,
      `SUMMARY:${icsEsc(`youFemism consult - ${name}`)}`,
      `DESCRIPTION:${icsEsc(`Free consultation with ${name}.${phone ? " WhatsApp: " + phone + "." : ""}${notes ? " Notes: " + notes : ""}`)}`,
      "LOCATION:WhatsApp / phone call",
      `ORGANIZER;CN=youFemism Bookings:mailto:${fromEmail}`,
      `ATTENDEE;CN=Lorraine;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=FALSE:mailto:${calendarEmail || to}`,
      "STATUS:CONFIRMED",
      "SEQUENCE:0",
      "TRANSP:OPAQUE",
      "BEGIN:VALARM",
      "TRIGGER:-PT15M",
      "ACTION:DISPLAY",
      "DESCRIPTION:Booking reminder",
      "END:VALARM",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n")
    attachments = [
      {
        filename: "booking.ics",
        content: Buffer.from(ics, "utf-8").toString("base64"),
        content_type: "text/calendar; charset=UTF-8; method=REQUEST",
      },
    ]
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: calendarEmail && calendarEmail.toLowerCase() !== to.toLowerCase() ? [to, calendarEmail] : [to],
      subject: `New booking: ${name}, ${date} at ${time}`,
      html,
      ...(attachments ? { attachments } : {}),
    }),
  })

  if (!res.ok) {
    console.error("Resend error", res.status, await res.text())
    return new Response("Failed to send email", { status: 502 })
  }

  return Response.json({ ok: true })
}

export const config: Config = {
  path: "/api/notify-booking",
  method: "POST",
  rateLimit: {
    action: "rate_limit",
    aggregateBy: ["ip", "domain"],
    windowSize: 60,
    windowLimit: 10,
  },
}
