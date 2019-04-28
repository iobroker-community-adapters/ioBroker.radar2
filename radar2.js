/**
 *      iobroker radar2 Adapter
 *      (c) 2016- <frankjoke@hotmail.com>
 *      MIT License
 *      v 1.0.2 March 2019
 */
/* eslint-env node,es6 */
/*jslint node: true, bitwise: true, sub:true */
/* @ts-ignore:80006 */

"use strict";

const A = require('@frankjoke/myadapter').MyAdapter,
    Network = require('./myNetworks').Network,
    Bluetooth = require('./myNetworks').Bluetooth,
    xml2js = require('xml2js');

A.init(module, 'radar2', main);


const scanList = {},
    ipList = {},
    macList = {},
    btList = {},
    network = new Network(),
    bluetooth = new Bluetooth();
let scanDelay = 30 * 1000, // in ms = 30 sec
    printerDelay = 100,
    delayAway = 10,
    arpcmd = null,
    doArp = true,
    doUwz = null,
    ukBt = {},
    ukIp = {},
    knownIPs = [],
    knownBTs = [],
    wlast = null,
    lang = '',
    numuwz = 0,
    delayuwz = 0,
    longuwz = false,
    btid = 0,
    scanBt = false,
    devices = null;

function xmlParseString(body) {
    return (A.c2p(new xml2js.Parser({
            explicitArray: false,
            trim: true,
            tagNameProcessors: [item => ((item = item.split(':')), item.length == 2 ? item[1] : item[0])],
            //                attrNameProcessors: [tagnames],  // can but not must be same as tagNameProcessor 
            valueProcessors: [str => !isNaN(str) ? (str % 1 === 0 ? parseInt(str) : parseFloat(str)) : str]
        })
        .parseString))(body);
}

function scanExtIP() {
    let oldip = "";
    return Network.getExtIP()
        .then(ip => {
            oldip = ip;
            return A.getState('_ExternalNetwork');
        })
        .then(x => x, () => undefined)
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
                    let ss = `${l}%, ${p}=${lc}, ${d ? d + ',' : ''}  ${n}, ${rgb}, ${s}`;
                    if (l <= 10)
                        below10.push(lc);
                    //                A.I(`printer ${idn} = ${below10}`);
                    return A.makeState(idnc, ss);
                }, 1)
                .then(() => A.makeState(idn + 'ink', below10.length > 0 ? below10.join(', ') : 'All >10%'))
                .then(() => A.makeState(item.id, '' + A.dateTime(new Date()))))
            .catch(err => A.D(`HP Printer could not find info! Err: ${A.O(err)}`));
    }, 0);
}


