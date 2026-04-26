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

export const nixKinds = ["package", "option", "service"] as const;

export type NixKind = (typeof nixKinds)[number];

interface BaseSearchResult {
  name: string;
  description: string;
  installCommand: string;
  openUrl: string;
  icon: string;
  version: string;
}

export interface NixSearchResult extends BaseSearchResult {
  ecosystem: "nix";
  kind: NixKind;
  homepage: string;
}

export interface BrewSearchResult extends BaseSearchResult {
  ecosystem: "brew";
  brewType: "formula" | "cask";
  token: string;
  homepage: string;
  hasArm64: boolean;
}

export interface AppStoreSearchResult extends BaseSearchResult {
  ecosystem: "appstore";
  trackId: number;
  sellerName: string;
  formattedPrice: string;
}

export type PackageSearchResult =
  | NixSearchResult
  | BrewSearchResult
  | AppStoreSearchResult;

interface RawBrewResult {
  name: string;
  token: string;
  description: string;
  version: string;
  homepage: string;
  brewType: "formula" | "cask";
  hasArm64: boolean;
}

let brewData: RawBrewResult[] | null = null;
let brewFetchPromise: Promise<void> | null = null;

export function preloadBrew(): Promise<void> {
  if (brewFetchPromise) return brewFetchPromise;
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
        brewType: "formula" as const,
        hasArm64: f.bottle?.stable?.files
          ? Object.keys(f.bottle.stable.files).some((key) => ARM64_BOTTLE_KEYS.has(key))
          : true,
      })),
      ...casks.map((c: any) => ({
        name: (Array.isArray(c.name) ? c.name[0] : c.name) as string,
        token: c.token as string,
        description: (c.desc ?? "") as string,
        version: (c.version ?? "") as string,
        homepage: (c.homepage ?? "") as string,
        brewType: "cask" as const,
        hasArm64: true,
      })),
    ];
  })();
  return brewFetchPromise;
}

export function isBrewReady(): boolean {
  return brewData !== null;
}

export function hasPendingBrewLoad(): boolean {
  return brewFetchPromise !== null && brewData === null;
}

function nixPackageUrl(attrName: string, query: string): string {
  return `https://search.nixos.org/packages?channel=unstable&show=${encodeURIComponent(attrName)}&query=${encodeURIComponent(query)}`;
}

function nixOptionUrl(name: string): string {
  return `https://search.nixos.org/options?channel=unstable&query=${encodeURIComponent(name)}`;
}

function scoreName(name: string, query: string): number {
  const target = name.toLowerCase();
  const needle = query.toLowerCase();
  if (target === needle) return 0;
  if (target.startsWith(needle)) return 1;
  if (target.includes(needle)) return 2;
  return 3;
}

async function searchNixPackages(
  query: string,
  aarch64Only: boolean,
): Promise<NixSearchResult[]> {
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
    const source = hit._source;
    const name = (source.package_attr_name ?? "") as string;
    return {
      ecosystem: "nix" as const,
      kind: "package" as const,
      name,
      version: (source.package_pversion ?? "") as string,
      description: (source.package_description ?? "") as string,
      homepage: (source.package_homepage ?? "") as string,
      openUrl: nixPackageUrl(name, query),
      installCommand: `nix profile install nixpkgs#${name}`,
      icon: "/nix-icon.svg",
    };
  });
}

async function searchNixOptionsOrServices(
  query: string,
  kind: "option" | "service",
): Promise<NixSearchResult[]> {
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
    const source = hit._source;
    const name = (source.option_name ?? "") as string;
    return {
      ecosystem: "nix" as const,
      kind,
      name,
      version: "",
      description: (source.option_description ?? "") as string,
      homepage: "",
      openUrl: nixOptionUrl(name),
      installCommand: `nix search nixpkgs ${name}`,
      icon: "/nix-icon.svg",
    };
  });
}

export async function searchNix(
  query: string,
  aarch64Only: boolean,
  kinds: { package: boolean; option: boolean; service: boolean },
): Promise<NixSearchResult[]> {
  const tasks: Promise<NixSearchResult[]>[] = [];
  if (kinds.package) tasks.push(searchNixPackages(query, aarch64Only));
  if (kinds.option) tasks.push(searchNixOptionsOrServices(query, "option"));
  if (kinds.service) tasks.push(searchNixOptionsOrServices(query, "service"));
  if (tasks.length === 0) return [];

  const settled = await Promise.allSettled(tasks);
  const merged: NixSearchResult[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") merged.push(...result.value);
  }

  const kindRank: Record<NixKind, number> = { package: 0, option: 1, service: 2 };
  return merged
    .sort(
      (a, b) =>
        scoreName(a.name, query) - scoreName(b.name, query)
        || kindRank[a.kind] - kindRank[b.kind],
    )
    .slice(0, 10);
}

export async function searchBrew(
  query: string,
  aarch64Only: boolean,
): Promise<BrewSearchResult[]> {
  await preloadBrew();
  if (!brewData) return [];

  const needle = query.toLowerCase();
  const score = (pkg: RawBrewResult) => {
    const token = pkg.token.toLowerCase();
    if (token === needle) return 0;
    if (token.startsWith(needle)) return 1;
    if (token.includes(needle)) return 2;
    return 3;
  };

  return brewData
    .filter((pkg) => {
      if (aarch64Only && !pkg.hasArm64) return false;
      return (
        pkg.token.toLowerCase().includes(needle)
        || pkg.name.toLowerCase().includes(needle)
        || pkg.description.toLowerCase().includes(needle)
      );
    })
    .sort((a, b) => score(a) - score(b))
    .slice(0, 10)
    .map((pkg) => ({
      ecosystem: "brew" as const,
      name: pkg.name,
      description: pkg.description,
      installCommand:
        pkg.brewType === "cask"
          ? `brew install --cask ${pkg.token}`
          : `brew install ${pkg.token}`,
      openUrl: `https://formulae.brew.sh/${pkg.brewType}/${encodeURIComponent(pkg.token)}`,
      icon: "/brew-icon.svg",
      version: pkg.version,
      brewType: pkg.brewType,
      token: pkg.token,
      homepage: pkg.homepage,
      hasArm64: pkg.hasArm64,
    }));
}

export async function searchAppStore(query: string): Promise<AppStoreSearchResult[]> {
  const url = `${APPSTORE_SEARCH_URL}?term=${encodeURIComponent(query)}&entity=macSoftware&limit=5&country=us`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`App Store search failed: ${res.status}`);
  const data = await res.json();

  return (data.results as any[]).map((result) => ({
    ecosystem: "appstore" as const,
    trackId: result.trackId as number,
    name: result.trackName as string,
    sellerName: (result.sellerName ?? "") as string,
    description: (result.description ?? "") as string,
    version: (result.version ?? "") as string,
    openUrl: (result.trackViewUrl ?? "") as string,
    icon: (result.artworkUrl60 ?? result.artworkUrl100 ?? "/app-store-icon.svg") as string,
    installCommand: `mas install ${result.trackId as number}`,
    formattedPrice: (result.formattedPrice ?? "Free") as string,
  }));
}
