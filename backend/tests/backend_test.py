"""BotanIQ backend tests - covers Plants CRUD, Readings, AI vision, Summary."""
import base64
import io
import time
import pytest
from PIL import Image, ImageDraw

CREATED_PLANT_IDS = []


def _make_image_b64(text="PLANT", color=(34, 139, 34), size=(512, 512)) -> str:
    """Create a realistic JPEG with features (colors, shapes, text) for vision tests."""
    img = Image.new("RGB", size, color)
    draw = ImageDraw.Draw(img)
    # Add features: leaf-like shapes / meter dial
    draw.ellipse((80, 80, 432, 432), fill=(20, 100, 20), outline=(0, 0, 0), width=4)
    draw.rectangle((200, 220, 312, 350), fill=(80, 50, 20))
    for i, c in enumerate([(255, 0, 0), (255, 255, 0), (0, 255, 0)]):
        draw.rectangle((40 + i * 80, 40, 80 + i * 80, 80), fill=c)
    draw.text((180, 240), text, fill=(255, 255, 255))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return base64.b64encode(buf.getvalue()).decode()


# ===== Health / Root =====
class TestRoot:
    def test_root(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/")
        assert r.status_code == 200
        assert "message" in r.json()


# ===== Plants CRUD =====
class TestPlants:
    def test_list_initial(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/plants")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_plant_autogen_qr(self, api_client, base_url):
        payload = {"name": "TEST_Monstera", "species": "Monstera deliciosa", "location": "Window"}
        r = api_client.post(f"{base_url}/api/plants", json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["id"]
        assert data["qr_code"].startswith("BIQ-")
        assert data["name"] == "TEST_Monstera"
        assert "_id" not in data
        CREATED_PLANT_IDS.append(data["id"])

    def test_get_plant(self, api_client, base_url):
        pid = CREATED_PLANT_IDS[0]
        r = api_client.get(f"{base_url}/api/plants/{pid}")
        assert r.status_code == 200
        assert r.json()["id"] == pid
        assert "_id" not in r.json()

    def test_get_plant_by_qr(self, api_client, base_url):
        pid = CREATED_PLANT_IDS[0]
        plant = api_client.get(f"{base_url}/api/plants/{pid}").json()
        qr = plant["qr_code"]
        r = api_client.get(f"{base_url}/api/plants/qr/{qr}")
        assert r.status_code == 200
        assert r.json()["id"] == pid

    def test_get_plant_by_qr_404(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/plants/qr/NOPE-XXXX")
        assert r.status_code == 404

    def test_patch_plant(self, api_client, base_url):
        pid = CREATED_PLANT_IDS[0]
        r = api_client.patch(f"{base_url}/api/plants/{pid}", json={"location": "Balcony"})
        assert r.status_code == 200
        assert r.json()["location"] == "Balcony"
        # verify GET
        r2 = api_client.get(f"{base_url}/api/plants/{pid}")
        assert r2.json()["location"] == "Balcony"

    def test_get_plant_404(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/plants/does-not-exist")
        assert r.status_code == 404


# ===== Readings =====
class TestReadings:
    def test_create_reading_thirsty(self, api_client, base_url):
        pid = CREATED_PLANT_IDS[0]
        r = api_client.post(f"{base_url}/api/readings", json={
            "plant_id": pid, "moisture": 20, "fertility": 50, "ph": 6.5
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["plant_id"] == pid
        assert "_id" not in body
        # plant status should become thirsty
        plant = api_client.get(f"{base_url}/api/plants/{pid}").json()
        assert plant["status"] == "thirsty"
        assert "Moisture" in (plant.get("latest_summary") or "")

    def test_create_reading_needs_fert(self, api_client, base_url):
        pid = CREATED_PLANT_IDS[0]
        r = api_client.post(f"{base_url}/api/readings", json={
            "plant_id": pid, "moisture": 60, "fertility": 10
        })
        assert r.status_code == 200
        plant = api_client.get(f"{base_url}/api/plants/{pid}").json()
        assert plant["status"] == "needs_fertilizer"

    def test_list_readings(self, api_client, base_url):
        pid = CREATED_PLANT_IDS[0]
        r = api_client.get(f"{base_url}/api/plants/{pid}/readings")
        assert r.status_code == 200
        readings = r.json()
        assert len(readings) >= 2
        for x in readings:
            assert "_id" not in x

    def test_reading_for_missing_plant(self, api_client, base_url):
        r = api_client.post(f"{base_url}/api/readings", json={"plant_id": "missing", "moisture": 50})
        assert r.status_code == 404


# ===== Summary =====
class TestSummary:
    def test_summary(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/summary")
        assert r.status_code == 200
        d = r.json()
        for k in ("total", "needs_water", "needs_fertilizer", "issues", "healthy"):
            assert k in d


# ===== AI Vision (Gemini 3 Flash) =====
class TestAIVision:
    def test_analyze_meter(self, api_client, base_url):
        img = _make_image_b64(text="METER", color=(50, 50, 50))
        r = api_client.post(f"{base_url}/api/analyze/meter",
                            json={"image_base64": img}, timeout=90)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("moisture", "fertility", "ph", "light"):
            assert k in d

    def test_analyze_health_with_plant(self, api_client, base_url):
        img = _make_image_b64(text="LEAF", color=(34, 139, 34))
        pid = CREATED_PLANT_IDS[0]
        r = api_client.post(f"{base_url}/api/analyze/health",
                            json={"image_base64": img, "plant_id": pid}, timeout=90)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] in ("healthy", "thirsty", "needs_fertilizer", "issue")
        assert "needs_water" in d
        assert "needs_fertilizer" in d
        assert isinstance(d["issues"], list)
        assert "_id" not in d
        # analyses list
        time.sleep(1)
        r2 = api_client.get(f"{base_url}/api/plants/{pid}/analyses")
        assert r2.status_code == 200
        assert len(r2.json()) >= 1


# ===== Delete (cleanup) =====
class TestDelete:
    def test_delete_plant(self, api_client, base_url):
        pid = CREATED_PLANT_IDS[0]
        r = api_client.delete(f"{base_url}/api/plants/{pid}")
        assert r.status_code == 200
        # verify 404 after delete
        r2 = api_client.get(f"{base_url}/api/plants/{pid}")
        assert r2.status_code == 404
        # readings should be empty
        r3 = api_client.get(f"{base_url}/api/plants/{pid}/readings")
        assert r3.status_code == 200
        assert r3.json() == []

    def test_delete_404(self, api_client, base_url):
        r = api_client.delete(f"{base_url}/api/plants/does-not-exist")
        assert r.status_code == 404


@pytest.fixture(scope="session", autouse=True)
def cleanup_at_end(base_url):
    yield
    import requests
    # cleanup any TEST_ plants
    try:
        r = requests.get(f"{base_url}/api/plants", timeout=10)
        for p in r.json():
            if p.get("name", "").startswith("TEST_"):
                requests.delete(f"{base_url}/api/plants/{p['id']}", timeout=10)
    except Exception:
        pass
