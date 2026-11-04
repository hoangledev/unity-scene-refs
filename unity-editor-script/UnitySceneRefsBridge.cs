// Editor-only: the whole file is stripped from player builds, even if it is
// placed outside an Editor folder or in a non-editor assembly.
#if UNITY_EDITOR
using System;
using System.Diagnostics;
using System.Net;
using System.Runtime.InteropServices;
using System.Threading;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using Debug = UnityEngine.Debug;

[InitializeOnLoad]
public static class UnitySceneRefsBridge
{
    private const int Port = 7892;
    private static HttpListener _listener;
    private static Thread _thread;
    private static volatile string _pendingFileID;
    private static volatile string _pendingAltFileID;
    private static volatile string _pendingScenePath;
    private static volatile string _pendingClassName;
    private static volatile string _pendingGoName;

    static UnitySceneRefsBridge()
    {
        StartServer();
        EditorApplication.update += ProcessPending;
        AssemblyReloadEvents.beforeAssemblyReload += StopServer;
    }

    private static void StartServer()
    {
        if (_listener != null) return;
        try
        {
            _listener = new HttpListener();
            _listener.Prefixes.Add($"http://localhost:{Port}/");
            _listener.Start();
            _thread = new Thread(ListenLoop) { IsBackground = true };
            _thread.Start();
            Debug.Log($"[UnitySceneRefs] Listening on http://localhost:{Port}");
        }
        catch (Exception ex)
        {
            Debug.LogWarning($"[UnitySceneRefs] Failed to start: {ex.Message}");
        }
    }

    private static void StopServer()
    {
        try
        {
            _listener?.Stop();
            _listener?.Close();
        }
        catch { }
        _listener = null;
    }

    private static void ListenLoop()
    {
        while (_listener != null && _listener.IsListening)
        {
            try
            {
                var ctx = _listener.GetContext();
                HandleRequest(ctx);
            }
            catch (HttpListenerException) { break; }
            catch (ObjectDisposedException) { break; }
            catch (Exception ex)
            {
                Debug.LogWarning($"[UnitySceneRefs] Error: {ex.Message}");
            }
        }
    }

    private static void HandleRequest(HttpListenerContext ctx)
    {
        var req = ctx.Request;
        var resp = ctx.Response;

        try
        {
            if (req.Url.AbsolutePath == "/select")
            {
                var fileID = req.QueryString["fileID"];
                var altFileID = req.QueryString["altFileID"];
                var scene = req.QueryString["scene"];
                var className = req.QueryString["className"];
                var goName = req.QueryString["goName"];

                if (string.IsNullOrEmpty(fileID) && string.IsNullOrEmpty(className))
                {
                    SendResponse(resp, 400, "{\"error\":\"fileID or className required\"}");
                    return;
                }

                _pendingFileID = fileID ?? "0";
                _pendingAltFileID = altFileID ?? "0";
                _pendingScenePath = scene;
                _pendingClassName = className;
                _pendingGoName = goName;
                SendResponse(resp, 200, "{\"status\":\"queued\"}");
            }
            else if (req.Url.AbsolutePath == "/ping")
            {
                SendResponse(resp, 200, "{\"status\":\"ok\",\"unity\":\"connected\"}");
            }
            else
            {
                SendResponse(resp, 404, "{\"error\":\"not found\"}");
            }
        }
        catch (Exception ex)
        {
            SendResponse(resp, 500, $"{{\"error\":\"{ex.Message}\"}}");
        }
    }

    private static void SendResponse(HttpListenerResponse resp, int code, string body)
    {
        resp.StatusCode = code;
        resp.ContentType = "application/json";
        var buf = System.Text.Encoding.UTF8.GetBytes(body);
        resp.ContentLength64 = buf.Length;
        resp.OutputStream.Write(buf, 0, buf.Length);
        resp.OutputStream.Close();
    }

