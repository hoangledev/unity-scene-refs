import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';

// ── Interfaces ────────────────────────────────────────────────────────

export interface UnityMethodRef {
    filePath: string;
    fileName: string;
    lineNumber: number;
    methodName: string;
    targetClassName?: string;
    eventName: string;
    gameObjectName: string;
    ownerGameObjectFileID: string;
    altFileID?: string;
    kind: 'unityEvent' | 'animEvent';
}

export interface UnityComponentRef {
    filePath: string;
    fileName: string;
    lineNumber: number;
    className: string;
    guid: string;
    gameObjectName: string;
    ownerGameObjectFileID: string;
    altFileID?: string;
    kind: 'component';
}

interface ObjectInfo {
    name?: string;
    gameObjectFileID?: string;
    prefabInstanceID?: string;
    correspondingSourceID?: string;
    isStripped?: boolean;
    type: string;
    scriptGuid?: string;
    lineNumber: number;
}

interface CacheFileEntry {
    mtime: number;
    methods: UnityMethodRef[];
    components: UnityComponentRef[];
}

interface DiskCache {
    version: number;
    files: Record<string, CacheFileEntry>;
    guidMap: Record<string, string>; // guid -> className
    scriptPathToGuid?: Record<string, string>; // scriptPath -> guid
}

const CACHE_VERSION = 3;
const log = vscode.window.createOutputChannel('Unity Scene Refs');

// ── Unity Bridge (HTTP → Unity Editor) ────────────────────────────────

function getBridgePort(): number {
    return vscode.workspace.getConfiguration('unitySceneRefs').get<number>('bridgePort', 7892);
}

function selectInUnity(
    fileID: string,
    scenePath?: string,
    altFileID?: string,
    className?: string,
    goName?: string
): Promise<boolean> {
    const port = getBridgePort();
    return new Promise((resolve) => {
        let url = `http://localhost:${port}/select?fileID=${encodeURIComponent(fileID || '0')}`;
        if (altFileID) url += `&altFileID=${encodeURIComponent(altFileID)}`;
        if (scenePath) url += `&scene=${encodeURIComponent(scenePath)}`;
        if (className) url += `&className=${encodeURIComponent(className)}`;
        if (goName && goName !== '?') {
            const cleanGoName = goName.replace(/\s*\(Prefab Instance\)$/, '');
            url += `&goName=${encodeURIComponent(cleanGoName)}`;
        }

        const req = http.get(url, { timeout: 3000 }, (res) => {
            let body = '';
            res.on('data', (chunk: Buffer) => (body += chunk));
            res.on('end', () => {
                log.appendLine(`Unity response: ${res.statusCode} ${body}`);
                resolve(res.statusCode === 200);
            });
        });

        req.on('error', (err) => {
            log.appendLine(`Unity bridge error: ${err.message}`);
            resolve(false);
        });

        req.on('timeout', () => {
            req.destroy();
            resolve(false);
        });
    });
}

