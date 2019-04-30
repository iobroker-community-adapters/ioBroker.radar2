"use strict";

// V 1.2 March 2019

const A = require('@frankjoke/myadapter').MyAdapter;

const assert = require('assert'),
    dgram = require('dgram'),
    arp = require('node-arp'),
    ping = require('ping'),
    dns = require("dns"),
    os = require('os'),
    net = require('net'),
    fs = require('fs'),
    cp = require('child_process'),
    stream = require('stream'),
    EventEmitter = require('events').EventEmitter;

let macdb = require('./lib/vendors.json');

class ReadLineStream extends stream.Transform {
    constructor(options) {
        super(options);
        this.lineBuffer = '';
        // use objectMode to stop the output from being buffered
        // which re-concatanates the lines, just without newlines.
        this._readableState.objectMode = true;
        // take the source's encoding if we don't have one
        this.on('pipe', function (src) {
            if (!this.encoding) {
                this.encoding = src._readableState.encoding;
            }
        });
    }

    _transform(chunk, encoding, done) {
        // decode binary chunks as UTF-8
        if (Buffer.isBuffer(chunk)) {
            if (!encoding || encoding == 'buffer') encoding = 'utf8';

            chunk = chunk.toString(encoding);
        }

        this.lineBuffer += chunk;
        var lines = this.lineBuffer.match(/.*?(?:\r\n|\r|\n)|.*?$/g);

        while (lines.length > 1)
            this.push(lines.shift());

        this.lineBuffer = lines[0] || '';

        done();
    }

    _flush(done) {
        if (this.lineBuffer) {
            this.push(this.lineBuffer);
            this.lineBuffer = '';
        }

        done();
    }
}

class ScanCmd extends EventEmitter {
    constructor(args, options) {
        super();
        this._stdout = null;
        this._stop = false;
        this._args = args;
        if (typeof args === 'string')
            this._args = args.split(/\s+/);
        options = options || {};
        this._options = Object.assign({
            killSignal: 'SIGINT',
            timeout: 0,
            spawnOptions: {
                // detachment and ignored stdin are the key here: 
                detached: true,
                stdio: ['ignore', 'pipe', 'pipe']
            }
        }, options);
        this._cmd = null;
        this._linepart = '';
        this._timeout = null;
        this._matches = {};
        ScanCmd._cnt = ScanCmd._cnt || 0;
        ScanCmd._all = ScanCmd._all || {};
        A.exec('which ' + this._args[0]).then(x => typeof x === 'string' && x.length ? x.trim() : this._args[0], () => this._args[0])
            .then(x => this._args[0] = x)
            .then(() => this.init());
        return this;
    }

    static runCmd(cmd, match, opt) {
        opt = opt || {};
        if (match)
            opt.match = match;
        return new Promise((res, rej) => {
            let ret = [];
            let pid = ++ScanCmd._cnt & 0xfffffff;

            function finish(how, arg) {
                how(arg);

                //                proc.removeAllListeners();
                setImmediate(() => {
                    delete ScanCmd._all[pid];
                    ret = proc = null;
                });
            }
            let proc = new ScanCmd(cmd, opt);
            ScanCmd._all[pid] = proc;
            A.Df('started #%s %s', pid, cmd);
            proc.on('line', line => ret && ret.push(line));
            proc.once('error', err => setTimeout(() => finish(rej, err), 100));
            proc.once('exit', code => code ? finish(rej, code) : finish(res, ret));
        });
    }

    static stopAll() {
        for (let x of Object.keys(ScanCmd._all)) {
            ScanCmd._all[x].stop();
            delete ScanCmd._all[x];
        }
    }

