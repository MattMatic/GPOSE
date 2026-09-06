import http.server
import os
import socketserver

os.chdir(os.path.dirname(os.path.abspath(__file__)))

http.server.SimpleHTTPRequestHandler.extensions_map.update({
    '.mjs': 'text/javascript',
    '.js': 'text/javascript',
    '.wasm': 'application/wasm',
})

PORT = 8792
with socketserver.TCPServer(("", PORT), http.server.SimpleHTTPRequestHandler) as httpd:
    httpd.serve_forever()
