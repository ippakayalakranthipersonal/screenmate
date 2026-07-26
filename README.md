# ScreenMate — Async Video Screening → Recruiter's OneDrive

A lightweight alternative to HireVue/VidCruiter for small recruiters/agencies:
candidates record answers to screening questions right in their browser (no
app install), and recordings save straight into the **recruiter's own
OneDrive** — no extra storage costs, no third-party video vault.

## How it works
1. Recruiter connects their Microsoft OneDrive once (via "Sign in with
   Microsoft") and gets a shareable screening link.
2. Candidate opens the link, signs in with Google (just for identity — no
   Google Drive access needed), sees one question at a time, records an
   answer per question.
3. Each recording uploads directly to a folder in the recruiter's OneDrive,
   named after the candidate and role.
4. Recruiter reviews videos straight from their own OneDrive — no separate
   dashboard needed for v1.

## What's in this repo
- `backend/` — Node/Express server handling:
  - Google Sign-In verification (candidate identity)
  - Microsoft OAuth + Graph API (recruiter's OneDrive connection + video upload)
  - Default screening question set (editable later via API)
- `frontend/` — the candidate-facing recording page (plain HTML/CSS/JS, no
  build step, works in any modern mobile or desktop browser)

## Setup you'll need to do yourself
1. **Google Cloud Console** → create an OAuth Client ID (free) for "Sign in
   with Google" → see `backend/README.md`
2. **Microsoft Entra (Azure) App Registration** → free, needed for OneDrive
   upload access via Microsoft Graph → see `backend/README.md`
3. Deploy the backend somewhere with a public HTTPS URL (Render/Railway free
   tier works, same as before)

## Default screening questions (v1 — fully editable later)
1. Tell us a little about yourself and your professional background.
2. Why are you interested in this role, and in our company?
3. Walk us through the experience you think is most relevant to this position.
4. Describe a challenging situation at work and how you handled it.
5. What are your salary expectations and current notice period?

These live in `backend/src/questions.js` — change the array to edit them,
no redeploy logic needed beyond restarting the server.
