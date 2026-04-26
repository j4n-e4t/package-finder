import {
  createLoader,
  createSerializer,
  parseAsBoolean,
  parseAsString,
  parseAsStringLiteral,
} from "nuqs";
import {
  brewTypeValues,
  hasPendingBrewLoad,
  preloadBrew,
  searchAppStore,
  searchBrew,
  searchNix,
  type AppStoreSearchResult,
  type BrewSearchResult,
  type BrewTypeFilter,
  type NixKind,
  type NixSearchResult,
} from "./package-search";
import "./style.css";

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

function ecosystemSection(
  icon: string,
  label: string,
  content: string,
  extraClass = "",
): string {
  return `
    <section class="ecosystem-section ${extraClass}">
      <div class="ecosystem-subheading">
        <img src="${esc(icon)}" class="ecosystem-subheading-icon" alt="" aria-hidden="true" />
        <h2 class="ecosystem-subheading-title">${esc(label)}</h2>
      </div>
      <div class="results-group">${content}</div>
    </section>
  `;
}

function nixCard(pkg: NixSearchResult): string {
  return `
    <article class="card card-nix card-clickable" data-url="${esc(pkg.openUrl)}" tabindex="0" role="link" aria-label="Open ${esc(pkg.name)} on Nix search">
      <div class="card-top">
        ${faviconImg(pkg.homepage)}
        <span class="pkg-name" title="${esc(pkg.name)}">${esc(pkg.name)}</span>
      </div>
      <p class="card-meta">${esc(nixKindLabel(pkg.kind))}</p>
      ${pkg.description ? `<p class="pkg-desc">${esc(pkg.description)}</p>` : ""}
      <div class="install-row">
        <code class="install-cmd">${esc(pkg.installCommand)}</code>
        <button class="copy-btn" data-cmd="${esc(pkg.installCommand)}" type="button">copy</button>
      </div>
    </article>`;
}

function brewCard(pkg: BrewSearchResult): string {
  return `
    <article class="card card-brew card-clickable" data-url="${esc(pkg.openUrl)}" tabindex="0" role="link" aria-label="Open ${esc(pkg.name)} on Homebrew">
      <div class="card-top">
        ${faviconImg(pkg.homepage)}
        <span class="pkg-name" title="${esc(pkg.name)}">${esc(pkg.name)}</span>
      </div>
      <p class="card-meta">${esc(pkg.brewType)}</p>
      ${pkg.description ? `<p class="pkg-desc">${esc(pkg.description)}</p>` : ""}
      <div class="install-row">
        <code class="install-cmd">${esc(pkg.installCommand)}</code>
        <button class="copy-btn" data-cmd="${esc(pkg.installCommand)}" type="button">copy</button>
      </div>
    </article>`;
}

function appStoreCard(pkg: AppStoreSearchResult): string {
  const desc = pkg.description.length > 150
    ? pkg.description.slice(0, 150).trimEnd() + "…"
    : pkg.description;
  return `
    <article class="card card-appstore card-clickable" data-url="${esc(pkg.openUrl)}" tabindex="0" role="link" aria-label="Open ${esc(pkg.name)} on App Store">
      <div class="card-top">
        ${pkg.icon
          ? `<img class="app-icon" src="${esc(pkg.icon)}" alt="" aria-hidden="true" onerror="this.style.display='none'" />`
          : ""}
        <span class="pkg-name-app" title="${esc(pkg.name)}">${esc(pkg.name)}</span>
      </div>
      <p class="card-meta">app store</p>
      ${pkg.sellerName ? `<p class="pkg-desc" style="font-size:12px;margin-bottom:4px;opacity:.7">${esc(pkg.sellerName)}</p>` : ""}
      ${desc ? `<p class="pkg-desc">${esc(desc)}</p>` : ""}
      <div class="install-row">
        <code class="install-cmd">${esc(pkg.installCommand)}</code>
        <button class="copy-btn" data-cmd="${esc(pkg.installCommand)}" type="button">copy</button>
      </div>
    </article>`;
}

function renderResults(
  nix: NixSearchResult[] | null,
  brew: BrewSearchResult[] | null,
  brewLoading: boolean,
  appStore: AppStoreSearchResult[] | null,
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
        parts.push(ecosystemSection("/nix-icon.svg", "Nix", nix.map(nixCard).join("")));
      }
    }
  }

  if (enabledStores.brew) {
    if (brewLoading) {
      parts.push(`<p class="status-msg brew-status">Loading Homebrew data…</p>`);
    } else if (brew !== null) {
      if (brew.length > 0) {
        parts.push(
          ecosystemSection("/brew-icon.svg", "Homebrew", brew.map(brewCard).join(""), "brew-section")
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
        ecosystemSection(
          "/app-store-icon.svg",
          "App Store",
          appStore.map(appStoreCard).join(""),
          "appstore-section"
        )
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

  let nixResults: NixSearchResult[] | null = enabledStores.nix ? null : [];
  let brewResults: BrewSearchResult[] | null = enabledStores.brew ? null : [];
  let appStoreResults: AppStoreSearchResult[] | null = enabledStores.appstore ? null : [];

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
    enabledStores.brew && hasPendingBrewLoad(),
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
        const brewStillLoading = enabledStores.brew && hasPendingBrewLoad();
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
      brewResults = await searchBrew(thisQuery, thisFilter, thisBrewType);
      if (activeQuery !== thisQuery) return;
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
      const brewStillLoading = enabledStores.brew && hasPendingBrewLoad();
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
