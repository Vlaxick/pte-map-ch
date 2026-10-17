"""Serve the local map and a private, manual Telegram review journal."""

import argparse
import json
import secrets
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

from telegram_review import ReviewStore

ROOT = Path(__file__).resolve().parents[1]


class ReviewHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def valid_host(self):
        port = self.server.server_port
        return self.headers.get('Host') in {f'127.0.0.1:{port}', f'localhost:{port}'}

    def json_response(self, data, status=200):
        payload = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def static_allowed(self):
        path = unquote(urlsplit(self.path).path)
        if any(part.startswith('.') for part in path.split('/') if part):
            return False
        relative = path.lstrip('/')
        if relative in {'', 'index.html', 'script.js', 'styles.css', 'review.html', 'review.js', 'review.css'}:
            return True
        return any(relative.startswith(prefix) for prefix in ['assets/', 'data/', 'vendor/']) and not (ROOT / relative).is_dir()

    def do_GET(self):
        if not self.valid_host():
            return self.json_response({'error': 'Host is not allowed.'}, 403)
        path = urlsplit(self.path).path
        store = self.server.review_store
        if path == '/api/review/status':
            return self.json_response({**store.status(), 'csrfToken': self.server.review_token})
        if path == '/api/review/messages':
            query = parse_qs(urlsplit(self.path).query)
            return self.json_response(store.messages(query.get('state', [''])[0], query.get('source', [''])[0], query.get('q', [''])[0][:200]))
        parts = path.strip('/').split('/')
        if len(parts) == 5 and parts[:3] == ['api', 'review', 'messages'] and parts[4].isdigit():
            item = store.detail(parts[3], int(parts[4]))
            return self.json_response(item if item else {'error': 'Допис не знайдений.'}, 200 if item else 404)
        if not self.static_allowed():
            return self.send_error(404)
        super().do_GET()

    def do_HEAD(self):
        if not self.valid_host() or not self.static_allowed():
            return self.send_error(404)
        super().do_HEAD()

    def do_POST(self):
        host = self.headers.get('Host', '')
        origin = self.headers.get('Origin')
        token = self.headers.get('X-Review-Token', '')
        if not self.valid_host() or (origin and origin != 'http://' + host) or not secrets.compare_digest(token, self.server.review_token):
            return self.json_response({'error': 'Запит має надійти зі сторінки журналу.'}, 403)
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 <= length <= 16384:
                return self.json_response({'error': 'Запит завеликий.'}, 413)
            data = json.loads(self.rfile.read(length) or b'{}')
            if not isinstance(data, dict):
                raise ValueError('Очікується JSON-об’єкт.')
            path = urlsplit(self.path).path
            if path == '/api/review/refresh':
                threading.Thread(target=self.server.review_store.poll, daemon=True).start()
                return self.json_response({'accepted': True}, 202)
            parts = path.strip('/').split('/')
            if len(parts) == 5 and parts[:3] == ['api', 'review', 'messages'] and parts[4].isdigit():
                self.server.review_store.review(parts[3], int(parts[4]), data)
                return self.json_response({'saved': True})
            return self.json_response({'error': 'Шлях не знайдений.'}, 404)
        except (ValueError, TypeError) as error:
            return self.json_response({'error': str(error)}, 400)
        except RuntimeError as error:
            return self.json_response({'error': str(error)}, 409)


def create_server(port=8000, db_path=None):
    store = ReviewStore(db_path or ROOT / '.local/telegram-review.sqlite3', ROOT / 'data/telegram-sources.json')
    try:
        server = ThreadingHTTPServer(('127.0.0.1', port), ReviewHandler)
    except OSError:
        server = ThreadingHTTPServer(('127.0.0.1', 0), ReviewHandler)
    server.review_store = store
    server.review_token = secrets.token_urlsafe(32)
    return server


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--no-open', action='store_true')
    parser.add_argument('--no-collector', action='store_true')
    args = parser.parse_args()
    server = create_server(args.port)
    url = f'http://127.0.0.1:{server.server_port}/'
    print(f'Обрій працює: {url}', flush=True)
    print(f'Журнал повідомлень: {url}review.html', flush=True)
    print('Щоб зупинити карту, натисніть Ctrl+C або закрийте це вікно.', flush=True)
    if not args.no_collector:
        server.review_store.start()
    if not args.no_open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.review_store.stop_event.set()
        server.server_close()


if __name__ == '__main__':
    main()
