import http from "node:http";

const port = Number(process.argv[2] ?? 0);
// --v1: emulate an opencode v1 server (no /api/info; /global/health with version 1.x)
const v1 = process.argv.includes("--v1");

const server = http.createServer((req, res) => {
  if (v1) {
    if (req.url?.startsWith("/global/health")) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ healthy: true, version: "1.19.5" }));
      return;
    }
    res.statusCode = 404;
    res.end();
    return;
  }
  if (req.url?.startsWith("/api/info")) {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ version: "mock-1.0.0", urls: [`http://127.0.0.1:${port}`] }));
    return;
  }
  res.statusCode = 404;
  res.end();
});
server.listen(port, "127.0.0.1", () => {
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  process.stdout.write(`mock-server ready on ${actualPort}\n`);
  process.on("SIGTERM", () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  });
});
