"""Serve the map locally and open its HTTP address in the default browser."""

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import webbrowser


ROOT = Path(__file__).resolve().parents[1]


def create_server():
    handler = partial(SimpleHTTPRequestHandler, directory=str(ROOT))
    try:
        return ThreadingHTTPServer(("127.0.0.1", 8000), handler)
    except OSError:
        return ThreadingHTTPServer(("127.0.0.1", 0), handler)


def main():
    server = create_server()
    url = f"http://127.0.0.1:{server.server_port}/"
    print(f"Обрій працює: {url}", flush=True)
    print("Щоб зупинити карту, натисніть Ctrl+C або закрийте це вікно.", flush=True)
    webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
