from fastapi import FastAPI, APIRouter, HTTPException
from fastapi.responses import HTMLResponse, Response
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import io
import json
import re
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime, timezone

import qrcode
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from stl import mesh as stl_mesh

from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY', '')

app = FastAPI()
api_router = APIRouter(prefix="/api")


# ===== Models =====
class Plant(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    species: Optional[str] = ""
    location: Optional[str] = ""
    photo_base64: Optional[str] = ""
    plant_number: Optional[str] = ""
    qr_code: Optional[str] = ""
    status: str = "healthy"  # healthy | thirsty | needs_fertilizer | issue
    latest_summary: Optional[str] = ""
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class PlantCreate(BaseModel):
    name: str
    species: Optional[str] = ""
    location: Optional[str] = ""
    photo_base64: Optional[str] = ""
    plant_number: Optional[str] = ""
    qr_code: Optional[str] = ""


class PlantUpdate(BaseModel):
    name: Optional[str] = None
    species: Optional[str] = None
    location: Optional[str] = None
    photo_base64: Optional[str] = None
    plant_number: Optional[str] = None
    qr_code: Optional[str] = None
    status: Optional[str] = None
    latest_summary: Optional[str] = None


class Reading(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    plant_id: str
    moisture: Optional[float] = None
    fertility: Optional[float] = None
    ph: Optional[float] = None
    light: Optional[float] = None
    notes: Optional[str] = ""
    source: str = "manual"  # manual | ai
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ReadingCreate(BaseModel):
    plant_id: str
    moisture: Optional[float] = None
    fertility: Optional[float] = None
    ph: Optional[float] = None
    light: Optional[float] = None
    notes: Optional[str] = ""
    source: str = "manual"


class HealthAnalysis(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    plant_id: str
    status: str  # healthy | thirsty | needs_fertilizer | issue
    needs_water: bool = False
    needs_fertilizer: bool = False
    issues: List[str] = []
    recommendation: str = ""
    confidence: float = 0.0
    photo_base64: Optional[str] = ""
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class AnalyzeImageRequest(BaseModel):
    image_base64: str
    plant_id: Optional[str] = None


# ===== Helpers =====
def _strip_mongo_id(doc):
    if doc and "_id" in doc:
        doc.pop("_id", None)
    return doc


def _extract_json(text: str) -> dict:
    """Find first {...} block and parse it."""
    if not text:
        return {}
    # strip ```json ... ``` fences
    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if fence:
        try:
            return json.loads(fence.group(1))
        except Exception:
            pass
    match = re.search(r"\{[\s\S]*\}", text)
    if match:
        try:
            return json.loads(match.group(0))
        except Exception:
            pass
    return {}


async def _llm_vision(prompt: str, image_b64: str, system: str) -> str:
    if not EMERGENT_LLM_KEY:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY not configured")
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"plant-{uuid.uuid4()}",
        system_message=system,
    ).with_model("gemini", "gemini-3-flash-preview")

    # strip data URI prefix if present
    if "," in image_b64 and image_b64.startswith("data:"):
        image_b64 = image_b64.split(",", 1)[1]

    msg = UserMessage(
        text=prompt,
        file_contents=[ImageContent(image_base64=image_b64)],
    )
    result = await chat.send_message(msg)
    if isinstance(result, str):
        return result
    return str(result)


PLANT_NUMBER_RE = re.compile(r"^P\d+$", re.IGNORECASE)


async def _next_plant_number() -> str:
    docs = await db.plants.find(
        {"plant_number": {"$regex": "^P\\d+$", "$options": "i"}},
        {"plant_number": 1, "_id": 0},
    ).to_list(100000)
    used = set()
    for d in docs:
        pn = (d.get("plant_number") or "").upper()
        if PLANT_NUMBER_RE.match(pn):
            try:
                used.add(int(pn[1:]))
            except Exception:
                pass
    n = 1
    while n in used:
        n += 1
    # zero-pad to at least 4 digits for readability
    return f"P{n:04d}" if n < 10000 else f"P{n}"


# ===== Plant endpoints =====
@api_router.get("/")
async def root():
    return {"message": "BotanIQ API running"}


@api_router.get("/plants/next-number")
async def get_next_plant_number():
    return {"plant_number": await _next_plant_number()}


@api_router.post("/plants", response_model=Plant)
async def create_plant(payload: PlantCreate):
    plant = Plant(**payload.model_dump())
    # plant_number
    if plant.plant_number:
        plant.plant_number = plant.plant_number.strip().upper()
        if not PLANT_NUMBER_RE.match(plant.plant_number):
            raise HTTPException(status_code=400, detail="Plant ID must be P followed by digits, e.g. P0001")
        clash = await db.plants.find_one({"plant_number": plant.plant_number})
        if clash:
            raise HTTPException(status_code=409, detail=f"Plant ID '{plant.plant_number}' is already in use.")
    else:
        plant.plant_number = await _next_plant_number()
    # qr_code
    if plant.qr_code:
        plant.qr_code = plant.qr_code.strip()
    if not plant.qr_code:
        plant.qr_code = f"BIQ-{plant.id[:8].upper()}"
    existing = await db.plants.find_one({"qr_code": plant.qr_code})
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"QR code '{plant.qr_code}' is already assigned to another plant.",
        )
    doc = plant.model_dump()
    await db.plants.insert_one(doc)
    return plant


@api_router.get("/plants", response_model=List[Plant])
async def list_plants():
    docs = await db.plants.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return [Plant(**d) for d in docs]


@api_router.get("/plants/{plant_id}", response_model=Plant)
async def get_plant(plant_id: str):
    doc = await db.plants.find_one({"id": plant_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Plant not found")
    return Plant(**doc)


@api_router.get("/plants/qr/{qr_code}", response_model=Plant)
async def get_plant_by_qr(qr_code: str):
    doc = await db.plants.find_one({"qr_code": qr_code}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="No plant matches this QR code")
    return Plant(**doc)


@api_router.patch("/plants/{plant_id}", response_model=Plant)
async def update_plant(plant_id: str, payload: PlantUpdate):
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if "plant_number" in updates:
        updates["plant_number"] = updates["plant_number"].strip().upper()
        if updates["plant_number"] and not PLANT_NUMBER_RE.match(updates["plant_number"]):
            raise HTTPException(status_code=400, detail="Plant ID must be P followed by digits, e.g. P0001")
        if updates["plant_number"]:
            clash = await db.plants.find_one({"plant_number": updates["plant_number"], "id": {"$ne": plant_id}})
            if clash:
                raise HTTPException(status_code=409, detail=f"Plant ID '{updates['plant_number']}' is already in use.")
    if "qr_code" in updates:
        updates["qr_code"] = updates["qr_code"].strip()
        if not updates["qr_code"]:
            raise HTTPException(status_code=400, detail="QR code cannot be empty")
        clash = await db.plants.find_one(
            {"qr_code": updates["qr_code"], "id": {"$ne": plant_id}}
        )
        if clash:
            raise HTTPException(
                status_code=409,
                detail=f"QR code '{updates['qr_code']}' is already assigned to another plant.",
            )
    if not updates:
        doc = await db.plants.find_one({"id": plant_id}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Plant not found")
        return Plant(**doc)
    res = await db.plants.update_one({"id": plant_id}, {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Plant not found")
    doc = await db.plants.find_one({"id": plant_id}, {"_id": 0})
    return Plant(**doc)


@api_router.delete("/plants/{plant_id}")
async def delete_plant(plant_id: str):
    res = await db.plants.delete_one({"id": plant_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Plant not found")
    await db.readings.delete_many({"plant_id": plant_id})
    await db.analyses.delete_many({"plant_id": plant_id})
    return {"ok": True}


# ===== Readings =====
@api_router.post("/readings", response_model=Reading)
async def create_reading(payload: ReadingCreate):
    plant = await db.plants.find_one({"id": payload.plant_id})
    if not plant:
        raise HTTPException(status_code=404, detail="Plant not found")
    reading = Reading(**payload.model_dump())
    await db.readings.insert_one(reading.model_dump())

    # derive status from reading
    status = "healthy"
    needs_water = reading.moisture is not None and reading.moisture < 35
    needs_fert = reading.fertility is not None and reading.fertility < 30
    if needs_water:
        status = "thirsty"
    elif needs_fert:
        status = "needs_fertilizer"
    summary_bits = []
    if reading.moisture is not None:
        summary_bits.append(f"Moisture {reading.moisture:.0f}%")
    if reading.fertility is not None:
        summary_bits.append(f"Fertility {reading.fertility:.0f}%")
    if reading.ph is not None:
        summary_bits.append(f"pH {reading.ph:.1f}")
    summary = " · ".join(summary_bits) if summary_bits else "Reading saved"
    await db.plants.update_one(
        {"id": reading.plant_id},
        {"$set": {"status": status, "latest_summary": summary}},
    )
    return reading


@api_router.get("/plants/{plant_id}/readings", response_model=List[Reading])
async def list_readings(plant_id: str):
    docs = await db.readings.find({"plant_id": plant_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [Reading(**d) for d in docs]


@api_router.get("/plants/{plant_id}/analyses", response_model=List[HealthAnalysis])
async def list_analyses(plant_id: str):
    docs = await db.analyses.find({"plant_id": plant_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [HealthAnalysis(**d) for d in docs]


# ===== AI: Analyze meter =====
@api_router.post("/analyze/meter")
async def analyze_meter(payload: AnalyzeImageRequest):
    system = (
        "You are an expert at reading soil meters and plant sensors. "
        "Look at the meter image and extract numerical readings. "
        "Return ONLY a JSON object with keys: moisture, fertility, ph, light. "
        "Each value is either a number (percentage 0-100 for moisture/fertility/light, "
        "and 0-14 for ph) or null if not visible. Include nothing else."
    )
    prompt = (
        "Read this soil/plant meter. Return JSON: "
        '{"moisture": <0-100 or null>, "fertility": <0-100 or null>, '
        '"ph": <0-14 or null>, "light": <0-100 or null>}. '
        "If the meter shows DRY/MOIST/WET zones, estimate the percentage. "
        "If pH dial points to a value, return that number. "
        "Respond with ONLY the JSON, no prose."
    )
    try:
        raw = await _llm_vision(prompt, payload.image_base64, system)
    except Exception as e:
        logger.exception("meter analyze failed")
        raise HTTPException(status_code=502, detail=f"AI analysis failed: {e}")

    data = _extract_json(raw)

    def _num(v):
        if v is None:
            return None
        try:
            return float(v)
        except Exception:
            return None

    result = {
        "moisture": _num(data.get("moisture")),
        "fertility": _num(data.get("fertility")),
        "ph": _num(data.get("ph")),
        "light": _num(data.get("light")),
        "raw": raw,
    }

    if payload.plant_id:
        reading = Reading(
            plant_id=payload.plant_id,
            moisture=result["moisture"],
            fertility=result["fertility"],
            ph=result["ph"],
            light=result["light"],
            source="ai",
        )
        await db.readings.insert_one(reading.model_dump())
        result["reading_id"] = reading.id

    return result


# ===== AI: Analyze plant health =====
@api_router.post("/analyze/health")
async def analyze_health(payload: AnalyzeImageRequest):
    system = (
        "You are a professional botanist analysing houseplants from photos. "
        "Return ONLY structured JSON about the plant's health."
    )
    prompt = (
        "Examine this plant photo. Return ONLY this JSON structure:\n"
        "{\n"
        '  "status": "healthy" | "thirsty" | "needs_fertilizer" | "issue",\n'
        '  "needs_water": true/false,\n'
        '  "needs_fertilizer": true/false,\n'
        '  "issues": ["short issue 1", "short issue 2"],\n'
        '  "recommendation": "one or two sentences of actionable advice",\n'
        '  "confidence": 0.0-1.0\n'
        "}\n"
        "Look for: wilting, yellowing, browning, drooping, pests, mold, leaf curl, "
        "soil dryness visible. Be honest — if the plant looks fine, return status 'healthy' "
        "and empty issues array. Respond with ONLY the JSON."
    )
    try:
        raw = await _llm_vision(prompt, payload.image_base64, system)
    except Exception as e:
        logger.exception("health analyze failed")
        raise HTTPException(status_code=502, detail=f"AI analysis failed: {e}")

    data = _extract_json(raw)
    status = data.get("status") or "healthy"
    if status not in ("healthy", "thirsty", "needs_fertilizer", "issue"):
        status = "issue"
    analysis = HealthAnalysis(
        plant_id=payload.plant_id or "unassigned",
        status=status,
        needs_water=bool(data.get("needs_water", False)),
        needs_fertilizer=bool(data.get("needs_fertilizer", False)),
        issues=list(data.get("issues") or [])[:6],
        recommendation=str(data.get("recommendation") or "")[:500],
        confidence=float(data.get("confidence") or 0.7),
        photo_base64=payload.image_base64 if payload.plant_id else "",
    )

    if payload.plant_id:
        await db.analyses.insert_one(analysis.model_dump())
        summary = analysis.recommendation[:120] if analysis.recommendation else status.title()
        await db.plants.update_one(
            {"id": payload.plant_id},
            {"$set": {"status": analysis.status, "latest_summary": summary}},
        )

    return analysis


# ===== AI: Identify plant species =====
@api_router.post("/analyze/identify")
async def analyze_identify(payload: AnalyzeImageRequest):
    system = (
        "You are a professional botanist. Identify houseplants from photos. "
        "Return ONLY structured JSON."
    )
    prompt = (
        "Identify the plant in this photo. Return ONLY this JSON:\n"
        "{\n"
        '  "common_name": "best common name (e.g. Monstera, Snake Plant)",\n'
        '  "species": "scientific name (e.g. Monstera deliciosa)",\n'
        '  "confidence": 0.0-1.0,\n'
        '  "note": "one short sentence about care if confident, empty otherwise"\n'
        "}\n"
        "If you cannot tell with reasonable confidence, set common_name to "
        '"Unknown plant" and confidence below 0.4. Respond with ONLY the JSON.'
    )
    try:
        raw = await _llm_vision(prompt, payload.image_base64, system)
    except Exception as e:
        logger.exception("identify failed")
        raise HTTPException(status_code=502, detail=f"AI identify failed: {e}")

    data = _extract_json(raw)
    return {
        "common_name": str(data.get("common_name") or "Unknown plant")[:80],
        "species": str(data.get("species") or "")[:120],
        "confidence": float(data.get("confidence") or 0.0),
        "note": str(data.get("note") or "")[:240],
    }


# ===== Dashboard summary =====
@api_router.get("/summary")
async def summary():
    plants = await db.plants.find({}, {"_id": 0}).to_list(1000)
    needs_water = sum(1 for p in plants if p.get("status") == "thirsty")
    needs_fert = sum(1 for p in plants if p.get("status") == "needs_fertilizer")
    issues = sum(1 for p in plants if p.get("status") == "issue")
    healthy = sum(1 for p in plants if p.get("status") == "healthy")
    return {
        "total": len(plants),
        "needs_water": needs_water,
        "needs_fertilizer": needs_fert,
        "issues": issues,
        "healthy": healthy,
    }


# ===== Label / sticker / STL =====
def _qr_matrix(data: str) -> np.ndarray:
    qr = qrcode.QRCode(border=0, box_size=1, error_correction=qrcode.constants.ERROR_CORRECT_M)
    qr.add_data(data or "")
    qr.make(fit=True)
    matrix = qr.get_matrix()
    return np.array(matrix, dtype=bool)


def _qr_svg(data: str, size: int = 200) -> str:
    matrix = _qr_matrix(data)
    n = matrix.shape[0]
    cell = size / n
    rects = []
    for y in range(n):
        for x in range(n):
            if matrix[y, x]:
                rects.append(
                    f'<rect x="{x * cell:.3f}" y="{y * cell:.3f}" '
                    f'width="{cell:.3f}" height="{cell:.3f}" fill="#1A211C"/>'
                )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" '
        f'viewBox="0 0 {size} {size}" shape-rendering="crispEdges">'
        f'<rect width="{size}" height="{size}" fill="#fff"/>'
        + "".join(rects)
        + "</svg>"
    )


@api_router.get("/plants/{plant_id}/label.html", response_class=HTMLResponse)
async def plant_label_html(plant_id: str):
    plant = await db.plants.find_one({"id": plant_id}, {"_id": 0})
    if not plant:
        raise HTTPException(status_code=404, detail="Plant not found")
    qr_data = plant.get("qr_code") or plant_id
    svg = _qr_svg(qr_data, size=220)
    name = (plant.get("name") or "Plant").replace("<", "&lt;")
    species = (plant.get("species") or "").replace("<", "&lt;")
    number = plant.get("plant_number") or ""
    html = f"""<!doctype html>
<html><head><meta charset="utf-8"><title>{name} — label</title>
<style>
  @page {{ size: 80mm 50mm; margin: 0; }}
  body {{ margin: 0; font-family: -apple-system, system-ui, sans-serif; background: #f4f4f1; padding: 24px; }}
  .label {{ width: 80mm; height: 50mm; background: #fff; border: 2px solid #3C6E4A; border-radius: 6mm;
    display: flex; padding: 4mm; box-sizing: border-box; align-items: center; gap: 4mm; margin: 0 auto;
    box-shadow: 0 6px 24px rgba(0,0,0,0.08); }}
  .qr {{ flex: 0 0 42mm; height: 42mm; display: flex; align-items: center; justify-content: center; }}
  .qr svg {{ width: 100%; height: 100%; }}
  .info {{ flex: 1; min-width: 0; }}
  .num {{ font-size: 14pt; font-weight: 700; letter-spacing: 2px; color: #3C6E4A; text-transform: uppercase; }}
  .name {{ font-size: 14pt; font-weight: 700; color: #1A211C; line-height: 1.1; margin-top: 4px;
    overflow: hidden; text-overflow: ellipsis; }}
  .sp {{ font-size: 9pt; color: #3A453C; margin-top: 4px; font-style: italic;
    overflow: hidden; text-overflow: ellipsis; }}
  .brand {{ font-size: 7pt; color: #7A8A7C; letter-spacing: 1px; margin-top: 6px; }}
  .toolbar {{ max-width: 80mm; margin: 16px auto; display: flex; gap: 8px; justify-content: center; }}
  .toolbar button {{ background: #3C6E4A; color: #fff; border: 0; padding: 8px 16px;
    border-radius: 999px; font-weight: 700; cursor: pointer; }}
  @media print {{ body {{ background: #fff; padding: 0; }} .toolbar {{ display: none; }} .label {{ box-shadow: none; }} }}
</style></head>
<body>
  <div class="label">
    <div class="qr">{svg}</div>
    <div class="info">
      <div class="num">{number}</div>
      <div class="name">{name}</div>
      <div class="sp">{species}</div>
      <div class="brand">BotanIQ</div>
    </div>
  </div>
  <div class="toolbar">
    <button onclick="window.print()">Print label</button>
  </div>
</body></html>"""
    return HTMLResponse(html)


# ----- STL tag generation -----
def _box_mesh(x0, y0, z0, x1, y1, z1):
    """Return 12-triangle box vertex array."""
    v = np.array([
        [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
        [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
    ])
    faces = np.array([
        [0, 3, 1], [1, 3, 2],  # bottom
        [4, 5, 7], [5, 6, 7],  # top
        [0, 1, 4], [1, 5, 4],  # front
        [2, 3, 6], [3, 7, 6],  # back
        [1, 2, 5], [2, 6, 5],  # right
        [0, 4, 3], [3, 4, 7],  # left
    ])
    tris = v[faces]
    return tris


def _text_matrix(text: str, height_px: int = 28) -> np.ndarray:
    """Render text into a binary 2D matrix using PIL default font (no external fonts)."""
    # Use a slightly larger pixel font for clarity
    font = ImageFont.load_default()
    img = Image.new("L", (max(8, len(text) * 7 + 8), height_px), 0)
    draw = ImageDraw.Draw(img)
    draw.text((2, max(2, (height_px - 11) // 2)), text, fill=255, font=font)
    arr = np.array(img) > 128
    # Trim transparent borders
    if arr.any():
        ys, xs = np.where(arr)
        arr = arr[ys.min(): ys.max() + 1, xs.min(): xs.max() + 1]
    return arr


def _build_tag_stl(name: str, number: str, qr_data: str) -> bytes:
    """
    Build a flat 3D-printable tag (~60×35×2mm) with:
      - solid plate
      - QR code as raised cells (1mm above)
      - text (name + number) extruded above the plate
      - hanging hole
    Returns binary STL bytes.
    """
    plate_w = 70.0
    plate_h = 35.0
    plate_t = 2.0
    cell_h = 1.0  # extrude height of QR / text

    triangles: list = []

    # 1. Plate (with a notch removed for hole)
    triangles.extend(_box_mesh(0, 0, 0, plate_w, plate_h, plate_t))

    # 2. QR code on left side
    qr_size = 26.0
    qr_x = 3.0
    qr_y = (plate_h - qr_size) / 2
    matrix = _qr_matrix(qr_data)
    n = matrix.shape[0]
    cell = qr_size / n
    for y in range(n):
        for x in range(n):
            if matrix[y, x]:
                x0 = qr_x + x * cell
                # Y inverted so QR isn't mirrored
                y0 = qr_y + (n - 1 - y) * cell
                triangles.extend(_box_mesh(x0, y0, plate_t, x0 + cell, y0 + cell, plate_t + cell_h))

    # 3. Text region (name + number) on right side
    text_area_x = qr_x + qr_size + 4.0
    text_area_w = plate_w - text_area_x - 4.0
    text_area_h = plate_h - 6.0

    # Number on top, name below
    number_arr = _text_matrix(number or "", height_px=24)
    name_arr = _text_matrix((name or "")[:18], height_px=24)

    def _place(arr: np.ndarray, x_start: float, y_start: float, target_w: float, target_h: float):
        if arr.size == 0:
            return
        rows, cols = arr.shape
        scale = min(target_w / cols, target_h / rows)
        if scale <= 0:
            return
        px = scale
        for ry in range(rows):
            for cx in range(cols):
                if arr[ry, cx]:
                    x0 = x_start + cx * px
                    y0 = y_start + (rows - 1 - ry) * px
                    triangles.extend(_box_mesh(x0, y0, plate_t, x0 + px, y0 + px, plate_t + cell_h))

    # Number block (top half)
    _place(number_arr, text_area_x, 3 + text_area_h * 0.55, text_area_w, text_area_h * 0.40)
    # Name block (bottom half)
    _place(name_arr, text_area_x, 3 + text_area_h * 0.08, text_area_w, text_area_h * 0.40)

    # 4. Hanging hole — implemented as an extruded bump (acts as ring on outside top).
    # We add a small donut-like raised cylinder by approximating with boxes.
    hole_cx = plate_w - 4.5
    hole_cy = plate_h - 4.5
    # simple raised square ring (purely cosmetic indicator; print can drill the hole)
    ring_outer = 3.0
    ring_inner = 1.5
    for dx in np.linspace(-ring_outer, ring_outer, 9):
        for dy in np.linspace(-ring_outer, ring_outer, 9):
            r = (dx ** 2 + dy ** 2) ** 0.5
            if ring_inner < r <= ring_outer:
                s = 0.6
                triangles.extend(_box_mesh(hole_cx + dx, hole_cy + dy, plate_t, hole_cx + dx + s, hole_cy + dy + s, plate_t + cell_h))

    if not triangles:
        triangles.extend(_box_mesh(0, 0, 0, plate_w, plate_h, plate_t))

    all_tris = np.concatenate(triangles, axis=0)
    n_tri = all_tris.shape[0] // 3
    data = np.zeros(n_tri, dtype=stl_mesh.Mesh.dtype)
    data["vectors"] = all_tris.reshape(n_tri, 3, 3)
    m = stl_mesh.Mesh(data)
    buf = io.BytesIO()
    m.save("tag.stl", fh=buf, mode=1)  # mode=1 binary
    return buf.getvalue()


@api_router.get("/plants/{plant_id}/tag.stl")
async def plant_tag_stl(plant_id: str):
    plant = await db.plants.find_one({"id": plant_id}, {"_id": 0})
    if not plant:
        raise HTTPException(status_code=404, detail="Plant not found")
    qr_data = plant.get("qr_code") or plant_id
    name = plant.get("name") or "Plant"
    number = plant.get("plant_number") or ""
    stl_bytes = _build_tag_stl(name=name, number=number, qr_data=qr_data)
    safe = re.sub(r"[^A-Za-z0-9_-]+", "_", f"{number or 'plant'}_{name}")[:40] or "plant_tag"
    headers = {"Content-Disposition": f'attachment; filename="{safe}.stl"'}
    return Response(content=stl_bytes, media_type="model/stl", headers=headers)


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
