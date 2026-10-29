"""Kaokey community catalog REST API. No cloud mirror of private desktop libraries."""
import hashlib
import json
import os
import secrets
from contextlib import asynccontextmanager
from pathlib import Path
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError
from fastapi import Cookie, Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String, Text, create_engine, or_, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./kaokey-web.db")
ALLOWED_ORIGINS = [x.strip() for x in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",") if x.strip()]
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)
ph = PasswordHasher()
SESSION_DAYS = 14

class Base(DeclarativeBase):
    pass

class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(Text)

class LoginSession(Base):
    __tablename__ = "login_sessions"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    csrf_token: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

class Publication(Base):
    __tablename__ = "publications"
    id: Mapped[int] = mapped_column(primary_key=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    kind: Mapped[str] = mapped_column(String(16), index=True)
    title: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(String(1000), default="")
    data: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    author: Mapped[User] = relationship()

Base.metadata.create_all(bind=engine)

@asynccontextmanager
async def lifespan(_app: FastAPI):
    if os.getenv("SEED_DEFAULT_CATALOG", "true").lower() in ("true", "1", "yes"):
        with SessionLocal() as db:
            seed_default_catalog(db)
    yield

app = FastAPI(title="Kaokey Community API", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=ALLOWED_ORIGINS, allow_credentials=True, allow_methods=["GET", "POST", "DELETE"], allow_headers=["Content-Type", "X-CSRF-Token"])

class Credentials(BaseModel):
    username: str = Field(min_length=3, max_length=32, pattern=r"^[a-zA-Z0-9_]+$")
    password: str = Field(min_length=10, max_length=128)

class Kaomoji(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(max_length=100)
    text: str = Field(min_length=1, max_length=200)
    tags: list[str] = Field(default_factory=list, max_length=10)
    # Both fields may occur in Kaokey Desktop JSON. They describe local UI
    # state, not public collection metadata, so they are accepted but reset.
    favorite: bool | None = None
    favorite_order: int | None = None

    @field_validator("tags")
    @classmethod
    def check_tags(cls, tags: list[str]):
        if any(len(tag) > 30 for tag in tags):
            raise ValueError("Tags must be at most 30 characters")
        return tags

class KaomojiList(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=100)
    main_tags: list[str] = Field(default_factory=list, max_length=20)
    kaomoji: list[Kaomoji] = Field(max_length=5000)
    @field_validator("main_tags")
    @classmethod
    def check_main_tags(cls, tags: list[str]):
        if any(len(tag) > 30 for tag in tags) or len(set(tags)) != len(tags):
            raise ValueError("Invalid main tags")
        return tags

class ImportLibrary(BaseModel):
    format_version: Literal[1]
    active_list: str
    lists: list[KaomojiList] = Field(min_length=1, max_length=1)

class PublicationCreate(BaseModel):
    kind: Literal["kaomoji", "list"]
    title: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=1000)
    kaomoji: Kaomoji | None = None
    library: ImportLibrary | None = None

    @field_validator("title")
    @classmethod
    def check_title(cls, val: str):
        if not val.strip():
            raise ValueError("Title must not be blank")
        return val.strip()

def portable_kaomoji(item: Kaomoji) -> dict:
    """Produce the same fields as Kaokey Desktop's make_export_list."""
    return {
        "name": item.name,
        "text": item.text,
        "tags": list(item.tags),
        "favorite": False,
    }


def portable_library(library: ImportLibrary) -> dict:
    """Strip local-only favorite state from shared lists."""
    item_list = library.lists[0]
    return {
        "format_version": 1,
        "active_list": item_list.name,
        "lists": [{
            "name": item_list.name,
            "main_tags": list(item_list.main_tags),
            "kaomoji": [portable_kaomoji(item) for item in item_list.kaomoji],
        }],
    }


def seed_default_catalog(db: Session, source_path: Path | None = None) -> dict[str, int]:
    """Seed official examples once per item; never alter community publications.

    The reserved author name is intentionally invalid for regular registration.
    """
    seed_author = "Kaokey-Defaults"
    path = source_path or Path(__file__).parent / "data" / "kaolist.json"
    raw = json.loads(path.read_text(encoding="utf-8"))
    library = portable_library(ImportLibrary.model_validate(raw))
    collection = library["lists"][0]

    author = db.scalar(select(User).where(User.username == seed_author))
    if author is None:
        # The normal /auth/register endpoint disallows '-' in usernames.
        author = User(username=seed_author, password_hash=ph.hash(secrets.token_urlsafe(48)))
        db.add(author)
        db.flush()

    existing = list(db.scalars(select(Publication).where(Publication.author_id == author.id)))
    existing_texts = {p.data.get("text") for p in existing if p.kind == "kaomoji"}
    has_list = any(
        p.kind == "list" and p.data.get("active_list") == collection["name"]
        for p in existing
    )

    added_kaomoji = 0
    for item in collection["kaomoji"]:
        if item["text"] in existing_texts:
            continue
        tag = item["tags"][0] if item["tags"] else "Kaomoji"
        title = item["name"].strip() or f"{tag} · {item['text']}"
        db.add(Publication(
            author_id=author.id,
            kind="kaomoji",
            title=title,
            description="Из стандартного набора Kaokey",
            data=item,
        ))
        existing_texts.add(item["text"])
        added_kaomoji += 1

    # Insert last so the full Default list is easy to find on the first page.
    added_list = 0
    if not has_list:
        db.add(Publication(
            author_id=author.id,
            kind="list",
            title=collection["name"],
            description=f"Стандартный список Kaokey · {len(collection['kaomoji'])} каомоджи",
            data=library,
        ))
        added_list = 1

    db.commit()
    return {"kaomoji": added_kaomoji, "lists": added_list}


class PublicationOut(BaseModel):
    id: int
    kind: str
    title: str
    description: str
    data: dict
    author: str
    created_at: datetime

def db_session():
    with SessionLocal() as db:
        yield db

DB = Annotated[Session, Depends(db_session)]

def token_hash(token: str):
    return hashlib.sha256(token.encode()).hexdigest()

def get_auth(request: Request, db: DB, kaokey_session: str | None = Cookie(default=None)):
    if not kaokey_session:
        raise HTTPException(401, "Login required")
    session = db.scalar(select(LoginSession).where(LoginSession.token_hash == token_hash(kaokey_session)))
    if not session or session.expires_at.replace(tzinfo=timezone.utc) <= datetime.now(timezone.utc):
        raise HTTPException(401, "Session expired")
    user = db.get(User, session.user_id)
    if user is None:
        raise HTTPException(401, "Account unavailable")
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        origin = request.headers.get("origin")
        if origin and origin not in ALLOWED_ORIGINS:
            raise HTTPException(403, "Origin not allowed")
        if request.headers.get("x-csrf-token") != session.csrf_token:
            raise HTTPException(403, "Invalid CSRF token")
    return user, session

AUTH = Annotated[tuple[User, LoginSession], Depends(get_auth)]

def view(pub: Publication) -> PublicationOut:
    return PublicationOut(id=pub.id, kind=pub.kind, title=pub.title, description=pub.description,
                          data=pub.data, author=pub.author.username, created_at=pub.created_at)

@app.get("/api/v1/health")
def health():
    return {"ok": True}

@app.post("/api/v1/auth/register", status_code=201)
def register(body: Credentials, db: DB):
    if db.scalar(select(User).where(User.username == body.username)):
        raise HTTPException(409, "Username already taken")
    user = User(username=body.username, password_hash=ph.hash(body.password))
    db.add(user)
    db.commit()
    return {"id": user.id, "username": user.username}

@app.post("/api/v1/auth/login")
def login(body: Credentials, response: Response, db: DB):
    user = db.scalar(select(User).where(User.username == body.username))
    try:
        if not user:
            ph.verify(ph.hash("invalid-credential-sentinel"), body.password)
            raise HTTPException(401, "Invalid credentials")
        ph.verify(user.password_hash, body.password)
    except (VerifyMismatchError, VerificationError):
        raise HTTPException(401, "Invalid credentials")
    token, csrf = secrets.token_urlsafe(48), secrets.token_urlsafe(32)
    db.add(LoginSession(user_id=user.id, token_hash=token_hash(token), csrf_token=csrf, expires_at=datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)))
    db.commit()
    response.set_cookie("kaokey_session", token, httponly=True, secure=COOKIE_SECURE, samesite="lax", max_age=SESSION_DAYS * 86400, path="/api")
    return {"username": user.username, "csrf_token": csrf}

