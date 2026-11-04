# Change Log

Mọi thay đổi đáng chú ý của **Unity Scene References** được ghi lại tại đây.
Định dạng theo [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/), đánh số phiên bản theo [Semantic Versioning](https://semver.org/).

Mỗi phiên bản chia thành **Thêm mới**, **Thay đổi**, **Sửa lỗi**. Mỗi mục có nhãn cho biết phần bị ảnh hưởng:
- **[Extension]** — chạy trong VS Code / Cursor / Antigravity IDE (`src/extension.ts`).
- **[Unity bridge]** — script Editor chạy trong Unity, nhận lệnh qua `http://localhost:7892` để chọn GameObject (`UnitySceneRefsBridge.cs`, tên cũ `CursorBridge.cs`).
- **[Cài đặt]** — installer `install.sh`, gói `.vsix`, repo GitHub và tài liệu.

---

## [1.2.0] - 2026-11-04

**Tác giả:** Hoang Le · **Tổng số thay đổi:** 15 mục

Trọng tâm: **phát hành cho cả team** — cài một lệnh, an toàn cho project game, không để lại file rác trong repo.

### Thêm mới

1. _[Cài đặt]_ **Repo GitHub** [hoangledev/unity-scene-refs](https://github.com/hoangledev/unity-scene-refs) (public) chứa mã nguồn extension, bridge, installer và bản build sẵn `dist/unity-scene-refs.vsix`.
2. _[Cài đặt]_ **Cài đặt bằng một lệnh**, không cần clone repo:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/hoangledev/unity-scene-refs/main/install.sh | bash -s -- <đường dẫn project Unity>
   ```
   Chạy lại đúng lệnh này để cập nhật lên bản mới nhất. Bỏ đường dẫn project nếu chỉ cần cài extension.
3. _[Cài đặt]_ **`install.sh` viết lại**:
   - Chạy được cả từ bản clone (dùng file trong repo) lẫn qua `curl` (tải từ GitHub).
   - Tự tìm và cài vào **VS Code** (lệnh `code`, hoặc tìm app ở bất kỳ vị trí nào qua Spotlight, `/Applications`, `~/Applications`), **Cursor** (`cursor`) và **Antigravity IDE** (`antigravity-ide`).
   - Không tìm thấy editor nào → lưu gói vào `~/Downloads/unity-scene-refs.vsix` để cài tay.
   - Khi truyền đường dẫn project Unity, **cài hoặc cập nhật bridge**:

     | Project đang có | Installer làm gì |
     |---|---|
     | Chưa có bridge | Chép vào `Assets/Editor/UnitySceneRefs/UnitySceneRefsBridge.cs` |
     | `UnitySceneRefsBridge.cs` bản cũ | Ghi đè bằng bản mới nhất, giữ nguyên vị trí |
     | `UnitySceneRefsBridge.cs` đã mới nhất | Không làm gì, báo "up to date" |
     | `CursorBridge.cs` | Đổi tên thành `UnitySceneRefsBridge.cs` tại cùng thư mục (kèm `.meta`), rồi cập nhật nội dung |
     | Có cả hai | Xoá `CursorBridge.cs` + `.meta` (hai bridge sẽ tranh cổng 7892), cập nhật bản còn lại |

     Mỗi khi có thay đổi, installer nhắc commit bridge vào repo game.
   - **GUID cố định**: bridge đi kèm `UnitySceneRefsBridge.cs.meta` với GUID `458543293cdb845d29ebe6dddb2af7b9`; installer luôn đặt `.meta` về đúng GUID này (bridge là class Editor tĩnh, không asset nào tham chiếu theo GUID nên đổi GUID là an toàn). Các thư mục installer tự tạo (`Assets/Editor`, `Assets/Editor/UnitySceneRefs`) cũng có `.meta` với GUID cố định; thư mục đã có sẵn thì không bị đụng tới.
     → Hai người ở hai nhánh khác nhau cùng cài bridge sẽ tạo ra file giống hệt nhau, merge không còn conflict `.meta`.
4. _[Cài đặt]_ **`npm run release`**: compile → sinh README với link ảnh → đóng gói → chép sang `dist/unity-scene-refs.vsix`.
5. _[Cài đặt]_ Hướng dẫn cài đặt cho team trong README (cài một lệnh, cài thủ công với link tải trực tiếp, cấu trúc repo, cách phát hành bản mới) và file CHANGELOG này (hiện ở tab **CHANGELOG** của extension).

### Thay đổi

6. _[Extension]_ **Vị trí cache index**: chuyển từ `<project>/.vscode/unityrefs.cache.json` (hoặc `<project>/.unityrefs.cache.json` khi project không có thư mục `.vscode`) sang thư mục lưu trữ riêng của editor cho từng workspace (`context.storageUri`), ví dụ trên macOS:
   `~/Library/Application Support/Code/User/workspaceStorage/<id>/local.unity-scene-refs/unityrefs.cache.json`.
   - Không còn file nào được ghi vào project → không thể bị commit nhầm, không cần thêm `.gitignore`.
   - **Tự chuyển cache cũ**: lần đầu mở project sau khi nâng cấp, nếu còn file cache ở 2 vị trí cũ thì được chép sang vị trí mới rồi xoá khỏi project (log: `Moved legacy cache out of the project: …`). Không phải quét lại từ đầu.
   - Cache tách riêng theo từng editor (VS Code, Cursor, Antigravity mỗi bên một bản) và theo từng máy.
   - Lệnh `Unity Scene Refs: Clear Cache & Re-index` xoá file cache ở vị trí mới.
7. _[Extension]_ **Gói `.vsix` gọn hơn**: ~1.4 MB → ~120 KB. Ảnh README (`images/`, banner) không còn nằm trong gói; mã nguồn, script build, bridge và installer cũng được loại khỏi gói (`.vscodeignore`).
8. _[Unity bridge]_ **Chỉ tồn tại trong Editor**: toàn bộ file được bọc trong `#if UNITY_EDITOR … #endif`. Kể cả khi file bị đặt ngoài thư mục `Editor` hoặc nằm trong assembly không phải Editor, code vẫn bị loại khỏi bản build cho người chơi.
9. _[Unity bridge]_ **Không ảnh hưởng người không cài extension**: khi Unity load script, bridge kiểm tra máy có thư mục `*.unity-scene-refs-*` trong `~/.vscode/extensions`, `~/.cursor/extensions` hoặc `~/.antigravity-ide/extensions` không.
   - Không có → bridge **không làm gì**: không mở cổng 7892, không in log, không tạo thread; chỉ kiểm tra lại thư mục mỗi 10 giây.
   - Cài extension trong lúc Unity đang mở → bridge tự bật trong tối đa 10 giây, không cần compile lại.
   - Có → hoạt động như trước.
10. _[Unity bridge]_ Đây là bridge mà các project nên dùng; `CursorBridge.cs` (bản cũ) được thay thế — xem phần installer bên dưới.
11. _[Extension]_ Ảnh minh hoạ trong README được thay bằng ảnh chụp mới: `images/ClassRef.png`, `images/ButtonActionRef.png`.

### Sửa lỗi

12. _[Extension]_ **Ảnh không hiển thị trong tab Details của extension.** Nguyên nhân: VS Code chỉ giữ lại ảnh có đường dẫn `http`/`https` ở trang này — đường dẫn tương đối `./images/...` và ảnh nhúng `data:` đều bị loại bỏ. Cờ `--no-rewrite-relative-links` của bản 1.1.0 không giải quyết được.
    Cách sửa: khi đóng gói, script `scripts/embed-readme-images.js` sinh `build/README.md` với ảnh trỏ tới `https://raw.githubusercontent.com/hoangledev/unity-scene-refs/main/...` (đổi được bằng biến môi trường `IMAGE_BASE_URL`). Cần có mạng để xem ảnh.
13. _[Extension]_ Dòng log khởi động luôn ghi `v1.1.0` bất kể phiên bản thật → nay đọc từ `package.json`.
14. _[Cài đặt]_ `install.sh` cũ không cài được vào Antigravity IDE: gọi sai tên lệnh `antigravity` (đúng là `antigravity-ide`).
15. _[Cài đặt]_ `install.sh` cũ có đường dẫn VS Code gắn cứng theo máy `/Users/hoangle/_WorkSpace/...`, không dùng được trên máy người khác.

### Nâng cấp từ 1.1.0
1. Chạy lại lệnh cài ở trên (kèm đường dẫn project để cập nhật bridge), rồi `Cmd+Shift+P` → `Developer: Reload Window`.
2. Commit bridge mới vào repo game (nếu installer báo có thay đổi).
3. Có thể xoá dòng `.vscode/unityrefs.cache.json` khỏi `.gitignore` nếu đã thêm — không còn cần thiết, nhưng để lại cũng không sao.


---

## [1.1.0] - 2026-11-02

**Tác giả:** Hoang Le · **Tổng số thay đổi:** 19 mục

Trọng tâm: **chính xác như Rider** — thêm tìm Component và Animation Event, sửa các trường hợp chọn nhầm GameObject, tăng tốc bằng cache.

### Thêm mới

1. _[Extension]_ **Hỗ trợ VS Code, Cursor và Antigravity IDE** (bản 1.0.0 dành cho Cursor): mã nguồn chuyển sang thư mục `vscode-extension/` (giữ symlink `cursor-extension` để tương thích), `install.sh` tự dò và cài vào các editor (phần Antigravity IDE chưa hoạt động do sai tên lệnh — sửa ở 1.2.0).
2. _[Extension]_ **Component Usages** — CodeLens trên dòng khai báo `class`:
   - Hiển thị `1 Unity usage (<file> → <GameObject>)` hoặc `N Unity usages`; bấm vào để xem danh sách hoặc chọn trong Unity (lệnh `unitySceneRefs.showComponentReferences`).
   - Cách tìm: đọc `guid` trong mọi file `.cs.meta`, sau đó tìm các block MonoBehaviour (`!u!114`) có `m_Script: {fileID: 11500000, guid: <guid>}` trong Scene/Prefab và truy ngược ra GameObject hoặc PrefabInstance chứa nó.
   - Với class chính của file (tên class trùng tên file `.cs`), tra cứu bằng **GUID của chính file đó** → không nhầm giữa các class trùng tên ở namespace khác nhau. Các class phụ trong cùng file vẫn tra theo tên.
   - Tắt bằng setting `unitySceneRefs.showComponentUsages`.
3. _[Extension]_ **Animation Events**: quét `functionName:` trong file `.anim` và hiển thị chung trong CodeLens của method; bấm vào mở file `.anim` tại đúng dòng. Tắt bằng `unitySceneRefs.includeAnimations`.
4. _[Extension]_ **Nhiều class trong một file**: mỗi method được gán đúng class chứa nó (bản 1.0.0 chỉ lấy class đầu tiên của file).
5. _[Extension]_ **Cache tăng dần trên đĩa** (`CACHE_VERSION = 3`):
   - Lưu kết quả quét của từng file kèm `mtime`; lần mở sau chỉ quét lại file đã thay đổi.
   - Tự loại khỏi cache các file đã bị xoá; tự quét lại toàn bộ khi `CACHE_VERSION` thay đổi.
   - FileWatcher theo dõi `**/*.{unity,prefab,asset,anim}`, chờ 2 giây sau thay đổi cuối rồi quét lại phần đã đổi (bản 1.0.0 quét lại toàn bộ sau 3 giây).
6. _[Extension]_ **Lọc nhanh trước khi phân tích**: chỉ tách dòng các file có chứa `m_MethodName:` hoặc `m_Script: {fileID: 11500000, guid:` → bỏ qua phần lớn file YAML không liên quan. Mở project nhanh hơn nhiều.
7. _[Extension]_ **Giới hạn phạm vi quét** bằng setting `unitySceneRefs.scanPath` (mặc định `Assets`; bản 1.0.0 quét toàn bộ workspace). Bỏ qua các thư mục `Library`, `Temp`, `Logs`, `obj`, `Build`, `Builds`, `node_modules`, `.git` và thư mục ẩn.
8. _[Extension]_ **Giao diện**:
   - Gutter icon màu (khối Unity + mắt xích) ở lề trái mọi dòng `class`/method có reference, kèm tooltip số lượng.
   - Icon vector `$(unity-logo) $(link)` trong CodeLens (font `icons/unity-logo-v2.ttf`) thay cho ký tự `⚡`; status bar hiển thị `$(unity-logo) Unity Refs (N)`.
   - Icon extension (`icon.png`), banner và 2 ảnh minh hoạ trong README.
9. _[Extension]_ **Setting mới** (bản 1.0.0 chỉ có `enabled`, `includeAssets`):

   | Setting | Mặc định | Ý nghĩa |
   |---|---|---|
   | `unitySceneRefs.scanPath` | `"Assets"` | Thư mục quét, tương đối với workspace |
   | `unitySceneRefs.showComponentUsages` | `true` | Hiện CodeLens Component Usages trên class |
   | `unitySceneRefs.includeAnimations` | `true` | Quét Animation Events trong `.anim` |
   | `unitySceneRefs.bridgePort` | `7892` | Cổng kết nối Unity bridge (bản 1.0.0 gắn cứng 7892) |
10. _[Extension]_ **Lệnh mới**: `Unity Scene Refs: Clear Cache & Re-index` (`unitySceneRefs.clearCache`), `Unity Scene Refs: Show Component Usages` (`unitySceneRefs.showComponentReferences`), `Unity Scene Refs: Show Output Log` (`unitySceneRefs.showLog`).
11. _[Unity bridge]_ Thêm bản `UnitySceneRefsBridge.cs` (log `[UnitySceneRefs]`), cùng chức năng với `CursorBridge.cs` (log `[CursorBridge]`).
12. _[Unity bridge]_ `/select` nhận thêm tham số `altFileID`, `className`, `goName` (bản 1.0.0 chỉ nhận `fileID`, `scene`).
13. _[Unity bridge]_ **So khớp PrefabInstance**: một object khớp khi `targetObjectId` hoặc `targetPrefabId` của nó bằng `fileID` hoặc `altFileID`.
14. _[Unity bridge]_ **Xác thực trước khi chọn** khi không khớp được theo ID, thử lần lượt:
    1. GameObject vừa đúng tên `goName` vừa thực sự có component `className`;
    2. GameObject có component `className`;
    3. GameObject đúng tên `goName`.

### Thay đổi

15. _[Extension]_ Bỏ thông báo tiến trình "Unity Scene Refs: Indexing…" ở góc màn hình; trạng thái quét chỉ hiện trên status bar.

### Sửa lỗi

16. _[Extension]_ **Reference bị gộp lẫn giữa các class có method trùng tên** (ví dụ `Init`, `Show`, `OnClick`): bản 1.0.0 khi không khớp được tên class thì trả về mọi reference có cùng tên method. Nguyên nhân thường gặp là `m_TargetAssemblyTypeName` trong YAML ghi tên đầy đủ kèm namespace (`Namespace.Class, Assembly-CSharp`). Nay so khớp cả tên đầy đủ lẫn tên ngắn và bỏ cơ chế gộp theo tên method; chỉ UnityEvent không ghi tên class trong YAML mới được khớp theo tên method.
17. _[Extension]_ **Chọn nhầm object sinh lúc runtime** (ví dụ `[generated] UIParticleRenderer`): component của prefab trong Scene được ghi dạng block `stripped` với `m_GameObject: {fileID: 0}`; bản 1.0.0 gửi `fileID=0` sang Unity và Unity chọn object đầu tiên có ID 0. Nay extension bỏ qua `fileID: 0`.
18. _[Extension]_ **Prefab đặt trong Scene (`PrefabInstance`, `!u!1001`) hiện tên `?` và không chọn được**: nay đọc `m_Modifications` (`propertyPath: m_Name`) để lấy tên hiển thị, lưu `m_CorrespondingSourceObject` và `m_PrefabInstance` để gửi thêm `altFileID` cho bridge.
19. _[Unity bridge]_ Bỏ qua object có ID bằng 0 khi so khớp → không còn chọn nhầm object sinh lúc runtime.

### Đã biết
- Bridge 1.1.0 vẫn mở cổng 7892 và in log trên mọi máy, kể cả máy không cài extension, và không có `#if UNITY_EDITOR` (đã sửa ở 1.2.0).
- Cache được ghi vào trong project (`.vscode/unityrefs.cache.json`, ~10 MB) và dễ bị commit nhầm (đã sửa ở 1.2.0).
- Ảnh trong tab Details không hiển thị (đã sửa ở 1.2.0).
- Animation Event được khớp theo tên method, không theo class: hai class cùng có method `OnHit` sẽ cùng hiện reference từ `.anim` của nhau.


---

## [1.0.0] - 2026-04-16

**Tác giả:** Dung Dang · **Tổng số tính năng:** 8 mục

Phiên bản đầu tiên, dùng cho Cursor.

### Thêm mới

1. _[Extension]_ **CodeLens trên method C#** được gọi từ UnityEvent: hiển thị `⚡ 1 Unity ref (<file> → <GameObject>)` hoặc `⚡ N Unity refs`.
   - Quét `m_MethodName` và `m_TargetAssemblyTypeName` trong file `.unity`, `.prefab` và (tuỳ chọn) `.asset`, kèm tên sự kiện (ví dụ `m_OnClick`) và GameObject chứa component.
   - Chỉ nhận method có access modifier (`public`/`private`/`protected`/`internal`); lấy class đầu tiên trong file.
2. _[Extension]_ Bấm CodeLens: có 1 reference thì mở thẳng; nhiều reference thì hiện danh sách (khi Unity đang kết nối có thêm mục **Open ALL in Unity**). Unity đang mở (có bridge) → chọn trong Unity; không → mở file Scene/Prefab dạng text tại đúng dòng.
3. _[Extension]_ Status bar `Unity Refs (N)`; FileSystemWatcher theo dõi `**/*.{unity,prefab,asset}` và quét lại toàn bộ sau 3 giây kể từ thay đổi cuối.
4. _[Extension]_ Quét toàn bộ workspace mỗi lần mở, không có cache.
5. _[Extension]_ Lệnh: `Unity Scene Refs: Refresh Index` (`unitySceneRefs.refresh`), `Unity Scene Refs: Show References` (`unitySceneRefs.showReferences`).
6. _[Extension]_ Setting: `unitySceneRefs.enabled` (mặc định `true`), `unitySceneRefs.includeAssets` (mặc định `false`).
7. _[Unity bridge]_ Script Editor `[InitializeOnLoad]`, mở `HttpListener` tại `http://localhost:7892` với 2 endpoint:
   - `GET /ping` — kiểm tra Unity đang mở;
   - `GET /select?fileID=…&scene=…` — mở Scene hoặc Prefab (Prefab Stage) và chọn GameObject có `GlobalObjectId.targetObjectId == fileID`.
8. _[Unity bridge]_ Đưa cửa sổ Unity lên trước (`osascript` trên macOS, `SetForegroundWindow` trên Windows), chọn, ping và frame object trong Scene view; với Prefab thì ping thêm asset trong Project. Không tìm thấy object trong Prefab thì chọn object gốc của prefab.