async function pingUnity(): Promise<boolean> {
    const port = getBridgePort();
    return new Promise((resolve) => {
        const req = http.get(`http://localhost:${port}/ping`, { timeout: 2000 }, (res) => {
            resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => {
            req.destroy();
            resolve(false);
        });
    });
}

// ── Index & Cache ─────────────────────────────────────────────────────

export class UnityRefIndex {
    private methodRefs: UnityMethodRef[] = [];
    private componentRefs: UnityComponentRef[] = [];

    private byAnimMethod = new Map<string, UnityMethodRef[]>();
    private byUnqualifiedMethod = new Map<string, UnityMethodRef[]>();
    private byClass = new Map<string, Map<string, UnityMethodRef[]>>();
    private byComponentClass = new Map<string, UnityComponentRef[]>();
    private byComponentGuid = new Map<string, UnityComponentRef[]>();

    private guidMap = new Map<string, string>(); // guid -> className
    private scriptPathToGuid = new Map<string, string>(); // normalized fsPath -> guid

    private fileCache = new Map<string, CacheFileEntry>();
    private watcher: vscode.FileSystemWatcher | undefined;
    private _onDidUpdate = new vscode.EventEmitter<void>();
    readonly onDidUpdate = this._onDidUpdate.event;
    private building = false;
    private statusItem: vscode.StatusBarItem;
    private cacheFilePath: string | undefined;

    constructor(statusItem: vscode.StatusBarItem, storageDir: string | undefined) {
        this.statusItem = statusItem;
        this.initCachePath(storageDir);
        this.loadCacheFromDisk();
    }

    // The cache lives in VS Code's per-workspace storage (outside the project), so it never
    // ends up in the game repo. Caches written inside the project by older versions are moved there.
    private initCachePath(storageDir: string | undefined) {
        if (!storageDir) return;
        this.cacheFilePath = path.join(storageDir, 'unityrefs.cache.json');

        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) return;
        const root = folders[0].uri.fsPath;
        for (const legacy of [path.join(root, '.vscode', 'unityrefs.cache.json'), path.join(root, '.unityrefs.cache.json')]) {
            if (!fs.existsSync(legacy)) continue;
            try {
                if (!fs.existsSync(this.cacheFilePath)) {
                    fs.mkdirSync(storageDir, { recursive: true });
                    fs.copyFileSync(legacy, this.cacheFilePath);
                }
                fs.unlinkSync(legacy);
                log.appendLine(`Moved legacy cache out of the project: ${legacy}`);
            } catch (err: any) {
                log.appendLine(`Failed to move legacy cache ${legacy}: ${err.message}`);
            }
        }
    }

    private loadCacheFromDisk() {
        if (!this.cacheFilePath || !fs.existsSync(this.cacheFilePath)) return;
        try {
            const raw = fs.readFileSync(this.cacheFilePath, 'utf-8');
            const data: DiskCache = JSON.parse(raw);
            if (data.version !== CACHE_VERSION) {
                log.appendLine(`Cache version mismatch (found v${data.version}, expected v${CACHE_VERSION}), will re-index`);
                return;
            }

            for (const [guid, cls] of Object.entries(data.guidMap || {})) {
                this.guidMap.set(guid, cls);
            }

            for (const [sPath, guid] of Object.entries(data.scriptPathToGuid || {})) {
                this.scriptPathToGuid.set(sPath, guid);
            }

            for (const [fPath, entry] of Object.entries(data.files || {})) {
                this.fileCache.set(fPath, entry);
            }

            this.rebuildLookupFromCache();
            log.appendLine(`Loaded cache: ${this.methodRefs.length} method refs, ${this.componentRefs.length} component refs`);
            this.updateStatusItemText();
        } catch (err: any) {
            log.appendLine(`Failed to load cache: ${err.message}`);
        }
    }

    private saveCacheToDisk() {
        if (!this.cacheFilePath) return;
        try {
            const dir = path.dirname(this.cacheFilePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

            const filesObj: Record<string, CacheFileEntry> = {};
            for (const [k, v] of this.fileCache.entries()) {
                filesObj[k] = v;
            }

            const guidObj: Record<string, string> = {};
            for (const [k, v] of this.guidMap.entries()) {
                guidObj[k] = v;
            }

            const scriptGuidObj: Record<string, string> = {};
            for (const [k, v] of this.scriptPathToGuid.entries()) {
                scriptGuidObj[k] = v;
            }

            const data: DiskCache = {
                version: CACHE_VERSION,
                files: filesObj,
                guidMap: guidObj,
                scriptPathToGuid: scriptGuidObj,
            };

            fs.writeFileSync(this.cacheFilePath, JSON.stringify(data), 'utf-8');
            log.appendLine(`Saved cache to disk (${Object.keys(filesObj).length} indexed files)`);
        } catch (err: any) {
            log.appendLine(`Failed to save cache: ${err.message}`);
        }
    }

    private addMethodToClassMap(classKey: string, methodName: string, ref: UnityMethodRef) {
        let classMap = this.byClass.get(classKey);
        if (!classMap) {
            classMap = new Map();
            this.byClass.set(classKey, classMap);
        }
        let arr = classMap.get(methodName);
        if (!arr) {
            arr = [];
            classMap.set(methodName, arr);
        }
        arr.push(ref);
    }

    private rebuildLookupFromCache() {
        this.methodRefs = [];
        this.componentRefs = [];
        this.byAnimMethod.clear();
        this.byUnqualifiedMethod.clear();
        this.byClass.clear();
        this.byComponentClass.clear();
        this.byComponentGuid.clear();

        for (const entry of this.fileCache.values()) {
            if (entry.methods) {
                for (const m of entry.methods) {
                    this.methodRefs.push(m);

                    if (m.kind === 'animEvent') {
                        let arr = this.byAnimMethod.get(m.methodName);
                        if (!arr) {
                            arr = [];
                            this.byAnimMethod.set(m.methodName, arr);
                        }
                        arr.push(m);
                    } else if (m.targetClassName) {
                        this.addMethodToClassMap(m.targetClassName, m.methodName, m);
                        const dotIdx = m.targetClassName.lastIndexOf('.');
                        if (dotIdx !== -1) {
                            const shortName = m.targetClassName.slice(dotIdx + 1);
                            if (shortName) {
                                this.addMethodToClassMap(shortName, m.methodName, m);
                            }
                        }
                    } else {
                        let arr = this.byUnqualifiedMethod.get(m.methodName);
                        if (!arr) {
                            arr = [];
                            this.byUnqualifiedMethod.set(m.methodName, arr);
                        }
                        arr.push(m);
                    }
                }
            }

            if (entry.components) {
                for (const c of entry.components) {
                    this.componentRefs.push(c);

                    let arr = this.byComponentClass.get(c.className);
                    if (!arr) {
                        arr = [];
                        this.byComponentClass.set(c.className, arr);
                    }
                    arr.push(c);

                    if (c.guid) {
                        let gArr = this.byComponentGuid.get(c.guid);
                        if (!gArr) {
                            gArr = [];
                            this.byComponentGuid.set(c.guid, gArr);
                        }
                        gArr.push(c);
                    }
                }
            }
        }
    }

    private updateStatusItemText() {
        const total = this.methodRefs.length + this.componentRefs.length;
        this.statusItem.text = `$(unity-logo) Unity Refs (${total})`;
    }

    async clearCache() {
        log.appendLine('Clearing cache and reindexing...');
        this.fileCache.clear();
        this.guidMap.clear();
        this.scriptPathToGuid.clear();
        if (this.cacheFilePath && fs.existsSync(this.cacheFilePath)) {
            try {
                fs.unlinkSync(this.cacheFilePath);
            } catch {}
        }
        await this.build();
    }

    async build() {
        if (this.building) return;
        this.building = true;
        const startTime = Date.now();
        log.appendLine('── Incremental build started ──');

        const config = vscode.workspace.getConfiguration('unitySceneRefs');
        const includeAssets = config.get<boolean>('includeAssets', false);
        const includeAnimations = config.get<boolean>('includeAnimations', true);
        const showComponentUsages = config.get<boolean>('showComponentUsages', true);
        const scanSubPath = config.get<string>('scanPath', 'Assets').trim();

        const extensions = ['.unity', '.prefab'];
        if (includeAssets) extensions.push('.asset');
        if (includeAnimations) extensions.push('.anim');

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            log.appendLine('No workspace folders found');
            this.building = false;
            return;
        }

        // 1. Collect all target files and script .meta files
        const assetFiles: string[] = [];
        const metaFiles: string[] = [];

        for (const folder of workspaceFolders) {
            const rootDir = folder.uri.fsPath;
            const targetScanDir = scanSubPath ? path.join(rootDir, scanSubPath) : rootDir;
            const scanDir = fs.existsSync(targetScanDir) ? targetScanDir : rootDir;

            this.walkDir(scanDir, extensions, assetFiles, metaFiles);
        }

        log.appendLine(`Found ${assetFiles.length} asset files and ${metaFiles.length} .cs.meta files`);
        this.statusItem.text = '$(sync~spin) Unity Refs: Indexing…';

        // 2. Parse script meta files to build guid -> className and scriptPath -> guid maps
        for (const metaPath of metaFiles) {
            try {
                const header = fs.readFileSync(metaPath, 'utf-8').slice(0, 300);
                const m = header.match(/guid:\s*([a-f0-9]{32})/i);
                if (m) {
                    const guid = m[1];
                    const scriptPath = metaPath.slice(0, -5); // strip '.meta'
                    const scriptBase = path.basename(metaPath, '.cs.meta');
                    this.guidMap.set(guid, scriptBase);
                    this.scriptPathToGuid.set(scriptPath, guid);
                }
            } catch {}
        }

        // 3. Incremental check: only parse new or modified asset files
        const activeFileSet = new Set<string>();
        let modifiedCount = 0;
        const total = assetFiles.length;

        for (const filePath of assetFiles) {
            activeFileSet.add(filePath);

            let mtimeMs = 0;
            try {
                mtimeMs = fs.statSync(filePath).mtimeMs;
            } catch {
                continue;
            }

            const cached = this.fileCache.get(filePath);
            if (cached && cached.mtime === mtimeMs) {
                continue;
            }

            modifiedCount++;
            try {
                const ext = path.extname(filePath).toLowerCase();
                let methods: UnityMethodRef[] = [];
                let components: UnityComponentRef[] = [];

                if (ext === '.anim') {
                    methods = this.parseAnimFile(filePath);
                } else {
                    const parsed = this.parseUnityYamlFile(filePath, showComponentUsages);
                    methods = parsed.methods;
                    components = parsed.components;
                }

                this.fileCache.set(filePath, {
                    mtime: mtimeMs,
                    methods,
                    components,
                });
            } catch (err: any) {
                log.appendLine(`  ✗ Error parsing ${path.basename(filePath)}: ${err.message}`);
            }
        }

        // 4. Remove deleted files from cache
        for (const cachedPath of Array.from(this.fileCache.keys())) {
            if (!activeFileSet.has(cachedPath)) {
                this.fileCache.delete(cachedPath);
            }
        }

        // 5. Rebuild lookup maps and save cache
        this.rebuildLookupFromCache();
        this.saveCacheToDisk();
        this.updateStatusItemText();

        const durationMs = Date.now() - startTime;
        log.appendLine(
            `── Build done in ${durationMs}ms: parsed ${modifiedCount}/${total} files, total ${this.methodRefs.length} method refs & ${this.componentRefs.length} component refs ──`
        );

        this.building = false;
        this._onDidUpdate.fire();
    }

    getGuidForScriptPath(scriptPath: string): string | undefined {
        const cached = this.scriptPathToGuid.get(scriptPath);
        if (cached) return cached;
        const metaPath = scriptPath + '.meta';
        if (fs.existsSync(metaPath)) {
            try {
                const header = fs.readFileSync(metaPath, 'utf-8').slice(0, 300);
                const m = header.match(/guid:\s*([a-f0-9]{32})/i);
                if (m) {
                    this.scriptPathToGuid.set(scriptPath, m[1]);
                    return m[1];
                }
            } catch {}
        }
        return undefined;
    }

    lookupMethods(className: string, methodName: string): UnityMethodRef[] {
        const results: UnityMethodRef[] = [];
        const classMap = this.byClass.get(className);
        if (classMap) {
            const exact = classMap.get(methodName);
            if (exact && exact.length > 0) {
                results.push(...exact);
            }
        }

        // Include Animation Events matching this method name
        const anims = this.byAnimMethod.get(methodName);
        if (anims && anims.length > 0) {
            results.push(...anims);
        }

        // Include only UnityEvents that had NO targetClassName in YAML (rare legacy YAML)
        const unqual = this.byUnqualifiedMethod.get(methodName);
        if (unqual && unqual.length > 0) {
            results.push(...unqual);
        }

        return results;
    }

    lookupComponents(className: string, scriptGuid?: string): UnityComponentRef[] {
        if (scriptGuid) {
            return this.byComponentGuid.get(scriptGuid) ?? [];
        }
        return this.byComponentClass.get(className) ?? [];
    }

    startWatching() {
        this.watcher?.dispose();
        this.watcher = vscode.workspace.createFileSystemWatcher('**/*.{unity,prefab,asset,anim}');
        const rebuild = debounce(() => this.build(), 2000);
        this.watcher.onDidChange(rebuild);
        this.watcher.onDidCreate(rebuild);
        this.watcher.onDidDelete(rebuild);
    }

    dispose() {
        this.watcher?.dispose();
        this._onDidUpdate.dispose();
    }

    private walkDir(dir: string, extensions: string[], assetOut: string[], metaOut: string[]) {
        const SKIP = new Set(['Library', 'Temp', 'Logs', 'obj', 'Build', 'Builds', 'node_modules', '.git']);
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            if (entry.name.startsWith('.') && entry.name !== '.') continue;
            const full = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                if (!SKIP.has(entry.name)) {
                    this.walkDir(full, extensions, assetOut, metaOut);
                }
            } else if (entry.isFile()) {
                const lower = entry.name.toLowerCase();
                if (lower.endsWith('.cs.meta')) {
                    metaOut.push(full);
                } else {
                    const ext = path.extname(lower);
                    if (extensions.includes(ext)) {
                        assetOut.push(full);
                    }
                }
            }
        }
    }

    // ── Parsers ────────────────────────────────────────────────────────

    private parseAnimFile(filePath: string): UnityMethodRef[] {
        const content = fs.readFileSync(filePath, 'utf-8');
        if (!content.includes('functionName:')) return [];

        const lines = content.split('\n');
        const fileName = path.basename(filePath);
        const animName = path.basename(filePath, '.anim');
        const results: UnityMethodRef[] = [];

        for (let i = 0; i < lines.length; i++) {
            const m = lines[i].match(/^\s+functionName:\s*(\w+)/);
            if (m) {
                results.push({
                    filePath,
                    fileName,
                    lineNumber: i,
                    methodName: m[1],
                    eventName: 'Animation Event',
                    gameObjectName: animName,
                    ownerGameObjectFileID: '0',
                    kind: 'animEvent',
                });
            }
        }
        return results;
    }

    private parseUnityYamlFile(
        filePath: string,
        showComponentUsages: boolean
    ): { methods: UnityMethodRef[]; components: UnityComponentRef[] } {
        const content = fs.readFileSync(filePath, 'utf-8');
        const hasMethod = content.includes('m_MethodName:');
        const hasScript = showComponentUsages && content.includes('m_Script: {fileID: 11500000, guid:');

        if (!hasMethod && !hasScript) {
            return { methods: [], components: [] };
        }

        const lines = content.split('\n');
        const fileName = path.basename(filePath);
        const methodRefs: UnityMethodRef[] = [];
        const componentRefs: UnityComponentRef[] = [];
        const objects = new Map<string, ObjectInfo>();
        // Maps target fileID inside a PrefabInstance modification to its overridden m_Name
        const modifiedNames = new Map<string, string>();

        let curBlockID = '';
        let curBlockType = '';
        let modTargetID = '';
        let waitingForModNameValue = false;

        // Pass 1: index object blocks (GameObjects, Transforms, PrefabInstances, and Components)
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const hdr = line.match(/^--- !u!(\d+) &(\d+)(\s+stripped)?/);
            if (hdr) {
                curBlockType = hdr[1];
                curBlockID = hdr[2];
                const isStripped = Boolean(hdr[3]);
                objects.set(curBlockID, { type: curBlockType, isStripped, lineNumber: i });
                modTargetID = '';
                waitingForModNameValue = false;
                continue;
            }
            if (!curBlockID) continue;

            const obj = objects.get(curBlockID)!;

            // Handle PrefabInstance (type 1001) m_Modifications to extract overridden GameObject names
            if (curBlockType === '1001') {
                const tgt = line.match(/^\s*-\s*target:\s*\{fileID:\s*(\d+)/);
                if (tgt) {
                    modTargetID = tgt[1];
                    waitingForModNameValue = false;
                    continue;
                }
                if (modTargetID && line.includes('propertyPath: m_Name')) {
                    waitingForModNameValue = true;
                    continue;
                }
                if (waitingForModNameValue) {
                    const val = line.match(/^\s+value:\s*(.+)/);
                    if (val) {
                        const extractedName = val[1].trim();
                        if (extractedName) {
                            modifiedNames.set(modTargetID, extractedName);
                            if (!obj.name) {
                                obj.name = extractedName;
                            }
                        }
                    }
                    waitingForModNameValue = false;
                    continue;
                }
            }

            const nm = line.match(/^\s+m_Name:\s*(.+)/);
            if (nm && !obj.name) {
                const trimmed = nm[1].trim();
                if (trimmed) obj.name = trimmed;
            }

            const go = line.match(/^\s+m_GameObject:\s*\{fileID:\s*(\d+)\}/);
            if (go && go[1] !== '0' && !obj.gameObjectFileID) {
                obj.gameObjectFileID = go[1];
            }

            const pf = line.match(/^\s+m_PrefabInstance:\s*\{fileID:\s*(\d+)\}/);
            if (pf && pf[1] !== '0' && !obj.prefabInstanceID) {
                obj.prefabInstanceID = pf[1];
            }

            const cs = line.match(/^\s+m_CorrespondingSourceObject:\s*\{fileID:\s*(\d+)/);
            if (cs && cs[1] !== '0' && !obj.correspondingSourceID) {
                obj.correspondingSourceID = cs[1];
            }

            if (hasScript) {
                const sc = line.match(/^\s+m_Script:\s*\{fileID:\s*11500000,\s*guid:\s*([a-f0-9]{32})/);
                if (sc && !obj.scriptGuid) {
                    obj.scriptGuid = sc[1];
                }
            }
        }

        // Helper to resolve GameObject name & fileIDs for any component/block
        const resolveOwnerInfo = (blockID: string): { goName: string; primaryFileID: string; altFileID?: string } => {
            const obj = objects.get(blockID);
            if (!obj) {
                return { goName: '?', primaryFileID: blockID };
            }

            let goName = '?';
            let primaryFileID = blockID;
            let altFileID: string | undefined;

            // Case 1: Block has a valid m_GameObject reference
            if (obj.gameObjectFileID && obj.gameObjectFileID !== '0') {
                primaryFileID = obj.gameObjectFileID;
                const goObj = objects.get(obj.gameObjectFileID);
                if (goObj) {
                    if (goObj.name) {
                        goName = goObj.name;
                    } else if (goObj.correspondingSourceID && modifiedNames.has(goObj.correspondingSourceID)) {
                        goName = modifiedNames.get(goObj.correspondingSourceID)!;
                    } else if (goObj.prefabInstanceID) {
                        const pfObj = objects.get(goObj.prefabInstanceID);
                        if (pfObj?.name) goName = pfObj.name;
                    }

                    if (goObj.correspondingSourceID) {
                        altFileID = goObj.correspondingSourceID;
                    } else if (goObj.prefabInstanceID) {
                        altFileID = goObj.prefabInstanceID;
                    }
                }
            }

            // Case 2: Stripped component belonging to a PrefabInstance (m_GameObject is 0)
            if (obj.isStripped || !obj.gameObjectFileID) {
                if (obj.correspondingSourceID) {
                    primaryFileID = obj.correspondingSourceID;
                    if (modifiedNames.has(obj.correspondingSourceID)) {
                        goName = modifiedNames.get(obj.correspondingSourceID)!;
                    }
                }
                if (obj.prefabInstanceID) {
                    altFileID = obj.prefabInstanceID;
                    if (goName === '?') {
                        const pfObj = objects.get(obj.prefabInstanceID);
                        if (pfObj?.name) {
                            goName = `${pfObj.name} (Prefab Instance)`;
                        }
                    }
                }
            }

            if (goName === '?' && obj.name) {
                goName = obj.name;
            }

            return { goName, primaryFileID, altFileID };
        };

        // Pass 2A: Resolve Component Usages
        if (hasScript) {
            for (const [blockID, obj] of objects.entries()) {
                if (obj.type === '114' && obj.scriptGuid) {
                    // Skip stripped MonoBehaviour stubs in scenes if they are just cross-reference handles
                    // OR resolve them accurately to their PrefabInstance!
                    const cls = this.guidMap.get(obj.scriptGuid);
                    if (cls) {
                        const resolved = resolveOwnerInfo(blockID);
                        componentRefs.push({
                            filePath,
                            fileName,
                            lineNumber: obj.lineNumber,
                            className: cls,
                            guid: obj.scriptGuid,
                            gameObjectName: resolved.goName,
                            ownerGameObjectFileID: resolved.primaryFileID,
                            altFileID: resolved.altFileID,
                            kind: 'component',
                        });
                    }
                }
            }
        }

        // Pass 2B: Resolve UnityEvent Method References
        if (hasMethod) {
            let eventName = '';
            let targetID = '';
            let className = '';
            let ownerBlockID = '';

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const hdr = line.match(/^--- !u!(\d+) &(\d+)/);
                if (hdr) {
                    ownerBlockID = hdr[2];
                    eventName = '';
                    targetID = '';
                    className = '';
                    continue;
                }

                const ev = line.match(/^\s{4,}(m_\w+|on\w+):\s*$/);
                if (ev) {
                    eventName = ev[1];
                    continue;
                }

                const tgt = line.match(/^\s+- m_Target:\s*\{fileID:\s*(\d+)\}/);
                if (tgt) {
                    targetID = tgt[1];
                    className = '';
                    continue;
                }

                const cls = line.match(/m_TargetAssemblyTypeName:\s*([\w.]+)/);
                if (cls) {
                    className = cls[1];
                    continue;
                }

                const mtd = line.match(/^\s+m_MethodName:\s*(\w+)/);
                if (!mtd) continue;
                const methodName = mtd[1];

                // Resolve owner (the Button/component holding the UnityEvent)
                let resolved = ownerBlockID ? resolveOwnerInfo(ownerBlockID) : { goName: '?', primaryFileID: '0' };

                // Fallback: try target's GameObject if owner is a PrefabInstance modification without direct name
                if (resolved.goName === '?' && targetID && targetID !== '0') {
                    const targetResolved = resolveOwnerInfo(targetID);
                    if (targetResolved.goName !== '?') {
                        resolved = targetResolved;
                    }
                }

                methodRefs.push({
                    filePath,
                    fileName,
                    lineNumber: i,
                    methodName,
                    targetClassName: className,
                    eventName,
                    gameObjectName: resolved.goName,
                    ownerGameObjectFileID: resolved.primaryFileID,
                    altFileID: resolved.altFileID,
                    kind: 'unityEvent',
                });

                targetID = '';
                className = '';
            }
        }

        return { methods: methodRefs, components: componentRefs };
    }
}