@app.get("/api/v1/auth/me")
def me(auth: AUTH):
    user, session = auth
    return {"id": user.id, "username": user.username, "csrf_token": session.csrf_token}

@app.post("/api/v1/auth/logout")
def logout(response: Response, auth: AUTH, db: DB):
    _, session = auth
    db.delete(session)
    db.commit()
    response.delete_cookie("kaokey_session", path="/api")
    return {"ok": True}

@app.get("/api/v1/publications", response_model=list[PublicationOut])
def catalog(db: DB, q: str = "", kind: Literal["kaomoji", "list"] | None = None, limit: int = 40, offset: int = 0):
    if not 1 <= limit <= 100 or not 0 <= offset <= 100000:
        raise HTTPException(422, "Invalid pagination")
    stmt = select(Publication)
    if kind:
        stmt = stmt.where(Publication.kind == kind)
    if q:
        term = f"%{q[:100]}%"
        # JSON text search also finds tags and kaomoji text in shared lists.
        stmt = stmt.where(or_(Publication.title.ilike(term), Publication.data.cast(String).ilike(term)))
    return [view(p) for p in db.scalars(stmt.order_by(Publication.id.desc()).offset(offset).limit(limit))]

@app.get("/api/v1/publications/{pub_id}", response_model=PublicationOut)
def publication(pub_id: int, db: DB):
    p = db.get(Publication, pub_id)
    if not p:
        raise HTTPException(404, "Publication not found")
    return view(p)

