/**
 * Freightos API Client
 *
 * Client for the Freightos public shipping calculator API.
 * Provides freight rate quotes and estimates.
 * Includes rate limit tracking (100 calls/hour).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { homedir } from "os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Rate limit file location (cache dir, not tmpfs - this is operational data, not secrets)
const RATE_LIMIT_DIR = join(homedir(), ".cache", "freightos-shipment-manager");
const RATE_LIMIT_FILE = join(RATE_LIMIT_DIR, "ratelimit.json");

// Rate limit constants
const RATE_LIMIT = 100;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour in milliseconds
const RATE_LIMIT_WARNING_THRESHOLD = 80; // Warn at 80% usage

interface FreightosConfig {
  quoteApiUrl: string;
  webAppUrl: string;
  shipmentsUrl: string;
}

interface ConfigFile {
  freightos: FreightosConfig;
}

interface RateLimitData {
  calls: number[]; // Timestamps of API calls
}

export interface QuoteOptions {
  origin: string;
  destination: string;
  loadtype: string;
  weight: number;
  weightUnit?: string;
  width?: number;
  length?: number;
  height?: number;
  dimensionUnit?: string;
  volume?: number;
  volumeUnit?: string;
  quantity?: number;
  mode?: string;
  estimate?: boolean;
  hazCode?: string;
}

export interface PriceRange {
  amount: number;
  currency: string;
}

export interface TransitTimes {
  min: number;
  max: number;
  unit?: string;
}

export interface FreightRate {
  mode: string;
  minPrice: PriceRange;
  maxPrice: PriceRange;
  transitTimes: TransitTimes;
}

export interface RateLimitStatus {
  callsInLastHour: number;
  limit: number;
  remaining: number;
  percentUsed: number;
  resetsAt: Date | null;
  warning: string | null;
}

export interface QuoteResponse {
  estimatedFreightRates?: FreightRate[];
  numQuotes?: number;
  errors?: string[];
  origin?: string;
  destination?: string;
  rateLimit?: RateLimitStatus;
  rawResponse?: RawApiResponse;
}

// Raw API response interfaces (actual Freightos format)
interface RawMoneyAmount {
  amount: number;
  currency: string;
}

interface RawPrice {
  min: { moneyAmount: RawMoneyAmount };
  max: { moneyAmount: RawMoneyAmount };
}

interface RawModeData {
  mode: string;
  price: RawPrice;
  transitTimes: {
    unit: string;
    min: number;
    max: number;
  };
}

interface RawEstimatedFreightRates {
  mode: RawModeData | RawModeData[];
  numQuotes: number;
}

interface RawApiResponse {
  response: {
    _comment?: string[];
    estimatedFreightRates?: RawEstimatedFreightRates;
    errors?: string | { error: string }[];
  };
}

export class FreightosClient {
  private config: FreightosConfig;

  constructor() {
    // Try multiple locations for config.json:
    // 1. Same directory (when running tsx directly from scripts/)
    // 2. Parent directory (when running compiled from dist/)
    const possiblePaths = [
      join(__dirname, "config.json"),
      join(__dirname, "..", "config.json"),
    ];

    let configPath: string | null = null;
    for (const path of possiblePaths) {
      if (existsSync(path)) {
        configPath = path;
        break;
      }
    }

    if (!configPath) {
      throw new Error(`Config file not found. Tried: ${possiblePaths.join(", ")}`);
    }

    const configFile: ConfigFile = JSON.parse(readFileSync(configPath, "utf-8"));

    if (!configFile.freightos?.quoteApiUrl) {
      throw new Error("Missing required config in config.json: freightos.quoteApiUrl");
    }

    this.config = configFile.freightos;

    // Ensure rate limit directory exists
    if (!existsSync(RATE_LIMIT_DIR)) {
      mkdirSync(RATE_LIMIT_DIR, { recursive: true });
    }
  }

  // ============================================
  // RATE LIMITING
  // ============================================

  /** Load rate limit data from persistent file. */
  private loadRateLimitData(): RateLimitData {
    try {
      if (existsSync(RATE_LIMIT_FILE)) {
        const data = JSON.parse(readFileSync(RATE_LIMIT_FILE, "utf-8"));
        return { calls: data.calls || [] };
      }
    } catch {
      // If file is corrupted, start fresh
    }
    return { calls: [] };
  }

  /** Save rate limit data to persistent file. */
  private saveRateLimitData(data: RateLimitData): void {
    try {
      writeFileSync(RATE_LIMIT_FILE, JSON.stringify(data, null, 2));
    } catch {
      // Ignore write errors - rate limiting still works in memory
    }
  }

  /** Clean up old timestamps (older than 1 hour). */
  private cleanOldCalls(calls: number[]): number[] {
    const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
    return calls.filter((timestamp) => timestamp > cutoff);
  }

  /**
   * Gets current rate limit status.
   *
   * Tracks API calls locally (100 calls/hour limit).
   * Warning generated at 80% usage.
   *
   * @returns Rate limit info including remaining calls and reset time
   */
  getRateLimitStatus(): RateLimitStatus {
    const data = this.loadRateLimitData();
    const recentCalls = this.cleanOldCalls(data.calls);

    const callsInLastHour = recentCalls.length;
    const remaining = Math.max(0, RATE_LIMIT - callsInLastHour);
    const percentUsed = Math.round((callsInLastHour / RATE_LIMIT) * 100);

    // Find when the oldest call will expire (when we'll get a slot back)
    let resetsAt: Date | null = null;
    if (recentCalls.length > 0 && remaining === 0) {
      const oldestCall = Math.min(...recentCalls);
      resetsAt = new Date(oldestCall + RATE_LIMIT_WINDOW_MS);
    }

    // Generate warning message if needed
    let warning: string | null = null;
    if (callsInLastHour >= RATE_LIMIT) {
      warning = `RATE LIMIT REACHED: ${callsInLastHour}/${RATE_LIMIT} calls used. Wait until ${resetsAt?.toLocaleTimeString() || "unknown"} for more capacity.`;
    } else if (callsInLastHour >= RATE_LIMIT_WARNING_THRESHOLD) {
      warning = `Rate limit warning: ${callsInLastHour}/${RATE_LIMIT} calls used (${percentUsed}%). ${remaining} remaining this hour.`;
    }

    return {
      callsInLastHour,
      limit: RATE_LIMIT,
      remaining,
      percentUsed,
      resetsAt,
      warning,
    };
  }

  // ============================================
  // INTERNAL
  // ============================================

  /** Record an API call for rate limiting. */
  private recordCall(): void {
    const data = this.loadRateLimitData();
    const recentCalls = this.cleanOldCalls(data.calls);
    recentCalls.push(Date.now());
    this.saveRateLimitData({ calls: recentCalls });
  }

  /** Check if we can make an API call (under rate limit). */
  private checkRateLimit(): { allowed: boolean; status: RateLimitStatus } {
    const status = this.getRateLimitStatus();
    return {
      allowed: status.remaining > 0,
      status,
    };
  }

  /** Build URL parameters from quote options. */
  private buildParams(options: QuoteOptions): URLSearchParams {
    const params = new URLSearchParams();

    // Required parameters
    params.set("origin", options.origin);
    params.set("destination", options.destination);
    params.set("loadtype", options.loadtype);

    // Weight with optional unit
    if (options.weightUnit && options.weightUnit !== "kg") {
      params.set("weight", `${options.weight}${options.weightUnit}`);
    } else {
      params.set("weight", options.weight.toString());
    }

    // Dimensions
    if (options.width !== undefined) {
      const unit = options.dimensionUnit || "";
      params.set("width", `${options.width}${unit}`);
    }
    if (options.length !== undefined) {
      const unit = options.dimensionUnit || "";
      params.set("length", `${options.length}${unit}`);
    }
    if (options.height !== undefined) {
      const unit = options.dimensionUnit || "";
      params.set("height", `${options.height}${unit}`);
    }

    // Volume
    if (options.volume !== undefined) {
      const unit = options.volumeUnit || "";
      params.set("volume", `${options.volume}${unit}`);
    }

    // Optional parameters
    if (options.quantity !== undefined && options.quantity > 1) {
      params.set("quantity", options.quantity.toString());
    }
    if (options.mode) {
      params.set("mode", options.mode);
    }
    if (options.estimate) {
      params.set("estimate", "true");
    }
    if (options.hazCode) {
      params.set("hazCode", options.hazCode);
    }

    // Always request JSON
    params.set("format", "json");

    return params;
  }

  /** Transform raw API response to normalized format. */
  private transformResponse(raw: RawApiResponse): QuoteResponse {
    const result: QuoteResponse = {};

    // Check for errors - can be string or array of {error: string}
    if (raw.response.errors) {
      if (typeof raw.response.errors === "string") {
        result.errors = [raw.response.errors];
      } else if (Array.isArray(raw.response.errors) && raw.response.errors.length > 0) {
        result.errors = raw.response.errors.map((e) => e.error);
      }
      if (result.errors && result.errors.length > 0) {
        return result;
      }
    }

    // Transform freight rates
    if (raw.response.estimatedFreightRates) {
      const rates = raw.response.estimatedFreightRates;
      result.numQuotes = rates.numQuotes;

      // If no quotes available, return empty array
      if (!rates.mode || rates.numQuotes === 0) {
        result.estimatedFreightRates = [];
        return result;
      }

      // Mode can be a single object or an array
      const modeData = rates.mode;
      const modesArray = Array.isArray(modeData) ? modeData : [modeData];

      result.estimatedFreightRates = modesArray.map((m) => ({
        mode: m.mode,
        minPrice: {
          amount: m.price.min.moneyAmount.amount,
          currency: m.price.min.moneyAmount.currency,
        },
        maxPrice: {
          amount: m.price.max.moneyAmount.amount,
          currency: m.price.max.moneyAmount.currency,
        },
        transitTimes: {
          min: m.transitTimes.min,
          max: m.transitTimes.max,
          unit: m.transitTimes.unit,
        },
      }));
    }

    return result;
  }

  /** Make a request to the Freightos API with rate limit checking. */
  private async request(params: URLSearchParams): Promise<QuoteResponse> {
    // Check rate limit before making request
    const { allowed, status } = this.checkRateLimit();

    if (!allowed) {
      const error: QuoteResponse = {
        errors: [`Rate limit exceeded: ${status.callsInLastHour}/${status.limit} calls in the last hour. Try again at ${status.resetsAt?.toLocaleTimeString() || "later"}.`],
        rateLimit: status,
      };
      return error;
    }

    const url = `${this.config.quoteApiUrl}?${params.toString()}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    // Record the call after it's made
    this.recordCall();

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Freightos API error (${response.status}): ${errorText}`);
    }

    const rawData = (await response.json()) as RawApiResponse;

    // Transform to normalized format
    const data = this.transformResponse(rawData);

    // Add current rate limit status to response
    data.rateLimit = this.getRateLimitStatus();

    // Check for API-level errors in the response
    if (data.errors && data.errors.length > 0) {
      throw new Error(`Freightos API errors: ${data.errors.join(", ")}`);
    }

    return data;
  }

  // ============================================
  // QUOTE OPERATIONS
  // ============================================

  /**
   * Gets detailed freight rate quotes.
   *
   * @param options - Quote options
   * @param options.origin - Origin port/location code
   * @param options.destination - Destination port/location code
   * @param options.loadtype - Load type (e.g., "LCL", "FCL")
   * @param options.weight - Cargo weight
   * @param options.weightUnit - Weight unit (default: kg)
   * @param options.width - Cargo width (optional)
   * @param options.length - Cargo length (optional)
   * @param options.height - Cargo height (optional)
   * @param options.mode - Shipping mode (sea, air, truck)
   * @returns Quote response with rates and transit times
   *
   * @throws {Error} If rate limit exceeded or API error
   */
  async getQuote(options: QuoteOptions): Promise<QuoteResponse> {
    const params = this.buildParams(options);
    return this.request(params);
  }

  /**
   * Gets quick rate estimates (faster, less precise).
   *
   * @param options - Quote options (same as getQuote)
   * @returns Estimated quote response
   */
  async getQuoteEstimate(options: QuoteOptions): Promise<QuoteResponse> {
    const params = this.buildParams({ ...options, estimate: true });
    return this.request(params);
  }

  /**
   * Compares rates across all available shipping modes.
   *
   * @param options - Quote options (without mode - all modes returned)
   * @returns Quote response with multiple mode options
   */
  async compareRates(options: Omit<QuoteOptions, "mode">): Promise<QuoteResponse> {
    // Don't specify mode to get all available modes
    const params = this.buildParams(options as QuoteOptions);
    params.delete("mode");
    return this.request(params);
  }

  // ============================================
  // UTILITIES
  // ============================================

  /** Returns list of available CLI commands with descriptions. */
  getTools(): Array<{ name: string; description: string }> {
    return [
      { name: "get-quote", description: "Get detailed freight rate quotes" },
      { name: "get-estimate", description: "Get quick rate estimates (faster)" },
      { name: "compare-rates", description: "Compare rates across all shipping modes" },
      { name: "rate-limit", description: "Check current rate limit status" },
    ];
  }

  /**
   * Gets web app URLs for browser automation.
   *
   * @returns URLs for Freightos web interface
   */
  getWebUrls(): { webAppUrl: string; shipmentsUrl: string } {
    return {
      webAppUrl: this.config.webAppUrl,
      shipmentsUrl: this.config.shipmentsUrl,
    };
  }
}

export default FreightosClient;
