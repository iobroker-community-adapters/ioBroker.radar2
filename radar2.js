/**
 *      iobroker radar2 Adapter
 *      (c) 2016- <frankjoke@hotmail.com>
 *      MIT License
 *      v 0.1.0 Feb 2019
 */
/* eslint-env node,es6 */
/*jslint node: true, bitwise: true, sub:true */

"use strict";

// you have to require the utils module and call adapter function
const utils = require(__dirname + '/lib/utils'); // Get common adapter utils
//const timeago = require('time-ago');

// you have to call the adapter function and pass a options object
// name has to be set and has to be equal to adapters folder name and main file name excluding extension
// adapter will be restarted automatically every time as the configuration changed, e.g system.adapter.template.0
let adapter;

function startAdapter(options) {
    options = options || {};
    Object.assign(options, {
        name: 'radar2'
    });
    adapter = new utils.Adapter(options);
    return adapter;
}

const MA = require('./myAdapter'),
    A = MA.MyAdapter,
    Network = require('./myNetwork').Network,
    Bluetooth = require('./myNetwork').Bluetooth;

const xml2js = require('xml2js');

const scanList = {},
    ipList = {},
    macList = {},
    btList = {};
var scanDelay = 30 * 1000; // in ms = 30 sec
var printerDelay = 100;
var delayAway = 10;
var host = null;
var arpcmd = null;
var doArp = true;
var doUwz = null;
var ukBt = {};
var ukIp = {};
let knownIPs = [];
let knownBTs = [];
var wlast = null,
    lang = '',
    numuwz = 0,
    delayuwz = 0,
    longuwz = false,
    btid = 0,
    devices = null;


// If started as allInOne/compact mode => return function to create instance
if (module && module.parent) {
    module.exports = startAdapter;
} else {
    // or start the instance directly
    startAdapter();
}

A.init(adapter, main);

function xmlParseString(body) {
    function parseNumbers(str) {
        if (!isNaN(str))
            str = str % 1 === 0 ? parseInt(str) : parseFloat(str);
        return str;
    }

    function tagnames(item) {
        let all = item.split(':');
        item = (all.length === 2) ? all[1] : all[0];
        //            A.I(`Tag: all: ${A.O(all)} became ${item}`);                
        return item;
    }
    return (A.c2p(new xml2js.Parser({
            explicitArray: false,
            trim: true,
            tagNameProcessors: [tagnames],
            //                attrNameProcessors: [tagnames],
            valueProcessors: [parseNumbers]
        })
        .parseString))(body);
}

function scanExtIP() {
    let oldip = "";
    return Network.getExtIP()
        .then(ip => {
            oldip = ip;
            return A.getState('_ExternalNetwork.IP4');
        })
        .then(x => x, () => Promise.resolve())
        .then(state => {
            var time = Date.now();
            if (state && state.val)
                state = state.val;
            if (oldip !== '' && state !== oldip) {
                A.I(`New external IP address ${oldip}`, oldip);
                A.makeState('_ExternalNetwork.lastChanged', new Date(time).toString());
            } else if (oldip === '') {
                return A.makeState('_ExternalNetwork.lastChanged', A.W(`Not connected to external network!`, 0));
            } else
                A.D(`Same external IP address ${oldip}`);
            return A.makeState('_ExternalNetwork', oldip);
            //                .then(() => A.makeState('ExternalNetwork.status', ++sameip));
        }, err => A.I(`scanExtIP error ${A.O(err)}`, Promise.resolve()));
}

function scanECBs() {
    function scanECB(item) {
        if (item.type !== 'ECB')
            return Promise.resolve();
        let idn = item.id + '.';
        //    A.I(`ScanECB: ${item.id}`);
        return A.get('https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml', 2)
            .then(body => xmlParseString(body))
            //        .then(res => A.I(`ECB returned: ${A.O(res,5)}`,res))
            .then(ecb => A.makeState(item.id, ecb.Envelope.Cube.Cube.$.time).then(() => ecb))
            .then(ecb =>
                A.seriesOf(ecb.Envelope.Cube.Cube.Cube, cur => {
                    let ccur = cur.$.currency;
                    let rate = parseFloat(cur.$.rate);
                    if (item.ip.indexOf(ccur) < 0)
                        return Promise.resolve();
                    return A.makeState(idn + ccur, rate);
                }, 5).then(() => ecb, () => ecb))
            .catch(err => A.W(`ECB error: ${A.O(err)}`));
    }
    return A.seriesOf(devices, (item) => scanECB(item), 1);
}

