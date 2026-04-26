import {
  createLoader,
  createSerializer,
  parseAsBoolean,
  parseAsString,
  parseAsStringLiteral,
} from "nuqs";
import "./style.css";

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

const brewTypeValues = ["all", "formula", "cask"] as const;
const nixKinds = ["package", "option", "service"] as const;

type BrewTypeFilter = (typeof brewTypeValues)[number];
type NixKind = (typeof nixKinds)[number];

interface NixResult {
  kind: NixKind;
  name: string;
  version: string;
  description: string;
  homepage: string;
  url: string;
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

const searchStateParsers = {
  q: parseAsString.withDefault(""),
  darwin: parseAsBoolean.withDefault(true),
  brewType: parseAsStringLiteral(brewTypeValues).withDefault("all"),
  storeNix: parseAsBoolean.withDefault(true),
  storeBrew: parseAsBoolean.withDefault(true),
  storeAppStore: parseAsBoolean.withDefault(true),
  nixPackage: parseAsBoolean.withDefault(true),
  nixOption: parseAsBoolean.withDefault(true),
  nixService: parseAsBoolean.withDefault(true),
};

const loadSearchState = createLoader(searchStateParsers);
const serializeSearchState = createSerializer(searchStateParsers, {
  clearOnDefault: true,
});

let brewData: BrewResult[] | null = null;
let brewFetchPromise: Promise<void> | null = null;
let darwinFilter = true;
let brewTypeFilter: BrewTypeFilter = "all";
let storeFilters = {
  nix: true,
  brew: true,
  appstore: true,
};
let nixKindFilters = {
  package: true,
  option: true,
  service: true,
};
let activeQuery = "";

function readUrlState() {
  return loadSearchState(window.location.search);
}

function syncUrlState(query: string): void {
  const nextUrl = serializeSearchState(window.location.href, {
    q: query,
    darwin: darwinFilter,
    brewType: brewTypeFilter,
    storeNix: storeFilters.nix,
    storeBrew: storeFilters.brew,
    storeAppStore: storeFilters.appstore,
    nixPackage: nixKindFilters.package,
    nixOption: nixKindFilters.option,
    nixService: nixKindFilters.service,
  });
  history.replaceState(null, "", nextUrl);
}

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
        hasArm64: true,
      })),
    ];
  })();
}

function nixPackageUrl(attrName: string, query: string): string {
  return `https://search.nixos.org/packages?channel=unstable&show=${encodeURIComponent(attrName)}&query=${encodeURIComponent(query)}`;
}

function nixOptionUrl(name: string): string {
  return `https://search.nixos.org/options?channel=unstable&query=${encodeURIComponent(name)}`;
}

