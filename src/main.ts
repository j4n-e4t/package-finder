import "./style.css";

// ── Constants ──────────────────────────────────────────────────────────────

const NIX_URL =
  "https://search.nixos.org/backend/latest-46-nixos-unstable/_search";
const NIX_AUTH = "Basic YVdWU0FMWHBadjpYOGdQSG56TDUyd0ZFZWt1eHNmUTljU2g=";
const BREW_FORMULA_URL = "https://formulae.brew.sh/api/formula.json";
const BREW_CASK_URL = "https://formulae.brew.sh/api/cask.json";
const APPSTORE_SEARCH_URL = "https://itunes.apple.com/search";
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

interface AppStoreResult {
  trackId: number;
  trackName: string;
  sellerName: string;
  description: string;
  version: string;
  trackViewUrl: string;
  artworkUrl: string;
  formattedPrice: string;
}

type BrewTypeFilter = "all" | "formula" | "cask";

// ── App state ──────────────────────────────────────────────────────────────

let brewData: BrewResult[] | null = null;
let brewFetchPromise: Promise<void> | null = null;
let darwinFilter = true;
let brewTypeFilter: BrewTypeFilter = "all";
let storeFilters = {
  nix: true,
  brew: true,
  appstore: true,
};

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

function filterBrew(query: string, aarch64Only: boolean, typeFilter: BrewTypeFilter): BrewResult[] {
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
      if (typeFilter === "formula" && p.isCask) return false;
      if (typeFilter === "cask" && !p.isCask) return false;
      return (
        p.token.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => score(a) - score(b))
    .slice(0, 10);
}

async function searchAppStore(query: string): Promise<AppStoreResult[]> {
  const url = `${APPSTORE_SEARCH_URL}?term=${encodeURIComponent(query)}&entity=macSoftware&limit=5&country=us`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`App Store search failed: ${res.status}`);
  const data = await res.json();
  return (data.results as any[]).map((r) => ({
    trackId: r.trackId as number,
    trackName: r.trackName as string,
    sellerName: (r.sellerName ?? "") as string,
    description: (r.description ?? "") as string,
    version: (r.version ?? "") as string,
    trackViewUrl: (r.trackViewUrl ?? "") as string,
    artworkUrl: (r.artworkUrl60 ?? r.artworkUrl100 ?? "") as string,
    formattedPrice: (r.formattedPrice ?? "Free") as string,
  }));
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

function appStoreCard(pkg: AppStoreResult): string {
  const cmd = `mas install ${pkg.trackId}`;
  const desc = pkg.description.length > 150
    ? pkg.description.slice(0, 150).trimEnd() + "…"
    : pkg.description;
  return `
    <div class="card card-appstore">
      <div class="card-top">
        <span class="badge badge-appstore">
          <img src="/app-store-icon.svg" class="badge-icon" alt="" aria-hidden="true" />
          app store
        </span>
        ${pkg.artworkUrl
          ? `<img class="app-icon" src="${esc(pkg.artworkUrl)}" alt="" aria-hidden="true" onerror="this.style.display='none'" />`
          : ""}
        <span class="pkg-name-app">${esc(pkg.trackName)}</span>
        ${pkg.formattedPrice ? `<span class="pkg-price">${esc(pkg.formattedPrice)}</span>` : ""}
      </div>
      ${pkg.sellerName ? `<p class="pkg-desc" style="font-size:12px;margin-bottom:4px;opacity:.7">${esc(pkg.sellerName)}</p>` : ""}
      ${desc ? `<p class="pkg-desc">${esc(desc)}</p>` : ""}
      <div class="install-row">
        <code class="install-cmd">${esc(cmd)}</code>
        <button class="copy-btn" data-cmd="${esc(cmd)}">copy</button>
        <a class="open-btn" href="${esc(pkg.trackViewUrl)}" target="_blank" rel="noopener noreferrer">open</a>
      </div>
    </div>`;
}

// ── Render ─────────────────────────────────────────────────────────────────

