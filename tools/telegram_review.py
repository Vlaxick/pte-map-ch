"""Local collection, regional civil warning bulletins, and exception review.

No target extraction, geocoding, track matching, or automatic alert-color changes.
Only Telegram's public web preview is read; no account session is required.
"""

import hashlib
import json
import re
import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.request import Request, urlopen


REGIONS = {
    "Вінницька": ["вінницьк", "вінниччин"],
    "Волинська": ["волинськ", "волинь", "волині"],
    "Дніпропетровська": ["дніпропетровськ", "дніпропетровщин"],
    "Донецька": ["донецьк", "донеччин"],
    "Житомирська": ["житомирськ", "житомирщин"],
    "Закарпатська": ["закарпатськ", "закарпатт"],
    "Запорізька": ["запорізьк", "запоріжж"],
    "Івано-Франківська": ["івано-франківськ", "прикарпатт", "франківщин"],
    "Київська": ["київськ", "київщин"],
    "Кіровоградська": ["кіровоградськ", "кіровоградщин"],
    "Луганська": ["луганськ", "луганщин"],
    "Львівська": ["львівськ", "львівщин"],
    "Миколаївська": ["миколаївськ", "миколаївщин"],
    "Одеська": ["одеськ", "одещин"],
    "Полтавська": ["полтавськ", "полтавщин"],
    "Рівненська": ["рівненськ", "рівненщин"],
    "Сумська": ["сумськ", "сумщин"],
    "Тернопільська": ["тернопільськ", "тернопільщин"],
    "Харківська": ["харківськ", "харківщин"],
    "Херсонська": ["херсонськ", "херсонщин"],
    "Хмельницька": ["хмельницьк", "хмельниччин"],
    "Черкаська": ["черкаськ", "черкащин"],
    "Чернівецька": ["чернівецьк", "буковин"],
    "Чернігівська": ["чернігівськ", "чернігівщин"],
    "АР Крим": ["ар крим", "автономна республіка крим"],
    "Київ": ["місто київ", "м. київ", "у києві"],
    "Севастополь": ["севастополь"],
}
CATEGORIES = {"alert", "clear", "other", "uncertain"}
REVIEW_STATES = {"pending", "approved", "rejected"}
AIR_ALERT = re.compile(r"повітрян(?:а|ої|у)\s+тривог(?:а|и|у)")


def utcnow():
    return datetime.now(timezone.utc).isoformat()


def classify(text):
    """Suggest only explicit regional air-raid warning categories for review."""
    normalized = re.sub(r"\s+", " ", text.lower().replace("–", "-").replace("—", "-"))
    regions = []
    for name, aliases in REGIONS.items():
        found = any(re.search(r"\b" + re.escape(alias) + (r"[а-яіїєґ]*\s+област" if i == 0 and name not in {"Київ", "Севастополь", "АР Крим"} else ""), normalized)
                    for i, alias in enumerate(aliases))
        if found:
            regions.append(name)
    if not AIR_ALERT.search(normalized):
        return "other", regions, "Явного повідомлення про повітряну тривогу немає."
    ambiguous = any(word in normalized for word in ["навчальн", "учбов", "тестов", "вчора", "не оголош", "не було", "не є", "немає", "як діяти", "нагадуємо", "завтра", "завершил", "?"])
    if not regions or ambiguous:
        return "uncertain", regions, "Потрібно уточнити зміст або область."
    clear = bool(re.search(r"\bвідбій\b|\bвідбою\b|скасовано\s+повітрян", normalized))
    # Multiple announcements in one bulletin may refer to different regions.
    announcement = bool(re.search(r"оголошено|оголошена|розпочалася", normalized))
    if clear and announcement:
        return "uncertain", regions, "У дописі поєднано оголошення та відбій."
    return ("clear" if clear else "alert"), regions, "Попередня категорія за явним текстом; потрібна перевірка."


