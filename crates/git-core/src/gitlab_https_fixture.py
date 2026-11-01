"""Owned HTTPS servers for native API transport tests; synthetic credential only."""
import http.server
import json
from pathlib import Path
import ssl
import subprocess
import sys
import threading
import time

root = Path(sys.argv[1])
certificate, key = root / 'certificate.pem', root / 'key.pem'
subprocess.run([
    'openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', str(key), '-out', str(certificate), '-days', '1',
    '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=True, timeout=5)
context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.load_cert_chain(certificate, key)


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        destination = self.server is other
        observed = {'destination': destination, 'path': self.path,
                    'credentialMatched': self.headers.get('PRIVATE-TOKEN') == 'owned-api-fixture-token'}
        with (root / 'requests.jsonl').open('a') as stream:
            stream.write(json.dumps(observed) + '\n')
        mode = (root / 'mode').read_text()
        if mode.startswith('redirect-') and not destination:
            self.send_response(int(mode.removeprefix('redirect-')))
            self.send_header('Location', f'https://127.0.0.1:{other.server_port}/api/v4/user')
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        if mode == 'stalled':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', '100')
            self.end_headers()
            self.wfile.write(b'{')
            self.wfile.flush()
            time.sleep(30)
            return
        if mode == 'declared-large':
            self.send_response(200)
            self.send_header('Content-Length', str(1024 * 1024 + 1))
            self.end_headers()
            return
        if mode.startswith('status-'):
            status = int(mode.removeprefix('status-'))
            body = b'{"message":"owned-api-fixture-token owned-upstream-diagnostic"}'
        elif mode == 'streamed-large':
            # Valid JSON would otherwise succeed: this checks the byte budget,
            # independently of the separate malformed-JSON case.
            status, body = 200, b'"' + b'x' * (1024 * 1024) + b'"'
        elif mode == 'exact-boundary':
            status, body = 200, b'"' + b'x' * (1024 * 1024 - 2) + b'"'
        elif mode == 'malformed':
            status, body = 200, b'{"id":'
        elif self.path == '/api/v4/user':
            status, body = 200, json.dumps({'id': 41, 'username': 'owned-reader'}).encode()
        elif self.path.startswith('/api/v4/projects?'):
            status = 200
            body = json.dumps([{'id': 101, 'name': 'Owned project',
                'path_with_namespace': 'team/subgroup/owned-project',
                'web_url': f'https://localhost:{main.server_port}/team/subgroup/owned-project',
                'description': None, 'default_branch': 'main', 'visibility': 'private',
                'archived': False, 'private_token': 'owned-not-exported-marker'}]).encode()
        else:
            status, body = 404, b'{}'
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        if mode != 'streamed-large':
            self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError, ssl.SSLError):
            pass


main = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
other = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
for server in (main, other):
    server.daemon_threads = True
    server.socket = context.wrap_socket(server.socket, server_side=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
print(json.dumps({'origin': f'https://localhost:{main.server_port}'}), flush=True)
threading.Event().wait()
