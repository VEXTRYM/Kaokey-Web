import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

type Item = { name: string; text: string; tags: string[] };
type KList = { name: string; main_tags: string[]; kaomoji: Item[] };
type Library = { format_version: 1; active_list: string; lists: KList[] };
type Publication = { id: number; kind: "kaomoji" | "list"; title: string; description: string; author: string; data: Item | Library; created_at: string };
type Account = { username: string; csrf_token: string };
const api = "/api/v1";

async function request<T>(path: string, options: RequestInit = {}, csrf?: string): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("Content-Type", "application/json");
  if (csrf) headers.set("X-CSRF-Token", csrf);
  const response = await fetch(api + path, { ...options, credentials: "include", headers });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      if (typeof body.detail === "string") {
        detail = body.detail;
      } else if (Array.isArray(body.detail) && body.detail.length) {
        const first = body.detail[0];
        const location = Array.isArray(first.loc) ? first.loc.join(".") : "данные";
        detail = `Не удалось проверить данные (${body.detail.length} ошибок). ${location}: ${first.msg || "неверное значение"}`;
      }
    } catch { /* use status text */ }
    throw new Error(detail);
  }
  return response.status === 204 ? undefined as T : response.json();
}

function App() {
  const [account, setAccount] = useState<Account | null>(null);
  const [publications, setPublications] = useState<Publication[]>([]);
  const [page, setPage] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const pageSize = 40;
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [text, setText] = useState("");
  const [tags, setTags] = useState("");
  const [file, setFile] = useState<Library | null>(null);
  const [tab, setTab] = useState<"kaomoji" | "list">("kaomoji");
  const [dialog, setDialog] = useState<"auth" | "share" | null>(null);

  async function loadCatalog() {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (kind !== "all") params.set("kind", kind);
    params.set("offset", String(page * pageSize));
    params.set("limit", String(pageSize + 1));
    try {
      const batch = await request<Publication[]>("/publications?" + params);
      setPublications(batch.slice(0, pageSize));
      setHasNext(batch.length > pageSize);
    }
    catch (e) { setError(String(e)); }
  }
  useEffect(() => { request<Account>("/auth/me").then(setAccount).catch(() => {}); }, []);
  useEffect(() => { void loadCatalog(); }, [query, kind, page]);

  async function onAuth(event: React.FormEvent) {
    event.preventDefault(); setError(""); setNotice("");
    try {
      const body = JSON.stringify({ username, password });
      if (mode === "register") {
        await request("/auth/register", { method: "POST", body });
        setNotice("Регистрация завершена, теперь войдите.");
        setMode("login");
      } else {
        setAccount(await request<Account>("/auth/login", { method: "POST", body }));
        setPassword("");
        setDialog(null);
      }
    } catch (e) { setError(String(e)); }
  }

  async function publish(event: React.FormEvent) {
    event.preventDefault();
    if (!account) return;
    setError(""); setNotice("");
    try {
      const payload = tab === "kaomoji"
        ? { kind: "kaomoji", title, description, kaomoji: { name: title, text, tags: tags.split(",").map(s => s.trim()).filter(Boolean) } }
        : { kind: "list", title, description, library: file };
      await request("/publications", { method: "POST", body: JSON.stringify(payload) }, account.csrf_token);
      setTitle(""); setDescription(""); setText(""); setTags(""); setFile(null);
      setNotice("Публикация создана.");
      setDialog(null);
      setKind(tab);
      setPage(0);
      if (page === 0 && kind === tab) await loadCatalog();
    } catch (e) { setError(String(e)); }
  }

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    if (!selected) return;
    setError(""); setFile(null);
    if (selected.size > 1024 * 1024) { setError("Файл должен быть меньше 1 МБ."); return; }
    try {
      const parsed: unknown = JSON.parse(await selected.text());
      if (!parsed || typeof parsed !== "object") throw new Error("Ожидается JSON-объект");
      const value = parsed as Partial<Library>;
      if (value.format_version !== 1 || !Array.isArray(value.lists) || value.lists.length !== 1 ||
          value.active_list !== value.lists[0]?.name) throw new Error("Нужен экспорт одного списка из Kaokey (format_version: 1)");
      setFile(value as Library);
      setTitle(value.lists[0].name);
    } catch (e) { setError("Невозможно импортировать JSON: " + String(e)); }
  }

  async function remove(id: number) {
    if (!account || !window.confirm("Удалить публикацию?")) return;
    try { await request("/publications/" + id, { method: "DELETE" }, account.csrf_token); await loadCatalog(); }
    catch (e) { setError(String(e)); }
  }

  const changeKind = (next: "kaomoji" | "list") => { setKind(next); setPage(0); };
  const showShare = () => {
    if (!account) { setMode("login"); setDialog("auth"); setNotice("Для публикации нужно войти."); }
    else { setTab(kind === "list" ? "list" : "kaomoji"); setDialog("share"); }
  };

  const downloadIcon = <svg width="31" height="31" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2v14m-5-5 5 5 5-5M4 18v4h16v-4"/>
  </svg>;
  const importIcon = <svg width="31" height="31" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="12" height="18" rx="1"/><path d="M6.5 8h5m-5 4h5m-5 4h5M18 8v9m-3-3 3 3 3-3"/>
  </svg>;

  return <div className="app">
    <header className="topbar">
      <a href="/" className="logo" aria-label="Kaokey — главная">Kaokey</a>
      <nav className="main-tabs" aria-label="Категория публикаций">
        <button type="button" aria-pressed={kind === "kaomoji"} className={kind === "kaomoji" ? "tab selected" : "tab"} onClick={() => changeKind("kaomoji")}>Каомоджи</button>
        <button type="button" aria-pressed={kind === "list"} className={kind === "list" ? "tab selected" : "tab"} onClick={() => changeKind("list")}>Списки</button>
      </nav>
      <div className="account-actions">
        {account ? <>
          <span className="username">@{account.username}</span>
          <button type="button" className="outline-btn" onClick={async () => {
            try { await request("/auth/logout", {method:"POST"}, account.csrf_token); setAccount(null); }
            catch (e) { setError(String(e)); }
          }}>Выйти</button>
        </> : <button type="button" className="outline-btn" onClick={() => { setMode("login"); setDialog("auth"); }}>Войти</button>}
        <a className="outline-btn" href="https://github.com/VEXTRYM/Kaokey" rel="noreferrer" target="_blank">App</a>
      </div>
    </header>
    <main className="workspace">
      <div className="toolbar"><button type="button" className="outline-btn share-btn" onClick={showShare}>Поделиться +</button></div>
      {(error || notice) && <div className={error ? "message error" : "message"} role="status">
        <span>{error || notice}</span>
        <button type="button" aria-label="Закрыть" onClick={() => {setError("");setNotice("");}}>×</button>
      </div>}
      <section className="board" aria-label={kind === "kaomoji" ? "Каталог каомоджи" : "Каталог списков"}>
        <div className="tile-grid">
          {publications.map(pub => {
            const list = pub.kind === "list" ? (pub.data as Library).lists[0] : null;
            return <article className={"tile " + (list ? "list-tile" : "kaomoji-tile")} key={pub.id}>
              <div className="tile-preview">
                {list ? <>
                  <div className="list-name">{list.name}</div>
                  <div className="list-size">{list.kaomoji.length} каомоджи</div>
                  <div className="list-samples">{list.kaomoji.slice(0,3).map(x => x.text).join("  ")}</div>
                </> : <span className="kaomoji-text">{(pub.data as Item).text}</span>}
              </div>
              <div className="tile-overlay">
                <div className="tile-operations">
                  <a className="icon-action" href={api + "/publications/" + pub.id + "/export"} download
                    title="Скачать как JSON" aria-label="Скачать как JSON">{downloadIcon}</a>
                  <button className="icon-action" type="button" title="Импортировать в Kaokey (скоро)"
                    aria-label="Импортировать в Kaokey (скоро)"
                    onClick={() => setNotice("Импорт в Kaokey пока не реализован.")}>{importIcon}</button>
                </div>
                <div className="tile-bottom">
                  {account?.username === pub.author
                    ? <button type="button" className="delete-link" title="Удалить публикацию" onClick={() => void remove(pub.id)}>Удалить</button>
                    : <span />}
                  <span className="tile-author">@{pub.author}</span>
                </div>
              </div>
            </article>;
          })}
          {publications.length === 0 && <p className="no-items">Пока ничего нет.</p>}
        </div>
      </section>
      <div className="pagination">
        <button className="outline-btn" type="button" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p-1))}>← Назад</button>
        <span>{page * pageSize + (publications.length ? 1 : 0)}–{page * pageSize + publications.length}</span>
        <button className="outline-btn" type="button" disabled={!hasNext} onClick={() => setPage(p => p+1)}>Далее →</button>
      </div>
    </main>
    {dialog && <div className="modal-backdrop" onMouseDown={e => {if(e.target === e.currentTarget) setDialog(null);}}>
      <section role="dialog" aria-modal="true" aria-label={dialog === "auth" ? "Аккаунт" : "Поделиться"} className="modal">
        <div className="modal-title"><h2>{dialog === "auth" ? "Аккаунт" : "Поделиться"}</h2>
          <button className="close" type="button" onClick={() => setDialog(null)} aria-label="Закрыть">×</button>
        </div>
        {dialog === "auth" ? <>
          <div className="form-tabs">
            <button className={mode === "login" ? "active" : ""} type="button" onClick={() => setMode("login")}>Вход</button>
            <button className={mode === "register" ? "active" : ""} type="button" onClick={() => setMode("register")}>Регистрация</button>
          </div>
          <form className="modal-form" onSubmit={onAuth}>
            <label>Логин<input required minLength={3} maxLength={32} pattern="[A-Za-z0-9_]+" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)}/></label>
            <label>Пароль<input required type="password" minLength={10} maxLength={128}
              autoComplete={mode === "register" ? "new-password" : "current-password"} value={password} onChange={e => setPassword(e.target.value)}/></label>
            <button className="submit" type="submit">{mode === "login" ? "Войти" : "Зарегистрироваться"}</button>
          </form>
        </> : <>
          <div className="form-tabs">
            <button className={tab === "kaomoji" ? "active" : ""} type="button" onClick={() => setTab("kaomoji")}>Каомоджи</button>
            <button className={tab === "list" ? "active" : ""} type="button" onClick={() => setTab("list")}>Список</button>
          </div>
          <form className="modal-form" onSubmit={publish}>
            <label>Название<input required maxLength={100} value={title} onChange={e => setTitle(e.target.value)}/></label>
            <label>Описание<textarea maxLength={1000} value={description} onChange={e => setDescription(e.target.value)}/></label>
            {tab === "kaomoji" ? <>
              <label>Каомоджи<input required maxLength={200} placeholder="(^_^)" value={text} onChange={e => setText(e.target.value)}/></label>
              <label>Теги через запятую<input value={tags} placeholder="Happy, Greetings" onChange={e => setTags(e.target.value)}/></label>
            </> : <label>JSON-файл<input type="file" accept=".json,application/json" onChange={onFile} required={!file}/>
              {file && <small>{file.lists[0].name} · {file.lists[0].kaomoji.length} каомоджи</small>}</label>}
            <button className="submit" type="submit" disabled={tab === "list" && !file}>Опубликовать</button>
          </form>
        </>}
        {error && <p className="modal-error" role="alert">{error}</p>}
        {notice && <p className="modal-notice">{notice}</p>}
      </section>
    </div>}
  </div>;
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
