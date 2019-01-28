/**
 *      iobroker radar Adapter
 *      (c) 2016- <frankjoke@hotmail.com>
 *      MIT License
 *      V 2 Feb 2019
 */
/* eslint-env node,es6 */
/*jslint node: true */
"use strict";

// you have to require the utils module and call adapter function
const utils = require(__dirname + '/lib/utils'); // Get common adapter utils

// you have to call the adapter function and pass a options object
// name has to be set and has to be equal to adapters folder name and main file name excluding extension
// adapter will be restarted automatically every time as the configuration changed, e.g system.adapter.template.0
const adapter = utils.Adapter('radar'),
    //    assert = require('assert'),
    MA = require('./myAdapter'),
    A = MA.MyAdapter;
//    moment = require('moment'),
//const adapter = utils.Adapter('radar');
const btbindir = __dirname + '\\bin\\bluetoothview\\';

//const util = require('util');
//const http = require('http');
//const https = require('https');
const netping = require("net-ping");
const xml2js = require('xml2js');
const ping = require('ping');
const fs = require('fs');
const dns = require('dns');
const oui = require('oui');
//const noble =     require('noble'); // will be loaded later because not all machines will have it working
var noble = null;
//const exec = require('child_process').exec;

// function _J(str) { try { return JSON.parse(str); } catch (e) { return {'error':'JSON Parse Error of:'+str}}} 

var isStopping = false;
const scanList = {};
var scanDelay = 30 * 1000; // in ms = 30 sec
var scanTimer = null;
var printerDelay = 100;
var printerCount = 0;
var delayAway = 10;
var countHere = 0;
var whoHere = [];
var host = null;
var arpcmd = 'arp-scan -lgq';

const matchIP4 = /(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)/,
    matchIP6 = /(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))/;
const ping4session = netping.createSession({
    networkProtocol: netping.NetworkProtocol.IPv4,
    packetSize: 16,
    retries: 2,
    sessionId: (process.pid % 65535),
    timeout: 2000,
    ttl: 128
});
const ping6session = netping.createSession({
    networkProtocol: netping.NetworkProtocol.IPv6,
    packetSize: 16,
    retries: 2,
    sessionId: (process.pid % 65535) - 1,
    timeout: 2000,
    ttl: 128
});

function netPing(ips, fun) {
    if (A.T(ips) === 'string')
        ips = [ips];
    if (A.T(ips) !== 'array')
        return Promise.reject(`Invalid argument for netPing:'${A.O(ips)}'`);
    let pip = [];

    function pres(ip) {
        let session = matchIP4.test(ip) ? ping4session : ping6session;
        return new Promise((res) => {
            session.pingHost(ip, function (error, target) {
                if (error) {
                    if (error instanceof ping.RequestTimedOutError)
                        A.D(target + ": Not alive");
                    else
                        A.D(target + ": " + error.toString());
                    res(undefined);
                } else
                    res(fun(target));
            });
        });
    }
    for (let i of ips) {
        pip.push(pres(i));
    }
    return Promise.all(pip);
}

function stop(dostop) {
    isStopping = true;
    if (scanTimer)
        clearInterval(scanTimer);
    scanTimer = null;
    A.W('Adapter disconnected and stopped with ' + dostop);
    //    if (dostop)
    //        process.exit();
    //        adapter.stop();
}


A.init(adapter, main);

var nobleRunning = null;

