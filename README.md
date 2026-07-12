# Court Sheet

A small web app for running club padel/tennis tournaments. Starts with the
**Americano** format: individual players, rotating doubles partners, matches
played to a fixed number of points, standings by cumulative points. Built for
a two-court club, but the number of courts is a per-tournament setting.

Two pages:

 - **`admin.html`** - organiser console. Create a tournament, add players,
  generate rounds, enter scores.
 - **`viewer.html`** - public, read-only. Shows the live round and standings.
  Put this on the clubhouse screen and/or a QR code for players' phones.

Both pages read/write the same Firestore document in real time, so scores
entered in `admin.html` appear on `viewer.html` within a second or two on
every connected device.

---
## 1. Local development (VS Code)

Because the app uses ES modules (`<script type="module">`), you can't just
double-click `index.html` - browsers block module imports over the `file://`
protocol. Serve it locally instead:

 - Easiest: install the **Live Server** VS Code extension, right-click
  `index.html` -> "Open with Live Server".
 - Or, from the terminal: `npx serve .`

### Firebase config for local dev

1. Copy `js/firebase-config.example.js` to `js/firebase-config.js`.
2. Fill in the real values from your Firebase project (Firebase console ->
   Project settings -> General -> "Your apps" -> SDK setup and configuration).
3. `js/firebase-config.js` is already in `.gitignore`, so it never gets
   committed - same pattern you're used to.

### Firestore setup

In the Firebase console: **Build -> Firestore Database -> Create database**.
Start in test mode, then replace the rules with the contents of
`firestore.rules` in this repo (open read for the viewer, open write for the
admin - see the note in that file about tightening this later if you ever
make the admin URL public).

You don't need to create the `tournaments` collection by hand - the app
creates it the first time you make a tournament.

---
## 2. GitHub

Standard flow:

```
git init
git add .
git commit -m "Court Sheet: initial version"
git remote add origin <your-repo-url>
git push -u origin main
```

`js/firebase-config.js` won't be included (it's gitignored) - that's
intentional.

---
## 3. Vercel

This is a static site with one small build step: `build-config.js` writes
`js/firebase-config.js` from environment variables at build time, since
there's no `firebase-config.js` in the repo for Vercel to use otherwise.

1. Import the GitHub repo into Vercel.
2. In **Project Settings -> Environment Variables**, add:
   - `FIREBASE_API_KEY`
   - `FIREBASE_AUTH_DOMAIN`
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_STORAGE_BUCKET`
   - `FIREBASE_MESSAGING_SENDER_ID`
   - `FIREBASE_APP_ID`

   (Same values as your local `js/firebase-config.js`.)
3. Deploy. Vercel runs `npm run build` (see `vercel.json`), which generates
   `js/firebase-config.js` on the server before serving the static files - 
   your real keys are never committed to Git, only stored as Vercel env vars.

Once deployed you'll have something like:
 - `https://your-app.vercel.app/admin.html` - bookmark this for yourself.
 - `https://your-app.vercel.app/viewer.html` - put this on a QR code / the
  clubhouse screen.

---
## 4. Using it on the day

1. Open `admin.html`, create a tournament, add players (minimum 4).
2. Click **Start tournament**, then **Generate next round**. The app splits
   players across your courts, rotating partners and opponents to keep
   things fair - with 2 courts, up to 8 people play each round; everyone
   else rotates in automatically over subsequent rounds.
3. As matches finish, type each team's score into the two boxes on its
   court card (they should add up to the tournament's points-per-round
   target). Standings update live underneath.
4. Click **Generate next round** again when ready. Repeat until you're out
   of time, then click **Finish tournament** to lock in the final standings.
5. `viewer.html` mirrors all of this automatically - nothing to do there.

**Refreshing or reopening `admin.html`** takes you straight back to whichever
tournament is still in setup or in progress - all data is saved to Firestore
as you go, so nothing is lost if the browser is closed, refreshed, or
crashes. Only one tournament is ever "in progress" at a time; once you click
Finish, `admin.html` opens back on the tournament list on next load.

---
## How the round scheduling works

Every round, the app:

1. Picks who plays this round. Priority goes to whoever has sat out the
   most so far (then whoever has played the fewest rounds) - over a full
   event, sit-outs even out.
2. Among the players selected, tries every reasonable way to split them
   into teams and courts, and picks the split that creates the *fewest
   repeated partnerships and repeat opponents* so far. With exactly 8
   players and 7 rounds, for example, this produces a perfect schedule
   where every possible partnership happens exactly once.

This logic lives entirely in `js/scheduler.js`, with no Firebase or DOM
dependency - worth a read if you want to see (or change) the algorithm
itself, e.g. to add other formats like Mexicano later.

---
## Locking this down later

Right now there's no login - `admin.html` is only as protected as the URL
being unlisted (you can optionally set an `ADMIN_PIN` constant at the top of
`js/admin.js` for a light speed bump). If you ever want real protection:

1. Enable **Firebase Authentication** (email/password is simplest) in the
   Firebase console.
2. Add a sign-in step to `admin.html`.
3. Change `firestore.rules` so `allow write` requires
   `request.auth != null` instead of `true`.

`viewer.html` should stay open-read regardless, since that's the whole
point of the public screen.

---
## Project structure

```
index.html            Landing page
admin.html             Organiser console
viewer.html             Public live viewer
css/style.css            Shared styles
js/scheduler.js           Americano round-generation engine (pure JS)
js/admin.js                Admin page logic + Firestore writes
js/viewer.js                 Viewer page logic + Firestore reads
js/firebase-init.js            Firebase/Firestore setup (shared)
js/add-to-home.js                "Add to Home Screen" prompt (admin + viewer)
js/firebase-config.example.js    Template - copy to firebase-config.js locally
build-config.js                   Generates firebase-config.js on Vercel from env vars
firestore.rules                     Suggested security rules
```

## App icon

To give Court Sheet a proper icon (for the browser tab, and for "Add to
Home Screen" on both iOS and Android), export a 512x512 PNG and save it at
the project root as `tennistournament.png` - right next to `index.html`,
`admin.html`, etc. That's the only step needed; `admin.html`, `viewer.html`,
`index.html`, and the two manifest files already reference it by that exact
filename. No code changes required once the file is in place - just
add/commit/push it like any other file.

## What's not built yet

 - Only the Americano format. Other padel/tennis formats (Mexicano,
  round-robin doubles, knockout brackets, etc.) would each need their own
  scheduling function alongside `generateNextRound` in `scheduler.js`.
 - No editing of players once a tournament has started.
 - No multi-club / multi-admin accounts - one Firebase project = one club.