function renderResults(
  nix: NixResult[] | null,
  brew: BrewResult[] | null,
  brewLoading: boolean,
  appStore: AppStoreResult[] | null,
  appStoreLoading: boolean,
  query: string,
  enabledStores: { nix: boolean; brew: boolean; appstore: boolean }
): void {
  const el = document.getElementById("results")!;

  if (nix === null && brew === null && appStore === null) {
    el.innerHTML = `<p class="status-msg">Searching…</p>`;
    return;
  }

  const parts: string[] = [];

  if (!enabledStores.nix) {
    // no-op
  } else if (nix !== null) {
    if (nix.length === 0) {
      parts.push(
        `<p class="section-label">No Nix packages found for <em>${esc(query)}</em></p>`
      );
    } else {
      parts.push(`<div class="results-group">${nix.map(nixCard).join("")}</div>`);
    }
  }

  if (!enabledStores.brew) {
    // no-op
  } else if (brewLoading) {
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

  if (!enabledStores.appstore) {
    // no-op
  } else if (appStoreLoading) {
    parts.push(`<p class="status-msg brew-status">Searching App Store…</p>`);
  } else if (appStore !== null && appStore.length > 0) {
    parts.push(
      `<div class="results-group appstore-section">${appStore.map(appStoreCard).join("")}</div>`
    );
  }

  if (!enabledStores.nix && !enabledStores.brew && !enabledStores.appstore) {
    el.innerHTML = `<p class="status-msg">Select at least one package store filter.</p>`;
    return;
  }

  el.innerHTML = parts.join("") || `<p class="status-msg">No results found.</p>`;
}

// ── App shell ──────────────────────────────────────────────────────────────

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <header id="search-header">
    <div class="header-top">
      <h1 class="site-title">package finder</h1>
      <button id="theme-toggle" class="icon-btn" title="Toggle theme">☽</button>
    </div>
    <p class="site-subtitle">Search Nix, Homebrew, and App Store packages in one place — Nix preferred</p>
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
    <section class="filter-panel" aria-label="Search filters">
      <div class="filter-head">
        <p class="filter-title">Filters</p>
        <button id="reset-filters" class="filter-reset" type="button">Reset</button>
      </div>
      <div class="filter-grid">
        <div class="filter-group">
          <p class="filter-label">Package store</p>
          <div class="filter-row store-filter-row">
            <button class="filter-chip active" data-store="nix" type="button" aria-pressed="true">
              <span class="chip-dot"></span>
              Nix
            </button>
            <button class="filter-chip active" data-store="brew" type="button" aria-pressed="true">
              <span class="chip-dot"></span>
              Homebrew
            </button>
            <button class="filter-chip active" data-store="appstore" type="button" aria-pressed="true">
              <span class="chip-dot"></span>
              App Store
            </button>
          </div>
        </div>
        <div class="filter-group">
          <p class="filter-label">Platform</p>
          <div class="filter-row">
            <button id="darwin-filter" class="filter-chip active" type="button" title="Only show packages with aarch64-darwin support">
              <span class="chip-dot"></span>
              aarch64-darwin
            </button>
            <button id="all-platforms-filter" class="filter-chip" type="button">
              <span class="chip-dot"></span>
              all platforms
            </button>
          </div>
        </div>
        <div class="filter-group">
          <p class="filter-label">Homebrew type</p>
          <div class="filter-row">
            <button class="filter-chip active brew-type-chip" data-brew-type="all" type="button" aria-pressed="true">
              <span class="chip-dot"></span>
              all
            </button>
            <button class="filter-chip brew-type-chip" data-brew-type="formula" type="button" aria-pressed="false">
              <span class="chip-dot"></span>
              formula
            </button>
            <button class="filter-chip brew-type-chip" data-brew-type="cask" type="button" aria-pressed="false">
              <span class="chip-dot"></span>
              cask
            </button>
          </div>
        </div>
      </div>
    </section>
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

function syncStoreButtons(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-store]").forEach((btn) => {
    const key = btn.dataset.store as keyof typeof storeFilters;
    const active = storeFilters[key];
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", String(active));
  });
}

function syncBrewTypeButtons(): void {
  document.querySelectorAll<HTMLButtonElement>(".brew-type-chip").forEach((btn) => {
    const active = btn.dataset.brewType === brewTypeFilter;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", String(active));
    btn.disabled = !storeFilters.brew;
  });
}

