// 一次性实验:探测 opencode v2.3.0 服务器在 /prompt 请求周期内
// 用户消息的附件(files/attachments 字段)何时入库。
// 用法:node scratchpad/probe-files-store.cjs [port]
// 结论打印到 stdout,供决定是否加"prompt resolve 后主动刷新"。
const BASE = "http://127.0.0.1:" + (process.argv[2] || "45679");
// opencode serve 的鉴权:Basic "opencode:<密码>"(用户名恒为 opencode,
// 形状与 src/server/manager.ts 相同);manager.ts 的密码是 randomBytes 随机
// 生成,这里只是探测服务器自己的占位密码,非任何真实凭证。
const PW = process.argv[3] || "probe_pw_2026";
const AUTH = "Basic " + Buffer.from(`opencode:${PW}`).toString("base64");
const HEADERS = { authorization: AUTH };

// 1x1 红色 PNG 的 base64(自造小图,不依赖外部文件)
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const dataUri = "data:image/png;base64," + PNG;

async function getMessages(id) {
  const r = await fetch(`${BASE}/api/session/${id}/message`, { headers: HEADERS });
  const page = await r.json();
  return page.data || [];
}

function summarize(messages) {
  return messages.map((m) => {
    const role = m.role || (m.info && m.info.role);
    const fields = Object.keys(m);
    // 服务器返回的消息可能是 {info: {...}} 或平铺,把可能的附件字段都打出来
    const body = m.info || m;
    const attach = body.attachments ?? body.files ?? null;
    return { role, fields, attach, time: body.time };
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // 建会话
  const sr = await fetch(`${BASE}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json", ...HEADERS },
    body: JSON.stringify({ title: "probe-files-store" }),
  });
  if (!sr.ok) throw new Error("session create " + sr.status + " " + (await sr.text()));
  const session = await sr.json();
  console.log("session create raw:", JSON.stringify(session).slice(0, 400));
  const id = session.id || (session.info && session.info.id) || (session.data && session.data.id);
  if (!id) throw new Error("no session id in create response");
  console.log("session:", id);

  // prompt 附件形状与扩展一致:data: URI + name
  const body = { text: "probe", files: [{ uri: dataUri, name: "shot.png" }] };

  // 发出 prompt,不等 resolve
  const pending = fetch(`${BASE}/api/session/${id}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json", ...HEADERS },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, text: await r.text() }));

  // resolve 前先探一次(给服务器 300ms 处理请求体)
  await sleep(300);
  const early = await getMessages(id);
  console.log("== EARLY (prompt in flight) ==");
  console.log(JSON.stringify(summarize(early), null, 2));

  const resp = await pending;
  console.log("== prompt resolve ==", resp.status, resp.text.slice(0, 400));

  // resolve 后立即再探 + 延迟再探,看列表何时可见
  for (const wait of [0, 3000, 8000]) {
    await sleep(wait);
    const late = await getMessages(id);
    console.log(`== LATE +${wait}ms == count:`, late.length);
    console.log(JSON.stringify(summarize(late), null, 2));
  }
})().catch((e) => {
  console.error("PROBE FAILED:", e.message);
  process.exit(1);
});