function scanHPs() {
    return A.seriesOf(devices, (item) => {
        if (item.type !== 'printer')
            return A.resolve();

        let idn = item.id + '.';
        let below10 = [];
        return A.get('http://' + item.ip + '/DevMgmt/ConsumableConfigDyn.xml', 2)
            .then(body => xmlParseString(body.trim()))
            //        .then(result => A.I(`parser ${A.O(result,3)}`,result))
            .then(result => result.ConsumableConfigDyn ? result.ConsumableConfigDyn : result)
            .then(result => A.seriesOf(result.ConsumableInfo, item => {
                    if (item.ConsumableTypeEnum !== "ink")
                        return A.resolve('No Ink');
                    //                    A.I(`parser ${A.O(item)}`);
                    let p = "P" + item.ConsumableStation,
                        lc = item.ConsumableLabelCode,
                        idnc = idn + 'ink.' + lc,
                        d = item.Installation ? item.Installation.Date : null,
                        l = parseInt(item.ConsumablePercentageLevelRemaining),
                        ci = item.ConsumableIcon,
                        s = ci.Shape,
                        fc = ci.FillColor,
                        rgb = fc.Blue | (fc.Green << 8) | (fc.Red << 16),
                        n = item.ConsumableSelectibilityNumber;
                    rgb = '#' + (0x1000000 + rgb).toString(16).slice(1);
                    let ss = `${p} = ${lc}, ${d ? d + ',' : ''} ${l}%, ${n}, ${rgb}, ${s}`;
                    if (l <= 10)
                        below10.push(lc);
                    //                A.I(`printer ${idn} = ${below10}`);
                    return A.makeState(idnc, ss);
                }, 1)
                .then(() => A.makeState(idn + 'ink', below10.length > 0 ? below10.join(', ') : 'All >10%'))
                .then(() => A.makeState(item.id, '' + new Date())))
            .catch(err => A.D(`HP Printer could not find info! Err: ${A.O(err)}`));
    }, 0);
}

function setItem(item) {
    let wasanw = item.anwesend;
    let lasthere = item.lasthere;
    let anw = true;
    let idn = item.id;
    const here = (item.ipHere && item.btHere) ? (item.btHere > item.ipHere ? item.btHere : item.btHere) : item.ipHere || item.btHere;
    if (here) {
        item.lasthere = here;
    } else {
        let n = Date.now();
        if (!lasthere)
            lasthere = item.lasthere = new Date(n - (delayAway * 1000 * 59));

        let d = n - lasthere.getTime();
        //                    A.I(A.F('item ',item.name, item.lasthere, d));
        if (d > (delayAway * 1000 * 60))
            anw = false;
    }
    if (!item.lasthere)
        item.lasthere = new Date(Date.now() - (delayAway * 1000 * 60 * 10));
    if (anw !== wasanw || lasthere !== item.lasthere) {
        item.anwesend = anw;
        //        A.I(A.F('lasthere:',item.lasthere, ' locDate:', A.dateTime(item.lasthere),' anwesend:', anw, ' iphere: ',!!item.ipHere, ' bthere:',!!item.btHere))
        A.makeState(idn + '.lasthere', A.dateTime(item.lasthere))
            .then(() => A.makeState(item.id, anw))
            .then(() => A.makeState(idn + '.here', (item.ipHere ? 'IP' : '') + (item.btHere ? (item.ipHere ? ', ' : '') + 'BT' : '')));
        //            .then(() => item.hasIP ? A.makeState(idn + '.ipHere', !!item.ipHere) : false)
        //            .then(() => item.hasBT ? A.makeState(idn + '.btHere', !!item.btHere) : false);
    }
}