// ── CodeLens Provider ─────────────────────────────────────────────────

class UnityRefCodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChange = new vscode.EventEmitter<void>();
    readonly onDidChangeCodeLenses = this._onDidChange.event;
    private decorationType: vscode.TextEditorDecorationType;

    constructor(private index: UnityRefIndex, extensionPath: string) {
        const iconUri = vscode.Uri.file(path.join(extensionPath, 'icons', 'unity-ref-color-v2.png'));
        this.decorationType = vscode.window.createTextEditorDecorationType({
            gutterIconPath: iconUri,
            gutterIconSize: 'contain',
        });
        index.onDidUpdate(() => this._onDidChange.fire());
    }

    dispose() {
        this.decorationType.dispose();
    }

    provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
        const config = vscode.workspace.getConfiguration('unitySceneRefs');
        if (!config.get<boolean>('enabled', true)) {
            this.updateEditorDecorations(doc, []);
            return [];
        }

        const text = doc.getText();
        const lenses: vscode.CodeLens[] = [];
        const decorationOptions: vscode.DecorationOptions[] = [];

        const fileScriptGuid = this.index.getGuidForScriptPath(doc.uri.fsPath);
        const fileBaseName = path.basename(doc.uri.fsPath, '.cs');

        // 1. Scan for Class declarations (Component Usages)
        const showComponentUsages = config.get<boolean>('showComponentUsages', true);
        const classRegex = /(?:public|internal|protected|private)?\s*(?:abstract|sealed|partial|static)?\s*class\s+(\w+)/g;
        let classMatch: RegExpExecArray | null;

        const classPositions: { name: string; index: number }[] = [];
        while ((classMatch = classRegex.exec(text)) !== null) {
            const className = classMatch[1];
            classPositions.push({ name: className, index: classMatch.index });

            if (showComponentUsages) {
                // Use exact script GUID if this class is the primary class of the .cs file
                const guidToUse = className === fileBaseName ? fileScriptGuid : undefined;
                const compRefs = this.index.lookupComponents(className, guidToUse);

                if (compRefs.length > 0) {
                    const pos = doc.positionAt(classMatch.index);
                    const range = new vscode.Range(pos, pos);
                    const title =
                        compRefs.length === 1
                            ? `$(unity-logo) $(link) 1 Unity usage (${compRefs[0].fileName} → ${compRefs[0].gameObjectName})`
                            : `$(unity-logo) $(link) ${compRefs.length} Unity usages`;

                    lenses.push(
                        new vscode.CodeLens(range, {
                            title,
                            command: 'unitySceneRefs.showComponentReferences',
                            arguments: [className, compRefs],
                        })
                    );
                    decorationOptions.push({
                        range,
                        hoverMessage: `Unity Scene References: ${compRefs.length} component usage(s) for ${className}`,
                    });
                }
            }
        }

        const getClassNameAt = (index: number): string => {
            let active = classPositions.length > 0 ? classPositions[0].name : '';
            for (const cp of classPositions) {
                if (cp.index <= index) active = cp.name;
                else break;
            }
            return active;
        };

        // 2. Scan for Method declarations (UnityEvents / Animation Events)
        const methodRegex =
            /(?:public|private|protected|internal)\s+(?:static\s+)?(?:override\s+)?(?:virtual\s+)?(?:async\s+)?\w[\w<>\[\],\s]*?\s+(\w+)\s*\(/g;
        let methodMatch: RegExpExecArray | null;

        while ((methodMatch = methodRegex.exec(text)) !== null) {
            const methodName = methodMatch[1];
            if (CS_KEYWORDS.has(methodName)) continue;

            const className = getClassNameAt(methodMatch.index);
            const refs = this.index.lookupMethods(className, methodName);
            if (refs.length === 0) continue;

            const pos = doc.positionAt(methodMatch.index);
            const range = new vscode.Range(pos, pos);

            const title =
                refs.length === 1
                    ? `$(unity-logo) $(link) 1 Unity ref (${refs[0].fileName} → ${refs[0].gameObjectName})`
                    : `$(unity-logo) $(link) ${refs.length} Unity refs`;

            lenses.push(
                new vscode.CodeLens(range, {
                    title,
                    command: 'unitySceneRefs.showReferences',
                    arguments: [refs, methodName, className],
                })
            );
            decorationOptions.push({
                range,
                hoverMessage: `Unity Scene References: ${refs.length} event reference(s) for ${className}.${methodName}`,
            });
        }

        this.updateEditorDecorations(doc, decorationOptions);
        return lenses;
    }

    private updateEditorDecorations(doc: vscode.TextDocument, decorations: vscode.DecorationOptions[]) {
        for (const editor of vscode.window.visibleTextEditors) {
            if (editor.document.uri.toString() === doc.uri.toString()) {
                editor.setDecorations(this.decorationType, decorations);
            }
        }
    }
}

