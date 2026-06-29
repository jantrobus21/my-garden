from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import json
import re
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime, timezone

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
    qr_code: Optional[str] = ""
    status: str = "healthy"  # healthy | thirsty | needs_fertilizer | issue
    latest_summary: Optional[str] = ""
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class PlantCreate(BaseModel):
    name: str
    species: Optional[str] = ""
    location: Optional[str] = ""
    photo_base64: Optional[str] = ""
    qr_code: Optional[str] = ""


class PlantUpdate(BaseModel):
    name: Optional[str] = None
    species: Optional[str] = None
    location: Optional[str] = None
    photo_base64: Optional[str] = None
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


# ===== Plant endpoints =====
@api_router.get("/")
async def root():
    return {"message": "BotanIQ API running"}


@api_router.post("/plants", response_model=Plant)
async def create_plant(payload: PlantCreate):
    plant = Plant(**payload.model_dump())
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
