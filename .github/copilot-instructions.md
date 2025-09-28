# ioBroker Adapter Development with GitHub Copilot

**Version:** 0.4.0
**Template Source:** https://github.com/DrozmotiX/ioBroker-Copilot-Instructions

This file contains instructions and best practices for GitHub Copilot when working on ioBroker adapter development.

## Project Context

You are working on an ioBroker adapter. ioBroker is an integration platform for the Internet of Things, focused on building smart home and industrial IoT solutions. Adapters are plugins that connect ioBroker to external systems, devices, or services.

## Adapter-Specific Context
- **Adapter Name**: iobroker.radar2
- **Primary Function**: Radar2 to find status of IP, Bluetooth, UWZ, ECB and HP-Printers-devices
- **Repository**: iobroker-community-adapters/ioBroker.radar2
- **Key Features**: Network device scanning via ARP/ping, Bluetooth device discovery, Weather warnings (UWZ), European Central Bank currency rates, HP printer status monitoring
- **Main Dependencies**: @iobroker/adapter-core, axios, node-arp, node-ble, ping, xml2js
- **Architecture**: Uses custom fjadapter-core.js framework built on top of @iobroker/adapter-core
- **Scanning Methods**: ARP scan for IP devices, Bluetooth scanning for BT devices, HTTP APIs for external services
- **Configuration**: Complex device list with IP addresses, MAC addresses, Bluetooth addresses per device entry

## Testing

### Unit Testing
- Use Jest as the primary testing framework for ioBroker adapters
- Create tests for all adapter main functions and helper methods
- Test error handling scenarios and edge cases
- Mock external API calls and hardware dependencies
- For adapters connecting to APIs/devices not reachable by internet, provide example data files to allow testing of functionality without live connections
- Example test structure:
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

**IMPORTANT**: Use the official `@iobroker/testing` framework for all integration tests. This is the ONLY correct way to test ioBroker adapters.

**Official Documentation**: https://github.com/ioBroker/testing

#### Framework Structure
Integration tests MUST follow this exact pattern:

```javascript
const path = require('path');
const { tests } = require('@iobroker/testing');

// Define test coordinates or configuration
const TEST_COORDINATES = '52.520008,13.404954'; // Berlin
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Use tests.integration() with defineAdditionalTests
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
                        harness = getHarness();
                        
                        // Get adapter object using promisified pattern
                        const obj = await new Promise((res, rej) => {
                            harness.objects.getObject('system.adapter.your-adapter.0', (err, o) => {
                                if (err) return rej(err);
                                res(o);
                            });
                        });
                        
                        if (!obj) {
                            return reject(new Error('Adapter object not found'));
                        }

                        // Configure adapter properties
                        Object.assign(obj.native, {
                            position: TEST_COORDINATES,
                            createCurrently: true,
                            createHourly: true,
                            createDaily: true,
                            // Add other configuration as needed
                        });

                        // Set the updated configuration
                        harness.objects.setObject(obj._id, obj);

                        console.log('✅ Step 1: Configuration written, starting adapter...');
                        
                        // Start adapter and wait
                        await harness.startAdapterAndWait();
                        
                        console.log('✅ Step 2: Adapter started');

                        // Wait for adapter to process data
                        const waitMs = 15000;
                        await wait(waitMs);

                        console.log('🔍 Step 3: Checking states after adapter run...');
                        
                        // Validate expected states exist
                        const states = await harness.states.getKeysAsync('radar2.0.*');
                        console.log(`Found ${states.length} states`);
                        
                        if (states.length === 0) {
                            return reject(new Error('No states created by adapter'));
                        }

                        console.log('✅ Integration test completed successfully');
                        resolve();
                        
                    } catch (error) {
                        console.error('❌ Integration test failed:', error);
                        reject(error);
                    }
                });
            }).timeout(60000); // Extended timeout for network operations
        });
    }
});
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

#### Critical Testing Requirements for ioBroker Adapters

1. **Always use `@iobroker/testing` framework - never create custom test harnesses**
2. **Test timeout must be sufficient for network operations (30-60 seconds)**
3. **Configure the adapter through harness.changeAdapterConfig() before starting**
4. **Wait for adapter initialization before checking results**
5. **Verify expected states and objects are created**
6. **Test both success and failure scenarios**

#### Common Testing Mistakes to Avoid

❌ **Wrong**: Creating custom adapter instances
```javascript
// DON'T DO THIS
const adapter = new MyAdapter({...});
```

✅ **Correct**: Using testing framework harness
```javascript
// DO THIS
const harness = getHarness();
await harness.startAdapterAndWait();
```

❌ **Wrong**: Insufficient timeout for network operations
```javascript
// DON'T DO THIS - too short for network scanning
}).timeout(5000);
```

✅ **Correct**: Adequate timeout for network operations
```javascript
// DO THIS - sufficient time for scanning
}).timeout(30000);
```

❌ **Wrong**: Not configuring adapter before testing
```javascript
// DON'T DO THIS
await harness.startAdapterAndWait();
// Test without configuration
```

✅ **Correct**: Configure then test
```javascript
// DO THIS
await harness.changeAdapterConfig('radar2', { native: { devices: [...] } });
await harness.startAdapterAndWait();
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