// ── Commands ──────────────────────────────────────────────────────────

async function showReferences(refs: UnityMethodRef[], methodName: string, className: string) {
    if (!refs || refs.length === 0) {
        vscode.window.showInformationMessage(`No Unity references found for ${className}.${methodName}`);
        return;
    }

    const unityAlive = await pingUnity();
    const items = refs.map((r) => ({
        label: `$(unity-logo) ${r.fileName}`,
        description: `${r.eventName} → ${r.gameObjectName}`,
        detail: `Line ${r.lineNumber + 1}`,
        ref: r,
    }));

    if (refs.length === 1) {
        const ref = refs[0];
        if (unityAlive && ref.kind !== 'animEvent') {
            await openInUnity(ref.ownerGameObjectFileID, ref.filePath, ref.gameObjectName, ref.altFileID, undefined);
        } else {
            await openInEditor(ref.filePath, ref.lineNumber);
        }
        return;
    }

    const extraItems = unityAlive
        ? [{ label: '$(rocket) Open ALL in Unity (last selected)', description: '', detail: '', ref: null as any, isOpenAll: true }]
        : [];

    const allItems = [...items.map((i) => ({ ...i, isOpenAll: false })), ...extraItems];

    const picked = await vscode.window.showQuickPick(allItems, {
        title: `${className}.${methodName} — ${refs.length} Unity refs${unityAlive ? ' (Unity connected)' : ''}`,
        placeHolder: unityAlive ? 'Select to open and frame in Unity Editor' : 'Select to open asset file in editor',
    });

    if (!picked) return;

    if (picked.isOpenAll) {
        for (const r of refs) {
            await openInUnity(r.ownerGameObjectFileID, r.filePath, r.gameObjectName, r.altFileID, undefined);
        }
        return;
    }

    if (unityAlive && picked.ref.kind !== 'animEvent') {
        await openInUnity(
            picked.ref.ownerGameObjectFileID,
            picked.ref.filePath,
            picked.ref.gameObjectName,
            picked.ref.altFileID,
            undefined
        );
    } else {
        await openInEditor(picked.ref.filePath, picked.ref.lineNumber);
    }
}

