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
    // Send the recruiter to their dashboard, with their ID in the URL so
    // the dashboard page can remember it (saved into localStorage there).
    const dashboardUrl = `${process.env.FRONTEND_URL}/dashboard.html?recruiterId=${recruiterId}`;
    res.redirect(dashboardUrl);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).send("Failed to connect OneDrive. Check server logs.");
  }
});

// ---------- RECRUITER: create / list screening links ----------

app.post("/api/links", async (req, res) => {
  const { recruiterId, roleName, questions } = req.body;
  if (!(await getRecruiterTokens(recruiterId))) {
    return res.status(400).json({ error: "Recruiter has not connected OneDrive yet." });
  }
  const linkId = await createScreeningLink(recruiterId, roleName, questions || DEFAULT_QUESTIONS);
  const pageUrl = process.env.CANDIDATE_PAGE_URL || `${process.env.FRONTEND_URL}/interview.html`;
  res.json({ linkId, screeningUrl: `${pageUrl}?link=${linkId}` });
});

app.get("/api/links", async (req, res) => {
  const { recruiterId } = req.query;
  if (!recruiterId) return res.status(400).json({ error: "recruiterId is required." });
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
