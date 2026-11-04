# Change Log

Mọi thay đổi đáng chú ý của **Unity Scene References** được ghi lại tại đây.
Định dạng theo [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/), đánh số phiên bản theo [Semantic Versioning](https://semver.org/).

## [1.2.0] - 2026-11-04

### Thay đổi
- Cache index được lưu trong bộ nhớ riêng của VS Code cho từng workspace, không còn ghi vào project → không bao giờ lọt vào git, không cần `.gitignore`.
- Cache cũ (`.vscode/unityrefs.cache.json`, `.unityrefs.cache.json`) tự động được chuyển ra khỏi project ở lần mở đầu tiên, không cần quét lại.
- Unity bridge (`UnitySceneRefsBridge.cs`):
  - Bọc toàn bộ trong `#if UNITY_EDITOR` — không bao giờ có mặt trong bản build.
  - Chỉ khởi động khi máy có cài extension; máy không cài thì không mở cổng, không log.

### Thêm mới
- Cài đặt bằng một lệnh cho cả team (`install.sh` qua `curl`), tự cài vào VS Code, Cursor và Antigravity IDE.
- `install.sh` tự cài hoặc **cập nhật** bridge trong project Unity; `CursorBridge.cs` cũ được đổi tên thành `UnitySceneRefsBridge.cs` (giữ GUID).
- Hướng dẫn cài đặt cho team trong README.

### Sửa lỗi
- Ảnh trong tab Details của extension không hiển thị.
- `install.sh` không cài được vào Antigravity IDE (sai tên CLI `antigravity-ide`).

## [1.1.0] - 2026-11-02

### Thêm mới
- CodeLens **Component Usages** trên khai báo class: số GameObject/Prefab đang gắn component, xem chi tiết và chọn trong Unity.
- Hỗ trợ **Animation Events** trong file `.anim`.
- Gutter icon và CodeLens dùng icon vector (font TrueType).
- Hỗ trợ PrefabInstance (`m_Modifications`, `m_CorrespondingSourceObject`, `m_PrefabInstance`).
- Bridge kiểm tra component thực sự tồn tại trên GameObject trước khi chọn.
- Cache tăng dần (incremental) theo `mtime`, FileWatcher tự quét lại khi lưu, tự dọn cache của file đã xoá.
- Setting mới: `scanPath`, `showComponentUsages`, `includeAnimations`, `bridgePort`.
- Lệnh mới: `Clear Cache & Re-index`, `Show Component Usages`, `Show Output Log`.

### Sửa lỗi
- Bỏ qua các block `stripped` không có target (`fileID: 0`), tránh chọn nhầm object sinh lúc runtime.

## [1.0.0] - 2026-04-16

### Thêm mới
- Phiên bản đầu tiên: CodeLens hiển thị reference từ Scene/Prefab (UnityEvent, `Button.onClick`, EventTrigger) cho method C#.
- Lệnh `Refresh Index` và `Show References`.
- Setting `enabled` và `includeAssets`.
