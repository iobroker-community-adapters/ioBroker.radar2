/**
 *
 *      iobroker radar Adapter
 *
 *      (c) 2016- <frankjoke@hotmail.com>
 *
 *      MIT License
 *
 */
/* eslint-env node,es6 */
/* jshint -W097 */// jshint strict:false
/*jslint node: true */
"use strict";
const utils = require(__dirname + '/lib/utils'); // Get common adapter utils
const adapter = utils.adapter('radar');
const btbindir = __dirname + '\\bin\\bluetoothview\\';

const util = require('util');
const http = require('http');
const xml2js = require('xml2js');
const ping = require('ping');
const fs = require('fs');
const dns = require('dns');
//const noble =     require('noble'); // will be loaded later because not all machines will have it working
var noble = null;
const exec = require('child_process').exec;

function _O(obj, level) { return util.inspect(obj, false, level || 2, false).replace(/\n/g, ' '); }

// function _J(str) { try { return JSON.parse(str); } catch (e) { return {'error':'JSON Parse Error of:'+str}}} 
function _N(fun) { return setTimeout.apply(null, [fun, 0].concat(Array.prototype.slice.call(arguments, 1))); } // move fun to next schedule keeping arguments
function _D(l, v) { adapter.log.debug(l); return v === undefined ? l : v; }
function _I(l, v) { adapter.log.info(l); return v === undefined ? l : v; }
function _W(l, v) { adapter.log.warn(l); return v === undefined ? l : v; }


function wait(time, arg) { return new Promise(res => setTimeout(res, time, arg)) }

function pSeriesP(obj, promfn, delay) { // fun gets(item) and returns a promise
    delay = delay || 0;
    let p = Promise.resolve();
    const nv = [],
        f = (k) => p = p.then(() => promfn(k).then(res => wait(delay, nv.push(res))));
    for (let item of obj)
        f(item);
    return p.then(() => nv);
}
/*
function pSeriesInP(obj,promfn,delay) { // fun gets(key,obj) and returns a promise
    delay = delay || 0;
    let p = Promise.resolve();
    const   nv = [],
            f = (k) => p = p.then(() => promfn(k,obj).then(res => wait(delay,nv.push(res))));
    for(let item in obj) 
        f(item);
    return p.then(() => nv);
}

function pSeriesF(obj,fun,delay) { // fun gets(item) and returns a value
    delay = delay || 0;
    let p = Promise.resolve();
    const   nv = [],
            f = (k) => p = p.then(() => Promise.resolve(fun(k)).then(res => wait(delay,nv.push(res))));
    for(let item of obj) 
        f(item);
    return p.then(() => nv);
}
*/
function c2pP(f) {
    //    _D(`c2pP: ${_O(f)}`);
    return function () {
        const args = Array.prototype.slice.call(arguments);
        return new Promise((res, rej) => {
            args.push((err, result) => (err && _N(rej, err)) || _N(res, result));
            f.apply(this, args);
        });
    };
}

function c1pP(f) {
    return function () {
        const args = Array.prototype.slice.call(arguments);
        return new Promise((res, rej) => {
            args.push((result) => _N(res, result));
            f.apply(this, args);
        });
    };
}
/*
function pRetryP(nretry, fn, arg) {
    return fn(arg).catch(err => { 
        if (nretry <= 0) 
            throw err;
        return pRetryP(nretry - 1, fn,arg); 
    });
}

function pRepeatP(nretry, fn, arg) {
    return fn(arg).then(() => Promise.reject()).catch(err => { 
        if (nretry <= 0)
            return Promise.resolve();
        return pRepeatP(nretry - 1, fn,arg); 
    });
}

*/

const P = {}

function makePs() {
    P.getObjectList = c2pP(adapter.objects.getObjectList),
    P.getForeignObject = c2pP(adapter.getForeignObject),
    P.setForeignObject = c2pP(adapter.setForeignObject),
    P.getForeignObjects = c2pP(adapter.getForeignObjects),
    P.getForeignState = c2pP(adapter.getForeignState),
    P.getState = c2pP(adapter.getState),
    P.setState = c2pP(adapter.setState),
    P.getObject = c2pP(adapter.getObject),
    P.deleteState = c2pP(adapter.deleteState),
    P.delObject = c2pP(adapter.delObject),
    P.setObject = c2pP(adapter.setObject),
    P.createState = c2pP(adapter.createState),
    P.extendObject = c2pP(adapter.extendObject);
}

