import { MockServerOptions, MockServerResult } from "./mockServerTypes";
export class MockServerGenerator {
  static generateMockServer(opts: MockServerOptions): MockServerResult {
    const port = opts.port || 9090;
    const latency = opts.latencyMs || 80;
    const nodeServerJs = "const http = require('http');\nconst PORT = " + port + ";\nconst LATENCY_MS = " + latency + ";\nconst server = http.createServer((req, res) => {\n  res.setHeader('Content-Type', 'application/json');\n  setTimeout(() => {\n    if (req.url.startsWith('/api/v1/invoices')) {\n      res.writeHead(200);\n      return res.end(JSON.stringify({ data: [{ id: 'INV-101', status: 'PAID' }] }));\n    }\n    res.writeHead(200);\n    res.end(JSON.stringify({ status: 'HEALTHY', endpoint: req.url }));\n  }, LATENCY_MS);\n});\nserver.listen(PORT, () => console.log('🚀 Mock Server on port ' + PORT));\n";
    const pythonServerPy = "import http.server, socketserver\nfrom http.server import HTTPServer, BaseHTTPRequestHandler\nPORT = " + port + "\nclass MockHandler(BaseHTTPRequestHandler):\n    def do_GET(self):\n        self.send_response(200)\n        self.end_headers()\nwith socketserver.TCPServer(('', PORT), MockHandler) as httpd:\n    httpd.serve_forever()\n";
    const shellRunner = "#!/usr/bin/env bash\nnode scripts/mock_api_server.js\n";
    return {
      nodeServerJs,
      pythonServerPy,
      shellRunner,
      writtenFiles: {
        nodeServerPath: "scripts/mock_api_server.js",
        pythonServerPath: "scripts/mock_api_server.py",
        runnerPath: "scripts/run_mock_server.sh"
      }
    };
  }
}