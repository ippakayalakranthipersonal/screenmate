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

const FOUR_MB = 4 * 1024 * 1024;
const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB per chunk, must be a multiple of 320KB per Graph's rules — 5MB qualifies

/**
 * Uploads a video buffer directly into the recruiter's OneDrive under
 * /The Hire Lens Interviews/{candidateFolder}/{fileName}.
 *
 * Uses Graph's simple upload for small files (<4MB) and automatically
 * switches to a chunked "upload session" for anything bigger — which is
 * the normal case for real interview recordings.
 */
export async function uploadToOneDrive({ accessToken, candidateFolder, fileName, fileBuffer }) {
  if (fileBuffer.length <= FOUR_MB) {
    return uploadSmallFile({ accessToken, candidateFolder, fileName, fileBuffer });
  }
  return uploadLargeFile({ accessToken, candidateFolder, fileName, fileBuffer });
}

async function uploadSmallFile({ accessToken, candidateFolder, fileName, fileBuffer }) {
  const path = encodeURIComponent(`/The Hire Lens Interviews/${candidateFolder}/${fileName}`);
  const url = `${GRAPH_BASE}/me/drive/root:/${path}:/content`;

  const { data } = await axios.put(url, fileBuffer, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "video/webm",
    },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });

  return data;
}

async function uploadLargeFile({ accessToken, candidateFolder, fileName, fileBuffer }) {
  const path = encodeURIComponent(`/The Hire Lens Interviews/${candidateFolder}/${fileName}`);

  // Step 1: ask Graph for an upload session — a temporary URL we upload
  // chunks to. See: https://learn.microsoft.com/en-us/graph/api/driveitem-createuploadsession
  const { data: session } = await axios.post(
    `${GRAPH_BASE}/me/drive/root:/${path}:/createUploadSession`,
    { item: { "@microsoft.graph.conflictBehavior": "rename" } },
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  const uploadUrl = session.uploadUrl;
  const totalSize = fileBuffer.length;
  let lastResponseData = null;

  // Step 2: upload the file in sequential chunks, each with a Content-Range
  // header telling Graph exactly which bytes this chunk represents.
  for (let start = 0; start < totalSize; start += CHUNK_SIZE) {
    const end = Math.min(start + CHUNK_SIZE, totalSize);
    const chunk = fileBuffer.subarray(start, end);

    const { data } = await axios.put(uploadUrl, chunk, {
      headers: {
        "Content-Length": chunk.length,
        "Content-Range": `bytes ${start}-${end - 1}/${totalSize}`,
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
    lastResponseData = data;
  }

  // The final chunk's response contains the completed file's metadata
  // (including webUrl), same shape as the simple-upload response.
  return lastResponseData;
}
