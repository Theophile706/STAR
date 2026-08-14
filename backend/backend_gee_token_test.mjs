import 'dotenv/config';
const serviceAccountJson = process.env.GEE_SERVICE_ACCOUNT_KEY;
if (!serviceAccountJson) {
  console.error('GEE_SERVICE_ACCOUNT_KEY manquante');
  process.exit(1);
}
let sa;
try {
  sa = JSON.parse(serviceAccountJson);
} catch (e) {
  console.error('JSON invalide', e);
  process.exit(1);
}
console.log('project_id=', sa.project_id);
console.log('client_email=', sa.client_email);
console.log('private_key starts with', sa.private_key?.slice(0, 30));
const now = Math.floor(Date.now() / 1000);
const header = { alg: 'RS256', typ: 'JWT' };
const claimSet = {
  iss: sa.client_email,
  scope: 'https://www.googleapis.com/auth/earthengine.readonly',
  aud: 'https://oauth2.googleapis.com/token',
  iat: now,
  exp: now + 3600,
};
const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const unsignedToken = `${enc(header)}.${enc(claimSet)}`;
const pemBody = sa.private_key.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\n/g, '');
const binaryDer = Uint8Array.from(Buffer.from(pemBody, 'base64'));
const key = await crypto.subtle.importKey('pkcs8', binaryDer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsignedToken));
const sigB64 = Buffer.from(signature).toString('base64url');
const jwt = `${unsignedToken}.${sigB64}`;
console.log('jwt len', jwt.length);
const resp = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
});
console.log('status', resp.status);
console.log('body', await resp.text());
