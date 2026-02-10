<!-- AUTO-GENERATED README — DO NOT EDIT. Changes will be overwritten on next publish. -->
# claude-code-plugin-freightos

Freightos freight quotes (API) and booking/tracking (browser automation)

![Version](https://img.shields.io/badge/version-1.0.11-blue) ![License: MIT](https://img.shields.io/badge/License-MIT-green) ![Node >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)

## Features

- **get-quote** — Get detailed freight rate quotes with pricing and transit times
- **get-estimate** — Quick rate estimates (faster response, less precision)
- **compare-rates** — Compare rates across all shipping modes (air, LCL, FCL, express)
- **list-tools** — Show all available CLI commands

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI
- API credentials for the target service (see Configuration)

## Quick Start

```bash
git clone https://github.com/YOUR_GITHUB_USER/claude-code-plugin-freightos.git
cd claude-code-plugin-freightos
cp scripts/config.template.json scripts/config.json  # fill in your credentials
cd scripts && npm install
```

```bash
node scripts/dist/cli.js get-quote
```

## Installation

1. Clone this repository
2. Copy `scripts/config.template.json` to `scripts/config.json` and fill in your credentials
3. Install dependencies:
   ```bash
   cd scripts && npm install
   ```

## Configuration

Copy `scripts/config.template.json` to `scripts/config.json` and fill in the required values:

| Field | Placeholder |
|-------|-------------|
| `freightos.quoteApiUrl` | `https://ship.freightos.com/api/shippingCalculator` |
| `freightos.webAppUrl` | `https://ship.freightos.com` |
| `freightos.shipmentsUrl` | `https://ship.freightos.com/shipments` |

## Available Commands

| Command         | Description                                                      |
| --------------- | ---------------------------------------------------------------- |
| `get-quote`     | Get detailed freight rate quotes with pricing and transit times  |
| `get-estimate`  | Quick rate estimates (faster response, less precision)           |
| `compare-rates` | Compare rates across all shipping modes (air, LCL, FCL, express) |
| `list-tools`    | Show all available CLI commands                                  |

## Usage Examples

```bash
# FCL 40HC container quote: Ningbo to Southampton
npx tsx node scripts/dist/cli.js \
  get-quote --origin CNNGB --destination GBSOU --loadtype container40HC --weight 15000

# LCL pallets quote with dimensions
npx tsx node scripts/dist/cli.js \
  get-quote --origin CNNGB --destination GBSOU --loadtype pallets \
  --weight 500 --width 120 --length 100 --height 180 --quantity 6

# Compare all shipping modes
npx tsx node scripts/dist/cli.js \
  compare-rates --origin CNNGB --destination GBSOU --loadtype pallets --weight 2000

# Quick air freight estimate
npx tsx node scripts/dist/cli.js \
  get-estimate --origin CNSHA --destination LHR --loadtype boxes --weight 150 --mode air
```

## How It Works

This plugin connects directly to the service's HTTP API. The CLI handles authentication, request formatting, pagination, and error handling, returning structured JSON responses.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Authentication errors | Verify credentials in `config.json` |
| `ERR_MODULE_NOT_FOUND` | Run `cd scripts && npm install` |
| Rate limiting | The CLI handles retries automatically; wait and retry if persistent |
| Unexpected JSON output | Check API credentials haven't expired |

## Contributing

Issues and pull requests are welcome.

## License

MIT
