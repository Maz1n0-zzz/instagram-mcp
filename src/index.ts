#!/usr/bin/env node
/**
 * Instagram MCP Server — Meta Instagram Graph API v21.0
 * Đăng & quản lý nội dung Instagram (tài khoản Business/Creator): ảnh, reels, story, carousel; xem media & comment.
 * Đăng bài Instagram theo quy trình container: tạo container -> chờ xử lý -> publish.
 * Thiết kế "ai cũng dùng được": chỉ cần điền 2 biến môi trường, không sửa code.
 *
 * ENV bắt buộc (khi GỌI TOOL):
 *   IG_USER_ID            - ID tài khoản Instagram Business/Creator (ig-user-id)
 *   IG_ACCESS_TOKEN       - Access Token (long-lived, quyen instagram_content_publish)
 * ENV tuỳ chọn:
 *   FB_GRAPH_VERSION      - mặc định v21.0
 *
 * LƯU Ý: server KHÔNG thoát khi thiếu env.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, Tool } from "@modelcontextprotocol/sdk/types.js";

const GRAPH = process.env.FB_GRAPH_VERSION || "v21.0";
const BASE = `https://graph.facebook.com/${GRAPH}`;

function cfg() {
  const IG_ID = process.env.IG_USER_ID || "";
  const TOKEN = process.env.IG_ACCESS_TOKEN || "";
  const missing: string[] = [];
  if (!IG_ID) missing.push("IG_USER_ID");
  if (!TOKEN) missing.push("IG_ACCESS_TOKEN");
  return { IG_ID, TOKEN, missing };
}

async function api(path: string, method: "GET" | "POST" | "DELETE", params: Record<string, any> = {}): Promise<any> {
  const c = cfg();
  if (c.missing.length) throw new Error(`Thieu cau hinh: ${c.missing.join(", ")}. Dien cac bien moi truong trong cau hinh MCP.`);
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
async function publishContainer(c: ReturnType<typeof cfg>, containerParams: Record<string, any>, needWait: boolean): Promise<any> {
  const created: any = await api(`/${c.IG_ID}/media`, "POST", containerParams);
  if (!created.id) return created; // lỗi -> trả nguyên
  const creation_id = created.id;
  if (needWait) {
    // poll status tối đa ~60s cho video/reels
    for (let i = 0; i < 20; i++) {
      const st: any = await api(`/${creation_id}`, "GET", { fields: "status_code" });
      if (st.status_code === "FINISHED") break;
      if (st.status_code === "ERROR") return { error: "Container xu ly loi", detail: st };
      await sleep(3000);
    }
  }
  const published: any = await api(`/${c.IG_ID}/media_publish`, "POST", { creation_id });
  return { container: creation_id, published };
}

const TOOLS: Tool[] = [
  { name: "get_account_info", description: "Lay thong tin tai khoan Instagram (username, so follower, so bai).", inputSchema: { type: "object", properties: {} } },
  { name: "post_photo", description: "Dang 1 anh len Instagram tu URL anh cong khai.", inputSchema: { type: "object", properties: { image_url: { type: "string", description: "URL anh cong khai" }, caption: { type: "string" } }, required: ["image_url"] } },
  { name: "post_reel", description: "Dang Reel (video) len Instagram tu URL video cong khai. Yeu cau video 9:16, 3-90s.", inputSchema: { type: "object", properties: { video_url: { type: "string" }, caption: { type: "string" }, cover_url: { type: "string", description: "Anh bia (tuy chon)" }, share_to_feed: { type: "boolean", description: "Hien tren feed, mac dinh true" } }, required: ["video_url"] } },
  { name: "post_story_photo", description: "Dang Story anh len Instagram tu URL anh cong khai.", inputSchema: { type: "object", properties: { image_url: { type: "string" } }, required: ["image_url"] } },
  { name: "post_story_video", description: "Dang Story video len Instagram tu URL video cong khai.", inputSchema: { type: "object", properties: { video_url: { type: "string" } }, required: ["video_url"] } },
  { name: "post_carousel", description: "Dang carousel (nhieu anh/video, toi da 10) len Instagram.", inputSchema: { type: "object", properties: { items: { type: "array", items: { type: "object", properties: { image_url: { type: "string" }, video_url: { type: "string" } } }, description: "Danh sach item: moi item co image_url HOAC video_url" }, caption: { type: "string" } }, required: ["items"] } },
  { name: "list_media", description: "Lay danh sach bai da dang tren Instagram.", inputSchema: { type: "object", properties: { limit: { type: "number", description: "mac dinh 10" } } } },
  { name: "get_media", description: "Lay chi tiet mot bai theo media_id.", inputSchema: { type: "object", properties: { media_id: { type: "string" } }, required: ["media_id"] } },
  { name: "get_comments", description: "Lay binh luan cua mot bai.", inputSchema: { type: "object", properties: { media_id: { type: "string" }, limit: { type: "number" } }, required: ["media_id"] } },
  { name: "reply_comment", description: "Tra loi mot binh luan tren Instagram.", inputSchema: { type: "object", properties: { comment_id: { type: "string" }, message: { type: "string" } }, required: ["comment_id", "message"] } },
];

async function handle(name: string, a: any): Promise<any> {
  const c = cfg();
  switch (name) {
    case "get_account_info": return api(`/${c.IG_ID}`, "GET", { fields: "id,username,followers_count,media_count,biography" });
    case "post_photo": return publishContainer(c, { image_url: a.image_url, caption: a.caption }, false);
    case "post_reel": return publishContainer(c, { media_type: "REELS", video_url: a.video_url, caption: a.caption, cover_url: a.cover_url, share_to_feed: a.share_to_feed ?? true }, true);
    case "post_story_photo": return publishContainer(c, { media_type: "STORIES", image_url: a.image_url }, false);
    case "post_story_video": return publishContainer(c, { media_type: "STORIES", video_url: a.video_url }, true);
    case "post_carousel": {
      const childIds: string[] = [];
      for (const it of (a.items || [])) {
        const p: any = it.video_url
          ? { media_type: "VIDEO", video_url: it.video_url, is_carousel_item: true }
          : { image_url: it.image_url, is_carousel_item: true };
        const child: any = await api(`/${c.IG_ID}/media`, "POST", p);
        if (!child.id) return { error: "Tao carousel item loi", detail: child };
        childIds.push(child.id);
      }
      return publishContainer(c, { media_type: "CAROUSEL", caption: a.caption, children: childIds.join(",") }, true);
    }
    case "list_media": return api(`/${c.IG_ID}/media`, "GET", { limit: a.limit ?? 10, fields: "id,caption,media_type,media_url,permalink,timestamp" });
    case "get_media": return api(`/${a.media_id}`, "GET", { fields: "id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count" });
    case "get_comments": return api(`/${a.media_id}/comments`, "GET", { limit: a.limit ?? 25, fields: "id,text,username,timestamp" });
    case "reply_comment": return api(`/${a.comment_id}/replies`, "POST", { message: a.message });
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

const server = new Server({ name: "instagram-mcp-server", version: "1.0.0" }, { capabilities: { tools: {} } });
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
async function main() { const t = new StdioServerTransport(); await server.connect(t); console.error("Instagram MCP Server running on stdio"); }
main().catch((e) => { console.error("Fatal:", e); process.exit(1); });