    init() {
        var self = this;
        this._cmd = null;
        this._matches = {};

        function match(data) {
            if (self._options.match) {
                let m = data.match(self._options.match[0]);
                if (m) {
                    let r = {
                        by: self._options.match[1]
                    };
                    m = m.slice(1);
                    let ma = m[0];
                    if (!self._matches[ma]) {
                        for (let x = 0; x < m.length; x++)
                            r[self._options.match[x + 2]] = m[x];
                        if (r.address)
                            r.vendor = Network.getMacVendor(r.address);
                        self.emit('line', r);
                        //                        A.N(() => self.emit('line', r));
                        self._matches[ma] = m;
                    }
                }
            } else
                self.emit('line', data.trim());
            //                          A.N(() => self.emit('line', data.trim()));
        }

        function error(data) {
            setImmediate(() => {
                self.emit('error', data);
                A.Df('ScanCmd err: %O', data);
                if (self._cmd && !self._stop)
                    self.stop();
            });
        }

        //        try {
        this._cmd = cp.spawn(this._args[0], this._args.slice(1), this._options.spawnOptions);
        //            A.I(`started ${this._args[0]} with ${this._args.slice(1)}`);
        //        } catch (e) {
        //            A.E(`spawn arror ${e}`);
        //            this._cmd = null;
        //        }
        if (this._cmd) {
            if (this._options.timeout > 0)
                this._timeout = setTimeout(this.kill.bind(this), this._options.timeout);
            else this._timeout = null;
            this._cmd.unref();
            //            this._cmd.kill('SIGTTIN');
            self._stdout = self._cmd.stdout.pipe(new ReadLineStream());
            //            self._stderr = self._cmd.stderr.pipe(new ReadLineStream());
            //            self._cmd.stdout._readableState.highWaterMark = self._cmd.stderr._readableState.highWaterMark = 16;
            //            self._cmd.stdout._readableState.objectMode = self._cmd.stderr._readableState.objectMode = true;
            //            self._cmd.stdout._linepart = self._cmd.stderr._linepart = '';
            //            A.If('stdout: %O', self._stdout);
            self._stdout
                //                .on('close', () => A.I('stdout_close'))
                //            self._cmd.stdout.on('close', () => A.I('stdout_close'))
                //                .on('end', () => A.I('stdout_end'))
                .on('error', err => error(err))
                //                .on('readable', () => readlines(self._cmd.stdout))
                //                .on('data', data => readlines(self._cmd.stdout, data));
                //                .on('data', data => A.If('stdout_data_line: %s', data.trim()));
                .on('data', data => match(data));
            //                self._cmd.stdout.on('data', data => A.If('stdout data: %s',data));
            //            self._cmd.stderr.on('readable', () => readlines(self._cmd.stderr));
            //            self._stderr.on('data', data => readlines(self._cmd.stderr, data));
            self._cmd.stderr.on('data', data => error(data.toString().trim()));
            self._cmd
                .on('close', () => self.cleanUp())
                //                .on('disconnect', () => A.If('cmd_disconnect %O', self._args))
                .on('error', err => error(err))
                .on('exit', function (code) {
                    //                    A.D(`${self._args} exit code: ${code}`);
                    self.cleanUp();
                    self.emit('exit', code);
                    //                if (!self._stop && !self._single)
                    //                    self.init();
                });
            //            self._cmd.stdout.resume();
            //            self._cmd.stderr.resume();
            //            A.I(`started ${this._args} resulting in ${this._cmd}`);
        } else A.W(`Could not start ${this._args}`);
        return this._cmd;
    }

    stop() {
        this._stop = true;
        this.kill();
    }

    cleanUp() {
        this._stop = true;
        if (this._timeout) {
            clearTimeout(this._timeout);
            this._timeout = null;
        }
        //        setImmediate(() => {
        if (this._cmd) {
            /*                
                            this._cmd.removeAllListeners();
                            if (this._cmd.stdout)
                                this._cmd.stdout.removeAllListeners();
                            if (this._cmd.stderr)
                                this._cmd.stderr.removeAllListeners();
            */
            this._cmd = null;
            this._stdout = this._stderr = null;
        }
        this.emit('exit', 0);
        //        }, 100);
    }

    kill() {
        if (this._timeout) {
            clearTimeout(this._timeout);
            this._timeout = null;
        }
        if (this._cmd && !this._cmd.killed && !this._stop) {
            A.Df('Kill %O with %s', this._args, this._options.killSignal);
            if (this._options.killSignal === '^C')
                this._cmd.stdin.write('\0x03');
            else
                this._cmd.kill(this._options.killSignal);
            this.cleanUp();
        }
    }
}

ScanCmd._all = {};

class Bluetooth extends EventEmitter {
    constructor() {
        super();
        this._nobleRunning = false;
        this._noble = null;
        this._btid = -1;
        this._len = 25000;
        this._nbt = null;
        this._device = null;
        this._scan = null;
        this._doHci = null;
    }

    get hasNoble() {
        return this._noble;
    }

    get device() {
        return this._device;
    }

    get nbt() {
        return this._nbt;
    }

    listPairedDevices() {
        if (!this._device)
            return Promise.resolve([]);
        return new Promise(res => this._device.listPairedDevices(ret => res(ret)));
    }

