# Instagram MCP Server

MCP đăng & quản lý nội dung Instagram (tài khoản Business/Creator) qua Instagram Graph API v21.0. Chạy được STDIO (npx từ GitHub, dùng local) hoặc HTTP (deploy remote cho Evose). Ai cũng dùng được — chỉ điền biến môi trường, không sửa code.

**10 tools:** get_account_info, post_photo, post_reel, post_story_photo, post_story_video, post_carousel, list_media, get_media, get_comments, reply_comment.

> Đăng bài Instagram theo quy trình container (tạo → chờ xử lý → publish). Với video/reels, server tự chờ xử lý xong mới publish.

Mọi tool nhận thêm hai tham số tuỳ chọn `ig_user_id` và `access_token`, nên một bản chạy phục vụ được nhiều tài khoản. Không truyền thì server dùng biến môi trường làm giá trị mặc định.

## Biến môi trường
| Biến | Bắt buộc | Mô tả |
|------|:--:|------|
| IG_USER_ID | ✅ | ID tài khoản Instagram Business/Creator |
| IG_ACCESS_TOKEN | ✅ | Access Token (long-lived, quyền instagram_content_publish) |
| FB_GRAPH_VERSION | ❌ | Mặc định v21.0 |
| MCP_TRANSPORT | ❌ | `stdio` (mặc định) hoặc `http` (bắt buộc để dùng remote qua Evose) |
| MCP_AUTH_TOKEN | Bắt buộc khi `MCP_TRANSPORT=http` | Secret dùng cho header `Authorization: Bearer <token>` |
| HOST | ❌ | Địa chỉ bind khi chạy HTTP, mặc định `127.0.0.1` |
| PORT | ❌ | Cổng lắng nghe khi chạy HTTP, mặc định `8789` |
| MCP_PUBLIC_HOST | ❌ | Hostname công khai (qua reverse proxy) để chặn DNS rebinding |

Hai biến bắt buộc ở trên chỉ bắt buộc khi gọi tool mà không truyền `ig_user_id` và `access_token`. Server không thoát khi thiếu chúng, để client vẫn liệt kê được tool.

## Lấy token
1. Instagram phải là **Business/Creator** và liên kết với 1 Facebook Page.
2. developers.facebook.com → App → cấp quyền: `instagram_basic`, `instagram_content_publish`, `pages_show_list`.
3. Graph API Explorer → generate long-lived token.
4. Lấy IG_USER_ID: gọi `GET /{page-id}?fields=instagram_business_account`.

## Import vào Evose (STDIO / npx)
```json
{
  "mcpServers": {
    "instagram": {
      "command": "npx",
      "args": ["-y", "github:<user>/instagram-mcp"],
      "env": {
        "IG_USER_ID": "...",
        "IG_ACCESS_TOKEN": "..."
      }
    }
  }
}
```
Thay `<user>` bằng GitHub username. Execution Timeout để 120s (video reels cần chờ xử lý).

## Import vào Evose (HTTP remote)
Deploy server ở chế độ `MCP_TRANSPORT=http` (VPS/Railway/Render), sau đó khai báo trong Evose dạng Streamable HTTP:
```json
{
  "mcpServers": {
    "instagram": {
      "url": "https://<domain-cua-server>/mcp",
      "type": "streamable-http",
      "headers": { "Authorization": "Bearer <MCP_AUTH_TOKEN>" }
    }
  }
}
```

## Ghi chú
- Ảnh/video đăng từ URL công khai. Reels yêu cầu 9:16, 3–90s.
- Giới hạn 100 bài/24h (chính sách Instagram). License MIT.
