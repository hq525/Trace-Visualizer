// Core parse-stage types (plan.md §5.2). Frames are ALWAYS normalized
// root-call → crash order, regardless of how the runtime printed them.
export function isExternalPythonPath(p) {
    return (p.includes("/site-packages/") ||
        p.includes("/dist-packages/") ||
        p.includes("/lib/python3.") ||
        p.startsWith("<"));
}
export function isExternalJsPath(p) {
    return (p.startsWith("node:") ||
        p.startsWith("internal/") ||
        p.includes("/node_modules/") ||
        p === "<anonymous>" ||
        p === "<elided>");
}