async function showComponentReferences(className: string, refs: UnityComponentRef[]) {
    if (!refs || refs.length === 0) {
        vscode.window.showInformationMessage(`No Unity component usages found for ${className}`);
        return;
    }

    const unityAlive = await pingUnity();
    const items = refs.map((r) => ({
        label: `$(unity-logo) ${r.fileName}`,
        description: `GameObject: ${r.gameObjectName}`,
        detail: `Line ${r.lineNumber + 1} (${r.filePath})`,
        ref: r,
    }));

    if (refs.length === 1) {
        const ref = refs[0];
        if (unityAlive) {
            await openInUnity(ref.ownerGameObjectFileID, ref.filePath, ref.gameObjectName, ref.altFileID, ref.className);
        } else {
            await openInEditor(ref.filePath, ref.lineNumber);
        }
        return;
    }

    const picked = await vscode.window.showQuickPick(items, {
        title: `${className} — ${refs.length} Unity component usages${unityAlive ? ' (Unity connected)' : ''}`,
        placeHolder: unityAlive ? 'Select to inspect in Unity Editor' : 'Select to view asset file',
    });

    if (!picked) return;

    if (unityAlive) {
        await openInUnity(
            picked.ref.ownerGameObjectFileID,
            picked.ref.filePath,
            picked.ref.gameObjectName,
            picked.ref.altFileID,
            picked.ref.className
        );
    } else {
        await openInEditor(picked.ref.filePath, picked.ref.lineNumber);
    }
}

