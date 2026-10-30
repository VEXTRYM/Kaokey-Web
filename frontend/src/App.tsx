import React, { useEffect, useRef, useState } from "react";

type Kind = "kaomoji" | "list";
type Theme = "light" | "dark";
type View = "all" | "mine";
type Dialog = "auth" | "share" | "profile" | null;
type Kaomoji = { name: string; text: string; tags: string[]; favorite?: boolean };
type ListData = { name: string; main_tags: string[]; kaomoji: Kaomoji[] };
type Library = { format_version: 1; active_list: string; lists: ListData[] };
type Publication = {
  id: number; kind: Kind; title: string; description: string;
  data: Kaomoji | Library; author: string; created_at: string;
};
type Account = { id?: number; username: string; csrf_token: string };
type IconName = "download" | "import" | "sun" | "moon" | "user" | "chevron" | "search" |
  "plus" | "close" | "logout" | "grid" | "external" | "trash" | "check";

const API = "/api/v1";
const PAGE_SIZE = 40;
const RELEASES_URL = "https://github.com/VEXTRYM/Kaokey/releases";

function Icon({ name, size = 19 }: { name: IconName; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const, "aria-hidden": true as const };
  const glyph: Record<IconName, React.ReactNode> = {
    download: <><path d="M12 3v12m-4-4 4 4 4-4M5 17v3h14v-3" /></>,
    import: <><path d="M3 5h10v14H3zM7 12h13m-4-4 4 4-4 4" /></>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>,
    moon: <path d="M20.5 14.5A8.4 8.4 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z"/>,
    user: <><circle cx="12" cy="8" r="4"/><path d="M4.5 20c.6-4.3 3-6 7.5-6s6.9 1.7 7.5 6"/></>,
    chevron: <path d="m6 9 6 6 6-6"/>,
    search: <><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    close: <path d="M5 5l14 14M19 5 5 19"/>,
    logout: <><path d="M9 4H4v16h5m5-4 4-4-4-4m4 4H9"/></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    external: <><path d="M14 4h6v6m-1-5-9 9"/><path d="M20 14v6H4V4h6"/></>,
    trash: <><path d="M4 7h16m-10-3h4m-8 3 1 14h10l1-14M10 11v6m4-6v6"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
  };
  return <svg {...common}>{glyph[name]}</svg>;
}

async function request<T>(path: string, init: RequestInit = {}, csrf?: string): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (csrf) headers.set("X-CSRF-Token", csrf);
  const response = await fetch(API + path, { ...init, credentials: "include", headers });
  if (!response.ok) {
    let detail = "Запрос не выполнен";
    try {
      const data = await response.json();
      if (typeof data.detail === "string") detail = data.detail;
      else if (Array.isArray(data.detail) && data.detail.length) {
        const first = data.detail[0];
        detail = String(first.loc?.join(".") || "Данные") + ": " + String(first.msg || "неверное значение");
      }
    } catch { /* Non-JSON error response */ }
    throw new Error(detail);
  }
  return response.status === 204 ? undefined as T : response.json();
}