    startScan() {
        if (this._device && this._scan)
            return Promise.reject(A.W(`BT already scanning!`));
        //        A.D(`start scanning!`);
        if (this._doHci) {
            return this.resetHci().then(() => Promise.all([
                ScanCmd.runCmd(A.f('hcitool -i %s lescan --duplicates', this._doHci), [/^\s*((?:[\dA-F]{2}:){5}[\dA-F]{2})\s+(.*?)\s*$/im, 'lescan', 'address', 'btName'], {
                    timeout: this._len
                }).then(res => res.map(res => A.N(() => {
                    res.btVendor = res.vendor;
                    res.address = res.address.toLowerCase();
                    delete res.vendor;
                    this.emit('found', res);
                })), A.nop),
                ScanCmd.runCmd(A.f('hcitool -i %s scan --flush --length=%s', this._doHci, Math.floor(this._len / 1300)), [/^\s*((?:[\dA-F]{2}:){5}[\dA-F]{2})\s+(.*?)\s*$/im, 'scan', 'address', 'btName'])
                .then(res => res.map(res => A.N(() => {
                    res.btVendor = res.vendor;
                    res.address = res.address.toLowerCase();
                    delete res.vendor;
                    this.emit('found', res);
                })), A.nop)
            ]));
        } else if (this._device && this._noble && !this._doHci) {
            this._scan = true;
            return Promise.all([
                A.Ptime(this._device.scan()).then(x => x < 1000 ? this._device.scan() : Promise.resolve()).catch(A.nop),
                this.startNoble()
            ]).catch(A.nop).then(() => this._scan = false);
        } else
            return Promise.resolve(A.Wf('Neither noble nor hcitool available to scan bluetooth!'));
    }

    resetHci() {
        return typeof this._doHci === 'string' ?
            ScanCmd.runCmd(A.f('hciconfig %s down', this._doHci)).catch(A.pE)
            .then(() => A.wait(100))
            .then(() => ScanCmd.runCmd(A.f('hciconfig %s up', this._doHci))).catch(A.pE) :
            Promise.resolve();
    }

    get scanTime() {
        return this._len;
    }
    set scanTime(len) {
        this._len = (isNaN(parseInt(len)) || !len || len < 0) ? 10000 : parseInt(len);
    }

    init(options) {
        const self = this;
        const nid = 'NOBLE_HCI_DEVICE_ID';
        options = Object.assign({
            btid: -1,
            scanTime: 25000,
            doHci: true
        }, options || {});
        this._btid = isNaN(parseInt(options.btid)) ? -1 : parseInt(options.btid);
        this.len = options.scanTime;
        return A.isLinuxApp('hcitool').then(x => (this._doHci = x && options.doHci)).then(x => {
            if (x)
                return ScanCmd.runCmd('hcitool dev', [/^\s*(\S+)\s+((?:[\dA-F]{2}:){5}[\dA-F]{2})\s*$/im, 'dev', 'name', 'address'])
                    .then(res =>
                        this._btid < 0 && res.length ? res[0].name : res.length && res.map(x => x.name == 'hci' + this._btid).length == 1 ? 'hci' + this._btid : 'hci0', () => 'hci0')
                    .then(res =>
                        A.Ir(this._doHci = res, 'Will run hcitool-mode and not noble on device %s!', res))
                    .then(() =>
                        this.resetHci());
            if (this._btid >= 0)
                // eslint-disable-next-line no-process-env
                process.env[nid] = this._btid;

            try {
                this._noble = require('@abandonware/noble');
                this._noble.on('stateChange', (state) => self.emit('stateChange', A.D(A.F('Noble State Change:', state), state)));
                //        this._noble.on('scanStart', () => A.D('Noble scan started'));
                //        this._noble.on('scanStop', () => A.D('Noble scan stopped'));
                this._noble.on('discover', function (per) {
                    //                if (isStopping)
                    //                    return res(stopNoble(idf));
                    //                        A.D(`-myNoble discovers: ${A.O(per)}`);
                    if (per && per.address)
                        self.emit('found', {
                            address: per.address.toLowerCase(),
                            btName: (per.advertisement && per.advertisement.localName) ? per.advertisement.localName : "NaN",
                            rssi: per.rssi,
                            btVendor: Network.getMacVendor(per.address),
                            by: 'noble'
                            //                        vendor: Network.getMacVendor(per.address)
                        });
                });
                //            this._noble.stopScanning();
                A.I("found '@abandonware/noble'");
            } catch (e) {
                A.W(`Noble not available, Error: ${A.O(e)}`);
                this._noble = null;
            }
            try {
                this._nbt = require('node-bluetooth');
                this._device = new this._nbt.DeviceINQ();
                this._device.on('found', (address, name) => self.emit('found', {
                    address: address,
                    btName: name,
                    btVendor: Network.getMacVendor(address),
                    by: 'scan'
                }));
                A.I("found 'node-bluetooth'");
            } catch (e) {
                A.W('node-bluetooth not found!');
            }
            return null;
        });
        //        this._l2cmd = `!sudo l2ping -i hci${btid} -c1 `;

    }