function refreshSearch(): void {
  input.dispatchEvent(new Event("input"));
}

document.getElementById("search-header")!.addEventListener("click", (e) => {
  const btn = (e.target as Element).closest("[data-store]") as HTMLButtonElement | null;
  if (!btn) return;
  const key = btn.dataset.store as keyof typeof storeFilters;
  storeFilters = { ...storeFilters, [key]: !storeFilters[key] };
  syncStoreButtons();
  syncBrewTypeButtons();
  refreshSearch();
});

// Platform filter toggle
const darwinBtn = document.getElementById("darwin-filter")!;
const allPlatformsBtn = document.getElementById("all-platforms-filter")!;

function syncPlatformButtons(): void {
  darwinBtn.classList.toggle("active", darwinFilter);
  allPlatformsBtn.classList.toggle("active", !darwinFilter);
}

darwinBtn.addEventListener("click", () => {
  darwinFilter = true;
  syncPlatformButtons();
  refreshSearch();
});

allPlatformsBtn.addEventListener("click", () => {
  darwinFilter = false;
  syncPlatformButtons();
  refreshSearch();
});

document.querySelectorAll<HTMLButtonElement>(".brew-type-chip").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!storeFilters.brew) return;
    brewTypeFilter = btn.dataset.brewType as BrewTypeFilter;
    syncBrewTypeButtons();
    refreshSearch();
  });
});

document.getElementById("reset-filters")!.addEventListener("click", () => {
  darwinFilter = true;
  brewTypeFilter = "all";
  storeFilters = { nix: true, brew: true, appstore: true };
  syncStoreButtons();
  syncBrewTypeButtons();
  syncPlatformButtons();
  refreshSearch();
});

// Search
const input = document.getElementById("search") as HTMLInputElement;
syncStoreButtons();
syncBrewTypeButtons();
syncPlatformButtons();

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
    const thisBrewType = brewTypeFilter;
    const enabledStores = { ...storeFilters };

    if (!enabledStores.nix && !enabledStores.brew && !enabledStores.appstore) {
      renderResults([], [], false, [], false, thisQuery, enabledStores);
      return;
    }

    let nixResults: NixResult[] | null = enabledStores.nix ? null : [];
    let brewResults: BrewResult[] | null = enabledStores.brew ? null : [];
    let appStoreResults: AppStoreResult[] | null = enabledStores.appstore ? null : [];

    renderResults(
      nixResults,
      brewResults,
      enabledStores.brew && brewData === null,
      appStoreResults,
      enabledStores.appstore,
      thisQuery,
      enabledStores
    );

    const tasks: Promise<void>[] = [];

    if (enabledStores.nix) {
      tasks.push(
        searchNix(thisQuery, thisFilter).then((r) => {
          if (activeQuery !== thisQuery) return;
          nixResults = r;
          const brewStillLoading = enabledStores.brew && brewFetchPromise !== null && brewData === null;
          renderResults(nixResults, brewResults, brewStillLoading, appStoreResults, appStoreResults === null, thisQuery, enabledStores);
        })
      );
    }

    if (enabledStores.brew) {
      tasks.push((async () => {
        if (brewFetchPromise) await brewFetchPromise;
        if (activeQuery !== thisQuery) return;
        brewResults = filterBrew(thisQuery, thisFilter, thisBrewType);
        renderResults(nixResults, brewResults, false, appStoreResults, appStoreResults === null, thisQuery, enabledStores);
      })());
    }

    if (enabledStores.appstore) {
      tasks.push((async () => {
        const r = await searchAppStore(thisQuery);
        if (activeQuery !== thisQuery) return;
        appStoreResults = r;
        const brewStillLoading = enabledStores.brew && brewFetchPromise !== null && brewData === null;
        renderResults(nixResults, brewResults, brewStillLoading, appStoreResults, false, thisQuery, enabledStores);
      })());
    }

    await Promise.allSettled(tasks);

    if (activeQuery === thisQuery) {
      renderResults(
        nixResults ?? [],
        brewResults ?? [],
        false,
        appStoreResults ?? [],
        false,
        thisQuery,
        enabledStores
      );
    }
  }, 300);
});