@app.post("/api/v1/publications", response_model=PublicationOut, status_code=201)
def publish(body: PublicationCreate, auth: AUTH, db: DB):
    user, _ = auth
    if body.kind == "kaomoji":
        if body.kaomoji is None or body.library is not None:
            raise HTTPException(422, "Provide exactly one kaomoji")
        data = portable_kaomoji(body.kaomoji)
    else:
        if body.library is None or body.kaomoji is not None or body.library.active_list != body.library.lists[0].name:
            raise HTTPException(422, "Provide one Kaokey-compatible list")
        data = portable_library(body.library)
    p = Publication(author_id=user.id, kind=body.kind, title=body.title, description=body.description, data=data)
    db.add(p)
    db.commit()
    db.refresh(p)
    return view(p)

@app.delete("/api/v1/publications/{pub_id}", status_code=204)
def delete_publication(pub_id: int, auth: AUTH, db: DB):
    user, _ = auth
    p = db.get(Publication, pub_id)
    if not p:
        raise HTTPException(404, "Publication not found")
    if p.author_id != user.id:
        raise HTTPException(403, "Not your publication")
    db.delete(p)
    db.commit()

@app.get("/api/v1/publications/{pub_id}/export")
def export_publication(pub_id: int, db: DB, response: Response):
    p = db.get(Publication, pub_id)
    if not p:
        raise HTTPException(404, "Publication not found")
    response.headers["Content-Disposition"] = f'attachment; filename="kaokey-{pub_id}.json"'
    # Single kaomoji is wrapped as a one-item list so Kaokey Desktop can import it.
    if p.kind == "list":
        return p.data
    name = "Imported"
    return {"format_version": 1, "active_list": name, "lists": [
        {"name": name, "main_tags": [], "kaomoji": [{**p.data, "favorite": False}]}
    ]}