function foundIpMac(what) {
    let found = false;
    if (what.ipAddress) {
        let ip = what.ipAddress = what.ipAddress.toLowerCase();
        let item = ipList[ip];
        found = true;
        if (item) {
            item.ipHere = new Date();
            setItem(item);
        } else {
            if (knownIPs.indexOf(ip) < 0)
                ukIp[ip] = what;
            network.dnsReverse(ip).then(names => what.hosts = names, () => null);
        }
    }
    if (what.macAddress && Network.isMac(what.macAddress)) {
        let mac = what.macAddress = what.macAddress.toLowerCase();
        let item = macList[mac];
        if (found)
            network.combine(mac, what.ipAddress, what.hostName);
        what.getMacVendor = Network.getMacVendor(mac);
        if (item) {
            item.ipHere = new Date();
            setItem(item);
        } else if (!found && knownIPs.indexOf(mac) < 0)
            ukIp[mac] = what;
    }
    //    A.D(A.F('ip notf', what));
}

function foundBt(what) {
    const mac = what.address.toLowerCase();
    let item = btList[mac];
    if (item) {
        item.btHere = new Date();
        setItem(item);
    } else {
        what.btVendor = Network.getMacVendor(mac);
        if (knownBTs.indexOf(mac) < 0)
            ukBt[mac] = what;
        //        A.D(A.F('bt notf', what));
    }
}

A.unload = () => {
    network.stop();
    bluetooth.stop();
};

function scanAll() {
    //    A.D(`New scan stated now.`);

    return Promise.all(
            [
                (A.ownKeys(btList).length ? Promise.all([bluetooth.startNoble(scanDelay * 0.7), bluetooth.startScan()]) : A.wait(4)),
                (doArp && A.ownKeys(macList).length + A.ownKeys(ipList).length ?
                    network.arpScan(arpcmd).then(() => A.seriesInOI(scanList, item => item.btHere || item.ipHere || !item.rip ? Promise.resolve() : network.ping(item.rip).then(x => x ? x.forEach(i => foundIpMac({
                        ipAddress: i,
                        by: 'ping'
                    })) : null, () => null), 0)) :
                    A.wait(5))
            ]).then(() => {
            //            A.D(`Promise all  returned ${res}  ${res}:${A.O(res)}`);
            let whoHere = [];
            let allHere = [];
            let notHere = [];
            for (let x in scanList) {
                let item = scanList[x];
                if (item.type !== 'IP' && item.type !== 'BT')
                    continue;
                if (item.anwesend) {
                    allHere.push(item.id);
                    if (item.name === item.id)
                        whoHere.push(item.id);
                } else notHere.push(item.id);
            }
            //            let wh = whoHere.join(', ');
            //            if (oldWhoHere !== wh) {
            //                oldWhoHere = wh;
            //                A.I(`ScanAll: From all ${allhere.length} devices dedected ${countHere} are whoHere: ${wh}`);
            //            }
            allHere = allHere.join(', ');
            notHere = notHere.join(', ');
            whoHere = whoHere.join(', ');
            A.D(`radar found here (${allHere}), who here (${whoHere}) and not here (${notHere})`);
            return A.makeState('_nHere', whoHere.split(', ').length)
                .then(() => A.makeState('_allHere', allHere))
                .then(() => A.makeState('_notHere', notHere))
                .then(() => A.makeState('_isHere', whoHere));
        }).then(() => A.D(`radar2 found uBT's: ${A.ownKeysSorted(ukBt)}`, A.D(`radar2 found uIP's: ${A.ownKeysSorted(ukIp)}`)), () => null)
        .then(() => A.seriesIn(ukBt, (mac) => A.makeState('_uBTs.' + mac, A.O(ukBt[mac]))).then(() => A.makeState('_uBTs', A.O(A.ownKeysSorted(ukBt)))))
        .then(() => A.seriesIn(ukIp, (ip) => A.makeState('_uIPs.' + ip.split('.').join('_'), A.O(ukIp[ip]))).then(() => A.makeState('_uIPs', A.O(A.ownKeysSorted(ukIp)))))
        .catch(err => A.W(`Scan devices returned error: ${A.O(err)}`))
        .then(() => {
            for (let item in scanList)
                scanList[item].ipHere = scanList[item].btHere = null;
            ukBt = {};
            ukIp = {};
        });

}