def route_message(text, published_at, received_at):
    """Auto-publish only short, standalone regional civil warning announcements."""
    category, regions, _ = classify(text)
    if category == "other":
        return "archive", "Сторонній допис: збережений без завдання на перевірку."
    try:
        published = datetime.fromisoformat(published_at.replace("Z", "+00:00"))
        received = datetime.fromisoformat(received_at.replace("Z", "+00:00"))
        if published.tzinfo is None or received.tzinfo is None:
            raise ValueError("Missing timezone")
        age = (received - published).total_seconds()
    except (ValueError, TypeError, AttributeError):
        return "review", "Некоректний час публікації; автоматична обробка зупинена."
    if age > 600:
        return "archive", "Допис старший за 10 хвилин на момент отримання; лише історія."
    if age < -60:
        return "review", "Час публікації в майбутньому."
    if category not in {"alert", "clear"} or len(regions) != 1:
        return "review", "Зміст або область потребує уточнення."
    name = regions[0]
    aliases = REGIONS[name]
    scopes = []
    for index, alias in enumerate(aliases):
        suffix = r"[а-яіїєґ]*\s+област[а-яіїєґ]*" if index == 0 and name not in {"Київ", "Севастополь", "АР Крим"} else r"[а-яіїєґ]*"
        scopes.append(re.escape(alias) + suffix)
    scope = "(?:" + "|".join(scopes) + ")"
    announcement = (r"(?:(?:оголошено|оголошена|розпочалася)\s+)?повітрян(?:а|у)\s+тривог(?:а|у)"
                    if category == "alert" else r"відбій\s+повітряної\s+тривоги")
    # Remove decorative punctuation/emojis, but leave all words: quotes, conditional
    # reports, district-only notices, and extra commentary cannot match this grammar.
    clean = re.sub(r"[^а-яіїєґa-z0-9\s'-]", " ", text.lower().replace("–", "-").replace("—", "-"))
    clean = re.sub(r"\s+", " ", clean).strip()
    grammar = rf"(?:{scope}\s+{announcement}|{announcement}\s+(?:(?:у|в|на|для)\s+)?{scope})"
    if len(text) <= 240 and re.fullmatch(grammar, clean):
        return "automatic", "Автоматично: окреме свіже повідомлення про тривогу або відбій для однієї області."
    return "review", "Текст виходить за однозначний шаблон; потрібна перевірка."


class PreviewParser(HTMLParser):
    def __init__(self, username):
        super().__init__(convert_charrefs=True)
        self.username = username
        self.depth = 0
        self.message_depth = None
        self.text_depth = None
        self.current = None
        self.messages = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = attrs.get("class", "").split()
        if self.current and self.text_depth is not None and tag in {"div", "blockquote", "p"}:
            self.current["text_parts"].append("\n")
        if tag == "div":
            self.depth += 1
            post = attrs.get("data-post", "")
            if "tgme_widget_message" in classes and re.fullmatch(re.escape(self.username) + r"/\d+", post):
                self.current = {"id": int(post.rsplit("/", 1)[1]), "text_parts": [], "publishedAt": None, "hasMedia": False}
                self.message_depth = self.depth
            if self.current and "tgme_widget_message_text" in classes:
                self.text_depth = self.depth
        if not self.current:
            return
        if tag == "br" and self.text_depth is not None:
            self.current["text_parts"].append("\n")
        if tag == "time" and attrs.get("datetime"):
            self.current["publishedAt"] = attrs["datetime"]
        if any(c in classes for c in ["tgme_widget_message_photo_wrap", "tgme_widget_message_video_player", "tgme_widget_message_document_wrap", "tgme_widget_message_voice_player"]):
            self.current["hasMedia"] = True

    def handle_endtag(self, tag):
        if self.current and self.text_depth is not None and tag in {"blockquote", "p"}:
            self.current["text_parts"].append("\n")
        if tag != "div":
            return
        if self.text_depth == self.depth:
            self.text_depth = None
        if self.current and self.message_depth == self.depth:
            message = self.current
            text = "".join(message.pop("text_parts")).strip()
            message["text"] = text
            if message["publishedAt"] and (text or message["hasMedia"]):
                self.messages.append(message)
            self.current = None
            self.message_depth = None
        self.depth = max(0, self.depth - 1)

    def handle_data(self, data):
        if self.current and self.text_depth is not None:
            self.current["text_parts"].append(data)