    stopNoble() {
        this._nobleRunning = null;
        if (this._noble)
            this._noble.stopScanning();
        //        A.D('Noble stopped scanning now.');
    }

    startNoble(len) {
        var self = this;
        if (this._nobleRunning)
            this.stopNoble();
        //        this._noble
        len = len || self._len;
        if (!this._noble) return Promise.resolve({});
        //        if (this._noble.state !== 'poweredOn') return Promise.reject('Noble not powered ON!');
        return A.retry(20, () => self._noble.state === 'poweredOn' ? Promise.resolve() : A.wait(100).then(() => Promise.reject('not powered on')))
            .then(() => {
                //            A.D(`starting noble for ${len/1000} seconds`);
                self._nobleRunning = true;
                self._noble.startScanning();
                return A.wait(len).then(() => self.stopNoble());
            }).catch(err => A.I(`Noble scan Err ${A.O(err)}`, err));
    }

    stop() {
        this.stopNoble();
        this._noble = null;
        ScanCmd.stopAll();
    }

}

class Dhcp extends EventEmitter {
    constructor(addr) {
        super();
        this._addr = addr || '0.0.0.0';
        this._listener = null;
        this.init();
    }

    init(addr) {
        addr = addr || this._addr;
        try {
            this._trybind('0.0.0.0');
        } catch (e) {
            A.Wf('could not bind to address %s dhcp port 67 because of %O!', e);
        }
        setTimeout(self => {
            self.emit('listenState', !!self._listener);
            if (!self._listener) {
                A.Wf(`Could not bind to any dhcp listener address %s:67!`, addr);
            }
        }, 1000, this);
    }

    close() {
        if (this._listener) {
            this.emit('listenState', false);
            this.emit('close', true);
            this._listener.close();
            this._listener.removeAllListeners();
        }
        this._listener = null;
    }

