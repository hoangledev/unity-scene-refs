# Unity Scene References (VS Code & Cursor)

<p align="center">
  <img src="./VscodetoUnityImg.png" alt="Unity Scene References Banner" width="650" style="border-radius: 12px; box-shadow: 0 4px 16px rgba(0,0,0,0.3);">
</p>

Find Unity scene, prefab, and animation references directly in **Visual Studio Code**, **Cursor IDE**, and **Antigravity** — similar to JetBrains Rider's "Find Usages" for serialized UnityEvents, Animation Events, and MonoBehaviour Component attachments.

---

## 🚀 Key Features & Visual Walkthrough

### 1. 🔍 Tìm Class / MonoBehaviour Component Usages (Like Rider)
- Hiển thị CodeLens ngay trên dòng khai báo `class` cho biết có bao nhiêu GameObject/Prefab đang gắn Component này.
- Bấm vào CodeLens để mở menu QuickPick chi tiết: liệt kê chính xác file `.prefab` / `.unity`, tên GameObject, và số dòng tương ứng.
- **Tương tác trực tiếp với Unity**: Chọn item để Unity Editor tự mở Scene/Prefab và Ping/Focus ngay vào GameObject tương ứng trong Hierarchy!
- **Khử trùng lặp chuẩn xác**: Sử dụng GUID 32 ký tự từ `.cs.meta` để không bao giờ bị nhầm lẫn giữa các class trùng tên ở namespace khác nhau.

<p align="center">
  <img src="./images/ClassRef.png" alt="MonoBehaviour Component Usages in Unity" width="720" style="border-radius: 8px; box-shadow: 0 4px 14px rgba(0,0,0,0.3);">
</p>

---

### 2. ⚡ Tìm Action Button & UnityEvent References
- Hiển thị CodeLens trên đầu các hàm C# được liên kết với sự kiện Unity (như `Button.onClick`, `UnityEvent`, EventTrigger).
- Xem ngay hàm đang được gọi bởi GameObject nào trong Scene hay Prefab nào (ví dụ: `Reset Popup Panel.prefab → Button Reset`).
- Hỗ trợ cả **Animation Events** trong các file `.anim`.

<p align="center">
  <img src="./images/ButtonActionRef.png" alt="Action Button Reference in CodeLens" width="720" style="border-radius: 8px; box-shadow: 0 4px 14px rgba(0,0,0,0.3);">
</p>

---

### 3. 🎨 Bộ nhận diện Icon mới: Gutter Icon & Vector CodeLens
- **Gutter Icon (Lề dòng code)**: Hiển thị icon màu 3D sắc nét (Khối lập phương Unity + Mắt xích vàng) ngay trước số dòng của các class và method có reference.
- **Vector CodeLens**: Tích hợp bộ font vector TrueType chuẩn (`$(unity-logo) $(link)`), đồng bộ với font chữ của editor, không bao giờ bị lỗi ô vuông `□`.

---

### 4. 🎯 Độ chính xác 100% (Zero False Positives)
- **Hỗ trợ PrefabInstance (`!u!1001`)**: Đọc chính xác `m_Modifications` (tên override `m_Name`), `m_CorrespondingSourceObject` và `m_PrefabInstance`.
- **Loại bỏ lỗi khớp nhầm `fileID: 0`**: Bỏ qua các stub block `stripped` không có target ID, ngăn ngừa Unity chọn nhầm các object sinh lúc runtime (như `[generated] UIParticleRenderer`).
- **Xác thực 2 chiều với Unity Editor**: Bridge script kiểm tra sự tồn tại thực tế của Component trên GameObject trước khi chọn.

---

### 5. ⚡ Incremental Cache cực nhanh (< 750ms)
- Lưu metadata và timestamp (`mtime`) xuống file `.vscode/unityrefs.cache.json`.
- Sử dụng bộ lọc nhanh trước khi tách dòng, bỏ qua hàng nghìn file YAML không chứa reference.
- **Tự động cập nhật**: FileWatcher tự quét lại các file vừa sửa khi bạn bấm Save trong Unity.
- **Tự làm sạch (Garbage Collection)**: Tự động loại bỏ cache của các file đã bị xóa trong Unity.

