/**
 * Version source configuration for well-known software.
 * Maps software names to methods for fetching their latest version.
 */

export interface VersionSource {
  /** Display name */
  name: string;
  /** How to fetch the latest version */
  type: "github" | "json_api" | "adoptium";
  /** For github: "org/repo". For json_api: the URL. */
  source: string;
  /** Optional jq-like path to extract version from JSON response */
  versionPath?: string;
  /** Optional regex to clean the version tag (e.g., strip "v" prefix) */
  tagCleanRegex?: string;
}

/**
 * Well-known software → version sources.
 * Keys should match common `service_name` or `package_name` values.
 */
export const VERSION_SOURCES: Record<string, VersionSource> = {
  nginx: {
    name: "nginx",
    type: "github",
    source: "nginx/nginx",
    tagCleanRegex: "^release-",
  },
  nodejs: {
    name: "Node.js",
    type: "json_api",
    source: "https://nodejs.org/dist/index.json",
    versionPath: "first_lts_version",
  },
  postgresql: {
    name: "PostgreSQL",
    type: "github",
    source: "postgres/postgres",
    tagCleanRegex: "^REL_?",
  },
  mysql: {
    name: "MySQL",
    type: "github",
    source: "mysql/mysql-server",
    tagCleanRegex: "^mysql-",
  },
  redis: {
    name: "Redis",
    type: "github",
    source: "redis/redis",
  },
  tomcat: {
    name: "Apache Tomcat",
    type: "github",
    source: "apache/tomcat",
  },
  java: {
    name: "Java (OpenJDK)",
    type: "adoptium",
    source: "https://api.adoptium.net/v3/info/available_releases",
  },
};

/**
 * Fetch the latest version for a well-known software package.
 */
export async function fetchWellKnownVersion(
  key: string,
  fetchFn: (url: string) => Promise<unknown>
): Promise<{ version: string | null; cveIds: string[]; cveCount: number }> {
  const source = VERSION_SOURCES[key.toLowerCase()];
  if (!source) return { version: null, cveIds: [], cveCount: 0 };

  try {
    switch (source.type) {
      case "github":
        return await fetchGithubLatest(source, fetchFn);
      case "json_api":
        return await fetchJsonApi(source, fetchFn);
      case "adoptium":
        return await fetchAdoptium(source, fetchFn);
      default:
        return { version: null, cveIds: [], cveCount: 0 };
    }
  } catch {
    return { version: null, cveIds: [], cveCount: 0 };
  }
}

async function fetchGithubLatest(
  source: VersionSource,
  fetchFn: (url: string) => Promise<unknown>
): Promise<{ version: string | null; cveIds: string[]; cveCount: number }> {
  const url = `https://api.github.com/repos/${source.source}/releases/latest`;
  const data = (await fetchFn(url)) as { tag_name?: string } | null;

  if (!data?.tag_name) {
    // Fallback: try tags endpoint
    const tagsUrl = `https://api.github.com/repos/${source.source}/tags?per_page=1`;
    const tags = (await fetchFn(tagsUrl)) as Array<{ name: string }> | null;
    if (!tags || tags.length === 0) return { version: null, cveIds: [], cveCount: 0 };

    let version = tags[0].name;
    if (source.tagCleanRegex) {
      version = version.replace(new RegExp(source.tagCleanRegex), "");
    }
    version = version.replace(/^v/, "");
    return { version, cveIds: [], cveCount: 0 };
  }

  let version = data.tag_name;
  if (source.tagCleanRegex) {
    version = version.replace(new RegExp(source.tagCleanRegex), "");
  }
  version = version.replace(/^v/, "");
  return { version, cveIds: [], cveCount: 0 };
}

async function fetchJsonApi(
  source: VersionSource,
  fetchFn: (url: string) => Promise<unknown>
): Promise<{ version: string | null; cveIds: string[]; cveCount: number }> {
  const data = await fetchFn(source.source);

  // Node.js dist/index.json is an array; find the first LTS entry
  if (source.source.includes("nodejs.org")) {
    const entries = data as Array<{ version: string; lts: string | false }>;
    const lts = entries.find((e) => e.lts !== false);
    if (lts) {
      return { version: lts.version.replace(/^v/, ""), cveIds: [], cveCount: 0 };
    }
    // Fallback to latest
    if (entries.length > 0) {
      return { version: entries[0].version.replace(/^v/, ""), cveIds: [], cveCount: 0 };
    }
  }

  return { version: null, cveIds: [], cveCount: 0 };
}

async function fetchAdoptium(
  _source: VersionSource,
  fetchFn: (url: string) => Promise<unknown>
): Promise<{ version: string | null; cveIds: string[]; cveCount: number }> {
  const data = (await fetchFn(
    "https://api.adoptium.net/v3/info/available_releases"
  )) as {
    most_recent_lts?: number;
    available_lts_releases?: number[];
  } | null;

  if (data?.most_recent_lts) {
    return { version: String(data.most_recent_lts), cveIds: [], cveCount: 0 };
  }

  return { version: null, cveIds: [], cveCount: 0 };
}
