import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

/** Local fallback directory (served at /uploads by ServeStaticModule). Not persistent on most hosts. */
export const UPLOADS_DIR = join(process.cwd(), 'uploads');

type SupabaseConfig = { url: string; key: string; bucket: string };

/** Supabase Storage is used when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set. */
function supabaseConfig(): SupabaseConfig | null {
  const url = process.env['SUPABASE_URL']?.replace(/\/+$/, '');
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) return null;
  return { url, key, bucket: process.env['SUPABASE_STORAGE_BUCKET'] || 'karsa-assets' };
}

/**
 * Store an uploaded image and return its public URL.
 * - Supabase Storage (persistent) when configured — required on hosts with an ephemeral disk.
 * - Otherwise the local uploads/ folder, for development.
 */
export async function storeImage(
  name: string,
  buffer: Buffer,
  contentType: string,
  localBaseUrl: string,
): Promise<string> {
  const sb = supabaseConfig();
  if (sb) {
    // Storage REST API: the key goes in `apikey`; legacy service_role JWTs also go in Authorization.
    const headers: Record<string, string> = {
      apikey: sb.key,
      'Content-Type': contentType,
      'Cache-Control': 'max-age=31536000',
      'x-upsert': 'false',
    };
    if (sb.key.startsWith('eyJ')) headers['Authorization'] = `Bearer ${sb.key}`;

    const res = await fetch(`${sb.url}/storage/v1/object/${sb.bucket}/${name}`, {
      method: 'POST',
      headers,
      body: new Uint8Array(buffer),
    });
    if (!res.ok) {
      throw new Error(`Supabase Storage upload failed (${res.status}): ${await res.text()}`);
    }
    return `${sb.url}/storage/v1/object/public/${sb.bucket}/${name}`;
  }

  await mkdir(UPLOADS_DIR, { recursive: true });
  await writeFile(join(UPLOADS_DIR, name), buffer);
  return `${localBaseUrl}/uploads/${name}`;
}
