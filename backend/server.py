from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request
from fastapi.responses import HTMLResponse, Response
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import io
import json
import html as html_lib
import re
import secrets
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime, timezone, timedelta

import qrcode
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from stl import mesh as stl_mesh
from passlib.context import CryptContext

from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY', '')

# ---- Auth config ----
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
SESSION_TTL_DAYS = 30
MIN_PIN_LENGTH = 6
MAX_PIN_ATTEMPTS = 5
# Escalating lockout in seconds, applied by failure cohort
LOCKOUT_LADDER = [30, 5 * 60, 60 * 60, 24 * 60 * 60]  # 30s, 5m, 1h, 24h
DOWNLOAD_TOKEN_TTL_SECONDS = 5 * 60

# One-time setup code — required for the very first /auth/setup call.
# If unset on a fresh deploy, setup is disabled.
APP_SETUP_CODE = os.environ.get('APP_SETUP_CODE', '').strip()


def _hash_token(token: str) -> str:
    import hashlib
    return hashlib.sha256(token.encode("utf-8")).hexdigest()

app = FastAPI()
api_router = APIRouter(prefix="/api")


# ===== Models =====
class Plant(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str = Field(..., max_length=120)
    species: Optional[str] = Field("", max_length=120)
    location: Optional[str] = Field("", max_length=120)
    photo_base64: Optional[str] = Field("", max_length=8_000_000)
    plant_number: Optional[str] = Field("", max_length=12)
    qr_code: Optional[str] = Field("", max_length=128)
    status: str = "healthy"  # healthy | thirsty | needs_fertilizer | issue
    latest_summary: Optional[str] = Field("", max_length=240)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class PlantCreate(BaseModel):
    name: str = Field(..., max_length=120)
    species: Optional[str] = Field("", max_length=120)
    location: Optional[str] = Field("", max_length=120)
    photo_base64: Optional[str] = Field("", max_length=8_000_000)
    plant_number: Optional[str] = Field("", max_length=12)
    qr_code: Optional[str] = Field("", max_length=128)


class PlantUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=120)
    species: Optional[str] = Field(None, max_length=120)
    location: Optional[str] = Field(None, max_length=120)
    photo_base64: Optional[str] = Field(None, max_length=8_000_000)
    plant_number: Optional[str] = Field(None, max_length=12)
    qr_code: Optional[str] = Field(None, max_length=128)
    status: Optional[str] = None
    latest_summary: Optional[str] = Field(None, max_length=240)


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
    image_base64: str = Field(..., max_length=8_000_000)  # ~6 MB decoded
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
    # Use an aggregation that scans only plant_number values — bounded and fast even at scale.
    docs = await db.plants.find(
        {"plant_number": {"$regex": "^P\\d+$", "$options": "i"}},
        {"plant_number": 1, "_id": 0},
    ).to_list(5000)
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


# ===== Auth =====
class PinPayload(BaseModel):
    pin: str = Field(..., min_length=MIN_PIN_LENGTH, max_length=10)


class SetupPayload(PinPayload):
    setup_code: str = Field(..., min_length=4, max_length=128)


class ChangePinPayload(BaseModel):
    current_pin: str = Field(..., min_length=MIN_PIN_LENGTH, max_length=10)
    new_pin: str = Field(..., min_length=MIN_PIN_LENGTH, max_length=10)


class RegenerateRecoveryPayload(BaseModel):
    pin: str = Field(..., min_length=MIN_PIN_LENGTH, max_length=10)


class ResetPinPayload(BaseModel):
    recovery_code: str = Field(..., min_length=8, max_length=64)
    new_pin: str = Field(..., min_length=MIN_PIN_LENGTH, max_length=10)


class AuthOk(BaseModel):
    token: str
    expires_at: datetime


class SetupOk(AuthOk):
    recovery_code: str