## JSON-Config Management (Admin Interface)

ioBroker adapters use JSON-Config for their admin interface configuration. This system automatically generates the admin UI from JSON schemas.

### Basic JSON-Config Structure
```json
{
    "type": "panel",
    "items": {
        "apiKey": {
            "type": "text",
            "label": "API Key",
            "help": "Enter your API key here"
        },
        "interval": {
            "type": "number",
            "label": "Update interval (seconds)",
            "min": 1,
            "max": 3600,
            "default": 60
        }
    }
}
```

### Advanced JSON-Config Patterns

#### Device List Management
```json
{
    "type": "table",
    "items": [
        {
            "type": "text",
            "name": "name",
            "label": "Device Name"
        },
        {
            "type": "text",
            "name": "ip",
            "label": "IP Address"
        },
        {
            "type": "checkbox",
            "name": "enabled",
            "label": "Enabled"
        }
    ]
}
```

#### Conditional Fields
```json
{
    "enabled": {
        "type": "checkbox",
        "label": "Enable feature"
    },
    "apiUrl": {
        "type": "text",
        "label": "API URL",
        "hidden": "!data.enabled"
    }
}
```

#### Validation Rules
```json
{
    "port": {
        "type": "number",
        "label": "Port",
        "min": 1,
        "max": 65535,
        "default": 8080
    },
    "email": {
        "type": "text",
        "label": "Email",
        "pattern": "^[^@]+@[^@]+\\.[^@]+$"
    }
}
```

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

## External API Integration

### HTTP Request Patterns
```javascript
// Using axios (recommended for new adapters)
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

## Code Style and Standards

- Follow JavaScript/TypeScript best practices
- Use async/await for asynchronous operations
- Implement proper resource cleanup in `unload()` method
- Use semantic versioning for adapter releases
- Include proper JSDoc comments for public methods

## CI/CD and Testing Integration

### GitHub Actions for API Testing
For adapters with external API dependencies, implement separate CI/CD jobs:

```yaml
# Tests API connectivity with demo credentials (runs separately)
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

### CI/CD Best Practices
- Run credential tests separately from main test suite
- Use ubuntu-22.04 for consistency
- Don't make credential tests required for deployment
- Provide clear failure messages for API connectivity issues
- Use appropriate timeouts for external API calls (120+ seconds)

### Package.json Script Integration
Add dedicated script for credential testing:
```json
{
  "scripts": {
    "test:integration-demo": "mocha test/integration-demo --exit"
  }
}
```

### Practical Example: Complete API Testing Implementation
Here's a complete example based on lessons learned from the Discovergy adapter:

#### test/integration-demo.js
```javascript
const path = require("path");
const { tests } = require("@iobroker/testing");

// Helper function to encrypt password using ioBroker's encryption method
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

// Run integration tests with demo credentials
tests.integration(path.join(__dirname, ".."), {
    defineAdditionalTests({ suite }) {
        suite("API Testing with Demo Credentials", (getHarness) => {
            let harness;
            
            before(() => {
                harness = getHarness();
            });

            it("Should connect to API and initialize with demo credentials", async () => {
                console.log("Setting up demo credentials...");
                
                if (harness.isAdapterRunning()) {
                    await harness.stopAdapter();
                }
                
                const encryptedPassword = await encryptPassword(harness, "demo_password");
                
                await harness.changeAdapterConfig("your-adapter", {
                    native: {
                        username: "demo@provider.com",
                        password: encryptedPassword,
                        // other config options
                    }
                });

                console.log("Starting adapter with demo credentials...");
                await harness.startAdapter();
                
                // Wait for API calls and initialization
                await new Promise(resolve => setTimeout(resolve, 60000));
                
                const connectionState = await harness.states.getStateAsync("your-adapter.0.info.connection");
                
                if (connectionState && connectionState.val === true) {
                    console.log("✅ SUCCESS: API connection established");
                    return true;
                } else {
                    throw new Error("API Test Failed: Expected API connection to be established with demo credentials. " +
                        "Check logs above for specific API errors (DNS resolution, 401 Unauthorized, network issues, etc.)");
                }
            }).timeout(120000);
        });
    }
});
```

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