    private static void ProcessPending()
    {
        if (_pendingFileID == null) return;

        var fileID = _pendingFileID;
        var altFileID = _pendingAltFileID;
        var assetPath = _pendingScenePath;
        var className = _pendingClassName;
        var goName = _pendingGoName;

        _pendingFileID = null;
        _pendingAltFileID = null;
        _pendingScenePath = null;
        _pendingClassName = null;
        _pendingGoName = null;

        ulong.TryParse(fileID, out var targetLocalID);
        ulong.TryParse(altFileID, out var altLocalID);

        FocusUnityEditor();

        bool isPrefab = !string.IsNullOrEmpty(assetPath) &&
                        assetPath.EndsWith(".prefab", StringComparison.OrdinalIgnoreCase);

        if (isPrefab)
        {
            SelectInPrefab(assetPath, targetLocalID, altLocalID, className, goName);
        }
        else
        {
            if (!string.IsNullOrEmpty(assetPath))
            {
                var activeScene = SceneManager.GetActiveScene();
                if (!activeScene.path.EndsWith(assetPath, StringComparison.OrdinalIgnoreCase))
                {
                    if (EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo())
                        EditorSceneManager.OpenScene(assetPath);
                }
            }
            SelectInScene(targetLocalID, altLocalID, className, goName);
        }
    }

    private static void FocusUnityEditor()
    {
#if UNITY_EDITOR_OSX
        var pid = Process.GetCurrentProcess().Id;
        try
        {
            Process.Start("osascript", $"-e 'tell application \"System Events\" to set frontmost of (first process whose unix id is {pid}) to true'");
        }
        catch (Exception ex)
        {
            Debug.LogWarning($"[UnitySceneRefs] Could not focus Unity: {ex.Message}");
        }
#elif UNITY_EDITOR_WIN
        var hwnd = Process.GetCurrentProcess().MainWindowHandle;
        if (hwnd != IntPtr.Zero)
        {
            SetForegroundWindow(hwnd);
            ShowWindow(hwnd, 9); // SW_RESTORE
        }
#endif
    }

#if UNITY_EDITOR_WIN
    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
#endif

    private static void SelectInScene(ulong targetLocalID, ulong altLocalID, string className, string goName)
    {
        var scene = SceneManager.GetActiveScene();
        var roots = scene.GetRootGameObjects();

        if (targetLocalID != 0 || altLocalID != 0)
        {
            foreach (var root in roots)
            {
                if (TrySelectInHierarchy(root, targetLocalID, altLocalID))
                    return;
            }
        }

        if (TrySelectByComponentOrName(roots, className, goName))
            return;

        Debug.LogWarning($"[UnitySceneRefs] Object (fileID: {targetLocalID}, class: {className}, go: {goName}) not found in scene '{scene.name}'");
    }

    private static void SelectInPrefab(string prefabPath, ulong targetLocalID, ulong altLocalID, string className, string goName)
    {
        var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath);
        if (prefab == null)
        {
            Debug.LogWarning($"[UnitySceneRefs] Prefab not found: {prefabPath}");
            return;
        }

        AssetDatabase.OpenAsset(prefab);

