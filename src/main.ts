import "./style.css";

// ── Constants ──────────────────────────────────────────────────────────────

const NIX_URL =
  "https://search.nixos.org/backend/latest-46-nixos-unstable/_search";
const NIX_AUTH = "Basic YVdWU0FMWHBadjpYOGdQSG56TDUyd0ZFZWt1eHNmUTljU2g=";
const BREW_FORMULA_URL = "https://formulae.brew.sh/api/formula.json";
const BREW_CASK_URL = "https://formulae.brew.sh/api/cask.json";
const ARM64_BOTTLE_KEYS = new Set([
  "arm64_sequoia",
  "arm64_sonoma",
  "arm64_ventura",
  "arm64_monterey",
  "arm64_big_sur",
]);

// ── Types ──────────────────────────────────────────────────────────────────

interface NixResult {
  attrName: string;
  version: string;
  description: string;
  homepage: string;
}

interface BrewResult {
  name: string;
  token: string;
  description: string;
  version: string;
  homepage: string;
  isCask: boolean;
  hasArm64: boolean;
}

// ── App state ──────────────────────────────────────────────────────────────

let brewData: BrewResult[] | null = null;
let brewFetchPromise: Promise<void> | null = null;
let darwinFilter = true;

// ── Theme ──────────────────────────────────────────────────────────────────

function applyTheme(theme: "dark" | "light" | null): void {
  if (theme) {
    document.documentElement.setAttribute("data-theme", theme);
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
}

function initTheme(): void {
  const saved = localStorage.getItem("theme") as "dark" | "light" | null;
  applyTheme(saved);
  updateThemeButton(
    saved ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
  );
}

function updateThemeButton(current: "dark" | "light"): void {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  btn.textContent = current === "dark" ? "☀︎" : "☽";
  btn.title = current === "dark" ? "Switch to light mode" : "Switch to dark mode";
}

function toggleTheme(): void {
  const current = document.documentElement.getAttribute("data-theme")
    ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = current === "dark" ? "light" : "dark";
  localStorage.setItem("theme", next);
  applyTheme(next);
  updateThemeButton(next);
}

// ── Homebrew loading ───────────────────────────────────────────────────────

function preloadBrew(): void {
  if (brewFetchPromise) return;
  brewFetchPromise = (async () => {
    const [fRes, cRes] = await Promise.all([
      fetch(BREW_FORMULA_URL),
      fetch(BREW_CASK_URL),
    ]);
    const [formulae, casks]: [any[], any[]] = await Promise.all([
      fRes.json(),
      cRes.json(),
    ]);
    brewData = [
      ...formulae.map((f: any) => ({
        name: f.name as string,
        token: f.name as string,
        description: (f.desc ?? "") as string,
        version: (f.versions?.stable ?? "") as string,
        homepage: (f.homepage ?? "") as string,
        isCask: false,
        hasArm64: f.bottle?.stable?.files
          ? Object.keys(f.bottle.stable.files).some((k) => ARM64_BOTTLE_KEYS.has(k))
          : true,
      })),
      ...casks.map((c: any) => ({
        name: (Array.isArray(c.name) ? c.name[0] : c.name) as string,
        token: c.token as string,
        description: (c.desc ?? "") as string,
        version: (c.version ?? "") as string,
        homepage: (c.homepage ?? "") as string,
        isCask: true,
        hasArm64: true, // casks run on arm64 via Rosetta
      })),
    ];
  })();
}

// ── Search ─────────────────────────────────────────────────────────────────

async function searchNix(query: string, aarch64Only: boolean): Promise<NixResult[]> {
  const body = {
    query: {
      bool: {
        must: [
          {
            bool: {
              should: [
                { term: { package_attr_name: { value: query, boost: 9 } } },
                {
                  multi_match: {
                    query,
                    fields: [
                      "package_attr_name^9",
                      "package_pname^6",
                      "package_description^1",
                    ],
                    type: "cross_fields",
                    operator: "and",
                    lenient: true,
                  },
                },
              ],
              minimum_should_match: 1,
            },
          },
        ],
        filter: aarch64Only
          ? [{ term: { package_platforms: "aarch64-darwin" } }]
          : [],
      },
    },
    size: 10,
  };

  const res = await fetch(NIX_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: NIX_AUTH },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`NixOS search failed: ${res.status}`);
  const data = await res.json();

  return data.hits.hits.map((hit: any) => {
    const s = hit._source;
    return {
      attrName: s.package_attr_name as string,
      version: (s.package_pversion ?? "") as string,
      description: (s.package_description ?? "") as string,
      homepage: (s.package_homepage ?? "") as string,
    };
  });
}

