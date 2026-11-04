# Change Log

Mọi thay đổi đáng chú ý của **Unity Scene References** được ghi lại tại đây.
Định dạng theo [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/), đánh số phiên bản theo [Semantic Versioning](https://semver.org/).

## [1.2.0] - 2026-11-04

### Thay đổi
- **Cache index lưu ngoài project**: chuyển từ `.vscode/unityrefs.cache.json` sang bộ nhớ riêng của VS Code cho từng workspace — không bao giờ lọt vào git, không cần `.gitignore`. Cache cũ trong project được tự động chuyển ra ở lần mở đầu tiên (không phải quét lại).
- **Unity bridge an toàn cho cả team** (`UnitySceneRefsBridge.cs`):
  - Bọc toàn bộ trong `#if UNITY_EDITOR` — không bao giờ có mặt trong bản build, kể cả khi đặt ngoài thư mục `Editor`.
  - Chỉ khởi động khi máy có cài extension (kiểm tra `~/.vscode`, `~/.cursor`, `~/.antigravity-ide`); máy không cài thì không mở cổng 7892, không log. Cài extension khi Unity đang mở sẽ tự bật trong ~10 giây.
- Gói `.vsix` gọn hơn (~1.4 MB → ~120 KB): ảnh README không còn nằm trong gói.

### Thêm mới
- **Cài đặt một lệnh cho cả team**: `curl … install.sh | bash -s -- <UnityProject>` — tự tải bản mới nhất từ GitHub và cài vào mọi editor tìm thấy (VS Code ở bất kỳ vị trí nào, Cursor, Antigravity IDE).
- `install.sh` **cài hoặc cập nhật bridge** trong project Unity: ghi đè bản cũ, đổi tên `CursorBridge.cs` thành `UnitySceneRefsBridge.cs` (giữ GUID trong `.meta`), xoá bridge trùng để tránh tranh cổng.
- Repo GitHub [hoangledev/unity-scene-refs](https://github.com/hoangledev/unity-scene-refs), bản build sẵn `dist/unity-scene-refs.vsix`, lệnh `npm run release`.
- Hướng dẫn cài đặt cho team trong README và file CHANGELOG này.

### Sửa lỗi
- Ảnh trong tab Details không hiển thị: VS Code chỉ cho phép ảnh `https` ở trang này, nên ảnh README nay được tải từ GitHub (cần có mạng). Cờ `--no-rewrite-relative-links` của bản 1.1.0 không giải quyết được vấn đề này.
- `install.sh` không cài được vào Antigravity IDE (sai tên CLI, đúng là `antigravity-ide`).
- Log khởi động luôn ghi `v1.1.0` bất kể phiên bản thật.

## [1.1.0] - 2026-11-02

### Thêm mới
- **Hỗ trợ VS Code, Cursor và Antigravity IDE**: mã nguồn chuyển sang `vscode-extension/` (giữ symlink `cursor-extension`), `install.sh` tự dò và cài vào cả ba editor.
- **Component Usages**: CodeLens trên dòng khai báo `class` cho biết script đang được gắn trên những GameObject/Prefab nào. Tra cứu theo GUID trong `.cs.meta` nên không nhầm giữa các class trùng tên ở namespace khác nhau.
- **Animation Events**: tìm `functionName:` trong file `.anim`, bấm vào mở thẳng tới dòng tương ứng.
- **Cache tăng dần trên đĩa** theo `mtime`: chỉ quét lại file đã thay đổi, tự dọn file đã xoá, tự quét lại khi đổi phiên bản cache. Lọc nhanh nội dung trước khi tách dòng để bỏ qua các file YAML không liên quan → mở project nhanh hơn nhiều.
- **Giao diện**: gutter icon màu ở lề trái các dòng có reference, icon vector `$(unity-logo)` trong CodeLens (thay cho `⚡`), icon extension, banner và ảnh minh hoạ trong README.
- Setting mới: `scanPath`, `showComponentUsages`, `includeAnimations`, `bridgePort`.
- Lệnh mới: `Clear Cache & Re-index`, `Show Component Usages`, `Show Output Log`.

### Sửa lỗi (chọn đúng GameObject)
- Chọn nhầm object sinh lúc runtime (ví dụ `[generated] UIParticleRenderer`) do block `stripped` có `m_GameObject: {fileID: 0}`: bỏ qua `fileID: 0` ở cả extension lẫn bridge.
- Prefab đặt trong Scene (`PrefabInstance`, `!u!1001`) hiện tên `?` và không chọn được: đọc `m_Modifications` để lấy tên, lưu `m_CorrespondingSourceObject`/`m_PrefabInstance` và gửi thêm `altFileID` để bridge so khớp.
- Reference của UnityEvent bị gộp lẫn giữa các class có hàm trùng tên khi class nằm trong namespace: so khớp cả tên đầy đủ lẫn tên ngắn, bỏ cơ chế gộp theo tên hàm.
- Bridge xác thực lại trước khi chọn: gửi thêm `className`/`goName`, ưu tiên GameObject vừa đúng tên vừa thực sự có component đó.

## [1.0.0] - 2026-04-16

### Thêm mới
- Phiên bản đầu tiên, dùng cho Cursor: CodeLens `⚡ N Unity refs` trên các method C# được gọi từ UnityEvent (`m_MethodName`, ví dụ `Button.onClick`) trong file `.unity`, `.prefab` và (tuỳ chọn) `.asset`.
- Bridge `CursorBridge.cs` trong Unity (cổng 7892, `/ping` và `/select`): đưa Unity lên trước, mở Scene/Prefab, chọn, ping và frame GameObject. Khi Unity không mở thì mở file YAML tại đúng dòng.
- Status bar hiển thị tổng số reference, FileSystemWatcher tự quét lại khi file thay đổi.
- Lệnh `Refresh Index`, `Show References`; setting `enabled`, `includeAssets`.
