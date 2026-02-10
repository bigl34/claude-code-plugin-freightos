#!/usr/bin/env npx tsx
/**
 * Freightos Shipment Manager CLI
 *
 * Zod-validated CLI for freight quotes and rate comparison.
 */

import { z, createCommand, runCli, cliTypes } from "@local/cli-utils";
import { FreightosClient, QuoteOptions, QuoteResponse, FreightRate, RateLimitStatus } from "./freightos-client.js";

// Helper to format rate limit status
function formatRateLimitStatus(status: RateLimitStatus): object {
  return {
    callsInLastHour: status.callsInLastHour,
    limit: status.limit,
    remaining: status.remaining,
    percentUsed: `${status.percentUsed}%`,
    resetsAt: status.resetsAt ? status.resetsAt.toISOString() : null,
    warning: status.warning,
    status: status.remaining > 20 ? "OK" : status.remaining > 0 ? "LOW" : "EXHAUSTED",
  };
}

// Helper to format quote response
function formatQuoteResponse(response: QuoteResponse): object {
  const formatted: {
    success: boolean;
    message?: string;
    origin?: string;
    destination?: string;
    rates?: Array<{
      mode: string;
      priceRange: string;
      transitTime: string;
      minPrice: { amount: number; currency: string };
      maxPrice: { amount: number; currency: string };
      transitDays: { min: number; max: number };
    }>;
    rateCount?: number;
    rateLimit?: object;
    errors?: string[];
  } = {
    success: true,
  };

  if (response.origin) formatted.origin = response.origin;
  if (response.destination) formatted.destination = response.destination;

  if (response.estimatedFreightRates && response.estimatedFreightRates.length > 0) {
    formatted.rates = response.estimatedFreightRates.map((rate: FreightRate) => ({
      mode: rate.mode,
      priceRange: `${rate.minPrice.currency} ${rate.minPrice.amount} - ${rate.maxPrice.amount}`,
      transitTime: `${rate.transitTimes.min} - ${rate.transitTimes.max} days`,
      minPrice: rate.minPrice,
      maxPrice: rate.maxPrice,
      transitDays: rate.transitTimes,
    }));
    formatted.rateCount = response.estimatedFreightRates.length;
  } else if (response.numQuotes === 0) {
    formatted.rateCount = 0;
    formatted.message = "No rates available for this route/cargo combination";
  }

  if (response.rateLimit) {
    formatted.rateLimit = formatRateLimitStatus(response.rateLimit);
  }

  if (response.errors && response.errors.length > 0) {
    formatted.success = false;
    formatted.errors = response.errors;
  }

  return formatted;
}

// Common quote options schema
const quoteOptionsSchema = z.object({
  origin: z.string().min(1).describe("Origin address, airport code (3-letter), or port code (5-letter)"),
  destination: z.string().min(1).describe("Destination address, airport code, or port code"),
  loadtype: z.string().min(1).describe("Load type: boxes, crate, pallets, container20, container40, container40HC, container45, container45HC"),
  weight: cliTypes.float(0.01).describe("Weight per unit (default: kg)"),
  weightUnit: z.enum(["kg", "lb", "ton", "oz"]).optional().describe("Weight unit (default: kg)"),
  width: cliTypes.float(0.01).optional().describe("Width (default: cm)"),
  length: cliTypes.float(0.01).optional().describe("Length (default: cm)"),
  height: cliTypes.float(0.01).optional().describe("Height (default: cm)"),
  dimensionUnit: z.enum(["cm", "inch", "m"]).optional().describe("Dimension unit (default: cm)"),
  volume: cliTypes.float(0.001).optional().describe("Volume (default: cbm)"),
  volumeUnit: z.enum(["cbm", "cft", "liter"]).optional().describe("Volume unit (default: cbm)"),
  quantity: cliTypes.int(1).optional().describe("Number of units (default: 1)"),
  mode: z.string().optional().describe("Shipping mode: air, LCL, FCL, LTL, FTL, express"),
  hazCode: z.string().optional().describe("UN hazard code for dangerous goods"),
});

// Define commands with Zod schemas
const commands = {
  "list-tools": createCommand(
    z.object({}),
    async (_args, client: FreightosClient) => ({
      tools: client.getTools(),
      webUrls: client.getWebUrls(),
      rateLimit: formatRateLimitStatus(client.getRateLimitStatus()),
    }),
    "List all available commands"
  ),

  "rate-limit": createCommand(
    z.object({}),
    async (_args, client: FreightosClient) => formatRateLimitStatus(client.getRateLimitStatus()),
    "Check current API rate limit status"
  ),

  "get-quote": createCommand(
    quoteOptionsSchema,
    async (args, client: FreightosClient) => {
      const quoteOptions: QuoteOptions = {
        origin: args.origin as string,
        destination: args.destination as string,
        loadtype: args.loadtype as string,
        weight: args.weight as number,
        weightUnit: args.weightUnit as string | undefined,
        width: args.width as number | undefined,
        length: args.length as number | undefined,
        height: args.height as number | undefined,
        dimensionUnit: args.dimensionUnit as string | undefined,
        volume: args.volume as number | undefined,
        volumeUnit: args.volumeUnit as string | undefined,
        quantity: args.quantity as number | undefined,
        mode: args.mode as string | undefined,
        hazCode: args.hazCode as string | undefined,
      };
      const response = await client.getQuote(quoteOptions);
      return formatQuoteResponse(response);
    },
    "Get detailed freight rate quotes"
  ),

  "get-estimate": createCommand(
    quoteOptionsSchema,
    async (args, client: FreightosClient) => {
      const quoteOptions: QuoteOptions = {
        origin: args.origin as string,
        destination: args.destination as string,
        loadtype: args.loadtype as string,
        weight: args.weight as number,
        weightUnit: args.weightUnit as string | undefined,
        width: args.width as number | undefined,
        length: args.length as number | undefined,
        height: args.height as number | undefined,
        dimensionUnit: args.dimensionUnit as string | undefined,
        volume: args.volume as number | undefined,
        volumeUnit: args.volumeUnit as string | undefined,
        quantity: args.quantity as number | undefined,
        mode: args.mode as string | undefined,
        hazCode: args.hazCode as string | undefined,
      };
      const response = await client.getQuoteEstimate(quoteOptions);
      return formatQuoteResponse(response);
    },
    "Get quick rate estimates (faster, less precise)"
  ),

  "compare-rates": createCommand(
    quoteOptionsSchema.omit({ mode: true }),
    async (args, client: FreightosClient) => {
      const quoteOptions: QuoteOptions = {
        origin: args.origin as string,
        destination: args.destination as string,
        loadtype: args.loadtype as string,
        weight: args.weight as number,
        weightUnit: args.weightUnit as string | undefined,
        width: args.width as number | undefined,
        length: args.length as number | undefined,
        height: args.height as number | undefined,
        dimensionUnit: args.dimensionUnit as string | undefined,
        volume: args.volume as number | undefined,
        volumeUnit: args.volumeUnit as string | undefined,
        quantity: args.quantity as number | undefined,
        hazCode: args.hazCode as string | undefined,
      };
      const response = await client.compareRates(quoteOptions);
      return formatQuoteResponse(response);
    },
    "Compare rates across all shipping modes"
  ),
};

// Run CLI
runCli(commands, FreightosClient, {
  programName: "freightos-cli",
  description: "Freightos freight quotes and rate comparison",
});