async function openInUnity(
    fileID: string,
    filePath: string,
    objectName: string,
    altFileID?: string,
    className?: string
) {
    const scenePath = getRelativeScenePath(filePath);
    const ok = await selectInUnity(fileID, scenePath, altFileID, className, objectName);
    if (ok) {
        vscode.window.showInformationMessage(`Selected '${objectName}' in Unity`);
    } else {
        vscode.window.showWarningMessage('Failed to select in Unity. Is Unity Editor running with UnitySceneRefsBridge / CursorBridge?');
        await openInEditor(filePath, 0);
    }
}

async function openInEditor(filePath: string, lineNumber: number) {
    const uri = vscode.Uri.file(filePath);
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc);
    const pos = new vscode.Position(lineNumber, 0);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    editor.selection = new vscode.Selection(pos, pos);
}

function getRelativeScenePath(filePath: string): string | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) return undefined;
    const rel = path.relative(folders[0].uri.fsPath, filePath);
    return rel.replace(/\\/g, '/');
}

// ── Helpers ───────────────────────────────────────────────────────────

function debounce(fn: () => void, ms: number) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(fn, ms);
    };
}

const CS_KEYWORDS = new Set([
    'if', 'else', 'for', 'foreach', 'while', 'do', 'switch', 'case',
    'return', 'new', 'throw', 'catch', 'try', 'finally', 'lock',
    'using', 'typeof', 'sizeof', 'nameof', 'default', 'checked', 'unchecked',
    'get', 'set', 'value', 'var', 'class', 'struct', 'interface', 'enum',
]);

