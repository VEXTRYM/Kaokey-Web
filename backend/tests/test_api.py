import os
import tempfile
from pathlib import Path

path = Path(tempfile.mktemp(suffix=".sqlite"))
os.environ["DATABASE_URL"] = f"sqlite:///{path}"
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_public_catalog_auth_publication_and_export():
    assert client.get("/api/v1/publications").json() == []
    user = {"username": "tester_kaokey", "password": "strong-password-123"}
    assert client.post("/api/v1/auth/register", json=user).status_code == 201
    assert client.post("/api/v1/auth/register", json=user).status_code == 409
    auth = client.post("/api/v1/auth/login", json=user)
    assert auth.status_code == 200
    csrf = auth.json()["csrf_token"]
    payload = {"kind": "kaomoji", "title": "Wave", "kaomoji": {"name": "Wave", "text": "(^_^)", "tags": ["happy"]}}
    assert client.post("/api/v1/publications", json=payload).status_code == 403
    created = client.post("/api/v1/publications", json=payload, headers={"X-CSRF-Token": csrf})
    assert created.status_code == 201
    pub_id = created.json()["id"]
    assert client.get("/api/v1/publications").json()[0]["author"] == "tester_kaokey"
    exported = client.get(f"/api/v1/publications/{pub_id}/export").json()
    assert exported["format_version"] == 1
    assert exported["lists"][0]["kaomoji"][0]["text"] == "(^_^)"
    assert client.delete(f"/api/v1/publications/{pub_id}", headers={"X-CSRF-Token": csrf}).status_code == 204
    assert client.get("/api/v1/publications").json() == []
    assert client.post("/api/v1/auth/logout", headers={"X-CSRF-Token": csrf}).status_code == 200

def test_import_format_validation():
    user = {"username": "list_author", "password": "strong-password-456"}
    client.post("/api/v1/auth/register", json=user)
    csrf = client.post("/api/v1/auth/login", json=user).json()["csrf_token"]
    # Real Kaokey Desktop exports contain a 'favorite' key for every item.
    library = {"format_version": 1, "active_list": "Faces", "lists": [{"name": "Faces", "main_tags": [], "kaomoji": [{"name": "Smiley", "text": "٩(◕‿◕)۶", "tags": [], "favorite": False}]}]}
    payload = {"kind": "list", "title": "Faces", "library": library}
    response = client.post("/api/v1/publications", json=payload, headers={"X-CSRF-Token": csrf})
    assert response.status_code == 201
    assert client.get(f"/api/v1/publications/{response.json()['id']}/export").json() == library
    payload["library"]["format_version"] = 999
    assert client.post("/api/v1/publications", json=payload, headers={"X-CSRF-Token": csrf}).status_code == 422


def test_publish_local_library_resets_private_favorite_state():
    user = {"username": "favorite_author", "password": "strong-password-789"}
    assert client.post("/api/v1/auth/register", json=user).status_code == 201
    csrf = client.post("/api/v1/auth/login", json=user).json()["csrf_token"]
    library = {
        "format_version": 1,
        "active_list": "Favorites",
        "lists": [{
            "name": "Favorites",
            "main_tags": ["cute"],
            "kaomoji": [
                {"name": "Happy", "text": "(^_^)", "tags": ["cute"], "favorite": True, "favorite_order": 8},
                {"name": "Calm", "text": "(o_o)", "tags": [], "favorite": False},
            ],
        }],
    }
    response = client.post(
        "/api/v1/publications",
        json={"kind": "list", "title": "Favorites", "library": library},
        headers={"X-CSRF-Token": csrf},
    )
    assert response.status_code == 201, response.text
    exported = client.get(f"/api/v1/publications/{response.json()['id']}/export").json()
    assert exported["format_version"] == 1
    items = exported["lists"][0]["kaomoji"]
    assert [item["favorite"] for item in items] == [False, False]
    assert all("favorite_order" not in item for item in items)
    assert [item["text"] for item in items] == ["(^_^)", "(o_o)"]


def test_single_kaomoji_accepts_desktop_favorite_fields():
    user = {"username": "single_author", "password": "strong-password-890"}
    assert client.post("/api/v1/auth/register", json=user).status_code == 201
    csrf = client.post("/api/v1/auth/login", json=user).json()["csrf_token"]
    response = client.post(
        "/api/v1/publications",
        json={"kind": "kaomoji", "title": "Wave", "kaomoji": {
            "name": "Wave", "text": "(^_^)", "tags": [], "favorite": True, "favorite_order": 3,
        }},
        headers={"X-CSRF-Token": csrf},
    )
    assert response.status_code == 201, response.text
    assert response.json()["data"]["favorite"] is False
    assert "favorite_order" not in response.json()["data"]
