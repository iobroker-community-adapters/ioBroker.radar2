# ioBroker Adapter Development with GitHub Copilot

**Version:** 0.5.7  
**Template Source:** https://github.com/DrozmotiX/ioBroker-Copilot-Instructions

This file contains instructions and best practices for GitHub Copilot when working on ioBroker adapter development.

---

## 📑 Table of Contents

1. [Project Context](#project-context)
2. [Code Quality & Standards](#code-quality--standards)
   - [Code Style Guidelines](#code-style-guidelines)
   - [ESLint Configuration](#eslint-configuration)
3. [Testing](#testing)
   - [Unit Testing](#unit-testing)
   - [Integration Testing](#integration-testing)
   - [API Testing with Credentials](#api-testing-with-credentials)
4. [Development Best Practices](#development-best-practices)
   - [Dependency Management](#dependency-management)
   - [HTTP Client Libraries](#http-client-libraries)
   - [Error Handling](#error-handling)
5. [Admin UI Configuration](#admin-ui-configuration)
   - [JSON-Config Setup](#json-config-setup)
   - [Translation Management](#translation-management)
6. [Documentation](#documentation)
   - [README Updates](#readme-updates)
   - [Changelog Management](#changelog-management)
7. [CI/CD & GitHub Actions](#cicd--github-actions)
   - [Workflow Configuration](#workflow-configuration)
   - [Testing Integration](#testing-integration)
8. [ioBroker Development Patterns](#iobroker-development-patterns)
9. [External API Integration](#external-api-integration)
10. [Resource Management and Cleanup](#resource-management-and-cleanup)
11. [Performance and Optimization](#performance-and-optimization)
12. [Security Considerations](#security-considerations)

---

## Project Context

You are working on an ioBroker adapter. ioBroker is an integration platform for the Internet of Things, focused on building smart home and industrial IoT solutions. Adapters are plugins that connect ioBroker to external systems, devices, or services.

- **Adapter Name**: iobroker.radar2
- **Primary Function**: Radar2 to find status of IP, Bluetooth, UWZ, ECB and HP-Printers-devices
- **Repository**: iobroker-community-adapters/ioBroker.radar2
- **Key Features**: Network device scanning via ARP/ping, Bluetooth device discovery, Weather warnings (UWZ), European Central Bank currency rates, HP printer status monitoring
- **Main Dependencies**: @iobroker/adapter-core, axios, node-arp, node-ble, ping, xml2js
- **Architecture**: Uses custom fjadapter-core.js framework built on top of @iobroker/adapter-core
- **Scanning Methods**: ARP scan for IP devices, Bluetooth scanning for BT devices, HTTP APIs for external services
- **Configuration**: Complex device list with IP addresses, MAC addresses, Bluetooth addresses per device entry

---

## Code Quality & Standards

### Code Style Guidelines

- Follow JavaScript/TypeScript best practices
- Use async/await for asynchronous operations
- Implement proper resource cleanup in `unload()` method
- Use semantic versioning for adapter releases
- Include proper JSDoc comments for public methods

**Timer and Resource Cleanup Example:**
```javascript
private connectionTimer?: NodeJS.Timeout;

async onReady() {
  this.connectionTimer = setInterval(() => this.checkConnection(), 30000);
}

onUnload(callback) {
  try {
    if (this.connectionTimer) {
      clearInterval(this.connectionTimer);
      this.connectionTimer = undefined;
    }
    callback();
  } catch (e) {
    callback();
  }
}
```

### ESLint Configuration

**CRITICAL:** ESLint validation must run FIRST in your CI/CD pipeline, before any other tests. This "lint-first" approach catches code quality issues early.

#### Setup
```bash
npm install --save-dev eslint @iobroker/eslint-config
```

#### Configuration (.eslintrc.json)
```json
{
  "extends": "@iobroker/eslint-config",
  "rules": {
    // Add project-specific rule overrides here if needed
  }
}
```

#### Package.json Scripts
```json
{
  "scripts": {
    "lint": "eslint --max-warnings 0 .",
    "lint:fix": "eslint . --fix"
  }
}
```

#### Best Practices
1. ✅ Run ESLint before committing — fix ALL warnings, not just errors
2. ✅ Use `lint:fix` for auto-fixable issues
3. ✅ Don't disable rules without documentation
4. ✅ Lint all relevant files (main code, tests, build scripts)
5. ✅ Keep `@iobroker/eslint-config` up to date
6. ✅ **ESLint warnings are treated as errors in CI** (`--max-warnings 0`). The `lint` script above already includes this flag — run `npm run lint` to match CI behavior locally

#### Common Issues
- **Unused variables**: Remove or prefix with underscore (`_variable`)
- **Missing semicolons**: Run `npm run lint:fix`
- **Indentation**: Use 4 spaces (ioBroker standard)
- **console.log**: Replace with `adapter.log.debug()` or remove

---

## Testing

### Unit Testing

- Use Jest as the primary testing framework for ioBroker adapters
- Create tests for all adapter main functions and helper methods
- Test error handling scenarios and edge cases
- Mock external API calls and hardware dependencies
- For adapters connecting to APIs/devices not reachable by internet, provide example data files to allow testing of functionality without live connections

**Example Structure:**
```javascript
describe('AdapterName', () => {
  let adapter;
  
  beforeEach(() => {
    // Setup test adapter instance
  });
  
  test('should initialize correctly', () => {
    // Test adapter initialization
  });
});
```

### Integration Testing

**CRITICAL:** Use the official `@iobroker/testing` framework. This is the ONLY correct way to test ioBroker adapters.

**Official Documentation:** https://github.com/ioBroker/testing

#### Framework Structure

**✅ Correct Pattern:**
```javascript
const path = require('path');
const { tests } = require('@iobroker/testing');

tests.integration(path.join(__dirname, '..'), {
    defineAdditionalTests({ suite }) {
        suite('Test adapter with specific configuration', (getHarness) => {
            let harness;

            before(() => {
                harness = getHarness();
            });

            it('should configure and start adapter', function () {
                return new Promise(async (resolve, reject) => {
                    try {
                        // Get adapter object
                        const obj = await new Promise((res, rej) => {
                            harness.objects.getObject('system.adapter.your-adapter.0', (err, o) => {
                                if (err) return rej(err);
                                res(o);
                            });
                        });
                        
                        if (!obj) return reject(new Error('Adapter object not found'));

                        // Configure adapter
                        Object.assign(obj.native, {
                            position: '52.520008,13.404954',
                            createHourly: true,
                        });

                        harness.objects.setObject(obj._id, obj);
                        
                        // Start and wait
                        await harness.startAdapterAndWait();
                        await new Promise(resolve => setTimeout(resolve, 15000));

                        // Verify states
                        const stateIds = await harness.dbConnection.getStateIDs('your-adapter.0.*');
                        
                        if (stateIds.length > 0) {
                            console.log('✅ Adapter successfully created states');
                            await harness.stopAdapter();
                            resolve(true);
                        } else {
                            reject(new Error('Adapter did not create any states'));
                        }
                    } catch (error) {
                        reject(error);
                    }
                });
            }).timeout(40000);
        });
    }
});
```

#### Testing Success AND Failure Scenarios

**IMPORTANT:** For every "it works" test, implement corresponding "it fails gracefully" tests.

**Failure Scenario Example:**
```javascript
it('should NOT create daily states when daily is disabled', function () {
    return new Promise(async (resolve, reject) => {
        try {
            harness = getHarness();
            const obj = await new Promise((res, rej) => {
                harness.objects.getObject('system.adapter.your-adapter.0', (err, o) => {
                    if (err) return rej(err);
                    res(o);
                });
            });
            
            if (!obj) return reject(new Error('Adapter object not found'));

            Object.assign(obj.native, {
                createDaily: false, // Daily disabled
            });

            await new Promise((res, rej) => {
                harness.objects.setObject(obj._id, obj, (err) => {
                    if (err) return rej(err);
                    res(undefined);
                });
            });

            await harness.startAdapterAndWait();
            await new Promise((res) => setTimeout(res, 20000));

            const stateIds = await harness.dbConnection.getStateIDs('your-adapter.0.*');
            const dailyStates = stateIds.filter((key) => key.includes('daily'));
            
            if (dailyStates.length === 0) {
                console.log('✅ No daily states found as expected');
                resolve(true);
            } else {
                reject(new Error('Expected no daily states but found some'));
            }

            await harness.stopAdapter();
        } catch (error) {
            reject(error);
        }
    });
}).timeout(40000);
```

#### Key Rules

1. ✅ Use `@iobroker/testing` framework
2. ✅ Configure via `harness.objects.setObject()`
3. ✅ Start via `harness.startAdapterAndWait()`
4. ✅ Verify states via `harness.states.getState()`
5. ✅ Allow proper timeouts for async operations
6. ❌ NEVER test API URLs directly
7. ❌ NEVER bypass the harness system

#### Workflow Dependencies

Integration tests should run ONLY after lint and adapter tests pass:

```yaml
integration-tests:
  needs: [check-and-lint, adapter-tests]
  runs-on: ubuntu-22.04
```

#### Testing Pattern for Network Adapters Like radar2
For network scanning adapters, focus on:

```javascript
// Test network device scanning functionality
it('should scan for network devices', async function () {
    this.timeout(30000);
    
    const testDevices = [
        {
            name: 'TestDevice',
            ip: ['127.0.0.1'],
            macs: [],
            bluetooth: [],
            enabled: 1
        }
    ];
    
    // Configure test devices
    await harness.changeAdapterConfig('radar2', {
        native: {
            devices: testDevices,
            scandelay: '10',
            debug: true
        }
    });
    
    await harness.startAdapterAndWait();
    await wait(15000);
    
    // Verify device state was created
    const deviceState = await harness.states.getStateAsync('radar2.0.TestDevice.presence');
    expect(deviceState).to.exist;
});
```

#### Radar2-Specific Testing Patterns

For radar2 adapter, test these key areas:

```javascript
// Test IP device scanning
describe('IP Device Scanning', () => {
    it('should detect localhost', async function () {
        this.timeout(30000);
        
        const devices = [{
            name: 'Localhost',
            ip: ['127.0.0.1'],
            macs: [],
            bluetooth: [],
            enabled: 1
        }];
        
        await harness.changeAdapterConfig('radar2', {
            native: { devices, scandelay: '5' }
        });
        
        await harness.startAdapterAndWait();
        await wait(10000);
        
        const presence = await harness.states.getStateAsync('radar2.0.Localhost.presence');
        expect(presence.val).to.be.true;
    });
});

// Test external service integration
describe('External Services', () => {
    it('should fetch ECB currency rates', async function () {
        this.timeout(45000);
        
        const devices = [{
            name: 'ECB-Rates',
            ip: ['USD', 'GBP'],
            macs: [],
            bluetooth: [],
            enabled: 1
        }];
        
        await harness.changeAdapterConfig('radar2', {
            native: { devices }
        });
        
        await harness.startAdapterAndWait();
        await wait(20000);
        
        const usdRate = await harness.states.getStateAsync('radar2.0.ECB-Rates.USD');
        expect(usdRate).to.exist;
        expect(usdRate.val).to.be.a('number');
    });
});
```

### API Testing with Credentials
For adapters that connect to external APIs requiring authentication, implement comprehensive credential testing:

#### Password Encryption for Integration Tests
When creating integration tests that need encrypted passwords (like those marked as `encryptedNative` in io-package.json):

1. **Read system secret**: Use `harness.objects.getObjectAsync("system.config")` to get `obj.native.secret`
2. **Apply XOR encryption**: Implement the encryption algorithm:
   ```javascript
   async function encryptPassword(harness, password) {
       const systemConfig = await harness.objects.getObjectAsync("system.config");
       if (!systemConfig || !systemConfig.native || !systemConfig.native.secret) {
           throw new Error("Could not retrieve system secret for password encryption");
       }
       
       const secret = systemConfig.native.secret;
       let result = '';
       for (let i = 0; i < password.length; ++i) {
           result += String.fromCharCode(secret[i % secret.length].charCodeAt(0) ^ password.charCodeAt(i));
       }
       return result;
   }
   ```
3. **Store encrypted password**: Set the encrypted result in adapter config, not the plain text
4. **Result**: Adapter will properly decrypt and use credentials, enabling full API connectivity testing

#### Demo Credentials Testing Pattern
- Use provider demo credentials when available (e.g., `demo@api-provider.com` / `demo`)
- Create separate test file (e.g., `test/integration-demo.js`) for credential-based tests
- Add npm script: `"test:integration-demo": "mocha test/integration-demo --exit"`
- Implement clear success/failure criteria with recognizable log messages
- Expected success pattern: Look for specific adapter initialization messages
- Test should fail clearly with actionable error messages for debugging

#### Enhanced Test Failure Handling
```javascript
it("Should connect to API with demo credentials", async () => {
    // ... setup and encryption logic ...
    
    const connectionState = await harness.states.getStateAsync("adapter.0.info.connection");
    
    if (connectionState && connectionState.val === true) {
        console.log("✅ SUCCESS: API connection established");
        return true;
    } else {
        throw new Error("API Test Failed: Expected API connection to be established with demo credentials. " +
            "Check logs above for specific API errors (DNS resolution, 401 Unauthorized, network issues, etc.)");
    }
}).timeout(120000); // Extended timeout for API calls
```

## Documentation

### README Updates

#### Required Sections
1. **Installation** - Clear npm/ioBroker admin installation steps
2. **Configuration** - Detailed configuration options with examples
3. **Usage** - Practical examples and use cases
4. **Changelog** - Version history (use "## **WORK IN PROGRESS**" for ongoing changes)
5. **License** - License information (typically MIT for ioBroker adapters)
6. **Support** - Links to issues, discussions, community support

#### Documentation Standards
- Use clear, concise language
- Include code examples for configuration
- Add screenshots for admin interface when applicable
- Maintain multilingual support (minimum English and German)
- Always reference issues in commits and PRs (e.g., "fixes #xx")

#### Mandatory README Updates for PRs

For **every PR or new feature**, always add a user-friendly entry to README.md:

- Add entries under `## **WORK IN PROGRESS**` section
- Use format: `* (author) **TYPE**: Description of user-visible change`
- Types: **NEW** (features), **FIXED** (bugs), **ENHANCED** (improvements), **TESTING** (test additions), **CI/CD** (automation)
- Focus on user impact, not technical details

**Example:**
```markdown
## **WORK IN PROGRESS**

* (DutchmanNL) **FIXED**: Adapter now properly validates login credentials (fixes #25)
* (DutchmanNL) **NEW**: Added device discovery to simplify initial setup
```

### Changelog Management

Follow the [AlCalzone release-script](https://github.com/AlCalzone/release-script) standard.

#### Format Requirements

```markdown
# Changelog

<!--
  Placeholder for the next version (at the beginning of the line):
  ## **WORK IN PROGRESS**
-->

## **WORK IN PROGRESS**

- (author) **NEW**: Added new feature X
- (author) **FIXED**: Fixed bug Y (fixes #25)

## v0.1.0 (2023-01-01)
Initial release
```

#### Workflow Process
- **During Development:** All changes go under `## **WORK IN PROGRESS**`
- **For Every PR:** Add user-facing changes to WORK IN PROGRESS section
- **Before Merge:** Version number and date added when merging to main
- **Release Process:** Release-script automatically converts placeholder to actual version

#### Change Entry Format
- Format: `- (author) **TYPE**: User-friendly description`
- Types: **NEW**, **FIXED**, **ENHANCED**
- Focus on user impact, not technical implementation
- Reference issues: "fixes #XX" or "solves #XX"

---

## Development Best Practices

### Dependency Management

- Always use `npm` for dependency management
- Use `npm ci` for installing existing dependencies (respects package-lock.json)
- Use `npm install` only when adding or updating dependencies
- Keep dependencies minimal and focused
- Only update dependencies in separate Pull Requests

**When modifying package.json:**
1. Run `npm install` to sync package-lock.json
2. Commit both package.json and package-lock.json together

**Best Practices:**
- Prefer built-in Node.js modules when possible
- Use `@iobroker/adapter-core` for adapter base functionality
- Avoid deprecated packages
- Document specific version requirements

### HTTP Client Libraries

- **Preferred:** Use native `fetch` API (Node.js 20+ required for adapters; built-in since Node.js 18)
- **Avoid:** `axios` unless specific features are required (reduces bundle size)

**Example with fetch:**
```javascript
try {
  const response = await fetch('https://api.example.com/data');
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  const data = await response.json();
} catch (error) {
  this.log.error(`API request failed: ${error.message}`);
}
```

**Other Recommendations:**
- **Logging:** Use adapter built-in logging (`this.log.*`)
- **Scheduling:** Use adapter built-in timers and intervals
- **File operations:** Use Node.js `fs/promises`
- **Configuration:** Use adapter config system

### Error Handling

- Always catch and log errors appropriately
- Use adapter log levels (error, warn, info, debug)
- Provide meaningful, user-friendly error messages
- Handle network failures gracefully
- Implement retry mechanisms where appropriate
- Always clean up timers, intervals, and resources in `unload()` method

**Example:**
```javascript
try {
  await this.connectToDevice();
} catch (error) {
  this.log.error(`Failed to connect to device: ${error.message}`);
  this.setState('info.connection', false, true);
  // Implement retry logic if needed
}
```

---

## Admin UI Configuration

### JSON-Config Setup

Use JSON-Config format for modern ioBroker admin interfaces.

**Example Structure:**
```json
{
  "type": "panel",
  "items": {
    "host": {
      "type": "text",
      "label": "Host address",
      "help": "IP address or hostname of the device"
    }
  }
}
```

**Guidelines:**
- ✅ Use consistent naming conventions
- ✅ Provide sensible default values
- ✅ Include validation for required fields
- ✅ Add tooltips for complex options
- ✅ Ensure translations for all supported languages (minimum English and German)
- ✅ Write end-user friendly labels, avoid technical jargon

### Radar2-Specific Configuration Patterns
The radar2 adapter uses complex device configuration:

```json
{
    "devices": {
        "type": "table",
        "label": "Devices to monitor",
        "items": [
            {
                "type": "text",
                "name": "name",
                "label": "Device Name"
            },
            {
                "type": "chips",
                "name": "ip", 
                "label": "IP Addresses"
            },
            {
                "type": "chips",
                "name": "macs",
                "label": "MAC Addresses"
            },
            {
                "type": "chips", 
                "name": "bluetooth",
                "label": "Bluetooth Addresses"
            },
            {
                "type": "select",
                "name": "enabled",
                "label": "Status",
                "options": [
                    {"value": -1, "label": "Auto"},
                    {"value": 0, "label": "Disabled"}, 
                    {"value": 1, "label": "Enabled"}
                ]
            }
        ]
    }
}
```

### Translation Management

**CRITICAL:** Translation files must stay synchronized with `admin/jsonConfig.json`. Orphaned keys or missing translations cause UI issues and PR review delays.

#### Overview
- **Location:** `admin/i18n/{lang}/translations.json` for 11 languages (de, en, es, fr, it, nl, pl, pt, ru, uk, zh-cn)
- **Source of truth:** `admin/jsonConfig.json` - all `label` and `help` properties must have translations
- **Command:** `npm run translate` - auto-generates translations but does NOT remove orphaned keys
- **Formatting:** English uses tabs, other languages use 4 spaces

#### Critical Rules
1. ✅ Keys must match exactly with jsonConfig.json
2. ✅ No orphaned keys in translation files
3. ✅ All translations must be in native language (no English fallbacks)
4. ✅ Keys must be sorted alphabetically

#### Workflow for Translation Updates

**When modifying admin/jsonConfig.json:**

1. Make your changes to labels/help texts
2. Run automatic translation: `npm run translate`
3. Create validation script (`scripts/validate-translations.js`):

```javascript
const fs = require('fs');
const path = require('path');
const jsonConfig = JSON.parse(fs.readFileSync('admin/jsonConfig.json', 'utf8'));

function extractTexts(obj, texts = new Set()) {
    if (typeof obj === 'object' && obj !== null) {
        if (obj.label) texts.add(obj.label);
        if (obj.help) texts.add(obj.help);
        for (const key in obj) {
            extractTexts(obj[key], texts);
        }
    }
    return texts;
}

const requiredTexts = extractTexts(jsonConfig);
const languages = ['de', 'en', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'ru', 'uk', 'zh-cn'];
let hasErrors = false;

languages.forEach(lang => {
    const translationPath = path.join('admin', 'i18n', lang, 'translations.json');
    const translations = JSON.parse(fs.readFileSync(translationPath, 'utf8'));
    const translationKeys = new Set(Object.keys(translations));
    
    const missing = Array.from(requiredTexts).filter(text => !translationKeys.has(text));
    const orphaned = Array.from(translationKeys).filter(key => !requiredTexts.has(key));
    
    console.log(`\n=== ${lang} ===`);
    if (missing.length > 0) {
        console.error('❌ Missing keys:', missing);
        hasErrors = true;
    }
    if (orphaned.length > 0) {
        console.error('❌ Orphaned keys (REMOVE THESE):', orphaned);
        hasErrors = true;
    }
    if (missing.length === 0 && orphaned.length === 0) {
        console.log('✅ All keys match!');
    }
});

process.exit(hasErrors ? 1 : 0);
```

4. Run validation: `node scripts/validate-translations.js`
5. Remove orphaned keys manually from all translation files
6. Add missing translations in native languages
7. Run: `npm run lint && npm run test`

#### Add Validation to package.json

```json
{
  "scripts": {
    "translate": "translate-adapter",
    "validate:translations": "node scripts/validate-translations.js",
    "pretest": "npm run lint && npm run validate:translations"
  }
}
```

#### Translation Checklist

Before committing changes to admin UI or translations:
1. ✅ Validation script shows "All keys match!" for all 11 languages
2. ✅ No orphaned keys in any translation file
3. ✅ All translations in native language
4. ✅ Keys alphabetically sorted
5. ✅ `npm run lint` passes
6. ✅ `npm run test` passes
7. ✅ Admin UI displays correctly

---

## CI/CD & GitHub Actions

### Workflow Configuration

#### GitHub Actions Best Practices

**Must use ioBroker official testing actions:**
- `ioBroker/testing-action-check@v1` for lint and package validation
- `ioBroker/testing-action-adapter@v1` for adapter tests
- `ioBroker/testing-action-deploy@v1` for automated releases with Trusted Publishing (OIDC)

**Configuration:**
- **Node.js versions:** Test on 20.x, 22.x, 24.x
- **Platform:** Use ubuntu-22.04
- **Automated releases:** Deploy to npm on version tags (requires NPM Trusted Publishing)
- **Monitoring:** Include Sentry release tracking for error monitoring

#### Critical: Lint-First Validation Workflow

**ALWAYS run ESLint checks BEFORE other tests.** Benefits:
- Catches code quality issues immediately
- Prevents wasting CI resources on tests that would fail due to linting errors
- Provides faster feedback to developers
- Enforces consistent code quality

**Workflow Dependency Configuration:**
```yaml
jobs:
  check-and-lint:
    # Runs ESLint and package validation
    # Uses: ioBroker/testing-action-check@v1
    
  adapter-tests:
    needs: [check-and-lint]  # Wait for linting to pass
    # Run adapter unit tests
    
  integration-tests:
    needs: [check-and-lint, adapter-tests]  # Wait for both
    # Run integration tests
```

**Key Points:**
- The `check-and-lint` job has NO dependencies - runs first
- ALL other test jobs MUST list `check-and-lint` in their `needs` array
- If linting fails, no other tests run, saving time
- Fix all ESLint errors before proceeding

### Testing Integration

#### API Testing in CI/CD

For adapters with external API dependencies:

```yaml
demo-api-tests:
  if: contains(github.event.head_commit.message, '[skip ci]') == false
  runs-on: ubuntu-22.04
  
  steps:
    - name: Checkout code
      uses: actions/checkout@v4
      
    - name: Use Node.js 20.x
      uses: actions/setup-node@v4
      with:
        node-version: 20.x
        cache: 'npm'
        
    - name: Install dependencies
      run: npm ci
      
    - name: Run demo API tests
      run: npm run test:integration-demo
```

#### Testing Best Practices
- Run credential tests separately from main test suite
- Don't make credential tests required for deployment
- Provide clear failure messages for API issues
- Use appropriate timeouts for external calls (120+ seconds)

#### Package.json Integration
```json
{
  "scripts": {
    "test:integration-demo": "mocha test/integration-demo --exit"
  }
}
```

---

## ioBroker Development Patterns

### Adapter Structure
```javascript
// Standard adapter initialization
class MyAdapter extends utils.Adapter {
    constructor(options) {
        super({
            name: 'my-adapter',
            ...options
        });
        
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }
    
    async onReady() {
        // Initialize your adapter here
        this.setState('info.connection', false, true);
        
        // Subscribe to state changes
        this.subscribeStates('*');
    }
}
```

### Radar2-Specific Patterns (fjadapter-core.js Usage)
The radar2 adapter uses a custom framework. When working with this adapter, understand:

```javascript
// fjadapter-core.js initialization pattern
const A = require('./fjadapter-core.js');

A.init(module, {
    name: 'radar2',
    onUnload: async (how) => {
        // Cleanup resources
        return A.If('Unload adapter now with %s', how);
    }
}, main);

// Main function with adapter logic
async function main(adapter) {
    // Access configuration through A.C
    const devices = A.C.devices;
    const scandelay = parseInt(A.C.scandelay);
    
    // Use A.D for debug logging
    A.D('Adapter configuration: ' + A.O(devices));
    
    // Set states using A.setState
    await A.setState('info.connection', true, true);
}
```

### Logging Best Practices
```javascript
// Use appropriate log levels
this.log.error('Critical error occurred');
this.log.warn('Warning message');
this.log.info('General information');
this.log.debug('Detailed debugging info');

// For radar2 adapter using fjadapter-core:
A.E('Error message');  // Error
A.W('Warning message'); // Warning  
A.I('Info message');    // Info
A.D('Debug message');   // Debug
```

### State Management
```javascript
// Creating states
await this.setObjectNotExistsAsync('device.temperature', {
    type: 'state',
    common: {
        name: 'Temperature',
        type: 'number',
        role: 'value.temperature',
        read: true,
        write: false,
        unit: '°C'
    },
    native: {}
});

// Setting state values
await this.setStateAsync('device.temperature', { val: 23.5, ack: true });

// For radar2 adapter:
await A.setState('device.presence', true, true);
```

### Error Handling
```javascript
try {
    // Your adapter logic
    await this.performNetworkOperation();
} catch (error) {
    this.log.error(`Operation failed: ${error.message}`);
    this.setState('info.connection', false, true);
}

// For radar2 adapter:
A.get(url, timeout).catch(e => A.W(`Request failed: ${e}`, null));
```

### Configuration Access
```javascript
// Standard adapter
const apiKey = this.config.apiKey;
const interval = this.config.interval;

// radar2 adapter via fjadapter-core
const devices = A.C.devices;
const scandelay = A.C.scandelay;
```

---

## External API Integration

### HTTP Request Patterns
```javascript
// Using axios (for radar2 adapter which uses axios)
const axios = require('axios');

try {
    const response = await axios.get('https://api.example.com/data', {
        timeout: 5000,
        headers: {
            'User-Agent': 'ioBroker-adapter/1.0.0'
        }
    });
    
    this.log.info(`Received data: ${JSON.stringify(response.data)}`);
} catch (error) {
    this.log.error(`API request failed: ${error.message}`);
}

// For radar2 adapter using A.get:
const data = await A.get('https://api.example.com/data', 5).catch(e => {
    A.W(`API request failed: ${e}`, null);
    return null;
});
```

### XML Processing
```javascript
// Using xml2js (common in ioBroker adapters)
const xml2js = require('xml2js');

const parser = new xml2js.Parser();
const result = await parser.parseStringPromise(xmlData);

// For radar2 adapter:
async function xmlParseString(body) {
    return new Promise((resolve, reject) => {
        xml2js.parseString(body, (err, result) => {
            if (err) reject(err);
            else resolve(result);
        });
    });
}
```

### Network Device Discovery Patterns
```javascript
// ARP scanning pattern (radar2-specific)
const exec = require('child_process').exec;

function scanNetwork(subnet) {
    return new Promise((resolve, reject) => {
        exec(`arp-scan ${subnet}`, (error, stdout, stderr) => {
            if (error) {
                reject(error);
                return;
            }
            
            const devices = [];
            const lines = stdout.split('\n');
            
            for (const line of lines) {
                const match = line.match(/(\d+\.\d+\.\d+\.\d+)\s+([0-9a-fA-F:]{17})/);
                if (match) {
                    devices.push({
                        ip: match[1],
                        mac: match[2]
                    });
                }
            }
            
            resolve(devices);
        });
    });
}
```

---

## Resource Management and Cleanup

### Proper Cleanup in unload()
```javascript
async onUnload(callback) {
    try {
        // Clear all timers
        if (this.scanTimer) {
            clearInterval(this.scanTimer);
            this.scanTimer = null;
        }
        
        // Close network connections
        if (this.server) {
            this.server.close();
        }
        
        // Stop any running processes
        if (this.childProcess) {
            this.childProcess.kill();
        }
        
        this.log.info('Adapter stopped and cleaned up');
        callback();
    } catch (e) {
        callback();
    }
}
```

### Timer Management
```javascript
// Creating periodic tasks
this.scanTimer = setInterval(async () => {
    try {
        await this.performScan();
    } catch (error) {
        this.log.error(`Scan failed: ${error.message}`);
    }
}, this.config.interval * 1000);

// For radar2 adapter using A.timer:
A.timer.push(setInterval(async () => {
    await scanDevices();
}, scandelay * 1000));
```

---

## Performance and Optimization

### Efficient State Updates
```javascript
// Batch state updates when possible
const states = {
    'device.temperature': { val: 23.5, ack: true },
    'device.humidity': { val: 65, ack: true },
    'device.pressure': { val: 1013, ack: true }
};

for (const [id, state] of Object.entries(states)) {
    await this.setStateAsync(id, state);
}
```

### Memory Management
```javascript
// Avoid memory leaks with large datasets
const processLargeDataset = (data) => {
    // Process in chunks to avoid memory issues
    const chunkSize = 1000;
    for (let i = 0; i < data.length; i += chunkSize) {
        const chunk = data.slice(i, i + chunkSize);
        processChunk(chunk);
    }
};
```

---

## Security Considerations

### Credential Management
```javascript
// Never log sensitive data
this.log.debug(`Connecting to API with user: ${this.config.username}`);
// DON'T: this.log.debug(`Password: ${this.config.password}`);

// Use encryption for sensitive config values
await this.getForeignObjectAsync('system.config', (err, obj) => {
    if (obj && obj.native && obj.native.secret) {
        // Use secret for encryption/decryption
    }
});
```

### Input Validation
```javascript
// Validate configuration values
if (!this.config.apiKey || typeof this.config.apiKey !== 'string') {
    this.log.error('Invalid API key configuration');
    return;
}

// Validate network inputs
const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
if (!ipRegex.test(this.config.serverIp)) {
    this.log.error('Invalid IP address format');
    return;
}
```