function getUWZ() {
    A.get('http://feed.alertspro.meteogroup.com/AlertsPro/AlertsProPollService.php?method=getWarning&language=de&areaID=' + doUwz, 2)
        .then(body => JSON.parse(body))
        .then(data => {
            var w = data && data.results;
            if (!w)
                return A.reject('UWZ data err: ' + A.O(data));
            //            A.W(`${A.O(w,5)}`);
            return w.map(i => (lang === 'de' ?
                (longuwz ? i.payload.translationsLongText.DE : i.payload.translationsShortText.DE) :
                (longuwz ? i.payload.longText : i.payload.shortText)) + (longuwz ? ': ' + i.payload.levelName : ''));
        })
        .then(w => {
            let wl = w.length,
                wt = w.join(numuwz < 0 ? '<br>\n' : '\n');
            wt = wt === '' ? "No warnings" : wt;
            if (wt !== wlast) {
                wlast = wt;
                A.I(`UWZ found the following (changed) warnings: ${wt}`);
                if (numuwz > 0) {
                    return A.seriesOf(Object.keys(w), (x) => x < numuwz ? A.makeState('_UWZ' + x, w[x]) : A.resolve())
                        .then(() => {
                            let n = wl,
                                l = [];

                            while (n < numuwz)
                                l.push(n++);
                            return A.seriesOf(l, (x) => A.makeState('_UWZ' + x, ''));
                        });
                } else
                    return A.makeState('_UWZ', wlast);
            }
        })
        .catch(e => A.W(`Error in getUWZ: ${e}`));
}

const network = new Network();
const bluetooth = new Bluetooth();
network.on('request', items => foundIpMac({
    ipAddress: items[3],
    macAddress: items[2],
    hostName: items[0],
    by: 'dhcp'
}));
network.init(true);

