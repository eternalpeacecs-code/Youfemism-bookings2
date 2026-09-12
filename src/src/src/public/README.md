# youFemism Booking App

A simple booking app for youFemism's free menopause consultations, built for Lorraine and her team.

## What it does

- **Clients** book a free consult at `/` — pick a day, pick a time, enter their details, done.
- **Lorraine / team** manage everything at `/team` — today's appointments, upcoming bookings, a "needs reply" flag list, and the ability to block out time she's busy.
- Bookings and blocked times are stored in Supabase and update live — if Lorraine blocks a time, clients immediately can't book it; if a client books, it shows up on the team dashboard right away.
- One-tap WhatsApp buttons open a pre-filled message to the client (no automatic sending — WhatsApp doesn't allow that without a paid business API).
- One-tap "Add to calendar" buttons add the appointment straight to whoever taps it, on their own phone (works on iPhone and Android).

## Already set up

The Supabase project (database) is already created and connected — you don't need to set anything up there. The connection details are already in `src/App.jsx`.

## Deploying this (Netlify)

1. Push this whole folder to a new GitHub repository.
2. Go to netlify.com → Add new site → Import an existing project → connect your GitHub → pick this repo.
3. Build settings (Netlify should detect these automatically):
   - Build command: `npm run build`
   - Publish directory: `dist`
4. Click Deploy. Netlify will give you a link like `yourname.netlify.app` — that's the live app.
5. Client booking page: `yourname.netlify.app`
6. Team dashboard: `yourname.netlify.app/team`

You can rename the site later (Site settings → Change site name) to something like `youfemism-booking.netlify.app`, or connect a custom domain.

## Business hours

Currently set to Monday–Friday, 9am–4pm, 45-minute slots. To change this, edit these lines near the top of `src/App.jsx`:
const WORKING_DAYS = [1, 2, 3, 4, 5];
const START_HOUR = 9;
const END_HOUR = 16;
const SLOT_MINUTES = 45;
