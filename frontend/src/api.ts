const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

if (!BASE) {
  console.warn("EXPO_PUBLIC_BACKEND_URL is not set");
}

export const API_BASE = `${BASE}/api`;

export type Plant = {
  id: string;
  name: string;
  species?: string;
  location?: string;
  photo_base64?: string;
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

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json();
}

export const api = {
  listPlants: () => req<Plant[]>("/plants"),
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