function myNoble(len) {
    function stopNoble(idf) {
        if (nobleRunning)
            clearTimeout(nobleRunning);
        if (!noble)
            return {};
        nobleRunning = null;
        noble.removeAllListeners('discover');
        noble.stopScanning();
        //        A.D(util.format('Noble found %j',idf));
        return idf;
    }

    //    A.D(`Noble= ${A.O(noble)} start ${len}`);

    let idf = {};
    if (nobleRunning) clearTimeout(nobleRunning);
    nobleRunning = null;

    if (!noble) return Promise.resolve({});
    if (isStopping) return Promise.reject('Stopping.');
    if (noble.state !== 'poweredOn') return Promise.reject('Noble not powered ON!');

    return new Promise((res) => {
        noble.on('discover', function (per) {
            if (isStopping)
                return res(stopNoble(idf));
            //            A.D(`-myNoble discovers: ${A.O(per)}`);
            var idt = (per.advertisement && per.advertisement.localName) ? per.advertisement.localName : "NaN";
            idf[per.address.toUpperCase()] = {
                address: per.address,
                name: idt,
                rssi: per.rssi
            };
        });

        noble.startScanning([], true);
        nobleRunning = setTimeout(() => res(stopNoble(idf)), len);
    }).catch(err => A.I(`Noble scan Err ${A.O(err)}`, err, noble = null));
}

var doFping = true;
var doHci = true;
var doBtv = true;
var doMac = true;
var doUwz = null;

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
        .then(() => sameip < 1 ? getIP('http://nst.sourceforge.net/nst/tools/ip.php') : Promise.resolve(sameip))
        .then(() => A.getState('_ExternalNetwork.IP4'))
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

function scanECB(item) {
    let idn = item.id + '.';
    //    A.I(`ScanECB: ${item.id}`);
    return A.get('https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml', 2)
        .then(body => xmlParseString(body))
        //        .then(res => A.I(`ECB returned: ${A.O(res,5)}`,res))
        .then(ecb => A.makeState(item.id, ecb.Envelope.Cube.Cube.$.time).then(() => ecb))
        .then(ecb => A.seriesOf(ecb.Envelope.Cube.Cube.Cube, cur => {
            let ccur = cur.$.currency;
            let rate = parseFloat(cur.$.rate);
            if (item.ip.indexOf(ccur) < 0)
                return Promise.resolve();
            return A.makeState(idn + ccur, rate);
        }, 5))
        .catch(err => A.W(`ECB error: ${A.O(err)}`));
}

function scanHP(item) {

    let idn = item.id + '.';
    let colors = [];
    let below10 = [];
    //    A.I(`should call ${item.ip} for printer data`);
    return A.get('http://' + item.ip + '/DevMgmt/ConsumableConfigDyn.xml', 2)
        .then(body => xmlParseString(body.trim()))
        //        .then(result => A.I(`parser ${A.O(result,3)}`,result))
        .then(result => result.ConsumableConfigDyn ? result.ConsumableConfigDyn : result)
        .then(result => A.seriesOf(result.ConsumableInfo, item => {
                //            A.I(`parser ${A.O(item)}`);
                if (item.ConsumableTypeEnum !== "ink")
                    return Promise.resolve('No Ink');
                let p = "P" + item.ConsumableStation,
                    lc = item.ConsumableLabelCode,
                    idnc = idn + 'ink.' + lc + '.',
                    d = item.Installation ? item.Installation.Date : null,
                    l = parseInt(item.ConsumablePercentageLevelRemaining),
                    ci = item.ConsumableIcon,
                    s = ci.Shape,
                    fc = ci.FillColor,
                    rgb = fc.Blue | (fc.Green << 8) | (fc.Red << 16),
                    n = item.ConsumableSelectibilityNumber;
                rgb = '#' + (0x1000000 + rgb).toString(16).slice(1);
                let ss = `${p} = ${lc},${d ? d + ',' : ''} ${l}%, ${n}, ${rgb}, ${s}`;
                colors.push(ss);
                if (l <= 10)
                    below10.push(lc);
                //                A.I(`printer ${idn} = ${below10}`);
                return A.makeState(idnc + 'color', rgb)
                    .then(() => A.makeState(idnc + 'text', ss));
            })
            //            .then(() => A.makeState(idn + 'ink', below10.length > 0))
            //            .then(() => A.makeState(idn + 'below10' , below10.join(', ')))
            .then(() => A.makeState(idn + 'ink', '' + below10.join(', ')))
            //            .then(arg => `HP Printer inks found:${colors.length}`)
            .catch(err => A.D(`HP Printer could not find info! Err: ${A.O(err)}`)));
}