function filterBrew(query: string, aarch64Only: boolean): BrewResult[] {
  if (!brewData) return [];
  const q = query.toLowerCase();
  const score = (p: BrewResult) => {
    const t = p.token.toLowerCase();
    if (t === q) return 0;
    if (t.startsWith(q)) return 1;
    if (t.includes(q)) return 2;
    return 3;
  };
  return brewData
    .filter((p) => {
      if (aarch64Only && !p.hasArm64) return false;
      return (
        p.token.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => score(a) - score(b))
    .slice(0, 10);
}

// ── HTML helpers ───────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function faviconImg(homepage: string): string {
  if (!homepage) return "";
  try {
    const domain = new URL(homepage).hostname;
    const src = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
    return `<img class="pkg-favicon" src="${esc(src)}" alt="" aria-hidden="true" onerror="this.style.display='none'" />`;
  } catch {
    return "";
  }
}

function nixCard(pkg: NixResult): string {
  const cmd = `nix profile install nixpkgs#${pkg.attrName}`;
  return `
    <div class="card card-nix">
      <div class="card-top">
        <span class="badge badge-nix">
          <img src="/nix-icon.svg" class="badge-icon" alt="" aria-hidden="true" />
          nix
        </span>
        ${faviconImg(pkg.homepage)}
        <span class="pkg-name">${esc(pkg.attrName)}</span>
        ${pkg.version ? `<span class="pkg-version">${esc(pkg.version)}</span>` : ""}
      </div>
      ${pkg.description ? `<p class="pkg-desc">${esc(pkg.description)}</p>` : ""}
      <div class="install-row">
        <code class="install-cmd">${esc(cmd)}</code>
        <button class="copy-btn" data-cmd="${esc(cmd)}">copy</button>
      </div>
    </div>`;
}

function brewCard(pkg: BrewResult): string {
  const cmd = pkg.isCask
    ? `brew install --cask ${pkg.token}`
    : `brew install ${pkg.token}`;
  const label = pkg.isCask ? "cask" : "brew";
  return `
    <div class="card card-brew">
      <div class="card-top">
        <span class="badge badge-brew">
          <img src="/brew-icon.svg" class="badge-icon" alt="" aria-hidden="true" />
          ${label}
        </span>
        ${faviconImg(pkg.homepage)}
        <span class="pkg-name">${esc(pkg.name)}</span>
        ${pkg.version ? `<span class="pkg-version">${esc(pkg.version)}</span>` : ""}
      </div>
      ${pkg.description ? `<p class="pkg-desc">${esc(pkg.description)}</p>` : ""}
      <div class="install-row">
        <code class="install-cmd">${esc(cmd)}</code>
        <button class="copy-btn" data-cmd="${esc(cmd)}">copy</button>
      </div>
    </div>`;
}

// ── Render ─────────────────────────────────────────────────────────────────

function renderResults(
  nix: NixResult[] | null,
  brew: BrewResult[] | null,
  brewLoading: boolean,
  query: string
): void {
  const el = document.getElementById("results")!;

  if (nix === null && brew === null) {
    el.innerHTML = `<p class="status-msg">Searching…</p>`;
    return;
  }

  const parts: string[] = [];

  if (nix !== null) {
    if (nix.length === 0) {
      parts.push(
        `<p class="section-label">No Nix packages found for <em>${esc(query)}</em></p>`
      );
    } else {
      parts.push(`<div class="results-group">${nix.map(nixCard).join("")}</div>`);
    }
  }

  if (brewLoading) {
    parts.push(`<p class="status-msg brew-status">Loading Homebrew data…</p>`);
  } else if (brew !== null) {
    if (brew.length > 0) {
      parts.push(
        `<div class="results-group brew-section">${brew.map(brewCard).join("")}</div>`
      );
    } else if (nix !== null && nix.length === 0) {
      parts.push(`<p class="section-label">No Homebrew packages found either.</p>`);
    }
  }

  el.innerHTML =
    parts.join("") || `<p class="status-msg">No results found.</p>`;
}

// ── App shell ──────────────────────────────────────────────────────────────

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <header id="search-header">
    <div class="header-top">
      <h1 class="site-title">package finder</h1>
      <button id="theme-toggle" class="icon-btn" title="Toggle theme">☽</button>
    </div>
    <p class="site-subtitle">Search Nix and Homebrew packages in one place — Nix preferred</p>
    <div class="search-wrap">
      <input
        class="search-input"
        id="search"
        type="search"
        placeholder="Search packages… e.g. git, ffmpeg, ripgrep"
        autocomplete="off"
        spellcheck="false"
        autofocus
      />
    </div>
    <div class="filter-row">
      <button id="darwin-filter" class="filter-chip active" title="Only show packages with aarch64-darwin support">
        <span class="chip-dot"></span>
        aarch64-darwin
      </button>
    </div>
  </header>
  <main id="results">
    <p class="status-msg">Start typing to search packages</p>
  </main>
`;

// ── Wire up ────────────────────────────────────────────────────────────────

initTheme();
preloadBrew();

// Copy buttons (event delegation)
document.getElementById("results")!.addEventListener("click", (e) => {
  const btn = (e.target as Element).closest(".copy-btn") as HTMLButtonElement | null;
  if (!btn) return;
  const cmd = btn.dataset.cmd ?? "";
  navigator.clipboard.writeText(cmd).then(() => {
    const orig = btn.textContent;
    btn.textContent = "copied!";
    btn.classList.add("copied");
    setTimeout(() => {
      btn.textContent = orig;
      btn.classList.remove("copied");
    }, 1500);
  });
});

// Theme toggle
document.getElementById("theme-toggle")!.addEventListener("click", toggleTheme);

// Darwin filter toggle
const darwinBtn = document.getElementById("darwin-filter")!;
darwinBtn.addEventListener("click", () => {
  darwinFilter = !darwinFilter;
  darwinBtn.classList.toggle("active", darwinFilter);
  // Re-run current search with updated filter
  input.dispatchEvent(new Event("input"));
});

// Search
const input = document.getElementById("search") as HTMLInputElement;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let activeQuery = "";

input.addEventListener("input", () => {
  const query = input.value.trim();

  if (debounceTimer) clearTimeout(debounceTimer);

  if (!query) {
    activeQuery = "";
    document.getElementById("results")!.innerHTML =
      `<p class="status-msg">Start typing to search packages</p>`;
    return;
  }

  debounceTimer = setTimeout(async () => {
    activeQuery = query;
    const thisQuery = query;
    const thisFilter = darwinFilter;

    let nixResults: NixResult[] | null = null;
    let brewResults: BrewResult[] | null = null;

    renderResults(null, null, false, thisQuery);

    const nixPromise = searchNix(thisQuery, thisFilter).then((r) => {
      if (activeQuery !== thisQuery) return;
      nixResults = r;
      const brewStillLoading = brewFetchPromise !== null && brewData === null;
      renderResults(nixResults, brewResults, brewStillLoading, thisQuery);
    });

    const brewPromise = (async () => {
      if (brewFetchPromise) await brewFetchPromise;
      if (activeQuery !== thisQuery) return;
      brewResults = filterBrew(thisQuery, thisFilter);
      renderResults(nixResults, brewResults, false, thisQuery);
    })();

    await Promise.allSettled([nixPromise, brewPromise]);

    if (activeQuery === thisQuery) {
      renderResults(nixResults ?? [], brewResults ?? [], false, thisQuery);
    }
  }, 300);
});
