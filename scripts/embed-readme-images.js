// The extension Details page never shows relative image paths for a locally
// installed .vsix. Cursor accepts `data:` images, but VS Code (1.14x) strips every
// image src that is not http/https. This writes build/README.md with each local
// image rewritten to IMAGE_BASE_URL + path when that env var is set (works in all
// editors), otherwise inlined as a base64 data URI (Cursor only). Package with
// `vsce package --readme-path build/README.md`.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'build');
const baseUrl = (process.env.IMAGE_BASE_URL || '').replace(/\/+$/, '');
const mimeTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp' };

function toDataUri(src) {
    if (/^(https?:|data:)/i.test(src)) return src;
    if (baseUrl) return `${baseUrl}/${src.replace(/^\.\//, '')}`;
    const file = path.resolve(root, src);
    const mime = mimeTypes[path.extname(file).toLowerCase()];
    if (!mime || !fs.existsSync(file)) {
        console.warn(`[embed-readme-images] skipped: ${src}`);
        return src;
    }
    return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}

const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8')
    .replace(/(<img\b[^>]*?\bsrc=")([^"]+)(")/gi, (_, a, src, b) => a + toDataUri(src) + b)
    .replace(/(!\[[^\]]*\]\()([^)\s]+)/g, (_, a, src) => a + toDataUri(src));

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'README.md'), readme);
console.log(`[embed-readme-images] wrote build/README.md (${(readme.length / 1024).toFixed(0)} KB)`);
