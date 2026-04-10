import axios from "axios";
import { pool } from "./db.ts";

interface Listing {
  id: string;
  company_name: string;
  title: string;
  url: string;
  locations: string[];
  terms: string[];
  active: boolean;
  date_posted: number;
}

const LISTINGS_URLS = [
  "https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/.github/scripts/listings.json",
  "https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/.github/scripts/listings-off-season.json",
];

const BLOCKED_KEYWORDS = ["us citizen", "clearance", "secret", "sponsorship"];

function getTargetRoles(): string[] {
  return (process.env.TARGET_ROLES ?? "data science,machine learning,AI,software engineer,product manager,ML,data engineer,quant")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function getTargetLocations(): string[] {
  return (process.env.TARGET_LOCATIONS ?? "Canada,Remote,Toronto,Waterloo,Vancouver,Ontario")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function matchesRole(title: string, roles: string[]): boolean {
  const lower = title.toLowerCase();
  return roles.some((r) => lower.includes(r));
}

function matchesLocation(locations: string[], targets: string[]): boolean {
  if (!locations || locations.length === 0) return true; // empty = assume open
  return locations.some((loc) => targets.some((t) => loc.toLowerCase().includes(t)));
}

function hasBlockedKeyword(title: string): boolean {
  const lower = title.toLowerCase();
  return BLOCKED_KEYWORDS.some((kw) => lower.includes(kw));
}

async function fetchListings(url: string): Promise<Listing[]> {
  console.log("[scraper] Fetching:", url);
  try {
    const res = await axios.get(url, { timeout: 20000 });
    console.log("[scraper] Status:", res.status, "for", url);
    if (res.status === 404) {
      console.warn("[scraper] 404 for", url, "— skipping");
      return [];
    }
    return res.data as Listing[];
  } catch (e: any) {
    console.warn("[scraper] Failed to fetch", url, "—", e.message);
    return [];
  }
}

async function getSeenIds(): Promise<Set<string>> {
  const res = await pool.query("SELECT id FROM seen_jobs");
  return new Set(res.rows.map((r: { id: string }) => r.id));
}

async function insertSeenJob(listing: Listing): Promise<void> {
  await pool.query(
    `INSERT INTO seen_jobs (id, company_name, title, url, locations, status)
     VALUES ($1, $2, $3, $4, $5, 'pending')
     ON CONFLICT (id) DO NOTHING`,
    [listing.id, listing.company_name, listing.title, listing.url, listing.locations ?? []]
  );
}

export async function scrapeNewListings(): Promise<Listing[]> {
  const roles = getTargetRoles();
  const locations = getTargetLocations();

  // Fetch all sources
  const allListings: Listing[] = [];
  for (const url of LISTINGS_URLS) {
    const batch = await fetchListings(url);
    allListings.push(...batch);
  }

  console.log("[scraper] Total fetched:", allListings.length);

  // Dedup against DB
  const seenIds = await getSeenIds();

  // Filter
  const filtered = allListings.filter((l) => {
    if (!l.active) return false;
    if (!matchesRole(l.title, roles)) return false;
    if (!matchesLocation(l.locations, locations)) return false;
    if (hasBlockedKeyword(l.title)) return false;
    if (seenIds.has(l.id)) return false;
    return true;
  });

  console.log("[scraper] New listings after filter:", filtered.length);

  // Insert new listings into DB
  for (const listing of filtered) {
    try {
      await insertSeenJob(listing);
    } catch (e: any) {
      console.warn("[scraper] Failed to insert job", listing.id, "—", e.message);
    }
  }

  return filtered;
}