function main() {
    host = adapter.host;

    if (!A.C.devices.length) {
        A.W(`No to be scanned devices are configured for host ${host}! Will stop Adapter`);
        return A.stop(true);
    }

    btid = Number(adapter.config.btadapterid);
    if (isNaN(btid)) {
        A.W(`BT interface number not defined in config, will use '0'`);
        btid = 0;
    }
    //    hcicmd = `hcitool -i hci${btid} name `;
    //    l2cmd = `!sudo l2ping -i hci${btid} -c1 `;

    for (let st of A.ownKeys(A.states))
        delete A.states[st];
    if (!A.C.scandelay || parseInt(A.C.scandelay) < 15)
        A.C.scandelay = 15;
    scanDelay = A.C.scandelay * 1000;

    network.on('arp-scan', found => foundIpMac({
        ipAddress: found[0],
        macAddress: found[1]
    }));

    bluetooth.init(btid, scanDelay * 0.7);
    bluetooth.on('found', what => foundBt(what));

    //    bluetooth.on('stateChange', (what) => A.D(`Noble state changed: ${what}`));

    if (!A.C.delayaway || parseInt(A.C.delayaway) < 2)
        A.C.delayaway = 2;
    delayAway = A.C.delayaway;

    if (!A.C.printerdelay || parseInt(A.C.printerdelay) < 100)
        A.C.printerdelay = 100;
    printerDelay = parseInt(A.C.printerdelay);

    let as = A.C.arp_scan_cmd;
    if (as && as.startsWith('!')) {
        as = as.slice(1);
        A.debug = true;
    }

    if (A.C.knownBTs)
        knownBTs = A.C.knownBTs.split(',').map(i => i.trim());
    A.I(A.F('use known BT list: ', knownBTs));

    if (A.C.knownIPs)
        knownIPs = A.C.knownIPs.split(',').map(i => i.trim());
    A.I(A.F('use known IP list: ', knownIPs));

    if (A.C.removeEnd)
        network.remName = A.C.removeEnd;
    if (network.remName)
        A.I(A.F('Remove name end for ost names: ', network.remName));

    var numecb = 0,
        numhp = 0,
        numip = 0,
        numbt = 0;

    A.timer = [];
    arpcmd = ((as && as.length > 0) ?
        as : A.W(`arp-scan cmd line not configured in config! Will use '-lgq --retry=4 --timeout=400'`, '-lgq --retry=4 --timeout=400'));

    A.I(`radar set to scan every ${A.C.scandelay} sec and printers every ${printerDelay} scans.`);

    devices = A.C.devices;

    //    A.exec(`!${btbindir}bluetoothview /scomma ${btbindir}btf.txt`).then(x => doBtv = x && x.length > 0, () => doBtv = false)
    A.wait(100)
        .then(() => A.isApp('arp-scan').then(x => x ? A.exec('sudo arp-scan').then(x => x ? `"${arpcmd}" on ${network.ip4addrs()}` : false, () => A.W("Adapter nut running as root or iobroker has no sudo right, cannot use arp-scan!")) : false)
            .then(x => doArp = x))
        //        .then(() => A.isApp('hcitool').then(x => doHci = x))
        .then(() => {
            return A.seriesOf(devices, item => {
                //                A.I(`checking item ${A.O(item)}`);
                if (item.name)
                    item.name = item.name.trim().replace(/[\s\.]/g, '_');
                if (!item.name || item.name.length < 2)
                    return Promise.resolve(A.W(`Invalid item name '${A.O(item.name)}', must be at least 2 letters long`));
                if (scanList[item.name])
                    return Promise.resolve(A.W(`Double item name '${item.name}', names cannot be used more than once!`));
                item.id = item.name.endsWith('-') ? item.name.slice(0, -1) : item.name;
                item.ip = item.ip ? item.ip.trim() : '';
                item.macs = item.macs ? item.macs.trim().toLowerCase() : '';
                item.macs.split(',').forEach(val => {
                    const mac = val && (typeof val === 'string') ? val.trim().toLowerCase() : null;
                    if (mac) {
                        if (Network.isMac(mac)) {
                            item.hasMAC = item.hasMAC ? item.hasMAC.push(mac) : [mac];
                            if (macList[mac]) A.W(`mac address ${mac} in ${item.name} was used already for another device ${macList[mac].name}, this is forbidden!`);
                            else macList[mac] = item;
                        } else
                            A.W(`invalid MAC address in ${item.name}: '${val}'`);
                    }
                });
                item.bluetooth = item.bluetooth ? item.bluetooth.trim().toLowerCase() : '';
                if (Network.isMac(item.bluetooth)) {
                    if (btList[item.bluetooth])
                        A.W(`bluetooth address ${item.bluetooth} in ${item.name} was used already for another device ${btList[item.bluetooth].name}, this is forbidden!`);
                    else {
                        btList[item.bluetooth] = item;
                        item.hasBT = true;
                        item.type = 'BT';
                        item.btVendor = Network.getMacVendor(item.bluetooth);
                        numbt++;
                    }
                } else if (item.bluetooth !== '')
                    A.W(`Invalid bluetooth address '${item.bluetooth}', 6 hex numbers separated by ':'`);
                if (item.ip && item.name.startsWith('HP-')) {
                    item.type = 'printer';
                    numhp++;
                } else if (item.ip && item.name.startsWith('ECB-')) {
                    item.type = 'ECB';
                    numecb++;
                } else if (item.ip.startsWith('http'))
                    item.type = 'URL';
                else if (Network.isIP4(item.ip) || Network.isIP6(item.ip)) {
                    item.rip = item.ip;
                    if (ipList[item.ip])
                        A.W(`ip address ${item.ip} in ${item.name} was used already for another device ${ipList[item.ip].name}, this is forbidden!`);
                    else(ipList[item.ip]) = item;
                    numip++;
                    item.type = 'IP';
                } else if (item.ip.length > 1) {
                    numip++;
                    item.type = 'IP';
                    network.dnsResolve(item.ip).then(x => {
                        if (x && x.length > 0) {
                            item.rip = x;
                            x.forEach((ip) => ipList[ip] ? A.W(`ip address ${ip} in ${item.name} was used already for another device ${ipList[ip].name}, this is forbidden!`) : (ipList[ip] = item));
                        }
                        return null;
                    });
                } else if (!item.hasBT)
                    return A.resolve(A.W(`Invalid Device should have IP or BT set ${A.O(item)}`));
                scanList[item.name] = item;
                A.I(`Init item ${item.name} with ${A.O(item)}`);
                return A.resolve(item.id);
            }, 50);
        }).then(() => parseInt(A.C.external) > 0 ? scanExtIP() : Promise.resolve())
        .then(() => A.I(`Adapter identified macs: (${A.ownKeys(macList)}), \nbts: (${A.ownKeys(btList)}), \nips: (${A.ownKeys(ipList)})`))
        .then(() => A.getObjectList({
            include_docs: true
        }))
        .then(res => {
            var r = {};
            if (!A.C.delayuwz || parseInt(A.C.delayuwz) <= 0)
                return A.resolve(A.I(`No UWZ warning because of Delay is ${A.C.delayuwz}`));
            delayuwz = parseInt(A.C.delayuwz);
            numuwz = parseInt(A.C.numuwz);
            longuwz = Boolean(A.C.longuwz);
            res.rows.map(i => r[i.doc._id] = i.doc);
            if (r['system.config'] && r['system.config'].common.language)
                lang = r['system.config'].common.language;
            if (r['system.config'] && r['system.config'].common.latitude) {
                A.C.latitude = parseFloat(r['system.config'].common.latitude);
                A.C.longitude = parseFloat(r['system.config'].common.longitude);
                return A.get(`http://feed.alertspro.meteogroup.com/AlertsPro/AlertsProPollService.php?method=lookupCoord&lat=${A.C.latitude}&lon=${A.C.longitude}`, 2)
                    .then(res => JSON.parse(res)[0], e => A.W(`Culd not get UWZ Area ID: ${e} for Laenge: ${A.C.longitude} Breite: ${A.C.latitude}`, null))
                    .then(res => {
                        doUwz = res && res.AREA_ID ? res.AREA_ID : null;
                        if (doUwz && delayuwz > 0) {
                            A.I(A.F('will scan UWZ every ', delayuwz, ' minutes'));
                            A.timer.push(setInterval(getUWZ, delayuwz * 1000 * 60));
                            return getUWZ();
                        }
                        return A.resolve();
                    });
            } else return A.reject(A.W('No geo location data found configured in admin to calculate UWZ AREA ID!'));
        }).catch(() => null)
        .then(() => {
            if (numecb && parseInt(A.C.external) > 0) {
                A.I(A.F('Will scan ECB (for ', numecb, 'devices) every ', A.C.external, ' minutes'));
                A.timer.push(setInterval(scanECBs, parseInt(A.C.external) * 1000 * 60));
                return scanECBs().catch(() => null);
            }
            return A.resolve();
        }).then(() => {
            if (numhp && printerDelay > 0) {
                A.I(A.F('will scan printers (for ', numhp, ' items) every ', printerDelay, ' minutes'));
                A.timer.push(setInterval(scanHPs, printerDelay * 1000 * 60));
                return scanHPs();
            }
            return A.resolve();
        }).then(() => {
            A.I(`radar adapter initialized ${Object.keys(scanList).length} devices, ExternalNetwork = ${A.C.external}.`);
            A.I(`radar set use of noble(${!!bluetooth.hasNoble}), doArp(${doArp}), btid(${btid}) and doUwz(${doUwz},${delayuwz},${numuwz},${lang},${longuwz}).`);
            return A.Ptime(scanAll()).then(ms => {
                A.I(`first scan took ${ms/1000} seconds`);
                if (scanDelay <= ms)
                    scanDelay = A.W(`scanDelay increased to ${(ms+2000)/1000} seconds!`, ms + 2000);
                A.timer.push(setInterval(scanAll, scanDelay));
                if (parseInt(A.C.external) > 0) {
                    A.I(A.F('will scan external network every ', A.C.external, ' minutes'));
                    A.timer.push(setInterval(scanExtIP, parseInt(A.C.external) * 1000 * 60));
                    return scanExtIP();
                }
                return A.resolve();
            }); // scan first time and generate states if they do not exist yet
        })
        //        .then(() => A.I(A.F(A.sstate)))
        //        .then(() => A.I(A.F(A.ownKeysSorted(A.states))))
        .then(() => A.getObjectList({
            startkey: A.ain,
            endkey: A.ain + '\u9999'
        }))
        .then(res => A.seriesOf(res.rows, item => { // clean all states which are not part of the list
            //            A.I(`Check ${A.O(item)}`);
            let id = item.id.slice(A.ain.length);
            //            A.I(`check state ${item.id} and ${id}: ${A.states[item.id]} , ${A.states[id]}`);
            if (A.states[item.id] || A.states[id])
                return Promise.resolve();
            //            A.I(`Delete ${A.O(item)}`);
            return A.deleteState(id)
                .then(() => A.D(`Del State: ${id}`), err => A.D(`Del State err: ${A.O(err)}`)) ///TC
                .then(() => A.delObject(id))
                .then(() => A.D(`Del Object: ${id}`), err => A.D(`Del Object err: ${A.O(err)}`)); ///TC
        }, 10))
        .catch(err => {
            A.W(`radar initialization finished with error ${A.O(err)}, will stop adapter!`);
            A.stop(1);
        })
        .then(() => A.I('Adapter initialization finished!'));
}