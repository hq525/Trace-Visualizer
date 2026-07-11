"""Phase 0 throwaway: differential sampler. Ground truth via Python `ast`:
for every function in the repo, sample up to 3 body-statement lines whose
innermost enclosing function is that function, and emit them as a synthetic
traceback. Feeding this through spike/resolve.mjs measures tree-sitter
resolution against the AST ground truth on real code.

Usage: python res_own_ast.py <repo_root> <out.txt>
"""
import ast
import pathlib
import sys

REPO = pathlib.Path(sys.argv[1]).resolve()
OUT = pathlib.Path(sys.argv[2])

FN_TYPES = (ast.FunctionDef, ast.AsyncFunctionDef)


def fn_spans(tree):
    spans = []
    for node in ast.walk(tree):
        if isinstance(node, FN_TYPES):
            spans.append((node.lineno, node.end_lineno, node.name, node))
    return spans


def innermost(spans, line):
    best = None
    for start, end, name, node in spans:
        if start <= line <= end:
            if best is None or start > best[0]:
                best = (start, end, name)
    return best


lines_out = ["Traceback (most recent call last):"]
count = 0
for py in sorted(REPO.rglob("*.py")):
    if any(part in {".venv", "node_modules", ".git"} for part in py.parts):
        continue
    try:
        tree = ast.parse(py.read_text())
    except SyntaxError:
        continue
    spans = fn_spans(tree)
    for start, end, name, node in spans:
        picked = 0
        for stmt in ast.walk(node):
            if picked >= 3:
                break
            if not isinstance(stmt, ast.stmt) or isinstance(stmt, FN_TYPES):
                continue
            line = stmt.lineno
            hit = innermost(spans, line)
            if hit and hit[2] == name and start <= line <= end:
                lines_out.append(f'  File "{py}", line {line}, in {name}')
                picked += 1
                count += 1

lines_out.append("SyntheticError: differential sampling complete")
OUT.write_text("\n".join(lines_out) + "\n")
print(f"sampled {count} frames across {REPO.name}")
