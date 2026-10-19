#!/usr/bin/env node
/**
 * Instagram MCP Server — Meta Instagram Graph API v21.0
 * Đăng & quản lý nội dung Instagram (tài khoản Business/Creator): ảnh, reels, story, carousel; xem media & comment.
 * Đăng bài Instagram theo quy trình container: tạo container -> chờ xử lý -> publish.
 * Thiết kế "ai cũng dùng được": chỉ cần điền 2 biến môi trường, không sửa code.
 *
 * Moi tool cung nhan 2 tham so tuy chon ig_user_id/access_token de dung nhieu tai khoan
 * tren cung 1 server (multi-tenant qua Evose Parameter Configuration). Neu khong truyen,
 * server dung IG_USER_ID/IG_ACCESS_TOKEN mac dinh.
 *
 * ENV bắt buộc (khi khong truyen ig_user_id/access_token luc goi tool):
 *   IG_USER_ID            - ID tài khoản Instagram Business/Creator (ig-user-id)
 *   IG_ACCESS_TOKEN       - Access Token (long-lived, quyen instagram_content_publish)
 * ENV tuỳ chọn:
 *   FB_GRAPH_VERSION      - mặc định v21.0
 *   MCP_TRANSPORT         - "stdio" (mặc định, dùng cho npx) hoặc "http" (remote, dùng cho Evose)
 * ENV bắt buộc khi MCP_TRANSPORT=http:
 *   MCP_AUTH_TOKEN        - secret dùng để xác thực header Authorization: Bearer <token>
 * ENV tuỳ chọn khi MCP_TRANSPORT=http:
 *   HOST                  - địa chỉ bind, mặc định 127.0.0.1 (đứng sau reverse proxy)
 *   PORT                  - cổng lắng nghe, mặc định 8789
 *   MCP_PUBLIC_HOST       - hostname công khai (qua Caddy/Nginx) để chặn DNS rebinding
 *
 * LƯU Ý: server KHÔNG thoát khi thiếu env.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { CallToolRequestSchema, ListToolsRequestSchema, Tool } from "@modelcontextprotocol/sdk/types.js";

const GRAPH = process.env.FB_GRAPH_VERSION || "v21.0";
const BASE = `https://graph.facebook.com/${GRAPH}`;

// ID cua Meta chi gom chu so, chu cai va dau gach duoi, vi du 123_456. Khong kiem
// thi mot id nhu "me/accounts?fields=access_token&x=" doi han endpoint Graph API, va
// "me/permissions" voi method DELETE thu hoi quyen cua token mac dinh tren server.
const ID_RE = /^[0-9A-Za-z_]{1,64}$/;
function safeId(v: any, label: string): string {
  const raw = typeof v === "string" || typeof v === "number" ? String(v).trim() : "";
  if (!ID_RE.test(raw)) throw new Error(`${label} khong hop le: chi nhan chu so, chu cai va dau gach duoi, toi da 64 ky tu.`);
  return raw;
}

function cfg(a: any = {}) {
  const argId = typeof a.ig_user_id === "string" || typeof a.ig_user_id === "number" ? String(a.ig_user_id).trim() : "";
  const argToken = typeof a.access_token === "string" ? a.access_token.trim() : "";
  const missing: string[] = [];
  // Truyen mot nua thi phai truyen du ca cap, KHONG roi ve credential mac dinh cua
  // server. Mot o access_token de trong tung lam bai cua tai khoan nay dang len tai
  // khoan khac ma van bao thanh cong.
  if (argId || argToken) {
    if (!argId) missing.push("ig_user_id (da truyen access_token nen phai truyen du ca cap)");
    if (!argToken) missing.push("access_token (da truyen ig_user_id nen phai truyen du ca cap)");
    if (argId) safeId(argId, "ig_user_id");
    return { IG_ID: argId, TOKEN: argToken, missing };
  }
  const IG_ID = process.env.IG_USER_ID || "";
  const TOKEN = process.env.IG_ACCESS_TOKEN || "";
  if (!IG_ID) missing.push("ig_user_id (hoac bien moi truong IG_USER_ID)");
  if (!TOKEN) missing.push("access_token (hoac bien moi truong IG_ACCESS_TOKEN)");
  if (IG_ID) safeId(IG_ID, "IG_USER_ID");
  return { IG_ID, TOKEN, missing };
}

const CRED_PROPS = {
  ig_user_id: { type: "string", description: "ID tai khoan Instagram Business/Creator. Bo qua neu server da co san IG_USER_ID mac dinh." },
  access_token: { type: "string", description: "Instagram Access Token. Bo qua neu server da co san IG_ACCESS_TOKEN mac dinh." },
};

async function api(path: string, method: "GET" | "POST" | "DELETE", params: Record<string, any> = {}, a: any = {}): Promise<any> {
  const c = cfg(a);
  if (c.missing.length) throw new Error(`Thieu cau hinh: ${c.missing.join(", ")}. Truyen ig_user_id/access_token khi goi tool, hoac dien bien moi truong tren server.`);
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) body.set(k, String(v));
  body.set("access_token", c.TOKEN);
  let url = `${BASE}${path}`;
  const opt: any = { method };
  if (method === "GET" || method === "DELETE") url += `?${body.toString()}`;
  else opt.body = body;
  const res = await fetch(url, opt);
  return res.json();
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

// Tạo container -> chờ FINISHED -> publish. Trả về kết quả publish (media_id).
async function publishContainer(c: ReturnType<typeof cfg>, containerParams: Record<string, any>, needWait: boolean, a: any = {}): Promise<any> {
  const created: any = await api(`/${c.IG_ID}/media`, "POST", containerParams, a);
  if (!created.id) return created; // lỗi -> trả nguyên
  const creation_id = created.id;
  if (needWait) {
    // poll status tối đa ~60s cho video/reels
    for (let i = 0; i < 20; i++) {
      const st: any = await api(`/${creation_id}`, "GET", { fields: "status_code" }, a);
      if (st.status_code === "FINISHED") break;
      if (st.status_code === "ERROR") return { error: "Container xu ly loi", detail: st };
      await sleep(3000);
    }
  }
  const published: any = await api(`/${c.IG_ID}/media_publish`, "POST", { creation_id }, a);
  return { container: creation_id, published };
}

const TOOLS: Tool[] = [
  { name: "get_account_info", description: "Lay thong tin tai khoan Instagram (username, so follower, so bai).", inputSchema: { type: "object", properties: { ...CRED_PROPS } } },
  { name: "post_photo", description: "Dang 1 anh len Instagram tu URL anh cong khai.", inputSchema: { type: "object", properties: { image_url: { type: "string", description: "URL anh cong khai" }, caption: { type: "string" }, ...CRED_PROPS }, required: ["image_url"] } },
  { name: "post_reel", description: "Dang Reel (video) len Instagram tu URL video cong khai. Yeu cau video 9:16, 3-90s.", inputSchema: { type: "object", properties: { video_url: { type: "string" }, caption: { type: "string" }, cover_url: { type: "string", description: "Anh bia (tuy chon)" }, share_to_feed: { type: "boolean", description: "Hien tren feed, mac dinh true" }, ...CRED_PROPS }, required: ["video_url"] } },
  { name: "post_story_photo", description: "Dang Story anh len Instagram tu URL anh cong khai.", inputSchema: { type: "object", properties: { image_url: { type: "string" }, ...CRED_PROPS }, required: ["image_url"] } },
  { name: "post_story_video", description: "Dang Story video len Instagram tu URL video cong khai.", inputSchema: { type: "object", properties: { video_url: { type: "string" }, ...CRED_PROPS }, required: ["video_url"] } },
  { name: "post_carousel", description: "Dang carousel (nhieu anh/video, toi da 10) len Instagram.", inputSchema: { type: "object", properties: { items: { type: "array", items: { type: "object", properties: { image_url: { type: "string" }, video_url: { type: "string" } } }, description: "Danh sach item: moi item co image_url HOAC video_url" }, caption: { type: "string" }, ...CRED_PROPS }, required: ["items"] } },
  { name: "list_media", description: "Lay danh sach bai da dang tren Instagram.", inputSchema: { type: "object", properties: { limit: { type: "number", description: "mac dinh 10" }, ...CRED_PROPS } } },
  { name: "get_media", description: "Lay chi tiet mot bai theo media_id.", inputSchema: { type: "object", properties: { media_id: { type: "string" }, ...CRED_PROPS }, required: ["media_id"] } },
  { name: "get_comments", description: "Lay binh luan cua mot bai.", inputSchema: { type: "object", properties: { media_id: { type: "string" }, limit: { type: "number" }, ...CRED_PROPS }, required: ["media_id"] } },
  { name: "reply_comment", description: "Tra loi mot binh luan tren Instagram.", inputSchema: { type: "object", properties: { comment_id: { type: "string" }, message: { type: "string" }, ...CRED_PROPS }, required: ["comment_id", "message"] } },
];

async function handle(name: string, a: any): Promise<any> {
  const c = cfg(a);
  switch (name) {
    case "get_account_info": return api(`/${c.IG_ID}`, "GET", { fields: "id,username,followers_count,media_count,biography" }, a);
    case "post_photo": return publishContainer(c, { image_url: a.image_url, caption: a.caption }, false, a);
    case "post_reel": return publishContainer(c, { media_type: "REELS", video_url: a.video_url, caption: a.caption, cover_url: a.cover_url, share_to_feed: a.share_to_feed ?? true }, true, a);
    case "post_story_photo": return publishContainer(c, { media_type: "STORIES", image_url: a.image_url }, false, a);
    case "post_story_video": return publishContainer(c, { media_type: "STORIES", video_url: a.video_url }, true, a);
    case "post_carousel": {
      const childIds: string[] = [];
      for (const it of (a.items || [])) {
        const p: any = it.video_url
          ? { media_type: "VIDEO", video_url: it.video_url, is_carousel_item: true }
          : { image_url: it.image_url, is_carousel_item: true };
        const child: any = await api(`/${c.IG_ID}/media`, "POST", p, a);
        if (!child.id) return { error: "Tao carousel item loi", detail: child };
        childIds.push(child.id);
      }
      return publishContainer(c, { media_type: "CAROUSEL", caption: a.caption, children: childIds.join(",") }, true, a);
    }
    case "list_media": return api(`/${c.IG_ID}/media`, "GET", { limit: a.limit ?? 10, fields: "id,caption,media_type,media_url,permalink,timestamp" }, a);
    case "get_media": return api(`/${safeId(a.media_id, "media_id")}`, "GET", { fields: "id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count" }, a);
    case "get_comments": return api(`/${safeId(a.media_id, "media_id")}/comments`, "GET", { limit: a.limit ?? 25, fields: "id,text,username,timestamp" }, a);
    case "reply_comment": return api(`/${safeId(a.comment_id, "comment_id")}/replies`, "POST", { message: a.message }, a);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

// Moi request HTTP phai co Server rieng. Mot instance dung chung se nem
// "Already connected to a transport" cho moi request den trong luc request truoc
// con mo, va cac tool cho Meta xu ly video giu response toi 60 giay.
function buildServer(): Server {
  const server = new Server({ name: "instagram-mcp-server", version: "1.2.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    try {
      const { name, arguments: args } = req.params;
      const result = await handle(name, args ?? {});
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
    }
  });
  return server;
}
async function runHttp(): Promise<void> {
  const authToken = process.env.MCP_AUTH_TOKEN || "";
  if (!authToken) {
    console.error("Fatal: thieu MCP_AUTH_TOKEN (bat buoc khi MCP_TRANSPORT=http).");
    process.exit(1);
  }
  const host = process.env.HOST || "127.0.0.1";
  const port = Number(process.env.PORT) || 8789;
  const publicHost = process.env.MCP_PUBLIC_HOST;
  const app = createMcpExpressApp(publicHost ? { host, allowedHosts: [publicHost] } : { host });
  const jsonRpcError = (code: number, message: string) => ({ jsonrpc: "2.0", error: { code, message }, id: null });

  app.post("/mcp", async (req, res) => {
    if (req.header("authorization") !== `Bearer ${authToken}`) {
      res.status(401).json(jsonRpcError(-32001, "Unauthorized"));
      return;
    }
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    // Dang ky truoc khi connect: neu res dong som thi transport van duoc don,
    // khong de lai transport treo.
    res.on("close", () => { void transport.close(); void server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e: any) {
      console.error("Error handling MCP request:", e);
      void transport.close();
      void server.close();
      if (!res.headersSent) res.status(500).json(jsonRpcError(-32603, "Internal server error"));
    }
  });
  app.get("/mcp", (_req, res) => res.status(405).json(jsonRpcError(-32000, "Method not allowed.")));
  app.delete("/mcp", (_req, res) => res.status(405).json(jsonRpcError(-32000, "Method not allowed.")));

  app.listen(port, host, () => console.error(`Instagram MCP Server (HTTP) dang chay tren http://${host}:${port}/mcp`));
}

async function main(): Promise<void> {
  const transport = (process.env.MCP_TRANSPORT || "stdio").toLowerCase();
  if (transport === "http") {
    await runHttp();
  } else {
    const server = buildServer();
    const t = new StdioServerTransport();
    await server.connect(t);
    console.error("Instagram MCP Server running on stdio");
  }
}
main().catch((e) => { console.error("Fatal:", e); process.exit(1); });