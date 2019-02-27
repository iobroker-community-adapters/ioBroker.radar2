"use strict";

const A = require('./myAdapter').MyAdapter;

const assert = require('assert'),
    dgram = require('dgram'),
    net_ping = require("net-ping"),
    arp = require('node-arp'),
//    arping = require('arping'),
    dns = require("dns"),
    os = require('os'),
    net = require('net'),
    ip = require('ip'),

    EventEmitter = require('events').EventEmitter;


let macdb = {};

class Bluetooth extends EventEmitter {
    constructor() {
        super();
        this._nobleRunning = false;
        this._noble = null;
        this._btid = 0;
        this._len = 0;
        this._nbt = null;
        this._device = null;
        this._scan = null;
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
        const self = this;
        if (!this._device)
            return Promise.resolve([]);
        if (this._scan)
            return Promise.reject(A.W(`BT already scanning!`));
        //        A.D(`start scanning!`);
        this._scan = true;
        return A.Ptime(self._device.scan()).then(x => x < 1000 ? self._device.scan() : Promise.resolve()).then(res => ((self._scan = null), res));
    }

    init(btid, nobleTime) {
        const self = this;
        const nid = 'NOBLE_HCI_DEVICE_ID';
        this._btid = Number(btid);
        if (!nobleTime || nobleTime < 0)
            nobleTime = 10000;
        this._len = parseInt(nobleTime);

        if (isNaN(this._btid)) {
            A.W(`BT interface number not defined in config, will use '-1' to deceide for noble`);
            this._btid = -1;
        }
        //        this._hcicmd = `hcitool -i hci${btid} name `;
        //        this._l2cmd = `!sudo l2ping -i hci${btid} -c1 `;

        if (btid >= 0)
            process.env[nid] = btid;

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
        this._remName = null;
        this._nif = os.networkInterfaces();
        this._iprCache = this._dnsCache = null;
        Network.matchMac = /(([\dA-F]{2}\:){5}[\dA-F]{2})/i;

    }
    get iflist() {
        return this._iflist;
    }
    get nif() {
        return this._nif;
    }

    static isIP(str) {
        str = str.trim().toLowerCase();
        return net.isIP(str);
    }

    static isMac(str) {
        str = str.trim().toLowerCase();
        return Network.matchMac.test(str) ? str : null;
    }

    static isIP4(str) {
        str = str.trim().toLowerCase();
        return net.isIPv4(str) ? str : null;
    }

    static isIP6(str) {
        str = str.trim().toLowerCase();
        return net.isIPv6(str) ? str : null;
    }

    get remName() {
        return this._remName;
    }

    set remName(val) {
        this._remName = val;
    }

    removeName(address) {
        var self = this;
        var rn = this._remName.toLowerCase().trim();
        if (!rn)
            return address;
        if (typeof address === 'string')
            return address.toLowerCase().endsWith(rn) ? address.slice(0, -rn.length) : address;
        if (Array.isArray(address) && rn && address[0] !== rn.slice(1))
            return address.map((a) => self.removeName(a));
        return address;
    }

    init(dhcp, pingopt, removeName) {
        var self = this;
        if (removeName)
            this._remName = removeName.toLowerCase();
        pingopt = pingopt || {
            retries: 4,
            //    sessionId: (process.pid % 65535),
            packetSize: 56,
            timeout: 700,
            ttl: 64
        };

        this._dnsCache = new A.CacheP(((name) => {
            let arr = [];
            return Promise.all([
                new Promise((res, rej) => dns.resolve4(name, (err, hosts) => err ? rej(err) : res(hosts))).then(x => arr = arr.concat(x), () => null),
                new Promise((res, rej) => dns.resolve6(name, (err, hosts) => err ? rej(err) : res(hosts))).then(x => arr = arr.concat(x), () => null)
            ]).then(() => arr.length > 0 ? arr : null);
        }).bind(this));

        this._iprCache = new A.CacheP((ip) => new Promise((res, rej) => dns.reverse(ip, (err, hosts) => err ? rej(err) : res(hosts))).then(arr => arr.length > 0 ? self.removeName(arr) : [], () => []));

        this.clearCache();

        this._ping4session = net_ping.createSession(Object.assign(pingopt, {
            networkProtocol: net_ping.NetworkProtocol.IPv4
        }));
        this._ping6session = net_ping.createSession(Object.assign(pingopt, {
            networkProtocol: net_ping.NetworkProtocol.IPv6
        }));


        for (let nif in this._nif)
            for (let addr of this._nif[nif])
                if (addr.internal !== undefined && !addr.internal) {
                    this._iflist.push([
                        nif, addr.family, addr.mac, addr.address, addr.scopeid, addr.cidr, Network.getMacVendor(addr.mac)
                    ]);
                    this.combine(addr.mac, addr.address);
                }


        if (!dhcp || self._listener) return;
        /*        
                let addrs = [];
                for (let k of this._iflist)
                    if (k[1] === 'IPv4')
                        addrs.push(k[3]);
        //        if (addrs.length > 1)
                    addrs.unshift('0.0.0.0');
        //        let ac = addrs;
                //        A.I('addrs: ' + A.F(addrs));
         //       while (addrs.length && !self._listener) {
        //            this._trybind(addrs.shift());
        */
        this._trybind('0.0.0.0');
        //        }
        if (!this._listener)
            A.W(`Could not bind to any dhcp listener address 0.0.0.0:67!`);
    }

