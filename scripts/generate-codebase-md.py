#!/usr/bin/env python3
"""
Generate CODEBASE.md — a structured snapshot of every TypeScript module's
exports, imports, and role in the Next.js app. Designed to be read by Claude
at session start so it can skip the multi-minute codebase exploration.

Run: python3 scripts/generate-codebase-md.py
Output: CODEBASE.md in project root
"""

import os
import re
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = PROJECT_ROOT / "src"
PRISMA_SCHEMA = PROJECT_ROOT / "prisma" / "schema.prisma"
SERVER_FILE = PROJECT_ROOT / "server.ts"

# Directories/patterns to skip
SKIP_PATTERNS = {"__tests__", "node_modules", ".next", "test-setup", ".test."}


def classify_file(rel_path: str) -> str:
    """Classify a file by its role in the Next.js app."""
    parts = rel_path.split("/")
    name = parts[-1]

    if name == "route.ts":
        return "api-route"
    if name == "page.tsx":
        return "page"
    if name == "layout.tsx":
        return "layout"
    if name == "loading.tsx":
        return "loading"
    if name == "middleware.ts":
        return "middleware"
    if name.endswith("opengraph-image.tsx") or name in ("icon.tsx", "apple-icon.tsx"):
        return "meta"
    if name == "sitemap.ts" or name == "robots.ts":
        return "seo"
    if "components/" in rel_path:
        return "component"
    if "hooks/" in rel_path:
        return "hook"
    if "lib/" in rel_path:
        return "lib"
    if "types/" in rel_path:
        return "type"
    if "providers/" in rel_path:
        return "provider"
    return "other"


def get_route_path(rel_path: str) -> str:
    """Convert file path to Next.js route path."""
    # src/app/match/[matchId]/page.tsx -> /match/[matchId]
    # src/app/api/user/favorites/route.ts -> /api/user/favorites
    path = rel_path.replace("src/app/", "/").replace("/page.tsx", "").replace("/route.ts", "")
    path = path.replace("/layout.tsx", " (layout)")
    path = path.rstrip("/")
    return path if path else "/"


def parse_ts_file(path: Path) -> dict:
    """Extract exports, imports, and metadata from a TS/TSX file."""
    text = path.read_text(errors="replace")
    lines = text.splitlines()
    line_count = len(lines)
    rel_path = str(path.relative_to(PROJECT_ROOT))

    # First comment block as description
    desc = ""
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("//"):
            cleaned = stripped.lstrip("/ ").strip()
            if cleaned and cleaned != path.name:
                desc = cleaned
                break
        elif stripped.startswith("/**"):
            # JSDoc — grab first meaningful line
            for jline in lines[lines.index(line):]:
                jline = jline.strip()
                if jline.startswith("*") and not jline.startswith("/**") and not jline.startswith("*/"):
                    cleaned = jline.lstrip("* ").strip()
                    if cleaned:
                        desc = cleaned
                        break
            break
        elif stripped and not stripped.startswith("'use") and not stripped.startswith('"use'):
            break

    # Exports
    exports = []
    for i, line in enumerate(lines):
        stripped = line.strip()

        # export default function/class
        m = re.match(r"export\s+default\s+(?:async\s+)?function\s+(\w+)", stripped)
        if m:
            exports.append(f"default {m.group(1)} [L{i+1}]")
            continue

        # export async function / export function
        m = re.match(r"export\s+(async\s+)?function\s+(\w+)\s*[<(]", stripped)
        if m:
            async_prefix = "async " if m.group(1) else ""
            exports.append(f"{async_prefix}{m.group(2)}() [L{i+1}]")
            continue

        # export const/let (includes arrow functions)
        m = re.match(r"export\s+(?:const|let)\s+(\w+)", stripped)
        if m:
            exports.append(f"{m.group(1)} [L{i+1}]")
            continue

        # export type/interface/enum
        m = re.match(r"export\s+(?:type|interface|enum)\s+(\w+)", stripped)
        if m:
            exports.append(f"type {m.group(1)} [L{i+1}]")
            continue

        # export default (component assigned to variable earlier)
        if re.match(r"export\s+default\s+\w+", stripped) and "function" not in stripped:
            m = re.match(r"export\s+default\s+(\w+)", stripped)
            if m:
                exports.append(f"default {m.group(1)} [L{i+1}]")

    # API route methods (GET, POST, PUT, DELETE, PATCH)
    if path.name == "route.ts":
        for i, line in enumerate(lines):
            m = re.match(r"export\s+(?:async\s+)?function\s+(GET|POST|PUT|DELETE|PATCH)", line.strip())
            if m and f"default {m.group(1)}" not in [e.split(" [")[0] for e in exports]:
                # Already captured above, but flag it
                pass

    # Local imports (from ./ or ../ or src/)
    imports = []
    for line in lines:
        m = re.match(r"import\s+.*\s+from\s+['\"](\.[^'\"]+)['\"]", line.strip())
        if m:
            imports.append(m.group(1))
        # Also catch import type
        m = re.match(r"import\s+type\s+.*\s+from\s+['\"](\.[^'\"]+)['\"]", line.strip())
        if m and m.group(1) not in imports:
            imports.append(m.group(1))
        # @/ alias imports
        m = re.match(r"import\s+.*\s+from\s+['\"](@/[^'\"]+)['\"]", line.strip())
        if m:
            imports.append(m.group(1))

    # External package imports
    ext_packages = set()
    for line in lines:
        m = re.match(r"import\s+.*\s+from\s+['\"]([^.@/][^'\"]*)['\"]", line.strip())
        if m:
            pkg = m.group(1).split("/")[0]
            if pkg not in ("react", "next"):  # Skip ubiquitous ones
                ext_packages.add(pkg)

    # Prisma model usage
    prisma_models = sorted(set(re.findall(r"prisma\.(\w+)\.", text)))

    # Socket.io events
    socket_events = sorted(set(re.findall(r"(?:emit|on)\(['\"]([^'\"]+)['\"]", text)))

    role = classify_file(rel_path)

    return {
        "path": rel_path,
        "lines": line_count,
        "desc": desc,
        "role": role,
        "route": get_route_path(rel_path) if role in ("page", "api-route", "layout") else None,
        "exports": exports,
        "imports": imports,
        "ext_packages": sorted(ext_packages),
        "prisma_models": prisma_models,
        "socket_events": socket_events,
    }


