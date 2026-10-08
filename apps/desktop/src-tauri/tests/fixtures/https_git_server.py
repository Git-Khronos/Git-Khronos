"""Local TLS smart-Git acceptance fixture; no credentials or request logging."""
import base64
import http.server
import os
from pathlib import Path
import ssl
import subprocess
import sys
import urllib.parse

root = Path(sys.argv[1]).resolve()
backend = sys.argv[2]


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        self.transport()

    def do_POST(self):
        self.transport()

    def transport(self):
        authorized = self.headers.get("Authorization", "") == (
            "Basic " + base64.b64encode(b"user:fixture-secret").decode()
        )
        if not authorized or (root / "reject-https").exists():
            body = b"Authentication required"
            self.send_response(401)
            self.send_header("WWW-Authenticate", 'Basic realm="HTTPS fixture"')
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        url = urllib.parse.urlsplit(self.path)
        if url.path not in ("/repo.git/info/refs", "/repo.git/git-upload-pack"):
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0"))
        if length > 2 * 1024 * 1024:
            self.send_error(413)
            return
        environment = {
            "PATH": os.environ.get("PATH", ""),
            "GIT_PROJECT_ROOT": str(root),
            "GIT_HTTP_EXPORT_ALL": "1",
            "GIT_CONFIG_COUNT": "1",
            "GIT_CONFIG_KEY_0": "safe.bareRepository",
            "GIT_CONFIG_VALUE_0": "all",
            "GIT_CONFIG_GLOBAL": os.devnull,
            "GIT_CONFIG_NOSYSTEM": "1",
            "REQUEST_METHOD": self.command,
            "PATH_INFO": url.path,
            "QUERY_STRING": url.query,
            "CONTENT_TYPE": self.headers.get("Content-Type", ""),
            "CONTENT_LENGTH": str(length),
            "REMOTE_USER": "user",
            "REMOTE_ADDR": "127.0.0.1",
            "SERVER_PROTOCOL": "HTTP/1.1",
        }
        result = subprocess.run(
            [backend], input=self.rfile.read(length), env=environment,
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=15,
        )
        if result.returncode:
            self.send_error(502)
            return
        headers, separator, body = result.stdout.partition(b"\r\n\r\n")
        if not separator:
            self.send_error(502)
            return
        parsed = []
        status = 200
        for line in headers.decode("ascii").split("\r\n"):
            name, value = line.split(":", 1)
            if name.lower() == "status":
                status = int(value.strip().split()[0])
            else:
                parsed.append((name, value.strip()))
        self.send_response(status)
        for name, value in parsed:
            self.send_header(name, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        with (root / "smart-requests").open("a", encoding="ascii") as record:
            record.write(f"{self.command} {url.path} {status}\n")


server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.load_cert_chain(root / "certificate.pem", root / "private-key.pem")
server.socket = context.wrap_socket(server.socket, server_side=True)
print(server.server_port, flush=True)
server.serve_forever()
