import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import { nanoid } from "nanoid";
import { verifyGoogleToken } from "./googleAuth.js";
import {
  buildMicrosoftLoginUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  uploadToOneDrive,
} from "./msGraph.js";
import {
  initDb,
  saveRecruiterTokens,
  getRecruiterTokens,
  createScreeningLink,
  getScreeningLink,
  getLinksByRecruiter,
  recordSubmission,
  getSubmissions,
  createSession,
  getRecruiterIdFromSession,
} from "./store.js";
import { DEFAULT_QUESTIONS } from "./questions.js";

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL || "*" }));
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

// ---------- RECRUITER: connect OneDrive ----------

app.get("/auth/microsoft/start", (req, res) => {
  const recruiterId = req.query.recruiterId || nanoid(8);
  const loginUrl = buildMicrosoftLoginUrl(recruiterId);
  res.redirect(loginUrl);
});

app.get("/auth/microsoft/callback", async (req, res) => {
  const { code, state: recruiterId } = req.query;
  try {
    const tokens = await exchangeCodeForTokens(code);
    await saveRecruiterTokens(recruiterId, tokens);
    const sessionToken = await createSession(recruiterId);
    // The session token (not the recruiterId) is what proves "this really
    // is that recruiter" from now on — the dashboard stores this instead.
    const dashboardUrl = `${process.env.FRONTEND_URL}/dashboard.html?session=${sessionToken}`;
    res.redirect(dashboardUrl);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).send("Failed to connect OneDrive. Check server logs.");
  }
});

// Checks the Authorization header for a valid session token and attaches
// the corresponding recruiterId to the request. Every recruiter-only
// action now requires this — just knowing a recruiterId is no longer
// enough to act as that recruiter.
async function requireSession(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing session token." });

  const recruiterId = await getRecruiterIdFromSession(token);
  if (!recruiterId) return res.status(401).json({ error: "Invalid or expired session." });

  req.recruiterId = recruiterId;
  next();
}

// ---------- RECRUITER: create / list screening links ----------

app.post("/api/links", requireSession, async (req, res) => {
  const { roleName, questions } = req.body;
  const recruiterId = req.recruiterId;
  if (!(await getRecruiterTokens(recruiterId))) {
    return res.status(400).json({ error: "Recruiter has not connected OneDrive yet." });
  }
  const linkId = await createScreeningLink(recruiterId, roleName, questions || DEFAULT_QUESTIONS);
  const pageUrl = process.env.CANDIDATE_PAGE_URL || `${process.env.FRONTEND_URL}/interview.html`;
  res.json({ linkId, screeningUrl: `${pageUrl}?link=${linkId}` });
});

app.get("/api/links", requireSession, async (req, res) => {
  const recruiterId = req.recruiterId;
  const links = await getLinksByRecruiter(recruiterId);
  const pageUrl = process.env.CANDIDATE_PAGE_URL || `${process.env.FRONTEND_URL}/interview.html`;
  res.json(links.map((l) => ({ ...l, screeningUrl: `${pageUrl}?link=${l.linkId}` })));
});

app.get("/api/links/:linkId/submissions", async (req, res) => {
  res.json(await getSubmissions(req.params.linkId));
});

// ---------- CANDIDATE: load a screening link ----------

app.get("/api/links/:linkId", async (req, res) => {
  const link = await getScreeningLink(req.params.linkId);
  if (!link) return res.status(404).json({ error: "Screening link not found." });
  res.json({ roleName: link.roleName, questions: link.questions });
});

// ---------- CANDIDATE: sign in with Google ----------

app.post("/api/candidate/verify", async (req, res) => {
  try {
    const identity = await verifyGoogleToken(req.body.idToken);
    res.json(identity);
  } catch (err) {
    res.status(401).json({ error: "Invalid Google sign-in." });
  }
});

// ---------- CANDIDATE: upload a recorded answer ----------

app.post("/api/links/:linkId/upload", upload.single("video"), async (req, res) => {
  const link = await getScreeningLink(req.params.linkId);
  if (!link) return res.status(404).json({ error: "Screening link not found." });

  let tokens = await getRecruiterTokens(link.recruiterId);
  if (!tokens) return res.status(400).json({ error: "Recruiter's OneDrive not connected." });

  if (Date.now() > tokens.expiresAt - 60_000) {
    const refreshed = await refreshAccessToken(tokens.refreshToken);
    await saveRecruiterTokens(link.recruiterId, refreshed);
    tokens = await getRecruiterTokens(link.recruiterId);
  }

  const { candidateName, candidateEmail, questionId } = req.body;
  const candidateFolder = `${candidateName} - ${link.roleName}`.replace(/[\\/:*?"<>|]/g, "_");
  const fileName = `${questionId}.webm`;

  try {
    const uploaded = await uploadToOneDrive({
      accessToken: tokens.accessToken,
      candidateFolder,
      fileName,
      fileBuffer: req.file.buffer,
    });
    res.json({ uploaded: true, webUrl: uploaded.webUrl });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: "Upload to OneDrive failed." });
  }
});

app.post("/api/links/:linkId/complete", async (req, res) => {
  await recordSubmission(req.params.linkId, {
    candidateName: req.body.candidateName,
    candidateEmail: req.body.candidateEmail,
  });
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;

initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`ScreenMate backend listening on :${PORT}`));
  })
  .catch((err) => {
    console.error("Failed to initialize database:", err);
    process.exit(1);
  });
