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

  async function loadCatalog() {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (kind !== "all") params.set("kind", kind);
    try { setPublications(await request<Publication[]>("/publications?" + params)); }
    catch (e) { setError(String(e)); }
  }
  useEffect(() => { request<Account>("/auth/me").then(setAccount).catch(() => {}); }, []);
  useEffect(() => { void loadCatalog(); }, [query, kind]);

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
      await loadCatalog();
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

  return <div className="site">
    <header><div className="brand">✿ <span>Kaokey</span> <small>Community</small></div>
      <nav><a href="#catalog">Каталог</a><a href="#publish">Поделиться</a><a href="https://github.com/VEXTRYM/Kaokey" target="_blank" rel="noreferrer">Приложение ↗</a></nav>
      <div>{account ? <span className="account">@{account.username} <button className="subtle" onClick={async () => { try { await request("/auth/logout", { method: "POST" }, account.csrf_token); setAccount(null); } catch (e) { setError(String(e)); } }}>Выйти</button></span> : <a href="#auth" className="pill">Войти</a>}</div>
    </header>
    <main>
      <section className="hero"><div className="eyebrow">KAOKEY COMMUNITY</div>
        <h1>Поделись настроением <span>(づ｡◕‿‿◕｡)づ</span></h1>
        <p>Публикуй свои каомоджи и списки, находи новые и добавляй их в Kaokey.</p>
        <a className="primary link" href="#catalog">Смотреть каталог ↓</a>
      </section>
      {(error || notice) && <div role="status" className={error ? "alert" : "success"}>{error || notice} <button onClick={() => { setError(""); setNotice(""); }} aria-label="Закрыть">×</button></div>}
      <section id="catalog"><div className="sectionTitle"><div><div className="eyebrow">EXPLORE</div><h2>Каталог сообщества</h2></div><span className="muted">{publications.length} публикаций</span></div>
        <div className="filters"><input aria-label="Поиск" placeholder="Поиск по названию..." value={query} onChange={e => setQuery(e.target.value)}/><select aria-label="Тип публикаций" value={kind} onChange={e => setKind(e.target.value)}><option value="all">Все публикации</option><option value="kaomoji">Каомоджи</option><option value="list">Списки</option></select></div>
        <div className="cards">{publications.length ? publications.map(pub => <article key={pub.id} className="card">
          <div className="cardTop"><span className="kind">{pub.kind === "list" ? "▤ Список" : "✿ Каомоджи"}</span><span className="muted">@{pub.author}</span></div>
          <h3>{pub.title}</h3>
          <div className="preview">{pub.kind === "kaomoji" ? (pub.data as Item).text : (pub.data as Library).lists[0].kaomoji.slice(0, 3).map(x => x.text).join("  ") || "Пустой список"}</div>
          <p>{pub.description || (pub.kind === "list" ? ((pub.data as Library).lists[0].kaomoji.length + " элементов") : "Новый каомоджи")}</p>
          <div className="actions"><a href={api + "/publications/" + pub.id + "/export" } download>↓ Скачать JSON</a>
            {pub.kind === "kaomoji" && <button onClick={() => { navigator.clipboard.writeText((pub.data as Item).text).then(() => setNotice("Скопировано")).catch(() => setError("Не удалось скопировать")); }}>Копировать</button>}
            {account?.username === pub.author && <button className="danger" onClick={() => remove(pub.id)}>Удалить</button>}
          </div>
        </article>) : <div className="empty">Пока нет публикаций. Стань первым! (｡◕‿◕｡)</div>}</div>
      </section>
      <div className="columns">
        <section id="publish" className="panel"><div className="eyebrow">CREATE</div><h2>Поделиться</h2>{account ? <form onSubmit={publish}>
          <div className="tabs"><button type="button" className={tab === "kaomoji" ? "active" : ""} onClick={() => setTab("kaomoji")}>Один каомоджи</button><button type="button" className={tab === "list" ? "active" : ""} onClick={() => setTab("list")}>Целый список</button></div>
          <label>Название<input required maxLength={100} value={title} onChange={e => setTitle(e.target.value)} /></label>
          <label>Описание (необязательно)<textarea maxLength={1000} value={description} onChange={e => setDescription(e.target.value)} /></label>
          {tab === "kaomoji" ? <><label>Каомоджи<input required maxLength={200} value={text} onChange={e => setText(e.target.value)} placeholder="(≧◡≦) ♡" /></label><label>Теги через запятую<input value={tags} onChange={e => setTags(e.target.value)} placeholder="cute, happy" /></label></>
          : <label>JSON-файл списка Kaokey<input type="file" accept=".json,application/json" onChange={onFile} required={!file}/>{file && <span className="muted">Загружен: {file.lists[0].name} ({file.lists[0].kaomoji.length} каомоджи)</span>}</label>}
          <button className="primary" type="submit" disabled={tab === "list" && !file}>Опубликовать →</button>
        </form> : <p className="muted">Для публикации нужно войти или зарегистрироваться. Просмотр и скачивание доступны всем.</p>}</section>
        <section className="panel" id="auth"><div className="eyebrow">ACCOUNT</div><h2>{account ? "Твой профиль" : "Присоединиться"}</h2>{account ? <><p>Ты вошёл как <b>@{account.username}</b>.</p><p className="muted">Твои публикации отмечены в общем каталоге. Здесь нет облачной копии твоей личной библиотеки.</p></> : <form onSubmit={onAuth}>
          <div className="tabs"><button type="button" className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>Вход</button><button type="button" className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>Регистрация</button></div>
          <label>Логин<input required minLength={3} maxLength={32} pattern="[A-Za-z0-9_]+" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)}/></label>
          <label>Пароль<input required type="password" minLength={10} maxLength={128} autoComplete={mode === "register" ? "new-password" : "current-password"} value={password} onChange={e => setPassword(e.target.value)}/></label>
          <button className="primary" type="submit">{mode === "login" ? "Войти" : "Создать аккаунт"} →</button>
        </form>}</section>
      </div>
    </main><footer><span>Kaokey Community · Сделано для обмена каомоджи ♡</span><a href="https://github.com/VEXTRYM/Kaokey-Web">GitHub ↗</a></footer>
  </div>;
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