    _trybind(addr) {
        var self = this;

        function parseUdp(msg) {
            function trimNulls(str) {
                var idx = str.indexOf('\u0000');
                return (-1 === idx) ? str : str.substr(0, idx);
            }

            function readIpRaw(msg, offset) {
                //            console.log(`Read IpRaw bl = ${msg.length} offset = ${offset}`)
                if (0 === msg.readUInt8(offset))
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
                        console.log(`buffer length = ${msg.length} offset = ${offset}, len = ${len}, err = ${e} `);

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
                        continue; // pad
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
                            assert.ok(1 <= mtype);
                            assert.ok(8 >= mtype);
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
                    var req = [data.options.hostName, data.options.clientIdentifier.type, data.options.clientIdentifier.address, data.options.requestedIpAddress];
                    self.combine(data.options.clientIdentifier.address, data.options.requestedIpAddress, data.options.hostName);
                    self.emit('request', req);
                }
            });
            try {
                if (this._listener) {
                    this._listener.bind({
                        address: addr,
                        port: 67,
                        exclusive: false
                    });
                }
                A.I(`Connected for DHCP Scan on address ` + addr);
            } catch (e) {
                this._listener = null;
                A.I('could not bind to address: ' + addr + ', had error: ' + A.O(e));
            }
        } catch (e) {
            A.W(`could not start dhcp listener! Adapter will not be informed on new arrivals on network!`);
            try {
                if (this._listener) {
                    this._listener.removeAllListeners();
                    this._listener.close();
                    this._listener = null;
                }
            } catch (e) {
                this._listener = null;
            }
            this._listener = null;
        }

    }


    ping(ips) {
        var that = this;
        //        A.I(`ping ${ips}`);
        let ret = [];

        function pres(ip) {
            ip = ip.trim();
            let session = Network.isIP(ip);
            if (!session)
                return that.dnsResolve(ip).then(list => list && list[0] ? pres(list[0]) : null, () => null);
            session = session=== 4 ? that._ping4session : that._ping6session;
            return new Promise((res) => {
//                    A.I(`try to ping on ${ip}`);
                    session.pingHost(ip, function (error, target) {
                    if (error) {
                        //                        if (!(error instanceof net_ping.RequestTimedOutError))
                        //                            A.W(target + ": " + error.toString());
                        //                        A.I(`ping negative result on ${ip} was ${error}`);
                        return res(undefined);
                    }
                    //                        A.I(`ping positive result on ${ip} was ${target}`);
                    return res(ret.push(target));
                });
            });
        }
        if (typeof ips === 'string')
            ips = [ips];
        if (!Array.isArray(ips))
            return Promise.reject(`Invalid argument for network:'${JSON.stringify(ips)}'`);

        let pip = [];

        for (let i of ips)
            pip.push(pres(i.trim()));
        return Promise.all(pip).then(() => ret, () => ret);
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
            }).catch(e => A.W('Could not init MacDb! ' + e));
    }

    static getMacVendor(mac) {
        let r = macdb[mac.toLowerCase().split(':').slice(0, 3).join('')];
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
                    r = res.match(/([\d\.]+)\s+seconds\s+.+\s+(\d+)\s+responded/mi);
                else A.W('arp-scan maybe without rights because no data returned!');
                if (r)
                    A.D(`arp-scan ${cmd} executed for ${r[1]} seconds and returned ${r[2]} hosts.`);
                return res && res.match(/(\d+\.){3}\d+\s+([\dA-F]{2}\:){5}[\dA-F]{2}/gi);
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