    _trybind(addr) {
        var self = this;

        function parseUdp(msg) {
            function trimNulls(str) {
                var idx = str.indexOf('\u0000');
                return (idx === -1) ? str : str.substr(0, idx);
            }

            function readIpRaw(msg, offset) {
                //            console.log(`Read IpRaw bl = ${msg.length} offset = ${offset}`)
                if (msg.readUInt8(offset) === 0)
                    return undefined;
                return '' +
                    msg.readUInt8(offset++) + '.' +
                    msg.readUInt8(offset++) + '.' +
                    msg.readUInt8(offset++) + '.' +
                    msg.readUInt8(offset++);
            }

            function readIp(msg, offset, obj, name) {
                //            console.log(`Read IP = ${msg.length} offset = ${offset}, name = ${name} `)
                var len = msg.readUInt8(offset++);
                assert.strictEqual(len, 4);
                obj[name] = readIpRaw(msg, offset);
                return offset + len;
            }

            function readString(msg, offset, obj, name) {
                //            console.log(`Read String bl = ${msg.length} offset = ${offset}, name = ${name} `)
                var len = msg.readUInt8(offset++);
                obj[name] = msg.toString('ascii', offset, offset + len);
                offset += len;
                return offset;
            }

            function readAddressRaw(msg, offset, len) {
                var addr = '';
                //            console.log(`Address Raw bl = ${msg.length} offset = ${offset}, len = ${len} `)
                while (len-- > 0) {
                    var b = 0;
                    try {
                        b = msg.readUInt8(offset++);
                    } catch (e) {
                        A.D(`buffer length = ${msg.length} offset = ${offset}, len = ${len}, err = ${e} `);
                    }
                    addr += (b + 0x100).toString(16).substr(-2);
                    if (len > 0) {
                        addr += ':';
                    }
                }
                return addr;
            }

            function createHardwareAddress(t, a) {
                return Object.freeze({
                    type: t,
                    address: a
                });
            }

            var BOOTPMessageType = ['NA', 'BOOTPREQUEST', 'BOOTPREPLY'];
            var ARPHardwareType = ['NA', 'HW_ETHERNET', 'HW_EXPERIMENTAL_ETHERNET', 'HW_AMATEUR_RADIO_AX_25', 'HW_PROTEON_TOKEN_RING', 'HW_CHAOS', 'HW_IEEE_802_NETWORKS', 'HW_ARCNET', 'HW_HYPERCHANNEL', 'HW_LANSTAR'];
            var DHCPMessageType = ['NA', 'DHCPDISCOVER', 'DHCPOFFER', 'DHCPREQUEST', 'DHCPDECLINE', 'DHCPACK', 'DHCPNAK', 'DHCPRELEASE', 'DHCPINFORM'];
            var p = {
                op: BOOTPMessageType[msg.readUInt8(0)],
                // htype is combined into chaddr field object
                hlen: msg.readUInt8(2),
                hops: msg.readUInt8(3),
                xid: msg.readUInt32BE(4),
                secs: msg.readUInt16BE(8),
                flags: msg.readUInt16BE(10),
                ciaddr: readIpRaw(msg, 12),
                yiaddr: readIpRaw(msg, 16),
                siaddr: readIpRaw(msg, 20),
                giaddr: readIpRaw(msg, 24),
                chaddr: createHardwareAddress(
                    ARPHardwareType[msg.readUInt8(1)],
                    readAddressRaw(msg, 28, msg.readUInt8(2))),
                sname: trimNulls(msg.toString('ascii', 44, 108)),
                file: trimNulls(msg.toString('ascii', 108, 236)),
                magic: msg.readUInt32BE(236),
                options: {}
            };

            var offset = 240;
            var code = 0;
            while (code !== 255 && offset < msg.length) {
                code = msg.readUInt8(offset++);
                var len;
                switch (code) {
                    case 0:
                        // eslint-disable-next-line no-continue
                        continue;
                    case 255:
                        break; // end
                    case 12:
                        { // hostName
                            offset = readString(msg, offset, p.options, 'hostName');
                            break;
                        }
                    case 50:
                        { // requestedIpAddress
                            offset = readIp(msg, offset, p.options, 'requestedIpAddress');
                            break;
                        }
                    case 53:
                        { // dhcpMessageType
                            len = msg.readUInt8(offset++);
                            assert.strictEqual(len, 1);
                            var mtype = msg.readUInt8(offset++);
                            assert.ok(mtype >= 1);
                            assert.ok(mtype <= 8);
                            p.options.dhcpMessageType = DHCPMessageType[mtype];
                            break;
                        }
                    case 58:
                        { // renewalTimeValue
                            len = msg.readUInt8(offset++);
                            assert.strictEqual(len, 4);
                            p.options.renewalTimeValue = msg.readUInt32BE(offset);
                            offset += len;
                            break;
                        }
                    case 59:
                        { // rebindingTimeValue
                            len = msg.readUInt8(offset++);
                            assert.strictEqual(len, 4);
                            p.options.rebindingTimeValue = msg.readUInt32BE(offset);
                            offset += len;
                            break;
                        }
                    case 61:
                        { // clientIdentifier
                            len = msg.readUInt8(offset++);
                            p.options.clientIdentifier =
                            createHardwareAddress(
                                ARPHardwareType[msg.readUInt8(offset)],
                                readAddressRaw(msg, offset + 1, len - 1));
                            offset += len;
                            break;
                        }
                    case 81:
                        { // fullyQualifiedDomainName
                            len = msg.readUInt8(offset++);
                            p.options.fullyQualifiedDomainName = {
                                flags: msg.readUInt8(offset),
                                name: msg.toString('ascii', offset + 3, offset + len)
                            };
                            offset += len;
                            break;
                        }
                    default:
                        {
                            len = msg.readUInt8(offset++);
                            //console.log('Unhandled DHCP option ' + code + '/' + len + 'b');
                            offset += len;
                            break;
                        }
                }
            }
            return p;
        }
        try {
            this._listener = dgram.createSocket({
                type: 'udp4',
                reuseAddr: true,
            });
            this._listener.on('close', err => {
                //                A.Wf('Dhcp Error %O',err);
                self.emit('close', err);
                self.emit('listenState', false);
                self._listener = false;
            });
            this._listener.on('error', err => {
                //                A.Wf('Dhcp Error %O',err);
                self.emit('error', err);
                self.close();
            });
            //            this._listener.on('error', e => A.W(`dhcp error on address ` + A.F(addr, e)));
            this._listener.on('message', (msg, rinfo) => {
                let data;
                try {
                    data = parseUdp(msg, rinfo);
                    //                    A.I(A.F('data udp: ', data));
                } catch (e) {
                    return A.W(A.F('error in dhcp message ' + e));
                }
                //                A.D('dhcp triggered: ' + A.O(data.options));
                if (data && data.op === 'BOOTPREQUEST' && data.options.dhcpMessageType === 'DHCPREQUEST' && !data.ciaddr && data.options.clientIdentifier) {
                    var req = {
                        hostName: data.options.hostName,
                        type: data.options.clientIdentifier.type,
                        macAddress: data.options.clientIdentifier.address,
                        ipAddress: data.options.requestedIpAddress
                    };
                    self.emit('request', req);
                }
            });
            if (this._listener) {
                //                try {
                this._listener.bind({
                    address: addr,
                    port: 67,
                    exclusive: false
                }, () => A.If('Connected with %O for DHCP Scan', addr));
                /*
                                } catch (e) {
                                    this._listener.removeAllListeners();
                                    this._listener = null;
                                    A.W('could not bind to address: ' + addr + ', had error: ' + A.O(e));
                                }
                */
            }
        } catch (e) {
            A.Wf(`could not start dhcp listener! Adapter will not be informed on new arrivals on network! %O`, e);
            try {
                if (this._listener) {
                    this._listener.removeAllListeners();
                    this._listener.close();
                    this._listener = null;
                }
            } catch (e1) {
                this._listener = null;
            }
            this._listener = null;
        }
    }
}
class Network extends EventEmitter {
    constructor(dodhcp) {
        super();
        this._dodhcp = dodhcp;
        this._init = false;
        this._listener = null;
        this._ping4session = null;
        this._ping6session = null;
        this._iflist = [];
        this._macs = null;
        this._ips = null;
        this._nif = os.networkInterfaces();
        this._iprCache = this._dnsCache = null;
        this._netping = null;
        Network.matchMac = /(([\dA-F]{2}:){5}[\dA-F]{2})/i;

    }
    get iflist() {
        return this._iflist;
    }
    get nif() {
        return this._nif;
    }