const bts = {},
    btn = {},
    ips = {},
    vendors = {};


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


function dnsReverse(ip) {
    return A.c2p(dns.reverse)(ip).then(arr => arr.length>0 ? arr : null, () => null);
}

function dnsResolve(name) {
    let arr = [];
    return Promise.all([
            A.c2p(dns.resolve4)(name).then(x => arr = arr.concat(x), () => null),
            A.c2p(dns.resolve6)(name).then(x => arr = arr.concat(x), () => null)
    ]).then(() => arr.length>0 ? arr : null)
}


var qmac = Promise.resolve();

function checkMac(mac) {
    let v = oui(mac),
        vl = v && v.split('\n');
    return v && vl && vl.length > 2 ? vl[0] + '/' + vl[2] : 'Vendor N/A';
}

function checkBtn(mac) {
    if (!btn[mac]) {
        qmac = new Promise((res) => {
            btn[mac] = '!Name may come later!';

            qmac.then(() => A.exec(hcicmd + mac)
                .then(stdout => stdout > "" ? stdout.trim() : 'Name N/A'), () => 'Name N/A').then(x => res(btn[mac] = x));
        });
    }
    return Promise.resolve(btn[mac]);
}

function scanAll() {
    if (isStopping) // do not start scan if stopping...
        return;

    A.D(`Would now start scan for devices! ${printerCount === 0 ? 'Would also scan for printer ink now!' : 'printerCount=' + printerCount}`);

    for (let item in scanList)
        scanList[item].ipHere = scanList[item].btHere = false;

    arps = {};
    unkn = {};

    return Promise.all(
        [doBtv ?
            A.exec(`${btbindir}bluetoothview /scomma ${btbindir}btf.txt`)
            .then(() => A.wait(100))
            .then(() => A.c2p(fs.readFile)(`${btbindir}btf.txt`, 'utf8'))
            .then(data => A.wait(100, data))
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
            }) : A.wait(10),
            myNoble(scanDelay / 3)
            .then(data => A.seriesIn(data, x => data[x].name === 'NaN' ? checkBtn(x).then(n => data[x].name = n) : Promise.resolve(data[x].name)).then(() => data))
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
                    e.vendor = checkMac(d);
                    unkn[d] = e;
                    delete e.address;
                    return Promise.resolve(0);
                });
            }, () => false),
            (doMac ? A.exec(arpcmd)
                .then(res => res && res.match(/(\d*\.){3}\d*\s*([\dA-F]{2}\:){5}[\dA-F]{2}/gi))
                .then(res => A.seriesOf(res, item => {
                    const s = item.split('\t');
                    s[1] = s[1].toUpperCase();
                    s.push(checkMac(s[1]));
                    return checkCache(s[0], ips, ip => dnsReverse(ip).then(nam => Array.isArray(nam) ? nam.join('; ') : nam, () => '; DNS N/A').then(x => s.push(x)), () => false)
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

                }, 5)) : A.wait(5)),
            A.seriesInOI(scanList, item => {
                //              A.D(`key ${item} obj ${A.O(item)} = ${A.O(item)}`);
                let all = [];
                if (item.hasECB) {
                    if (printerCount === 0)
                        all.push(scanECB(item));
                } else if (item.hasIP && !item.ipHere)
                    if (item.ip.toUpperCase().startsWith('HTTP'))
                        all.push(A.get(item.ip, 2).then(() => true, () => false).then(x => item.ipHere = x || item.ipHere));
                    else
                        all.push(A.c1p(ping.sys.probe)(item.ip)
                            .then(res => {
                                //                        A.I(`${item.name}:${item.ip} = ${res}`);
                                if (!res && doFping)
                                    return A.exec('fping ' + item.ip)
                                        .then(stdout => / is alive/.test(stdout) || res, false);
                                return res;
                            })
                            .then(iph => {
                                //                        A.I(`IP ${item.name}:${item.ip} = ${iph}`);
                                if (iph) {
                                    item.ipHere = true;
                                    if (item.printer && printerCount === 0)
                                        return scanHP(item);
                                }
                                return iph;
                            })
                        );

                /*
                            if (doMac && item.hasMAC)
                                all.push(A.seriesOf(item.hasMAC, mac => A.exec('arp-scan -lgq  --retry=5 --destaddr='+ mac)
                                    .then(ret => {
                                        item.ipHere = item.ipHere || ret.toUpperCase().indexOf(mac)>0; 
                //                        A.I(`arp-scan for ${item.id}  ${item.ipHere} returned ${ret}`);
                                        return Promise.resolve();                        
                                    })
                                ));
                */
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
                        .then(bt => !bt ? A.wait(50)
                            .then(() => A.exec(l2cmd + item.bluetooth))
                            //                            .then(op => op, x => A.D(x, A.exec('!l2ping -c1 ' + item.bluetooth)))
                            .then(op => op.length > 0 ? A.D(`l2ping found ${item.name} with "${op}"`, (item.btHere = true)) : A.D(`l2ping for ${item.name} returned nothing!`, false),
                                x => A.D(`l2ping for ${item.name} err: "${x}"`, false)) :
                            false)
                        .then(() => A.wait(50))
                    );
                }
                return Promise.all(all).then(() => item.name, err => A.D(`err in ${item.name}: ${A.O(err)}`));
            }, 50).then(res => res, err => A.D(`err ${A.O(err)}`, err))
        ]).then(() => {
        //            A.D(`Promise all  returned ${res}  ${res}:${A.O(res)}`);
        if (++printerCount >= printerDelay) ///TBC
            printerCount = 0;
        whoHere = [];
        let allhere = [];
        return A.seriesInOI(scanList, (item) => {
                //            for(let item of scanList.values()) {
                //                A.I(`item=${A.O(item)}:`);
                const here = item.ipHere || item.btHere;
                let cnt = item.cnt === undefined ? -delayAway : parseInt(item.cnt);
                let anw = false;
                //                A.I(`${item.name}:cnt=${cnt}, here=${here}`);
                if (item.hasECB)
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
                }
                A.D(`${item.id}=${A.O(item)}`);
                const idn = item.id;
                return A.makeState(idn + '.count', cnt)
                    .then(() => A.makeState(item.id, anw))
                    .then(() => item.hasIP ? A.makeState(idn + '.ipHere', item.ipHere) : false)
                    .then(() => item.hasBT ? A.makeState(idn + '.btHere', item.btHere) : false);
            }).then(() => {
                countHere = whoHere.length;
                whoHere = whoHere.join(', ');
                if (oldWhoHere !== whoHere) {
                    oldWhoHere = whoHere;
                    A.I(`ScanAll: From all ${allhere.length} devices dedected ${countHere} are whoHere: ${whoHere}`);
                }
                allhere = allhere.join(', ');
                return A.makeState('_countHere', countHere)
                    .then(() => A.makeState('_allHere', allhere))
                    .then(() => A.makeState('_whoHere', whoHere));
            }).then(() => A.D(`Noble found unknown BT's: ${A.O(unkn)}, unknown IP's: ${A.O(arps)}`))
            .then(() => A.seriesIn(unkn, (mac) => A.makeState('_UnknownBTs.' + mac, A.O(unkn[mac]))).then(() => A.makeState('_UnknownBTs', A.O(A.ownKeysSorted(unkn)))))
            .then(() => A.seriesIn(arps, (ip) => A.makeState('_UnknownIPs.' + ip.split('.').join('_'), A.O(arps[ip]))).then(() => A.makeState('_UnknownIPs', A.O(A.ownKeysSorted(arps)))));
    }, err => A.W(`Scan devices returned error: ${A.O(err)}`));
}

