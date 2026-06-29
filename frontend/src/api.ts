import { storage } from "@/src/utils/storage";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

if (!BASE) {
  console.warn("EXPO_PUBLIC_BACKEND_URL is not set");
}

export const API_BASE = `${BASE}/api`;

const TOKEN_KEY = "botaniq_session_token";

let cachedToken: string | null = null;
let onAuthFail: (() => void) | null = null;

export function setAuthFailHandler(handler: (() => void) | null) {
  onAuthFail = handler;
}

export async function loadToken(): Promise<string | null> {
  const t = await storage.secureGet<string>(TOKEN_KEY, "" as any);
  cachedToken = t || null;
  return cachedToken;
}

export async function saveToken(token: string) {
  cachedToken = token;
  await storage.secureSet(TOKEN_KEY, token);
}

export async function clearToken() {
  cachedToken = null;
  await storage.secureRemove(TOKEN_KEY);
}

export function getCachedToken() {
  return cachedToken;
}

export type Plant = {
  id: string;
  name: string;
  species?: string;
  location?: string;
  photo_base64?: string;
  plant_number?: string;
  qr_code?: string;
  status: "healthy" | "thirsty" | "needs_fertilizer" | "issue";
  latest_summary?: string;
  created_at: string;
};

export type Reading = {
  id: string;
  plant_id: string;
  moisture: number | null;
  fertility: number | null;
  ph: number | null;
  light: number | null;
  notes?: string;
  source: "manual" | "ai";
  created_at: string;
};

export type HealthAnalysis = {
  id: string;
  plant_id: string;
  status: Plant["status"];
  needs_water: boolean;
  needs_fertilizer: boolean;
  issues: string[];
  recommendation: string;
  confidence: number;
  created_at: string;
};

async function req<T>(path: string, init?: RequestInit, opts?: { skipAuth?: boolean }): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (!opts?.skipAuth && cachedToken) {
    headers.Authorization = `Bearer ${cachedToken}`;
  }
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (res.status === 401 && !opts?.skipAuth) {
    await clearToken();
    if (onAuthFail) onAuthFail();
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json();
}

export const api = {
  // auth (skip token)
  health: () =>
    req<{ status: string; configured: boolean; setup_enabled: boolean }>("/health", undefined, { skipAuth: true }),
  setupPin: (pin: string, setup_code: string) =>
    req<{ token: string; expires_at: string; recovery_code: string }>("/auth/setup", {
      method: "POST",
      body: JSON.stringify({ pin, setup_code }),
    }, { skipAuth: true }),
  loginPin: (pin: string) =>
    req<{ token: string; expires_at: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ pin }),
    }, { skipAuth: true }),
  logout: () => req<{ ok: boolean }>("/auth/logout", { method: "POST" }),
  changePin: (current_pin: string, new_pin: string) =>
    req<{ token: string; expires_at: string }>("/auth/change-pin", {
      method: "POST",
      body: JSON.stringify({ current_pin, new_pin }),
    }),
  regenerateRecovery: () =>
    req<{ recovery_code: string }>("/auth/regenerate-recovery", { method: "POST" }),
  resetPin: (recovery_code: string, new_pin: string) =>
    req<{ token: string; expires_at: string; recovery_code: string }>(
      "/auth/reset-pin-with-code",
      { method: "POST", body: JSON.stringify({ recovery_code, new_pin }) },
      { skipAuth: true }
    ),
  me: () => req<{ ok: boolean; created_at: string | null }>("/auth/me"),

  // share / printable downloads (issued protected, consumed once)
  sharePlant: (id: string) =>
    req<{ label_url: string; stl_url: string; expires_in: number }>(
      `/plants/${id}/share`,
      { method: "POST" }
    ),

  listPlants: () => req<Plant[]>("/plants"),
  nextPlantNumber: () => req<{ plant_number: string }>("/plants/next-number"),
  getPlant: (id: string) => req<Plant>(`/plants/${id}`),
  getPlantByQr: (code: string) => req<Plant>(`/plants/qr/${encodeURIComponent(code)}`),
  createPlant: (body: Partial<Plant>) =>
    req<Plant>("/plants", { method: "POST", body: JSON.stringify(body) }),
  updatePlant: (id: string, body: Partial<Plant>) =>
    req<Plant>(`/plants/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deletePlant: (id: string) => req<{ ok: boolean }>(`/plants/${id}`, { method: "DELETE" }),

  listReadings: (id: string) => req<Reading[]>(`/plants/${id}/readings`),
  listAnalyses: (id: string) => req<HealthAnalysis[]>(`/plants/${id}/analyses`),
  createReading: (body: Partial<Reading>) =>
    req<Reading>("/readings", { method: "POST", body: JSON.stringify(body) }),

  analyzeMeter: (image_base64: string, plant_id?: string) =>
    req<{ moisture: number | null; fertility: number | null; ph: number | null; light: number | null; raw?: string; reading_id?: string }>(
      "/analyze/meter",
      { method: "POST", body: JSON.stringify({ image_base64, plant_id }) }
    ),
  analyzeHealth: (image_base64: string, plant_id?: string) =>
    req<HealthAnalysis>("/analyze/health", {
      method: "POST",
      body: JSON.stringify({ image_base64, plant_id }),
    }),
  identifyPlant: (image_base64: string) =>
    req<{ common_name: string; species: string; confidence: number; note: string }>(
      "/analyze/identify",
      { method: "POST", body: JSON.stringify({ image_base64 }) }
    ),

  summary: () =>
    req<{ total: number; needs_water: number; needs_fertilizer: number; issues: number; healthy: number }>(
      "/summary"
    ),
};
