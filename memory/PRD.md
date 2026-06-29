# BotanIQ — Plant Care Tracker

## Vision
A single-user mobile app to scan plants and soil meters with the camera, let AI extract readings + diagnose problems, and keep every plant's history under a unique QR tag.

## Core Features (v1)
1. **Plant Garden** — list/grid of all tracked plants with status badges (Healthy / Thirsty / Feed Me / Issue) and summary counters.
2. **Add Plant** — name, species, location, optional photo. Each plant gets an auto-generated unique ID + printable QR code (e.g. `BIQ-1A2B3C4D`).
3. **Plant Detail** — hero image, plant tag, latest metrics (Moisture, Fertility, pH, Light), and combined timeline of AI analyses + meter readings.
4. **AI Scan Hub** with three modes:
   - **Plant Health**: photo → Gemini 3 Flash returns `status`, `needs_water`, `needs_fertilizer`, `issues[]`, `recommendation`.
   - **Meter**: photo → Gemini 3 Flash extracts moisture %, fertility %, pH, light %.
   - **QR Tag**: live camera scan jumps directly to the matching plant's detail screen.
5. **Activity Feed** — most recent updates across the garden.
6. **Status engine** — plants are auto-flagged thirsty (moisture < 35) or needs_fertilizer (fertility < 30) when a reading is saved; AI analyses also overwrite status.

## Architecture
- **Frontend**: React Native + Expo SDK 54, expo-router with bottom tabs (Garden, Scan, Activity) + modal stacks for Add Plant and Scan Result. Camera via `expo-camera` (QR) and `expo-image-picker` (photo capture). Earthy Botanical iOS-Native Clean theme (`#3C6E4A` brand, sage neutrals).
- **Backend**: FastAPI + MongoDB (motor). All routes under `/api`. Pydantic models, no `_id` leaks.
- **AI**: `emergentintegrations` `LlmChat` with model `gemini-3-flash-preview`. Image sent as `ImageContent(base64)`; response parsed for JSON.

## Key Endpoints
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/plants` | List plants |
| POST | `/api/plants` | Create plant (auto QR) |
| GET | `/api/plants/{id}` | Plant detail |
| GET | `/api/plants/qr/{qr_code}` | Lookup by QR |
| PATCH | `/api/plants/{id}` | Update plant |
| DELETE | `/api/plants/{id}` | Delete plant + history |
| POST | `/api/readings` | Save meter reading (updates status) |
| GET | `/api/plants/{id}/readings` | Reading history |
| GET | `/api/plants/{id}/analyses` | AI analysis history |
| POST | `/api/analyze/meter` | AI extract meter data |
| POST | `/api/analyze/health` | AI plant health analysis |
| GET | `/api/summary` | Dashboard counters |

## Environment
- `EMERGENT_LLM_KEY` in `/app/backend/.env` for Gemini 3 Flash vision.
- `MONGO_URL`, `DB_NAME` for storage.
- `EXPO_PUBLIC_BACKEND_URL` for frontend → backend.

## Future Ideas (smart business enhancement)
- **Care subscription**: paid plan to unlock weekly AI care reports and printable QR sticker sheets you can mail-order.
- Reminder push notifications.
- Multi-user / household sharing.
- Pest identification + product recommendations (affiliate revenue).
