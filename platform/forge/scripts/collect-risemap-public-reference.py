#!/usr/bin/env python3
"""Archive public reference pages and statically extract their flow definitions.

Only fetch public pages and asset URLs explicitly referenced by fetched resources.
No login, business API calls, remote JavaScript execution, or source-map guessing.
"""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from hashlib import sha256
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen
import json
import re


ROOT = Path(__file__).resolve().parents[1]
STAMP = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
DEST = ROOT / "docs/references/risemap-public" / STAMP
COMMUNITY = "https://community.risemap.cn/"
APP = "https://risemap.cn/"


class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.skip = 0
        self.text = []
        self.refs = []

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.skip += 1
        attrs = dict(attrs)
        ref = attrs.get("href") or attrs.get("src")
        if tag in ("a", "script", "link") and ref:
            self.refs.append({"tag": tag, "url": ref})

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.skip = max(0, self.skip - 1)

    def handle_data(self, text):
        if not self.skip and text.strip():
            self.text.append(text.strip())


def fetch(url):
    request = Request(url, headers={"User-Agent": "Forge-PublicReference/1.0"})
    with urlopen(request, timeout=30) as response:
        body = response.read()
        return url, body, response.headers.get("Content-Type", "")


def save_resource(result, relative, discovered_from=None):
    url, body, content_type = result
    path = DEST / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body)
    return {
        "url": url, "path": relative, "bytes": len(body),
        "sha256": sha256(body).hexdigest(), "contentType": content_type,
        "discoveredFrom": discovered_from,
        "capturedAt": datetime.now(timezone.utc).isoformat(),
    }


class StaticDataParser:
    """Read a restricted literal grammar, including the observed a(zh,en) helper."""

    tokens = re.compile(r'''\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[A-Za-z_$][\w$]*|-?\d+(?:\.\d+)?|[{}\[\]:,()!])''')

    def __init__(self, source, offset):
        self.source = source
        self.offset = offset

    def token(self, consume=True):
        match = self.tokens.match(self.source, self.offset)
        if not match:
            raise ValueError(f"Unsupported syntax at offset {self.offset}")
        if consume:
            self.offset = match.end()
        return match.group(1)

    def expect(self, expected):
        actual = self.token()
        if actual != expected:
            raise ValueError(f"Expected {expected}, got {actual}")

    @staticmethod
    def string(token):
        escapes = {"n": "\n", "r": "\r", "t": "\t", "b": "\b", "f": "\f", "v": "\v", "0": "\0"}
        result = []
        i = 1
        while i < len(token) - 1:
            char = token[i]
            i += 1
            if char != "\\":
                result.append(char)
                continue
            char = token[i]
            i += 1
            if char in ("x", "u"):
                width = 2 if char == "x" else 4
                result.append(chr(int(token[i:i + width], 16)))
                i += width
            else:
                result.append(escapes.get(char, char))
        return "".join(result).encode("utf-16", "surrogatepass").decode("utf-16")

    def value(self):
        token = self.token()
        if token == "[":
            result = []
            while self.token(False) != "]":
                result.append(self.value())
                if self.token(False) != "]":
                    self.expect(",")
            self.expect("]")
            return result
        if token == "{":
            result = {}
            while self.token(False) != "}":
                key = self.token()
                key = self.string(key) if key[:1] in ('"', "'") else key
                self.expect(":")
                if key in result:
                    raise ValueError(f"Duplicate key: {key}")
                result[key] = self.value()
                if self.token(False) != "}":
                    self.expect(",")
            self.expect("}")
            return result
        if token[:1] in ('"', "'"):
            return self.string(token)
        if token == "a":
            self.expect("(")
            zh = self.value()
            self.expect(",")
            en = self.value()
            self.expect(")")
            if not isinstance(zh, str) or not isinstance(en, str):
                raise ValueError("Localization arguments must be strings")
            return {"zh": zh, "en": en}
        if token in ("true", "false", "null"):
            return {"true": True, "false": False, "null": None}[token]
        if token == "!":
            value = self.token()
            if value not in ("0", "1"):
                raise ValueError("Unsupported unary expression")
            return value == "0"
        if re.fullmatch(r"-?\d+(?:\.\d+)?", token):
            return float(token) if "." in token else int(token)
        raise ValueError(f"Unsupported identifier: {token}")


