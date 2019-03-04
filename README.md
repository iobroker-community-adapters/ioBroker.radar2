![Logo](admin/radar2.png)

[![NPM version](http://img.shields.io/npm/v/iobroker.radar2.svg)](https://www.npmjs.com/package/iobroker.radar2)
[![Downloads](https://img.shields.io/npm/dm/iobroker.radar2.svg)](https://www.npmjs.com/package/iobroker.radar2)
**Tests:** Linux/Mac: [![Travis-CI](http://img.shields.io/travis/frankjoke/ioBroker.radar2/master.svg)](https://travis-ci.org/frankjoke/ioBroker.radar2)
Windows: [![AppVeyor](https://ci.appveyor.com/api/projects/status/github/frankjoke/ioBroker.radar2?branch=master&svg=true)](https://ci.appveyor.com/project/frankjoke/ioBroker-radar2/)


[![NPM](https://nodei.co/npm/iobroker.radar2.png?downloads=true)](https://nodei.co/npm/iobroker.radar2/)

==============

# ioBroker radar2 für Netzwerk und Bluetooth-Geräte, HP Drucker und ECB-Kurse
Mit diesem Adapter kann man testen ob Geräte via Netzwerk oder Bluetooth verfügbar sind.

Er kann folgendes aufspüren oder anzeigen:
* Geräte mit IP oder Netzwerkadressen, unterstützt IPv4 und IPv6!
* Es intersucht alle Interfaces welche IPv4-Adressen zugewiesen haben (z.B. auf dem Kabel und WLan)
* Neue Funktion erkennt alle neuen Benutzer im Netz sofort wenn sie eine IP zugewiesen bekommen (dhcp)
* Bluetooth normal oder Bluetooth LE, der Bluetooth-Adapter kann definiert werden
* HP-drucker tintenfüllstände
* ECB Umrechnungskurse zum Euro
* UWZ Wetterwarnungen
* Eigene node-routinen
* Mit Ausnahme von arp-scan keine externen Programme mehr notwendig, weniger CPU und Netzwerkauslastung!
* Der Adapter läuft ohne sudo und somit auch als iobroker-Benutzer!
* Urls mit https können jetzt verwendet werden
  HP-Drucker erzeugen weniger States

Wenn die IP-adresse mit 'http' beginnt interpretiert radar2 sie als web-adresse (url) und fragt die Adresse ab anstatt ping zu verwenden. Damit kann der Status eines Webservers (wie z.B. http(s)://iobroker.net) geprüft werden.
Bei https kann aber ein Fehler bei den Schlüsseln auch als 'nicht vorhanden' gemeldet werden. So meldet https://forum.iobroker.net abwesend da das Forum nicht im domainschlüssel gelistet ist. Das vorige Beispiel ohne 'forum.' funktioniert.

Für Unwetterwarnungen muss im ioBroker-admin der Längen- und Breitengrad konfiguriert sein damit der Adapter den UWZ-Area_Code findet. 
Wenn der Wert von Max Messages >0 ist dann werden genau so viele states erzeugt die entweder leer sind oder Meldungen enthalten.
Wenn 0 angegeben wird (als default) wird nur ein State erzeugt welcher dann für jede Meldung eine Zeile enthält.
Jede Meldung besteht aus dem Meldungs-Text und am Ende eine severity-einstufung.
Es kann eingestellt werden ob der der lange (mit genauer Beschreibung für Orte mit Gewitter) oder kurze Warnungstext angezeigt wird.

Die verfügbareb ECB-Währungen können mit `https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml` abgefragt werden.

## Unterschiede zum alten radar-Adapter:

Radar2 hört am Netzwerk mit um neuankömmlinge sofort zu entdecken. Das bedeutet wenn z.B. nach der Heimkehr das Häny sich ins lokale W-Lan einloggt).
Wnn das Handy sich einloggt sendet es eine Anfrage per dhcp, das DHCP-Protokoll dauert 5 Sekunden (damit der Router keine Adresse vergibt die schon vergeben ist) der Router(=meistens DNS-Server)  offeriert die Adresse genau dann wenn das Händy sie akzeptiert und die Verbindung aufnehen kann wir das auch in radar2 verarbeitet, nicht erst beim nächsten Scan!

Weiters sind alle externen internen ping und DNS-Anfragen durch node-Module ersetzt und damit vielö schneller und mit weniger CPU-load verwendbar.
Einzig und alleine `arp-scan` ist noch ein externes Programm welches einmal pro scan alle IPv4-Adressen scannt und erreichbare ausgibt. Nur jene Adressen welche nicht mit arp-scan gefunden werden können werden dann nochmal mit ping gesucht.
Neu ist dass arp-scan alle IPv4-Schnittstellen überprüft und nicht nur die 1. Damit ist es möglich einen Raspi per Lan-Kabel ins Hausnetz anzuschließen und per W-Lan z.B. ins Gast-Wlan!
Damit werden auch dort Geräte erkannt!

Neu ist auch dass die Anwesenheit nicht mehr mizt Zählern sondern mit Zeitdauer bis zur letzten Sichtbarkeit berechnet wird und somit in Minuiten angegeben wird.

Bei den Bluetooth-routinen wurde auch die externen Programme durch einige node-module ersetzt, damit wird ein Bluetooth-Standard und ein Bluetooth-LE scan durchgeführt. Beide dauern bis zu 12 Sekunden um alle Geräte zu fincen welche eine relativ gute Verbindung habenund deshalb ist die Minimale Scan-Zeit auf 15 Sekunden gesetzt.
Das Signal ist bei BT sehr wichtig, deshalb würde ich nicht das interne BT-Modul verwenden sondern einen USB-BT 4.0-Modul (habe die um ~7€ gekauft), das richtige zu verwendende Interface (hci0...) kann konfiguriert werden.
Damit kann man auch z.b. den BLE-Adapter jetzt gleichzeitig laufen lassen wenn man zwei Schnittstellen verwendet!

Die Art der generierten Daten hat nsich auch geändert. Unbekannte IP und BT-Adressen werden jetzt einzeln gespeichert. Es kann jedoch eine Liste angegeben werden welche geräte aus diesen Info's ausschließt, das ist sicher gut für alle festen Geräte welche ihr nicht permanen testen wollt und die aber auch keine Unbekannt-Meldung generieren woillt.

Die Intervalle für HP-Ducker, ECB-, UWZ- und normale scans können getrennt gesetzt werden.

## Installation

Auf Linux sollte das tool `arp-scan` und `libcap2-bin` sowie einige Bluetooth treiber installiert werden installiert werden und die Rechte von arp-scan und node angepasst werden. 
Bei Debian (Raspi-Stretch, Ubuntu, ...) schaut das so aus:
```
sudo apt-get install libcap2-bin arp-scan bluetooth bluez libbluetooth-dev libudev-dev
sudo setcap cap_net_admin,cap_net_raw,cap_net_bind_service=+eip $(eval readlink -f `which arp-scan`)
sudo setcap cap_net_admin,cap_net_raw,cap_net_bind_service=+eip $(eval readlink -f `which node`)
```

Bei Windows steht arp-scan nicht zur Verfügung und es wird nur node-ping verwendet.

Der Rest kann ion der Adapter-Konfig eingestellt werden.

### Eine spezielle Info zu arp-scan:
Es ist eine Standard-Kommandozeile `-lgq --retry=4 --timeout=400` welche auf allen IPv4-Interfaces alle 255 Adressen scannt und wenn eine nicht binnen 400ms nicht antwortet es noch 4x probiert!
Wenn ihr zwar mehrere interfaces habt aber nicht alle scannen wollt dann hängt ` --interface=br0` an dann wird nur dort gescannt.
Die Wiederholungen werden bis 6-7 eventuell in 1% der Fälle noch besser, aber darüber habe ich kleinen Unterschied festgestellt. Genauso hab ich bei Timeout über 500 nie einen Unterschied erkannt. 


### Important/Wichtig
* Adapter braucht node > v4.1.*!
* Adapter läuft nicht unter osx! 

### Todo
* mehrsprachige Anleitung und Texte

## Changelog
### 0.1.5 Beta
* klnown bugs removed

### 0.1.2 Beta 
* Repository rename to ioBroker.radar2 to fulfill ioBroker requirements!
* First npm version on public beta
* arp-scan und dhcp-scan changed to avoid errors on systems with internal bridges

## License

The MIT License (MIT)

Copyright (c) 2018-2019, frankjoke <frankjoke@hotmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
