// Postgres-backed storage. Data now survives redeploys and server
// restarts — this replaces the old in-memory Maps.
//
// Requires a DATABASE_URL environment variable (Render's free Postgres
// gives you this automatically once you attach a database to the service).

import pg from "pg";
import { nanoid } from "nanoid";
import { DEFAULT_QUESTIONS } from "./questions.js";

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost") ? false : { rejectUnauthorized: false },
});

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS recruiters (
      recruiter_id TEXT PRIMARY KEY,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at BIGINT NOT NULL,
      display_name TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS screening_links (
      link_id TEXT PRIMARY KEY,
      recruiter_id TEXT NOT NULL REFERENCES recruiters(recruiter_id),
      role_name TEXT,
      questions JSONB NOT NULL,
      candidate_email TEXT,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  // Adds the new columns if this table already existed from before this
  // feature — safe to run every time, does nothing if columns already exist.
  await pool.query(`ALTER TABLE screening_links ADD COLUMN IF NOT EXISTS candidate_email TEXT;`);
  await pool.query(`ALTER TABLE screening_links ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS submissions (
      id SERIAL PRIMARY KEY,
      link_id TEXT NOT NULL REFERENCES screening_links(link_id),
      candidate_name TEXT,
      candidate_email TEXT,
      submitted_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_token TEXT PRIMARY KEY,
      recruiter_id TEXT NOT NULL REFERENCES recruiters(recruiter_id),
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  console.log("Database tables ready.");
}

export async function createSession(recruiterId) {
  const sessionToken = nanoid(32); // long and random — this is the real secret now
  await pool.query(
    `INSERT INTO sessions (session_token, recruiter_id) VALUES ($1, $2)`,
    [sessionToken, recruiterId]
  );
  return sessionToken;
}

export async function getRecruiterIdFromSession(sessionToken) {
  const { rows } = await pool.query(
    `SELECT recruiter_id FROM sessions WHERE session_token = $1`,
    [sessionToken]
  );
  return rows.length > 0 ? rows[0].recruiter_id : null;
}

export async function saveRecruiterTokens(recruiterId, tokenData, displayName = null) {
  const expiresAt = Date.now() + tokenData.expires_in * 1000;
  await pool.query(
    `INSERT INTO recruiters (recruiter_id, access_token, refresh_token, expires_at, display_name)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (recruiter_id)
     DO UPDATE SET access_token = $2, refresh_token = $3, expires_at = $4,
                   display_name = COALESCE($5, recruiters.display_name)`,
    [recruiterId, tokenData.access_token, tokenData.refresh_token, expiresAt, displayName]
  );
}

export async function getRecruiterTokens(recruiterId) {
  const { rows } = await pool.query(
    `SELECT access_token, refresh_token, expires_at, display_name FROM recruiters WHERE recruiter_id = $1`,
    [recruiterId]
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: Number(row.expires_at),
    displayName: row.display_name,
  };
}

export async function createScreeningLink(recruiterId, roleName, candidateEmail, questions = DEFAULT_QUESTIONS) {
  const linkId = nanoid(10);
  await pool.query(
    `INSERT INTO screening_links (link_id, recruiter_id, role_name, candidate_email, questions) VALUES ($1, $2, $3, $4, $5)`,
    [linkId, recruiterId, roleName, candidateEmail || null, JSON.stringify(questions)]
  );
  return linkId;
}

export async function getScreeningLink(linkId) {
  const { rows } = await pool.query(
    `SELECT link_id, recruiter_id, role_name, questions, candidate_email, completed_at FROM screening_links WHERE link_id = $1`,
    [linkId]
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    linkId: row.link_id,
    recruiterId: row.recruiter_id,
    roleName: row.role_name,
    questions: row.questions,
    candidateEmail: row.candidate_email,
    completedAt: row.completed_at,
  };
}

export async function markLinkCompleted(linkId) {
  await pool.query(`UPDATE screening_links SET completed_at = now() WHERE link_id = $1`, [linkId]);
}

export async function getLinksByRecruiter(recruiterId) {
  const { rows } = await pool.query(
    `SELECT link_id, role_name, created_at FROM screening_links WHERE recruiter_id = $1 ORDER BY created_at DESC`,
    [recruiterId]
  );
  return rows.map((r) => ({ linkId: r.link_id, roleName: r.role_name, createdAt: r.created_at }));
}

export async function recordSubmission(linkId, candidate) {
  await pool.query(
    `INSERT INTO submissions (link_id, candidate_name, candidate_email) VALUES ($1, $2, $3)`,
    [linkId, candidate.candidateName, candidate.candidateEmail]
  );
}

export async function getSubmissions(linkId) {
  const { rows } = await pool.query(
    `SELECT candidate_name, candidate_email, submitted_at FROM submissions WHERE link_id = $1 ORDER BY submitted_at DESC`,
    [linkId]
  );
  return rows.map((r) => ({
    candidateName: r.candidate_name,
    candidateEmail: r.candidate_email,
    submittedAt: r.submitted_at,
  }));
}
