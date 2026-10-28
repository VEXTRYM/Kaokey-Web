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
    library = {"format_version": 1, "active_list": "Faces", "lists": [{"name": "Faces", "main_tags": [], "kaomoji": [{"name": "Smiley", "text": "٩(◕‿◕)۶", "tags": []}]}]}
    payload = {"kind": "list", "title": "Faces", "library": library}
    response = client.post("/api/v1/publications", json=payload, headers={"X-CSRF-Token": csrf})
    assert response.status_code == 201
    assert client.get(f"/api/v1/publications/{response.json()['id']}/export").json() == library
    payload["library"]["format_version"] = 999
    assert client.post("/api/v1/publications", json=payload, headers={"X-CSRF-Token": csrf}).status_code == 422
