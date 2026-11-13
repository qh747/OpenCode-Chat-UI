import http from "node:http";

const port = Number(process.argv[2] ?? 0);
const server = http.createServer((req, res) => {
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
