/**
 *      iobroker radar Adapter
 *      (c) 2016- <frankjoke@hotmail.com>
 *      MIT License
 *      V 2 Feb 2019
 */
/* eslint-env node,es6 */
/*jslint node: true, bitwise: true, sub:true */

"use strict";

// you have to require the utils module and call adapter function
const utils = require(__dirname + '/lib/utils'); // Get common adapter utils

// you have to call the adapter function and pass a options object
// name has to be set and has to be equal to adapters folder name and main file name excluding extension
// adapter will be restarted automatically every time as the configuration changed, e.g system.adapter.template.0
let adapter;

function startAdapter(options) {
    options = options || {};
    Object.assign(options, {
        name: 'radar'
    });
    adapter = new utils.Adapter(options);
    return adapter;
}

const MA = require('./myAdapter'),
    A = MA.MyAdapter,
    Network = require('./myNetwork').Network;

const btbindir = __dirname + '\\bin\\bluetoothview\\';

const xml2js = require('xml2js');

const scanList = {},
    ipList = {},
    macList = {},
    btList = {};
var scanDelay = 30 * 1000; // in ms = 30 sec
var scanTimer = null;
var printerDelay = 100;
var printerCount = 0;
var delayAway = 10;
var countHere = 0;
var whoHere = [];
var host = null;
var arpcmd = 'arp-scan -lgq';
var doHci = true;
var doBtv = true;
var doArp = true;
var doUwz = null;

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
    function scanHP(item) {
        if (item.type !== 'printer')
            return Promise.resolve();

        let idn = item.id + '.';
        let below10 = [];
        //    A.I(`should call ${item.ip} for printer data`);
        return A.get('http://' + item.ip + '/DevMgmt/ConsumableConfigDyn.xml', 2)
            .then(body => xmlParseString(body.trim()))
            //        .then(result => A.I(`parser ${A.O(result,3)}`,result))
            .then(result => result.ConsumableConfigDyn ? result.ConsumableConfigDyn : result)
            .then(result => A.seriesOf(result.ConsumableInfo, item => {
                    //            A.I(`parser ${A.O(item)}`);
                    item.ipHere = Date.now();
                    if (item.ConsumableTypeEnum !== "ink")
                        return Promise.resolve('No Ink');
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
                })
                //            .then(() => A.makeState(idn + 'ink', below10.length > 0))
                //            .then(() => A.makeState(idn + 'below10' , below10.join(', ')))
                .then(() => A.makeState(item.id, '' + new Date()))
                .then(() => A.makeState(idn + 'ink', '' + below10.join(', ')))
                //            .then(arg => `HP Printer inks found:${colors.length}`)
                .catch(err => A.D(`HP Printer could not find info! Err: ${A.O(err)}`)));
    }
    return A.seriesOf(devices, (item) => scanHP(item), 1);

}
const btn = {},
    ips = {};

var oldWhoHere = null,
    arps = {},
    unkn = {},
    hcicmd, l2cmd;

function checkArps(ip) {
    ip = ip.trim();
    if (arps[ip]) {
        delete arps[ip];
        return true;
    }
    return false;
}

function checkUnkn(ip) {
    ip = ip.trim().toUpperCase();
    if (arps[ip]) {
        delete arps[ip];
        return true;
    }
    return false;
}

function checkCache(item, cache, funP) {
    //    A.D(`CC: ${item} in ${cache[item]}`);
    return new Promise((_res) => {
        if (cache[item])
            return A.N(_res, cache[item]);
        funP(item).then(res =>
            _res(cache[item] = res));
    });
}


function foundIpMac(ip) {
    if (Network.matchMac.test(ip)) {
        if (macList[ip]) {
            macList[ip].ipHere = new Date();
        }
    } else if (ipList[ip]) {
        ipList[ip].ipHere = new Date();
    }
}

function foundBt(mac) {
    if (btList[mac]) {
        btList[mac].btHere = new Date();
    }
}