    static isIP(str) {
        if (!str)
            return 0;
        str = str.trim().toLowerCase();
        return net.isIP(str);
    }

    static isMac(str) {
        if (!str)
            return null;
        str = str.trim().toLowerCase();
        return Network.matchMac.test(str) ? str : null;
    }

    static isIP4(str) {
        if (!str)
            return null;
        str = str.trim().toLowerCase();
        return net.isIPv4(str) ? str : null;
    }

    static isIP6(str) {
        if (!str)
            return null;
        str = str.trim().toLowerCase();
        return net.isIPv6(str) ? str : null;
    }

    static getMac(ip) {
        if (!this.isIP4(ip))
            return A.resolve(null);
        let ret = null;
        try {
            ret = A.c2p(arp.getMAC)(ip);
        } catch (e) {
            A.Wf('Error %O in getMac with arp! Maybe no arp available?', e);
            return Promise.reject();
        }
        return Promise.resolve(ret).then(x => this.isMac(x) ? x : null, () => null);
    }

    static get Ping() {
        return ping;
    }

    static isLocal(address) {
        if (!Network.isIP4(address))
            return false;
        return (/10\.\d+\.\d+\.\d+/).test(address) || (/192\.168\.\d+\.\d+/).test(address) || (/172\.16\.\d+\.\d+/).test(address);
    }

    init(dhcp, pingopt) {
        var self = this;
        pingopt = pingopt || {
            retries: 4,
            //    sessionId: (process.pid % 65535),
            packetSize: 56,
            timeout: 700,
            ttl: 64
        };

        try {
            this._netping = require("net-ping");
            this._ping4session = this._netping.createSession(Object.assign(pingopt, {
                networkProtocol: this._netping.NetworkProtocol.IPv4
            }));
            this._ping6session = this._netping.createSession(Object.assign(pingopt, {
                networkProtocol: this._netping.NetworkProtocol.IPv6
            }));
            this._ping6session.mping = this._ping4session.mping = (ip, session) => {
                return new Promise((res) => {
                    // A.I(`try to ping on ${ip}:`);
                    session.pingHost(ip, function (error, target) {
                        if (error) {
                            //                        if (!(error instanceof net_ping.RequestTimedOutError))
                            //                            A.W(target + ": " + error.toString());
                            //                        A.I(`ping negative result on ${ip} was ${error}`);
                            return res(undefined);
                        }
                        //                        A.I(`ping positive result on ${ip} was ${target}`);
                        return res(target);
                    });
                }).then(x => x ? x : ping.promise.probe(ip).then(x => x && x.alive ? ip : null, () => null));
            };
        } catch (e) {
            A.I('net-ping not available! Will try to use normal ping!');
            const my = {
                mping(ip) {
                    return ping.promise.probe(ip).then(x => x && x.alive ? ip : null, () => null);
                },
                // eslint-disable-next-line no-empty-function
                close() {}
            };
            this._ping6session = this._ping4session = my;
        }


        this._dnsCache = new A.CacheP(((name) => {
            let arr = [];
            return Promise.all([
                new Promise((res, rej) => dns.resolve4(name, (err, hosts) => err ? rej(err) : res(hosts))).then(x => arr = arr.concat(x), () => null),
                new Promise((res, rej) => dns.resolve6(name, (err, hosts) => err ? rej(err) : res(hosts))).then(x => arr = arr.concat(x), () => null)
            ]).then(() => arr.length > 0 ? arr : null);
        }));

        this._iprCache = new A.CacheP(ip => A.c2p(dns.reverse)(ip).then(arr => arr.length > 0 ? arr.map(x => x.split('.')[0] !== 'fritz' && Network.isLocal(ip) && ip.split('.')[3] !== '1' ? x.split('.')[0] : x) : [], () => []));

        this.clearCache();

        for (let nif in this._nif)
            for (let addr of this._nif[nif])
                if (addr.internal !== undefined && !addr.internal) {
                    this._iflist.push([
                        nif, addr.family, addr.mac, addr.address, addr.scopeid, addr.cidr, Network.getMacVendor(addr.mac)
                    ]);
                    this.combine(addr.mac, addr.address);
                }

        if (!dhcp || self._listener) return;
        self._listener = new Dhcp();
        self._listener.on('error', e => self.emit('error', e))
            .on('listenState', s => self.emit('listenState', s))
            .on('request', (req) => {
                self.combine(req.macAddress, req.ipAddress, req.hostName);
                self.emit('request', req);
            })
            .on('close', () => self._listener && setTimeout(() => self._listener.init.bind(self._listener), 1000));
    }