function isMacBt(str) {
    return /^([0-9A-F]{2}\:){5}[0-9A-F]{2}$/.test(str.trim().toUpperCase());
}

var ain = '',
    wlast = null,
    lang = '',
    numuwz = 0,
    delayuwz = 0,
    longuwz = false,
    btid = 0;

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

function isApp(name) {
    return A.exec('!which ' + name).then(x => x.length >= name.length, () => false);
}

function main() {
    host = adapter.host;
    A.debug = true;

    ain = A.ains + '.';

    if (!A.C.devices.length) {
        A.W(`No to be scanned devices are configured for host ${host}! Will stop Adapter`);
        return stop(true);
    }

    btid = Number(adapter.config.btadapterid);
    if (isNaN(btid)) {
        A.W(`BT interface number not defined in config, will use '0'`);
        btid = 0;
    }
    hcicmd = `hcitool -i hci${btid} name `;
    l2cmd = `!sudo l2ping -i hci${btid} -c1 `;

    process.env['NOBLE_HCI_DEVICE_ID'] = btid;

    try {
        noble = require('@abandonware/noble');
        A.I("found '@abandonware/noble'");
    } catch (e) {
        try {
            noble = require('noble');
            A.I("found 'noble'");
        } catch (e) {
            A.W(`Noble not available, Error: ${A.O(e)}`);
            noble = null;
        }
    }

    if (!adapter.config.scandelay || parseInt(adapter.config.scandelay) < 15)
        adapter.config.scandelay = 15;
    scanDelay = adapter.config.scandelay * 1000;

    if (!adapter.config.delayaway || parseInt(adapter.config.delayaway) < 2)
        adapter.config.delayaway = 2;
    delayAway = adapter.config.delayaway;

    if (!adapter.config.printerdelay || parseInt(adapter.config.printerdelay) < 100)
        adapter.config.printerdelay = 100;
    printerDelay = adapter.config.printerdelay;

    arpcmd = 'sudo arp-scan -lgq ' + ((adapter.config.arp_scan_cmd && adapter.config.arp_scan_cmd.length > 0) ?
        adapter.config.arp_scan_cmd : A.W(`arp-scan cmd line not configured in config! Will use '--retry=4'`, '--retry=4'));

    A.I(`radar set to scan every ${adapter.config.scandelay} sec and printers every ${printerDelay} scans.`);

    A.I(`BT Bin Dir = '${btbindir}'`);

    A.exec(`!${btbindir}bluetoothview /scomma ${btbindir}btf.txt`).then(x => doBtv = x && x.length > 0, () => doBtv = false)
        .then(() => isApp('fping').then(x => doFping = x))
        .then(() => isApp('arp-scan').then(x => x ? A.exec('sudo arp-scan').then(x => x ? `"${arpcmd}" on ${x.trim()}` : false, () => A.W("Adapter nut running as root, cannot use arp-scan!")) : false).then(x => doMac = x))
        .then(() => isApp('hcitool').then(x => doHci = x))
        .then(() => {
            return A.seriesOf(adapter.config.devices, item => {
                //                A.I(`checking item ${A.O(item)}`);
                if (item.name)
                    item.name = item.name.trim().replace(/[\s\.]/g, '_');
                if (!item.name || item.name.length < 2)
                    return Promise.resolve(A.W(`Invalid item name '${A.O(item.name)}', must be at least 2 letters long`));
                if (scanList[item.name])
                    return Promise.resolve(A.W(`Double item name '${item.name}', names cannot be used more than once!`));
                item.id = item.name.endsWith('-') ? item.name.slice(0, -1) : item.name;
                item.ip = item.ip ? item.ip.trim() : '';
                item.macs = item.macs ? item.macs.trim().toUpperCase() : '';
                item.macs.split(',').forEach(val => {
                    const mac = val && (typeof val === 'string') ? val.trim() : null;
                    if (mac) {
                        if (isMacBt(mac))
                            item.hasMAC = item.hasMAC ? item.hasMAC.push(mac) : [mac];
                        else
                            A.W(`invalid MAC address in ${item.name}: '${val}'`);
                    }
                });
                if (item.hasMAC && !doMac)
                    A.W(`MAC addresses '${item.macs}' will not be scanned because no arp-scan is available!`);
                item.bluetooth = item.bluetooth ? item.bluetooth.trim().toUpperCase() : '';
                item.hasBT = isMacBt(item.bluetooth);
                if (item.bluetooth !== '' && !item.hasBT)
                    A.W(`Invalid bluetooth address '${item.bluetooth}', 6 hex numbers separated by ':'`);
                item.printer = item.ip && item.name.startsWith('HP-');
                item.hasECB = item.ip && item.name.startsWith('ECB-');
                item.hasIP = item.ip && item.ip.length > 2;
                if (item.hasIP && !item.hasECB && !item.ip.toUpperCase().startsWith('HTTP')) {
                    if (!item.ip.match(/^(\d+\.){3}\d+/))
                        dnsResolve(item.ip).then(x => x ? (item.rip = x) : null);
                    else
                        item.rip = item.ip;
                }
                if (!(item.hasIP || item.hasBT))
                    return Promise.resolve(A.W(`Invalid Device should have IP or BT set ${A.O(item)}`));
                scanList[item.name] = item;
                A.I(`Init item ${item.name} with ${A.O(item)}`);
                return Promise.resolve(item.id);
            }, 50);
        }).then(() => parseInt(adapter.config.external) > 0 ? scanExtIP() : Promise.resolve())
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
                        if (doUwz) {
                            getUWZ();
                            setInterval(getUWZ, parseInt(adapter.config.delayuwz) * 1000);
                        }
                    }, () => doUwz = null);
            } else return Promise.reject(A.W('No geo location data found configured in admin to calculate UWZ AREA ID!'));
        }, () => doUwz = null)
        .then(() => {
            A.I(`radar adapter initialized ${Object.keys(scanList).length} devices, ExternalNetwork = ${adapter.config.external}.`);
            A.I(`radar set use of noble(${!!noble}), fping(${doFping}), doMac(${doMac}), doHci(${doHci}), doBtv(${doBtv}), btid(${btid}) and doUwz(${doUwz},${delayuwz},${numuwz},${lang},${longuwz}).`);
            scanTimer = setInterval(scanAll, scanDelay);
            if (parseInt(adapter.config.external) > 0)
                setInterval(scanExtIP, parseInt(adapter.config.external) * 1000);
            return scanAll(); // scan first time and generate states if they do not exist yet
        })
        /*
                .then(() => A.getObjectList({
                    startkey: ain,
                    endkey: ain + '\u9999'
                }))
                .then(res => A.seriesOf(res.rows, item => { // clean all states which are not part of the list
                    //            A.I(`Check ${A.O(item)}`);
                    let id = item.id.slice(ain.length);
                    if (objects[id])
                        return Promise.resolve();
                    //            A.I(`Delete ${A.O(item)}`);
                    return A.deleteState(id)
                        .then(() => A.D(`Del State: ${id}`), err => A.D(`Del State err: ${A.O(err)}`)) ///TC
                        .then(() => A.delObject(id))
                        .then(() => A.D(`Del Object: ${id}`), err => A.D(`Del Object err: ${A.O(err)}`)); ///TC
                }, 10))
        */
        .catch(err => {
            A.W(`radar initialization finished with error ${A.O(err)}, will stop adapter!`);
            stop(true);
            throw err;
        })
        .then(() => A.I('Adapter initialization finished!'));
}