        EditorApplication.delayCall += () =>
        {
            var stage = PrefabStageUtility.GetCurrentPrefabStage();
            if (stage == null)
            {
                Debug.LogWarning($"[UnitySceneRefs] Prefab stage not available after opening '{prefabPath}'");
                PingPrefabAsset(prefab, prefabPath);
                return;
            }

            var root = stage.prefabContentsRoot;
            if (targetLocalID != 0 || altLocalID != 0)
            {
                if (TrySelectInHierarchy(root, targetLocalID, altLocalID))
                    return;
            }

            if (TrySelectByComponentOrName(new[] { root }, className, goName))
                return;

            Selection.activeGameObject = root;
            EditorGUIUtility.PingObject(root);
            Debug.LogWarning($"[UnitySceneRefs] Exact match not found inside prefab '{prefabPath}', selected root '{root.name}'");
        };
    }

    private static void PingPrefabAsset(GameObject prefab, string path)
    {
        Selection.activeObject = prefab;
        EditorGUIUtility.PingObject(prefab);
        Debug.Log($"[UnitySceneRefs] Pinged prefab asset '{path}'");
    }

    private static bool TrySelectInHierarchy(GameObject go, ulong targetLocalID, ulong altLocalID)
    {
        if (CheckObject(go, targetLocalID, altLocalID)) return true;

        foreach (var comp in go.GetComponents<Component>())
        {
            if (comp == null) continue;
            if (CheckObject(comp, targetLocalID, altLocalID)) return true;
        }

        for (int i = 0; i < go.transform.childCount; i++)
        {
            if (TrySelectInHierarchy(go.transform.GetChild(i).gameObject, targetLocalID, altLocalID))
                return true;
        }

        return false;
    }

    private static bool CheckObject(UnityEngine.Object obj, ulong targetLocalID, ulong altLocalID)
    {
        if (targetLocalID == 0 && altLocalID == 0) return false;

        var goid = GlobalObjectId.GetGlobalObjectIdSlow(obj);
        bool matched = false;

        if (targetLocalID != 0 && goid.targetObjectId != 0 &&
            (goid.targetObjectId == targetLocalID || goid.targetPrefabId == targetLocalID))
        {
            matched = true;
        }
        else if (altLocalID != 0 && goid.targetObjectId != 0 &&
                 (goid.targetObjectId == altLocalID || goid.targetPrefabId == altLocalID))
        {
            matched = true;
        }

        if (!matched) return false;

        GameObject goToSelect = obj as GameObject ?? (obj as Component)?.gameObject;
        if (goToSelect == null) return false;

        SelectAndFrame(goToSelect, $"fileID: {(targetLocalID != 0 ? targetLocalID : altLocalID)}");
        return true;
    }

    private static bool TrySelectByComponentOrName(GameObject[] roots, string className, string goName)
    {
        bool hasValidGoName = !string.IsNullOrEmpty(goName) && goName != "?";
        bool hasValidClass = !string.IsNullOrEmpty(className);

        // Pass 1: Match BOTH className and goName
        if (hasValidClass && hasValidGoName)
        {
            foreach (var root in roots)
            {
                var found = FindInHierarchy(root, go =>
                    string.Equals(go.name, goName, StringComparison.Ordinal) && HasComponentNamed(go, className));
                if (found != null)
                {
                    SelectAndFrame(found, $"class '{className}' on '{goName}'");
                    return true;
                }
            }
        }

        // Pass 2: Match className anywhere in hierarchy
        if (hasValidClass)
        {
            foreach (var root in roots)
            {
                var found = FindInHierarchy(root, go => HasComponentNamed(go, className));
                if (found != null)
                {
                    SelectAndFrame(found, $"class '{className}'");
                    return true;
                }
            }
        }

        // Pass 3: Match goName
        if (hasValidGoName)
        {
            foreach (var root in roots)
            {
                var found = FindInHierarchy(root, go => string.Equals(go.name, goName, StringComparison.Ordinal));
                if (found != null)
                {
                    SelectAndFrame(found, $"name '{goName}'");
                    return true;
                }
            }
        }

        return false;
    }

    private static bool HasComponentNamed(GameObject go, string className)
    {
        foreach (var comp in go.GetComponents<Component>())
        {
            if (comp == null) continue;
            var t = comp.GetType();
            if (string.Equals(t.Name, className, StringComparison.Ordinal) ||
                string.Equals(t.FullName, className, StringComparison.Ordinal))
            {
                return true;
            }
        }
        return false;
    }

    private static GameObject FindInHierarchy(GameObject go, Func<GameObject, bool> predicate)
    {
        if (predicate(go)) return go;
        for (int i = 0; i < go.transform.childCount; i++)
        {
            var found = FindInHierarchy(go.transform.GetChild(i).gameObject, predicate);
            if (found != null) return found;
        }
        return null;
    }

    private static void SelectAndFrame(GameObject goToSelect, string reason)
    {
        Selection.activeGameObject = goToSelect;
        EditorGUIUtility.PingObject(goToSelect);
        SceneView.lastActiveSceneView?.FrameSelected();
        Debug.Log($"[UnitySceneRefs] Selected '{goToSelect.name}' ({reason})");
    }
}
#endif