    ping(ips) {
        var that = this;
        let ret = [];
        let pip = [];

        function pres(ip) {
            //            A.If('should ping %O', ip);
            ip = ip.trim();
            let session = Network.isIP(ip);
            if (!session)
                return that.dnsResolve(ip).then(list => list ? that.ping(list) : null, () => null);
            session = session === 4 ? that._ping4session : that._ping6session;
            return session.mping(ip, session).then(x => x ? ret.push(ip) : x, x => x);
        }

        //        if (typeof ips === 'string')
        if (!Array.isArray(ips))
            ips = [ips];

        for (let i of ips)
            pip.push(pres(i.trim()).catch(e => A.Wf('error in %s ping: %O', i, e)));
        return Promise.race(pip).then(() => ret, () => ret);
    }

    clearCache() {
        this._macs = new Map();
        this._ips = new Map();
        this._iprCache.clearCache();
        this._dnsCache.clearCache();
    }

    get macs() {
        return this._macs;
    }

    get ips() {
        return this._ips;
    }

    macorip(what) {
        what = what.trim().toLowerCase();
        if (Network.matchMac.test(what))
            return this._macs.get(what);
        return this._ips.get(what);
    }

    combine(mac, ip, name) {
        mac = mac.toLowerCase().trim();
        ip = ip.toLowerCase().trim();

        var names = [];
        if (!this._ips.has(ip))
            this._ips.set(ip, {});
        else names = this._ips.get(ip).names;
        if (name && !names.includes(name))
            names.push(name);
        var im = this._ips.get(ip);
        if (!im[mac]) {
            im[mac] = Network.getMacVendor(mac);
            im.names = names;
        }
        if (names.length === (name ? 1 : 0)) this.dnsReverse(ip).then(list => {
            //            if (list)
            for (let l of list)
                if (!names.includes(l))
                    names.push(l);
        });
        if (!this._macs.has(mac))
            this._macs.set(mac, {});
        var wm = this._macs.get(mac);
        if (!wm[ip]) {
            wm[ip] = names;
            wm.vendor = Network.getMacVendor(mac);
        }
    }

    dnsReverse(ip) {
        const self = this;
        return this._iprCache.cacheItem(ip).then(names => names && !names.length && self._ips.has(ip) ? self._ips.get(ip).names : names).then(names => !names ? [] : names, () => []);
    }

    dnsResolve(name) {
        return this._dnsCache.cacheItem(name);
    }