---

## 📦 Package Components

| Path | Purpose |
|------|---------|
| `vscode-extension/` | Extension source code (TypeScript, icons, fonts, images) |
| `cursor-extension` | Symlink pointing to `vscode-extension/` for backward compatibility |
| `unity-editor-script/UnitySceneRefsBridge.cs` | HTTP bridge script for Unity Editor (port 7892) |
| `unity-editor-script/CursorBridge.cs` | Legacy alias bridge script (same functionality) |
| `unity-scene-refs-1.1.0.vsix` | Pre-packaged VSIX ready to install |
| `install.sh` | Universal installer for VS Code, Cursor, and Antigravity IDE |

---

## 🛠️ Installation

### Cách 1: Cài đặt tự động bằng Script (Khuyên dùng)

Chạy script cài đặt:
```bash
cd /Users/hoangle/_WorkSpace/unity-scene-refs-package
./install.sh
```
Script sẽ tự động tìm tất cả các editor đã cài trên máy (VS Code, Cursor, Antigravity) và cài extension vào từng editor.

Sau đó copy file Bridge vào thư mục Editor của project Unity:
```bash
cp unity-editor-script/UnitySceneRefsBridge.cs /path/to/your/UnityProject/Assets/_Project/Editor/
```
*(Lưu ý: Nếu project đã có `CursorBridge.cs` thì không cần copy thêm, cả hai đều tương thích hoàn toàn).*

---

### Cách 2: Cài thủ công qua giao diện Editor

1. Mở **Visual Studio Code** hoặc **Cursor**.
2. Nhấn `Cmd + Shift + P` (hoặc `Ctrl + Shift + P`).
3. Nhập và chọn **`Extensions: Install from VSIX...`**.
4. Chọn file `unity-scene-refs-1.1.0.vsix`.
5. Đảm bảo file `UnitySceneRefsBridge.cs` (hoặc `CursorBridge.cs`) đã có trong thư mục `Assets/.../Editor/` của Unity.
6. Tải lại cửa sổ: `Cmd + Shift + P` → **`Developer: Reload Window`**.

---

## ⚙️ Configuration Settings

Tuỳ chỉnh qua giao diện Settings hoặc file `.vscode/settings.json`:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `unitySceneRefs.enabled` | `boolean` | `true` | Bật/tắt toàn bộ CodeLens và Gutter icon |
| `unitySceneRefs.scanPath` | `string` | `"Assets"` | Thư mục quét tương đối trong workspace (ví dụ `"Assets"` hoặc `"Assets/_Project"`) |
| `unitySceneRefs.showComponentUsages` | `boolean` | `true` | Hiển thị CodeLens số lượng Component gắn trên class |
| `unitySceneRefs.includeAnimations` | `boolean` | `true` | Quét sự kiện trong các file `.anim` |
| `unitySceneRefs.includeAssets` | `boolean` | `false` | Quét thêm các file ScriptableObject `.asset` |
| `unitySceneRefs.bridgePort` | `number` | `7892` | Cổng HTTP kết nối với Unity Editor Bridge |

---

## 💡 Commands (`Cmd + Shift + P`)

- `Unity Scene Refs: Refresh Index` — Quét lại các file đã thay đổi (incremental scan).
- `Unity Scene Refs: Clear Cache & Re-index` — Xoá toàn bộ cache trên đĩa và quét lại từ đầu.
- `Unity Scene Refs: Show References` — Xem danh sách reference của method hiện tại.
- `Unity Scene Refs: Show Component Usages` — Xem danh sách GameObject đang gắn Component hiện tại.
- `Unity Scene Refs: Show Output Log` — Mở bảng log chi tiết tốc độ quét và trạng thái kết nối Unity.

---

## 🏗️ Build từ mã nguồn

```bash
cd vscode-extension
npm install
npm run compile
npx @vscode/vsce package --no-dependencies --allow-missing-repository
```

---

## 📄 License

MIT