def fetch_preview(username):
    request = Request("https://t.me/s/" + username, headers={"User-Agent": "ObriyPublicReview/0.1"})
    with urlopen(request, timeout=15) as response:
        if response.headers.get_content_type() != "text/html":
            raise ValueError("Telegram повернув не HTML-сторінку.")
        payload = response.read(3_000_001)
    if len(payload) > 3_000_000:
        raise ValueError("Вебперегляд перевищує допустимий розмір.")
    parser = PreviewParser(username)
    parser.feed(payload.decode("utf-8"))
    if not parser.messages:
        raise ValueError("У вебперегляді немає доступних дописів. Перевірте посилання в Telegram.")
    return list({m["id"]: m for m in parser.messages}.values())


class ReviewStore:
    def __init__(self, db_path, config_path):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        config = json.loads(Path(config_path).read_text())
        self.interval = max(60, int(config.get("pollIntervalSeconds", 60)))
        self.sources = [s for s in config["sources"] if s.get("enabled", True)]
        if not self.sources or any(not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{4,31}", s["username"]) for s in self.sources):
            raise ValueError("Некоректний список Telegram каналів.")
        self.lock = threading.Lock()
        self.stop_event = threading.Event()
        self.collector_running = False
        with self.connect() as db:
            db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS messages (
                    channel TEXT, id INTEGER, text TEXT, published_at TEXT, first_seen_at TEXT,
                    last_seen_at TEXT, content_hash TEXT, revision INTEGER, category TEXT,
                    regions TEXT, reason TEXT, review_state TEXT DEFAULT 'pending', note TEXT DEFAULT '',
                    reviewed_at TEXT, has_media INTEGER, PRIMARY KEY(channel,id));
                CREATE TABLE IF NOT EXISTS revisions (
                    channel TEXT, message_id INTEGER, revision INTEGER, text TEXT,
                    published_at TEXT, received_at TEXT, content_hash TEXT,
                    PRIMARY KEY(channel,message_id,revision));
                CREATE TABLE IF NOT EXISTS review_events (
                    id INTEGER PRIMARY KEY, channel TEXT, message_id INTEGER, revision INTEGER,
                    created_at TEXT, state TEXT, category TEXT, regions TEXT, note TEXT);
                CREATE TABLE IF NOT EXISTS source_status (
                    channel TEXT PRIMARY KEY, last_attempt TEXT, last_success TEXT,
                    error TEXT, message_count INTEGER DEFAULT 0);
            """)

            columns = {r["name"] for r in db.execute("PRAGMA table_info(messages)")}
            for column in ["routing", "routing_reason"]:
                if column not in columns:
                    db.execute(f"ALTER TABLE messages ADD COLUMN {column} TEXT")
            for row in db.execute("SELECT * FROM messages WHERE routing IS NULL").fetchall():
                route, reason = route_message(row["text"], row["published_at"], row["first_seen_at"])
                if row["reviewed_at"]:
                    route, reason = ("review" if row["review_state"] == "pending" else "manual"), "Збережене рішення користувача."
                db.execute("UPDATE messages SET routing=?,routing_reason=? WHERE channel=? AND id=?",
                           (route, reason, row["channel"], row["id"]))

    @contextmanager
    def connect(self):
        db = sqlite3.connect(str(self.db_path), timeout=10)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def ingest(self, channel, messages, received_at=None):
        received_at = received_at or utcnow()
        changed = 0
        with self.connect() as db:
            for message in messages:
                digest = hashlib.sha256(json.dumps([message["text"], message["publishedAt"], message["hasMedia"]], ensure_ascii=False).encode()).hexdigest()
                old = db.execute("SELECT * FROM messages WHERE channel=? AND id=?", (channel, message["id"])).fetchone()
                if old and old["content_hash"] == digest:
                    db.execute("UPDATE messages SET last_seen_at=? WHERE channel=? AND id=?", (received_at, channel, message["id"]))
                    continue
                revision = old["revision"] + 1 if old else 1
                category, regions, reason = classify(message["text"])
                values = (channel, message["id"], message["text"], message["publishedAt"], old["first_seen_at"] if old else received_at,
                          received_at, digest, revision, category, json.dumps(regions, ensure_ascii=False), reason, int(message["hasMedia"]))
                db.execute("""INSERT INTO messages(channel,id,text,published_at,first_seen_at,last_seen_at,content_hash,revision,category,regions,reason,has_media)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(channel,id) DO UPDATE SET
                    text=excluded.text,published_at=excluded.published_at,last_seen_at=excluded.last_seen_at,
                    content_hash=excluded.content_hash,revision=excluded.revision,category=excluded.category,
                    regions=excluded.regions,reason=excluded.reason,has_media=excluded.has_media,
                    review_state='pending',reviewed_at=NULL,note=''""", values)
                db.execute("INSERT INTO revisions VALUES(?,?,?,?,?,?,?)", (channel, message["id"], revision,
                           message["text"], message["publishedAt"], received_at, digest))
                route, routing_reason = route_message(message["text"], message["publishedAt"], received_at)
                db.execute("UPDATE messages SET routing=?,routing_reason=? WHERE channel=? AND id=?",
                           (route, routing_reason, channel, message["id"]))
                changed += 1
        return changed

    def poll(self):
        if not self.lock.acquire(blocking=False):
            return False
        try:
            def collect(source):
                username = source["username"]
                attempted = utcnow()
                try:
                    messages = fetch_preview(username)
                    self.ingest(username, messages)
                    with self.connect() as db:
                        db.execute("""INSERT INTO source_status VALUES(?,?,?,?,?) ON CONFLICT(channel) DO UPDATE SET
                            last_attempt=excluded.last_attempt,last_success=excluded.last_success,error=NULL,message_count=excluded.message_count""",
                                   (username, attempted, utcnow(), None, len(messages)))
                except Exception as error:
                    with self.connect() as db:
                        db.execute("""INSERT INTO source_status(channel,last_attempt,error) VALUES(?,?,?)
                            ON CONFLICT(channel) DO UPDATE SET last_attempt=excluded.last_attempt,error=excluded.error""",
                                   (username, attempted, str(error)[:500]))
            with ThreadPoolExecutor(max_workers=2) as executor:
                list(executor.map(collect, self.sources))
            return True
        finally:
            self.lock.release()

    def start(self):
        def worker():
            try:
                while not self.stop_event.is_set():
                    self.poll()
                    self.stop_event.wait(self.interval)
            finally:
                self.collector_running = False
        self.collector_running = True
        threading.Thread(target=worker, daemon=True, name="telegram-review").start()

    def status(self):
        with self.connect() as db:
            statuses = {r["channel"]: dict(r) for r in db.execute("SELECT * FROM source_status")}
            counts = {r["review_state"]: r["total"] for r in db.execute("SELECT review_state,COUNT(*) total FROM messages GROUP BY review_state")}
            routing_counts = {r["routing"]: r["total"] for r in db.execute("SELECT routing,COUNT(*) total FROM messages GROUP BY routing")}
        return {"routingCounts": routing_counts, "sources": [{**s, **statuses.get(s["username"], {}), "url": "https://t.me/" + s["username"]} for s in self.sources],
                "counts": counts, "regions": list(REGIONS), "collecting": self.lock.locked(), "collectorRunning": self.collector_running, "pollIntervalSeconds": self.interval,
                "automation": "Тривога й відбій для однієї області — у зведення автоматично; неясні дописи — на перевірку; інші — в архів. Кольори тривог на карті залишаються даними NEPTUN.",
                "coverage": "Вебперегляд містить лише останні доступні дописи. Історія та видалення можуть бути неповними."}

    @staticmethod
    def serialize(row):
        item = dict(row)
        item["regions"] = json.loads(item["regions"])
        item["url"] = "https://t.me/{}/{}".format(item["channel"], item["id"])
        return item

    def messages(self, state="", source="", query="", routing=""):
        conditions, args = [], []
        for field, value in [("review_state", state), ("channel", source), ("routing", routing)]:
            if value:
                conditions.append(field + "=?")
                args.append(value)
        if query:
            conditions.append("text LIKE ? ESCAPE '\\'")
            args.append("%" + query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%")
        where = " WHERE " + " AND ".join(conditions) if conditions else ""
        with self.connect() as db:
            total = db.execute("SELECT COUNT(*) FROM messages" + where, args).fetchone()[0]
            rows = db.execute("SELECT * FROM messages" + where + " ORDER BY published_at DESC,id DESC LIMIT 150", args).fetchall()
        return {"messages": [self.serialize(r) for r in rows], "total": total}

    def bulletins(self):
        """Recent source announcements, not an inferred current all-clear state."""
        with self.connect() as db:
            rows = db.execute("""SELECT * FROM messages WHERE
                (routing='automatic' AND review_state='pending' OR review_state='approved')
                AND category IN ('alert','clear') AND julianday(published_at) >= julianday('now','-6 hours')
                AND julianday(published_at) <= julianday('now','+1 minute')
                ORDER BY julianday(published_at) DESC,id DESC LIMIT 100""").fetchall()
        items = []
        for row in rows:
            item = self.serialize(row)
            items.append({k: item[k] for k in ["channel", "id", "revision", "category", "regions", "published_at", "url", "routing"]})
        return {"bulletins": items, "status": self.status(), "windowHours": 6,
                "meaning": "Історія повідомлень каналів за 6 годин, не поточний офіційний стан тривоги."}

    def detail(self, channel, message_id):
        with self.connect() as db:
            row = db.execute("SELECT * FROM messages WHERE channel=? AND id=?", (channel, message_id)).fetchone()
            if not row:
                return None
            result = self.serialize(row)
            result["revisions"] = [dict(r) for r in db.execute("SELECT revision,text,published_at,received_at FROM revisions WHERE channel=? AND message_id=? ORDER BY revision DESC", (channel, message_id))]
            result["reviews"] = [dict(r) for r in db.execute("SELECT * FROM review_events WHERE channel=? AND message_id=? ORDER BY id DESC", (channel, message_id))]
            return result

    def review(self, channel, message_id, data):
        state, category = data.get("state"), data.get("category")
        regions = data.get("regions")
        note = data.get("note", "")
        if state not in REVIEW_STATES or category not in CATEGORIES or not isinstance(regions, list) or any(r not in REGIONS for r in regions):
            raise ValueError("Перевірте категорію, області та рішення.")
        if not isinstance(note, str) or len(note) > 3000:
            raise ValueError("Коментар має бути не довшим за 3000 символів.")
        if state == "approved" and (category == "uncertain" or (category in {"alert", "clear"} and not regions)):
            raise ValueError("Для підтвердження уточніть категорію та область.")
        now = utcnow()
        with self.connect() as db:
            cursor = db.execute("""UPDATE messages SET review_state=?,category=?,regions=?,note=?,reviewed_at=?
                WHERE channel=? AND id=? AND revision=?""", (state, category, json.dumps(regions, ensure_ascii=False), note, now, channel, message_id, data.get("revision")))
            if cursor.rowcount != 1:
                raise RuntimeError("Допис змінився. Оновіть його та перевірте нову версію.")
            db.execute("UPDATE messages SET routing=?,routing_reason=? WHERE channel=? AND id=?",
                       ("review" if state == "pending" else "manual", "Рішення користувача.", channel, message_id))
            db.execute("INSERT INTO review_events(channel,message_id,revision,created_at,state,category,regions,note) VALUES(?,?,?,?,?,?,?,?)",
                       (channel, message_id, data["revision"], now, state, category, json.dumps(regions, ensure_ascii=False), note))