// ── Activation ────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {
    log.appendLine(`Unity Scene References extension activated (v${context.extension.packageJSON.version})`);

    const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
    statusItem.command = 'unitySceneRefs.refresh';
    statusItem.text = '$(sync~spin) Unity Refs: Loading…';
    statusItem.tooltip = 'Click to refresh Unity scene reference index';
    statusItem.show();
    context.subscriptions.push(statusItem);

    const index = new UnityRefIndex(statusItem, context.storageUri?.fsPath);
    const codeLensProvider = new UnityRefCodeLensProvider(index, context.extensionPath);

    context.subscriptions.push(
        codeLensProvider,
        vscode.languages.registerCodeLensProvider({ language: 'csharp' }, codeLensProvider),
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor && editor.document.languageId === 'csharp') {
                codeLensProvider.provideCodeLenses(editor.document);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('unitySceneRefs.showReferences', showReferences)
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('unitySceneRefs.showComponentReferences', showComponentReferences)
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('unitySceneRefs.refresh', () => {
            log.appendLine('Manual refresh triggered');
            index.build();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('unitySceneRefs.clearCache', () => {
            index.clearCache();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('unitySceneRefs.showLog', () => log.show())
    );

    context.subscriptions.push(index);

    // Initial background incremental build + watcher
    index.build().then(() => index.startWatching());

    pingUnity().then((alive) => {
        if (alive) {
            log.appendLine('Unity Editor Bridge is connected');
            statusItem.tooltip = 'Unity connected — click to refresh index';
        } else {
            log.appendLine('Unity Editor Bridge not detected (will auto-detect on click)');
        }
    });
}

export function deactivate() {}