def parse_prisma_schema(path: Path) -> list[dict]:
    """Extract model names and their fields from schema.prisma."""
    text = path.read_text()
    models = []
    current_model = None
    fields = []

    for line in text.splitlines():
        m = re.match(r"model\s+(\w+)\s*\{", line)
        if m:
            if current_model:
                models.append({"name": current_model, "fields": fields})
            current_model = m.group(1)
            fields = []
            continue

        if current_model and line.strip() == "}":
            models.append({"name": current_model, "fields": fields})
            current_model = None
            fields = []
            continue

        if current_model and line.strip() and not line.strip().startswith("//") and not line.strip().startswith("@@"):
            parts = line.strip().split()
            if len(parts) >= 2:
                fields.append(f"{parts[0]}: {parts[1]}")

    return models


def generate_markdown(modules: list, prisma_models: list) -> str:
    """Generate the CODEBASE.md content."""
    out = []
    out.append("# Codebase Snapshot")
    out.append("")
    out.append(f"Auto-generated by `scripts/generate-codebase-md.py` on {datetime.now().strftime('%Y-%m-%d %H:%M')}.")
    out.append("Do not edit manually — re-run the script after changes.")
    out.append("")

    # Group by role
    role_labels = {
        "page": "Pages",
        "layout": "Layouts",
        "api-route": "API Routes",
        "component": "Components",
        "lib": "Libraries",
        "hook": "Hooks",
        "type": "Types",
        "provider": "Providers",
        "meta": "Meta/OG Images",
        "seo": "SEO",
        "middleware": "Middleware",
        "loading": "Loading States",
        "other": "Other",
    }

    role_groups = {}
    for m in modules:
        role_groups.setdefault(m["role"], []).append(m)

    # Summary table
    out.append("## Overview")
    out.append("")
    total_lines = sum(m["lines"] for m in modules)
    out.append(f"**{len(modules)} source files, {total_lines:,} lines total**")
    out.append("")
    out.append("| Category | Files | Lines |")
    out.append("|----------|------:|------:|")
    for role, label in role_labels.items():
        if role in role_groups:
            files = role_groups[role]
            lines = sum(f["lines"] for f in files)
            out.append(f"| {label} | {len(files)} | {lines:,} |")
    out.append("")

    # Routes table
    pages = [m for m in modules if m["role"] == "page"]
    api_routes = [m for m in modules if m["role"] == "api-route"]

    if pages:
        out.append("## Routes")
        out.append("")
        out.append("| Route | File | Lines |")
        out.append("|-------|------|------:|")
        for m in sorted(pages, key=lambda x: x["route"] or ""):
            out.append(f"| `{m['route']}` | `{m['path']}` | {m['lines']} |")
        out.append("")

    if api_routes:
        out.append("## API Endpoints")
        out.append("")
        out.append("| Endpoint | Methods | File |")
        out.append("|----------|---------|------|")
        for m in sorted(api_routes, key=lambda x: x["route"] or ""):
            methods = [e.split(" [")[0] for e in m["exports"] if e.split(" [")[0] in ("GET", "POST", "PUT", "DELETE", "PATCH")]
            if not methods:
                methods = [e.split(" [")[0].replace("async ", "") for e in m["exports"]]
            out.append(f"| `{m['route']}` | {', '.join(methods)} | `{m['path']}` |")
        out.append("")

    # Import graph (local deps only)
    out.append("## Import Graph")
    out.append("")
    lib_modules = [m for m in modules if m["role"] in ("lib", "hook", "component", "provider")]
    for m in sorted(lib_modules, key=lambda x: x["path"]):
        local_imports = [i for i in m["imports"] if i.startswith(".") or i.startswith("@/")]
        if local_imports:
            name = Path(m["path"]).stem
            if name == "index":
                name = Path(m["path"]).parent.name
            deps = ", ".join(local_imports)
            out.append(f"- **{name}** (`{m['path']}`): {deps}")
    out.append("")

    # Module details by category
    out.append("## Module Details")
    out.append("")

    for role in role_labels:
        if role not in role_groups:
            continue
        if role in ("meta", "seo", "loading"):
            continue  # Skip trivial categories

        out.append(f"### {role_labels[role]}")
        out.append("")

        for m in sorted(role_groups[role], key=lambda x: x["path"]):
            header = f"`{m['path']}` ({m['lines']}L)"
            if m["route"]:
                header += f" — `{m['route']}`"
            out.append(f"#### {header}")
            if m["desc"]:
                out.append(f"_{m['desc']}_")
            out.append("")

            if m["exports"]:
                out.append("**Exports:** " + ", ".join(f"`{e}`" for e in m["exports"]))
                out.append("")

            if m["ext_packages"]:
                out.append("**Packages:** " + ", ".join(m["ext_packages"]))
                out.append("")

            if m["prisma_models"]:
                out.append("**Prisma:** " + ", ".join(f"`{p}`" for p in m["prisma_models"]))
                out.append("")

            if m["socket_events"]:
                out.append("**Socket events:** " + ", ".join(f"`{e}`" for e in m["socket_events"]))
                out.append("")

    # Prisma models
    if prisma_models:
        out.append("## Database Schema")
        out.append("")
        for model in prisma_models:
            out.append(f"### {model['name']}")
            for field in model["fields"]:
                out.append(f"- `{field}`")
            out.append("")

    return "\n".join(out)


def main():
    # Parse all TS/TSX files in src/ (excluding tests)
    modules = []
    for path in sorted(SRC_DIR.rglob("*")):
        if not path.suffix in (".ts", ".tsx"):
            continue
        rel = str(path.relative_to(PROJECT_ROOT))
        if any(skip in rel for skip in SKIP_PATTERNS):
            continue
        modules.append(parse_ts_file(path))

    # Also parse server.ts if it exists
    if SERVER_FILE.exists():
        modules.append(parse_ts_file(SERVER_FILE))

    # Parse Prisma schema
    prisma_models = []
    if PRISMA_SCHEMA.exists():
        prisma_models = parse_prisma_schema(PRISMA_SCHEMA)

    # Generate and write
    md = generate_markdown(modules, prisma_models)
    output = PROJECT_ROOT / "CODEBASE.md"
    output.write_text(md)
    print(f"Generated {output} ({len(md):,} bytes, {len(modules)} modules)")


if __name__ == "__main__":
    main()