/// @name getUWZ
/// @return Promise
/// 
function getUWZ() {
    A.get('http://feed.alertspro.meteogroup.com/AlertsPro/AlertsProPollService.php?method=getWarning&language=de&areaID=' + doUwz, 2)
        //        .then(x => A.Ir(x,'GetUWZ returned %O',x))
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


/// @name setItem
/// Process any scanlist item after lasthere for ipHere or btHere was set to new Date
/// 
/// @param {item from scanList} item - scanlist entry which found to be here. 
function setItem(item) {
    let wasanw = item.anwesend;
    let lasthere = item.lasthere;
    let anw = true;
    let idn = item.id;
    const here = (item.ipHere && item.btHere) ? (item.btHere > item.ipHere ? item.btHere : item.btHere) : item.ipHere || item.btHere;
    if (here) {
        item.lasthere = here;
        //        A.I(A.F('item:',item.id,', anw:',anw, ', bht', item.btHere, ', iph: ',item.ipHere,', itemlh:', item.lasthere));
    } else {
        let n = Date.now();
        if (!lasthere)
            lasthere = item.lasthere = new Date(n - (delayAway * 1001 * 60));

        n -= lasthere.getTime();
        //                    A.I(A.F('item ',item.name, item.lasthere, d));
        if (n > (delayAway * 1000 * 60))
            anw = false;
    }
    //    if (!item.lasthere)
    //        item.lasthere = new Date(Date.now() - (delayAway * 1000 * 60 * 10));
    //    A.I(A.F('item:',item.id,', anw:',anw, ', bht', item.btHere, ', iph: ',item.ipHere,', anwesend', item.anwesend, ', lasthere: ',lasthere, ', itemlh:', item.lasthere));
    if (item.anwesend !== anw || anw !== wasanw || lasthere !== item.lasthere) {
        item.anwesend = anw;
        //        A.I(A.F('lasthere:',item.lasthere, ' locDate:', A.dateTime(item.lasthere),' anwesend:', anw, ' iphere: ',!!item.ipHere, ' bthere:',!!item.btHere))
        A.makeState(idn + '._lastHere', A.dateTime(item.lasthere)).catch(A.nop)
            //        A.makeState(idn + '.lasthere', item.lasthere)
            .then(() => A.makeState(item.id, anw)).catch(A.nop)
            .then(() => A.makeState(item.id + '._here', anw)).catch(A.nop);
        //            .then(() => A.makeState(idn + '.here', (item.ipHere ? 'IP ' : '') + (item.btHere ? 'BT' : '')))
        //            .then(() => item.hasIP ? A.makeState(idn + '.ipHere', !!item.ipHere) : false)
        //            .then(() => item.hasBT ? A.makeState(idn + '.btHere', !!item.btHere) : false);
    }
}

/// @name foundIpMac
/// 
/// 
/// @param {object} what - object with one or more of {ipAddress, macAddress, by, ... } 
/// @returns {void} - 
function foundIpMac(what) {
    //    A.D(`found: ` + A.O(what));
    let found = false;
    let ip = what.ipAddress && Network.isIP(what.ipAddress) && what.ipAddress.trim().toLowerCase();
    let mac = what.macAddress && Network.isMac(what.macAddress) && what.macAddress.trim().toLowerCase();
    //    if (what.macAddress === 'dc:53:60:e6:e8:94')
    //        debugger;
    if (ip) {
        what.ipAddress = ip;
        let item = ipList[ip];
        if (item) {
            found = true;
            if (knownIPs.indexOf(ip) < 0)
                knownIPs.push(ip);
            if (!item.ipHere) {
                item.ipHere = new Date();
                setItem(item);
            }
        }
    }
    if (mac) {
        let mac = what.macAddress = what.macAddress.toLowerCase();
        let item = macList[mac];
        if (ip)
            network.combine(mac, ip, what.hostName);
        what.getMacVendor = Network.getMacVendor(mac);
        //        A.Df('found mac %s of %O: %O', mac, what, item);
        if (item) {
            found = true;
            if (knownIPs.indexOf(mac) < 0)
                knownIPs.push(mac);

            if (ip && knownIPs.indexOf(ip)) {
                knownIPs.push(mac);
                network.combine(mac, ip);
            }
            if (!item.ipHere) {
                item.ipHere = new Date();
                setItem(item);
            }
        }
    }
    if (!found) {
        if ((ip && knownIPs.indexOf(ip) < 0) && (mac && knownIPs.indexOf(mac) < 0))
            ukIp[ip] = what;
        network.dnsReverse(ip).then(names => what.hosts = names, () => null);
    }
}
/// @name foundBt
/// 
/// 
/// @param {object} what - object with one or more of {address, by, ... } 
function foundBt(what) {
    const mac = what.address.toLowerCase();
    let item = btList[mac];
    if (item) {
        if (!item.btHere) {
            item.btHere = new Date();
            setItem(item);
        }
    } else {
        what.btVendor = Network.getMacVendor(mac);
        if (knownBTs.indexOf(mac) < 0)
            ukBt[mac] = what;
        //        A.D(A.F('bt notf', what));
    }
}

function scanAll() {
    //    A.D(`New scan stated now.`);
    let whoHere = [];
    let allHere = [];
    let notHere = [];

    const prom = [];
    const btl = scanBt && A.ownKeys(btList).length;

    //    prom.push(btl ? bluetooth.startNoble(scanDelay * 0.8).catch(e => A.W(`noble error: ${A.O(e)}`)) : A.wait(1));
    prom.push(btl ? bluetooth.startScan().catch(e => A.W(`bl scan error: ${A.O(e)}`)) : A.wait(1));
    prom.push(A.seriesInOI(scanList, item => item.type === 'URL' ? A.get(item.ip.trim()).then(() => setItem(item, (item.ipHere = new Date()))).catch(e => e) : A.resolve(), 1));
    if (A.ownKeys(macList).length + A.ownKeys(ipList).length)

        prom.push((doArp ? network.arpScan(arpcmd) : A.wait(1))
            .then(() => {
                return A.seriesInOI(scanList, it => {
                    if (!it.btHere && !it.ipHere && it.rip && it.rip.length > 0) {
                        //                        A.Df('check unreached %s: %O', it.name, it);
                        return A.wait(0).then(() => network.ping(it.rip)).then(x => x ? x.forEach(i => foundIpMac({
                            ipAddress: i,
                            by: 'ping'
                        })) : null).catch(e => A.W(`ping error: ${A.O(e)}`));
                    }
                    return Promise.resolve();
                }, 1);
            }).catch(e => A.W(`ping error: ${A.O(e)}`)));

    return Promise.all(prom)
        .then(() => A.wait(50))
        .then(() => A.seriesInOI(scanList, item => {
            //            A.D(`Promise all  returned ${res}  ${res}:${A.O(res)}`);
            if (item.type !== 'IP' && item.type !== 'BT' && item.type !== 'URL')
                return A.resolve();

            let d = new Date(),
                n = d.getTime();
            if (!item.lasthere)
                item.lasthere = new Date(n - (delayAway * 1001 * 60));

            let dd = n - item.lasthere.getTime();
            //                    A.I(A.F('item ',item.name, item.lasthere, d));
            if (dd > (delayAway * 1000 * 60))
                item.anwesend = false;
            if (item.anwesend) {
                allHere.push(item.id);
                if (item.name === item.id)
                    whoHere.push(item.id);
            } else {
                notHere.push(item.id);
            }
            //            A.I(A.F('item:',item.id,',  anwesend', item.anwesend, ', here: ',item.here, ', dd: ',dd, ', itemlh:', item.lasthere));
            return A.makeState(item.id, item.anwesend, true).catch(e => A.W(`makesatte error: ${A.O(e)}`))
                .then(() => A.makeState(item.id + '._here', item.anwesend, true)).catch(A.nop);
        }, 1).catch(e => A.W(`checkhere error: ${A.O(e)}`)))
        .then(() => {
            //            let wh = whoHere.join(', ');
            //            if (oldWhoHere !== wh) {
            //                oldWhoHere = wh;
            //                A.I(`ScanAll: From all ${allhere.length} devices dedected ${countHere} are whoHere: ${wh}`);
            //            }
            return A.makeState('_nHere', whoHere.length)
                .then(() => {
                    allHere = allHere.join(', ');
                    notHere = notHere.join(', ');
                    whoHere = whoHere.join(', ');
                    A.D(`radar2 found here (${allHere})`);
                    A.D(`and who here (${whoHere})`);
                    A.D(`and not here (${notHere})`);
                })
                .then(() => A.makeState('_allHere', allHere))
                .then(() => A.makeState('_notHere', notHere))
                .then(() => A.makeState('_isHere', whoHere));
        }).then(() => A.Df("radar2 found uBT's: %O", A.ownKeysSorted(ukBt)), A.Df("radar2 found uIP's: %O", A.ownKeysSorted(ukIp)), () => null)
        .then(() => A.seriesIn(ukBt, (mac) => A.makeState('_uBTs.' + mac, A.f(ukBt[mac]), true)))
        .then(() => A.makeState('_uBTs', A.O(A.ownKeysSorted(ukBt))))
        .then(() => A.seriesIn(ukIp, (ip) => A.makeState('_uIPs.' + ip.split('.').join('_'), A.f(ukIp[ip]), true)))
        .then(() => A.makeState('_uIPs', A.O(A.ownKeysSorted(ukIp))))
        .catch(err => A.W(`Scan devices returned error: ${A.O(err)}`))
        .then(() => {
            for (let item in scanList)
                scanList[item].ipHere = scanList[item].btHere = 0;
            ukBt = {};
            ukIp = {};
        });

}

/*
process.on('SIGINT', () => {
    A.W('SIGINT signal received.');
    A.wait(1000).then(() => {
            A.stop(true);
            network.stop();
            bluetooth.stop();
        })
        .then(() => A.wait(2000))
        .then(() => process.exit(0));
});

*/

function main() {

    network.on('request', items => {
        items.macVendor = Network.getMacVendor(items.macAddress);
        delete items.type;
        items.by = 'dhcp';
        foundIpMac(items);
        A.Df('found item %s by dhcp: %s, %s, %s', items.hostName, items.ipAddress, items.macAddress, Network.getMacVendor(items.macAddress));
    });

    network.on('arp-scan', found => foundIpMac({
        ipAddress: found[0],
        macAddress: found[1],
        by: 'arp'
    }));

    network.on('listenState', listen => A.makeState('info.connection', listen, true));
    bluetooth.on('found', what => foundBt(what));

    A.unload = () => Promise.resolve(() => network.stop()).catch(A.nop).then(() => Promise.resolve(bluetooth.stop())).catch(A.nop);

    /* 
    A.unload = () => {
        network.stop();
        bluetooth.stop();
    };
*/
    var numecb = [],
        numhp = [];

    //    Network.updateMacdb()
    //    A.wait(1)
    network.init(true);
    Network.updateMacdb().then(() => {

            A.debug = A.C.debug;

            if (!A.C.devices.length) {
                A.W(`No to be scanned devices are configured for host ${A.adapter.host}! Will stop Adapter`);
                return A.stop(true);
            }

            btid = Number(A.C.btadapterid);
            if (isNaN(btid)) {
                A.W(`BT interface number not defined in config, will use '0'`);
                btid = 0;
            }

            A.clearStates();

            if (!A.C.scandelay || parseInt(A.C.scandelay) < 15)
                A.C.scandelay = 15;
            scanDelay = A.C.scandelay * 1000;

            return bluetooth.init({
                btid: btid,
                scanTime: Math.floor(scanDelay * 0.85),
                doHci: A.C.hcionly
            });
        }).then(() => {
            //    bluetooth.on('stateChange', (what) => A.D(`Noble state changed: ${what}`));

            if (!A.C.delayaway || parseInt(A.C.delayaway) < 2)
                A.C.delayaway = 2;
            delayAway = A.C.delayaway;
            A.I(`radar2 set to flag items away if they are not seen for ${delayAway} minutes`);

            if (!A.C.printerdelay || parseInt(A.C.printerdelay) < 100)
                A.C.printerdelay = 100;
            printerDelay = parseInt(A.C.printerdelay);

            if (A.C.knownBTs)
                knownBTs = A.C.knownBTs.toLowerCase().replace(/['[\]\s]/g, '').split(',');
            A.I('use known BT list: ' + A.O(knownBTs));

            if (A.C.knownIPs)
                knownIPs = A.C.knownIPs.replace(/['[\]\s]/g, '').split(',');
            A.I('use known IP list: ' + A.O(knownIPs));

            A.timer = [];
            arpcmd = ((A.C.arp_scan_cmd && A.C.arp_scan_cmd.length > 0) ?
                A.C.arp_scan_cmd : A.W(`arp-scan cmd line not configured in config! Will use '-lgq --retry=4 --timeout=400'`, '-lgq --retry=4 --timeout=400'));
            if (A.C.arp_scan_cmd.indexOf('--interface') < 0)
                A.I(`arp-scan will use the following interfaces: ` + A.O(network.ip4addrs()));

            A.I(`radar2 set to scan every ${A.C.scandelay} seconds and printers every ${printerDelay} minutes.`);

            devices = A.C.devices;
        })
        .then(() => A.isLinuxApp('hcitool').then(x => x && A.exec('hcitool dev').then(x => x.slice(8).trim()), () => false).then(x => !!x, () => false).then(x => scanBt = x))
        .then(x => A.If('Will try to scan BT devices: %s', x))
        .then(() => A.N(() =>
            //    A.exec(`!${btbindir}bluetoothview /scomma ${btbindir}btf.txt`).then(x => doBtv = x && x.length > 0, () => doBtv = false)
            A.isLinuxApp('arp-scan').then(x => x ? A.exec('arp-scan').then(x => x ? `"${arpcmd}" on ${network.ip4addrs()}` : false, () => A.W("Adapter nut running as root or iobroker has no sudo right, cannot use arp-scan!")) : false)
            .then(x => doArp = x)
            //        .then(() => A.isApp('hcitool').then(x => doHci = x))
            .then(() => {
                // eslint-disable-next-line complexity
                return A.seriesOf(devices, item => {
                    //                A.I(`checking item ${A.O(item)}`);
                    let ret = Promise.resolve();
                    if (item.name)
                        item.name = item.name.trim().replace(/[\s.]/g, '_');
                    if (!item.name || item.name.length < 2)
                        return Promise.resolve(A.W(`Invalid item name '${A.O(item.name)}', must be at least 2 letters long`));
                    if (scanList[item.name])
                        return Promise.resolve(A.W(`Double item name '${item.name}', names cannot be used more than once!`));
                    item.id = item.name.endsWith('-') ? item.name.slice(0, -1) : item.name;
                    item.ip = item.ip ? item.ip.trim() : '';
                    item.type = '';
                    item.macs = item.macs ? item.macs : '';
                    item.macs.split(',').forEach(val => {
                        const mac = val && (typeof val === 'string') ? val.trim().toLowerCase() : null;
                        if (mac && Network.isMac(mac)) {
                            item.type = 'IP';
                            item.hasMAC = item.hasMAC ? item.hasMAC.concat(mac) : [mac];
                            item.ipVendor = Network.getMacVendor(mac);
                            if (macList[mac]) A.W(`mac address ${mac} in ${item.name} was used already for another device ${macList[mac].name}, this is forbidden!`);
                            else macList[mac] = item;
                        } else if (mac)
                            A.W(`invalid MAC address in ${item.name}: '${val}'`);
                    });
                    delete item.macs;
                    item.bluetooth = item.bluetooth ? item.bluetooth.toLowerCase() : '';
                    item.bluetooth = A.trim(item.bluetooth.split(','));
                    if (item.bluetooth.length == 1 && !item.bluetooth[0])
                        delete item.bluetooth;
                    else
                        for (let b of item.bluetooth)
                            if (Network.isMac(b)) {
                                if (btList[b] && btList[b] !== item) {
                                    A.W(`bluetooth address ${b} in ${item.name} was used already for another device ${btList[b].name}, this is forbidden!`);
                                } else {
                                    btList[b] = item;
                                    item.type = 'BT';
                                    item.btVendor = Network.getMacVendor(b);
                                }
                            } else if (b !== '')
                        A.W(`Invalid bluetooth address '${b}' in ${item.name} , 6 hex numbers separated by ':'`);

                    if (item.ip && item.name.startsWith('HP-')) {
                        item.type = 'printer';
                        numhp = numhp.concat(item.name);
                    } else if (item.ip && item.name.startsWith('ECB-')) {
                        item.type = 'ECB';
                        numecb = numecb.concat(item.ip);
                    } else if (item.ip.startsWith('http')) {
                        item.type = 'URL';
                    } else if (item.ip.length > 1) {
                        if (item.type !== 'BT')
                            item.type = 'IP';
                        item.rip = !item.rip ? [] : !Array.isArray(item.rip) ? [item.rip] : item.rip;
                        const list = item.ip.split(',').map(x => x.trim());
                        ret = A.seriesOf(list, (addr) => Network.isIP(addr) ?
                                A.resolve(item.rip.push(addr)) :
                                network.dnsResolve(addr).then(x => {
                                    //                                    A.Ir(x, 'dns for %s was %O', addr, x);
                                    if (x)
                                        x.forEach((i) => item.rip.push(i));
                                    return null;
                                }).catch(e => A.E(A.O(e))), 0)
                            .then(() => {
                                let x = item.rip;
                                if (x && x.length > 0) {
                                    x.forEach((ip) => ipList[ip] && ipList[ip] == item ? A.W(`ip address ${ip} in ${item.name} was used already for another device ${ipList[ip].name}, this is forbidden!`) : (ipList[ip] = item));
                                }
                                return A.seriesOf(item.rip, (ip) => network.ping(ip).catch(A.nop).then(() => Network.getMac(ip)).then(x => {
                                    //                                    A.Df('add mac %s for ip %s in %s to %O', x, ip, item.name);
                                    if (x) {
                                        if (item.hasMAC) {
                                            //                                            A.If('mac for %O is %O', item, item.hasMAC);
                                            if (item.hasMAC.indexOf(x) < 0)
                                                item.hasMAC.push(x);
                                        } else item.hasMAC = [x];
                                        if (x && ip)
                                            network.combine(x, ip);
                                        //                    A.I(A.F('ip %s has mac %s.',ip,x));      
                                        //                                        A.Df('add mac %s for ip %s in %s to %O and vendor: ', x, ip, item.name, item.hasMAC, item.mipVendor);
                                        macList[x] = item;
                                    }
                                    return Promise.resolve(null);
                                }).catch(e => A.E(A.O(e))), 0);
                            }).catch(e => A.E(A.O(e)));
                        delete item.ip;
                    } else if (!item.bluetooth && !item.hasMAC)
                        return A.resolve(A.W(`Invalid Device should have IP or BT set ${A.O(item)}`));
                    scanList[item.name] = item;
                    return A.getState(item.id + '._lastHere').then(st => st && st.ts ? A.makeState(item.id + '._lastHere', A.dateTime(item.lasthere = new Date(st.ts)), st.ts) : A.wait(0)).catch(() => null)
                        .then(() => ret).then(() => A.extendObject(item.id, {
                            type: 'state',
                            native: {
                                radar2: item
                            }
                        }).catch(A.pE))
                        .then(() => A.getState(item.id + '._lastHere')).catch(A.nop)
                        //                        .then(() => (item.type === 'BT' || item.type === 'IP' || item.type === 'URL') ? Promise.resolve(setItem(item)).catch(A.pE) : null)
                        .then(() => A.I(`Init item ${item.name} with ${A.O(A.removeEmpty(item))}`), e => A.Wr(e, 'error item %s=%e', item.name, e));
                }, 5);
            }).catch(A.pE)
            .then(() => parseInt(A.C.external) > 0 ? scanExtIP() : Promise.resolve())
            .then(() => A.I(`Adapter identified macs: (${A.ownKeys(macList)}), \nips: (${A.ownKeys(ipList)}), \nbts: (${A.ownKeys(btList)})`))
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
                lang = A.C.lang;
                if (A.C.latitude && A.C.longitude) {
                    return A.get(`http://feed.alertspro.meteogroup.com/AlertsPro/AlertsProPollService.php?method=lookupCoord&lat=${A.C.latitude}&lon=${A.C.longitude}`, 2)
                        .then(res => JSON.parse(res)[0], e => A.W(`Culd not get UWZ Area ID: ${e} for Laenge: ${A.C.longitude} Breite: ${A.C.latitude}`, null))
                        .then(res => {
                            doUwz = res && res.AREA_ID ? res.AREA_ID : null;
                            if (doUwz && delayuwz > 0) {
                                A.I(`will scan UWZ with code ${res.AREA_ID} every ${delayuwz} minutes`);
                                A.timer.push(setInterval(getUWZ, delayuwz * 1000 * 60));
                                return getUWZ();
                            }
                            return A.resolve();
                        });
                } else return A.reject(A.W('No geo location data found configured in admin to calculate UWZ AREA ID!'));
            }).catch(A.pE)
            .then(() => {
                if (numecb.length && parseInt(A.C.external) > 0) {
                    A.I(A.F('Will scan ECB for ', numecb, ' every ', A.C.external, ' minutes'));
                    A.timer.push(setInterval(scanECBs, parseInt(A.C.external) * 1000 * 60));
                    return scanECBs().catch(A.nop);
                }
                return A.resolve();
            }).then(() => {
                if (numhp.length && printerDelay > 0) {
                    A.I(A.F('will scan printers ', numhp, ' every ', printerDelay, ' minutes'));
                    A.timer.push(setInterval(scanHPs, printerDelay * 1000 * 60));
                    return scanHPs();
                }
                return A.resolve();
            }).then(() => {
                A.I(`radar2 found ${Object.keys(scanList).length} devices in config (${Object.keys(scanList)})`);
                A.I(`radar2 set use of noble(${!!bluetooth.hasNoble}), doArp(${doArp}), btid(${btid}) and doUwz(${doUwz},${delayuwz},${numuwz},${lang},${longuwz}).`);
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
            .then(() => A.cleanup('*', A.D('cleanup old states...'))) // clean up old states not created this time!
            .then(() => A.I('Adapter initialization finished!'), err => {
                A.W(`radar initialization finished with error ${A.O(err)}, will stop adapter!`);
                A.stop(1);
            })));
}