var isStopping = false;
const scanList = new Map();
var scanDelay = 30 * 1000; // in ms = 30 sec
var scanTimer = null;
var printerDelay = 100;
var printerCount = 0;
var delayAway = 10;
var countHere = 0;
var whoHere = [];
var host = null;

function stop(dostop) {
    isStopping = true;
    if (scanTimer)
        clearInterval(scanTimer);
    scanTimer = null;
    _W('Adapter disconnected and stopped');
    //    if (dostop)
    //        process.exit();
    //        adapter.stop();
}

adapter.on('message', obj => processMessage(obj));

adapter.on('ready', () => main(makePs()));

adapter.on('unload', () => stop(false));

function processMessage(obj) {
    if (obj && obj.command) {
        _D(`process Message ${_O(obj)}`);
        switch (obj.command) {
            case 'ping': {
                // Try to connect to mqtt broker
                if (obj.callback && obj.message) {
                    ping.probe(obj.message, { log: adapter.log.debug }, function (err, result) {
                        adapter.sendTo(obj.from, obj.command, res, obj.callback);
                    });
                }
                break;
            }
        }
    }
    adapter.getMessage(function (err, obj) {
        if (obj) {
            processMessage(obj);
        }
    });
}


const objects = new Map();

function makeState(id, value, ack) {
    ack = ack === undefined || !!ack;
    if (objects.has(id))
        return P.setState(id, value, ack);
    _D(`Make State ${id} and set value to '${_O(value)}'`) ///TC
    var st = {
        common: {
            name: id, // You can add here some description
            read: true,
            write: false,
            state: 'state',
            role: 'value',
            type: typeof value
        },
        type: 'state',
        _id: id
    };
    if (id.endsWith('Percent'))
        st.common.unit = "%";
    return P.extendObject(id, st)
        .then(x => {
            objects.set(id, x);
            return P.setState(id, value, ack);
        })
        .catch(err => _D(`MS ${_O(err)}:=extend`, id));

}


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
        //        _D(util.format('Noble found %j',idf));
        return idf;
    }

    _D(`Noble= ${_O(noble)} start ${len}`);

    let idf = {};
    if (nobleRunning) clearTimeout(nobleRunning);
    nobleRunning = null;

    if (!noble) return Promise.resolve({});
    if (isStopping) return Promise.reject('Stopping.')
    if (noble.state !== 'poweredOn') return Promise.reject('Noble not powered ON!');

    return new Promise((res, rej) => {
        noble.on('discover', function (per) {
            if (isStopping)
                return res(stopNoble(idf));

            var idt = (per.advertisement && per.advertisement.localName) ? per.advertisement.localName : "NaN";
            idf[per.address.toUpperCase()] = {
                address: per.address,
                name: idt,
                rssi: per.rssi
            };
        });

        noble.startScanning([], true);
        nobleRunning = setTimeout(() => res(stopNoble(idf)), len);
    }).catch(err => _I(`Noble scan Err ${_O(err)}`, err, noble = null));
}

function pExec(command) {
    const istest = command.startsWith('!');
    return new Promise((resolve, reject) => {
        exec(istest ? command.slice(1) : command, (error, stdout, stderr) => {
            if (istest && error) {
                error[stderr] = stderr;
                return reject(error);
            }
            resolve(stdout);
        });
    });
}

