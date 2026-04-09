import path from 'path';
import fs from 'fs/promises';
import axios from 'axios';
import { config } from '../config.js';

const LATE_BASE = 'https://getlate.dev/api/v1';

export async function uploadToZernio(filePath: string): Promise<string> {
  const stat = await fs.stat(filePath);
  console.log(`[zernio] Uploading ${(stat.size / 1024 / 1024).toFixed(1)}MB — ${path.basename(filePath)}`);

  // Step 1: get presigned URL
  let uploadUrl: string;
  let publicUrl: string;
  try {
    const presignRes = await axios.post(
      `${LATE_BASE}/media/presign`,
      { fileName: path.basename(filePath), contentType: 'video/mp4' },
      { headers: { Authorization: `Bearer ${config.ZERNIO_API_KEY}` } }
    );
    uploadUrl = presignRes.data.uploadUrl;
    publicUrl = presignRes.data.publicUrl;
  } catch (err: any) {
    const status = err?.response?.status ?? 'unknown';
    throw new Error(`Zernio presign failed (${status}): ${err?.response?.data?.message ?? err.message}`);
  }

  // Step 2: PUT binary file to presigned URL
  const fileBuffer = await fs.readFile(filePath);
  try {
    await axios.put(uploadUrl, fileBuffer, {
      headers: { 'Content-Type': 'video/mp4' },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 600_000, // 10 min for large files
    });
  } catch (err: any) {
    const status = err?.response?.status ?? 'unknown';
    throw new Error(`Zernio upload failed (${status}): ${err.message}`);
  }

  console.log(`[zernio] Upload complete — ${publicUrl.slice(0, 60)}...`);
  return publicUrl;
}