function scanAll() {
    A.D(`Would now start scan for devices! ${printerCount === 0 ? 'Would also scan for printer ink now!' : 'printerCount=' + printerCount}`);

    for (let item in scanList)
        scanList[item].ipHere = scanList[item].btHere = false;

    arps = {};
    unkn = {};

    return Promise.all(
        [
            /* (doBtv ?
                           A.exec(`${btbindir}bluetoothview /scomma ${btbindir}btf.txt`)
                           .then(() => A.wait(10))
                           .then(() => A.c2p(fs.readFile)(`${btbindir}btf.txt`, 'utf8'))
                           .then(data => A.wait(10, data))
                           .then(data => {
                               try {
                                   fs.unlinkSync(`${btbindir}btf.txt`);
                               } catch (e) {
                                   return '';
                               }
                               return data;
                           })
                           .then(data => {
                               for (let item in scanList)
                                   if (data.toUpperCase().indexOf(scanList[item].bluetooth) > 0) {
                                       A.D(`doBtv found  ${scanList[item].name}`);
                                       scanList[item].btHere = true;
                                   }
                           }) : A.wait(3)), */
            (A.ownKeys(btList).length ? bluetooth.startNoble(scanDelay * 0.7) : A.wait(4)),
            /*
                        .then(data => A.seriesIn(data, x => data[x].name === 'NaN' ? (data[x].name = Network.getMacVendor(x)) : Promise.resolve(data[x].name)).then(() => data))
                        .then(data => {
                            let found = 0;
                            for (let key in scanList) {
                                if (data[scanList[key].bluetooth]) {
                                    delete data[scanList[key].bluetooth];
                                    A.D(`Noble found  ${scanList[key].name}`);
                                    scanList[key].btHere = true;
                                    ++found;
                                }
                            }
                            return A.seriesOf(Object.keys(data), (d) => {
                                var e = data[d];
                                e.vendor = Network.getMacVendor(d);
                                unkn[d] = e;
                                delete e.address;
                                return Promise.resolve(0);
                            });
                        }, () => false),
                        */
            (doArp && A.ownKeys(macList).length + A.ownKeys(ipList).length ? network.arpScan(arpcmd)
                /*
                               .then(res => res && res.match(/(\d*\.){3}\d*\s*([\dA-F]{2}\:){5}[\dA-F]{2}/gi))
                               .then(res => A.seriesOf(res, item => {
                                   const s = item.split('\t');
                                   s[1] = s[1].toUpperCase();
                                   s.push(Network.getMacVendor(s[1]));
                                   return checkCache(s[0], ips, ip => network.dnsReverse(ip).then(nam => Array.isArray(nam) ? nam.join('; ') : nam, () => '; DNS N/A').then(x => s.push(x)), () => false)
                                       .then(() => {
                                           //                            A.D(`${s}`);
                                           for (let sli in scanList) {
                                               let sl = scanList[sli];
                                               let here = false;
                                               if (s[0] === sl.ip)
                                                   sl.ipHere = here = true;
                                               if (sl.hasMAC)
                                                   for (let m of sl.hasMAC)
                                                       if (s[1] === m)
                                                           sl.ipHere = here = true;
                                               if (!here)
                                                   arps[s[0]] = s.slice(1).join('; ');
                                           }
                                           return s;
                                       })
                                       .catch(err => A.D(`arpcmd err: ${A.O(err)}`));

                               }, 5))  */
                :
                A.wait(5))
            /*
                       A.seriesInOI(scanList, item => {
                           //              A.D(`key ${item} obj ${A.O(item)} = ${A.O(item)}`);
                           let all = [];
                           if (item.isECB) {
                               //                    if (printerCount === 0)
                               //                        all.push(scanECB(item));
                           } else if (item.hasIP && !item.ipHere)
                               if (item.ip.toUpperCase().startsWith('HTTP'))
                                   all.push(A.get(item.ip, 2).then(() => true, () => false).then(x => item.ipHere = x || item.ipHere));
                               else
                                   all.push(network.ping(item.ip)
                                       .then(iph => {
                                           //                        A.I(`IP ${item.name}:${item.ip} = ${iph}`);
                                           if (iph) {
                                               item.ipHere = true;
                                               //                                    if (item.isPrinter && printerCount === 0)
                                               //                                        return scanHP(item);
                                           }
                                           return iph;
                                       })
                                   );

                           
                                       if (doArp && item.hasMAC)
                                           all.push(A.seriesOf(item.hasMAC, mac => A.exec('arp-scan -lgq  --retry=5 --destaddr='+ mac)
                                               .then(ret => {
                                                   item.ipHere = item.ipHere || ret.toUpperCase().indexOf(mac)>0; 
                           //                        A.I(`arp-scan for ${item.id}  ${item.ipHere} returned ${ret}`);
                                                   return Promise.resolve();                        
                                               })
                                           ));
                           
                           if (item.hasBT)
                               checkUnkn(item.bluetooth);
                           if (doHci && item.hasBT && !item.bluetooth.startsWith('7C:2F:80') && !item.btHere) {
                               all.push(A.exec(hcicmd + item.bluetooth)
                                   .then(stdout => {
                                       let bth = stdout > "";
                                       if (bth) {
                                           btn[item.bluetooth] = item.btname = stdout.trim();
                                           item.btHere = true;
                                           A.D(`hcitool found ${item.name} as ${item.btname}`);
                                       }
                                       return bth;
                                   }, () => false)
                                   .then(bt => item.btHere = bt)
                                   .then(bt => !bt ? A.wait(50).then(() => A.exec(l2cmd + item.bluetooth)) : "")
                                   .then(op => op.length > 0 ? A.D(`l2ping found ${item.name} with "${op}"`, (item.btHere = true)) : false, () => false)
                                   .then(() => A.wait(10))
                               );
                           }
                           return Promise.all(all).then(() => item.name, err => A.D(`err in ${item.name}: ${A.O(err)}`));
                       }, 50).then(res => res, err => A.D(`err ${A.O(err)}`, err))
                       */
        ]).then(() => {
        //            A.D(`Promise all  returned ${res}  ${res}:${A.O(res)}`);
        if (++printerCount >= printerDelay) ///TBC
            printerCount = 0;
        whoHere = [];
        let allhere = [];
        let notHere = [];
        return A.seriesInOI(scanList, (item) => {
                //            for(let item of scanList.values()) {
                //                A.I(`item=${A.O(item)}:`);
                const here = item.ipHere || item.btHere;
                let cnt = item.cnt === undefined ? -delayAway : parseInt(item.cnt);
                let anw = false;
                //                A.I(`${item.name}:cnt=${cnt}, here=${here}`);
                if (item.isECB)
                    return Promise.resolve();
                if (here) {
                    cnt = cnt < 0 ? 0 : cnt + 1;
                    anw = true;
                } else {
                    cnt = cnt > 0 ? -1 : cnt - 1;
                    anw = cnt >= -delayAway;
                }
                if (item.rip) {
                    if (Array.isArray(item.rip))
                        for (let ip of item.rip)
                            checkArps(ip);
                    else
                        checkArps(item.rip);
                }
                item.anwesend = anw;
                item.cnt = cnt;
                if (anw) {
                    allhere.push(item.id);
                    if (item.name === item.id)
                        whoHere.push(item.id);
                } else if (item.hasBT || item.hasIP) notHere.push(item.id);
                //                A.D(`${item.id}=${A.O(item)}`);
                const idn = item.id;
                return A.makeState(idn + '.count', cnt)
                    .then(() => A.makeState(item.id, anw))
                    .then(() => item.hasIP ? A.makeState(idn + '.ipHere', item.ipHere) : false)
                    .then(() => item.hasBT ? A.makeState(idn + '.btHere', item.btHere) : false);
            }).then(() => {
                if (Array.isArray(whoHere)) {
                    countHere = whoHere.length;
                    whoHere = whoHere.join(', ');
                    if (oldWhoHere !== whoHere) {
                        oldWhoHere = whoHere;
                        A.I(`ScanAll: From all ${allhere.length} devices dedected ${countHere} are whoHere: ${whoHere}`);
                    }
                }
                allhere = allhere.join(', ');
                A.D(`radar found here (${allhere}) and not here (${notHere})`);
                return A.makeState('_countHere', countHere)
                    .then(() => A.makeState('_allHere', allhere))
                    .then(() => A.makeState('_notHere', notHere))
                    .then(() => A.makeState('_whoHere', whoHere));
            }).then(() => A.D(`Noble found unknown BT's: ${A.ownKeysSorted(unkn)}, unknown IP's: ${A.ownKeysSorted(arps)}`), () => null)
            .then(() => A.seriesIn(unkn, (mac) => A.makeState('_UnknownBTs.' + mac, A.O(unkn[mac]))).then(() => A.makeState('_UnknownBTs', A.O(A.ownKeysSorted(unkn)))))
            .then(() => A.seriesIn(arps, (ip) => A.makeState('_UnknownIPs.' + ip.split('.').join('_'), A.O(arps[ip]))).then(() => A.makeState('_UnknownIPs', A.O(A.ownKeysSorted(arps)))));
    }, err => A.W(`Scan devices returned error: ${A.O(err)}`));
}

