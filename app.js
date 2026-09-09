/**
 * Customer Knowledge Hub — Pre-sign Service
 * Runs on SAP BTP Cloud Foundry
 * Generates short-lived S3 pre-signed URLs so the browser can upload directly to S3
 */

import express  from 'express';
import cors     from 'cors';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl }               from '@aws-sdk/s3-request-presigner';

const app  = express();
const PORT = process.env.PORT || 8080;   // CF sets PORT automatically

// ─── S3 CLIENT ────────────────────────────────────────────────────────────────
const s3 = new S3Client({
  region: process.env.BUCKET_REGION,
  credentials: {
    accessKeyId:     process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
});

const BUCKET  = process.env.BUCKET_NAME;
const PREFIX  = process.env.KEY_PREFIX || 'knowledge-hub/';
const EXPIRES = 900; // 15 minutes

// ─── ALLOWED FILE TYPES ───────────────────────────────────────────────────────
const ALLOWED_EXTENSIONS = ['pdf','docx','html','txt','jpeg','jpg','png','tiff'];

const ALLOWED_CONTENT_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/html',
  'text/plain',
  'image/jpeg',
  'image/png',
  'image/tiff',
]);

// Filename: only letters, numbers, hyphens, periods
const SAFE_NAME_REGEX = /^[a-zA-Z0-9.\-]+$/;

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(cors());          // allow browser requests from any origin
app.use(express.json());

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ─── PRESIGN ENDPOINT ─────────────────────────────────────────────────────────
app.post('/presign', async (req, res) => {
  const { filename, contentType } = req.body;

  // 1. Required fields
  if (!filename || !contentType) {
    return res.status(400).json({ error: 'filename and contentType are required.' });
  }

  // 2. Filename safety check (should already be clean from the browser, but double-check)
  if (!SAFE_NAME_REGEX.test(filename)) {
    return res.status(400).json({
      error: 'Invalid filename. Only letters, numbers, hyphens (-) and periods (.) are allowed.',
    });
  }

  // 3. Extension check
  const ext = filename.split('.').pop().toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return res.status(400).json({
      error: `File type .${ext} is not allowed. Allowed: ${ALLOWED_EXTENSIONS.join(', ').toUpperCase()}`,
    });
  }

  // 4. Content-type check
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    return res.status(400).json({
      error: `Content-Type "${contentType}" is not allowed.`,
    });
  }

  // 5. Generate pre-signed URL
  try {
    const key     = `${PREFIX}${filename}`;
    const command = new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType });
    const url     = await getSignedUrl(s3, command, { expiresIn: EXPIRES });

    console.log(`Pre-signed URL issued for: ${key}`);
    return res.json({ url, key });

  } catch (err) {
    console.error('Failed to generate pre-signed URL:', err);
    return res.status(500).json({ error: 'Could not generate upload URL. Please try again.' });
  }
});

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Knowledge Hub pre-sign service running on port ${PORT}`);
  console.log(`Bucket : ${BUCKET}`);
  console.log(`Region : ${process.env.BUCKET_REGION}`);
  console.log(`Prefix : ${PREFIX}`);
});
