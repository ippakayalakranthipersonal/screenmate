// In-memory for a first version. Swap for a real database before this
// handles real recruiters — restarting the server currently loses every
// connected OneDrive account and every screening link.

import { nanoid } from "nanoid";
import { DEFAULT_QUESTIONS } from "./questions.js";

const recruiters = new Map(); // recruiterId -> { msAccessToken, msRefreshToken, expiresAt }
const screeningLinks = new Map(); // linkId -> { recruiterId, roleName, questions }
const submissions = new Map(); // linkId -> [ { candidateEmail, candidateName, submittedAt } ]

export function saveRecruiterTokens(recruiterId, tokenData) {
  recruiters.set(recruiterId, {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresAt: Date.now() + tokenData.expires_in * 1000,
  });
}

export function getRecruiterTokens(recruiterId) {
  return recruiters.get(recruiterId);
}

export function createScreeningLink(recruiterId, roleName, questions = DEFAULT_QUESTIONS) {
  const linkId = nanoid(10);
  screeningLinks.set(linkId, { recruiterId, roleName, questions });
  submissions.set(linkId, []);
  return linkId;
}

export function getScreeningLink(linkId) {
  return screeningLinks.get(linkId);
}

export function recordSubmission(linkId, candidate) {
  const list = submissions.get(linkId) || [];
  list.push({ ...candidate, submittedAt: Date.now() });
  submissions.set(linkId, list);
}

export function getSubmissions(linkId) {
  return submissions.get(linkId) || [];
}