const network = new Network();
const bluetooth = new Bluetooth();
network.init(false);

var wlast = null,
    lang = '',
    numuwz = 0,
    delayuwz = 0,
    longuwz = false,
    btid = 0,
    devices = null;

function getUWZ() {
    if (!doUwz)
        return Promise.resolve();
    A.get('http://feed.alertspro.meteogroup.com/AlertsPro/AlertsProPollService.php?method=getWarning&language=de&areaID=' + doUwz, 2)
        .then(body => JSON.parse(body))
        .then(data => {
            var w = data && data.results;
            if (!w)
                return Promise.reject('UWZ data err: ' + A.O(data));
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
                    return A.seriesOf(Object.keys(w), (x) => x < numuwz ? A.makeState('UWZ_Warnings.warning' + x, w[x]) : Promise.resolve())
                        .then(() => {
                            let n = wl,
                                l = [];

                            while (n < numuwz)
                                l.push(n++);
                            return A.seriesOf(l, (x) => A.makeState('UWZ_Warnings.warning' + x, ''));
                        });
                } else
                    return A.makeState('UWZ_Warning', wlast);
            }
        })
        .catch(e => A.W(`Error in getUWZ: ${e}`));
}

function main() {
    function isApp(name) {
        return A.exec('!which ' + name).then(x => x.length >= name.length, () => false);
    }

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
    hcicmd = `hcitool -i hci${btid} name `;
    l2cmd = `!sudo l2ping -i hci${btid} -c1 `;

    for (let st of A.ownKeys(A.states))
        delete A.states[st];
    if (!adapter.config.scandelay || parseInt(adapter.config.scandelay) < 15)
        adapter.config.scandelay = 15;
    scanDelay = adapter.config.scandelay * 1000;

    network.on('arp-scan', (found) => (foundIpMac(found[0]), foundIpMac(found[1])));

    bluetooth.init(btid, scanDelay * 0.7);
    bluetooth.on('noble-found', (what) => {
        what.vendor = Network.getMacVendor(what.address);
        //        A.D(`Noble found: ${A.O(what)}`);
        foundBt(what.address);
    });

    bluetooth.on('stateChange', (what) => A.D(`Noble state changed: ${what}`));

    if (!adapter.config.delayaway || parseInt(adapter.config.delayaway) < 2)
        adapter.config.delayaway = 2;
    delayAway = adapter.config.delayaway;

    if (!adapter.config.printerdelay || parseInt(adapter.config.printerdelay) < 100)
        adapter.config.printerdelay = 100;
    printerDelay = adapter.config.printerdelay;

    let as = adapter.config.arp_scan_cmd;
    if (as && as.startsWith('!')) {
        as = as.slice(1);
        A.debug = true;
    }

    var numip = 0,
        numbt = 0;

    arpcmd = ((as && as.length > 0) ?
        as : A.W(`arp-scan cmd line not configured in config! Will use '-lgq --retry=4 --timeout=400'`, '-lgq --retry=4 --timeout=400'));

    A.I(`radar set to scan every ${adapter.config.scandelay} sec and printers every ${printerDelay} scans.`);

    A.I(`BT Bin Dir = '${btbindir}'`);
    devices = adapter.config.devices;

//    A.exec(`!${btbindir}bluetoothview /scomma ${btbindir}btf.txt`).then(x => doBtv = x && x.length > 0, () => doBtv = false)
    A.wait(200)
        .then(() => isApp('arp-scan').then(x => x ? A.exec('sudo arp-scan').then(x => x ? `"${arpcmd}" on ${network.ip4addrs()}` : false, () => A.W("Adapter nut running as root or iobroker has no sudo right, cannot use arp-scan!")) : false)
            .then(x => doArp = x))
        .then(() => isApp('hcitool').then(x => doHci = x))
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
                        item.btVendor = Network.getMacVendor(item.bluetooth);
                        numbt++;
                    }
                } else if (item.bluetooth !== '')
                    A.W(`Invalid bluetooth address '${item.bluetooth}', 6 hex numbers separated by ':'`);
                if (item.ip && item.name.startsWith('HP-'))
                    item.type = 'printer';
                else if (item.ip && item.name.startsWith('ECB-'))
                    item.type = 'ECB';
                else if (item.ip.startsWith('http'))
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
                    return Promise.resolve(A.W(`Invalid Device should have IP or BT set ${A.O(item)}`));
                scanList[item.name] = item;
                A.I(`Init item ${item.name} with ${A.O(item)}`);
                return Promise.resolve(item.id);
            }, 50);
        }).then(() => parseInt(adapter.config.external) > 0 ? scanExtIP() : Promise.resolve())
        .then(() => A.I(`Adapter identified macs: (${A.ownKeys(macList)}), \nbts: (${A.ownKeys(btList)}), \nips: (${A.ownKeys(ipList)})`))
        .then(() => A.getObjectList({
            include_docs: true
        }))
        .then(res => {
            var r = {};
            if (!adapter.config.delayuwz || parseInt(adapter.config.delayuwz) <= 0)
                return Promise.resolve(A.I(`No UWZ warning because of Delay is ${adapter.config.delayuwz}`));
            delayuwz = parseInt(adapter.config.delayuwz);
            numuwz = parseInt(adapter.config.numuwz);
            longuwz = Boolean(adapter.config.longuwz);
            res.rows.map(i => r[i.doc._id] = i.doc);
            if (r['system.config'] && r['system.config'].common.language)
                lang = r['system.config'].common.language;
            if (r['system.config'] && r['system.config'].common.latitude) {
                adapter.config.latitude = parseFloat(r['system.config'].common.latitude);
                adapter.config.longitude = parseFloat(r['system.config'].common.longitude);
                return A.get(`http://feed.alertspro.meteogroup.com/AlertsPro/AlertsProPollService.php?method=lookupCoord&lat=${adapter.config.latitude}&lon=${adapter.config.longitude}`, 2)
                    .then(res => JSON.parse(res)[0], e => A.W(`Culd not get UWZ Area ID: ${e} for Laenge: ${adapter.config.longitude} Breite: ${adapter.config.latitude}`, null))
                    .then(res => {
                        doUwz = res && res.AREA_ID ? res.AREA_ID : null;
                        if (doUwz && adapter.config.delayuwz) {
                            getUWZ();
                            setInterval(getUWZ, parseInt(adapter.config.delayuwz) * 1000);
                        }
                    }, () => doUwz = null);
            } else return Promise.reject(A.W('No geo location data found configured in admin to calculate UWZ AREA ID!'));
        }, () => doUwz = null)
        .then(() => {
            A.I(`radar adapter initialized ${Object.keys(scanList).length} devices, ExternalNetwork = ${adapter.config.external}.`);
            A.I(`radar set use of noble(${!!bluetooth.hasNoble}), doArp(${doArp}), doHci(${doHci}), doBtv(${doBtv}), btid(${btid}) and doUwz(${doUwz},${delayuwz},${numuwz},${lang},${longuwz}).`);
            return A.Ptime(scanAll()).then(ms => {
                A.I(`first scan took ${ms/1000} seconds`);
                if (scanDelay <= ms)
                    scanDelay = A.W(`scanDelay increased to ${(ms+2000)/1000} seconds!`, ms + 2000);
                scanTimer = setInterval(scanAll, scanDelay);
                if (parseInt(adapter.config.external) > 0)
                    setInterval(scanExtIP, parseInt(adapter.config.external) * 1000);
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