function pGet(url, retry) {
    //    _I(`pGet retry(${retry}): ${url}`);
    return (new Promise((resolve, reject) => {
        //        _I(`pGet retry(${retry}): ${url}`);
        http.get(url, (res) => {
            let statusCode = res.statusCode;
            let contentType = res.headers['content-type'];
            //            _D(`res: ${statusCode}, ${contentType}`);
            let error = null;
            if (statusCode !== 200) {
                error = new Error(`Request Failed. Status Code: ${statusCode}`);
                //              } else if (!/^application\/json/.test(contentType)) {
                //                error = new Error(`Invalid content-type. Expected application/json but received ${contentType}`);
            }
            if (error) {
                res.resume();                 // consume response data to free up memory
                return reject(error);
            }

            res.setEncoding('utf8');
            let rawData = '';
            res.on('data', (chunk) => rawData += chunk);
            res.on('end', () => _N(resolve, rawData));
        }).on('error', (e) => _N(reject, e));
    })).catch(err => {
        if (!(retry > 0)) throw err;
        return wait(100, retry - 1).then(a => pGet(url, a));
    });
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
        //            _I(`Tag: all: ${_O(all)} became ${item}`);                
        return item;
    }
    return (c2pP(new xml2js.Parser({
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
        return pGet(site, 2)
            .then(chunk => {
                const ip = chunk.trim();
                if (ip == oldip)
                    ++sameip;
                else
                    oldip = ip;
                return Promise.resolve(sameip);
            }, err => _I(`MyIP Error ${_O(err)}`, Promise.resolve(sameip)));
    }

    return getIP('http://icanhazip.com/?x=2')
        .then(() => getIP('http://wtfismyip.com/text'))
        .then(() => sameip < 1 ? getIP('http://nst.sourceforge.net/nst/tools/ip.php') : Promise.resolve(sameip))
        .then(() => P.getState('ExternalNetwork.IP4'))
        .then(x => x, err => Promise.resolve())
        .then(state => {
            if (state && state.val)
                state = state.val;
            if (oldip !== '' && state != oldip) {
                _I(`New IP address ${oldip}`, oldip);
            } else if (oldip === '') {
                return makeState('ExternalNetwork.status', _W(`Not connected to external network!`, 0));
            } else
                _D(`Same IP address ${oldip}`);
            return makeState('ExternalNetwork.IP4', oldip)
                .then(() => makeState('ExternalNetwork.status', ++sameip));
        }, err => _I(`scanExtIP error ${_O(err)}`, Promise.resolve()));
}

function scanECB(item) {
    let idn = item.id + '.';
    return pGet('http://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml', 2)
        .then(body => xmlParseString(body))
        .then(ecb => makeState(idn + 'fromDate', ecb.Envelope.Cube.Cube['$'].time).then(() => ecb))
        .then(ecb => pSeriesP(ecb.Envelope.Cube.Cube.Cube, cur => {
            let ccur = cur['$'].currency;
            let rate = parseFloat(cur['$'].rate);
            if (item.ip.indexOf(ccur) < 0)
                return Promise.resolve();
            return makeState(idn + ccur, rate);
        }, 5))
        .catch(err => _I(`ECB error: ${_O(err)}`));
}

function scanHP(item) {

    let idn = item.id + '.';
    let colors = [];
    let below10 = [];
    //    _I(`should call ${item.ip} for printer data`);
    return pGet('http://' + item.ip + '/DevMgmt/ConsumableConfigDyn.xml', 2)
        .then(body => xmlParseString(body.trim()))
        //        .then(result => _I(`parser ${_O(result,3)}`,result))
        .then(result => result["ConsumableConfigDyn"] ? result["ConsumableConfigDyn"] : result)
        .then(result => pSeriesP(result["ConsumableInfo"], item => {
            //            _I(`parser ${_O(item)}`);
            if (item["ConsumableTypeEnum"] != "ink")
                return Promise.resolve('No Ink');
            let p = "P" + item["ConsumableStation"],
                lc = item["ConsumableLabelCode"],
                idnc = idn + lc + '.',
                d = item["Installation"] ? item["Installation"]["Date"] : null,
                l = parseInt(item["ConsumablePercentageLevelRemaining"]),
                ci = item["ConsumableIcon"],
                s = ci["Shape"],
                fc = ci["FillColor"],
                rgb = fc["Blue"] | (fc["Green"] << 8) | (fc["Red"] << 16),
                n = item["ConsumableSelectibilityNumber"];
            rgb = '#' + (0x1000000 + rgb).toString(16).slice(1);
            let ss = `${p} = ${lc},${d ? d + ',' : ''} ${l}%, ${n}, ${rgb}, ${s}`;
            colors.push(ss);
            if (l <= 10)
                below10.push(lc);
            return makeState(idnc + 'fillPercent', l)
                .then(res => makeState(idnc + 'color', rgb))
                .then(res => makeState(idnc + 'text', ss));
        })
            .then(arg => makeState(idn + 'anyBelow10', below10.length > 0))
            .then(arg => makeState(_D(idn + 'whoBelow10'), below10.join(', ')))
            .then(arg => _D(`HP Printer inks found:${colors.length}`))
            .catch(err => _D(`HP Printer could not find info! Err: ${_O(err)}`)));
}

var oldWhoHere = null,
    bts = new Map(),
    ips = new Map(),
    vendors = new Map(),
    arps = {},
    unkn = {};

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
    return new Promise((_res, _rej) => {
        if (cache.has(item))
            return _res(cache.get(item));
        funP(item).then(res => _res((cache.set(item, res), res)));
    });
}

function scanAll() {
    if (isStopping) // do not start scan if stopping...
        return;

    _D(`Would now start scan for devices! ${printerCount === 0 ? 'Would also scan for printer ink now!' : 'printerCount=' + printerCount}`);

    for (let item of scanList.values())
        item.ipHere = item.btHere = false;

    arps = {};
    unkn = {};

    return Promise.all([doBtv ?
        pExec(`${btbindir}bluetoothview /scomma ${btbindir}btf.txt`)
            .then(stdout => wait(300, stdout))
            .then(stdout => c2pP(fs.readFile)(`${btbindir}btf.txt`, 'utf8'))
            .then(data => wait(100, data))
            .then(data => {
                try { fs.unlinkSync(`${btbindir}btf.txt`); } catch (e) { return ''; }
                return data;
            })
            .then(data => {
                for (let item of scanList.values())
                    if (data.toUpperCase().indexOf(item.bluetooth) > 0) {
                        _D(`doBtv found  ${item.name}`);
                        item.btHere = true;
                    }
            }) : wait(10),
    myNoble(scanDelay - 25000)
        .then(data => {
            let found = 0;
            for (let key of scanList.values()) {
                if (data[key.bluetooth]) {
                    delete data[key.bluetooth];
                    _D(`Noble found  ${key.name}`);
                    key.btHere = true;
                    ++found;
                }
            }
            return pSeriesP(Object.keys(data),(d) => { 
                var e = data[d];
//                _W(`process not found ${d} ${a}`);
                return checkCache(d, bts, mac => pGet('http://api.macvendors.com/' + mac).then(x => x.trim(), err => 'N/A'))
                    .then(x => e.vendor = x)
                    .then(() => unkn[d] = e)
//                    .then(() => _D(`Noble found also unknown: ${_O(e)}`))
                    .then(() => delete e['address'])
                    ;
            });
        }, err => false),
    doMac ? pExec('arp-scan -lgq --retry=7')
        .then(res => res && res.match(/(\d*\.){3}\d*\s*([\dA-F]{2}\:){5}[\dA-F]{2}/gi))
        .then(res => pSeriesP(res, item => {
            const s = item.split('\t');
            s[1] = s[1].toUpperCase();
            return Promise.all([
                    checkCache(s[0], ips, ip => c2pP(dns.reverse)(ip).then(nam => nam, err => 'DNS N/A')).then(x => s.push(x)),
                    checkCache(s[1], vendors, mac => pGet('http://api.macvendors.com/' + mac).then(x => x.trim(), err => 'Vendor N/A')).then(x => s.push(x)),
                ])
                .then(() => {
                    for (let sl of scanList.values()) {
                        let here = false;
                        if (s[0] == sl.ip)
                            sl.ipHere = here = true;
                        if (sl.hasMAC)
                            for (let m of sl.hasMAC)
                                if (s[1] == m)
                                    sl.ipHere = here = true;
                        if (!here)
                            arps[s[0]] = s.slice(1).join('; ');
                    }
                    return s;
                })
                .catch(err => _D(`${_O(err)}`));
        }, 10)) : wait(5),
    pSeriesP(scanList.values(), item => {
        //            _D(`key ${key} obj ${_O(key)} = ${_O(obj[key])}`);
        let all = [];
        if (item.hasECB) {
            if (printerCount === 0)
                all.push(scanECB(item));
        } else if (item.hasIP && !item.ipHere)
            if (item.ip.toUpperCase().startsWith('HTTP'))
                all.push(pGet(item.ip).then(x => true, e => false).then(x => item.ipHere = x || item.ipHere));
            else
                all.push(c1pP(ping.sys.probe)(item.ip)
                    .then(res => {
                        //                        _I(`${item.name}:${item.ip} = ${res}`);
                        if (!res && doFping)
                            return pExec('fping ' + item.ip)
                                .then(stdout => / is alive/.test(stdout) || res, false);
                        return res;
                    })
                    .then(iph => {
                        //                        _I(`IP ${item.name}:${item.ip} = ${iph}`);
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
                        all.push(pSeriesP(item.hasMAC, mac => pExec('arp-scan -lgq  --retry=5 --destaddr='+ mac)
                            .then(ret => {
                                item.ipHere = item.ipHere || ret.toUpperCase().indexOf(mac)>0; 
        //                        _I(`arp-scan for ${item.id}  ${item.ipHere} returned ${ret}`);
                                return Promise.resolve();                        
                            })
                        ));
        */
        if (item.hasBT)
            checkUnkn(item.bluetooth);
        if (doHci && item.hasBT && !item.bluetooth.startsWith('7C:2F:80') && !item.btHere) {
            all.push(pExec('hcitool name ' + item.bluetooth)
                .then(stdout => {
                    let bth = stdout > "";
                    if (bth) {
                        item.btname = stdout.trim();
                        item.btHere = true;
                        _D(`hcitool found ${item.name} as ${item.btname}`);
                    }
                    return bth;
                }, err => false)
                .then(bt => item.btHere = bt)
                .then(bt => !bt ? wait(200)
                    .then(x => pExec('!l2ping -c1 ' + item.bluetooth))
                    .then(op => op, x => _D(x, pExec('!l2ping -c1 ' + item.bluetooth)))
                    .then(op => op.length > 0 ?
                        _D(`l2ping found ${item.name} with "${op}"`, (item.btHere = true))
                        : _D(`l2ping for ${item.name} returned nothing!`, false),
                    x => _D(`l2ping for ${item.name} err: "${x}"`, false))
                    : false)
                .catch(x => x)
                .then(x => wait(100))
            );
        }
        return Promise.all(all)
            .then(obj => item.name, err => _D(`err in ${item.name}: ${_O(err)}`));
    }, 50).then(res => res, err => _D(`err ${_O(err)}`, err))
    ]).then(res => {
        //            _D(`Promise all  returned ${res}  ${res}:${_O(res)}`);
        if (++printerCount >= printerDelay) ///TBC
            printerCount = 0;
        whoHere = [];
        let allhere = [];
        return pSeriesP(scanList.values(), (item) => {
            //            for(let item of scanList.values()) {
            //                _I(`item=${_O(item)}:`);
            const here = item.ipHere || item.btHere;
            let cnt = item.cnt === undefined ? -delayAway : parseInt(item.cnt);
            let anw = false;
            //                _I(`${item.name}:cnt=${cnt}, here=${here}`);
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
                if (item.name == item.id)
                    whoHere.push(item.id);
            }
            _D(`${item.id}=${_O(item)}`);
            const idn = item.id;
            return makeState(idn + '.count', cnt)
                .then(res => makeState(idn + '.here', anw))
                .then(res => item.hasIP ? makeState(idn + '.ipHere', item.ipHere) : false)
                .then(res => item.hasBT ? makeState(idn + '.btHere', item.btHere) : false);
        }).then(() => {
            countHere = whoHere.length;
            whoHere = whoHere.join(', ');
            if (oldWhoHere != whoHere) {
                oldWhoHere = whoHere;
                _I(`ScanAll: From all ${allhere.length} devices dedected ${countHere} are whoHere: ${whoHere}`);
            }
            allhere = allhere.join(', ');
            return makeState('countHere', countHere)
                .then(res => makeState('allHere', allhere))
                .then(res => makeState('whoHere', whoHere));
        }).then(() => _D(`Noble found unknown BT's: ${_O(unkn)}, unknown IP's: ${arps}`))
        .then(() => makeState('AllUnknownBTs', JSON.stringify(unkn)))
        .then(res => makeState('AllUnknownIPs', JSON.stringify(arps)));
    }, err => _W(`Scan devices returned error: ${_O(err)}`));
}

function isMacBt(str) {
    return /^([0-9A-F]{2}\:){5}[0-9A-F]{2}$/.test(str.trim().toUpperCase());
}

var ain = '',
    wlast = null,
    lang = '',
    numuwz = 0,
    delayuwz =0,
    longuwz = false;

function getUWZ() {
    pGet('http://feed.alertspro.meteogroup.com/AlertsPro/AlertsProPollService.php?method=getWarning&language=de&areaID=' + doUwz)
        .then(body => JSON.parse(body))
        .then(data => {
            var w = data && data.results;
            if (!w)
                return Promise.reject('UWZ data err: ' + _O(data));
//            _W(`${_O(w,5)}`);
            return w.map(i => (lang == 'de' ? 
                (longuwz ? i.payload.translationsLongText.DE : i.payload.translationsShortText.DE) 
                : (longuwz ? i.payload.longText : i.payload.shortText)) + (longuwz ? ': ' + i.payload.levelName : ''));
        })
        .then(w => {
            let wl = w.length,
                wt = w.join(numuwz<0 ? '<br>\n': '\n');
            wt = wt == '' ? "No warnings" : wt;
            if (wt != wlast) {
                wlast = wt;
                _I(`UWZ found the following (changed) warnings: ${wt}`);
                if(numuwz>0) {
                    return pSeriesP(Object.keys(w), (x) => x<numuwz ? makeState('UWZ_Warnings.warning'+x,w[x]): Promise.resolve())
                        .then(() => {
                            let n = wl,
                                l = [];

                            while(n<numuwz)
                                l.push(n++);
                            return pSeriesP(l,(x) => makeState('UWZ_Warnings.warning'+x,''));
                        })
                } else  
                    return makeState('UWZ_Warning',wlast);
            }
        })
        .catch(e => _W(`Error in getUWZ: ${e}`))
}

function main() {
    host = adapter.host;

    try {
        noble = require('noble');
    } catch (e) {
        _W(`Noble not available, Error: ${_O(e)}`);
        noble = null;
    }

    ain = adapter.name + '.' + adapter.instance + '.';

    if (!adapter.config.devices.length) {
        _W(`No to be scanned devices are configured for host ${host}! Will stop Adapter`);
        return stop(true);
    }

    if (!adapter.config.scandelay || parseInt(adapter.config.scandelay) < 30)
        adapter.config.scandelay = 30;
    scanDelay = adapter.config.scandelay * 1000;

    if (!adapter.config.delayaway || parseInt(adapter.config.delayaway) < 2)
        adapter.config.delayaway = 2;
    delayAway = adapter.config.delayaway;

    if (!adapter.config.printerdelay || parseInt(adapter.config.printerdelay) < 100)
        adapter.config.printerdelay = 100;
    printerDelay = adapter.config.printerdelay;

    _I(`radar set to scan every ${adapter.config.scandelay} sec and printers every ${printerDelay} scans.`);

    _I(`BT Bin Dir = '${btbindir}'`);

    pExec(`!${btbindir}bluetoothview /scomma ${btbindir}btf.txt`)
        .then(stdout => true, err => false)
        .then(result => {
            doBtv = result;
            return pExec('!fping 127.0.0.1').then(r => r, r => r)
        }).then(stdout => / is alive/.test(stdout), false)
        .then(result => {
            doFping = result;
            return pExec('!arp-scan -lgq').then(r => r, r => r)
        }).then(stdout => /[0-9] packets received/.test(stdout), false)
        .then(result => {
            doMac = result;
            return pExec('!hcitool name 12:34:56:78:90:ab');
        }).then(res => true, err => false)
        .then(res => {
            doHci = res;
            return pSeriesP(adapter.config.devices, item => {
                //                _I(`checking item ${_O(item)}`);
                if (item.name)
                    item.name = item.name.trim().replace(/[\s\.]/g, '_');
                if (!item.name || item.name.length < 2)
                    return Promise.resolve(_W(`Invalid item name '${_O(item.name)}', must be at least 2 letters long`));
                if (scanList.has(item.name))
                    return Promise.resolve(_W(`Double item name '${item.name}', names cannot be used more than once!`));
                item.id = item.name.endsWith('-') ? item.name.slice(0, -1) : item.name;
                item.ip = item.ip ? item.ip.trim() : '';
                item.macs = item.macs ? item.macs.trim().toUpperCase() : '';
                item.macs.split(',').forEach(val => {
                    const mac = val && (typeof val === 'string') ? val.trim() : null;
                    if (mac) {
                        if (isMacBt(mac))
                            item.hasMAC = item.hasMAC ? item.hasMAC.push(mac) : [mac];
                        else
                            _W(`invalid MAC address in ${item.name}: '${val}'`);
                    }
                });
                if (item.hasMAC && !doMac)
                    _W(`MAC addresses '${item.macs}' will not be scanned because no arp-scan is available!`)
                item.bluetooth = item.bluetooth ? item.bluetooth.trim().toUpperCase() : '';
                item.hasBT = isMacBt(item.bluetooth);
                if (item.bluetooth !== '' && !item.hasBT)
                    _W(`Invalid bluetooth address '${item.bluetooth}', 6 hex numbers separated by ':'`);
                item.printer = item.ip && item.name.startsWith('HP-');
                item.hasECB = item.ip && item.name.startsWith('ECB-');
                item.hasIP = item.ip && item.ip.length > 2;
                if (item.hasIP && !item.ip.toUpperCase().startsWith('HTTP')) {
                    if (!item.ip.match(/^(\d+\.){3}\d+/)) 
                        c2pP(dns.resolve)(item.ip).then(x => item.rip = x);
                    else
                        item.rip = item.ip;
                }
                if (!(item.hasIP || item.hasBT))
                    return Promise.resolve(_W(`Invalid Device should have IP or BT set ${_O(item)}`));
                scanList.set(item.name, item);
                _I(`Init item ${item.name} with ${_O(item)}`);
                return Promise.resolve(item.id);
            }, 50);
        }).then(() => parseInt(adapter.config.external) > 0 ? scanExtIP() : Promise.resolve())
        .then(() => P.getObjectList({ include_docs: true }))
        .then(res => {
            var r = {};
            if (!adapter.config.delayuwz || parseInt(adapter.config.delayuwz)<=0)
                return Promise.resolve(_I(`No UWZ warning because of Delay is ${adapter.config.delayuwz}`));
            delayuwz =  parseInt(adapter.config.delayuwz); 
            numuwz =  parseInt(adapter.config.numuwz);
            longuwz = Boolean(adapter.config.longuwz)
            res.rows.map(i => r[i.doc._id] = i.doc)
            if(r['system.config'] && r['system.config'].common.language) 
                lang = r['system.config'].common.language;
            if (r['system.config'] && r['system.config'].common.latitude) {
                adapter.config.latitude = parseFloat(r['system.config'].common.latitude);
                adapter.config.longitude = parseFloat(r['system.config'].common.longitude);
                return pGet(`http://feed.alertspro.meteogroup.com/AlertsPro/AlertsProPollService.php?method=lookupCoord&lat=${adapter.config.latitude}&lon=${adapter.config.longitude}`)
                    .then(res => JSON.parse(res)[0], e => _W(`Cpuld not get UWZ Area ID: ${e} for Laenge: ${adapter.config.longitude} Breite: ${adapter.config.latitude}`))
                    .then(res => doUwz = res && res.AREA_ID ? res.AREA_ID : null)
                    .then(() => getUWZ(), setInterval(getUWZ, parseInt(adapter.config.delayuwz) * 1000))
            } else return Promise.reject(_W('No geo location data found configured in admin to calculate UWZ AREA ID!'));
        }, err => doUwz = null)
        .then(res => {
            _I(`radar adapter initialized ${scanList.size} devices, ExternalNetwork = ${adapter.config.external}.`);
            _I(`radar set use of noble(${!!noble}), fping(${doFping}), doMac(${doMac}), doHci(${doHci}), doBtv(${doBtv}) and doUwz(${doUwz},${delayuwz},${numuwz},${lang},${longuwz}).`);
            scanTimer = setInterval(scanAll, scanDelay);
            if (parseInt(adapter.config.external) > 0)
                setInterval(scanExtIP, parseInt(adapter.config.external) * 1000);
            return scanAll(); // scan first time and generate states if they do not exist yet
        })
        .then(res => P.getObjectList({ startkey: ain, endkey: ain + '\u9999' }))
        .then(res => pSeriesP(res.rows, item => {  // clean all states which are not part of the list
            //            _I(`Check ${_O(item)}`);
            let id = item.id.slice(ain.length);
            if (objects.has(id))
                return Promise.resolve();
            //            _I(`Delete ${_O(item)}`);
            return P.deleteState(id)
                .then(x => _D(`Del State: ${id}`), err => _D(`Del State err: ${_O(err)}`)) ///TC
                .then(y => P.delObject(id))
                .then(x => _D(`Del Object: ${id}`), err => _D(`Del Object err: ${_O(err)}`)) ///TC
        }, 10))
        .catch(err => {
            _W(`radar initialization finished with error ${_O(err)}, will stop adapter!`);
            stop(true);
            throw err;
        })
        .then(x => _I('Adapter initialization finished!'))
        ;
}