    static updateMacdb() {
        const filename = __dirname + '/lib/vendors.json';

        function readmacs() {
            return A.get('https://linuxnet.ca/ieee/oui.txt').then(res => res, () => A.get('http://standards-oui.ieee.org/oui/oui.txt').then(res => res, () => ''))
                .then(res => {
                    let n = 0;
                    let arr = res.match(/^([\da-f]{6})\s+\(base 16\)\s+(.*)$/gim);
                    if (arr && arr.length > 0)
                        for (let l of arr) {
                            let lm = l.match(/^([\da-f]{6})\s+\(base 16\)\s+(.*)$/i);
                            if (lm && lm.length >= 3)
                                macdb[lm[1].toLowerCase(++n)] = lm[2];
                        }
                    A.I('macdb has entries: ' + n);
                    return macdb;
                }).then(db => {
                    db = JSON.stringify(db);
                    return A.c2p(fs.writeFile)(filename, db, 'utf8').catch(e => A.Wf('could not write vendor file %s because of %O:', filename, e));
                }).catch(e => A.W('Could not init MacDb! ' + e));
        }
        let j;
        try {
            // eslint-disable-next-line no-sync
            j = fs.statSync(filename);
        } catch (e) {
            A.Wf('no %s, reading file from web because of error %O', filename, e);
        }
        if (j && j.size > 1000) {
            let td = Date.now() - new Date(j.mtime).getTime();
            td = td / 1000 / 60 / 60 / 24 / 30;
            A.Df('mtime of %s is %s stats are %d', filename, new Date(j.mtime), td);
            if (td >= 1)
                readmacs();
            /*
                        try {
                            // eslint-disable-next-line no-sync
                            let f = fs.readFileSync(filename, 'utf8');
                            f = JSON.parse(f);
                            if (A.ownKeys(f).length > 1000) {
                                macdb = f;
                                if (td >= 1)
                                    f = readmacs();
                                return Promise.resolve();
                            }
                        } catch (e) {
                            A.Wf('reading file %s error %O', filename, e);
                        }
            */
        }
        //        return readmacs();
        return Promise.resolve();

    }

    static getMacVendor(mac) {
        let r = Network.isMac(mac) && macdb[mac.toLowerCase().split(':').slice(0, 3).join('')];
        return r ? r : 'Vendor N/A';
    }

    ip4addrs(what) { // 0 = interface, 1 = type:IPv4/IPv6, 2=mac-address, 3= address, 
        return this._iflist.filter((addr) => addr[1] === 'IPv4').map((i) => i[what ? what : 0]);
    }

    static getExtIP() {
        let oldip = "";
        let sameip = 0;

        function getIP(site) {
            return A.get(site, 2)
                .then(chunk => {
                    const ip = chunk.trim();
                    if (ip === oldip)
                        ++sameip;
                    else
                        oldip = ip;
                    return Promise.resolve(sameip);
                }, err => A.I(`MyIP Error ${A.O(err)}`, Promise.resolve(sameip)));
        }

        return getIP('http://icanhazip.com/?x=2')
            .then(() => getIP('http://wtfismyip.com/text'))
            .then(() => sameip < 1 ? getIP('http://nst.sourceforge.net/nst/tools/ip.php') : Promise.resolve(oldip),
                err => A.I(`scanExtIP error ${A.F(err)}`, Promise.resolve("")));
    }


    arpScan(args) {
        function scan(cmd, self) {
            //            A.D(`arp-scan with ${cmd}`);
            //            var st = Date.now();
            return A.exec('arp-scan ' + cmd).then(res => {
                var r = null;
                if (res)
                    r = res.match(/([0-9.]+)\s+seconds\s+.+\s+(\d+)\s+responded/mi);
                else A.W('arp-scan maybe without rights because no data returned!');
                if (r)
                    A.D(`arp-scan ${cmd} executed for ${r[1]} seconds and returned ${r[2]} hosts.`);
                return res && res.match(/(\d+\.){3}\d+\s+([\dA-F]{2}:){5}[\dA-F]{2}/gi);
            }, e => A.W('arp-scan returned error: ' + A.O(e), null)).then(x => {
                //                A.I(`Arp-Scan found ${x}`)
                if (x) {
                    for (let y of x) {
                        var found = y.split('\t');
                        self.combine(found[1], found[0]);
                        A.N(self.emit.bind(self), 'arp-scan', found);
                    }
                }
                //             A.I(`arp-scan took ${(Date.now()-st)/1000.0}`);
            });
        }

        if (!args.indexOf('--interface='))
            return scan(args, this);
        var ifl = this.ip4addrs();
        //        A.D(`arp-scan Interfaces: ${A.F(ifl)}`);
        return Promise.all(ifl.map((i) => scan(args + ` --interface=${i}`, this)));
    }

    stop() {
        this._init = false;
        if (this._listener) this._listener.close();
        if (this._ping4session) this._ping4session.close();
        if (this._ping6session) this._ping6session.close();
        this._ping4session = this._ping6session = this._listener = null;
    }
}

exports.Network = Network;
exports.Bluetooth = Bluetooth;
exports.ScanCmd = ScanCmd;