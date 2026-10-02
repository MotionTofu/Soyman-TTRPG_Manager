"""Serve the current prototype for local visual checks, without app data."""
import importlib.util
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

source = Path('C:/Users/ingva/.codex/visualizations/2026/09/29/01a0ef80-9ab2-74a1-b150-af54675e89a0/library-reading-notebook.html')
renderer_path = Path('C:/Users/ingva/.codex/plugins/cache/openai-bundled/visualize/1.0.45/skills/visualize/scripts/render.py')
spec = importlib.util.spec_from_file_location('visualize_renderer', renderer_path)
renderer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renderer)

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        content = renderer.render(source, 'SoyMan — чтение и тетрадь').encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def log_message(self, *args):
        pass

if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1', 5206), Handler)
    print('http://127.0.0.1:5206/', flush=True)
    server.serve_forever()