function initialTheme(): Theme {
  try {
    const saved = window.localStorage.getItem("kaokey-theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch { /* Private browsing or blocked storage */ }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function App() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [account, setAccount] = useState<Account | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [kind, setKind] = useState<Kind>("kaomoji");
  const [view, setView] = useState<View>("all");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [items, setItems] = useState<Publication[]>([]);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);

  const [dialog, setDialog] = useState<Dialog>(null);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [shareKind, setShareKind] = useState<Kind>("kaomoji");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [text, setText] = useState("");
  const [tags, setTags] = useState("");
  const [library, setLibrary] = useState<Library | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { window.localStorage.setItem("kaokey-theme", theme); } catch { /* Storage unavailable */ }
  }, [theme]);

  useEffect(() => {
    request<Account>("/auth/me").then(setAccount).catch(() => {});
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => setQuery(search.trim()), 250);
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      const params = new URLSearchParams({
        kind,
        offset: String(page * PAGE_SIZE),
        limit: String(PAGE_SIZE + 1),
      });
      if (query) params.set("q", query);
      if (view === "mine" && account) params.set("author", account.username);
      try {
        const result = await request<Publication[]>("/publications?" + params.toString());
        if (!active) return;
        setItems(result.slice(0, PAGE_SIZE));
        setHasNext(result.length > PAGE_SIZE);
        setError("");
      } catch (err) {
        if (!active) return;
        setItems([]);
        setHasNext(false);
        setError(String(err));
      } finally { if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; };
  }, [kind, page, query, view, account?.username, revision]);

  useEffect(() => {
    if (!menuOpen && !dialog) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setMenuOpen(false); setDialog(null); }
    };
    const onPointer = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [menuOpen, dialog]);

  function showDialog(next: Dialog) {
    setMenuOpen(false);
    setError("");
    setMessage("");
    setDialog(next);
  }

  function switchKind(next: Kind) {
    setKind(next);
    setPage(0);
  }

  function switchView(next: View) {
    setView(next);
    setPage(0);
    setMenuOpen(false);
  }

  async function handleAuth(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const body = JSON.stringify({ username, password });
      if (authMode === "register") {
        await request("/auth/register", { method: "POST", body });
        setAuthMode("login");
        setPassword("");
        setMessage("Аккаунт создан. Теперь войди.");
      } else {
        const current = await request<Account>("/auth/login", { method: "POST", body });
        setAccount(current);
        setPassword("");
        setView("all");
        showDialog(null);
      }
    } catch (err) { setError(String(err)); }
  }

  async function logout() {
    if (!account) return;
    try {
      await request("/auth/logout", { method: "POST" }, account.csrf_token);
      setAccount(null);
      setView("all");
      setMenuOpen(false);
      setPage(0);
    } catch (err) { setError(String(err)); }
  }

  function openShare() {
    if (!account) {
      setAuthMode("login");
      showDialog("auth");
      setMessage("Для публикации сначала войди в аккаунт.");
      return;
    }
    setShareKind(kind);
    showDialog("share");
  }

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    setLibrary(null);
    if (!selected) return;
    if (selected.size > 1024 * 1024) { setError("Файл не должен превышать 1 МБ."); return; }
    try {
      const data: unknown = JSON.parse(await selected.text());
      if (!data || typeof data !== "object") throw new Error("Ожидается JSON-объект");
      const next = data as Partial<Library>;
      if (next.format_version !== 1 || !Array.isArray(next.lists) ||
          next.lists.length !== 1 || next.active_list !== next.lists[0]?.name) {
        throw new Error("Нужен экспорт одного списка Kaokey (format_version: 1)");
      }
      setLibrary(next as Library);
      setTitle(next.lists[0].name);
      setError("");
    } catch (err) { setError(String(err)); }
  }

  async function publish(event: React.FormEvent) {
    event.preventDefault();
    if (!account || (shareKind === "list" && !library)) return;
    const payload = shareKind === "kaomoji"
      ? { kind: "kaomoji", title, description, kaomoji: {
        name: title, text, tags: tags.split(",").map(x => x.trim()).filter(Boolean),
      } }
      : { kind: "list", title, description, library };
    try {
      await request("/publications", { method: "POST", body: JSON.stringify(payload) }, account.csrf_token);
      setTitle(""); setDescription(""); setText(""); setTags(""); setLibrary(null);
      setKind(shareKind); setView("all"); setPage(0);
      setRevision(n => n + 1);
      showDialog(null);
      setMessage("Публикация добавлена.");
    } catch (err) { setError(String(err)); }
  }

  async function removePublication(id: number) {
    if (!account || !window.confirm("Удалить свою публикацию?")) return;
    try {
      await request("/publications/" + id, { method: "DELETE" }, account.csrf_token);
      setRevision(n => n + 1);
      setMessage("Публикация удалена.");
    } catch (err) { setError(String(err)); }
  }

  function renderCard(pub: Publication) {
    const list = pub.kind === "list" ? (pub.data as Library).lists[0] : null;
    return <article className={"tile " + (list ? "tile-list" : "tile-face")} key={pub.id}>
      <div className="tile-content">
        {list ? <>
          <span className="tile-list-name">{list.name}</span>
          <span className="tile-list-count">{list.kaomoji.length} каомоджи</span>
          <span className="tile-list-preview">{list.kaomoji.slice(0, 3).map(x => x.text).join("  ")}</span>
        </> : <span className="face">{(pub.data as Kaomoji).text}</span>}
      </div>
      <div className="tile-overlay">
        <span className="tile-author">{"@" + pub.author}</span>
        <div className="tile-commands">
          <a href={API + "/publications/" + pub.id + "/export"} download className="tile-icon"
            title="Скачать как JSON" aria-label="Скачать как JSON"><Icon name="download" size={18}/></a>
          {account?.username === pub.author && <button type="button" className="tile-delete"
            title="Удалить публикацию" aria-label="Удалить свою публикацию"
            onClick={() => void removePublication(pub.id)}><Icon name="trash" size={16}/></button>}
          <button type="button" className="tile-icon"
            title="Импортировать в Kaokey (скоро)" aria-label="Импортировать в Kaokey (скоро)"
            onClick={() => setMessage("Импорт в Kaokey появится в следующем обновлении.")}>
            <Icon name="import" size={18}/>
          </button>
        </div>
      </div>
    </article>;
  }

  return <div className="app">
    <header className="topbar">
      <div className="topbar-inner">
        <a className="logo" href="/" aria-label="Kaokey — главная">kaokey<span>.</span></a>
        <nav className="nav-tabs" aria-label="Разделы">
          <button type="button" className={kind === "kaomoji" ? "nav-tab active" : "nav-tab"}
            aria-pressed={kind === "kaomoji"} onClick={() => switchKind("kaomoji")}>Каомоджи</button>
          <button type="button" className={kind === "list" ? "nav-tab active" : "nav-tab"}
            aria-pressed={kind === "list"} onClick={() => switchKind("list")}>Списки</button>
        </nav>
        <div className="header-actions">
          <a className="download-app" href={RELEASES_URL} target="_blank" rel="noreferrer" title="Скачать Kaokey">
            <Icon name="download" size={18}/><span>Скачать Kaokey</span>
          </a>
          <span className="header-divider" aria-hidden="true"/>
          <button className="theme-toggle" type="button" aria-label={theme === "light" ? "Включить тёмную тему" : "Включить светлую тему"}
            title={theme === "light" ? "Тёмная тема" : "Светлая тема"}
            onClick={() => setTheme(t => t === "light" ? "dark" : "light")}>
            <Icon name={theme === "light" ? "moon" : "sun"} size={20}/>
          </button>
          <span className="header-divider" aria-hidden="true"/>
          {account ? <div className="account-menu" ref={menuRef}>
            <button type="button" className={"account-trigger" + (menuOpen ? " open" : "")} aria-expanded={menuOpen}
              aria-haspopup="menu" onClick={() => setMenuOpen(value => !value)}>
              <span className="account-avatar"><Icon name="user" size={17}/></span>
              <span className="account-handle">{"@" + account.username}</span>
              <Icon name="chevron" size={15}/>
            </button>
            {menuOpen && <div className="menu-panel" role="menu">
              <div className="menu-heading"><span className="menu-avatar"><Icon name="user" size={20}/></span>
                <div><strong>{"@" + account.username}</strong><small>Аккаунт Kaokey</small></div>
              </div>
              <button role="menuitem" type="button" onClick={() => showDialog("profile")}><Icon name="user" size={17}/>Мой профиль</button>
              <button role="menuitem" type="button" onClick={() => switchView("mine")}><Icon name="grid" size={17}/>Мои публикации</button>
              {view === "mine" && <button role="menuitem" type="button" onClick={() => switchView("all")}><Icon name="external" size={17}/>Общий каталог</button>}
              <div className="menu-rule"/>
              <button role="menuitem" type="button" onClick={() => void logout()}><Icon name="logout" size={17}/>Выйти</button>
            </div>}
          </div> : <button type="button" className="sign-in" onClick={() => {
            setAuthMode("login"); showDialog("auth");
          }}><Icon name="user" size={19}/><span>Войти</span></button>}
        </div>
      </div>
    </header>

    <main className="main">
      <div className="toolbar">
        <div className="toolbar-leading">
          <h1>{view === "mine" ? "Мои публикации" : kind === "kaomoji" ? "Каомоджи" : "Списки"}</h1>
          {view === "mine" && <button type="button" className="back-to-all" onClick={() => switchView("all")}>К общему каталогу</button>}
        </div>
        <div className="toolbar-actions">
          <label className="search-field">
            <Icon name="search" size={18}/>
            <input type="search" placeholder="Поиск по каталогу..." aria-label="Поиск по каталогу"
              value={search} onChange={event => { setSearch(event.target.value); setPage(0); }}/>
          </label>
          <button type="button" className="share-button" onClick={openShare}><Icon name="plus" size={17}/>Поделиться</button>
        </div>
      </div>

      {(message || error) && <div className={"notice" + (error ? " notice-error" : "")} role="status">
        <span>{error || message}</span>
        <button type="button" aria-label="Закрыть уведомление" onClick={() => {setError("");setMessage("");}}>
          <Icon name="close" size={16}/>
        </button>
      </div>}

      <section className="catalog" aria-label={kind === "kaomoji" ? "Каталог каомоджи" : "Каталог списков"}>
        {loading ? <div className="empty">Загрузка...</div> :
          items.length ? <div className="tiles">{items.map(renderCard)}</div> :
          <div className="empty">{view === "mine" ? "Пока нет своих публикаций." : "Ничего не найдено."}</div>}
      </section>

      <div className="pagination">
        <button type="button" className="page-button" disabled={!page || loading} onClick={() => setPage(p => Math.max(0, p - 1))}>← Назад</button>
        <span>{page * PAGE_SIZE + (items.length ? 1 : 0)}–{page * PAGE_SIZE + items.length}</span>
        <button type="button" className="page-button" disabled={!hasNext || loading} onClick={() => setPage(p => p + 1)}>Далее →</button>
      </div>
    </main>

    {dialog && <div className="modal-backdrop" onMouseDown={event => {
      if (event.target === event.currentTarget) showDialog(null);
    }}>
      <section role="dialog" aria-modal="true" aria-label={dialog === "share" ? "Поделиться" : dialog === "auth" ? "Авторизация" : "Мой профиль"} className="modal">
        <div className="modal-title"><h2>{dialog === "share" ? "Поделиться" : dialog === "auth" ? "Аккаунт" : "Мой профиль"}</h2>
          <button type="button" className="close-button" aria-label="Закрыть" onClick={() => showDialog(null)}><Icon name="close" size={20}/></button>
        </div>
        {dialog === "profile" && account && <div className="profile-preview">
          <span className="profile-avatar"><Icon name="user" size={29}/></span>
          <strong>{"@" + account.username}</strong>
          <p>Твои опубликованные каомоджи и списки доступны через раздел «Мои публикации».</p>
          <button type="button" className="submit-button" onClick={() => { switchView("mine"); showDialog(null); }}>Перейти к публикациям</button>
        </div>}
        {dialog === "auth" && <>
          <div className="form-tabs">
            <button type="button" className={authMode === "login" ? "active" : ""} onClick={() => setAuthMode("login")}>Вход</button>
            <button type="button" className={authMode === "register" ? "active" : ""} onClick={() => setAuthMode("register")}>Регистрация</button>
          </div>
          <form className="modal-form" onSubmit={handleAuth}>
            <label>Логин<input required minLength={3} maxLength={32} pattern="[A-Za-z0-9_]+" autoComplete="username"
              value={username} onChange={e => setUsername(e.target.value)}/></label>
            <label>Пароль<input required minLength={10} maxLength={128} type="password"
              autoComplete={authMode === "login" ? "current-password" : "new-password"}
              value={password} onChange={e => setPassword(e.target.value)}/></label>
            <button type="submit" className="submit-button">{authMode === "login" ? "Войти" : "Зарегистрироваться"}</button>
          </form>
        </>}
        {dialog === "share" && <>
          <div className="form-tabs">
            <button type="button" className={shareKind === "kaomoji" ? "active" : ""} onClick={() => setShareKind("kaomoji")}>Каомоджи</button>
            <button type="button" className={shareKind === "list" ? "active" : ""} onClick={() => setShareKind("list")}>Список</button>
          </div>
          <form className="modal-form" onSubmit={publish}>
            <label>Название<input required maxLength={100} value={title} onChange={e => setTitle(e.target.value)}/></label>
            <label>Описание<textarea maxLength={1000} value={description} onChange={e => setDescription(e.target.value)}/></label>
            {shareKind === "kaomoji" ? <>
              <label>Каомоджи<input required maxLength={200} value={text} placeholder="(≧◡≦)" onChange={e => setText(e.target.value)}/></label>
              <label>Теги через запятую<input value={tags} placeholder="Happy, Greetings" onChange={e => setTags(e.target.value)}/></label>
            </> : <label>JSON-файл<input type="file" accept=".json,application/json" required={!library} onChange={handleFile}/>
              {library && <small>{library.lists[0].name + " · " + library.lists[0].kaomoji.length + " каомоджи"}</small>}
            </label>}
            <button type="submit" className="submit-button" disabled={shareKind === "list" && !library}>Опубликовать</button>
          </form>
        </>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {message && <p className="form-note">{message}</p>}
      </section>
    </div>}
  </div>;
}

export default App;
