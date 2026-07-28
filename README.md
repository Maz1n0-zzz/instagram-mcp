# Instagram MCP Server

MCP đăng & quản lý nội dung Instagram (tài khoản Business/Creator) qua Instagram Graph API v21.0. Chạy STDIO (npx từ GitHub). Ai cũng dùng được — chỉ điền 2 biến môi trường.

**10 tools:** get_account_info, post_photo, post_reel, post_story_photo, post_story_video, post_carousel, list_media, get_media, get_comments, reply_comment.

> Đăng bài Instagram theo quy trình container (tạo → chờ xử lý → publish). Với video/reels, server tự chờ xử lý xong mới publish.

## Biến môi trường
| Biến | Bắt buộc | Mô tả |
|------|:--:|------|
| IG_USER_ID | ✅ | ID tài khoản Instagram Business/Creator |
| IG_ACCESS_TOKEN | ✅ | Access Token (long-lived, quyền instagram_content_publish) |
| FB_GRAPH_VERSION | ❌ | Mặc định v21.0 |

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

## Ghi chú
- Ảnh/video đăng từ URL công khai. Reels yêu cầu 9:16, 3–90s.
- Giới hạn 100 bài/24h (chính sách Instagram). License MIT.