# ScreenMate Backend Setup

## 1. Install & configure
```bash
cd backend
npm install
cp .env.example .env
```

## 2. Google Sign-In setup (candidate identity)
1. Go to [Google Cloud Console](https://console.cloud.google.com) → create a project (free)
2. APIs & Services → Credentials → **Create Credentials → OAuth Client ID**
3. Application type: **Web application**
4. Under "Authorized JavaScript origins," add the URL where you'll host
   `interview.html` (e.g. `http://localhost:5500` while testing, your real
   domain later)
5. Copy the generated Client ID into `.env` as `GOOGLE_CLIENT_ID`, and also
   paste it into `frontend/interview.html` where it says
   `GOOGLE_CLIENT_ID = "YOUR_GOOGLE_CLIENT_ID..."`

No Google Drive/Gmail access is requested — this is purely "prove you're a
real, signed-in person" for candidate identity, nothing else.

## 3. Microsoft OneDrive setup (recruiter's storage)
1. Go to [portal.azure.com](https://portal.azure.com) → **Microsoft Entra ID
   → App registrations → New registration**
2. Name it "ScreenMate", supported account type: "Accounts in any
   organizational directory and personal Microsoft accounts"
3. Redirect URI: **Web** → `http://localhost:3000/auth/microsoft/callback`
   (must exactly match `MS_REDIRECT_URI` in `.env`)
4. After creating it, copy the **Application (client) ID** into `.env` as
   `MS_CLIENT_ID`
5. Go to **Certificates & secrets → New client secret**, copy the value
   (not the ID) into `.env` as `MS_CLIENT_SECRET`
6. Go to **API permissions → Add a permission → Microsoft Graph →
   Delegated permissions** → add `Files.ReadWrite` and `offline_access`
   (`User.Read` is usually added by default)

## 4. Run it
```bash
npm run dev
```

## 5. Connect a recruiter's OneDrive (one-time, per recruiter)
Visit in a browser:
```
http://localhost:3000/auth/microsoft/start
```
Sign in with the recruiter's Microsoft account, approve the permissions.
You'll be shown a **recruiter ID** — save it, you need it to create
screening links.

## 6. Create a screening link
```bash
curl -X POST http://localhost:3000/api/links \
  -H "Content-Type: application/json" \
  -d '{"recruiterId": "PASTE_RECRUITER_ID_HERE", "roleName": "Frontend Engineer"}'
```
This returns a `screeningUrl` — that's the link to send to candidates.

## Known limitations of this first version
- In-memory storage — restarting the server loses recruiter connections and
  links. Fine for testing, swap for a real database before real use.
- OneDrive upload uses the "simple upload" endpoint (works up to 4MB).
  Screening videos will often be bigger — see the TODO in `src/msGraph.js`
  for the chunked "upload session" approach needed before this handles real
  candidates.
- No recruiter login/dashboard yet — recruiterId is just a random string
  you keep track of manually. Add real recruiter accounts before sharing
  this with more than one recruiter.