async function searchNixPackages(query: string, aarch64Only: boolean): Promise<NixResult[]> {
  const body = {
    query: {
      bool: {
        must: [
          { term: { type: "package" } },
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
  if (!res.ok) throw new Error(`NixOS package search failed: ${res.status}`);
  const data = await res.json();

  return data.hits.hits.map((hit: any) => {
    const s = hit._source;
    const name = (s.package_attr_name ?? "") as string;
    return {
      kind: "package" as const,
      name,
      version: (s.package_pversion ?? "") as string,
      description: (s.package_description ?? "") as string,
      homepage: (s.package_homepage ?? "") as string,
      url: nixPackageUrl(name, query),
    };
  });
}

async function searchNixOptionsOrServices(query: string, kind: "option" | "service"): Promise<NixResult[]> {
  const body = {
    query: {
      bool: {
        must: [
          { term: { type: kind } },
          {
            bool: {
              should: [
                { term: { option_name: { value: query, boost: 9 } } },
                {
                  multi_match: {
                    query,
                    fields: ["option_name^8", "option_description^2", "option_source"],
                    type: "best_fields",
                    operator: "and",
                    lenient: true,
                  },
                },
              ],
              minimum_should_match: 1,
            },
          },
        ],
      },
    },
    size: 8,
  };

  const res = await fetch(NIX_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: NIX_AUTH },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`NixOS ${kind} search failed: ${res.status}`);
  const data = await res.json();

  return data.hits.hits.map((hit: any) => {
    const s = hit._source;
    const name = (s.option_name ?? "") as string;
    return {
      kind,
      name,
      version: "",
      description: (s.option_description ?? "") as string,
      homepage: "",
      url: nixOptionUrl(name),
    };
  });
}

function scoreName(name: string, query: string): number {
  const t = name.toLowerCase();
  const q = query.toLowerCase();
  if (t === q) return 0;
  if (t.startsWith(q)) return 1;
  if (t.includes(q)) return 2;
  return 3;
}

async function searchNix(
  query: string,
  aarch64Only: boolean,
  kinds: { package: boolean; option: boolean; service: boolean }
): Promise<NixResult[]> {
  const tasks: Promise<NixResult[]>[] = [];
  if (kinds.package) tasks.push(searchNixPackages(query, aarch64Only));
  if (kinds.option) tasks.push(searchNixOptionsOrServices(query, "option"));
  if (kinds.service) tasks.push(searchNixOptionsOrServices(query, "service"));
  if (tasks.length === 0) return [];

  const settled = await Promise.allSettled(tasks);
  const merged: NixResult[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") merged.push(...result.value);
  }
  const kindRank: Record<NixKind, number> = { package: 0, option: 1, service: 2 };
  return merged
    .sort((a, b) => scoreName(a.name, query) - scoreName(b.name, query) || kindRank[a.kind] - kindRank[b.kind])
    .slice(0, 10);
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

function nixKindLabel(kind: NixKind): string {
  if (kind === "package") return "nix package";
  if (kind === "option") return "nix option";
  return "nix service";
}

function nixCard(pkg: NixResult): string {
  const cmd = pkg.kind === "package"
    ? `nix profile install nixpkgs#${pkg.name}`
    : `nix search nixpkgs ${pkg.name}`;
  return `
    <article class="card card-nix card-clickable" data-url="${esc(pkg.url)}" tabindex="0" role="link" aria-label="Open ${esc(pkg.name)} on Nix search">
      <div class="card-top">
        ${faviconImg(pkg.homepage)}
        <span class="pkg-name" title="${esc(pkg.name)}">${esc(pkg.name)}</span>
        <span class="badge badge-nix">
          <img src="/nix-icon.svg" class="badge-icon" alt="" aria-hidden="true" />
          ${esc(nixKindLabel(pkg.kind))}
        </span>
        ${pkg.version ? `<span class="pkg-version">${esc(pkg.version)}</span>` : ""}
      </div>
      ${pkg.description ? `<p class="pkg-desc">${esc(pkg.description)}</p>` : ""}
      <div class="install-row">
        <code class="install-cmd">${esc(cmd)}</code>
        <button class="copy-btn" data-cmd="${esc(cmd)}" type="button">copy</button>
      </div>
    </article>`;
}

function brewUrl(pkg: BrewResult): string {
  const path = pkg.isCask ? "cask" : "formula";
  return `https://formulae.brew.sh/${path}/${encodeURIComponent(pkg.token)}`;
}

function brewCard(pkg: BrewResult): string {
  const cmd = pkg.isCask
    ? `brew install --cask ${pkg.token}`
    : `brew install ${pkg.token}`;
  const label = pkg.isCask ? "cask" : "brew";
  const url = brewUrl(pkg);
  return `
    <article class="card card-brew card-clickable" data-url="${esc(url)}" tabindex="0" role="link" aria-label="Open ${esc(pkg.name)} on Homebrew">
      <div class="card-top">
        ${faviconImg(pkg.homepage)}
        <span class="pkg-name" title="${esc(pkg.name)}">${esc(pkg.name)}</span>
        <span class="badge badge-brew">
          <img src="/brew-icon.svg" class="badge-icon" alt="" aria-hidden="true" />
          ${label}
        </span>
        ${pkg.version ? `<span class="pkg-version">${esc(pkg.version)}</span>` : ""}
      </div>
      ${pkg.description ? `<p class="pkg-desc">${esc(pkg.description)}</p>` : ""}
      <div class="install-row">
        <code class="install-cmd">${esc(cmd)}</code>
        <button class="copy-btn" data-cmd="${esc(cmd)}" type="button">copy</button>
      </div>
    </article>`;
}

function appStoreCard(pkg: AppStoreResult): string {
  const cmd = `mas install ${pkg.trackId}`;
  const desc = pkg.description.length > 150
    ? pkg.description.slice(0, 150).trimEnd() + "…"
    : pkg.description;
  return `
    <article class="card card-appstore card-clickable" data-url="${esc(pkg.trackViewUrl)}" tabindex="0" role="link" aria-label="Open ${esc(pkg.trackName)} on App Store">
      <div class="card-top">
        ${pkg.artworkUrl
          ? `<img class="app-icon" src="${esc(pkg.artworkUrl)}" alt="" aria-hidden="true" onerror="this.style.display='none'" />`
          : ""}
        <span class="pkg-name-app" title="${esc(pkg.trackName)}">${esc(pkg.trackName)}</span>
        <span class="badge badge-appstore">
          <img src="/app-store-icon.svg" class="badge-icon" alt="" aria-hidden="true" />
          app store
        </span>
        ${pkg.formattedPrice ? `<span class="pkg-price">${esc(pkg.formattedPrice)}</span>` : ""}
      </div>
      ${pkg.sellerName ? `<p class="pkg-desc" style="font-size:12px;margin-bottom:4px;opacity:.7">${esc(pkg.sellerName)}</p>` : ""}
      ${desc ? `<p class="pkg-desc">${esc(desc)}</p>` : ""}
      <div class="install-row">
        <code class="install-cmd">${esc(cmd)}</code>
        <button class="copy-btn" data-cmd="${esc(cmd)}" type="button">copy</button>
      </div>
    </article>`;
}

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

  if (!query) {
    el.innerHTML = `<p class="status-msg">Start typing to search packages</p>`;
    return;
  }

  if (nix === null && brew === null && appStore === null) {
    el.innerHTML = `<p class="status-msg">Searching…</p>`;
    return;
  }

  const parts: string[] = [];

  if (enabledStores.nix) {
    if (!nixKindFilters.package && !nixKindFilters.option && !nixKindFilters.service) {
      parts.push(`<p class="section-label">Select at least one Nix kind.</p>`);
    } else if (nix !== null) {
      if (nix.length === 0) {
        parts.push(
          `<p class="section-label">No Nix results found for <em>${esc(query)}</em></p>`
        );
      } else {
        parts.push(`<div class="results-group">${nix.map(nixCard).join("")}</div>`);
      }
    }
  }

  if (enabledStores.brew) {
    if (brewLoading) {
      parts.push(`<p class="status-msg brew-status">Loading Homebrew data…</p>`);
    } else if (brew !== null) {
      if (brew.length > 0) {
        parts.push(
          `<div class="results-group brew-section">${brew.map(brewCard).join("")}</div>`
        );
      } else if ((!enabledStores.nix || nix?.length === 0) && !enabledStores.appstore) {
        parts.push(`<p class="section-label">No Homebrew packages found either.</p>`);
      }
    }
  }

  if (enabledStores.appstore) {
    if (appStoreLoading) {
      parts.push(`<p class="status-msg brew-status">Searching App Store…</p>`);
    } else if (appStore !== null && appStore.length > 0) {
      parts.push(
        `<div class="results-group appstore-section">${appStore.map(appStoreCard).join("")}</div>`
      );
    }
  }

  if (!enabledStores.nix && !enabledStores.brew && !enabledStores.appstore) {
    el.innerHTML = `<p class="status-msg">Select at least one package store filter.</p>`;
    return;
  }

  el.innerHTML = parts.join("") || `<p class="status-msg">No results found.</p>`;
}

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <header id="search-header">
    <div class="header-top">
      <h1 class="site-title">package finder</h1>
      <button id="theme-toggle" class="icon-btn" title="Toggle theme" type="button">☽</button>
    </div>
    <p class="site-subtitle">Search Nix, Homebrew, and App Store packages in one place — Nix preferred</p>
    <div class="search-row">
      <div class="search-wrap">
        <input
          class="search-input"
          id="search"
          type="search"
          placeholder="Search packages… e.g. git, ffmpeg, ripgrep"
          autocomplete="off"
          spellcheck="false"
        />
      </div>
      <button id="filter-toggle" class="filter-toggle" type="button" aria-expanded="false" aria-controls="filter-panel">
        filters
      </button>
    </div>
    <section id="filter-panel" class="filter-panel compact-filter-panel" aria-label="Search filters" hidden>
      <div class="compact-row">
        <p class="filter-label">Store</p>
        <div class="filter-row store-filter-row">
          <button class="filter-chip compact-chip active" data-store="nix" type="button" aria-pressed="true">
            <img src="/nix-icon.svg" class="chip-icon" alt="" aria-hidden="true" />
            Nix
          </button>
          <button class="filter-chip compact-chip active" data-store="brew" type="button" aria-pressed="true">
            <img src="/brew-icon.svg" class="chip-icon" alt="" aria-hidden="true" />
            Homebrew
          </button>
          <button class="filter-chip compact-chip active" data-store="appstore" type="button" aria-pressed="true">
            <img src="/app-store-icon.svg" class="chip-icon" alt="" aria-hidden="true" />
            App Store
          </button>
        </div>
      </div>
      <div class="compact-row">
        <p class="filter-label">Platform</p>
        <div class="filter-row">
          <button id="darwin-filter" class="filter-chip compact-chip active" type="button" title="Only show packages with aarch64-darwin support">
            aarch64-darwin
          </button>
          <button id="all-platforms-filter" class="filter-chip compact-chip" type="button">
            all platforms
          </button>
        </div>
      </div>
      <div class="compact-row">
        <p class="filter-label">Homebrew type</p>
        <div class="filter-row">
          <button class="filter-chip compact-chip active brew-type-chip" data-brew-type="all" type="button" aria-pressed="true">
            all
          </button>
          <button class="filter-chip compact-chip brew-type-chip" data-brew-type="formula" type="button" aria-pressed="false">
            formula
          </button>
          <button class="filter-chip compact-chip brew-type-chip" data-brew-type="cask" type="button" aria-pressed="false">
            cask
          </button>
        </div>
      </div>
      <div class="compact-row">
        <p class="filter-label">Nix kinds</p>
        <div class="filter-row">
          <button class="filter-chip compact-chip active nix-kind-chip" data-nix-kind="package" type="button" aria-pressed="true">
            package
          </button>
          <button class="filter-chip compact-chip active nix-kind-chip" data-nix-kind="option" type="button" aria-pressed="true">
            option
          </button>
          <button class="filter-chip compact-chip active nix-kind-chip" data-nix-kind="service" type="button" aria-pressed="true">
            service
          </button>
        </div>
      </div>
      <div class="filter-actions">
        <button id="reset-filters" class="filter-reset" type="button">Reset</button>
      </div>
    </section>
  </header>
  <main id="results">
    <p class="status-msg">Start typing to search packages</p>
  </main>
`;

initTheme();
preloadBrew();

const input = document.getElementById("search") as HTMLInputElement;
const resultsEl = document.getElementById("results")!;
const filterPanel = document.getElementById("filter-panel") as HTMLElement;
const filterToggle = document.getElementById("filter-toggle") as HTMLButtonElement;
const darwinBtn = document.getElementById("darwin-filter")!;
const allPlatformsBtn = document.getElementById("all-platforms-filter")!;

function openExternal(url: string): void {
  if (!url) return;
  window.open(url, "_blank", "noopener,noreferrer");
}

resultsEl.addEventListener("click", (e) => {
  const target = e.target as Element;
  const btn = target.closest(".copy-btn") as HTMLButtonElement | null;
  if (btn) {
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
    return;
  }

  if (target.closest("a, button")) return;

  const card = target.closest(".card-clickable") as HTMLElement | null;
  if (!card) return;
  openExternal(card.dataset.url ?? "");
});

resultsEl.addEventListener("keydown", (e) => {
  const target = e.target as Element;
  const card = target.closest(".card-clickable") as HTMLElement | null;
  if (!card) return;
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    openExternal(card.dataset.url ?? "");
  }
});

document.getElementById("theme-toggle")!.addEventListener("click", toggleTheme);

document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    input.focus();
    input.select();
  }
});

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

function syncKindButtons(): void {
  document.querySelectorAll<HTMLButtonElement>(".nix-kind-chip").forEach((btn) => {
    const kind = btn.dataset.nixKind as keyof typeof nixKindFilters;
    const active = nixKindFilters[kind];
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", String(active));
    btn.disabled = !storeFilters.nix;
  });
}

function syncPlatformButtons(): void {
  darwinBtn.classList.toggle("active", darwinFilter);
  allPlatformsBtn.classList.toggle("active", !darwinFilter);
}

function syncFilterMenuState(): void {
  const isOpen = !filterPanel.hidden;
  filterToggle.setAttribute("aria-expanded", String(isOpen));
  filterToggle.classList.toggle("active", isOpen);
}

function setShellState(query: string): void {
  const hasQuery = query.length > 0;
  document.body.classList.toggle("query-empty", !hasQuery);
  if (!hasQuery) {
    filterPanel.hidden = true;
    syncFilterMenuState();
  }
}

function runSearch(query: string): void {
  activeQuery = query;
  const thisQuery = query;
  const thisFilter = darwinFilter;
  const thisBrewType = brewTypeFilter;
  const enabledStores = { ...storeFilters };
  const enabledKinds = { ...nixKindFilters };

  if (!enabledStores.nix && !enabledStores.brew && !enabledStores.appstore) {
    renderResults([], [], false, [], false, thisQuery, enabledStores);
    return;
  }

  let nixResults: NixResult[] | null = enabledStores.nix ? null : [];
  let brewResults: BrewResult[] | null = enabledStores.brew ? null : [];
  let appStoreResults: AppStoreResult[] | null = enabledStores.appstore ? null : [];

  if (
    enabledStores.nix
    && !enabledKinds.package
    && !enabledKinds.option
    && !enabledKinds.service
  ) {
    nixResults = [];
  }

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

  if (enabledStores.nix && nixResults === null) {
    tasks.push(
      searchNix(thisQuery, thisFilter, enabledKinds).then((r) => {
        if (activeQuery !== thisQuery) return;
        nixResults = r;
        const brewStillLoading = enabledStores.brew && brewFetchPromise !== null && brewData === null;
        renderResults(
          nixResults,
          brewResults,
          brewStillLoading,
          appStoreResults,
          appStoreResults === null,
          thisQuery,
          enabledStores
        );
      })
    );
  }

  if (enabledStores.brew) {
    tasks.push((async () => {
      if (brewFetchPromise) await brewFetchPromise;
      if (activeQuery !== thisQuery) return;
      brewResults = filterBrew(thisQuery, thisFilter, thisBrewType);
      renderResults(
        nixResults,
        brewResults,
        false,
        appStoreResults,
        appStoreResults === null,
        thisQuery,
        enabledStores
      );
    })());
  }

  if (enabledStores.appstore) {
    tasks.push((async () => {
      const r = await searchAppStore(thisQuery);
      if (activeQuery !== thisQuery) return;
      appStoreResults = r;
      const brewStillLoading = enabledStores.brew && brewFetchPromise !== null && brewData === null;
      renderResults(
        nixResults,
        brewResults,
        brewStillLoading,
        appStoreResults,
        false,
        thisQuery,
        enabledStores
      );
    })());
  }

  void Promise.allSettled(tasks).then(() => {
    if (activeQuery !== thisQuery) return;
    renderResults(
      nixResults ?? [],
      brewResults ?? [],
      false,
      appStoreResults ?? [],
      false,
      thisQuery,
      enabledStores
    );
  });
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function triggerSearch(query: string, debounce = true): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  if (!query) {
    activeQuery = "";
    renderResults([], [], false, [], false, "", { ...storeFilters });
    return;
  }
  if (!debounce) {
    runSearch(query);
    return;
  }
  debounceTimer = setTimeout(() => runSearch(query), 300);
}

function refreshSearch(): void {
  const query = input.value.trim();
  syncUrlState(query);
  setShellState(query);
  triggerSearch(query, false);
}

filterToggle.addEventListener("click", () => {
  if (document.body.classList.contains("query-empty")) return;
  filterPanel.hidden = !filterPanel.hidden;
  syncFilterMenuState();
});

document.getElementById("search-header")!.addEventListener("click", (e) => {
  const btn = (e.target as Element).closest("[data-store]") as HTMLButtonElement | null;
  if (!btn) return;
  const key = btn.dataset.store as keyof typeof storeFilters;
  storeFilters = { ...storeFilters, [key]: !storeFilters[key] };
  syncStoreButtons();
  syncBrewTypeButtons();
  syncKindButtons();
  refreshSearch();
});

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

document.querySelectorAll<HTMLButtonElement>(".nix-kind-chip").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!storeFilters.nix) return;
    const kind = btn.dataset.nixKind as keyof typeof nixKindFilters;
    nixKindFilters = { ...nixKindFilters, [kind]: !nixKindFilters[kind] };
    syncKindButtons();
    refreshSearch();
  });
});

document.getElementById("reset-filters")!.addEventListener("click", () => {
  darwinFilter = true;
  brewTypeFilter = "all";
  storeFilters = { nix: true, brew: true, appstore: true };
  nixKindFilters = { package: true, option: true, service: true };
  syncStoreButtons();
  syncBrewTypeButtons();
  syncKindButtons();
  syncPlatformButtons();
  refreshSearch();
});

input.addEventListener("input", () => {
  const query = input.value.trim();
  syncUrlState(query);
  setShellState(query);
  triggerSearch(query, true);
});

window.addEventListener("popstate", () => {
  const state = readUrlState();
  input.value = state.q;
  darwinFilter = state.darwin;
  brewTypeFilter = state.brewType;
  storeFilters = {
    nix: state.storeNix,
    brew: state.storeBrew,
    appstore: state.storeAppStore,
  };
  nixKindFilters = {
    package: state.nixPackage,
    option: state.nixOption,
    service: state.nixService,
  };
  syncStoreButtons();
  syncBrewTypeButtons();
  syncKindButtons();
  syncPlatformButtons();
  setShellState(state.q);
  triggerSearch(state.q, false);
});

const initialState = readUrlState();
input.value = initialState.q;
darwinFilter = initialState.darwin;
brewTypeFilter = initialState.brewType;
storeFilters = {
  nix: initialState.storeNix,
  brew: initialState.storeBrew,
  appstore: initialState.storeAppStore,
};
nixKindFilters = {
  package: initialState.nixPackage,
  option: initialState.nixOption,
  service: initialState.nixService,
};

syncStoreButtons();
syncBrewTypeButtons();
syncKindButtons();
syncPlatformButtons();
setShellState(initialState.q);
syncUrlState(initialState.q);
triggerSearch(initialState.q, false);
