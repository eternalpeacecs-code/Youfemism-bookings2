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

  if (!name || !date || !time) {
    return new Response("Missing fields", { status: 400 })
  }

  const apiKey = Netlify.env.get("RESEND_API_KEY")
  const from = Netlify.env.get("FROM_EMAIL")
  const to = Netlify.env.get("TEAM_EMAIL")
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

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: `New booking: ${name}, ${date} at ${time}`,
      html,
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
