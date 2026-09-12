import React, { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@supabase/supabase-js";
import { Calendar, Clock, MessageCircle, Check, ChevronLeft, ChevronRight, Flag, X, Plus, CalendarPlus, Phone, User, ArrowLeft } from "lucide-react";

// ---------- Supabase ----------
const SUPABASE_URL = "https://qgueglrjpgqigxeripwt.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFndWVnbHJqcGdxaWd4ZXJpcHd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxNzI5MjMsImV4cCI6MjEwNDc0ODkyM30.DZ9CtdmCZ9WrDNka_2eVmKxUrxSj6vAfM5H36-xBYVs";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------- Style tokens ----------
const COLORS = {
  plum: "#4A2E3D",
  plumDeep: "#38222E",
  rose: "#C97B84",
  roseLight: "#F0DCDD",
  cream: "#FBF6F0",
  creamDark: "#F3EAE0",
  sage: "#8FA68E",
  sageLight: "#E4EBE2",
  charcoal: "#2B2523",
  amber: "#C08A3E",
  amberLight: "#F5E6D0",
};

const FONT_HEAD = "'Fraunces', Georgia, serif";
const FONT_BODY = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";

// ---------- Helpers ----------
const pad = (n) => String(n).padStart(2, "0");
const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtDateLong = (d) =>
  d.toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long" });
const fmtDateShort = (d) =>
  d.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" });
const fmtTime = (h, m) => {
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const ampm = h < 12 ? "am" : "pm";
  return `${hour12}${m ? ":" + pad(m) : ""}${ampm}`;
};
const addDays = (d, n) => {
  const nd = new Date(d);
  nd.setDate(nd.getDate() + n);
  return nd;
};
const isSameDay = (a, b) => toKey(a) === toKey(b);
const isPast = (d) => {
  const now = new Date();
  return d < new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

// Business hours: Mon-Fri 9am-4pm, 45 min slots, SA time assumed local
const WORKING_DAYS = [1, 2, 3, 4, 5]; // Mon-Fri
const START_HOUR = 9;
const END_HOUR = 16;
const SLOT_MINUTES = 45;

function generateSlotsForDay(date) {
  const slots = [];
  let h = START_HOUR;
  let m = 0;
  while (h < END_HOUR || (h === END_HOUR && m === 0)) {
    if (h === END_HOUR && m > 0) break;
    slots.push({ h, m });
    m += SLOT_MINUTES;
    if (m >= 60) {
      h += Math.floor(m / 60);
      m = m % 60;
    }
  }
  return slots.filter((s) => !(s.h === END_HOUR && s.m > 0));
}function normalizePhone(raw) {
  let p = raw.replace(/[^\d+]/g, "");
  if (p.startsWith("0")) p = "27" + p.slice(1);
  if (p.startsWith("+")) p = p.slice(1);
  return p;
}

function waLink(phone, message) {
  const p = normalizePhone(phone);
  return `https://wa.me/${p}?text=${encodeURIComponent(message)}`;
}

function gcalLink(title, details, location, startDate, durationMin) {
  const fmt = (d) =>
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    "00Z";
  const end = new Date(startDate.getTime() + durationMin * 60000);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${fmt(startDate)}/${fmt(end)}`,
    details,
    location: location || "",
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

// ---------- Data access (Supabase) ----------
// UI keeps working with one unified "bookings" array (real bookings + manual flags),
// and a separate "blocks" array — matching the two DB tables.

function rowToBooking(row) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    notes: row.notes,
    date: row.date,
    hour: row.hour,
    min: row.minute,
    status: row.status,
    needsReply: row.needs_reply,
    manualFlag: row.manual_flag,
    createdAt: row.created_at,
  };
}

function rowToBlock(row) {
  return {
    id: row.id,
    status: "blocked",
    date: row.date,
    hour: row.start_hour,
    min: row.start_minute,
    endHour: row.end_hour,
    endMin: row.end_minute,
    label: row.label,
    createdAt: row.created_at,
  };
}

async function fetchAll() {
  const [{ data: bookingRows, error: bErr }, { data: blockRows, error: kErr }] = await Promise.all([
    supabase.from("bookings").select("*").order("date", { ascending: true }),
    supabase.from("blocks").select("*").order("date", { ascending: true }),
  ]);
  if (bErr) console.error("bookings fetch failed", bErr);
  if (kErr) console.error("blocks fetch failed", kErr);
  const bookings = (bookingRows || []).map(rowToBooking);
  const blocks = (blockRows || []).map(rowToBlock);
  return [...bookings, ...blocks];
}

async function insertBooking(booking) {
  const { error } = await supabase.from("bookings").insert({
    name: booking.name,
    phone: booking.phone,
    notes: booking.notes,
    date: booking.date,
    hour: booking.hour,
    minute: booking.min,
    status: booking.status || "confirmed",
    needs_reply: !!booking.needsReply,
    manual_flag: !!booking.manualFlag,
  });
  if (error) console.error("insert booking failed", error);
}async function updateBookingRow(id, patch) {
  const dbPatch = {};
  if ("needsReply" in patch) dbPatch.needs_reply = patch.needsReply;
  if ("status" in patch) dbPatch.status = patch.status;
  if ("name" in patch) dbPatch.name = patch.name;
  if ("phone" in patch) dbPatch.phone = patch.phone;
  if ("notes" in patch) dbPatch.notes = patch.notes;
  const { error } = await supabase.from("bookings").update(dbPatch).eq("id", id);
  if (error) console.error("update booking failed", error);
}

async function insertBlock(block) {
  const { error } = await supabase.from("blocks").insert({
    date: block.date,
    start_hour: block.hour,
    start_minute: block.min,
    end_hour: block.endHour,
    end_minute: block.endMin,
    label: block.label,
  });
  if (error) console.error("insert block failed", error);
}

async function deleteBlock(id) {
  const { error } = await supabase.from("blocks").delete().eq("id", id);
  if (error) console.error("delete block failed", error);
}

// ---------- Seed reminder message ----------
function reminderMessage(booking) {
  return `Hi ${booking.name}, this is Lorraine from youFemism 🌿 Just a reminder of your free consultation ${
    isSameDay(new Date(booking.date), new Date()) ? "today" : "on " + fmtDateLong(new Date(booking.date))
  } at ${fmtTime(booking.hour, booking.min)}. Looking forward to chatting! Reply here if you need to reschedule.`;
}

function confirmMessage(booking) {
  return `Hi ${booking.name}, it's Lorraine from youFemism 🌿 Your free consultation is confirmed for ${fmtDateLong(
    new Date(booking.date)
  )} at ${fmtTime(booking.hour, booking.min)}. I'll send a reminder closer to the time. See you soon!`;
}

