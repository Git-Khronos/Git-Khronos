"""Owned HTTPS servers for native API transport tests; synthetic credential only."""
import base64
import os
import urllib.parse
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

    def do_POST(self):
        self.git_read()

    def git_read(self):
        address = urllib.parse.urlsplit(self.path)
        valid = ((self.command == 'GET' and address.path == '/team/subgroup/owned-project.git/info/refs'
                  and address.query == 'service=git-upload-pack')
                 or (self.command == 'POST' and address.path == '/team/subgroup/owned-project.git/git-upload-pack'
                     and not address.query))
        if not valid or self.server is other or not (root / 'git-http-root').is_dir():
            self.send_error(404)
            return
        expected = 'Basic ' + base64.b64encode(b'owned-git-reader:owned-git-credential').decode()
        matched = self.headers.get('Authorization') == expected
        observed = {'method': self.command, 'path': self.path, 'gitCredentialMatched': matched,
                    'apiCredentialPresent': self.headers.get('PRIVATE-TOKEN') is not None}
        with (root / 'git-requests.jsonl').open('a') as stream:
            stream.write(json.dumps(observed) + '\n')
        if not matched:
            self.send_response(401)
            self.send_header('WWW-Authenticate', 'Basic realm="Owned Git fixture"')
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        length = int(self.headers.get('Content-Length', '0'))
        if length < 0 or length > 1024 * 1024:
            self.send_error(413)
            return
        body = self.rfile.read(length)
        environment = {key: value for key, value in os.environ.items() if not key.startswith('GIT_')}
        environment.update(GIT_PROJECT_ROOT=str(root / 'git-http-root'), GIT_HTTP_EXPORT_ALL='1',
                           GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_NOSYSTEM='1',
                           PATH_INFO=address.path, QUERY_STRING=address.query, REQUEST_METHOD=self.command,
                           CONTENT_TYPE=self.headers.get('Content-Type', ''), CONTENT_LENGTH=str(length),
                           HTTP_GIT_PROTOCOL=self.headers.get('Git-Protocol', ''),
                           REMOTE_USER='owned-git-reader', REMOTE_ADDR='127.0.0.1')
        response = subprocess.run(['git', 'http-backend'], input=body, env=environment,
                                  capture_output=True, timeout=20, check=True).stdout
        headers, payload = response.split(b'\r\n\r\n', 1)
        parsed = [line.decode('ascii').split(':', 1) for line in headers.split(b'\r\n')]
        status = next((int(value.strip().split()[0]) for key, value in parsed if key.lower() == 'status'), 200)
        self.send_response(status)
        for key, value in parsed:
            if key.lower() in ('content-type', 'cache-control', 'pragma', 'expires'):
                self.send_header(key, value.strip())
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        try:
            if self.command == 'POST' and (root / 'git-hold').exists() and (b'command=fetch' in body or b'want ' in body):
                pack_offset = payload.find(b'PACK')
                prefix = min(max(8, pack_offset + 16), max(0, len(payload) - 1))
                self.wfile.write(payload[:prefix])
                self.wfile.flush()
                marker = root / 'git-started.tmp'
                marker.write_text(json.dumps({
                    'responseBytes': len(payload), 'sentPrefixBytes': prefix, 'packMagicOffset': pack_offset, 'path': address.path}))
                marker.replace(root / 'git-started.json')
                deadline = time.monotonic() + 30
                while (root / 'git-hold').exists() and time.monotonic() < deadline:
                    time.sleep(.02)
                self.wfile.write(payload[prefix:])
            else:
                self.wfile.write(payload)
        except (BrokenPipeError, ConnectionResetError, ssl.SSLError):
            pass

    def do_GET(self):
        if self.path.startswith('/team/subgroup/owned-project.git/'):
            self.git_read()
            return
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
            user = json.loads((root / 'user.json').read_text()) if (root / 'user.json').exists() else {'id': 41, 'username': 'owned-reader'}
            status, body = 200, json.dumps(user).encode()
        elif self.path == '/api/v4/projects/101':
            status = 200
            project = {'id': 101, 'name': 'Owned project',
                'path_with_namespace': 'team/subgroup/owned-project',
                'web_url': f'https://localhost:{main.server_port}/team/subgroup/owned-project',
                'description': None, 'default_branch': None, 'visibility': 'private',
                'archived': False,
                'http_url_to_repo': f'https://localhost:{main.server_port}/team/subgroup/owned-project.git',
                'ssh_url_to_repo': 'ssh://git@ssh.example.test:2222/team/subgroup/owned-project.git'}
            if (root / 'project-overrides.json').exists():
                project.update(json.loads((root / 'project-overrides.json').read_text()))
            body = json.dumps(project).encode()
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