async def _create_session() -> dict:
    now = datetime.now(timezone.utc)
    token = secrets.token_urlsafe(32)
    doc = {
        "token_hash": _hash_token(token),
        "created_at": now,
        "expires_at": now + timedelta(days=SESSION_TTL_DAYS),
        "revoked": False,
    }
    await db.sessions.insert_one(doc)
    return {"token": token, "expires_at": doc["expires_at"]}


async def require_auth(request: Request) -> dict:
    auth_header = request.headers.get("authorization") or request.headers.get("Authorization")
    token: Optional[str] = None
    if auth_header and auth_header.lower().startswith("bearer "):
        token = auth_header.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization")
    session = await db.sessions.find_one({"token_hash": _hash_token(token), "revoked": False})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid or revoked session")
    expires_at = session.get("expires_at")
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at and datetime.now(timezone.utc) >= expires_at:
        raise HTTPException(status_code=401, detail="Session expired")
    return session


@api_router.get("/health")
async def health():
    admin = await db.admin.find_one({"_id": "admin"})
    return {
        "status": "ok",
        "configured": admin is not None,
        "setup_enabled": admin is None and bool(APP_SETUP_CODE),
    }


def _generate_recovery_code() -> str:
    """Human-friendly 16-char recovery code: 4 groups of 4 hex chars."""
    raw = secrets.token_hex(8).upper()
    return f"{raw[0:4]}-{raw[4:8]}-{raw[8:12]}-{raw[12:16]}"


@api_router.post("/auth/setup", response_model=SetupOk)
async def auth_setup(payload: SetupPayload):
    if not payload.pin.isdigit():
        raise HTTPException(status_code=400, detail="PIN must be digits only")
    if not APP_SETUP_CODE:
        raise HTTPException(status_code=403, detail="Setup is disabled. Configure APP_SETUP_CODE on the server.")
    if not secrets.compare_digest(payload.setup_code, APP_SETUP_CODE):
        raise HTTPException(status_code=403, detail="Invalid setup code")
    existing = await db.admin.find_one({"_id": "admin"})
    if existing is not None:
        raise HTTPException(status_code=409, detail="Already configured. Use /auth/login.")
    pin_hash = pwd_context.hash(payload.pin)
    recovery_code = _generate_recovery_code()
    recovery_hash = pwd_context.hash(recovery_code)
    await db.admin.insert_one({
        "_id": "admin",
        "pin_hash": pin_hash,
        "recovery_hash": recovery_hash,
        "created_at": datetime.now(timezone.utc),
        "failed_attempts": 0,
        "total_failed": 0,
        "lock_until": None,
    })
    session = await _create_session()
    return SetupOk(token=session["token"], expires_at=session["expires_at"], recovery_code=recovery_code)