// ================= APP =================
export default function App() {
  const isTeamRoute = typeof window !== "undefined" && window.location.pathname.startsWith("/team");
  const [view, setView] = useState(isTeamRoute ? "dashboard" : "home");
  const [bookings, setBookings] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const all = await fetchAll();
    setBookings(all);
    setLoaded(true);
  }, []);

  useEffect(() => {
    refresh();

    // Live updates: whenever anyone (client or staff) changes bookings/blocks,
    // every open copy of the app refreshes automatically.
    const channel = supabase
      .channel("youfemism-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "blocks" }, refresh)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refresh]);const addBooking = useCallback(async (booking) => {
    await insertBooking(booking);
    refresh();
  }, [refresh]);

  const updateBooking = useCallback(async (id, patch) => {
    if (patch.status === "blocked") {
      // creating a new block via the shared "onUpdate" signature used by BlockTimeSheet
      await insertBlock(patch);
    } else {
      const exists = bookings.some((b) => b.id === id);
      if (!exists && patch.manualFlag) {
        await insertBooking(patch);
      } else {
        await updateBookingRow(id, patch);
      }
    }
    refresh();
  }, [bookings, refresh]);

  const removeBooking = useCallback(async (id) => {
    const target = bookings.find((b) => b.id === id);
    if (target && target.status === "blocked") {
      await deleteBlock(id);
    }
    refresh();
  }, [bookings, refresh]);

  return (
    <div
      style={{
        fontFamily: FONT_BODY,
        minHeight: "100vh",
        background: COLORS.cream,
        color: COLORS.charcoal,
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; }
        button { font-family: inherit; cursor: pointer; }
        input, select { font-family: inherit; }
        ::selection { background: ${COLORS.roseLight}; }
        @media (prefers-reduced-motion: reduce) {
          * { animation: none !important; transition: none !important; }
        }
        .tap:active { transform: scale(0.97); }
        .focusable:focus-visible {
          outline: 3px solid ${COLORS.rose};
          outline-offset: 2px;
        }
      `}</style>

      {view === "home" && <HomeScreen onPick={setView} />}
      {view === "book" && (
        <BookingFlow
          bookings={bookings}
          onBook={addBooking}
          onDone={() => setView("home")}
        />
      )}
      {view === "dashboard" && loaded && (
        <Dashboard
          bookings={bookings}
          onUpdate={updateBooking}
          onRemove={removeBooking}
          onBack={() => setView("home")}
        />
      )}
    </div>
  );
}

// ---------- Home / role picker ----------
function HomeScreen({ onPick }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px 20px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: COLORS.plum,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 24,
        }}
      >
        <span style={{ color: COLORS.roseLight, fontSize: 26, fontFamily: FONT_HEAD }}>y</span>
      </div>
      <h1
        style={{
          fontFamily: FONT_HEAD,
          fontSize: 30,
          fontWeight: 500,
          color: COLORS.plum,
          margin: "0 0 8px",
          lineHeight: 1.2,
        }}
      >
        youFemism consults
      </h1>
      <p style={{ fontSize: 16, color: "#6B5D5F", margin: "0 0 40px", maxWidth: 280 }}>
        Book a free menopause consultation, or manage today's appointments.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 14, width: "100%", maxWidth: 320 }}>
        <button
          className="tap focusable"
          onClick={() => onPick("book")}
          style={{
            background: COLORS.plum,
            color: COLORS.cream,
            border: "none",
            borderRadius: 14,
            padding: "20px 24px",
            fontSize: 18,
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            transition: "transform 0.1s",
          }}
        >
          <Calendar size={20} /> Book a free consult
        </button>
        <button
          className="tap focusable"
          onClick={() => onPick("dashboard")}
          style={{
            background: "transparent",
            color: COLORS.plum,
            border: `2px solid ${COLORS.plum}`,
            borderRadius: 14,
            padding: "18px 24px",
            fontSize: 17,
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
          }}
        >
          <User size={19} /> Lorraine / team — my dashboard
        </button>
      </div>
    </div>
  );
}// ---------- Booking flow (client-facing) ----------
function BookingFlow({ bookings, onBook, onDone }) {
  const [step, setStep] = useState(1); // 1 date, 2 time, 3 details, 4 confirmed
  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date();
    return d;
  });
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [confirmedBooking, setConfirmedBooking] = useState(null);
  const [error, setError] = useState("");

  const days = Array.from({ length: 5 }).map((_, i) => addDays(weekStart, i));
  const visibleDays = days.filter((d) => WORKING_DAYS.includes(d.getDay()) || true);

  const takenBookings = bookings.filter((b) => b.status !== "cancelled" && b.status !== "blocked");
  const blocks = bookings.filter((b) => b.status === "blocked");

  const bookedSet = new Set(
    takenBookings.map((b) => `${b.date}_${b.hour}_${b.min}`)
  );

  function isBlockedSlot(dateKey, h, m) {
    const slotMinutes = h * 60 + m;
    return blocks.some((blk) => {
      if (blk.date !== dateKey) return false;
      const start = blk.hour * 60 + blk.min;
      const end = (blk.endHour ?? blk.hour) * 60 + (blk.endMin ?? blk.min + SLOT_MINUTES);
      return slotMinutes >= start && slotMinutes < end;
    });
  }

  const slotsForSelected = selectedDate
    ? generateSlotsForDay(selectedDate).filter(
        (s) =>
          !bookedSet.has(`${toKey(selectedDate)}_${s.h}_${s.m}`) &&
          !isBlockedSlot(toKey(selectedDate), s.h, s.m)
      )
    : [];

  function handleConfirm() {
    if (!name.trim() || !phone.trim()) {
      setError("Please fill in your name and WhatsApp number.");
      return;
    }
    const booking = {
      name: name.trim(),
      phone: phone.trim(),
      notes: notes.trim(),
      date: toKey(selectedDate),
      hour: selectedSlot.h,
      min: selectedSlot.m,
      status: "confirmed",
      needsReply: false,
      createdAt: new Date().toISOString(),
    };
    onBook(booking);
    setConfirmedBooking(booking);
    setStep(4);
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <TopBar
        title={step === 4 ? "Confirmed" : "Book a free consult"}
        onBack={step === 1 ? onDone : () => setStep((s) => Math.max(1, s - 1))}
      />

      <div style={{ flex: 1, padding: "20px 20px 40px", maxWidth: 480, margin: "0 auto", width: "100%" }}>
        {step === 1 && (
          <>
            <StepLabel n={1} total={3} text="Choose a day" />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "18px 0 14px" }}>
              <IconBtn onClick={() => setWeekStart((w) => addDays(w, -7))} label="Previous week">
                <ChevronLeft size={20} />
              </IconBtn>
              <span style={{ fontWeight: 600, fontSize: 15, color: COLORS.plum }}>
                {fmtDateShort(days[0])} – {fmtDateShort(days[4])}
              </span>
              <IconBtn onClick={() => setWeekStart((w) => addDays(w, 7))} label="Next week">
                <ChevronRight size={20} />
              </IconBtn>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {visibleDays.map((d) => {
                const disabled = isPast(d) || !WORKING_DAYS.includes(d.getDay());
                return (
                  <button
                    key={toKey(d)}
                    disabled={disabled}
                    className="tap focusable"
                    onClick={() => {
                      setSelectedDate(d);
                      setStep(2);
                    }}
                    style={{
                      textAlign: "left",
                      border: `1.5px solid ${disabled ? "#E8DFD6" : COLORS.creamDark}`,
                      background: disabled ? "#F7F3EE" : "#fff",
                      borderRadius: 12,
                      padding: "16px 18px",
                      fontSize: 16,
                      color: disabled ? "#B8ADA3" : COLORS.charcoal,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      opacity: disabled ? 0.6 : 1,
                    }}
                  >
                    <span style={{ fontWeight: 500 }}>{fmtDateLong(d)}</span>
                    {!disabled && <ChevronRight size={18} color={COLORS.rose} />}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {step === 2 && selectedDate && (
          <>
            <StepLabel n={2} total={3} text={fmtDateLong(selectedDate)} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 18 }}>
              {slotsForSelected.length === 0 && (
                <p style={{ gridColumn: "1 / -1", color: "#8A7B7D" }}>
                  No open times this day — please choose another day.
                </p>
              )}
              {slotsForSelected.map((s) => (
                <button
                  key={`${s.h}_${s.m}`}
                  className="tap focusable"
                  onClick={() => {
                    setSelectedSlot(s);
                    setStep(3);
                  }}
                  style={{
                    border: `1.5px solid ${COLORS.creamDark}`,
                    background: "#fff",
                    borderRadius: 12,
                    padding: "16px 10px",
                    fontSize: 16,
                    fontWeight: 600,
                    color: COLORS.plum,
                  }}
                >
                  {fmtTime(s.h, s.m)}
                </button>
              ))}
            </div>
          </>
        )}{step === 3 && selectedDate && selectedSlot && (
          <>
            <StepLabel n={3} total={3} text="Your details" />
            <div
              style={{
                background: COLORS.roseLight,
                borderRadius: 12,
                padding: "14px 16px",
                margin: "18px 0",
                fontSize: 15,
                color: COLORS.plumDeep,
              }}
            >
              {fmtDateLong(selectedDate)} at {fmtTime(selectedSlot.h, selectedSlot.min ?? selectedSlot.m)}
            </div>

            <Field label="Your name">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Naledi Khumalo"
                style={inputStyle}
              />
            </Field>
            <Field label="WhatsApp number">
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="e.g. 082 123 4567"
                style={inputStyle}
              />
            </Field>
            <Field label="Anything you'd like Lorraine to know? (optional)">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="e.g. struggling with sleep and hot flushes"
                style={{ ...inputStyle, resize: "vertical" }}
              />
            </Field>

            {error && <p style={{ color: "#B23A3A", fontSize: 14 }}>{error}</p>}

            <button
              className="tap focusable"
              onClick={handleConfirm}
              style={{
                width: "100%",
                background: COLORS.plum,
                color: COLORS.cream,
                border: "none",
                borderRadius: 14,
                padding: "18px",
                fontSize: 17,
                fontWeight: 600,
                marginTop: 8,
              }}
            >
              Confirm booking
            </button>
          </>
        )}

        {step === 4 && confirmedBooking && (
          <div style={{ textAlign: "center", paddingTop: 20 }}>
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: "50%",
                background: COLORS.sageLight,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 20px",
              }}
            >
              <Check size={30} color={COLORS.sage} strokeWidth={3} />
            </div>
            <h2 style={{ fontFamily: FONT_HEAD, fontSize: 24, color: COLORS.plum, margin: "0 0 8px" }}>
              You're booked in
            </h2>
            <p style={{ fontSize: 16, color: "#6B5D5F", margin: "0 0 28px" }}>
              {fmtDateLong(new Date(confirmedBooking.date))} at {fmtTime(confirmedBooking.hour, confirmedBooking.min)}
            </p>
            <p style={{ fontSize: 14, color: "#8A7B7D", marginBottom: 24 }}>
              Lorraine will WhatsApp you a reminder closer to the time.
            </p>
            <button
              className="tap focusable"
              onClick={onDone}
              style={{
                background: "transparent",
                color: COLORS.plum,
                border: `2px solid ${COLORS.plum}`,
                borderRadius: 14,
                padding: "14px 28px",
                fontSize: 15,
                fontWeight: 600,
              }}
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: "block", fontSize: 14, fontWeight: 600, color: COLORS.plumDeep, marginBottom: 6 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const inputStyle = {
  width: "100%",
  border: `1.5px solid ${COLORS.creamDark}`,
  borderRadius: 10,
  padding: "14px 14px",
  fontSize: 16,
  background: "#fff",
  color: COLORS.charcoal,
};

function StepLabel({ n, total, text }) {
  return (
    <div>
      <p style={{ fontSize: 13, color: COLORS.rose, fontWeight: 600, margin: "0 0 4px" }}>
        Step {n} of {total}
      </p>
      <h2 style={{ fontFamily: FONT_HEAD, fontSize: 22, color: COLORS.plum, margin: 0, fontWeight: 500 }}>
        {text}
      </h2>
    </div>
  );
}

function IconBtn({ children, onClick, label }) {
  return (
    <button
      aria-label={label}
      className="tap focusable"
      onClick={onClick}
      style={{
        width: 38,
        height: 38,
        borderRadius: "50%",
        border: `1.5px solid ${COLORS.creamDark}`,
        background: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: COLORS.plum,
      }}
    >
      {children}
    </button>
  );
}

function TopBar({ title, onBack }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "18px 16px",
        borderBottom: `1px solid ${COLORS.creamDark}`,
        background: COLORS.cream,
        position: "sticky",
        top: 0,
        zIndex: 5,
      }}
    >
      <button
        aria-label="Back"
        className="tap focusable"
        onClick={onBack}
        style={{
          background: "transparent",
          border: "none",
          color: COLORS.plum,
          display: "flex",
          alignItems: "center",
        }}
      >// ---------- Dashboard (staff-facing) ----------
function Dashboard({ bookings, onUpdate, onRemove, onBack }) {
  const [tab, setTab] = useState("today"); // today | upcoming | replies
  const [activeBooking, setActiveBooking] = useState(null);
  const [showBlockForm, setShowBlockForm] = useState(false);

  const active = bookings.filter((b) => b.status !== "cancelled" && b.status !== "blocked");
  const blocks = bookings
    .filter((b) => b.status === "blocked")
    .sort((a, b) => new Date(a.date) - new Date(b.date) || a.hour - b.hour);
  const today = active.filter((b) => isSameDay(new Date(b.date), new Date()));
  const upcoming = active
    .filter((b) => new Date(b.date) > new Date(new Date().toDateString()))
    .sort((a, b) => new Date(a.date) - new Date(b.date) || a.hour - b.hour);
  const needsReply = active.filter((b) => b.needsReply);

  const list = tab === "today" ? today : tab === "upcoming" ? upcoming : tab === "replies" ? needsReply : blocks;

  return (
    <div style={{ minHeight: "100vh", paddingBottom: 40 }}>
      <TopBar title="Dashboard" onBack={onBack} />

      <div style={{ display: "flex", gap: 8, padding: "16px 16px 0", maxWidth: 520, margin: "0 auto" }}>
        <TabBtn active={tab === "today"} onClick={() => setTab("today")} count={today.length}>
          Today
        </TabBtn>
        <TabBtn active={tab === "upcoming"} onClick={() => setTab("upcoming")} count={upcoming.length}>
          Upcoming
        </TabBtn>
        <TabBtn active={tab === "replies"} onClick={() => setTab("replies")} count={needsReply.length} flag>
          Needs reply
        </TabBtn>
        <TabBtn active={tab === "blocked"} onClick={() => setTab("blocked")} count={blocks.length}>
          Blocked
        </TabBtn>
      </div>

      <div style={{ padding: "18px 16px", maxWidth: 520, margin: "0 auto" }}>
        {list.length === 0 && (
          <p style={{ color: "#8A7B7D", textAlign: "center", marginTop: 40, fontSize: 15 }}>
            {tab === "replies"
              ? "Nothing flagged — you're all caught up."
              : tab === "blocked"
              ? "No blocked times — clients can book any open slot."
              : "No appointments here yet."}
          </p>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {list.map((b) =>
            b.status === "blocked" ? (
              <BlockCard key={b.id} block={b} onRemove={() => onRemove(b.id)} />
            ) : (
              <BookingCard key={b.id} booking={b} onOpen={() => setActiveBooking(b)} onUpdate={onUpdate} />
            )
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 20 }}>
          <button
            className="tap focusable"
            onClick={() => setShowBlockForm(true)}
            style={{
              width: "100%",
              background: COLORS.plum,
              color: COLORS.cream,
              border: "none",
              borderRadius: 12,
              padding: "15px",
              fontSize: 15,
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <Calendar size={16} /> Block out time I'm busy
          </button>

          <button
            className="tap focusable"
            onClick={() => {
              const name = prompt("Client's name for a manual 'needs reply' flag:");
              if (!name) return;
              const phone = prompt("Their WhatsApp number:") || "";
              const flagBooking = {
                id: `manual_${Date.now()}`,
                name,
                phone,
                date: toKey(new Date()),
                hour: 0,
                min: 0,
                status: "confirmed",
                needsReply: true,
                manualFlag: true,
                createdAt: new Date().toISOString(),
              };
              onUpdate(flagBooking.id, flagBooking);
            }}
            style={{
              width: "100%",
              background: "transparent",
              border: `1.5px dashed ${COLORS.rose}`,
              color: COLORS.plum,
              borderRadius: 12,
              padding: "14px",
              fontSize: 15,
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <Flag size={16} /> Flag a client who messaged
          </button>
        </div>
      </div>

      {activeBooking && (
        <BookingDetailSheet
          booking={activeBooking}
          onClose={() => setActiveBooking(null)}
          onUpdate={onUpdate}
        />
      )}

      {showBlockForm && (
        <BlockTimeSheet onClose={() => setShowBlockForm(false)} onSave={onUpdate} />
      )}
    </div>
  );
}

function BlockCard({ block, onRemove }) {
  const d = new Date(block.date);
  return (
    <div
      style={{
        background: "#F7F3EE",
        border: `1.5px dashed ${COLORS.creamDark}`,
        borderRadius: 14,
        padding: "14px 16px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <div>
        <p style={{ margin: 0, fontWeight: 700, fontSize: 15, color: COLORS.charcoal }}>
          {block.label || "Busy"}
        </p>
        <p style={{ margin: "3px 0 0", fontSize: 13.5, color: "#8A7B7D" }}>
          {fmtDateShort(d)} · {fmtTime(block.hour, block.min)}
          {block.endHour != null ? ` – ${fmtTime(block.endHour, block.endMin)}` : ""}
        </p>
      </div>
      <button
        className="tap focusable"
        onClick={onRemove}
        aria-label="Remove block"
        style={{
          background: "#fff",
          border: `1.5px solid ${COLORS.creamDark}`,
          borderRadius: 999,
          width: 34,
          height: 34,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#B23A3A",
        }}
      >
        <X size={16} />
      </button>
    </div>
  );
}

function BlockTimeSheet({ onClose, onSave }) {
  const [date, setDate] = useState(toKey(new Date()));
  const [startSlot, setStartSlot] = useState("09:00");
  const [endSlot, setEndSlot] = useState("10:00");
  const [label, setLabel] = useState("");
  const [wholeDay, setWholeDay] = useState(false);

  const allSlotTimes = [];
  for (let h = START_HOUR; h <= END_HOUR; h++) {
    allSlotTimes.push(`${pad(h)}:00`);
    if (h < END_HOUR) allSlotTimes.push(`${pad(h)}:30`);
  }

  function handleSave() {
    const [sh, sm] = startSlot.split(":").map(Number);
    const [eh, em] = wholeDay ? [END_HOUR, 0] : endSlot.split(":").map(Number);
    const id = `block_${Date.now()}`;
    onSave(id, {
      id,
      status: "blocked",
      date,
      hour: wholeDay ? START_HOUR : sh,
      min: wholeDay ? 0 : sm,
      endHour: eh,
      endMin: em,
      label: label.trim() || (wholeDay ? "Out for the day" : "Busy"),
      createdAt: new Date().toISOString(),
    });
    onClose();
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(43,37,35,0.4)", display: "flex", alignItems: "flex-end", zIndex: 20 }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: COLORS.cream, borderRadius: "20px 20px 0 0", padding: "24px 22px 32px", width: "100%", maxWidth: 520, margin: "0 auto" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h3 style={{ fontFamily: FONT_HEAD, fontSize: 20, color: COLORS.plum, margin: 0 }}>Block out time</h3>
          <button aria-label="Close" onClick={onClose} className="tap focusable" style={{ background: "none", border: "none", color: COLORS.plum }}>
            <X size={22} />
          </button>
        </div>

        <Field label="Date">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
        </Field>

        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, fontSize: 15, fontWeight: 600, color: COLORS.plumDeep }}>
          <input type="checkbox" checked={wholeDay} onChange={(e) => setWholeDay(e.target.checked)} style={{ width: 18, height: 18 }} />
          Block the whole day
        </label>

        {!wholeDay && (
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <Field label="From">
                <select value={startSlot} onChange={(e) => setStartSlot(e.target.value)} style={inputStyle}>
                  {allSlotTimes.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div style={{ flex: 1 }}>
              <Field label="To">
                <select value={endSlot} onChange={(e) => setEndSlot(e.target.value)} style={inputStyle}>
                  {allSlotTimes.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>
        )}

        <Field label="What's this for? (optional)">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Doctor's appointment" style={inputStyle} />
        </Field>

        <button
          className="tap focusable"
          onClick={handleSave}
          style={{ width: "100%", background: COLORS.plum, color: COLORS.cream, border: "none", borderRadius: 14, padding: "16px", fontSize: 16, fontWeight: 600, marginTop: 8 }}
        >
          Save block
        </button>
      </div>
    </div>
  );
}
        <ArrowLeft size={22} />
      </button>
      <h1 style={{ fontFamily: FONT_HEAD, fontSize: 18, fontWeight: 600, color: COLORS.plum, margin: 0 }}>
        {title}
      </h1>
    </div>
  );
}function TabBtn({ children, active, onClick, count, flag }) {
  return (
    <button
      className="tap focusable"
      onClick={onClick}
      style={{
        flex: 1,
        borderRadius: 10,
        padding: "10px 6px",
        fontSize: 13,
        fontWeight: 600,
        background: active ? COLORS.plum : "#fff",
        color: active ? COLORS.cream : flag && count > 0 ? COLORS.amber : "#8A7B7D",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        border: active ? "none" : `1.5px solid ${COLORS.creamDark}`,
      }}
    >
      {children}
      {count > 0 && (
        <span
          style={{
            background: active ? "rgba(255,255,255,0.25)" : flag ? COLORS.amberLight : COLORS.roseLight,
            color: active ? COLORS.cream : flag ? COLORS.amber : COLORS.plum,
            borderRadius: 999,
            fontSize: 11,
            padding: "1px 7px",
            fontWeight: 700,
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function BookingCard({ booking, onOpen, onUpdate }) {
  const d = new Date(booking.date);
  return (
    <div
      style={{
        background: "#fff",
        border: `1.5px solid ${booking.needsReply ? COLORS.amber : COLORS.creamDark}`,
        borderRadius: 14,
        padding: "16px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <button
        onClick={onOpen}
        className="focusable"
        style={{ background: "none", border: "none", padding: 0, textAlign: "left" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <p style={{ margin: 0, fontWeight: 700, fontSize: 16, color: COLORS.charcoal }}>{booking.name}</p>
            {!booking.manualFlag && (
              <p style={{ margin: "3px 0 0", fontSize: 14, color: "#8A7B7D" }}>
                {fmtDateShort(d)} · {fmtTime(booking.hour, booking.min)}
              </p>
            )}
            {booking.manualFlag && (
              <p style={{ margin: "3px 0 0", fontSize: 14, color: COLORS.amber, fontWeight: 600 }}>
                Messaged — needs a reply
              </p>
            )}
          </div>
          {booking.needsReply && <Flag size={17} color={COLORS.amber} fill={COLORS.amberLight} />}
        </div>
        {booking.notes && (
          <p style={{ margin: "8px 0 0", fontSize: 13.5, color: "#6B5D5F", fontStyle: "italic" }}>
            "{booking.notes}"
          </p>
        )}
      </button>

      <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
        {booking.phone && (
          <a
            href={waLink(booking.phone, booking.manualFlag ? "" : reminderMessage(booking))}
            target="_blank"
            rel="noopener noreferrer"
            className="tap focusable"
            style={{ ...pillBtnStyle, background: COLORS.sage, color: "#fff" }}
          >
            <MessageCircle size={15} /> WhatsApp
          </a>
        )}
        {!booking.manualFlag && (
          <a
            href={gcalLink(
              `youFemism consult — ${booking.name}`,
              `Free menopause consultation with ${booking.name}.${booking.notes ? " Notes: " + booking.notes : ""}`,
              "WhatsApp / phone call",
              new Date(`${booking.date}T${pad(booking.hour)}:${pad(booking.min)}:00`),
              45
            )}
            target="_blank"
            rel="noopener noreferrer"
            className="tap focusable"
            style={{ ...pillBtnStyle, background: "#fff", color: COLORS.plum, border: `1.5px solid ${COLORS.plum}` }}
          >
            <CalendarPlus size={15} /> Add to calendar
          </a>
        )}
        <button
          className="tap focusable"
          onClick={() => onUpdate(booking.id, { needsReply: !booking.needsReply })}
          style={{
            ...pillBtnStyle,
            background: booking.needsReply ? COLORS.amberLight : "#fff",
            color: COLORS.amber,
            border: `1.5px solid ${COLORS.amber}`,
          }}
        >
          <Flag size={15} /> {booking.needsReply ? "Clear flag" : "Flag"}
        </button>
      </div>
    </div>
  );
}

const pillBtnStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "9px 14px",
  borderRadius: 999,
  fontSize: 13.5,
  fontWeight: 600,
  border: "none",
  textDecoration: "none",
};

function BookingDetailSheet({ booking, onClose, onUpdate }) {
  const d = new Date(booking.date);
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(43,37,35,0.4)",
        display: "flex",
        alignItems: "flex-end",
        zIndex: 20,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: COLORS.cream,
          borderRadius: "20px 20px 0 0",
          padding: "24px 22px 32px",
          width: "100%",
          maxWidth: 520,
          margin: "0 auto",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <h3 style={{ fontFamily: FONT_HEAD, fontSize: 21, color: COLORS.plum, margin: 0 }}>{booking.name}</h3>
            {!booking.manualFlag && (
              <p style={{ margin: "4px 0 0", color: "#6B5D5F", fontSize: 15 }}>
                {fmtDateLong(d)} at {fmtTime(booking.hour, booking.min)}
              </p>
            )}
          </div>
          <button aria-label="Close" onClick={onClose} className="tap focusable" style={{ background: "none", border: "none", color: COLORS.plum }}>
            <X size={22} />
          </button>
        </div>

        {booking.phone && (
          <p style={{ display: "flex", alignItems: "center", gap: 8, color: COLORS.charcoal, fontSize: 15, margin: "0 0 8px" }}>
            <Phone size={16} color={COLORS.rose} /> {booking.phone}
          </p>
        )}
        {booking.notes && (
          <p style={{ background: "#fff", borderRadius: 10, padding: "12px 14px", fontSize: 14.5, color: "#5A4E50", margin: "8px 0 16px" }}>
            {booking.notes}
          </p>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
          {booking.phone && (
            <a
              href={waLink(booking.phone, confirmMessage(booking))}
              target="_blank"
              rel="noopener noreferrer"
              className="tap focusable"
              style={{ ...bigBtnStyle, background: COLORS.sage, color: "#fff" }}
            >
              <MessageCircle size={18} /> Send confirmation on WhatsApp
            </a>
          )}
          {booking.phone && !booking.manualFlag && (
            <a
              href={waLink(booking.phone, reminderMessage(booking))}
              target="_blank"
              rel="noopener noreferrer"
              className="tap focusable"
              style={{ ...bigBtnStyle, background: "#fff", color: COLORS.plum, border: `2px solid ${COLORS.plum}` }}
            >
              <MessageCircle size={18} /> Send reminder on WhatsApp
            </a>
          )}
          <button
            className="tap focusable"
            onClick={() => {
              onUpdate(booking.id, { needsReply: !booking.needsReply });
            }}
            style={{ ...bigBtnStyle, background: "#fff", color: COLORS.amber, border: `2px solid ${COLORS.amber}` }}
          >
            <Flag size={18} /> {booking.needsReply ? "Clear needs-reply flag" : "Flag as needs reply"}
          </button>
          {!booking.manualFlag && (
            <button
              className="tap focusable"
              onClick={() => {
                if (confirm("Cancel this booking?")) {
                  onUpdate(booking.id, { status: "cancelled" });
                  onClose();
                }
              }}
              style={{ ...bigBtnStyle, background: "transparent", color: "#B23A3A", border: "none" }}
            >
              <X size={18} /> Cancel booking
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const bigBtnStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  padding: "16px",
  borderRadius: 12,
  fontSize: 15.5,
  fontWeight: 600,
  textDecoration: "none",
};
