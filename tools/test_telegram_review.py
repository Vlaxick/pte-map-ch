"""Run with: python3 -m unittest discover -s tools -p 'test_*.py'."""

import json
import tempfile
import threading
import unittest
from unittest.mock import patch
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from serve_map import create_server
from telegram_review import PreviewParser, ReviewStore, classify


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        config = Path(self.temp.name) / 'sources.json'
        config.write_text(json.dumps({'sources': [{'username': 'example_feed', 'name': 'Example'}]}))
        self.store = ReviewStore(Path(self.temp.name) / 'review.sqlite3', config)
        self.message = {'id': 10, 'text': 'Львівська область: оголошено повітряну тривогу.',
                        'publishedAt': '2026-10-17T10:00:00+00:00', 'hasMedia': False}

    def test_parser_preserves_text_and_ignores_reply(self):
        parser = PreviewParser('example_feed')
        parser.feed('''<div class="tgme_widget_message" data-post="example_feed/10">
          <div class="tgme_widget_message_reply"><div>Чужа цитата</div></div>
          <div class="tgme_widget_message_text js-message_text">Львівська область<br><b>Повітряна тривога</b> &amp; текст</div>
          <a><time datetime="2026-10-17T10:00:00+00:00">10:00</time></a></div>''')
        self.assertEqual(len(parser.messages), 1)
        self.assertEqual(parser.messages[0]['text'], 'Львівська область\nПовітряна тривога & текст')

    def test_conservative_categories(self):
        self.assertEqual(classify(self.message['text'])[:2], ('alert', ['Львівська']))
        self.assertEqual(classify('Відбій повітряної тривоги на Волині.')[:2], ('clear', ['Волинська']))
        self.assertEqual(classify('Повітряна тривога!')[0], 'uncertain')
        self.assertEqual(classify('Тестова повітряна тривога. Львівська область.')[0], 'uncertain')
        self.assertEqual(classify('Повітряна тривога у Львівському районі.')[0], 'uncertain')
        self.assertEqual(classify('Знижки на покупки у Львівській області.')[0], 'other')
        self.assertEqual(classify('Повітряна тривога у Донецьку.')[0], 'uncertain')
        self.assertEqual(classify('Це не є повітряна тривога. Львівська область.')[0], 'uncertain')

    def test_duplicates_edits_and_review_conflict(self):
        self.assertEqual(self.store.ingest('example_feed', [self.message]), 1)
        self.assertEqual(self.store.ingest('example_feed', [self.message]), 0)
        review = {'revision': 1, 'state': 'approved', 'category': 'alert', 'regions': ['Львівська'], 'note': 'Перевірено'}
        self.store.review('example_feed', 10, review)
        self.store.ingest('example_feed', [{**self.message, 'text': 'Відбій повітряної тривоги. Львівська область.'}])
        detail = self.store.detail('example_feed', 10)
        self.assertEqual((detail['revision'], detail['review_state']), (2, 'pending'))
        self.assertEqual(len(detail['revisions']), 2)
        self.assertEqual(len(detail['reviews']), 1)
        with self.assertRaises(RuntimeError):
            self.store.review('example_feed', 10, review)
        self.store.ingest('example_feed', [])
        self.assertEqual(self.store.messages()['total'], 1)

    def test_review_validation_and_literal_search(self):
        self.store.ingest('example_feed', [self.message])
        with self.assertRaises(ValueError):
            self.store.review('example_feed', 10, {'revision': 1, 'state': 'approved', 'category': 'clear', 'regions': []})
        self.assertEqual(self.store.messages(query='%')['total'], 0)
        self.assertEqual(self.store.messages(query='Львів')['total'], 1)

    def test_source_failure_keeps_collected_messages(self):
        with patch('telegram_review.fetch_preview', return_value=[self.message]):
            self.store.poll()
        with patch('telegram_review.fetch_preview', side_effect=ValueError('Тимчасова помилка')):
            self.store.poll()
        status = self.store.status()['sources'][0]
        self.assertTrue(status['last_success'])
        self.assertEqual(status['error'], 'Тимчасова помилка')
        self.assertEqual(self.store.messages()['total'], 1)


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.server = create_server(0, Path(self.temp.name) / 'review.sqlite3')
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop)
        self.base = 'http://127.0.0.1:' + str(self.server.server_port)

    def stop(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def request(self, path, data=None, headers=None):
        request = Request(self.base + path, data=data, headers=headers or {})
        with urlopen(request, timeout=5) as response:
            return response.status, response.read()

    def test_private_files_and_cross_origin_are_blocked(self):
        for path in ['/.git/config', '/.local/telegram-review.sqlite3', '/tools/serve_map.py', '/data/%2e%2e/.git/config']:
            with self.assertRaises(HTTPError) as error:
                self.request(path)
            self.assertEqual(error.exception.code, 404)
        with self.assertRaises(HTTPError) as error:
            self.request('/api/review/refresh', b'{}', {'Origin': 'https://example.com', 'X-Review-Token': self.server.review_token})
        self.assertEqual(error.exception.code, 403)

    def test_api_review_roundtrip(self):
        store = self.server.review_store
        store.ingest('monitoring_zaxid', [{'id': 1, 'text': 'Повітряна тривога. Львівська область.', 'publishedAt': '2026-10-17T10:00:00+00:00', 'hasMedia': False}])
        status, payload = self.request('/api/review/status')
        self.assertEqual(status, 200)
        token = json.loads(payload)['csrfToken']
        payload = json.dumps({'revision': 1, 'state': 'approved', 'category': 'alert', 'regions': ['Львівська'], 'note': ''}).encode()
        status, _ = self.request('/api/review/messages/monitoring_zaxid/1', payload, {'X-Review-Token': token, 'Origin': self.base})
        self.assertEqual(status, 200)
        _, payload = self.request('/api/review/messages?state=approved')
        self.assertEqual(json.loads(payload)['total'], 1)


if __name__ == '__main__':
    unittest.main()