def _lock_seconds_for(total_failed: int) -> int:
    # Each MAX_PIN_ATTEMPTS-sized cohort escalates the lock window.
    cohort = max(0, (total_failed // MAX_PIN_ATTEMPTS) - 1)
    idx = min(cohort, len(LOCKOUT_LADDER) - 1)
    return LOCKOUT_LADDER[idx]


@api_router.post("/auth/login", response_model=AuthOk)
async def auth_login(payload: PinPayload):
    if not payload.pin.isdigit():
        raise HTTPException(status_code=400, detail="PIN must be digits only")
    admin = await db.admin.find_one({"_id": "admin"})
    if not admin:
        raise HTTPException(status_code=400, detail="Not configured. Set up a PIN first.")
    now = datetime.now(timezone.utc)
    lock_until = admin.get("lock_until")
    if lock_until and lock_until.tzinfo is None:
        lock_until = lock_until.replace(tzinfo=timezone.utc)
    if lock_until and now < lock_until:
        wait = int((lock_until - now).total_seconds()) + 1
        raise HTTPException(status_code=429, detail=f"Too many attempts. Try again in {wait}s.")
    if not pwd_context.verify(payload.pin, admin["pin_hash"]):
        # Atomic increment so concurrent attempts don't trample each other.
        updated = await db.admin.find_one_and_update(
            {"_id": "admin"},
            {"$inc": {"failed_attempts": 1, "total_failed": 1}},
            return_document=True,
        )
        failed = updated.get("failed_attempts", 0)
        total = updated.get("total_failed", 0)
        if failed >= MAX_PIN_ATTEMPTS:
            lock_seconds = _lock_seconds_for(total)
            await db.admin.update_one(
                {"_id": "admin"},
                {"$set": {"lock_until": now + timedelta(seconds=lock_seconds), "failed_attempts": 0}},
            )
        raise HTTPException(status_code=401, detail="Incorrect PIN")
    # Success: reset the current-window counter but keep total_failed (history).
    await db.admin.update_one(
        {"_id": "admin"},
        {"$set": {"failed_attempts": 0, "lock_until": None}},
    )
    session = await _create_session()
    return AuthOk(token=session["token"], expires_at=session["expires_at"])


@api_router.post("/auth/logout")
async def auth_logout(session: dict = Depends(require_auth)):
    # Hard-delete on logout so revoked tokens can't be probed.
    await db.sessions.delete_one({"token_hash": session["token_hash"]})
    return {"ok": True}


@api_router.get("/auth/me")
async def auth_me(_: dict = Depends(require_auth)):
    admin = await db.admin.find_one({"_id": "admin"}, {"_id": 0, "created_at": 1})
    return {
        "ok": True,
        "created_at": admin.get("created_at") if admin else None,
    }


@api_router.post("/auth/change-pin", response_model=AuthOk)
async def auth_change_pin(payload: ChangePinPayload, session: dict = Depends(require_auth)):
    if not payload.new_pin.isdigit() or not payload.current_pin.isdigit():
        raise HTTPException(status_code=400, detail="PIN must be digits only")
    admin = await db.admin.find_one({"_id": "admin"})
    if not admin:
        raise HTTPException(status_code=400, detail="Not configured")
    if not pwd_context.verify(payload.current_pin, admin["pin_hash"]):
        raise HTTPException(status_code=401, detail="Current PIN is incorrect")
    if payload.new_pin == payload.current_pin:
        raise HTTPException(status_code=400, detail="New PIN must be different")
    new_hash = pwd_context.hash(payload.new_pin)
    await db.admin.update_one({"_id": "admin"}, {"$set": {"pin_hash": new_hash}})
    # Rotate session: wipe ALL sessions (including this one) and issue a fresh token.
    await db.sessions.delete_many({})
    new_session = await _create_session()
    return AuthOk(token=new_session["token"], expires_at=new_session["expires_at"])


@api_router.post("/auth/regenerate-recovery")
async def auth_regenerate_recovery(payload: RegenerateRecoveryPayload, _: dict = Depends(require_auth)):
    if not payload.pin.isdigit():
        raise HTTPException(status_code=400, detail="PIN must be digits only")
    admin = await db.admin.find_one({"_id": "admin"})
    if not admin:
        raise HTTPException(status_code=400, detail="Not configured")
    # Honour the lockout window for this PIN-gated action too.
    now = datetime.now(timezone.utc)
    lock_until = admin.get("lock_until")
    if lock_until and lock_until.tzinfo is None:
        lock_until = lock_until.replace(tzinfo=timezone.utc)
    if lock_until and now < lock_until:
        wait = int((lock_until - now).total_seconds()) + 1
        raise HTTPException(status_code=429, detail=f"Too many attempts. Try again in {wait}s.")
    if not pwd_context.verify(payload.pin, admin["pin_hash"]):
        # Same brute-force tracking as /auth/login
        updated = await db.admin.find_one_and_update(
            {"_id": "admin"},
            {"$inc": {"failed_attempts": 1, "total_failed": 1}},
            return_document=True,
        )
        failed = updated.get("failed_attempts", 0)
        total = updated.get("total_failed", 0)
        if failed >= MAX_PIN_ATTEMPTS:
            lock_seconds = _lock_seconds_for(total)
            await db.admin.update_one(
                {"_id": "admin"},
                {"$set": {"lock_until": now + timedelta(seconds=lock_seconds), "failed_attempts": 0}},
            )
        raise HTTPException(status_code=401, detail="PIN is incorrect")
    new_code = _generate_recovery_code()
    new_hash = pwd_context.hash(new_code)
    await db.admin.update_one(
        {"_id": "admin"},
        {"$set": {"recovery_hash": new_hash, "failed_attempts": 0, "lock_until": None}},
    )
    return {"recovery_code": new_code}


@api_router.post("/auth/reset-pin-with-code")
async def auth_reset_pin_with_code(payload: ResetPinPayload):
    if not payload.new_pin.isdigit():
        raise HTTPException(status_code=400, detail="PIN must be digits only")
    admin = await db.admin.find_one({"_id": "admin"})
    if not admin:
        raise HTTPException(status_code=400, detail="Not configured")
    # Throttle: honour the same lockout window as /auth/login.
    now = datetime.now(timezone.utc)
    lock_until = admin.get("lock_until")
    if lock_until and lock_until.tzinfo is None:
        lock_until = lock_until.replace(tzinfo=timezone.utc)
    if lock_until and now < lock_until:
        wait = int((lock_until - now).total_seconds()) + 1
        raise HTTPException(status_code=429, detail=f"Too many attempts. Try again in {wait}s.")
    recovery_hash = admin.get("recovery_hash")
    if not recovery_hash:
        raise HTTPException(status_code=400, detail="No recovery code set for this account")
    submitted = payload.recovery_code.upper().replace(" ", "")
    if "-" not in submitted and len(submitted) == 16:
        submitted = f"{submitted[0:4]}-{submitted[4:8]}-{submitted[8:12]}-{submitted[12:16]}"
    if not pwd_context.verify(submitted, recovery_hash):
        # Shared brute-force counter + lockout escalation.
        updated = await db.admin.find_one_and_update(
            {"_id": "admin"},
            {"$inc": {"failed_attempts": 1, "total_failed": 1}},
            return_document=True,
        )
        failed = updated.get("failed_attempts", 0)
        total = updated.get("total_failed", 0)
        if failed >= MAX_PIN_ATTEMPTS:
            lock_seconds = _lock_seconds_for(total)
            await db.admin.update_one(
                {"_id": "admin"},
                {"$set": {"lock_until": now + timedelta(seconds=lock_seconds), "failed_attempts": 0}},
            )
        raise HTTPException(status_code=401, detail="Invalid recovery code")
    new_pin_hash = pwd_context.hash(payload.new_pin)
    new_recovery = _generate_recovery_code()
    new_recovery_hash = pwd_context.hash(new_recovery)
    await db.admin.update_one(
        {"_id": "admin"},
        {"$set": {
            "pin_hash": new_pin_hash,
            "recovery_hash": new_recovery_hash,
            "failed_attempts": 0,
            "lock_until": None,
        }},
    )
    await db.sessions.delete_many({})
    session = await _create_session()
    return {
        "token": session["token"],
        "expires_at": session["expires_at"],
        "recovery_code": new_recovery,
    }


# Protected router for all data endpoints
protected_router = APIRouter(prefix="/api", dependencies=[Depends(require_auth)])


# ===== Download tokens (short-lived) for label.html and tag.stl =====
async def _issue_download_token(plant_id: str, kind: str) -> str:
    token = secrets.token_urlsafe(24)
    now = datetime.now(timezone.utc)
    await db.download_tokens.insert_one({
        "token_hash": _hash_token(token),
        "plant_id": plant_id,
        "kind": kind,  # "label" | "stl"
        "created_at": now,
        "expires_at": now + timedelta(seconds=DOWNLOAD_TOKEN_TTL_SECONDS),
        "used": False,
    })
    return token


async def _consume_download_token(token: str, plant_id: str, kind: str) -> bool:
    if not token:
        return False
    res = await db.download_tokens.find_one_and_update(
        {
            "token_hash": _hash_token(token),
            "plant_id": plant_id,
            "kind": kind,
            "used": False,
            "expires_at": {"$gt": datetime.now(timezone.utc)},
        },
        {"$set": {"used": True, "used_at": datetime.now(timezone.utc)}},
    )
    return res is not None


@protected_router.post("/plants/{plant_id}/share")
async def issue_share_tokens(plant_id: str):
    plant = await db.plants.find_one({"id": plant_id}, {"_id": 0, "id": 1})
    if not plant:
        raise HTTPException(status_code=404, detail="Plant not found")
    label = await _issue_download_token(plant_id, "label")
    stl = await _issue_download_token(plant_id, "stl")
    return {
        "label_url": f"/api/plants/{plant_id}/label.html?d={label}",
        "stl_url": f"/api/plants/{plant_id}/tag.stl?d={stl}",
        "expires_in": DOWNLOAD_TOKEN_TTL_SECONDS,
    }


# ===== Plant endpoints =====
@protected_router.get("/")
async def root():
    return {"message": "BotanIQ API running"}


@protected_router.get("/plants/next-number")
async def get_next_plant_number():
    return {"plant_number": await _next_plant_number()}


@protected_router.post("/plants", response_model=Plant)
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


@protected_router.get("/plants", response_model=List[Plant])
async def list_plants():
    docs = await db.plants.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return [Plant(**d) for d in docs]


@protected_router.get("/plants/{plant_id}", response_model=Plant)
async def get_plant(plant_id: str):
    doc = await db.plants.find_one({"id": plant_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Plant not found")
    return Plant(**doc)


@protected_router.get("/plants/qr/{qr_code}", response_model=Plant)
async def get_plant_by_qr(qr_code: str):
    doc = await db.plants.find_one({"qr_code": qr_code}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="No plant matches this QR code")
    return Plant(**doc)


@protected_router.patch("/plants/{plant_id}", response_model=Plant)
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


@protected_router.delete("/plants/{plant_id}")
async def delete_plant(plant_id: str):
    res = await db.plants.delete_one({"id": plant_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Plant not found")
    await db.readings.delete_many({"plant_id": plant_id})
    await db.analyses.delete_many({"plant_id": plant_id})
    return {"ok": True}


# ===== Readings =====
@protected_router.post("/readings", response_model=Reading)
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


@protected_router.get("/plants/{plant_id}/readings", response_model=List[Reading])
async def list_readings(plant_id: str):
    docs = await db.readings.find({"plant_id": plant_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [Reading(**d) for d in docs]


@protected_router.get("/plants/{plant_id}/analyses", response_model=List[HealthAnalysis])
async def list_analyses(plant_id: str):
    docs = await db.analyses.find({"plant_id": plant_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [HealthAnalysis(**d) for d in docs]


# ===== AI: Analyze meter =====
@protected_router.post("/analyze/meter")
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
    except Exception:
        logger.exception("meter analyze failed")
        raise HTTPException(status_code=502, detail="AI service unavailable. Try again shortly.")

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
@protected_router.post("/analyze/health")
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
    except Exception:
        logger.exception("health analyze failed")
        raise HTTPException(status_code=502, detail="AI service unavailable. Try again shortly.")

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
@protected_router.post("/analyze/identify")
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
    except Exception:
        logger.exception("identify failed")
        raise HTTPException(status_code=502, detail="AI service unavailable. Try again shortly.")

    data = _extract_json(raw)
    return {
        "common_name": str(data.get("common_name") or "Unknown plant")[:80],
        "species": str(data.get("species") or "")[:120],
        "confidence": float(data.get("confidence") or 0.0),
        "note": str(data.get("note") or "")[:240],
    }


# ===== Dashboard summary =====
@protected_router.get("/summary")
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
async def plant_label_html(plant_id: str, d: Optional[str] = None):
    ok = await _consume_download_token(d or "", plant_id, "label")
    if not ok:
        raise HTTPException(status_code=401, detail="Invalid or expired download link")
    plant = await db.plants.find_one({"id": plant_id}, {"_id": 0})
    if not plant:
        raise HTTPException(status_code=404, detail="Plant not found")
    qr_data = plant.get("qr_code") or plant_id
    svg = _qr_svg(qr_data, size=220)
    name = html_lib.escape(plant.get("name") or "Plant")
    species = html_lib.escape(plant.get("species") or "")
    number = html_lib.escape(plant.get("plant_number") or "")
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
async def plant_tag_stl(plant_id: str, d: Optional[str] = None):
    ok = await _consume_download_token(d or "", plant_id, "stl")
    if not ok:
        raise HTTPException(status_code=401, detail="Invalid or expired download link")
    plant = await db.plants.find_one({"id": plant_id}, {"_id": 0})
    if not plant:
        raise HTTPException(status_code=404, detail="Plant not found")
    qr_data = plant.get("qr_code") or plant_id
    name = plant.get("name") or "Plant"
    number = plant.get("plant_number") or ""
    try:
        stl_bytes = _build_tag_stl(name=name, number=number, qr_data=qr_data)
    except Exception:
        logger.exception("STL build failed")
        raise HTTPException(status_code=500, detail="Could not generate STL for this plant.")
    safe = re.sub(r"[^A-Za-z0-9_-]+", "_", f"{number or 'plant'}_{name}")[:40] or "plant_tag"
    headers = {"Content-Disposition": f'attachment; filename="{safe}.stl"'}
    return Response(content=stl_bytes, media_type="model/stl", headers=headers)


app.include_router(api_router)
app.include_router(protected_router)

# Build CORS allowlist from envs; use safe default if not provided.
_cors_env = os.environ.get("APP_CORS_ORIGINS", "")
_cors_origins = [o.strip() for o in _cors_env.split(",") if o.strip()]
if not _cors_origins:
    # Preview/prod URL is configured in frontend .env; mirror it here.
    _proxy = os.environ.get("EXPO_PACKAGER_PROXY_URL", "")
    if _proxy:
        _cors_origins.append(_proxy.rstrip("/"))
    # Allow Expo dev tooling on localhost
    _cors_origins.extend(["http://localhost:19006", "http://localhost:8081"])

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@app.on_event("startup")
async def _startup():
    try:
        # Drop legacy indexes from earlier schema (plain 'token' field) so the
        # new token_hash schema doesn't collide.
        existing = await db.sessions.index_information()
        for legacy in ("token_1",):
            if legacy in existing:
                await db.sessions.drop_index(legacy)
                logger.info("Dropped legacy index: %s", legacy)
        await db.sessions.create_index("token_hash", unique=True)
        await db.sessions.create_index("expires_at", expireAfterSeconds=0)
        await db.download_tokens.create_index("token_hash", unique=True)
        await db.download_tokens.create_index("expires_at", expireAfterSeconds=0)
    except Exception as e:
        logger.warning("Index init failed: %s", e)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

app.include_router(api_router)
app.include_router(protected_router)

# Build CORS allowlist from envs; use safe default if not provided.
_cors_env = os.environ.get("APP_CORS_ORIGINS", "")
_cors_origins = [o.strip() for o in _cors_env.split(",") if o.strip()]
if not _cors_origins:
    # Preview/prod URL is configured in frontend .env; mirror it here.
    _proxy = os.environ.get("EXPO_PACKAGER_PROXY_URL", "")
    if _proxy:
        _cors_origins.append(_proxy.rstrip("/"))
    # Allow Expo dev tooling on localhost
    _cors_origins.extend(["http://localhost:19006", "http://localhost:8081"])

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)