def dump(relative, value):
    path = DEST / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def main():
    DEST.mkdir(parents=True, exist_ok=False)
    manifest = []
    pages = {}
    urls = [urljoin(COMMUNITY, x) for x in ("", "docs", "tutorials", "flow", "changelog")] + [APP]
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(fetch, urls))
    for result in results:
        url, body, _ = result
        prefix = "app" if url == APP else "community"
        slug = urlparse(url).path.strip("/") or "home"
        manifest.append(save_resource(result, f"{prefix}/{slug}.html"))
        page = Page()
        page.feed(body.decode("utf-8"))
        pages[url] = page
        (DEST / prefix / f"{slug}.txt").write_text("\n".join(page.text) + "\n")
        dump(f"{prefix}/{slug}.links.json", page.refs)

    flow_page = urljoin(COMMUNITY, "flow")
    flow_ref = next(r["url"] for r in pages[flow_page].refs if r["tag"] == "script" and "/flow/page-" in r["url"])
    flow_url = urljoin(COMMUNITY, flow_ref)
    result = fetch(flow_url)
    manifest.append(save_resource(result, "community/flow-public-bundle.js", flow_page))
    source = result[1].decode("utf-8")
    match = re.search(r'\[\{id:"p2p",name:a\(', source)
    if match is None:
        raise ValueError("Observed flow-data marker has changed; inspect the new source")
    flows = StaticDataParser(source, match.start()).value()
    assert len({x["id"] for x in flows}) == len(flows)
    for flow in flows:
        assert flow.get("steps") and flow.get("lanes")
        assert all(0 <= step["lane"] < len(flow["lanes"]) for step in flow["steps"])
    dump("flows.json", {"sourceUrl": flow_url, "evidenceClass": "published-guide-not-runtime-proof", "flows": flows})

    app_ref = next(r["url"] for r in pages[APP].refs if r["tag"] == "script" and "/assets/index-" in r["url"])
    app_url = urljoin(APP, app_ref)
    result = fetch(app_url)
    manifest.append(save_resource(result, "app/entry-public-bundle.js", APP))
    entry = result[1].decode("utf-8")
    assets = list(dict.fromkeys(re.findall(r"assets/[\w.-]+\.(?:js|css)", entry)))
    dump("app/asset-index.json", {"sourceUrl": app_url, "referencedAssets": [urljoin(APP, x) for x in assets]})
    selected = [x for x in assets if re.match(r"assets/(?:taxPriceCalc-|ProjectList-|ProjectDetail-|TimesheetManagement-|ProjectSettingsCenter-|useQuotationData-)", x)]
    css = next(r["url"] for r in pages[APP].refs if r["tag"] == "link" and r["url"].endswith(".css"))
    selected_urls = [urljoin(APP, x) for x in selected] + [urljoin(APP, css)]
    bundle_summary = []
    with ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(fetch, selected_urls))
    for result in results:
        url, body, _ = result
        filename = urlparse(url).path.rsplit("/", 1)[-1]
        manifest.append(save_resource(result, f"app/assets/{filename}", app_url))
        text = body.decode("utf-8", errors="replace")
        bundle_summary.append({"file": filename, "bytes": len(body), "sourceMapReferences": re.findall(r"sourceMappingURL=([^\s]+)", text)[-3:]})

    summary = {
        "snapshot": str(DEST), "flowCount": len(flows),
        "stepCount": sum(len(x["steps"]) for x in flows),
        "flows": [{"id": x["id"], "title": x["name"]["zh"], "steps": len(x["steps"]), "example": x.get("example", False)} for x in flows],
        "referencedAssetCount": len(assets), "downloadedBusinessAssetSamples": bundle_summary,
        "entrySourceMapReferences": re.findall(r"sourceMappingURL=([^\s]+)", entry)[-3:],
        "scope": "Public reference snapshots; not original source, backend implementation, or proof of runtime behavior. Only entry and selected app assets downloaded.",
    }
    dump("manifest.json", {"resources": manifest})
    dump("summary.json", summary)
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
