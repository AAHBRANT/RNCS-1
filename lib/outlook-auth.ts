import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const graphScopes = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "https://graph.microsoft.com/User.Read",
  "https://graph.microsoft.com/Mail.Read",
].join(" ");

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} não configurada na Vercel.`);
  return value;
}

export function microsoftConfig(origin?: string) {
  const tenant = process.env.MICROSOFT_TENANT_ID || "common";
  return {
    clientId: required("MICROSOFT_CLIENT_ID"),
    clientSecret: required("MICROSOFT_CLIENT_SECRET"),
    tenant,
    redirectUri: process.env.MICROSOFT_REDIRECT_URI || `${origin}/api/outlook/callback`,
    authority: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`,
  };
}

function encryptionKey() {
  const raw = required("MICROSOFT_TOKEN_ENCRYPTION_KEY");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("MICROSOFT_TOKEN_ENCRYPTION_KEY deve ter 32 bytes em Base64.");
  return key;
}

export function encryptToken(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decryptToken(value: string) {
  const [ivValue, tagValue, encryptedValue] = value.split(".");
  if (!ivValue || !tagValue || !encryptedValue) throw new Error("Token do Outlook inválido.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export async function redeemToken(params: URLSearchParams, origin?: string) {
  const config = microsoftConfig(origin);
  params.set("client_id", config.clientId);
  params.set("client_secret", config.clientSecret);
  params.set("scope", graphScopes);
  const response = await fetch(`${config.authority}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params,
    cache: "no-store",
  });
  const data = await response.json() as { access_token?: string; refresh_token?: string; error_description?: string };
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || "A Microsoft não forneceu um token de acesso.");
  }
  return data;
}

export async function refreshAccessToken(encryptedRefreshToken: string) {
  const data = await redeemToken(new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: decryptToken(encryptedRefreshToken),
  }));
  return data;
}
