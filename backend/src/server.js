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
  saveRecruiterTokens,
  getRecruiterTokens,
  createScreeningLink,
  getScreeningLink,
  recordSubmission,
  getSubmissions,
} from "./store.js";
import { DEFAULT_QUESTIONS } from "./questions.js";

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL || "*" }));
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

// ---------- RECRUITER: connect OneDrive ----------

app.get("/auth/microsoft/start", (req, res) => {
  // In a real version, recruiterId would come from your own recruiter
  // login/session. For this first version, we generate one and hand it
  // back so you can wire up recruiter accounts next.
  const recruiterId = req.query.recruiterId || nanoid(8);
  const loginUrl = buildMicrosoftLoginUrl(recruiterId);
  res.redirect(loginUrl);
});

app.get("/auth/microsoft/callback", async (req, res) => {
  const { code, state: recruiterId } = req.query;
  try {
    const tokens = await exchangeCodeForTokens(code);
    saveRecruiterTokens(recruiterId, tokens);
    res.send(`
      <h2>OneDrive connected ✅</h2>
      <p>Your recruiter ID is: <b>${recruiterId}</b> — save this, you'll use
      it to create screening links.</p>
    `);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).send("Failed to connect OneDrive. Check server logs.");
  }
});

// ---------- RECRUITER: create a screening link ----------

app.post("/api/links", (req, res) => {
  const { recruiterId, roleName, questions } = req.body;
  if (!getRecruiterTokens(recruiterId)) {
    return res.status(400).json({ error: "Recruiter has not connected OneDrive yet." });
  }
  const linkId = createScreeningLink(recruiterId, roleName, questions || DEFAULT_QUESTIONS);
  res.json({ linkId, screeningUrl: `${process.env.FRONTEND_URL}/interview.html?link=${linkId}` });
});

app.get("/api/links/:linkId/submissions", (req, res) => {
  res.json(getSubmissions(req.params.linkId));
});

// ---------- CANDIDATE: load a screening link ----------

app.get("/api/links/:linkId", (req, res) => {
  const link = getScreeningLink(req.params.linkId);
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
  const link = getScreeningLink(req.params.linkId);
  if (!link) return res.status(404).json({ error: "Screening link not found." });

  let tokens = getRecruiterTokens(link.recruiterId);
  if (!tokens) return res.status(400).json({ error: "Recruiter's OneDrive not connected." });

  // Refresh the recruiter's access token if it's expired
  if (Date.now() > tokens.expiresAt - 60_000) {
    const refreshed = await refreshAccessToken(tokens.refreshToken);
    saveRecruiterTokens(link.recruiterId, refreshed);
    tokens = getRecruiterTokens(link.recruiterId);
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

app.post("/api/links/:linkId/complete", (req, res) => {
  recordSubmission(req.params.linkId, {
    candidateName: req.body.candidateName,
    candidateEmail: req.body.candidateEmail,
  });
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ScreenMate backend listening on :${PORT}`));
