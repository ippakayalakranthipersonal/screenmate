import axios from "axios";

const AUTHORITY = `https://login.microsoftonline.com/${process.env.MS_TENANT || "common"}`;
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

// Scopes needed: read/write the recruiter's own OneDrive files, stay signed
// in via a refresh token (offline_access), and read basic profile info.
const SCOPES = "offline_access Files.ReadWrite User.Read";

export function buildMicrosoftLoginUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID,
    response_type: "code",
    redirect_uri: process.env.MS_REDIRECT_URI,
    response_mode: "query",
    scope: SCOPES,
    state,
  });
  return `${AUTHORITY}/oauth2/v2.0/authorize?${params.toString()}`;
}

export async function exchangeCodeForTokens(code) {
  const params = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID,
    client_secret: process.env.MS_CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
    redirect_uri: process.env.MS_REDIRECT_URI,
    scope: SCOPES,
  });
  const { data } = await axios.post(
    `${AUTHORITY}/oauth2/v2.0/token`,
    params.toString(),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  // data.access_token, data.refresh_token, data.expires_in
  return data;
}

export async function refreshAccessToken(refreshToken) {
  const params = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID,
    client_secret: process.env.MS_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: SCOPES,
  });
  const { data } = await axios.post(
    `${AUTHORITY}/oauth2/v2.0/token`,
    params.toString(),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  return data;
}

/**
 * Uploads a video buffer directly into the recruiter's OneDrive under
 * /ScreenMate Interviews/{candidateFolder}/{fileName}.
 *
 * NOTE: This "simple upload" endpoint works for files under 4MB. Screening
 * videos will usually be bigger than that, so before going live, swap this
 * for a Graph "upload session" (chunked upload) — see the TODO below. This
 * function is left simple for a first working version and to make the
 * concept clear.
 */
export async function uploadToOneDrive({ accessToken, candidateFolder, fileName, fileBuffer }) {
  const path = encodeURIComponent(`/ScreenMate Interviews/${candidateFolder}/${fileName}`);
  const url = `${GRAPH_BASE}/me/drive/root:/${path}:/content`;

  const { data } = await axios.put(url, fileBuffer, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "video/webm",
    },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });

  return data; // includes the OneDrive webUrl for the uploaded file
}

// TODO before production: implement createUploadSession() +
// chunked PUT requests per Microsoft's Graph docs for files > 4MB:
// https://learn.microsoft.com/en-us/graph/api/driveitem-createuploadsession
